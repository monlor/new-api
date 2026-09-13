package controller

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
	"github.com/QuantumNous/new-api/setting"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/glebarez/sqlite"
	"gorm.io/gorm"
)

func TestExtractReviewModelContent(t *testing.T) {
	tests := []struct {
		name string
		body string
		want string
	}{
		{
			name: "openai chat",
			body: `{"choices":[{"message":{"content":"{\"confidence\":0.12,\"reason\":\"\"}"}}]}`,
			want: `{"confidence":0.12,"reason":""}`,
		},
		{
			name: "raw confidence json",
			body: `{"confidence":0.9,"reason":"scan"}`,
			want: `{"confidence":0.9,"reason":"scan"}`,
		},
		{
			name: "empty",
			body: "   ",
			want: "",
		},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := extractReviewModelContent([]byte(tt.body))
			if got != tt.want {
				t.Fatalf("got %q want %q", got, tt.want)
			}
		})
	}
}

func TestFormatContentReviewBlockLog(t *testing.T) {
	t.Run("fail closed", func(t *testing.T) {
		got := formatContentReviewBlockLog(http.StatusForbidden, nil)
		if got != "status_code=403, content review unavailable, request blocked" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("blocked with reason", func(t *testing.T) {
		got := formatContentReviewBlockLog(http.StatusForbidden, &contentReviewJobResult{
			ContentReviewResult: service.ContentReviewResult{Confidence: 0.91, Reason: " harassment "},
		})
		if got != "status_code=403, content review blocked (confidence=0.91)" {
			t.Fatalf("got %q", got)
		}
	})
	t.Run("blocked without reason", func(t *testing.T) {
		got := formatContentReviewBlockLog(http.StatusForbidden, &contentReviewJobResult{
			ContentReviewResult: service.ContentReviewResult{Confidence: 0.8},
		})
		if got != "status_code=403, content review blocked (confidence=0.80)" {
			t.Fatalf("got %q", got)
		}
	})
}

func setupContentReviewLogTestDB(t *testing.T) {
	t.Helper()
	gin.SetMode(gin.TestMode)

	oldDB, oldLogDB := model.DB, model.LOG_DB
	oldSQLite, oldMySQL, oldPG, oldRedis := common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL, common.RedisEnabled
	oldErrorLogEnabled := constant.ErrorLogEnabled

	common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL, common.RedisEnabled = true, false, false, false
	constant.ErrorLogEnabled = false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	model.DB, model.LOG_DB = db, db
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatalf("sql db: %v", err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL, common.RedisEnabled = oldSQLite, oldMySQL, oldPG, oldRedis
		constant.ErrorLogEnabled = oldErrorLogEnabled
	})
	if err := db.AutoMigrate(&model.User{}, &model.Log{}, &model.ContentReviewLog{}); err != nil {
		t.Fatalf("migrate: %v", err)
	}
}

func TestTruncateContentReviewReason(t *testing.T) {
	if got := truncateContentReviewReason("short"); got != "short" {
		t.Fatalf("got %q", got)
	}
	long := strings.Repeat("拦截", 201)
	got := truncateContentReviewReason(long)
	if len([]rune(got)) != 200 {
		t.Fatalf("len=%d", len([]rune(got)))
	}
}

func TestRecordContentReviewBlockedLog(t *testing.T) {
	setupContentReviewLogTestDB(t)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", http.NoBody)
	c.Set("id", 42)
	c.Set("username", "blocked-user")
	c.Set("token_name", "tok")
	c.Set("token_id", 7)
	c.Set("original_model", "gpt-4")
	c.Set("group", "default")
	c.Set(common.RequestIdKey, "req-content-review")

	apiErr := newContentReviewBlockedError("blocked")
	recordContentReviewBlockedLog(c, apiErr, &contentReviewJobResult{
		ContentReviewResult: service.ContentReviewResult{Confidence: 0.93, Reason: "cyber abuse"},
	}, nil)

	var log model.Log
	if err := model.LOG_DB.Where("request_id = ?", "req-content-review").First(&log).Error; err != nil {
		t.Fatalf("expected error log, got %v", err)
	}
	if log.Type != model.LogTypeError {
		t.Fatalf("type=%d want %d", log.Type, model.LogTypeError)
	}
	if log.UserId != 42 {
		t.Fatalf("userId=%d", log.UserId)
	}
	if log.ModelName != "gpt-4" {
		t.Fatalf("model=%s", log.ModelName)
	}
	if !strings.Contains(log.Content, "content review blocked") {
		t.Fatalf("content=%q", log.Content)
	}
	if strings.Contains(log.Content, "cyber abuse") {
		t.Fatalf("user-visible content should not include reject reason: %q", log.Content)
	}
	other, err := common.StrToMap(log.Other)
	if err != nil {
		t.Fatalf("parse other: %v", err)
	}
	if other["content_review"] != true {
		t.Fatalf("other.content_review=%v", other["content_review"])
	}
	if other["reject_reason"] != "cyber abuse" {
		t.Fatalf("other.reject_reason=%v", other["reject_reason"])
	}
	if other["confidence"] != 0.93 {
		t.Fatalf("other.confidence=%v", other["confidence"])
	}
	if other["error_code"] != string(types.ErrorCodeContentReviewBlocked) {
		t.Fatalf("other.error_code=%v", other["error_code"])
	}
}

func TestRecordContentReviewBlockedLogFailClosed(t *testing.T) {
	setupContentReviewLogTestDB(t)

	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodPost, "/v1/chat/completions", http.NoBody)
	c.Set("id", 9)
	c.Set("username", "fail-closed-user")
	c.Set(common.RequestIdKey, "req-content-review-fail")

	recordContentReviewBlockedLog(c, newContentReviewBlockedError("blocked"), nil, errors.New("review model timeout"))

	var log model.Log
	if err := model.LOG_DB.Where("request_id = ?", "req-content-review-fail").First(&log).Error; err != nil {
		t.Fatalf("expected error log, got %v", err)
	}
	if log.Type != model.LogTypeError {
		t.Fatalf("type=%d want %d", log.Type, model.LogTypeError)
	}
	if !strings.Contains(log.Content, "content review unavailable") {
		t.Fatalf("content=%q", log.Content)
	}
	other, err := common.StrToMap(log.Other)
	if err != nil {
		t.Fatalf("parse other: %v", err)
	}
	if other["content_review"] != true {
		t.Fatalf("other.content_review=%v", other["content_review"])
	}
	if other["content_review_failed"] != true {
		t.Fatalf("other.content_review_failed=%v", other["content_review_failed"])
	}
	if other["reject_reason"] != "review model timeout" {
		t.Fatalf("other.reject_reason=%v", other["reject_reason"])
	}
}

