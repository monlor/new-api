package controller

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"math/rand/v2"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

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
	snap := *cfg
	logMeta := buildContentReviewLogMeta(c, &snap, text)

	if mode == setting.ContentReviewModeAsync {
		gopool.Go(func() {
			if _, err := runContentReviewJob(context.Background(), &snap, logMeta, payload, false); err != nil {
				common.SysLog(fmt.Sprintf("async content review failed for user %d: %s", logMeta.UserId, err.Error()))
			}
		})
		return nil
	}

	result, err := runContentReviewJob(c.Request.Context(), &snap, logMeta, payload, true)
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

type contentReviewLogMeta struct {
	UserId        int
	Username      string
	RequestId     string
	OriginalModel string
	TokenName     string
	TokenId       int
	Group         string
	Mode          string
	InputPreview  string
}

type contentReviewModelCall struct {
	Content          string
	PromptTokens     int
	CompletionTokens int
	EstimatedQuota   int
	ChannelId        int
	ReviewModel      string
	Group            string
	UseTimeMs        int
	UsageMissing     bool
}

func buildContentReviewLogMeta(c *gin.Context, cfg *setting.ContentReviewSetting, text string) contentReviewLogMeta {
	meta := contentReviewLogMeta{}
	if c != nil {
		meta.UserId = c.GetInt("id")
		meta.Username = c.GetString("username")
		meta.RequestId = c.GetString(common.RequestIdKey)
		meta.OriginalModel = c.GetString("original_model")
		meta.TokenName = c.GetString("token_name")
		meta.TokenId = c.GetInt("token_id")
		meta.Group = c.GetString("group")
	}
	if cfg != nil {
		meta.Mode = cfg.ReviewMode()
		if cfg.LogInputPreview {
			meta.InputPreview = truncateContentReviewPreview(text)
		}
	}
	if meta.Username == "" && meta.UserId > 0 {
		meta.Username, _ = model.GetUsernameById(meta.UserId, false)
	}
	return meta
}

func truncateContentReviewPreview(text string) string {
	const maxRunes = 200
	text = strings.TrimSpace(text)
	if text == "" {
		return ""
	}
	if utf8.RuneCountInString(text) <= maxRunes {
		return text
	}
	return string([]rune(text)[:maxRunes])
}

func shouldRecordContentReviewLog(decision string, passSampleRate float64) bool {
	if decision != model.ContentReviewDecisionPass {
		return true
	}
	if passSampleRate <= 0 {
		return false
	}
	if passSampleRate >= 1 {
		return true
	}
	return rand.Float64() < passSampleRate
}

func contentReviewDecisionName(decision service.ContentReviewDecision, failed bool) string {
	if failed {
		return model.ContentReviewDecisionError
	}
	if decision.ShouldBlock {
		return model.ContentReviewDecisionBlock
	}
	if decision.ShouldFlag {
		return model.ContentReviewDecisionFlag
	}
	return model.ContentReviewDecisionPass
}

func recordContentReviewObservabilityLog(meta contentReviewLogMeta, cfg *setting.ContentReviewSetting, parsed *service.ContentReviewResult, decision service.ContentReviewDecision, call *contentReviewModelCall, reviewErr error) {
	decisionName := contentReviewDecisionName(decision, parsed == nil || reviewErr != nil)
	sampleRate := 1.0
	if cfg != nil {
		sampleRate = cfg.ReviewPassSampleRate()
	}
	if !shouldRecordContentReviewLog(decisionName, sampleRate) {
		return
	}
	log := &model.ContentReviewLog{
		UserId:        meta.UserId,
		Username:      meta.Username,
		RequestId:     meta.RequestId,
		Mode:          meta.Mode,
		Decision:      decisionName,
		OriginalModel: meta.OriginalModel,
		TokenName:     meta.TokenName,
		TokenId:       meta.TokenId,
		Group:         meta.Group,
		InputPreview:  meta.InputPreview,
		Failed:        decisionName == model.ContentReviewDecisionError,
	}
	if parsed != nil {
		log.Confidence = parsed.Confidence
		log.Reason = truncateContentReviewReason(parsed.Reason)
	}
	if decisionName != model.ContentReviewDecisionPass {
		log.InputPreview = ""
	}
	if call != nil {
		log.ReviewModel = call.ReviewModel
		log.ChannelId = call.ChannelId
		log.PromptTokens = call.PromptTokens
		log.CompletionTokens = call.CompletionTokens
		log.EstimatedQuota = call.EstimatedQuota
		log.UseTimeMs = call.UseTimeMs
		log.UsageMissing = call.UsageMissing
		if log.Group == "" {
			log.Group = call.Group
		}
	} else if cfg != nil {
		log.ReviewModel = strings.TrimSpace(cfg.Model)
	}
	if reviewErr != nil {
		log.FailMessage = truncateContentReviewReason(common.MaskSensitiveInfo(reviewErr.Error()))
	}
	model.RecordContentReviewLog(log)
}

