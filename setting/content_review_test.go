package setting

import (
	"strings"
	"testing"
)

func TestReviewMode(t *testing.T) {
	tests := []struct {
		name string
		cfg  ContentReviewSetting
		want string
	}{
		{name: "explicit off", cfg: ContentReviewSetting{Mode: "off", Enabled: true, BlockEnabled: true}, want: ContentReviewModeOff},
		{name: "explicit async", cfg: ContentReviewSetting{Mode: "async"}, want: ContentReviewModeAsync},
		{name: "explicit block", cfg: ContentReviewSetting{Mode: "BLOCK"}, want: ContentReviewModeBlock},
		{name: "legacy enabled+block", cfg: ContentReviewSetting{Enabled: true, BlockEnabled: true}, want: ContentReviewModeBlock},
		{name: "legacy enabled only", cfg: ContentReviewSetting{Enabled: true, BlockEnabled: false}, want: ContentReviewModeAsync},
		{name: "legacy disabled", cfg: ContentReviewSetting{}, want: ContentReviewModeOff},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.cfg.ReviewMode(); got != tt.want {
				t.Fatalf("got %q want %q", got, tt.want)
			}
		})
	}
}

func TestDefaultContentReviewPromptCoversOnlineAbuse(t *testing.T) {
	for _, term := range []string{
		"网络虐待",
		"网络霸凌",
		"骚扰",
		"6. 网络虐待",
		"虚构角色扮演",
		"讨论如何应对霸凌",
		"对 AI 助手的情绪化发泄",
		"未成年人性内容",
		"CSAM",
	} {
		if !strings.Contains(DefaultContentReviewPrompt, term) {
			t.Errorf("default prompt missing %q", term)
		}
	}
}

func TestReviewRequestSampleRate(t *testing.T) {
	if got := (*ContentReviewSetting)(nil).ReviewRequestSampleRate(); got != 1 {
		t.Fatalf("nil setting got %v", got)
	}
	if got := (&ContentReviewSetting{RequestSampleRate: 0.25}).ReviewRequestSampleRate(); got != 0.25 {
		t.Fatalf("got %v", got)
	}
	if got := (&ContentReviewSetting{RequestSampleRate: 2}).ReviewRequestSampleRate(); got != 1 {
		t.Fatalf("clamp high got %v", got)
	}
	if got := (&ContentReviewSetting{RequestSampleRate: -1}).ReviewRequestSampleRate(); got != 0 {
		t.Fatalf("clamp low got %v", got)
	}
}

func TestReviewPromptFallsBackToDefault(t *testing.T) {
	if got := (*ContentReviewSetting)(nil).ReviewPrompt(); got != DefaultContentReviewPrompt {
		t.Fatal("nil setting should use the built-in default")
	}
	if got := (&ContentReviewSetting{}).ReviewPrompt(); got != DefaultContentReviewPrompt {
		t.Fatal("empty prompt should use the built-in default")
	}
	if got := (&ContentReviewSetting{Prompt: "   \n"}).ReviewPrompt(); got != DefaultContentReviewPrompt {
		t.Fatal("whitespace prompt should use the built-in default")
	}
	if got := (&ContentReviewSetting{Prompt: "  custom  "}).ReviewPrompt(); got != "custom" {
		t.Fatalf("got %q", got)
	}
}