func TestShouldRecordContentReviewLog(t *testing.T) {
	if !shouldRecordContentReviewLog(model.ContentReviewDecisionFlag, 0) {
		t.Fatal("flag must always be recorded")
	}
	if !shouldRecordContentReviewLog(model.ContentReviewDecisionBlock, 0) {
		t.Fatal("block must always be recorded")
	}
	if !shouldRecordContentReviewLog(model.ContentReviewDecisionError, 0) {
		t.Fatal("error must always be recorded")
	}
	if shouldRecordContentReviewLog(model.ContentReviewDecisionPass, 0) {
		t.Fatal("pass with sample rate 0 must be skipped")
	}
	if !shouldRecordContentReviewLog(model.ContentReviewDecisionPass, 1) {
		t.Fatal("pass with sample rate 1 must be recorded")
	}
}

func TestRecordContentReviewObservabilityLogPass(t *testing.T) {
	setupContentReviewLogTestDB(t)

	cfg := &setting.ContentReviewSetting{PassSampleRate: 1, Model: "review-model"}
	recordContentReviewObservabilityLog(
		contentReviewLogMeta{
			UserId:        7,
			Username:      "alice",
			RequestId:     "req-pass",
			OriginalModel: "gpt-4",
			Mode:          setting.ContentReviewModeAsync,
			InputPreview:  "hello",
		},
		cfg,
		&service.ContentReviewResult{Confidence: 0.12, Reason: ""},
		service.ContentReviewDecision{},
		&contentReviewModelCall{
			PromptTokens:     80,
			CompletionTokens: 20,
			EstimatedQuota:   12,
			ChannelId:        3,
			ReviewModel:      "review-model",
			UseTimeMs:        140,
		},
		nil,
	)

	var log model.ContentReviewLog
	if err := model.LOG_DB.Where("request_id = ?", "req-pass").First(&log).Error; err != nil {
		t.Fatalf("expected review log, got %v", err)
	}
	if log.Decision != model.ContentReviewDecisionPass {
		t.Fatalf("decision=%s", log.Decision)
	}
	if log.UserId != 7 || log.Username != "alice" {
		t.Fatalf("user=%d/%s", log.UserId, log.Username)
	}
	if log.PromptTokens != 80 || log.CompletionTokens != 20 || log.EstimatedQuota != 12 {
		t.Fatalf("usage tokens=%d/%d quota=%d", log.PromptTokens, log.CompletionTokens, log.EstimatedQuota)
	}
	if log.OriginalModel != "gpt-4" || log.ReviewModel != "review-model" {
		t.Fatalf("models original=%s review=%s", log.OriginalModel, log.ReviewModel)
	}
	if log.Failed {
		t.Fatal("pass log should not be marked failed")
	}
	if log.InputPreview != "hello" {
		t.Fatalf("preview=%q", log.InputPreview)
	}
}