func runContentReviewJob(parent context.Context, cfg *setting.ContentReviewSetting, meta contentReviewLogMeta, payload string, allowBlock bool) (*contentReviewJobResult, error) {
	call, err := callContentReviewModel(parent, cfg, payload)
	if err != nil {
		recordContentReviewObservabilityLog(meta, cfg, nil, service.ContentReviewDecision{}, call, err)
		return nil, err
	}
	parsed, parseErr := service.ParseContentReviewResult(call.Content)
	if parseErr != nil {
		recordContentReviewObservabilityLog(meta, cfg, nil, service.ContentReviewDecision{}, call, parseErr)
		return nil, parseErr
	}
	decision := service.DecideContentReview(
		parsed,
		cfg.FlagEnabled,
		cfg.ReviewFlagThreshold(),
		allowBlock,
		cfg.ReviewBlockThreshold(),
	)
	if decision.ShouldFlag {
		if markErr := model.MarkUserHighRisk(meta.UserId, parsed.Reason, parsed.Confidence); markErr != nil {
			common.SysLog(fmt.Sprintf("failed to mark user %d as high risk: %s", meta.UserId, markErr.Error()))
		} else {
			common.SysLog(fmt.Sprintf("content review flagged user %d: confidence=%.2f reason=%s", meta.UserId, parsed.Confidence, parsed.Reason))
		}
	}
	recordContentReviewObservabilityLog(meta, cfg, &parsed, decision, call, nil)
	return &contentReviewJobResult{ContentReviewResult: parsed, ContentReviewDecision: decision}, nil
}

const contentReviewTimeoutDrain = 100 * time.Millisecond

type contentReviewCallOutcome struct {
	call *contentReviewModelCall
	err  error
}

type contentReviewCallSlot struct {
	mu   sync.Mutex
	call contentReviewModelCall
	ok   bool
}

func (s *contentReviewCallSlot) store(call *contentReviewModelCall) {
	if s == nil || call == nil {
		return
	}
	s.mu.Lock()
	s.call = *call
	s.ok = true
	s.mu.Unlock()
}

func (s *contentReviewCallSlot) load() *contentReviewModelCall {
	if s == nil {
		return nil
	}
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.ok {
		return nil
	}
	cp := s.call
	return &cp
}

func newContentReviewModelCall(cfg *setting.ContentReviewSetting) *contentReviewModelCall {
	modelName := ""
	if cfg != nil {
		modelName = strings.TrimSpace(cfg.Model)
	}
	return &contentReviewModelCall{
		ReviewModel:  modelName,
		UsageMissing: true,
	}
}

func coalesceContentReviewCall(call, fallback *contentReviewModelCall) *contentReviewModelCall {
	if call != nil {
		return call
	}
	return fallback
}

func waitContentReviewCallResult(ctx context.Context, ch <-chan contentReviewCallOutcome, slot *contentReviewCallSlot, fallback *contentReviewModelCall) (*contentReviewModelCall, error) {
	latest := func() *contentReviewModelCall {
		return coalesceContentReviewCall(slot.load(), fallback)
	}
	select {
	case out := <-ch:
		return coalesceContentReviewCall(out.call, latest()), out.err
	default:
	}
	select {
	case out := <-ch:
		return coalesceContentReviewCall(out.call, latest()), out.err
	case <-ctx.Done():
		timer := time.NewTimer(contentReviewTimeoutDrain)
		defer timer.Stop()
		select {
		case out := <-ch:
			if out.err == nil {
				return coalesceContentReviewCall(out.call, latest()), nil
			}
			return coalesceContentReviewCall(out.call, latest()), ctx.Err()
		case <-timer.C:
			return latest(), ctx.Err()
		}
	}
}

