package model

import (
	"context"
	"testing"

	"github.com/QuantumNous/new-api/common/chrate"
	"github.com/QuantumNous/new-api/dto"
)

func TestPickChannelByWeightAndLoadSameRatioPrefersIdle(t *testing.T) {
	chrate.ResetMemoryForTest()
	busy := &Channel{Id: 1, Weight: uintPtr(10), Ratio: floatPtr(1)}
	idle := &Channel{Id: 2, Weight: uintPtr(10), Ratio: floatPtr(1)}
	busy.SetSetting(dto.ChannelSettings{RateLimitCount: 2, RateLimitDurationMs: 5000})
	idle.SetSetting(dto.ChannelSettings{RateLimitCount: 2, RateLimitDurationMs: 5000})

	if _, _, err := chrate.Allow(context.Background(), busy.Id, 2, 5000); err != nil {
		t.Fatal(err)
	}
	if _, _, err := chrate.Allow(context.Background(), busy.Id, 2, 5000); err != nil {
		t.Fatal(err)
	}

	picked := pickChannelByWeightAndLoad([]*Channel{busy, idle})
	if picked == nil || picked.Id != idle.Id {
		t.Fatalf("picked=%v, want idle channel 2", picked)
	}
}

func TestPickChannelByWeightAndLoadKeepsRatioBuckets(t *testing.T) {
	chrate.ResetMemoryForTest()
	cheapBusy := &Channel{Id: 1, Weight: uintPtr(100), Ratio: floatPtr(1)}
	expensiveIdle := &Channel{Id: 2, Weight: uintPtr(1), Ratio: floatPtr(2)}
	cheapBusy.SetSetting(dto.ChannelSettings{RateLimitCount: 1, RateLimitDurationMs: 5000})
	expensiveIdle.SetSetting(dto.ChannelSettings{RateLimitCount: 1, RateLimitDurationMs: 5000})
	if _, _, err := chrate.Allow(context.Background(), cheapBusy.Id, 1, 5000); err != nil {
		t.Fatal(err)
	}

	hits := map[int]int{}
	for i := 0; i < 40; i++ {
		picked := pickChannelByWeightAndLoad([]*Channel{cheapBusy, expensiveIdle})
		if picked == nil {
			t.Fatal("picked nil")
		}
		hits[picked.Id]++
	}
	if hits[cheapBusy.Id] == 0 {
		t.Fatalf("cheap bucket never selected: %v", hits)
	}
}

func uintPtr(v uint) *uint { return &v }

func floatPtr(v float64) *float64 { return &v }
