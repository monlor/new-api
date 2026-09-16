package gemini

import (
	"encoding/json"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/model_setting"
	"github.com/stretchr/testify/require"
)

func TestCovertOpenAI2GeminiExtraBodyThinking(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-2.5-pro",
		},
		OriginModelName: "gemini-2.5-pro",
	}
	req := dto.GeneralOpenAIRequest{
		Model: "gemini-2.5-pro",
		ExtraBody: json.RawMessage(
			`{"google":{"thinking_config":{"thinking_budget":5324,"include_thoughts":true,"thinking_level":"high"}}}`,
		),
		Messages: []dto.Message{
			{Role: "user", Content: "hello"},
		},
	}
	_, err := CovertOpenAI2Gemini(nil, req, info)
	require.NoError(t, err)
	require.Equal(t, "high", info.ReasoningEffort)
	require.NotNil(t, info.ThinkingBudget)
	require.Equal(t, 5324, *info.ThinkingBudget)
}

func TestApplyThinkingToRelayInfoBudgetZeroIsNone(t *testing.T) {
	info := &relaycommon.RelayInfo{OriginModelName: "gemini-2.5-flash"}
	req := &dto.GeminiChatRequest{
		GenerationConfig: dto.GeminiChatGenerationConfig{
			ThinkingConfig: &dto.GeminiThinkingConfig{
				ThinkingBudget: common.GetPointer(0),
			},
		},
	}
	ApplyThinkingToRelayInfo(info, req)
	require.Equal(t, "none", info.ReasoningEffort)
	require.Equal(t, 0, *info.ThinkingBudget)
}

func TestThinkingAdaptorSuffixSetsBudgetAndEffort(t *testing.T) {
	settings := model_setting.GetGeminiSettings()
	prev := settings.ThinkingAdapterEnabled
	settings.ThinkingAdapterEnabled = true
	t.Cleanup(func() { settings.ThinkingAdapterEnabled = prev })

	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			UpstreamModelName: "gemini-2.5-flash-thinking-4096",
		},
		OriginModelName: "gemini-2.5-flash-thinking-4096",
	}
	req := &dto.GeminiChatRequest{}
	ThinkingAdaptor(req, info)
	ApplyThinkingToRelayInfo(info, req)
	require.Equal(t, "thinking", info.ReasoningEffort)
	require.NotNil(t, info.ThinkingBudget)
	require.Equal(t, 4096, *info.ThinkingBudget)
}