func TestRecordContentReviewObservabilityLogSkipPassSample(t *testing.T) {
	setupContentReviewLogTestDB(t)

	cfg := &setting.ContentReviewSetting{PassSampleRate: 0, Model: "review-model"}
	recordContentReviewObservabilityLog(
		contentReviewLogMeta{UserId: 1, RequestId: "req-skip"},
		cfg,
		&service.ContentReviewResult{Confidence: 0.01},
		service.ContentReviewDecision{},
		&contentReviewModelCall{ReviewModel: "review-model"},
		nil,
	)

	var count int64
	if err := model.LOG_DB.Model(&model.ContentReviewLog{}).Count(&count).Error; err != nil {
		t.Fatalf("count: %v", err)
	}
	if count != 0 {
		t.Fatalf("count=%d want 0", count)
	}
}

func TestRecordContentReviewObservabilityLogError(t *testing.T) {
	setupContentReviewLogTestDB(t)

	recordContentReviewObservabilityLog(
		contentReviewLogMeta{UserId: 2, RequestId: "req-error", Mode: setting.ContentReviewModeBlock},
		&setting.ContentReviewSetting{PassSampleRate: 0, Model: "review-model"},
		nil,
		service.ContentReviewDecision{},
		nil,
		errors.New("review model timeout"),
	)

	var log model.ContentReviewLog
	if err := model.LOG_DB.Where("request_id = ?", "req-error").First(&log).Error; err != nil {
		t.Fatalf("expected review log, got %v", err)
	}
	if log.Decision != model.ContentReviewDecisionError {
		t.Fatalf("decision=%s", log.Decision)
	}
	if !log.Failed {
		t.Fatal("expected failed")
	}
	if log.FailMessage != "review model timeout" {
		t.Fatalf("fail_message=%q", log.FailMessage)
	}
	if log.ReviewModel != "review-model" {
		t.Fatalf("review_model=%s", log.ReviewModel)
	}
}

func TestDeleteOldContentReviewLogPassOnly(t *testing.T) {
	setupContentReviewLogTestDB(t)

	now := common.GetTimestamp()
	old := now - 3600
	logs := []*model.ContentReviewLog{
		{CreatedAt: old, Decision: model.ContentReviewDecisionPass, RequestId: "old-pass"},
		{CreatedAt: old, Decision: model.ContentReviewDecisionBlock, RequestId: "old-block"},
		{CreatedAt: now, Decision: model.ContentReviewDecisionPass, RequestId: "new-pass"},
	}
	for _, log := range logs {
		if err := model.LOG_DB.Create(log).Error; err != nil {
			t.Fatalf("create: %v", err)
		}
	}

	count, err := model.DeleteOldContentReviewLog(t.Context(), now-10, 100, model.ContentReviewDecisionPass)
	if err != nil {
		t.Fatalf("delete: %v", err)
	}
	if count != 1 {
		t.Fatalf("count=%d want 1", count)
	}
	var remaining []model.ContentReviewLog
	if err := model.LOG_DB.Order("id").Find(&remaining).Error; err != nil {
		t.Fatalf("find: %v", err)
	}
	if len(remaining) != 2 {
		t.Fatalf("remaining=%d", len(remaining))
	}
}

func TestDeleteHistoryLogsAlsoClearsContentReviewLogs(t *testing.T) {
	setupContentReviewLogTestDB(t)

	now := common.GetTimestamp()
	if err := model.LOG_DB.Create(&model.Log{CreatedAt: now - 100, Type: model.LogTypeConsume, Content: "old"}).Error; err != nil {
		t.Fatalf("create log: %v", err)
	}
	if err := model.LOG_DB.Create(&model.ContentReviewLog{CreatedAt: now - 100, Decision: model.ContentReviewDecisionPass}).Error; err != nil {
		t.Fatalf("create review log: %v", err)
	}

	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(http.MethodDelete, fmt.Sprintf("/api/log/?target_timestamp=%d", now-10), nil)

	DeleteHistoryLogs(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d body=%s", recorder.Code, recorder.Body.String())
	}

	var logCount, reviewCount int64
	if err := model.LOG_DB.Model(&model.Log{}).Count(&logCount).Error; err != nil {
		t.Fatalf("log count: %v", err)
	}
	if err := model.LOG_DB.Model(&model.ContentReviewLog{}).Count(&reviewCount).Error; err != nil {
		t.Fatalf("review count: %v", err)
	}
	if logCount != 0 || reviewCount != 0 {
		t.Fatalf("logCount=%d reviewCount=%d", logCount, reviewCount)
	}
}

