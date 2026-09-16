package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/gin-gonic/gin"
)

func TestGenerateTextOtherInfoReasoningFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	info := &relaycommon.RelayInfo{
		ChannelMeta:     &relaycommon.ChannelMeta{},
		ReasoningEffort: "high",
		ThinkingBudget:  common.GetPointer(5324),
	}

	other := GenerateTextOtherInfo(c, info, 1, 1, 1, 0, 0, 0, 1)
	if got, ok := other["reasoning_effort"].(string); !ok || got != "high" {
		t.Fatalf("reasoning_effort = %v, want high", other["reasoning_effort"])
	}
	budget, ok := other["thinking_budget"].(int)
	if !ok || budget != 5324 {
		t.Fatalf("thinking_budget = %v (%T), want 5324", other["thinking_budget"], other["thinking_budget"])
	}
}

func TestGenerateTextOtherInfoOmitsEmptyReasoningFields(t *testing.T) {
	gin.SetMode(gin.TestMode)
	c, _ := gin.CreateTestContext(httptest.NewRecorder())

	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{},
	}
	other := GenerateTextOtherInfo(c, info, 1, 1, 1, 0, 0, 0, 1)
	if _, ok := other["reasoning_effort"]; ok {
		t.Fatalf("reasoning_effort should be omitted when empty")
	}
	if _, ok := other["thinking_budget"]; ok {
		t.Fatalf("thinking_budget should be omitted when nil")
	}
}
