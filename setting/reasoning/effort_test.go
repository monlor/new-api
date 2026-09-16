package reasoning

import (
	"encoding/json"
	"testing"
)

func TestEffortFromModelName(t *testing.T) {
	tests := []struct {
		model string
		want  string
	}{
		{"deepseek-v4-pro-max", "max"},
		{"deepseek-v4-pro-none", "none"},
		{"claude-opus-4-6-high", "high"},
		{"claude-opus-4-6-max", "max"},
		{"o3-mini-xhigh", "xhigh"},
		{"o3-mini-none", "none"},
		{"gpt-5-minimal", "minimal"},
		{"gemini-2.5-flash-nothinking", "none"},
		{"claude-sonnet-4-thinking", "thinking"},
		{"gemini-2.5-pro-thinking-5324", "thinking"},
		{"gpt-4o", ""},
		{"", ""},
	}
	for _, tt := range tests {
		if got := EffortFromModelName(tt.model); got != tt.want {
			t.Errorf("EffortFromModelName(%q) = %q, want %q", tt.model, got, tt.want)
		}
	}
}

func TestThinkingBudgetFromModelName(t *testing.T) {
	if got := ThinkingBudgetFromModelName("gemini-2.5-pro-thinking-5324"); got == nil || *got != 5324 {
		t.Fatalf("expected 5324, got %v", got)
	}
	if got := ThinkingBudgetFromModelName("gemini-2.5-pro-thinking"); got != nil {
		t.Fatalf("expected nil for suffix-only thinking, got %v", *got)
	}
	if got := ThinkingBudgetFromModelName("gemini-2.5-pro-thinking-5324-extra"); got != nil {
		t.Fatalf("expected nil for non-integer suffix, got %v", got)
	}
	if got := ThinkingBudgetFromModelName("gpt-4o"); got != nil {
		t.Fatalf("expected nil, got %v", got)
	}
}

func TestEffortFromOpenAIChat(t *testing.T) {
	if got := EffortFromOpenAIChat("o3-mini", "low", nil); got != "low" {
		t.Fatalf("field should win, got %q", got)
	}
	raw := json.RawMessage(`{"effort":"high","enabled":true}`)
	if got := EffortFromOpenAIChat("o3-mini", "", raw); got != "high" {
		t.Fatalf("reasoning JSON effort should win, got %q", got)
	}
	if got := EffortFromOpenAIChat("o3-mini-medium", "", nil); got != "medium" {
		t.Fatalf("model suffix fallback, got %q", got)
	}
	if got := EffortFromOpenAIChat("o3-mini", "", json.RawMessage(`not-json`)); got != "" {
		t.Fatalf("invalid JSON should fall through to empty model, got %q", got)
	}
}
