package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func TestSubscriptionAllowsModel(t *testing.T) {
	cases := []struct {
		name          string
		allowedModels string
		modelName     string
		want          bool
	}{
		{"empty whitelist allows everything", "", "gpt-4o", true},
		{"blank whitelist allows everything", "   ", "gpt-4o", true},
		{"empty model name is not filtered", "model-a", "", true},
		{"exact match", "model-a,model-b", "model-b", true},
		{"no match", "model-a,model-b", "model-c", false},
		{"wildcard entry matched via FormatMatchingModelName", "gpt-4-gizmo-*", "gpt-4-gizmo-abc123", true},
		{"raw gizmo name also matches itself", "gpt-4-gizmo-abc123", "gpt-4-gizmo-abc123", true},
		{"gizmo model not in whitelist", "gpt-4o-gizmo-*", "gpt-4-gizmo-abc123", false},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			require.Equal(t, tc.want, SubscriptionAllowsModel(tc.allowedModels, tc.modelName))
		})
	}
}

func TestPreConsumeUserSubscriptionPrefersAdminSource(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "prio-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "pru1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8301)
	now := common.GetTimestamp()

	// Order subscription expires sooner, so plain end_time ordering would pick it first.
	orderSub := &UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 100,
		Status:      SubscriptionStatusActive,
		Source:      SubscriptionSourceOrder,
		StartTime:   now - 10,
		EndTime:     now + 600,
	}
	require.NoError(t, DB.Create(orderSub).Error)
	adminSub := &UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 100,
		Status:      SubscriptionStatusActive,
		Source:      SubscriptionSourceAdmin,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}
	require.NoError(t, DB.Create(adminSub).Error)

	res, err := PreConsumeUserSubscription("req-priority-1", user.Id, "model-a", 1, 30)
	require.NoError(t, err)
	require.Equal(t, adminSub.Id, res.UserSubscriptionId)
	require.Equal(t, int64(30), res.PreConsumed)

	var reloaded UserSubscription
	require.NoError(t, DB.First(&reloaded, orderSub.Id).Error)
	require.Equal(t, int64(0), reloaded.AmountUsed)
}

func TestSortSubscriptionsByPriorityCustomFirst(t *testing.T) {
	now := common.GetTimestamp()
	orderSoon := UserSubscription{Id: 1, PlanId: 10, Source: SubscriptionSourceOrder, EndTime: now + 100}
	adminSoon := UserSubscription{Id: 2, PlanId: 11, Source: SubscriptionSourceAdmin, EndTime: now + 200}
	customLater := UserSubscription{Id: 3, PlanId: 0, Source: SubscriptionSourceAdmin, EndTime: now + 3600}
	adminLater := UserSubscription{Id: 4, PlanId: 12, Source: SubscriptionSourceAdmin, EndTime: now + 400}
	orderLater := UserSubscription{Id: 5, PlanId: 13, Source: SubscriptionSourceOrder, EndTime: now + 500}

	subs := []UserSubscription{orderSoon, adminSoon, customLater, adminLater, orderLater}
	sortSubscriptionsByPriority(subs)

	require.Equal(t, []int{3, 2, 4, 1, 5}, []int{subs[0].Id, subs[1].Id, subs[2].Id, subs[3].Id, subs[4].Id})
}

func TestPreConsumeUserSubscriptionPrefersCustomOverAdminPlan(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "custom-prio-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "cpu1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8305)
	now := common.GetTimestamp()

	adminPlanSub := &UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 100,
		Status:      SubscriptionStatusActive,
		Source:      SubscriptionSourceAdmin,
		StartTime:   now - 10,
		EndTime:     now + 600,
	}
	require.NoError(t, DB.Create(adminPlanSub).Error)

	customSub, err := AdminAssignCustomSubscription(user.Id, SubscriptionDurationDay, 30, 0, "", 100, "")
	require.NoError(t, err)
	require.NoError(t, DB.Model(customSub).Update("end_time", now+3600).Error)

	res, err := PreConsumeUserSubscription("req-custom-prio-1", user.Id, "model-a", 1, 30)
	require.NoError(t, err)
	require.Equal(t, customSub.Id, res.UserSubscriptionId)

	var reloaded UserSubscription
	require.NoError(t, DB.First(&reloaded, adminPlanSub.Id).Error)
	require.Equal(t, int64(0), reloaded.AmountUsed)
}

func TestGetSoonestSubscriptionLeftoverPrefersCustomOverAdminPlan(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "custom-soonest-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "csu1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8306)
	now := common.GetTimestamp()

	adminPlanSub := &UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 80,
		Status:      SubscriptionStatusActive,
		Source:      SubscriptionSourceAdmin,
		StartTime:   now - 10,
		EndTime:     now + 600,
	}
	require.NoError(t, DB.Create(adminPlanSub).Error)

	customSub, err := AdminAssignCustomSubscription(user.Id, SubscriptionDurationDay, 30, 0, "", 50, "")
	require.NoError(t, err)
	require.NoError(t, DB.Model(customSub).Update("end_time", now+3600).Error)

	leftover, unlimited, err := GetSoonestSubscriptionLeftoverForModel(user.Id, "model-a")
	require.NoError(t, err)
	require.False(t, unlimited)
	require.Equal(t, int64(50), leftover)
}

