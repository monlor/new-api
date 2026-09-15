package common

import "testing"

func TestMoneyEqualUSD(t *testing.T) {
	if !MoneyEqualUSD(10.00, "10") {
		t.Fatal("10 vs 10")
	}
	if !MoneyEqualUSD(10.01, "10.01") {
		t.Fatal("10.01 vs 10.01")
	}
	if MoneyEqualUSD(100, "1") {
		t.Fatal("100 vs 1 should mismatch")
	}
	if MoneyEqualUSD(10, "") {
		t.Fatal("empty paid should mismatch")
	}
	if MoneyEqualUSD(10, "abc") {
		t.Fatal("invalid paid should mismatch")
	}
	if MoneyEqualUSD(0.01, "0") {
		t.Fatal("0.01 vs 0 should mismatch")
	}
	if MoneyEqualUSD(10.00, "9.99") {
		t.Fatal("10.00 vs 9.99 should mismatch")
	}
	if !MoneyEqualUSD(10.00, "10.001") {
		t.Fatal("10.00 vs 10.001 should match after cent rounding")
	}
	if !MoneyStringsEqual("10.00", "10") {
		t.Fatal("10.00 vs 10 strings should match")
	}
	if MoneyStringsEqual("10.00", "9.99") {
		t.Fatal("10.00 vs 9.99 strings should mismatch")
	}
}

func TestCentsEqualUSD(t *testing.T) {
	if !CentsEqualUSD(12.34, 1234) {
		t.Fatal("12.34 USD should be 1234 cents")
	}
	if CentsEqualUSD(12.34, 1) {
		t.Fatal("mismatch cents")
	}
}

func TestMoneyStringsEqual(t *testing.T) {
	if !MoneyStringsEqual("90.00", "90") {
		t.Fatal("90.00 vs 90")
	}
	if MoneyStringsEqual("90.00", "1") {
		t.Fatal("should mismatch")
	}
}
