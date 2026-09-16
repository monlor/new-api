package openai

import (
	"testing"

	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/stretchr/testify/require"
)

func TestConvertOpenAIRequestCapturesEffortBeforeOpenRouterClear(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenRouter,
			UpstreamModelName: "some-model",
		},
		OriginModelName: "some-model",
	}
	req := &dto.GeneralOpenAIRequest{
		Model:           "some-model",
		ReasoningEffort: "high",
	}
	_, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, req)
	require.NoError(t, err)
	require.Equal(t, "high", info.ReasoningEffort)
	require.Equal(t, "", req.ReasoningEffort)
}

func TestConvertOpenAIRequestCapturesThinkingBudgetFromModelName(t *testing.T) {
	info := &relaycommon.RelayInfo{
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelType:       constant.ChannelTypeOpenAI,
			UpstreamModelName: "gemini-2.5-pro-thinking-5324",
		},
		OriginModelName: "gemini-2.5-pro-thinking-5324",
	}
	req := &dto.GeneralOpenAIRequest{Model: "gemini-2.5-pro-thinking-5324"}
	_, err := (&Adaptor{}).ConvertOpenAIRequest(nil, info, req)
	require.NoError(t, err)
	require.Equal(t, "thinking", info.ReasoningEffort)
	require.NotNil(t, info.ThinkingBudget)
	require.Equal(t, 5324, *info.ThinkingBudget)
}
