package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
	"github.com/QuantumNous/new-api/middleware"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/relay"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/relay/helper"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"github.com/samber/lo"
	"github.com/tidwall/gjson"
)

func shouldContentReviewFormat(relayFormat types.RelayFormat) bool {
	switch relayFormat {
	case types.RelayFormatEmbedding, types.RelayFormatRerank, types.RelayFormatOpenAIRealtime,
		types.RelayFormatOpenAIAudio, types.RelayFormatTask, types.RelayFormatMjProxy:
		return false
	default:
		return true
	}
}

func reviewUserPrompt(c *gin.Context, request dto.Request, meta *types.TokenCountMeta, relayFormat types.RelayFormat) *types.NewAPIError {
	if c == nil || !shouldContentReviewFormat(relayFormat) {
		return nil
	}
	cfg := setting.GetContentReviewSetting()
	if cfg == nil {
		return nil
	}
	mode := cfg.ReviewMode()
	if mode == setting.ContentReviewModeOff {
		return nil
	}
	if strings.TrimSpace(cfg.Model) == "" {
		logger.LogWarn(c, "content review enabled but no model is configured")
		return nil
	}

	text := service.ExtractContentReviewText(request, meta, cfg.ReviewMaxInputChars())
	if text == "" {
		return nil
	}
	payload := service.WrapContentReviewInput(text)
	userId := c.GetInt("id")
	snap := *cfg

	if mode == setting.ContentReviewModeAsync {
		gopool.Go(func() {
			if _, err := runContentReviewJob(context.Background(), &snap, userId, payload, false); err != nil {
				common.SysLog(fmt.Sprintf("async content review failed for user %d: %s", userId, err.Error()))
			}
		})
		return nil
	}

	result, err := runContentReviewJob(c.Request.Context(), &snap, userId, payload, true)
	if err != nil {
		logger.LogWarn(c, fmt.Sprintf("content review failed: %s", err.Error()))
		if snap.FailOpen {
			return nil
		}
		apiErr := newContentReviewBlockedError(snap.ReviewBlockMessage())
		recordContentReviewBlockedLog(c, apiErr, nil, err)
		return apiErr
	}
	if result != nil && result.ShouldBlock {
		logger.LogWarn(c, fmt.Sprintf("content review blocked request: confidence=%.2f reason=%s", result.Confidence, result.Reason))
		apiErr := newContentReviewBlockedError(snap.ReviewBlockMessage())
		recordContentReviewBlockedLog(c, apiErr, result, nil)
		return apiErr
	}
	return nil
}

func newContentReviewBlockedError(message string) *types.NewAPIError {
	return types.NewErrorWithStatusCode(
		errors.New(message),
		types.ErrorCodeContentReviewBlocked,
		http.StatusForbidden,
		types.ErrOptionWithSkipRetry(),
	)
}

func formatContentReviewBlockLog(statusCode int, result *contentReviewJobResult) string {
	if result == nil {
		return fmt.Sprintf("status_code=%d, content review unavailable, request blocked", statusCode)
	}
	return fmt.Sprintf("status_code=%d, content review blocked (confidence=%.2f)", statusCode, result.Confidence)
}

func contentReviewRejectReason(result *contentReviewJobResult, reviewErr error) string {
	if result != nil {
		return truncateContentReviewReason(strings.TrimSpace(result.Reason))
	}
	if reviewErr != nil {
		return truncateContentReviewReason(common.MaskSensitiveInfo(reviewErr.Error()))
	}
	return ""
}

func truncateContentReviewReason(reason string) string {
	const maxRunes = 200
	runes := []rune(reason)
	if len(runes) <= maxRunes {
		return reason
	}
	return string(runes[:maxRunes])
}

func recordContentReviewBlockedLog(c *gin.Context, err *types.NewAPIError, result *contentReviewJobResult, reviewErr error) {
	if c == nil || err == nil {
		return
	}
	extra := map[string]interface{}{
		"content_review": true,
	}
	if result == nil {
		extra["content_review_failed"] = true
	} else {
		extra["confidence"] = result.Confidence
	}
	reason := contentReviewRejectReason(result, reviewErr)
	if reason == "" && result == nil {
		reason = "content review unavailable"
	}
	if reason != "" {
		extra["reject_reason"] = reason
	}
	recordRelayErrorLog(c, err, formatContentReviewBlockLog(err.StatusCode, result), extra)
}

type contentReviewJobResult struct {
	service.ContentReviewResult
	service.ContentReviewDecision
}

func runContentReviewJob(parent context.Context, cfg *setting.ContentReviewSetting, userId int, payload string, allowBlock bool) (*contentReviewJobResult, error) {
	content, err := callContentReviewModel(parent, cfg, payload)
	if err != nil {
		return nil, err
	}
	parsed, err := service.ParseContentReviewResult(content)
	if err != nil {
		return nil, err
	}
	decision := service.DecideContentReview(
		parsed,
		cfg.FlagEnabled,
		cfg.ReviewFlagThreshold(),
		allowBlock,
		cfg.ReviewBlockThreshold(),
	)
	if decision.ShouldFlag {
		if markErr := model.MarkUserHighRisk(userId, parsed.Reason, parsed.Confidence); markErr != nil {
			common.SysLog(fmt.Sprintf("failed to mark user %d as high risk: %s", userId, markErr.Error()))
		} else {
			common.SysLog(fmt.Sprintf("content review flagged user %d: confidence=%.2f reason=%s", userId, parsed.Confidence, parsed.Reason))
		}
	}
	return &contentReviewJobResult{ContentReviewResult: parsed, ContentReviewDecision: decision}, nil
}

