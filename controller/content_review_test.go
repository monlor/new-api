package controller

import (
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/service"
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
	t.Cleanup(func() {
		model.DB, model.LOG_DB = oldDB, oldLogDB
		common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL, common.RedisEnabled = oldSQLite, oldMySQL, oldPG, oldRedis
		constant.ErrorLogEnabled = oldErrorLogEnabled
	})

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
	if err := db.AutoMigrate(&model.User{}, &model.Log{}); err != nil {
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
