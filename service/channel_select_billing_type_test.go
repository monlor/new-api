package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"
	"github.com/gin-gonic/gin"
)

func TestResolveChannelSelectBillingType(t *testing.T) {
	t.Parallel()

	tests := []struct {
		name                  string
		tokenBillingType      int
		hasActiveSubscription bool
		want                  int
	}{
		{
			name:                  "subscription first without subscription uses wallet-only filter",
			tokenBillingType:      model.ChannelBillingTypeAll,
			hasActiveSubscription: false,
			want:                  model.ChannelBillingTypeWalletOnly,
		},
		{
			name:                  "subscription first with active subscription keeps all",
			tokenBillingType:      model.ChannelBillingTypeAll,
			hasActiveSubscription: true,
			want:                  model.ChannelBillingTypeAll,
		},
		{
			name:                  "wallet only is unchanged without subscription",
			tokenBillingType:      model.ChannelBillingTypeWalletOnly,
			hasActiveSubscription: false,
			want:                  model.ChannelBillingTypeWalletOnly,
		},
		{
			name:                  "wallet only is unchanged with subscription",
			tokenBillingType:      model.ChannelBillingTypeWalletOnly,
			hasActiveSubscription: true,
			want:                  model.ChannelBillingTypeWalletOnly,
		},
		{
			name:                  "subscription only is unchanged without subscription",
			tokenBillingType:      model.ChannelBillingTypeSubscriptionOnly,
			hasActiveSubscription: false,
			want:                  model.ChannelBillingTypeSubscriptionOnly,
		},
		{
			name:                  "subscription only is unchanged with subscription",
			tokenBillingType:      model.ChannelBillingTypeSubscriptionOnly,
			hasActiveSubscription: true,
			want:                  model.ChannelBillingTypeSubscriptionOnly,
		},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			t.Parallel()
			got := ResolveChannelSelectBillingType(tt.tokenBillingType, tt.hasActiveSubscription)
			if got != tt.want {
				t.Fatalf("ResolveChannelSelectBillingType(%d, %v) = %d, want %d",
					tt.tokenBillingType, tt.hasActiveSubscription, got, tt.want)
			}
		})
	}
}

func TestSubscriptionFirstWithoutSubscriptionSkipsSubscriptionOnlyChannels(t *testing.T) {
	t.Parallel()

	selectType := ResolveChannelSelectBillingType(model.ChannelBillingTypeAll, false)
	if model.IsBillingTypeCompatible(model.ChannelBillingTypeSubscriptionOnly, selectType) {
		t.Fatalf("subscription-only channel must be incompatible with resolved type %d", selectType)
	}
	if !model.IsBillingTypeCompatible(model.ChannelBillingTypeWalletOnly, selectType) {
		t.Fatalf("wallet-only channel must be compatible with resolved type %d", selectType)
	}
	if !model.IsBillingTypeCompatible(model.ChannelBillingTypeAll, selectType) {
		t.Fatalf("unrestricted channel must be compatible with resolved type %d", selectType)
	}
}

