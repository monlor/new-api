package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func seedSubscriptionPlan(t *testing.T, id int) *SubscriptionPlan {
	t.Helper()
	return seedSubscriptionPlanReset(t, id, SubscriptionResetNever)
}

func seedSubscriptionPlanReset(t *testing.T, id int, period string) *SubscriptionPlan {
	t.Helper()
	plan := &SubscriptionPlan{
		Id:               id,
		Title:            "remain-plan",
		PriceAmount:      1,
		Currency:         "USD",
		DurationUnit:     SubscriptionDurationMonth,
		DurationValue:    1,
		Enabled:          true,
		TotalAmount:      1000,
		QuotaResetPeriod: period,
	}
	require.NoError(t, DB.Create(plan).Error)
	return plan
}

func TestGetActiveSubscriptionRemaining(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "remain-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "rmu1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8101)
	now := common.GetTimestamp()

	remaining, unlimited, err := GetActiveSubscriptionRemaining(user.Id)
	require.NoError(t, err)
	require.False(t, unlimited)
	require.Equal(t, int64(0), remaining)

	require.NoError(t, DB.Create(&UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 100,
		AmountUsed:  70,
		Status:      SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}).Error)

	remaining, unlimited, err = GetActiveSubscriptionRemaining(user.Id)
	require.NoError(t, err)
	require.False(t, unlimited)
	require.Equal(t, int64(30), remaining)

	usable, err := HasUsableSubscriptionQuota(user.Id)
	require.NoError(t, err)
	require.True(t, usable)
}

func TestHasUsableSubscriptionQuotaTreatsEmptyActiveAsUnusable(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "empty-sub-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "esu1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8102)
	now := common.GetTimestamp()
	require.NoError(t, DB.Create(&UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 100,
		AmountUsed:  100,
		Status:      SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}).Error)

	active, err := HasActiveUserSubscription(user.Id)
	require.NoError(t, err)
	require.True(t, active)

	usable, err := HasUsableSubscriptionQuota(user.Id)
	require.NoError(t, err)
	require.False(t, usable)
}

func TestPreConsumeUserSubscriptionUpToUsesLeftover(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "partial-sub-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "psu1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8103)
	now := common.GetTimestamp()
	sub := &UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 100,
		AmountUsed:  70,
		Status:      SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}
	require.NoError(t, DB.Create(sub).Error)

	_, err := PreConsumeUserSubscription("req-full", user.Id, "gpt-test", 0, 50)
	require.Error(t, err)
	require.Contains(t, err.Error(), "subscription quota insufficient")

	res, err := PreConsumeUserSubscriptionUpTo("req-partial", user.Id, "gpt-test", 0, 50)
	require.NoError(t, err)
	require.Equal(t, int64(30), res.PreConsumed)
	require.Equal(t, sub.Id, res.UserSubscriptionId)

	var stored UserSubscription
	require.NoError(t, DB.First(&stored, sub.Id).Error)
	require.Equal(t, int64(100), stored.AmountUsed)
}

func TestPreConsumeUserSubscriptionUpToPrefersFullCover(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "cover-sub-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "csu1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8104)
	now := common.GetTimestamp()
	small := &UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 40,
		AmountUsed:  30,
		Status:      SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 1000,
	}
	large := &UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 200,
		AmountUsed:  0,
		Status:      SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 2000,
	}
	require.NoError(t, DB.Create(small).Error)
	require.NoError(t, DB.Create(large).Error)

	res, err := PreConsumeUserSubscriptionUpTo("req-cover", user.Id, "gpt-test", 0, 50)
	require.NoError(t, err)
	require.Equal(t, int64(50), res.PreConsumed)
	require.Equal(t, large.Id, res.UserSubscriptionId)
}

func TestGetActiveSubscriptionRemainingTreatsDueResetAsUsable(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "due-reset-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "dru1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlanReset(t, 8105, SubscriptionResetMonthly)
	now := common.GetTimestamp()
	sub := &UserSubscription{
		UserId:        user.Id,
		PlanId:        plan.Id,
		AmountTotal:   100,
		AmountUsed:    100,
		Status:        SubscriptionStatusActive,
		StartTime:     now - 40*24*3600,
		EndTime:       now + 60*24*3600,
		LastResetTime: now - 40*24*3600,
		NextResetTime: now - 10,
	}
	require.NoError(t, DB.Create(sub).Error)

	remaining, unlimited, err := GetActiveSubscriptionRemaining(user.Id)
	require.NoError(t, err)
	require.False(t, unlimited)
	require.Equal(t, int64(100), remaining)

	usable, err := HasUsableSubscriptionQuota(user.Id)
	require.NoError(t, err)
	require.True(t, usable)

	var stored UserSubscription
	require.NoError(t, DB.Where("user_id = ?", user.Id).First(&stored).Error)
	require.Equal(t, int64(100), stored.AmountUsed)

	res, err := PreConsumeUserSubscription("req-due-reset", user.Id, "gpt-test", 0, 50)
	require.NoError(t, err)
	require.Equal(t, int64(50), res.PreConsumed)
	require.NoError(t, DB.First(&stored, sub.Id).Error)
	require.Equal(t, int64(50), stored.AmountUsed)
}

