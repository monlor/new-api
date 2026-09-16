package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strconv"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/chrate"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/i18n"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
)

func WaitChannelRateLimit(c *gin.Context, channel *model.Channel) *types.NewAPIError {
	if channel == nil {
		return nil
	}
	setting := channel.GetSetting()
	if c != nil && !setting.HasRateLimit() {
		if ctxSetting, ok := common.GetContextKeyType[dto.ChannelSettings](c, constant.ContextKeyChannelSetting); ok {
			setting = ctxSetting
		}
	}
	return WaitChannelRateLimitSetting(c, channel.Id, setting)
}

func WaitChannelRateLimitSetting(c *gin.Context, channelId int, setting dto.ChannelSettings) *types.NewAPIError {
	if !setting.HasRateLimit() {
		return nil
	}
	ctx := context.Background()
	if c != nil && c.Request != nil {
		ctx = c.Request.Context()
	}
	waitMs := setting.GetRateLimitWaitMs()
	waitTimeout := time.Duration(waitMs) * time.Millisecond
	err := chrate.WaitAllow(ctx, channelId, setting.RateLimitCount, setting.GetRateLimitDurationMs(), waitTimeout)
	if err == nil {
		return nil
	}
	if errors.Is(err, context.Canceled) {
		return types.NewError(err, types.ErrorCodeInvalidRequest, types.ErrOptionWithSkipRetry(), types.ErrOptionWithStatusCode(http.StatusBadRequest))
	}
	var limitErr *chrate.LimitError
	if errors.As(err, &limitErr) {
		retryAfter := limitErr.RetryAfter
		if retryAfter <= 0 {
			retryAfter = time.Second
		}
		if c != nil && c.Writer != nil {
			c.Header("Retry-After", strconv.Itoa(int(retryAfter.Seconds()+0.999)))
		}
		msg := i18n.T(c, i18n.MsgChannelRateLimitReached, map[string]any{
			"Max":        setting.RateLimitCount,
			"DurationMs": setting.GetRateLimitDurationMs(),
		})
		logger.LogInfo(c, fmt.Sprintf("channel %d rate limited: count=%d duration_ms=%d", channelId, setting.RateLimitCount, setting.GetRateLimitDurationMs()))
		model.RecordRejectionLog(c, model.SystemLogTypeRateLimit, "channel_rate_limit_exceeded", msg, http.StatusTooManyRequests)
		return types.NewError(errors.New(msg), types.ErrorCodeChannelRateLimited, types.ErrOptionWithSkipRetry(), types.ErrOptionWithStatusCode(http.StatusTooManyRequests))
	}
	return types.NewError(err, types.ErrorCodeChannelRateLimited, types.ErrOptionWithSkipRetry(), types.ErrOptionWithStatusCode(http.StatusInternalServerError))
}
