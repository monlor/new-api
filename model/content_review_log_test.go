package model

import (
	"math"
	"testing"
)

func TestApplyContentReviewLogPassSample(t *testing.T) {
	stat := ContentReviewLogStat{
		Total:                110,
		Pass:                 10,
		Flag:                 80,
		Block:                15,
		Error:                5,
		PromptTokens:         1000,
		CompletionTokens:     200,
		EstimatedQuota:       50,
		PassPromptTokens:     200,
		PassCompletionTokens: 40,
		PassEstimatedQuota:   10,
	}
	ApplyContentReviewLogPassSample(&stat, 0.1)
	if !stat.Sampled {
		t.Fatal("expected sampled")
	}
	if stat.PassSampleRate != 0.1 {
		t.Fatalf("rate=%v", stat.PassSampleRate)
	}
	if stat.Pass != 100 {
		t.Fatalf("pass=%d want 100", stat.Pass)
	}
	if stat.Total != 200 {
		t.Fatalf("total=%d want 200", stat.Total)
	}
	if stat.Flag != 80 || stat.Block != 15 || stat.Error != 5 {
		t.Fatalf("flag/block/error mutated: %d/%d/%d", stat.Flag, stat.Block, stat.Error)
	}
	if stat.PromptTokens != 2800 {
		t.Fatalf("prompt_tokens=%d want 2800", stat.PromptTokens)
	}
	if stat.CompletionTokens != 560 {
		t.Fatalf("completion_tokens=%d want 560", stat.CompletionTokens)
	}
	if stat.EstimatedQuota != 140 {
		t.Fatalf("estimated_quota=%d want 140", stat.EstimatedQuota)
	}

	full := ContentReviewLogStat{Pass: 3, Total: 3}
	ApplyContentReviewLogPassSample(&full, 1)
	if full.Sampled || full.Pass != 3 {
		t.Fatalf("rate=1 mutated: %+v", full)
	}

	none := ContentReviewLogStat{Pass: 0, Flag: 2, Total: 2}
	ApplyContentReviewLogPassSample(&none, 0)
	if !none.Sampled || none.Pass != 0 || none.Total != 2 {
		t.Fatalf("rate=0 mutated: %+v", none)
	}

	rounded := ContentReviewLogStat{Pass: 1, Total: 1}
	ApplyContentReviewLogPassSample(&rounded, 0.3)
	if rounded.Pass != 3 || rounded.Total != 3 {
		t.Fatalf("rate=0.3 pass=%d total=%d", rounded.Pass, rounded.Total)
	}

	overflow := ContentReviewLogStat{Pass: math.MaxInt64 / 4, Total: math.MaxInt64 / 4}
	ApplyContentReviewLogPassSample(&overflow, 1e-12)
	if !overflow.Sampled || overflow.Pass != math.MaxInt64/4 {
		t.Fatalf("overflow scaled: %+v", overflow)
	}
}