func TestPreConsumeUserSubscriptionSkipsDisallowedModel(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "allow-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "alu1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8302)
	now := common.GetTimestamp()

	restricted := &UserSubscription{
		UserId:        user.Id,
		PlanId:        plan.Id,
		AmountTotal:   100,
		Status:        SubscriptionStatusActive,
		Source:        SubscriptionSourceAdmin,
		AllowedModels: "model-a",
		StartTime:     now - 10,
		EndTime:       now + 3600,
	}
	require.NoError(t, DB.Create(restricted).Error)

	// Whitelisted model is charged normally.
	res, err := PreConsumeUserSubscription("req-allow-1", user.Id, "model-a", 1, 10)
	require.NoError(t, err)
	require.Equal(t, restricted.Id, res.UserSubscriptionId)

	// Non-whitelisted model behaves as if the user had no subscription at all,
	// so the billing session falls back to the wallet.
	_, err = PreConsumeUserSubscription("req-allow-2", user.Id, "model-b", 1, 10)
	require.Error(t, err)
	require.Contains(t, err.Error(), "no active subscription")

	usable, err := HasUsableSubscriptionQuotaForModel(user.Id, "model-b")
	require.NoError(t, err)
	require.False(t, usable)

	usable, err = HasUsableSubscriptionQuotaForModel(user.Id, "model-a")
	require.NoError(t, err)
	require.True(t, usable)
}

func TestPreConsumeUserSubscriptionFallsBackToUnrestrictedSubscription(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "fallback-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "fbu1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8303)
	now := common.GetTimestamp()

	restricted := &UserSubscription{
		UserId:        user.Id,
		PlanId:        plan.Id,
		AmountTotal:   100,
		Status:        SubscriptionStatusActive,
		Source:        SubscriptionSourceAdmin,
		AllowedModels: "model-a",
		StartTime:     now - 10,
		EndTime:       now + 600,
	}
	require.NoError(t, DB.Create(restricted).Error)
	open := &UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 100,
		Status:      SubscriptionStatusActive,
		Source:      SubscriptionSourceOrder,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}
	require.NoError(t, DB.Create(open).Error)

	res, err := PreConsumeUserSubscription("req-fallback-1", user.Id, "model-b", 1, 10)
	require.NoError(t, err)
	require.Equal(t, open.Id, res.UserSubscriptionId)
}

func TestAdminAssignCustomSubscriptionIsConsumable(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "custom-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "cru1"}
	require.NoError(t, DB.Create(user).Error)

	sub, err := AdminAssignCustomSubscription(user.Id, SubscriptionDurationDay, 7, 0, "model-a", 500, "  VIP 定制  ")
	require.NoError(t, err)
	require.Equal(t, 0, sub.PlanId)
	require.Equal(t, SubscriptionSourceAdmin, sub.Source)
	require.Equal(t, "model-a", sub.AllowedModels)
	require.Equal(t, "VIP 定制", sub.CustomName)
	require.Equal(t, int64(500), sub.AmountTotal)
	require.Greater(t, sub.EndTime, common.GetTimestamp())
	require.Equal(t, int64(0), sub.NextResetTime)

	// A plan-less subscription must still be chargeable: PlanId=0 skips the
	// plan lookup instead of treating "invalid plan id" as a consume error.
	res, err := PreConsumeUserSubscription("req-custom-1", user.Id, "model-a", 1, 120)
	require.NoError(t, err)
	require.Equal(t, sub.Id, res.UserSubscriptionId)
	require.Equal(t, int64(120), res.PreConsumed)

	remaining, unlimited, err := GetActiveSubscriptionRemainingForModel(user.Id, "model-a")
	require.NoError(t, err)
	require.False(t, unlimited)
	require.Equal(t, int64(380), remaining)
}

func TestAdminAssignCustomSubscriptionRejectsBadInput(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "custom-bad-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "cbu1"}
	require.NoError(t, DB.Create(user).Error)

	_, err := AdminAssignCustomSubscription(0, SubscriptionDurationDay, 7, 0, "", 100, "")
	require.Error(t, err)

	_, err = AdminAssignCustomSubscription(user.Id, SubscriptionDurationDay, 7, 0, "", -1, "")
	require.Error(t, err)

	_, err = AdminAssignCustomSubscription(user.Id, SubscriptionDurationDay, 7, 0, "model-a,,model-b", 100, "")
	require.Error(t, err)
}

func TestPreConsumeUserSubscriptionMissingPlanFails(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "missing-plan-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "mpu1"}
	require.NoError(t, DB.Create(user).Error)
	now := common.GetTimestamp()

	sub := &UserSubscription{
		UserId:      user.Id,
		PlanId:      9999,
		AmountTotal: 100,
		Status:      SubscriptionStatusActive,
		Source:      SubscriptionSourceOrder,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}
	require.NoError(t, DB.Create(sub).Error)

	_, err := PreConsumeUserSubscription("req-missing-plan-1", user.Id, "model-a", 1, 10)
	require.Error(t, err)
}
