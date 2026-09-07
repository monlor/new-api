package console_setting

import (
	"fmt"
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

func TestValidateAnnouncementsCountsRunesNotBytes(t *testing.T) {
	chinese := strings.Repeat("中", 200)
	valid := fmt.Sprintf(
		`[{"content":"English fallback","publishDate":"2026-08-14T00:00:00Z","translations":{"zh":{"content":"%s"}}}]`,
		chinese,
	)
	if err := validateAnnouncements(valid); err != nil {
		t.Fatalf("expected 200 Chinese runes to be valid, got %v", err)
	}

	tooLong := strings.Repeat("中", 501)
	invalid := fmt.Sprintf(
		`[{"content":"English fallback","publishDate":"2026-08-14T00:00:00Z","translations":{"zh":{"content":"%s"}}}]`,
		tooLong,
	)
	if err := validateAnnouncements(invalid); err == nil {
		t.Fatal("expected 501 Chinese runes to be rejected")
	}
}

func TestValidateAnnouncementsAcceptsFrontendPayload(t *testing.T) {
	payload := `[{"id":1,"content":"English announcement","publishDate":"2026-09-05T03:04:05.000Z","type":"default","extra":"","translations":{"zh":{"content":"中文公告","extra":""}}}]`
	if err := validateAnnouncements(payload); err != nil {
		t.Fatalf("expected frontend multilingual payload to be valid, got %v", err)
	}
}