func TestEffectiveChannelSelectBillingType(t *testing.T) {
	gin.SetMode(gin.TestMode)

	t.Run("wallet only does not depend on subscription state", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		common.SetContextKey(c, constant.ContextKeyTokenBillingType, model.ChannelBillingTypeWalletOnly)
		common.SetContextKey(c, constant.ContextKeyUserId, 1)
		if got := EffectiveChannelSelectBillingType(c); got != model.ChannelBillingTypeWalletOnly {
			t.Fatalf("got %d, want wallet-only", got)
		}
	})

	t.Run("subscription only does not depend on subscription state", func(t *testing.T) {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		common.SetContextKey(c, constant.ContextKeyTokenBillingType, model.ChannelBillingTypeSubscriptionOnly)
		common.SetContextKey(c, constant.ContextKeyUserId, 1)
		if got := EffectiveChannelSelectBillingType(c); got != model.ChannelBillingTypeSubscriptionOnly {
			t.Fatalf("got %d, want subscription-only", got)
		}
	})

	t.Run("no subscription uses wallet-only filter", func(t *testing.T) {
		user := model.User{Username: "billing-type-no-sub", Password: "password1", Quota: 1_000_000, Status: 1, AffCode: "btns1"}
		if err := model.DB.Create(&user).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
		t.Cleanup(func() {
			model.DB.Unscoped().Delete(&user)
		})

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		common.SetContextKey(c, constant.ContextKeyTokenBillingType, model.ChannelBillingTypeAll)
		common.SetContextKey(c, constant.ContextKeyUserId, user.Id)

		got := EffectiveChannelSelectBillingType(c)
		if got != model.ChannelBillingTypeWalletOnly {
			t.Fatalf("got %d, want wallet-only %d", got, model.ChannelBillingTypeWalletOnly)
		}
		if cached := EffectiveChannelSelectBillingType(c); cached != got {
			t.Fatalf("cached value %d != first result %d", cached, got)
		}
	})

	t.Run("active subscription keeps all", func(t *testing.T) {
		user := model.User{Username: "billing-type-with-sub", Password: "password1", Quota: 1_000_000, Status: 1, AffCode: "btws1"}
		if err := model.DB.Create(&user).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
		now := common.GetTimestamp()
		sub := model.UserSubscription{
			UserId:      user.Id,
			PlanId:      1,
			AmountTotal: 1000,
			Status:      "active",
			StartTime:   now - 10,
			EndTime:     now + 3600,
		}
		if err := model.DB.Create(&sub).Error; err != nil {
			t.Fatalf("create subscription: %v", err)
		}
		t.Cleanup(func() {
			model.DB.Unscoped().Delete(&sub)
			model.DB.Unscoped().Delete(&user)
		})

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		common.SetContextKey(c, constant.ContextKeyTokenBillingType, model.ChannelBillingTypeAll)
		common.SetContextKey(c, constant.ContextKeyUserId, user.Id)

		got := EffectiveChannelSelectBillingType(c)
		if got != model.ChannelBillingTypeAll {
			t.Fatalf("got %d, want all %d", got, model.ChannelBillingTypeAll)
		}
	})

	t.Run("cancelled subscription uses wallet-only filter", func(t *testing.T) {
		user := model.User{Username: "billing-type-cancelled-sub", Password: "password1", Quota: 1_000_000, Status: 1, AffCode: "btcs1"}
		if err := model.DB.Create(&user).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
		now := common.GetTimestamp()
		sub := model.UserSubscription{
			UserId:      user.Id,
			PlanId:      1,
			AmountTotal: 1000,
			Status:      "cancelled",
			StartTime:   now - 10,
			EndTime:     now - 1,
		}
		if err := model.DB.Create(&sub).Error; err != nil {
			t.Fatalf("create subscription: %v", err)
		}
		t.Cleanup(func() {
			model.DB.Unscoped().Delete(&sub)
			model.DB.Unscoped().Delete(&user)
		})

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		common.SetContextKey(c, constant.ContextKeyTokenBillingType, model.ChannelBillingTypeAll)
		common.SetContextKey(c, constant.ContextKeyUserId, user.Id)

		got := EffectiveChannelSelectBillingType(c)
		if got != model.ChannelBillingTypeWalletOnly {
			t.Fatalf("got %d, want wallet-only %d", got, model.ChannelBillingTypeWalletOnly)
		}
	})

	t.Run("exhausted remaining uses wallet-only filter", func(t *testing.T) {
		user := model.User{Username: "billing-type-empty-remain", Password: "password1", Quota: 1_000_000, Status: 1, AffCode: "bter1"}
		if err := model.DB.Create(&user).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
		now := common.GetTimestamp()
		sub := model.UserSubscription{
			UserId:      user.Id,
			PlanId:      1,
			AmountTotal: 1000,
			AmountUsed:  1000,
			Status:      "active",
			StartTime:   now - 10,
			EndTime:     now + 3600,
		}
		if err := model.DB.Create(&sub).Error; err != nil {
			t.Fatalf("create subscription: %v", err)
		}
		t.Cleanup(func() {
			model.DB.Unscoped().Delete(&sub)
			model.DB.Unscoped().Delete(&user)
		})

		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		common.SetContextKey(c, constant.ContextKeyTokenBillingType, model.ChannelBillingTypeAll)
		common.SetContextKey(c, constant.ContextKeyUserId, user.Id)

		got := EffectiveChannelSelectBillingType(c)
		if got != model.ChannelBillingTypeWalletOnly {
			t.Fatalf("got %d, want wallet-only %d", got, model.ChannelBillingTypeWalletOnly)
		}
	})
}

