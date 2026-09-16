package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
)

func TestFormatUserLogsStripsModelMapping(t *testing.T) {
	logs := []*Log{{
		Id:          99,
		ChannelId:   7,
		ChannelName: "secret",
		Other:       `{"is_model_mapped":true,"upstream_model_name":"cx/gpt-5.6-sol","admin_info":{"use_channel":["1"]},"cache_tokens":1}`,
	}}

	formatUserLogs(logs, 10)

	if logs[0].ChannelName != "" {
		t.Fatalf("channel name leaked: %q", logs[0].ChannelName)
	}
	if logs[0].ChannelId != 0 {
		t.Fatalf("channel id leaked: %d", logs[0].ChannelId)
	}
	if logs[0].Id != 11 {
		t.Fatalf("id=%d want 11", logs[0].Id)
	}

	other, err := common.StrToMap(logs[0].Other)
	if err != nil {
		t.Fatalf("parse other: %v", err)
	}
	for _, key := range []string{"is_model_mapped", "upstream_model_name", "admin_info"} {
		if _, ok := other[key]; ok {
			t.Fatalf("%s leaked: %#v", key, other[key])
		}
	}
	if other["cache_tokens"] != float64(1) {
		t.Fatalf("cache_tokens=%v want 1", other["cache_tokens"])
	}
}
