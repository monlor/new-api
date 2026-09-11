package service

import (
	"net/http/httptest"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	relaycommon "github.com/QuantumNous/new-api/relay/common"
	"github.com/QuantumNous/new-api/types"
	"github.com/gin-gonic/gin"
	"github.com/stretchr/testify/require"
)

func seedBillingPlan(t *testing.T, id int) {
	t.Helper()
	require.NoError(t, model.DB.Create(&model.SubscriptionPlan{
		Id:               id,
		Title:            "billing-plan",
		PriceAmount:      1,
		Currency:         "USD",
		DurationUnit:     model.SubscriptionDurationMonth,
		DurationValue:    1,
		Enabled:          true,
		TotalAmount:      1000,
		QuotaResetPeriod: model.SubscriptionResetNever,
	}).Error)
}

func newBillingRelayInfo(userId int, requestId string, tokenType int, channelType int) *relaycommon.RelayInfo {
	return &relaycommon.RelayInfo{
		UserId:           userId,
		RequestId:        requestId,
		OriginModelName:  "gpt-test",
		TokenBillingType: tokenType,
		IsPlayground:     true,
		ChannelMeta: &relaycommon.ChannelMeta{
			ChannelBillingType: channelType,
		},
	}
}

func TestNewBillingSessionSplitsLeftoverSubscription(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 9101, 10_000)
	seedBillingPlan(t, 9102)
	now := common.GetTimestamp()
	sub := &model.UserSubscription{
		UserId:      9101,
		PlanId:      9102,
		AmountTotal: 100,
		AmountUsed:  70,
		Status:      model.SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}
	require.NoError(t, model.DB.Create(sub).Error)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := newBillingRelayInfo(9101, "split-leftover", model.ChannelBillingTypeAll, model.ChannelBillingTypeAll)
	session, apiErr := NewBillingSession(c, info, 100)
	require.Nil(t, apiErr)
	require.NotNil(t, session)

	split, ok := session.funding.(*SplitFunding)
	require.True(t, ok)
	require.Equal(t, int64(30), split.sub.preConsumed)
	require.Equal(t, 70, split.wallet.consumed)
	require.Equal(t, BillingSourceSubscription, session.funding.Source())
	require.Equal(t, 70, info.WalletQuotaDeducted)
	require.Equal(t, int64(30), info.SubscriptionPreConsumed)

	var stored model.UserSubscription
	require.NoError(t, model.DB.First(&stored, sub.Id).Error)
	require.Equal(t, int64(100), stored.AmountUsed)

	quota, err := model.GetUserQuota(9101, true)
	require.NoError(t, err)
	require.Equal(t, 10_000-70, quota)
}

func TestNewBillingSessionFullCoverUsesSubscriptionOnly(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 9107, 10_000)
	seedBillingPlan(t, 9108)
	now := common.GetTimestamp()
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		UserId:      9107,
		PlanId:      9108,
		AmountTotal: 500,
		AmountUsed:  0,
		Status:      model.SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}).Error)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := newBillingRelayInfo(9107, "full-cover-sub", model.ChannelBillingTypeAll, model.ChannelBillingTypeAll)
	session, apiErr := NewBillingSession(c, info, 80)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	_, isSub := session.funding.(*SubscriptionFunding)
	require.True(t, isSub)
	require.Equal(t, BillingSourceSubscription, session.funding.Source())
	require.Equal(t, 0, info.WalletQuotaDeducted)
	quota, err := model.GetUserQuota(9107, true)
	require.NoError(t, err)
	require.Equal(t, 10_000, quota)
}

func TestNewBillingSessionEmptySubscriptionUsesWallet(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 9103, 10_000)
	seedBillingPlan(t, 9104)
	now := common.GetTimestamp()
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		UserId:      9103,
		PlanId:      9104,
		AmountTotal: 100,
		AmountUsed:  100,
		Status:      model.SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}).Error)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := newBillingRelayInfo(9103, "empty-sub-wallet", model.ChannelBillingTypeAll, model.ChannelBillingTypeAll)
	session, apiErr := NewBillingSession(c, info, 40)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	_, isWallet := session.funding.(*WalletFunding)
	require.True(t, isWallet)
	require.Equal(t, BillingSourceWallet, session.funding.Source())
}

func TestNewBillingSessionSubscriptionOnlyDoesNotSplit(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 9105, 10_000)
	seedBillingPlan(t, 9106)
	now := common.GetTimestamp()
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		UserId:      9105,
		PlanId:      9106,
		AmountTotal: 100,
		AmountUsed:  70,
		Status:      model.SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}).Error)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := newBillingRelayInfo(9105, "sub-only-no-split", model.ChannelBillingTypeAll, model.ChannelBillingTypeSubscriptionOnly)
	session, apiErr := NewBillingSession(c, info, 50)
	require.Nil(t, session)
	require.NotNil(t, apiErr)
	require.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
}