func TestRefreshEffectiveChannelSelectBillingType(t *testing.T) {
	gin.SetMode(gin.TestMode)

	seed := func(t *testing.T, username, affCode string, total, used int64) int {
		t.Helper()
		user := model.User{Username: username, Password: "password1", Quota: 1_000_000, Status: 1, AffCode: affCode}
		if err := model.DB.Create(&user).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
		now := common.GetTimestamp()
		sub := model.UserSubscription{
			UserId:      user.Id,
			PlanId:      1,
			AmountTotal: total,
			AmountUsed:  used,
			Status:      "active",
			StartTime:   now - 10,
			EndTime:     now + 3600,
		}
		if err := model.DB.Create(&sub).Error; err != nil {
			t.Fatalf("create subscription: %v", err)
		}
		t.Cleanup(func() {
			model.DB.Unscoped().Delete(&sub)
			model.DB.Unscoped().Delete(&user)
		})
		return user.Id
	}

	newCtx := func(userId int) *gin.Context {
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		common.SetContextKey(c, constant.ContextKeyTokenBillingType, model.ChannelBillingTypeAll)
		common.SetContextKey(c, constant.ContextKeyUserId, userId)
		return c
	}

	t.Run("leftover 30 need 50 uses wallet-only filter", func(t *testing.T) {
		userId := seed(t, "refresh-partial", "rfpa1", 100, 70)
		c := newCtx(userId)

		if got := EffectiveChannelSelectBillingType(c); got != model.ChannelBillingTypeAll {
			t.Fatalf("legacy usable leftover kept all, got %d", got)
		}

		got := RefreshEffectiveChannelSelectBillingType(c, 50)
		if got != model.ChannelBillingTypeWalletOnly {
			t.Fatalf("got %d, want wallet-only", got)
		}
		if model.IsBillingTypeCompatible(model.ChannelBillingTypeSubscriptionOnly, got) {
			t.Fatalf("subscription-only must be incompatible with resolved type %d", got)
		}
		if cached := EffectiveChannelSelectBillingType(c); cached != got {
			t.Fatalf("cache not overwritten: %d != %d", cached, got)
		}
	})

	t.Run("leftover 80 need 50 keeps all", func(t *testing.T) {
		userId := seed(t, "refresh-enough", "rfen1", 100, 20)
		c := newCtx(userId)

		got := RefreshEffectiveChannelSelectBillingType(c, 50)
		if got != model.ChannelBillingTypeAll {
			t.Fatalf("got %d, want all", got)
		}
		if !model.IsBillingTypeCompatible(model.ChannelBillingTypeSubscriptionOnly, got) {
			t.Fatalf("subscription-only must stay compatible with resolved type %d", got)
		}
	})

	t.Run("remaining 0 uses wallet-only filter", func(t *testing.T) {
		userId := seed(t, "refresh-empty", "rfem1", 100, 100)
		c := newCtx(userId)

		got := RefreshEffectiveChannelSelectBillingType(c, 50)
		if got != model.ChannelBillingTypeWalletOnly {
			t.Fatalf("got %d, want wallet-only", got)
		}
	})

	t.Run("unlimited with need 50 keeps all", func(t *testing.T) {
		userId := seed(t, "refresh-unlim", "rful1", 0, 0)
		c := newCtx(userId)

		got := RefreshEffectiveChannelSelectBillingType(c, 50)
		if got != model.ChannelBillingTypeAll {
			t.Fatalf("got %d, want all", got)
		}
	})

	t.Run("two undersized subs need 50 uses wallet-only filter", func(t *testing.T) {
		user := model.User{Username: "refresh-two40", Password: "password1", Quota: 1_000_000, Status: 1, AffCode: "rftw1"}
		if err := model.DB.Create(&user).Error; err != nil {
			t.Fatalf("create user: %v", err)
		}
		now := common.GetTimestamp()
		first := model.UserSubscription{
			UserId: user.Id, PlanId: 1, AmountTotal: 40, AmountUsed: 0,
			Status: "active", StartTime: now - 10, EndTime: now + 1000,
		}
		second := model.UserSubscription{
			UserId: user.Id, PlanId: 1, AmountTotal: 40, AmountUsed: 0,
			Status: "active", StartTime: now - 10, EndTime: now + 2000,
		}
		if err := model.DB.Create(&first).Error; err != nil {
			t.Fatalf("create first sub: %v", err)
		}
		if err := model.DB.Create(&second).Error; err != nil {
			t.Fatalf("create second sub: %v", err)
		}
		t.Cleanup(func() {
			model.DB.Unscoped().Delete(&first)
			model.DB.Unscoped().Delete(&second)
			model.DB.Unscoped().Delete(&user)
		})

		got := RefreshEffectiveChannelSelectBillingType(newCtx(user.Id), 50)
		if got != model.ChannelBillingTypeWalletOnly {
			t.Fatalf("got %d, want wallet-only (sum 80 must not keep all)", got)
		}
		if model.IsBillingTypeCompatible(model.ChannelBillingTypeSubscriptionOnly, got) {
			t.Fatalf("subscription-only must be incompatible with resolved type %d", got)
		}
	})

	t.Run("one 80-remain sub need 50 keeps all", func(t *testing.T) {
		userId := seed(t, "refresh-one80", "rfo81", 80, 0)
		got := RefreshEffectiveChannelSelectBillingType(newCtx(userId), 50)
		if got != model.ChannelBillingTypeAll {
			t.Fatalf("got %d, want all", got)
		}
		if !model.IsBillingTypeCompatible(model.ChannelBillingTypeSubscriptionOnly, got) {
			t.Fatalf("subscription-only must stay compatible with resolved type %d", got)
		}
	})
}
