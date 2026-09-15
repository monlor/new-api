package common

import (
	"reflect"
	"testing"
)

func TestParseTrustedProxies(t *testing.T) {
	t.Parallel()

	private := defaultPrivateProxies

	if got := ParseTrustedProxies(""); !reflect.DeepEqual(got, private) {
		t.Fatalf("empty default: %v", got)
	}
	if got := ParseTrustedProxies("private"); !reflect.DeepEqual(got, private) {
		t.Fatalf("private: %v", got)
	}
	if got := ParseTrustedProxies("PRIVATE"); !reflect.DeepEqual(got, private) {
		t.Fatalf("PRIVATE: %v", got)
	}
	if got := ParseTrustedProxies("none"); got != nil {
		t.Fatalf("none should trust nobody, got %v", got)
	}
	if got := ParseTrustedProxies("off"); got != nil {
		t.Fatalf("off should trust nobody, got %v", got)
	}
	if got := ParseTrustedProxies("-"); got != nil {
		t.Fatalf("- should trust nobody, got %v", got)
	}

	got := ParseTrustedProxies(" 172.18.0.0/16 , 10.0.0.1 ")
	want := []string{"172.18.0.0/16", "10.0.0.1"}
	if !reflect.DeepEqual(got, want) {
		t.Fatalf("explicit list: got %v want %v", got, want)
	}
}
