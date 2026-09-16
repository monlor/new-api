package claude

import (
	"encoding/json"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/setting/reasoning"
)

func isGenericThinkingEffort(effort string) bool {
	switch effort {
	case "thinking", "enabled", "adaptive":
		return true
	default:
		return false
	}
}

func effortFromOutputConfig(raw json.RawMessage) string {
	if len(raw) == 0 {
		return ""
	}
	var oc struct {
		Effort string `json:"effort"`
	}
	if err := common.Unmarshal(raw, &oc); err != nil {
		return ""
	}
	return oc.Effort
}

func considerEffort(explicit, generic *string, value string) {
	if value == "" {
		return
	}
	if isGenericThinkingEffort(value) {
		if *generic == "" {
			*generic = value
		}
		return
	}
	if *explicit == "" {
		*explicit = value
	}
}

// ApplyThinkingToRelayInfo copies Claude thinking intensity onto RelayInfo for usage logs.
func ApplyThinkingToRelayInfo(info *relaycommon.RelayInfo, request *dto.ClaudeRequest) {
	if info == nil || request == nil {
		return
	}
	if request.Thinking != nil && request.Thinking.BudgetTokens != nil {
		info.ThinkingBudget = request.Thinking.BudgetTokens
	}

	var explicit, generic string
	considerEffort(&explicit, &generic, effortFromOutputConfig(request.OutputConfig))
	if _, level, ok := reasoning.TrimEffortSuffix(info.OriginModelName); ok {
		considerEffort(&explicit, &generic, level)
	}
	if _, level, ok := reasoning.TrimEffortSuffix(request.Model); ok {
		considerEffort(&explicit, &generic, level)
	}
	if strings.Contains(info.OriginModelName, "-thinking") {
		considerEffort(&explicit, &generic, "thinking")
	}
	if strings.Contains(request.Model, "-thinking") {
		considerEffort(&explicit, &generic, "thinking")
	}
	if request.Thinking != nil {
		considerEffort(&explicit, &generic, request.Thinking.Type)
	}

	chosen := explicit
	if chosen == "" {
		chosen = generic
	}
	if chosen == "" {
		if info.ReasoningEffort == "" {
			info.ReasoningEffort = reasoning.EffortFromModelName(info.OriginModelName)
		}
		return
	}
	if info.ReasoningEffort == "" || (isGenericThinkingEffort(info.ReasoningEffort) && explicit != "") {
		info.ReasoningEffort = chosen
	}
}
