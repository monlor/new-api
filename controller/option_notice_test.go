package controller

import "testing"

func TestOptionValueToStringPreservesNoticeLanguageMap(t *testing.T) {
	value, err := optionValueToString(map[string]interface{}{"en": "English", "zh": "中文"})
	if err != nil {
		t.Fatalf("unexpected conversion error: %v", err)
	}
	if value != `{"en":"English","zh":"中文"}` {
		t.Fatalf("expected JSON object to be preserved, got %q", value)
	}
	if err := validateNotice(value); err != nil {
		t.Fatalf("expected language map to be valid, got %v", err)
	}
}

func TestValidateNoticeCompatibilityAndValidation(t *testing.T) {
	if err := validateNotice("Legacy English notice"); err != nil {
		t.Fatalf("expected legacy string to remain valid, got %v", err)
	}
	if err := validateNotice(`{"zh":"只有中文"}`); err == nil {
		t.Fatal("expected language map without English fallback to be rejected")
	}
	if err := validateNotice(`{"en":123}`); err == nil {
		t.Fatal("expected non-string language content to be rejected")
	}
}