func TestGetActiveSubscriptionRemainingNeverResetExhaustedStaysUnusable(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "never-reset-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "nru1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8106)
	now := common.GetTimestamp()
	require.NoError(t, DB.Create(&UserSubscription{
		UserId:        user.Id,
		PlanId:        plan.Id,
		AmountTotal:   100,
		AmountUsed:    100,
		Status:        SubscriptionStatusActive,
		StartTime:     now - 10,
		EndTime:       now + 3600,
		NextResetTime: 0,
	}).Error)

	remaining, unlimited, err := GetActiveSubscriptionRemaining(user.Id)
	require.NoError(t, err)
	require.False(t, unlimited)
	require.Equal(t, int64(0), remaining)

	usable, err := HasUsableSubscriptionQuota(user.Id)
	require.NoError(t, err)
	require.False(t, usable)
}

func TestGetActiveSubscriptionRemainingResetNeverStaleNextResetStaysUnusable(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "never-stale-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "nsu1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlanReset(t, 8107, SubscriptionResetNever)
	now := common.GetTimestamp()
	require.NoError(t, DB.Create(&UserSubscription{
		UserId:        user.Id,
		PlanId:        plan.Id,
		AmountTotal:   100,
		AmountUsed:    100,
		Status:        SubscriptionStatusActive,
		StartTime:     now - 3600,
		EndTime:       now + 3600,
		NextResetTime: now - 10,
	}).Error)

	remaining, unlimited, err := GetActiveSubscriptionRemaining(user.Id)
	require.NoError(t, err)
	require.False(t, unlimited)
	require.Equal(t, int64(0), remaining)

	usable, err := HasUsableSubscriptionQuota(user.Id)
	require.NoError(t, err)
	require.False(t, usable)
}

func TestCanFullyCoverSubscriptionNeedRequiresSingleSub(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "cover-need-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "cnu1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8108)
	now := common.GetTimestamp()
	require.NoError(t, DB.Create(&UserSubscription{
		UserId: user.Id, PlanId: plan.Id, AmountTotal: 40, AmountUsed: 0,
		Status: SubscriptionStatusActive, StartTime: now - 10, EndTime: now + 1000,
	}).Error)
	require.NoError(t, DB.Create(&UserSubscription{
		UserId: user.Id, PlanId: plan.Id, AmountTotal: 40, AmountUsed: 0,
		Status: SubscriptionStatusActive, StartTime: now - 10, EndTime: now + 2000,
	}).Error)

	cover, err := CanFullyCoverSubscriptionNeed(user.Id, 50)
	require.NoError(t, err)
	require.False(t, cover)

	require.NoError(t, DB.Create(&UserSubscription{
		UserId: user.Id, PlanId: plan.Id, AmountTotal: 80, AmountUsed: 0,
		Status: SubscriptionStatusActive, StartTime: now - 10, EndTime: now + 3000,
	}).Error)
	cover, err = CanFullyCoverSubscriptionNeed(user.Id, 50)
	require.NoError(t, err)
	require.True(t, cover)
}

func TestPreConsumeUserSubscriptionReusesRefundedRequestId(t *testing.T) {
	truncateTables(t)
	user := &User{Username: "reuse-req-user", Password: "password1", Quota: 1000, Status: 1, AffCode: "rru1"}
	require.NoError(t, DB.Create(user).Error)
	plan := seedSubscriptionPlan(t, 8109)
	now := common.GetTimestamp()
	sub := &UserSubscription{
		UserId:      user.Id,
		PlanId:      plan.Id,
		AmountTotal: 100,
		AmountUsed:  0,
		Status:      SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}
	require.NoError(t, DB.Create(sub).Error)

	first, err := PreConsumeUserSubscription("req-reuse", user.Id, "gpt-test", 0, 30)
	require.NoError(t, err)
	require.Equal(t, int64(30), first.PreConsumed)
	require.NoError(t, RefundSubscriptionPreConsume("req-reuse"))

	var afterRefund UserSubscription
	require.NoError(t, DB.First(&afterRefund, sub.Id).Error)
	require.Equal(t, int64(0), afterRefund.AmountUsed)

	second, err := PreConsumeUserSubscription("req-reuse", user.Id, "gpt-test", 0, 20)
	require.NoError(t, err)
	require.Equal(t, int64(20), second.PreConsumed)
	require.Equal(t, sub.Id, second.UserSubscriptionId)

	var stored UserSubscription
	require.NoError(t, DB.First(&stored, sub.Id).Error)
	require.Equal(t, int64(20), stored.AmountUsed)

	var rec SubscriptionPreConsumeRecord
	require.NoError(t, DB.Where("request_id = ?", "req-reuse").First(&rec).Error)
	require.Equal(t, "consumed", rec.Status)
	require.Equal(t, int64(20), rec.PreConsumed)
}
