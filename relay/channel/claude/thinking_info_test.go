package claude

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func TestApplyThinkingToRelayInfoPrefersOutputConfigEffort(t *testing.T) {
	info := &relaycommon.RelayInfo{OriginModelName: "claude-opus-4-8-thinking"}
	req := &dto.ClaudeRequest{
		Model:        "claude-opus-4-8",
		Thinking:     &dto.Thinking{Type: "adaptive", Display: "summarized"},
		OutputConfig: json.RawMessage(`{"effort":"high"}`),
	}
	ApplyThinkingToRelayInfo(info, req)
	require.Equal(t, "high", info.ReasoningEffort)
}

func TestApplyThinkingToRelayInfoCapturesBudgetAndThinkingSuffix(t *testing.T) {
	info := &relaycommon.RelayInfo{OriginModelName: "claude-sonnet-4-thinking"}
	budget := 2048
	req := &dto.ClaudeRequest{
		Model: "claude-sonnet-4",
		Thinking: &dto.Thinking{
			Type:         "enabled",
			BudgetTokens: &budget,
		},
	}
	ApplyThinkingToRelayInfo(info, req)
	require.Equal(t, "thinking", info.ReasoningEffort)
	require.NotNil(t, info.ThinkingBudget)
	require.Equal(t, 2048, *info.ThinkingBudget)
}

func TestConvertOpenAIRequestCapturesClaudeThinking(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ChannelMeta:     &relaycommon.ChannelMeta{},
		OriginModelName: "claude-sonnet-4",
	}
	req := &dto.GeneralOpenAIRequest{
		Model:           "claude-sonnet-4",
		ReasoningEffort: "high",
		Messages: []dto.Message{
			{Role: "user", Content: "hello"},
		},
	}
	converted, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, req)
	require.NoError(t, err)
	require.Equal(t, "high", info.ReasoningEffort)
	claudeReq, ok := converted.(*dto.ClaudeRequest)
	require.True(t, ok)
	require.NotNil(t, claudeReq.Thinking)
	require.NotNil(t, info.ThinkingBudget)
	require.Equal(t, claudeReq.Thinking.GetBudgetTokens(), *info.ThinkingBudget)
}

func TestConvertOpenAIRequestOpusThinkingCapturesHigh(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ChannelMeta:     &relaycommon.ChannelMeta{},
		OriginModelName: "claude-opus-4-8-thinking",
	}
	req := &dto.GeneralOpenAIRequest{
		Model: "claude-opus-4-8-thinking",
		Messages: []dto.Message{
			{Role: "user", Content: "hello"},
		},
	}
	_, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, req)
	require.NoError(t, err)
	require.Equal(t, "high", info.ReasoningEffort)
}

func TestApplyThinkingToRelayInfoNativeEnabled(t *testing.T) {
	info := &relaycommon.RelayInfo{OriginModelName: "claude-sonnet-4"}
	req := &dto.ClaudeRequest{
		Model: "claude-sonnet-4",
		Thinking: &dto.Thinking{
			Type:         "enabled",
			BudgetTokens: common.GetPointer(1280),
		},
	}
	ApplyThinkingToRelayInfo(info, req)
	require.Equal(t, "enabled", info.ReasoningEffort)
	require.Equal(t, 1280, *info.ThinkingBudget)
}
