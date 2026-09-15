package common

import (
	"fmt"
	"strings"

	"github.com/shopspring/decimal"
)

// ParseMoneyDecimal parses a paid amount from a provider callback.
func ParseMoneyDecimal(paid string) (decimal.Decimal, error) {
	paid = strings.TrimSpace(paid)
	if paid == "" {
		return decimal.Zero, fmt.Errorf("paid amount is empty")
	}
	d, err := decimal.NewFromString(paid)
	if err != nil {
		return decimal.Zero, fmt.Errorf("invalid paid amount %q", paid)
	}
	return d, nil
}

// MoneyEqualUSD reports whether paid matches expected USD after rounding to cents.
func MoneyEqualUSD(expected float64, paid string) bool {
	p, err := ParseMoneyDecimal(paid)
	if err != nil {
		return false
	}
	return decimal.NewFromFloat(expected).Round(2).Equal(p.Round(2))
}

// MoneyStringsEqual compares two decimal money strings after rounding to cents.
func MoneyStringsEqual(expected, paid string) bool {
	e, err := ParseMoneyDecimal(expected)
	if err != nil {
		return false
	}
	p, err := ParseMoneyDecimal(paid)
	if err != nil {
		return false
	}
	return e.Round(2).Equal(p.Round(2))
}

// CentsEqualUSD reports whether paid integer cents match expected USD dollars.
func CentsEqualUSD(expectedUSD float64, paidCents int64) bool {
	expectedCents := decimal.NewFromFloat(expectedUSD).Mul(decimal.NewFromInt(100)).Round(0).IntPart()
	return expectedCents == paidCents
}
