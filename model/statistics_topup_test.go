package model

import (
	"testing"

	"github.com/QuantumNous/new-api/setting/operation_setting"
)

func TestTopUpMoneyUSDConvertsEpayCNY(t *testing.T) {
	original := operation_setting.Price
	t.Cleanup(func() { operation_setting.Price = original })
	operation_setting.Price = 7

	if got := topUpMoneyUSD(PaymentProviderEpay, 70); got != 10 {
		t.Fatalf("epay money=%v, want 10", got)
	}
	if got := topUpMoneyUSD(PaymentProviderStripe, 70); got != 70 {
		t.Fatalf("stripe money=%v, want 70", got)
	}
	if got := topUpMoneyUSD(PaymentProviderWaffo, 12.5); got != 12.5 {
		t.Fatalf("waffo money=%v, want 12.5", got)
	}

	operation_setting.Price = 0
	if got := topUpMoneyUSD(PaymentProviderEpay, 70); got != 70 {
		t.Fatalf("zero price should not convert, got %v", got)
	}
}