func callContentReviewModel(parent context.Context, cfg *setting.ContentReviewSetting, userPayload string) (string, error) {
	timeout := cfg.ReviewTimeout()
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	type outcome struct {
		content string
		err     error
	}
	ch := make(chan outcome, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				ch <- outcome{err: fmt.Errorf("content review panic: %v", r)}
			}
		}()
		content, err := callContentReviewModelOnce(ctx, cfg, userPayload)
		ch <- outcome{content, err}
	}()
	select {
	case <-ctx.Done():
		return "", ctx.Err()
	case out := <-ch:
		return out.content, out.err
	}
}

func callContentReviewModelOnce(ctx context.Context, cfg *setting.ContentReviewSetting, userPayload string) (string, error) {
	modelName := strings.TrimSpace(cfg.Model)
	channel, group, err := model.GetEnabledChannelByModel(modelName, cfg.Group)
	if err != nil {
		return "", err
	}

	w := httptest.NewRecorder()
	reviewCtx, _ := gin.CreateTestContext(w)
	reviewCtx.Request = (&http.Request{
		Method: http.MethodPost,
		URL:    &url.URL{Path: "/v1/chat/completions"},
		Body:   http.NoBody,
		Header: make(http.Header),
	}).WithContext(ctx)
	reviewCtx.Request.Header.Set("Content-Type", "application/json")

	testUserID, userErr := resolveChannelTestUserID(nil)
	if userErr != nil {
		return "", userErr
	}
	cache, cacheErr := model.GetUserCache(testUserID)
	if cacheErr != nil {
		return "", cacheErr
	}
	cache.WriteContext(reviewCtx)
	reviewCtx.Set("id", testUserID)
	if group == "" {
		group, _ = model.GetUserGroup(testUserID, false)
	}
	reviewCtx.Set("group", group)
	common.SetContextKey(reviewCtx, constant.ContextKeyUsingGroup, group)

	if setupErr := middleware.SetupContextForSelectedChannel(reviewCtx, channel, modelName); setupErr != nil {
		return "", setupErr
	}

	maxTokens := uint(512)
	req := &dto.GeneralOpenAIRequest{
		Model:       modelName,
		Stream:      lo.ToPtr(false),
		Temperature: lo.ToPtr(0.0),
		Messages: []dto.Message{
			{Role: "system", Content: cfg.ReviewPrompt()},
			{Role: "user", Content: userPayload},
		},
	}
	if dto.IsOpenAIReasoningOModel(modelName) || dto.IsOpenAIGPT5Model(modelName) {
		req.MaxCompletionTokens = lo.ToPtr(maxTokens)
	} else {
		req.MaxTokens = lo.ToPtr(maxTokens)
	}

	info, genErr := relaycommon.GenRelayInfo(reviewCtx, types.RelayFormatOpenAI, req, nil)
	if genErr != nil {
		return "", genErr
	}
	info.IsChannelTest = true
	info.InitChannelMeta(reviewCtx)

	if mapErr := helper.ModelMappedHelper(reviewCtx, info, req); mapErr != nil {
		return "", mapErr
	}
	req.SetModelName(info.UpstreamModelName)

	apiType, _ := common.ChannelType2APIType(channel.Type)
	adaptor := relay.GetAdaptor(apiType)
	if adaptor == nil {
		return "", fmt.Errorf("invalid api type: %d", apiType)
	}
	adaptor.Init(info)

	convertedRequest, convErr := adaptor.ConvertOpenAIRequest(reviewCtx, info, req)
	if convErr != nil {
		return "", convErr
	}
	jsonData, marshalErr := common.Marshal(convertedRequest)
	if marshalErr != nil {
		return "", marshalErr
	}
	if len(info.ParamOverride) > 0 {
		jsonData, marshalErr = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
		if marshalErr != nil {
			return "", marshalErr
		}
	}

	reviewCtx.Request.Body = io.NopCloser(bytes.NewBuffer(jsonData))
	resp, doErr := adaptor.DoRequest(reviewCtx, info, bytes.NewBuffer(jsonData))
	if doErr != nil {
		return "", doErr
	}
	var httpResp *http.Response
	if resp != nil {
		typedResp, ok := resp.(*http.Response)
		if !ok {
			return "", errors.New("unexpected review response type")
		}
		httpResp = typedResp
		if httpResp.StatusCode != http.StatusOK {
			relayErr := service.RelayErrorHandler(ctx, httpResp, true)
			if relayErr != nil {
				return "", relayErr
			}
			return "", fmt.Errorf("review model status %d", httpResp.StatusCode)
		}
	}

	if _, respErr := adaptor.DoResponse(reviewCtx, httpResp, info); respErr != nil {
		return "", respErr
	}
	content := extractReviewModelContent(w.Body.Bytes())
	if content == "" {
		return "", errors.New("empty review model content")
	}
	return content, nil
}

func extractReviewModelContent(body []byte) string {
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 {
		return ""
	}
	for _, path := range []string{
		"choices.0.message.content",
		"choices.0.text",
		"output_text",
		"content.0.text",
		"candidates.0.content.parts.0.text",
	} {
		value := gjson.GetBytes(trimmed, path)
		if value.Exists() {
			text := strings.TrimSpace(value.String())
			if text != "" {
				return text
			}
		}
	}
	if gjson.GetBytes(trimmed, "confidence").Exists() {
		return string(trimmed)
	}
	return strings.TrimSpace(string(trimmed))
}
