package console_setting

import (
	"strings"
	"testing"
)

func TestValidateAnnouncementsSupportsTranslations(t *testing.T) {
	valid := `[{"content":"English fallback","extra":"English detail","publishDate":"2026-08-14T00:00:00Z","translations":{"zh":{"content":"中文公告","extra":"中文说明"},"ja":{"content":"日本語のお知らせ"}}}]`
	if err := validateAnnouncements(valid); err != nil {
		t.Fatalf("expected multilingual announcement to be valid, got %v", err)
	}
}

func TestValidateAnnouncementsRejectsInvalidTranslation(t *testing.T) {
	missingContent := `[{"content":"English fallback","publishDate":"2026-08-14T00:00:00Z","translations":{"zh":{"extra":"说明"}}}]`
	if err := validateAnnouncements(missingContent); err == nil {
		t.Fatal("expected missing translated content to be rejected")
	}

	tooLong := `[{"content":"English fallback","publishDate":"2026-08-14T00:00:00Z","translations":{"zh":{"content":"` + strings.Repeat("a", 501) + `"}}}]`
	if err := validateAnnouncements(tooLong); err == nil {
		t.Fatal("expected oversized translated content to be rejected")
	}
}

func TestValidateAnnouncementsKeepsLegacyFormat(t *testing.T) {
	legacy := `[{"content":"English fallback","extra":"detail","publishDate":"2026-08-14T00:00:00Z"}]`
	if err := validateAnnouncements(legacy); err != nil {
		t.Fatalf("expected legacy announcement to remain valid, got %v", err)
	}
}
