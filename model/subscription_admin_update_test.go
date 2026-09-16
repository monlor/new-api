package model

import (
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func seedAdminUpdateUser(t *testing.T, username, affCode, group string) *User {
	t.Helper()
	user := &User{
		Username: username,
		Password: "password1",
		Quota:    1000,
		Status:   1,
		AffCode:  affCode,
		Group:    group,
	}
	require.NoError(t, DB.Create(user).Error)
	return user
}

func seedAdminUpdateSub(t *testing.T, userId int, status string, endTime int64, used int64) *UserSubscription {
	t.Helper()
	plan := seedSubscriptionPlan(t, userId+9000)
	now := common.GetTimestamp()
	sub := &UserSubscription{
		UserId:        userId,
		PlanId:        plan.Id,
		AmountTotal:   100,
		AmountUsed:    used,
		StartTime:     now - 3600,
		EndTime:       endTime,
		Status:        status,
		UpgradeGroup:  "vip",
		PrevUserGroup: "default",
	}
	require.NoError(t, DB.Create(sub).Error)
	return sub
}

func TestAdminUpdateUserSubscription_CancelledSaveKeepsEndTime(t *testing.T) {
	truncateTables(t)
	user := seedAdminUpdateUser(t, "admin-edit-keep", "aek1", "default")
	historicalEnd := common.GetTimestamp() - 86400
	sub := seedAdminUpdateSub(t, user.Id, SubscriptionStatusCancelled, historicalEnd, 10)

	used := int64(20)
	status := SubscriptionStatusCancelled
	updated, err := AdminUpdateUserSubscription(sub.Id, &used, nil, nil, &status, nil, nil)
	require.NoError(t, err)
	require.Equal(t, historicalEnd, updated.EndTime)
	require.Equal(t, SubscriptionStatusCancelled, updated.Status)
	require.Equal(t, int64(20), updated.AmountUsed)
	require.Equal(t, "vip", updated.UpgradeGroup)
	require.Equal(t, "default", updated.PrevUserGroup)
}

func TestAdminUpdateUserSubscription_TransitionToCancelledStampsEndTime(t *testing.T) {
	truncateTables(t)
	user := seedAdminUpdateUser(t, "admin-edit-cancel", "aec1", "vip")
	futureEnd := common.GetTimestamp() + 86400
	sub := seedAdminUpdateSub(t, user.Id, SubscriptionStatusActive, futureEnd, 10)

	before := common.GetTimestamp()
	status := SubscriptionStatusCancelled
	updated, err := AdminUpdateUserSubscription(sub.Id, nil, nil, nil, &status, nil, nil)
	require.NoError(t, err)
	after := common.GetTimestamp()

	require.Equal(t, SubscriptionStatusCancelled, updated.Status)
	require.GreaterOrEqual(t, updated.EndTime, before)
	require.LessOrEqual(t, updated.EndTime, after)
	require.NotEqual(t, futureEnd, updated.EndTime)

	var stored User
	require.NoError(t, DB.First(&stored, user.Id).Error)
	require.Equal(t, "default", stored.Group)
}

func TestAdminUpdateUserSubscription_ReactivateRestoresUpgradeGroup(t *testing.T) {
	for _, fromStatus := range []string{SubscriptionStatusCancelled, SubscriptionStatusExpired} {
		t.Run(fromStatus, func(t *testing.T) {
			truncateTables(t)
			user := seedAdminUpdateUser(t, "admin-edit-reactivate-"+fromStatus, "aer"+fromStatus[:3], "default")
			pastEnd := common.GetTimestamp() - 3600
			sub := seedAdminUpdateSub(t, user.Id, fromStatus, pastEnd, 10)

			status := SubscriptionStatusActive
			endTime := common.GetTimestamp() + 86400
			updated, err := AdminUpdateUserSubscription(sub.Id, nil, nil, &endTime, &status, nil, nil)
			require.NoError(t, err)
			require.Equal(t, SubscriptionStatusActive, updated.Status)
			require.Equal(t, endTime, updated.EndTime)
			require.Equal(t, "vip", updated.UpgradeGroup)
			require.Equal(t, "default", updated.PrevUserGroup)

			var stored User
			require.NoError(t, DB.First(&stored, user.Id).Error)
			require.Equal(t, "vip", stored.Group)
		})
	}
}