func TestNewBillingSessionSplitDoesNotTrustBypass(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 9201, 6_000_000)
	seedBillingPlan(t, 9202)
	now := common.GetTimestamp()
	sub := &model.UserSubscription{
		UserId:      9201,
		PlanId:      9202,
		AmountTotal: 100,
		AmountUsed:  70,
		Status:      model.SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}
	require.NoError(t, model.DB.Create(sub).Error)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := newBillingRelayInfo(9201, "split-no-trust", model.ChannelBillingTypeAll, model.ChannelBillingTypeAll)
	info.TokenUnlimited = true
	session, apiErr := NewBillingSession(c, info, 100)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	require.False(t, session.trusted)
	require.Equal(t, 100, session.preConsumedQuota)

	split, ok := session.funding.(*SplitFunding)
	require.True(t, ok)
	require.Equal(t, int64(30), split.sub.preConsumed)
	require.Equal(t, 70, split.wallet.consumed)

	var stored model.UserSubscription
	require.NoError(t, model.DB.First(&stored, sub.Id).Error)
	require.Equal(t, int64(100), stored.AmountUsed)
	quota, err := model.GetUserQuota(9201, true)
	require.NoError(t, err)
	require.Equal(t, 6_000_000-70, quota)
}

func TestNewBillingSessionCombinedLeftoverUsesSplit(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 9211, 10_000)
	seedBillingPlan(t, 9212)
	now := common.GetTimestamp()
	first := &model.UserSubscription{
		UserId:      9211,
		PlanId:      9212,
		AmountTotal: 40,
		AmountUsed:  0,
		Status:      model.SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 1000,
	}
	second := &model.UserSubscription{
		UserId:      9211,
		PlanId:      9212,
		AmountTotal: 40,
		AmountUsed:  0,
		Status:      model.SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 2000,
	}
	require.NoError(t, model.DB.Create(first).Error)
	require.NoError(t, model.DB.Create(second).Error)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := newBillingRelayInfo(9211, "combined-leftover-split", model.ChannelBillingTypeAll, model.ChannelBillingTypeAll)
	session, apiErr := NewBillingSession(c, info, 50)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	_, isWallet := session.funding.(*WalletFunding)
	require.False(t, isWallet)
	split, ok := session.funding.(*SplitFunding)
	require.True(t, ok)
	require.Equal(t, int64(40), split.sub.preConsumed)
	require.Equal(t, 10, split.wallet.consumed)
	require.Equal(t, first.Id, split.sub.subscriptionId)

	var storedFirst, storedSecond model.UserSubscription
	require.NoError(t, model.DB.First(&storedFirst, first.Id).Error)
	require.NoError(t, model.DB.First(&storedSecond, second.Id).Error)
	require.Equal(t, int64(40), storedFirst.AmountUsed)
	require.Equal(t, int64(0), storedSecond.AmountUsed)
	quota, err := model.GetUserQuota(9211, true)
	require.NoError(t, err)
	require.Equal(t, 10_000-10, quota)
}

func TestNewBillingSessionCombinedLeftoverDoesNotOverdraftWallet(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 9261, 5)
	seedBillingPlan(t, 9262)
	now := common.GetTimestamp()
	first := &model.UserSubscription{
		UserId:      9261,
		PlanId:      9262,
		AmountTotal: 40,
		AmountUsed:  0,
		Status:      model.SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 1000,
	}
	second := &model.UserSubscription{
		UserId:      9261,
		PlanId:      9262,
		AmountTotal: 40,
		AmountUsed:  0,
		Status:      model.SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 2000,
	}
	require.NoError(t, model.DB.Create(first).Error)
	require.NoError(t, model.DB.Create(second).Error)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := newBillingRelayInfo(9261, "combined-leftover-overdraft", model.ChannelBillingTypeAll, model.ChannelBillingTypeAll)
	session, apiErr := NewBillingSession(c, info, 50)
	require.Nil(t, session)
	require.NotNil(t, apiErr)
	require.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())

	quota, err := model.GetUserQuota(9261, true)
	require.NoError(t, err)
	require.Equal(t, 5, quota)
	require.GreaterOrEqual(t, quota, 0)

	var storedFirst, storedSecond model.UserSubscription
	require.NoError(t, model.DB.First(&storedFirst, first.Id).Error)
	require.NoError(t, model.DB.First(&storedSecond, second.Id).Error)
	require.Equal(t, int64(0), storedFirst.AmountUsed)
	require.Equal(t, int64(0), storedSecond.AmountUsed)
}

