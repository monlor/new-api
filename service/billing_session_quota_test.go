package service

import (
	"errors"
	"fmt"
	"net/http"
	"testing"

	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/types"
)

func TestMapQuotaInsufficientError(t *testing.T) {
	t.Parallel()

	apiErr := mapQuotaInsufficientError(model.ErrQuotaInsufficient)
	if apiErr == nil {
		t.Fatal("expected insufficient quota mapping")
	}
	if apiErr.StatusCode != http.StatusForbidden {
		t.Fatalf("status=%d", apiErr.StatusCode)
	}
	if apiErr.GetErrorCode() != types.ErrorCodeInsufficientUserQuota {
		t.Fatalf("code=%s", apiErr.GetErrorCode())
	}

	wrapped := mapQuotaInsufficientError(fmt.Errorf("cache/db mismatch: %w", model.ErrQuotaInsufficient))
	if wrapped == nil || wrapped.GetErrorCode() != types.ErrorCodeInsufficientUserQuota {
		t.Fatal("wrapped ErrQuotaInsufficient should map to 403")
	}

	wallet := mapQuotaInsufficientError(errors.New("wallet quota insufficient, remaining=1 need=2"))
	if wallet == nil || wallet.GetErrorCode() != types.ErrorCodeInsufficientUserQuota {
		t.Fatal("wallet quota insufficient string should map to 403")
	}

	if mapQuotaInsufficientError(errors.New("database is locked")) != nil {
		t.Fatal("unrelated errors must not map to insufficient quota")
	}
}
