package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestIsBillingTypeCompatible(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name               string
		channelBillingType int
		tokenBillingType   int
		want               bool
	}{
		{"token all accepts subscription-only channel", ChannelBillingTypeSubscriptionOnly, ChannelBillingTypeAll, true},
		{"token all accepts wallet-only channel", ChannelBillingTypeWalletOnly, ChannelBillingTypeAll, true},
		{"token all accepts unrestricted channel", ChannelBillingTypeAll, ChannelBillingTypeAll, true},
		{"wallet-only token rejects subscription-only channel", ChannelBillingTypeSubscriptionOnly, ChannelBillingTypeWalletOnly, false},
		{"wallet-only token accepts wallet-only channel", ChannelBillingTypeWalletOnly, ChannelBillingTypeWalletOnly, true},
		{"wallet-only token accepts unrestricted channel", ChannelBillingTypeAll, ChannelBillingTypeWalletOnly, true},
		{"subscription-only token rejects wallet-only channel", ChannelBillingTypeWalletOnly, ChannelBillingTypeSubscriptionOnly, false},
		{"subscription-only token accepts subscription-only channel", ChannelBillingTypeSubscriptionOnly, ChannelBillingTypeSubscriptionOnly, true},
		{"subscription-only token accepts unrestricted channel", ChannelBillingTypeAll, ChannelBillingTypeSubscriptionOnly, true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := IsBillingTypeCompatible(tt.channelBillingType, tt.tokenBillingType)
			if got != tt.want {
				t.Fatalf("IsBillingTypeCompatible(channel=%d, token=%d) = %v, want %v",
					tt.channelBillingType, tt.tokenBillingType, got, tt.want)
			}
		})
	}
}

func TestGetChannelWalletOnlyUsesLowerPriorityWalletChannel(t *testing.T) {
	require.NoError(t, DB.Exec("DELETE FROM abilities").Error)
	require.NoError(t, DB.Exec("DELETE FROM channels").Error)
	t.Cleanup(func() {
		_ = DB.Exec("DELETE FROM abilities").Error
		_ = DB.Exec("DELETE FROM channels").Error
	})

	high := int64(10)
	low := int64(0)
	require.NoError(t, DB.Create(&Channel{
		Id:          101,
		Type:        1,
		Key:         "key-101",
		Status:      common.ChannelStatusEnabled,
		Name:        "sub-only",
		BillingType: ChannelBillingTypeSubscriptionOnly,
	}).Error)
	require.NoError(t, DB.Create(&Channel{
		Id:          102,
		Type:        1,
		Key:         "key-102",
		Status:      common.ChannelStatusEnabled,
		Name:        "wallet-only",
		BillingType: ChannelBillingTypeWalletOnly,
	}).Error)
	require.NoError(t, DB.Create(&Ability{
		Group:     "default",
		Model:     "gpt-test-billing",
		ChannelId: 101,
		Enabled:   true,
		Priority:  &high,
		Weight:    0,
	}).Error)
	require.NoError(t, DB.Create(&Ability{
		Group:     "default",
		Model:     "gpt-test-billing",
		ChannelId: 102,
		Enabled:   true,
		Priority:  &low,
		Weight:    0,
	}).Error)

	got, err := GetChannel("default", "gpt-test-billing", 0, ChannelBillingTypeWalletOnly)
	require.NoError(t, err)
	require.NotNil(t, got)
	if got.Id != 102 {
		t.Fatalf("got channel %d, want wallet-only channel 102", got.Id)
	}

	preferred, err := GetChannel("default", "gpt-test-billing", 0, ChannelBillingTypeAll)
	require.NoError(t, err)
	require.NotNil(t, preferred)
	if preferred.Id != 101 {
		t.Fatalf("got channel %d, want subscription-only channel 101 for type All", preferred.Id)
	}
}
