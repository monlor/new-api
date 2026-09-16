package reasoning

import (
	"encoding/json"
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
)

// EffortFromModelName extracts a thinking-intensity label from a model name suffix.
func EffortFromModelName(modelName string) string {
	if modelName == "" {
		return ""
	}
	if _, _, effort, ok := ParseDeepSeekV4ThinkingSuffix(modelName); ok && effort != "" {
		return effort
	}
	if _, level, ok := TrimEffortSuffix(modelName); ok && level != "" {
		return level
	}
	if effort, _ := ParseOpenAIReasoningEffortFromModelSuffix(modelName); effort != "" {
		return effort
	}
	if strings.HasSuffix(modelName, "-nothinking") {
		return "none"
	}
	if strings.HasSuffix(modelName, "-thinking") || strings.Contains(modelName, "-thinking-") {
		return "thinking"
	}
	return ""
}

// ThinkingBudgetFromModelName returns a Gemini-style budget from names like model-thinking-5324.
func ThinkingBudgetFromModelName(modelName string) *int {
	const marker = "-thinking-"
	idx := strings.Index(modelName, marker)
	if idx < 0 {
		return nil
	}
	part := modelName[idx+len(marker):]
	if part == "" {
		return nil
	}
	budget, err := strconv.Atoi(part)
	if err != nil {
		return nil
	}
	return &budget
}

// EffortFromOpenAIChat prefers an explicit reasoning_effort field, then reasoning JSON, then the model name.
func EffortFromOpenAIChat(model, reasoningEffort string, reasoning json.RawMessage) string {
	if reasoningEffort != "" {
		return reasoningEffort
	}
	if len(reasoning) > 0 {
		var parsed struct {
			Effort string `json:"effort"`
		}
		if err := common.Unmarshal(reasoning, &parsed); err == nil && parsed.Effort != "" {
			return parsed.Effort
		}
	}
	return EffortFromModelName(model)
}