func TestCleanupExpiredLogsDeletesUsageAndReviewTogether(t *testing.T) {
	setupContentReviewLogTestDB(t)

	now := time.Now()
	old := now.Add(-48 * time.Hour).Unix()
	recent := now.Unix()
	records := []struct {
		log    model.Log
		review model.ContentReviewLog
	}{
		{
			log:    model.Log{CreatedAt: old, Type: model.LogTypeConsume, Content: "old-usage"},
			review: model.ContentReviewLog{CreatedAt: old, Decision: model.ContentReviewDecisionPass, RequestId: "old-review"},
		},
		{
			log:    model.Log{CreatedAt: recent, Type: model.LogTypeConsume, Content: "new-usage"},
			review: model.ContentReviewLog{CreatedAt: recent, Decision: model.ContentReviewDecisionBlock, RequestId: "new-review"},
		},
	}
	for _, record := range records {
		if err := model.LOG_DB.Create(&record.log).Error; err != nil {
			t.Fatalf("create log: %v", err)
		}
		if err := model.LOG_DB.Create(&record.review).Error; err != nil {
			t.Fatalf("create review log: %v", err)
		}
	}

	logCount, reviewCount, err := model.CleanupExpiredLogs(t.Context(), 0)
	if err != nil {
		t.Fatalf("retention 0: %v", err)
	}
	if logCount != 0 || reviewCount != 0 {
		t.Fatalf("retention 0 deleted logCount=%d reviewCount=%d", logCount, reviewCount)
	}

	logCount, reviewCount, err = model.CleanupExpiredLogs(t.Context(), 1)
	if err != nil {
		t.Fatalf("cleanup: %v", err)
	}
	if logCount != 1 || reviewCount != 1 {
		t.Fatalf("logCount=%d reviewCount=%d want 1,1", logCount, reviewCount)
	}

	var remainingLogs []model.Log
	if err := model.LOG_DB.Find(&remainingLogs).Error; err != nil {
		t.Fatalf("find logs: %v", err)
	}
	if len(remainingLogs) != 1 || remainingLogs[0].Content != "new-usage" {
		t.Fatalf("remaining logs=%+v", remainingLogs)
	}
	var remainingReviews []model.ContentReviewLog
	if err := model.LOG_DB.Find(&remainingReviews).Error; err != nil {
		t.Fatalf("find review logs: %v", err)
	}
	if len(remainingReviews) != 1 || remainingReviews[0].RequestId != "new-review" {
		t.Fatalf("remaining reviews=%+v", remainingReviews)
	}
}

func TestDeleteContentReviewLogsRejectsNonPassScope(t *testing.T) {
	setupContentReviewLogTestDB(t)
	gin.SetMode(gin.TestMode)
	recorder := httptest.NewRecorder()
	c, _ := gin.CreateTestContext(recorder)
	c.Request = httptest.NewRequest(
		http.MethodDelete,
		fmt.Sprintf("/api/log/content_review?target_timestamp=%d&decision=block", common.GetTimestamp()),
		nil,
	)
	DeleteContentReviewLogs(c)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status=%d", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "decision must be pass or all") {
		t.Fatalf("body=%s", recorder.Body.String())
	}
}

func TestTruncateContentReviewPreview(t *testing.T) {
	if got := truncateContentReviewPreview("  hi  "); got != "hi" {
		t.Fatalf("got %q", got)
	}
	long := strings.Repeat("审", 201)
	got := truncateContentReviewPreview(long)
	if len([]rune(got)) != 200 {
		t.Fatalf("len=%d", len([]rune(got)))
	}
}

