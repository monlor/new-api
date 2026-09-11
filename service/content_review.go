package service

import (
	"errors"
	"regexp"
	"strings"
	"unicode/utf8"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/types"
)

var userInputTagRe = regexp.MustCompile(`(?i)<\s*/?\s*user_input\s*>`)

type ContentReviewResult struct {
	Confidence float64
	Reason     string
}

type ContentReviewDecision struct {
	ShouldFlag  bool
	ShouldBlock bool
}

func ExtractContentReviewText(request dto.Request, meta *types.TokenCountMeta, maxChars int) string {
	text := extractLatestUserText(request)
	if text == "" && meta != nil {
		text = strings.TrimSpace(meta.CombineText)
	}
	if text == "" && request != nil {
		fallback := request.GetTokenCountMeta()
		if fallback != nil {
			text = strings.TrimSpace(fallback.CombineText)
		}
	}
	return truncateRunesSuffix(text, maxChars)
}

func extractLatestUserText(request dto.Request) string {
	switch req := request.(type) {
	case *dto.GeneralOpenAIRequest:
		for i := len(req.Messages) - 1; i >= 0; i-- {
			if strings.EqualFold(req.Messages[i].Role, "user") {
				if text := strings.TrimSpace(req.Messages[i].StringContent()); text != "" {
					return text
				}
			}
		}
	case *dto.ClaudeRequest:
		for i := len(req.Messages) - 1; i >= 0; i-- {
			if strings.EqualFold(req.Messages[i].Role, "user") {
				if text := strings.TrimSpace(req.Messages[i].GetStringContent()); text != "" {
					return text
				}
			}
		}
	case *dto.ImageRequest:
		return strings.TrimSpace(req.Prompt)
	}
	return ""
}

func WrapContentReviewInput(text string) string {
	sanitized := userInputTagRe.ReplaceAllString(text, "[user_input]")
	return "<user_input>\n" + sanitized + "\n</user_input>"
}

func ParseContentReviewResult(raw string) (ContentReviewResult, error) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ContentReviewResult{}, errors.New("empty review response")
	}
	raw = stripMarkdownFence(raw)
	rest := raw
	var lastErr error
	for {
		obj := extractFirstJSONObject(rest)
		if obj == "" {
			if lastErr != nil {
				return ContentReviewResult{}, lastErr
			}
			return ContentReviewResult{}, errors.New("review response is not JSON")
		}
		var parsed struct {
			Confidence *float64 `json:"confidence"`
			Reason     string   `json:"reason"`
		}
		if err := common.Unmarshal([]byte(obj), &parsed); err != nil {
			lastErr = err
		} else if parsed.Confidence == nil {
			lastErr = errors.New("missing confidence")
		} else {
			return ContentReviewResult{
				Confidence: clampUnitInterval(*parsed.Confidence),
				Reason:     strings.TrimSpace(parsed.Reason),
			}, nil
		}
		idx := strings.Index(rest, obj)
		if idx < 0 {
			break
		}
		rest = rest[idx+len(obj):]
	}
	if lastErr != nil {
		return ContentReviewResult{}, lastErr
	}
	return ContentReviewResult{}, errors.New("review response is not JSON")
}

func DecideContentReview(result ContentReviewResult, flagEnabled bool, flagThreshold float64, blockEnabled bool, blockThreshold float64) ContentReviewDecision {
	return ContentReviewDecision{
		ShouldFlag:  flagEnabled && result.Confidence >= flagThreshold,
		ShouldBlock: blockEnabled && result.Confidence >= blockThreshold,
	}
}

func stripMarkdownFence(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if !strings.HasPrefix(trimmed, "```") {
		return trimmed
	}
	trimmed = strings.TrimPrefix(trimmed, "```")
	trimmed = strings.TrimSpace(trimmed)
	if strings.HasPrefix(strings.ToLower(trimmed), "json") {
		trimmed = strings.TrimSpace(trimmed[4:])
	}
	if idx := strings.LastIndex(trimmed, "```"); idx >= 0 {
		trimmed = trimmed[:idx]
	}
	return strings.TrimSpace(trimmed)
}

func extractFirstJSONObject(raw string) string {
	start := strings.Index(raw, "{")
	if start < 0 {
		return ""
	}
	depth := 0
	inStr := false
	escape := false
	for i := start; i < len(raw); i++ {
		ch := raw[i]
		if inStr {
			if escape {
				escape = false
				continue
			}
			if ch == '\\' {
				escape = true
				continue
			}
			if ch == '"' {
				inStr = false
			}
			continue
		}
		switch ch {
		case '"':
			inStr = true
		case '{':
			depth++
		case '}':
			depth--
			if depth == 0 {
				return raw[start : i+1]
			}
		}
	}
	return ""
}

func truncateRunesSuffix(s string, max int) string {
	if max <= 0 || s == "" {
		return s
	}
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	runes := []rune(s)
	return string(runes[len(runes)-max:])
}

func clampUnitInterval(v float64) float64 {
	if v < 0 {
		return 0
	}
	if v > 1 {
		return 1
	}
	return v
}