func callContentReviewModel(parent context.Context, cfg *setting.ContentReviewSetting, userPayload string) (*contentReviewModelCall, error) {
	timeout := cfg.ReviewTimeout()
	ctx, cancel := context.WithTimeout(parent, timeout)
	defer cancel()

	slot := &contentReviewCallSlot{}
	fallback := newContentReviewModelCall(cfg)
	slot.store(fallback)
	ch := make(chan contentReviewCallOutcome, 1)
	go func() {
		defer func() {
			if r := recover(); r != nil {
				ch <- contentReviewCallOutcome{err: fmt.Errorf("content review panic: %v", r)}
			}
		}()
		call, err := callContentReviewModelOnce(ctx, cfg, userPayload, slot.store)
		ch <- contentReviewCallOutcome{call, err}
	}()
	return waitContentReviewCallResult(ctx, ch, slot, fallback)
}

func callContentReviewModelOnce(ctx context.Context, cfg *setting.ContentReviewSetting, userPayload string, report func(*contentReviewModelCall)) (*contentReviewModelCall, error) {
	started := time.Now()
	call := newContentReviewModelCall(cfg)
	publish := func() {
		if report != nil {
			report(call)
		}
	}
	defer func() {
		if call != nil && call.UseTimeMs == 0 {
			call.UseTimeMs = int(time.Since(started).Milliseconds())
		}
		publish()
	}()
	publish()
	modelName := call.ReviewModel
	channel, group, err := model.GetEnabledChannelByModel(modelName, cfg.Group)
	if err != nil {
		return call, err
	}
	call.ChannelId = channel.Id
	call.Group = group
	publish()

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
		return call, userErr
	}
	cache, cacheErr := model.GetUserCache(testUserID)
	if cacheErr != nil {
		return call, cacheErr
	}
	cache.WriteContext(reviewCtx)
	reviewCtx.Set("id", testUserID)
	if group == "" {
		group, _ = model.GetUserGroup(testUserID, false)
	}
	call.Group = group
	reviewCtx.Set("group", group)
	common.SetContextKey(reviewCtx, constant.ContextKeyUsingGroup, group)

	if setupErr := middleware.SetupContextForSelectedChannel(reviewCtx, channel, modelName); setupErr != nil {
		return call, setupErr
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
		return call, genErr
	}
	info.IsChannelTest = true
	info.InitChannelMeta(reviewCtx)

	if mapErr := helper.ModelMappedHelper(reviewCtx, info, req); mapErr != nil {
		return call, mapErr
	}
	req.SetModelName(info.UpstreamModelName)

	apiType, _ := common.ChannelType2APIType(channel.Type)
	adaptor := relay.GetAdaptor(apiType)
	if adaptor == nil {
		return call, fmt.Errorf("invalid api type: %d", apiType)
	}
	adaptor.Init(info)

	convertedRequest, convErr := adaptor.ConvertOpenAIRequest(reviewCtx, info, req)
	if convErr != nil {
		return call, convErr
	}
	jsonData, marshalErr := common.Marshal(convertedRequest)
	if marshalErr != nil {
		return call, marshalErr
	}
	if len(info.ParamOverride) > 0 {
		jsonData, marshalErr = relaycommon.ApplyParamOverrideWithRelayInfo(jsonData, info)
		if marshalErr != nil {
			return call, marshalErr
		}
	}

	reviewCtx.Request.Body = io.NopCloser(bytes.NewBuffer(jsonData))
	resp, doErr := adaptor.DoRequest(reviewCtx, info, bytes.NewBuffer(jsonData))
	if doErr != nil {
		return call, doErr
	}
	var httpResp *http.Response
	if resp != nil {
		typedResp, ok := resp.(*http.Response)
		if !ok {
			return call, errors.New("unexpected review response type")
		}
		httpResp = typedResp
		if httpResp.StatusCode != http.StatusOK {
			relayErr := service.RelayErrorHandler(ctx, httpResp, true)
			if relayErr != nil {
				return call, relayErr
			}
			return call, fmt.Errorf("review model status %d", httpResp.StatusCode)
		}
	}

	usageAny, respErr := adaptor.DoResponse(reviewCtx, httpResp, info)
	if respErr != nil {
		return call, respErr
	}
	content := extractReviewModelContent(w.Body.Bytes())
	if content == "" {
		return call, errors.New("empty review model content")
	}
	call.Content = content
	usage, usageErr := coerceTestUsage(usageAny, false, info.GetEstimatePromptTokens())
	if usageErr == nil && usage != nil {
		call.PromptTokens = usage.PromptTokens
		call.CompletionTokens = usage.CompletionTokens
		call.UsageMissing = false
		if priceData, priceErr := helper.ModelPriceHelper(reviewCtx, info, usage.PromptTokens, req.GetTokenCountMeta()); priceErr == nil {
			call.EstimatedQuota, _ = settleTestQuota(info, priceData, usage)
		}
	}
	return call, nil
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