func TestRecordContentReviewObservabilityLogOmitsPreviewForNonPass(t *testing.T) {
	setupContentReviewLogTestDB(t)

	cfg := &setting.ContentReviewSetting{PassSampleRate: 1, Model: "review-model", LogInputPreview: true}
	cases := []struct {
		requestId string
		decision  service.ContentReviewDecision
		failed    bool
		want      string
	}{
		{requestId: "req-flag", decision: service.ContentReviewDecision{ShouldFlag: true}, want: model.ContentReviewDecisionFlag},
		{requestId: "req-block", decision: service.ContentReviewDecision{ShouldFlag: true, ShouldBlock: true}, want: model.ContentReviewDecisionBlock},
		{requestId: "req-error-preview", failed: true, want: model.ContentReviewDecisionError},
	}
	for _, tc := range cases {
		var parsed *service.ContentReviewResult
		var reviewErr error
		if tc.failed {
			reviewErr = errors.New("timeout")
		} else {
			parsed = &service.ContentReviewResult{Confidence: 0.9, Reason: "csam"}
		}
		recordContentReviewObservabilityLog(
			contentReviewLogMeta{UserId: 1, RequestId: tc.requestId, InputPreview: "illegal prompt"},
			cfg,
			parsed,
			tc.decision,
			&contentReviewModelCall{ChannelId: 4, ReviewModel: "review-model"},
			reviewErr,
		)
		var log model.ContentReviewLog
		if err := model.LOG_DB.Where("request_id = ?", tc.requestId).First(&log).Error; err != nil {
			t.Fatalf("%s: %v", tc.requestId, err)
		}
		if log.Decision != tc.want {
			t.Fatalf("%s decision=%s want %s", tc.requestId, log.Decision, tc.want)
		}
		if log.InputPreview != "" {
			t.Fatalf("%s stored preview %q", tc.requestId, log.InputPreview)
		}
	}
}

func TestRecordContentReviewObservabilityLogErrorKeepsChannel(t *testing.T) {
	setupContentReviewLogTestDB(t)

	recordContentReviewObservabilityLog(
		contentReviewLogMeta{UserId: 2, RequestId: "req-timeout-channel"},
		&setting.ContentReviewSetting{PassSampleRate: 0, Model: "review-model"},
		nil,
		service.ContentReviewDecision{},
		&contentReviewModelCall{
			ChannelId:    8,
			ReviewModel:  "review-model",
			Group:        "review",
			UseTimeMs:    90,
			UsageMissing: true,
		},
		context.DeadlineExceeded,
	)

	var log model.ContentReviewLog
	if err := model.LOG_DB.Where("request_id = ?", "req-timeout-channel").First(&log).Error; err != nil {
		t.Fatalf("expected review log, got %v", err)
	}
	if log.ChannelId != 8 {
		t.Fatalf("channel=%d", log.ChannelId)
	}
	if !log.UsageMissing {
		t.Fatal("expected usage missing")
	}
	if log.UseTimeMs != 90 {
		t.Fatalf("use_time_ms=%d", log.UseTimeMs)
	}
}

func TestWaitContentReviewCallResultTimeoutKeepsPartialCall(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	ch := make(chan contentReviewCallOutcome, 1)
	go func() {
		time.Sleep(20 * time.Millisecond)
		ch <- contentReviewCallOutcome{
			call: &contentReviewModelCall{ChannelId: 9, ReviewModel: "review-model", UsageMissing: true},
			err:  context.DeadlineExceeded,
		}
	}()
	call, err := waitContentReviewCallResult(ctx, ch, nil, newContentReviewModelCall(&setting.ContentReviewSetting{Model: "fallback"}))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
	if call == nil || call.ChannelId != 9 {
		t.Fatalf("call=%+v", call)
	}
}

func TestWaitContentReviewCallResultTimeoutWithoutResult(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	ch := make(chan contentReviewCallOutcome)
	fallback := newContentReviewModelCall(&setting.ContentReviewSetting{Model: "review-model"})
	call, err := waitContentReviewCallResult(ctx, ch, nil, fallback)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
	if call == nil || call.ReviewModel != "review-model" {
		t.Fatalf("call=%+v", call)
	}
}

func TestWaitContentReviewCallResultTimeoutUsesSlot(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	ch := make(chan contentReviewCallOutcome)
	slot := &contentReviewCallSlot{}
	slot.store(&contentReviewModelCall{ChannelId: 11, ReviewModel: "review-model", UsageMissing: true})
	fallback := newContentReviewModelCall(&setting.ContentReviewSetting{Model: "fallback"})
	call, err := waitContentReviewCallResult(ctx, ch, slot, fallback)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err=%v", err)
	}
	if call == nil || call.ChannelId != 11 {
		t.Fatalf("call=%+v", call)
	}
}