func TestEnsureBillingSessionForChannelRejectsSplitOnRestrictedChannels(t *testing.T) {
	gin.SetMode(gin.TestMode)

	newSplit := func(t *testing.T, userId, planId int, requestId string) (*BillingSession, *relaycommon.RelayInfo, *gin.Context, *model.UserSubscription) {
		t.Helper()
		truncate(t)
		seedUser(t, userId, 10_000)
		seedBillingPlan(t, planId)
		now := common.GetTimestamp()
		sub := &model.UserSubscription{
			UserId:      userId,
			PlanId:      planId,
			AmountTotal: 100,
			AmountUsed:  70,
			Status:      model.SubscriptionStatusActive,
			StartTime:   now - 10,
			EndTime:     now + 3600,
		}
		require.NoError(t, model.DB.Create(sub).Error)
		c, _ := gin.CreateTestContext(httptest.NewRecorder())
		info := newBillingRelayInfo(userId, requestId, model.ChannelBillingTypeAll, model.ChannelBillingTypeAll)
		session, apiErr := NewBillingSession(c, info, 100)
		require.Nil(t, apiErr)
		require.NotNil(t, session)
		_, ok := session.funding.(*SplitFunding)
		require.True(t, ok)
		info.Billing = session
		return session, info, c, sub
	}

	t.Run("subscription-only does not keep split", func(t *testing.T) {
		session, info, c, sub := newSplit(t, 9221, 9222, "split-to-sub-only")
		info.ChannelMeta.ChannelBillingType = model.ChannelBillingTypeSubscriptionOnly
		apiErr := EnsureBillingSessionForChannel(c, info, 100)
		if apiErr == nil {
			rebuilt, ok := info.Billing.(*BillingSession)
			require.True(t, ok)
			_, rebuiltSplit := rebuilt.funding.(*SplitFunding)
			require.False(t, rebuiltSplit, "subscription-only channel must not keep split funding")
			require.NotEqual(t, session, info.Billing)
		} else {
			require.Equal(t, types.ErrorCodeInsufficientUserQuota, apiErr.GetErrorCode())
			require.NotEqual(t, types.ErrorCodeUpdateDataError, apiErr.GetErrorCode())
			require.Nil(t, info.Billing)
		}
		var stored model.UserSubscription
		require.NoError(t, model.DB.First(&stored, sub.Id).Error)
		require.Equal(t, int64(70), stored.AmountUsed)
	})

	t.Run("wallet-only rebuilds to wallet and restores leftover", func(t *testing.T) {
		_, info, c, sub := newSplit(t, 9231, 9232, "split-to-wallet-only")
		info.ChannelMeta.ChannelBillingType = model.ChannelBillingTypeWalletOnly
		apiErr := EnsureBillingSessionForChannel(c, info, 100)
		require.Nil(t, apiErr)
		require.NotNil(t, info.Billing)
		rebuilt, ok := info.Billing.(*BillingSession)
		require.True(t, ok)
		_, isWallet := rebuilt.funding.(*WalletFunding)
		require.True(t, isWallet)
		require.Equal(t, 100, info.WalletQuotaDeducted)
		require.Equal(t, int64(0), info.SubscriptionPreConsumed)

		var stored model.UserSubscription
		require.NoError(t, model.DB.First(&stored, sub.Id).Error)
		require.Equal(t, int64(70), stored.AmountUsed)
		quota, err := model.GetUserQuota(9231, true)
		require.NoError(t, err)
		require.Equal(t, 10_000-100, quota)
	})

	t.Run("unrestricted keeps split", func(t *testing.T) {
		session, info, c, sub := newSplit(t, 9241, 9242, "split-keep-all")
		info.ChannelMeta.ChannelBillingType = model.ChannelBillingTypeAll
		require.Nil(t, EnsureBillingSessionForChannel(c, info, 100))
		require.Equal(t, session, info.Billing)
		_, stillSplit := session.funding.(*SplitFunding)
		require.True(t, stillSplit)

		var stored model.UserSubscription
		require.NoError(t, model.DB.First(&stored, sub.Id).Error)
		require.Equal(t, int64(100), stored.AmountUsed)
	})
}

func TestSplitFundingSettleDeltaBumpsWalletConsumed(t *testing.T) {
	truncate(t)
	gin.SetMode(gin.TestMode)
	seedUser(t, 9251, 10_000)
	seedBillingPlan(t, 9252)
	now := common.GetTimestamp()
	require.NoError(t, model.DB.Create(&model.UserSubscription{
		UserId:      9251,
		PlanId:      9252,
		AmountTotal: 100,
		AmountUsed:  70,
		Status:      model.SubscriptionStatusActive,
		StartTime:   now - 10,
		EndTime:     now + 3600,
	}).Error)

	c, _ := gin.CreateTestContext(httptest.NewRecorder())
	info := newBillingRelayInfo(9251, "split-settle-delta", model.ChannelBillingTypeAll, model.ChannelBillingTypeAll)
	session, apiErr := NewBillingSession(c, info, 100)
	require.Nil(t, apiErr)
	require.NotNil(t, session)
	require.NoError(t, session.Settle(120))
	require.Equal(t, 90, info.WalletQuotaDeducted)

	quota, err := model.GetUserQuota(9251, true)
	require.NoError(t, err)
	require.Equal(t, 10_000-90, quota)
}
