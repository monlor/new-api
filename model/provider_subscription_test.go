package model

import (
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/stretchr/testify/require"
)

func seedStripeSubscriptionOrder(t *testing.T) (*SubscriptionOrder, *SubscriptionPlan) {
	t.Helper()
	user := &User{Id: 9001, Username: "stripe_recurring", Status: common.UserStatusEnabled}
	require.NoError(t, DB.Create(user).Error)
	plan := &SubscriptionPlan{
		Id: 9002, Title: "Recurring", PriceAmount: 10, Currency: "USD",
		DurationUnit: SubscriptionDurationMonth, DurationValue: 1,
		Enabled: true, TotalAmount: 1000, StripePriceId: "price_recurring",
	}
	require.NoError(t, DB.Create(plan).Error)
	order := &SubscriptionOrder{
		UserId: user.Id, PlanId: plan.Id, Money: plan.PriceAmount,
		TradeNo: "sub_ref_recurring", PaymentMethod: PaymentMethodStripe,
		PaymentProvider: PaymentProviderStripe, Status: common.TopUpStatusPending,
		CreateTime: common.GetTimestamp(),
	}
	require.NoError(t, DB.Create(order).Error)
	return order, plan
}

func TestCompleteStripeSubscriptionCheckoutIsAtomicAndIdempotent(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_recurring", SubscriptionId: "sub_recurring",
		PriceId: "price_recurring", Status: "active",
		PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout", "checkout.session.completed", now, order.TradeNo, "{}", state))
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout", "checkout.session.completed", now, order.TradeNo, "{}", state))

	var subscriptionCount int64
	require.NoError(t, DB.Model(&UserSubscription{}).Where("user_id = ?", order.UserId).Count(&subscriptionCount).Error)
	require.Equal(t, int64(1), subscriptionCount)

	var mapping ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&mapping).Error)
	require.Positive(t, mapping.UserSubscriptionId)
	require.Equal(t, state.CustomerId, mapping.ProviderCustomerId)

	var user User
	require.NoError(t, DB.First(&user, order.UserId).Error)
	require.Equal(t, state.CustomerId, user.StripeCustomer)
}

func TestStripeInvoiceRenewalResetsQuotaOnce(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_renew", SubscriptionId: "sub_renew", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_renew", "checkout.session.completed", now, order.TradeNo, "{}", state))

	var mapping ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&mapping).Error)
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", mapping.UserSubscriptionId).Update("amount_used", 600).Error)

	// The first subscription_create invoice only synchronizes provider state.
	require.NoError(t, ProcessStripeInvoicePaid("evt_first_invoice", "invoice.paid", now+1, state.SubscriptionId, "in_first", now, state.PeriodEnd, "", false))
	var local UserSubscription
	require.NoError(t, DB.First(&local, mapping.UserSubscriptionId).Error)
	require.Equal(t, int64(600), local.AmountUsed)

	renewalStart := state.PeriodEnd
	renewalEnd := renewalStart + 31*24*60*60
	require.NoError(t, ProcessStripeInvoicePaid("evt_renewal", "invoice.paid", now+2, state.SubscriptionId, "in_renewal", renewalStart, renewalEnd, "price_recurring", true))
	require.NoError(t, DB.First(&local, mapping.UserSubscriptionId).Error)
	require.Zero(t, local.AmountUsed)
	require.Equal(t, renewalEnd, local.EndTime)

	// A distinct delivery for the same invoice cannot grant a second reset.
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", local.Id).Update("amount_used", 123).Error)
	require.NoError(t, ProcessStripeInvoicePaid("evt_renewal_duplicate", "invoice.paid", now+3, state.SubscriptionId, "in_renewal", renewalStart, renewalEnd, "price_recurring", true))
	require.NoError(t, DB.First(&local, mapping.UserSubscriptionId).Error)
	require.Equal(t, int64(123), local.AmountUsed)
}

func TestStripeSubscriptionPriceDriftIsRejectedWithoutChangingMapping(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_price_drift", SubscriptionId: "sub_price_drift", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_price_drift", "checkout.session.completed", now, order.TradeNo, "{}", state))

	var before ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&before).Error)
	drifted := state
	drifted.PriceId = "price_cheaper"
	drifted.PeriodStart = state.PeriodEnd
	drifted.PeriodEnd = state.PeriodEnd + 30*24*60*60
	drifted.Status = "past_due"
	err := SyncStripeSubscription("evt_subscription_price_drift", "customer.subscription.updated", now+1, drifted, false)
	require.ErrorContains(t, err, "does not match local plan")
	var eventCount int64
	require.NoError(t, DB.Model(&ProviderWebhookEvent{}).Where("event_id = ?", "evt_subscription_price_drift").Count(&eventCount).Error)
	require.Zero(t, eventCount)

	var after ProviderSubscription
	require.NoError(t, DB.First(&after, before.Id).Error)
	require.Equal(t, before.ProviderPriceId, after.ProviderPriceId)
	require.Equal(t, before.Status, after.Status)
	require.Equal(t, before.CurrentPeriodStart, after.CurrentPeriodStart)
	require.Equal(t, before.CurrentPeriodEnd, after.CurrentPeriodEnd)
	require.Equal(t, before.LastSubscriptionEventAt, after.LastSubscriptionEventAt)
	require.Equal(t, before.LastStateEventAt, after.LastStateEventAt)
}

func TestStripeRenewalPaidPriceMismatchIsRejectedWithoutChangingState(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_paid_price_mismatch", SubscriptionId: "sub_paid_price_mismatch", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_paid_price_mismatch", "checkout.session.completed", now, order.TradeNo, "{}", state))

	var beforeMapping ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&beforeMapping).Error)
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", beforeMapping.UserSubscriptionId).Update("amount_used", 777).Error)
	var beforeSubscription UserSubscription
	require.NoError(t, DB.First(&beforeSubscription, beforeMapping.UserSubscriptionId).Error)

	renewalStart := state.PeriodEnd
	renewalEnd := renewalStart + 30*24*60*60
	err := ProcessStripeInvoicePaid("evt_paid_price_mismatch", "invoice.paid", now+1, state.SubscriptionId, "in_price_mismatch", renewalStart, renewalEnd, "price_cheaper", true)
	require.ErrorContains(t, err, "does not match subscription mapping")
	var eventCount int64
	require.NoError(t, DB.Model(&ProviderWebhookEvent{}).Where("event_id = ?", "evt_paid_price_mismatch").Count(&eventCount).Error)
	require.Zero(t, eventCount)

	var afterMapping ProviderSubscription
	require.NoError(t, DB.First(&afterMapping, beforeMapping.Id).Error)
	require.Equal(t, beforeMapping.Status, afterMapping.Status)
	require.Equal(t, beforeMapping.CurrentPeriodStart, afterMapping.CurrentPeriodStart)
	require.Equal(t, beforeMapping.CurrentPeriodEnd, afterMapping.CurrentPeriodEnd)
	require.Equal(t, beforeMapping.LastInvoiceId, afterMapping.LastInvoiceId)
	require.Equal(t, beforeMapping.LastInvoiceEventAt, afterMapping.LastInvoiceEventAt)
	require.Equal(t, beforeMapping.LastInvoicePeriodEnd, afterMapping.LastInvoicePeriodEnd)
	require.Equal(t, beforeMapping.LastPaidPeriodEnd, afterMapping.LastPaidPeriodEnd)
	require.Equal(t, beforeMapping.LastStateEventAt, afterMapping.LastStateEventAt)

	var afterSubscription UserSubscription
	require.NoError(t, DB.First(&afterSubscription, beforeMapping.UserSubscriptionId).Error)
	require.Equal(t, beforeSubscription.AmountUsed, afterSubscription.AmountUsed)
	require.Equal(t, beforeSubscription.EndTime, afterSubscription.EndTime)
}

func TestStripeRenewalPaidPriceMustAlsoMatchLocalPlan(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_paid_plan_mismatch", SubscriptionId: "sub_paid_plan_mismatch", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_paid_plan_mismatch", "checkout.session.completed", now, order.TradeNo, "{}", state))

	var before ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&before).Error)
	require.NoError(t, DB.Model(&ProviderSubscription{}).Where("id = ?", before.Id).Update("provider_price_id", "price_cheaper").Error)
	require.NoError(t, DB.First(&before, before.Id).Error)

	renewalStart := state.PeriodEnd
	renewalEnd := renewalStart + 30*24*60*60
	err := ProcessStripeInvoicePaid("evt_paid_plan_mismatch", "invoice.paid", now+1, state.SubscriptionId, "in_plan_mismatch", renewalStart, renewalEnd, "price_cheaper", true)
	require.ErrorContains(t, err, "does not match local plan")

	var after ProviderSubscription
	require.NoError(t, DB.First(&after, before.Id).Error)
	require.Equal(t, before, after)
	var eventCount int64
	require.NoError(t, DB.Model(&ProviderWebhookEvent{}).Where("event_id = ?", "evt_paid_plan_mismatch").Count(&eventCount).Error)
	require.Zero(t, eventCount)
}

func TestStripePaymentFailureKeepsLocalAccess(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_failed", SubscriptionId: "sub_failed", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_failed", "checkout.session.completed", now, order.TradeNo, "{}", state))
	require.NoError(t, ProcessStripeInvoicePaid("evt_initial_paid", "invoice.paid", now+1, state.SubscriptionId, "in_initial", now, state.PeriodEnd, "", false))
	renewalStart := state.PeriodEnd
	renewalEnd := renewalStart + 30*24*60*60
	require.NoError(t, ProcessStripeInvoiceFailed("evt_failed", "invoice.payment_failed", now+2, state.SubscriptionId, "in_failed", renewalEnd))

	var mapping ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&mapping).Error)
	require.Equal(t, "past_due", mapping.Status)
	var local UserSubscription
	require.NoError(t, DB.First(&local, mapping.UserSubscriptionId).Error)
	require.Equal(t, SubscriptionStatusActive, local.Status)
	require.Greater(t, local.EndTime, now)

	// Stripe can later recover the same invoice after Smart Retries or a
	// payment-method update. A failure must not mark that invoice as paid.
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", local.Id).Update("amount_used", 500).Error)
	require.NoError(t, ProcessStripeInvoicePaid("evt_failed_recovered", "invoice.paid", now+3, state.SubscriptionId, "in_failed", renewalStart, renewalEnd, "price_recurring", true))
	require.NoError(t, DB.First(&local, mapping.UserSubscriptionId).Error)
	require.Zero(t, local.AmountUsed)
	require.Equal(t, renewalEnd, local.EndTime)
}

func TestStripeOutOfOrderEventsDoNotRegressRecoveredSubscription(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_ordering", SubscriptionId: "sub_ordering", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_ordering", "checkout.session.completed", now, order.TradeNo, "{}", state))

	renewalStart := state.PeriodEnd
	renewalEnd := renewalStart + 30*24*60*60
	require.NoError(t, ProcessStripeInvoicePaid("evt_paid_new", "invoice.paid", now+20, state.SubscriptionId, "in_new", renewalStart, renewalEnd, "price_recurring", true))
	require.NoError(t, ProcessStripeInvoiceFailed("evt_failed_old", "invoice.payment_failed", now+10, state.SubscriptionId, "in_old", state.PeriodEnd))

	var mapping ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&mapping).Error)
	require.Equal(t, "active", mapping.Status)
	require.Equal(t, renewalEnd, mapping.CurrentPeriodEnd)

	staleState := state
	staleState.Status = "past_due"
	staleState.PriceId = "price_cheaper"
	staleState.PeriodStart = renewalStart
	staleState.PeriodEnd = renewalEnd
	require.NoError(t, SyncStripeSubscription("evt_subscription_old", "customer.subscription.updated", now+5, staleState, false))
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&mapping).Error)
	require.Equal(t, "active", mapping.Status)
	require.Equal(t, renewalEnd, mapping.CurrentPeriodEnd)
}

func TestStripeOlderPaidInvoiceCannotResetNewerPeriodQuota(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_paid_ordering", SubscriptionId: "sub_paid_ordering", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_paid_ordering", "checkout.session.completed", now, order.TradeNo, "{}", state))

	newStart := state.PeriodEnd
	newEnd := newStart + 30*24*60*60
	require.NoError(t, ProcessStripeInvoicePaid("evt_paid_latest", "invoice.paid", now+20, state.SubscriptionId, "in_latest", newStart, newEnd, "price_recurring", true))

	var mapping ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&mapping).Error)
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", mapping.UserSubscriptionId).Update("amount_used", 321).Error)
	require.NoError(t, ProcessStripeInvoicePaid("evt_paid_stale", "invoice.paid", now+10, state.SubscriptionId, "in_stale", state.PeriodStart, state.PeriodEnd, "price_cheaper", true))

	var local UserSubscription
	require.NoError(t, DB.First(&local, mapping.UserSubscriptionId).Error)
	require.Equal(t, int64(321), local.AmountUsed)
	require.Equal(t, newEnd, local.EndTime)
}

func TestGetStripeCustomerForUserSubscriptionChecksExactOwner(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_owned", SubscriptionId: "sub_owned", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_owned", "checkout.session.completed", now, order.TradeNo, "{}", state))

	var mapping ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&mapping).Error)
	customerId, err := GetStripeCustomerForUserSubscription(order.UserId, mapping.UserSubscriptionId)
	require.NoError(t, err)
	require.Equal(t, state.CustomerId, customerId)

	_, err = GetStripeCustomerForUserSubscription(order.UserId+1, mapping.UserSubscriptionId)
	require.ErrorIs(t, err, ErrProviderSubscriptionNotFound)
	_, err = GetStripeCustomerForUserSubscription(order.UserId, mapping.UserSubscriptionId+1)
	require.ErrorIs(t, err, ErrProviderSubscriptionNotFound)
}

func TestStripeInvoicePaidCASAllowsOnlyOneQuotaReset(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_cas", SubscriptionId: "sub_cas", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_cas", "checkout.session.completed", now, order.TradeNo, "{}", state))

	var previous ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&previous).Error)
	next := previous
	next.LastInvoiceId = "in_cas"
	next.LastInvoiceEventAt = now + 1
	next.LastInvoicePeriodEnd = state.PeriodEnd + 30*24*60*60
	next.LastPaidPeriodEnd = next.LastInvoicePeriodEnd
	next.LastStateEventAt = now + 1
	next.CurrentPeriodStart = state.PeriodEnd
	next.CurrentPeriodEnd = next.LastInvoicePeriodEnd

	firstClaimed, err := claimStripeInvoicePaidTx(DB, previous, next)
	require.NoError(t, err)
	require.True(t, firstClaimed)
	if firstClaimed {
		require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", previous.UserSubscriptionId).Update("amount_used", 0).Error)
	}
	require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", previous.UserSubscriptionId).Update("amount_used", 123).Error)

	secondClaimed, err := claimStripeInvoicePaidTx(DB, previous, next)
	require.NoError(t, err)
	require.False(t, secondClaimed)
	if secondClaimed {
		require.NoError(t, DB.Model(&UserSubscription{}).Where("id = ?", previous.UserSubscriptionId).Update("amount_used", 0).Error)
	}

	var local UserSubscription
	require.NoError(t, DB.First(&local, previous.UserSubscriptionId).Error)
	require.Equal(t, int64(123), local.AmountUsed)
}

func TestPostConsumeNegativeDeltaAtZeroIsSuccessfulNoOp(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_refund_zero", SubscriptionId: "sub_refund_zero", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_refund_zero", "checkout.session.completed", now, order.TradeNo, "{}", state))

	var mapping ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&mapping).Error)
	require.NoError(t, PostConsumeUserSubscriptionDelta(mapping.UserSubscriptionId, -100))

	var local UserSubscription
	require.NoError(t, DB.First(&local, mapping.UserSubscriptionId).Error)
	require.Zero(t, local.AmountUsed)
}

func TestStripeInvoiceFailedCASRejectsStaleSnapshot(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_failed_cas", SubscriptionId: "sub_failed_cas", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_failed_cas", "checkout.session.completed", now, order.TradeNo, "{}", state))

	var previous ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&previous).Error)
	newer := previous
	newer.Status = "active"
	newer.LastInvoiceId = "in_recovered"
	newer.LastInvoiceEventAt = now + 20
	newer.LastInvoicePeriodEnd = state.PeriodEnd + 30*24*60*60
	newer.LastPaidPeriodEnd = newer.LastInvoicePeriodEnd
	newer.LastStateEventAt = now + 20
	newer.CurrentPeriodEnd = newer.LastInvoicePeriodEnd
	claimed, err := claimStripeInvoicePaidTx(DB, previous, newer)
	require.NoError(t, err)
	require.True(t, claimed)

	staleFailure := previous
	staleFailure.Status = "past_due"
	staleFailure.LastInvoiceEventAt = now + 10
	staleFailure.LastInvoicePeriodEnd = state.PeriodEnd
	staleFailure.LastStateEventAt = now + 10
	claimed, err = claimStripeInvoiceFailedTx(DB, previous, staleFailure)
	require.NoError(t, err)
	require.False(t, claimed)

	var current ProviderSubscription
	require.NoError(t, DB.First(&current, previous.Id).Error)
	require.Equal(t, "active", current.Status)
	require.Equal(t, "in_recovered", current.LastInvoiceId)
}

func TestStripeSubscriptionSyncCASRejectsStaleSnapshot(t *testing.T) {
	truncateTables(t)
	order, _ := seedStripeSubscriptionOrder(t)
	now := time.Now().Unix()
	state := StripeSubscriptionState{
		CustomerId: "cus_sync_cas", SubscriptionId: "sub_sync_cas", PriceId: "price_recurring",
		Status: "active", PeriodStart: now, PeriodEnd: now + 30*24*60*60,
	}
	require.NoError(t, CompleteStripeSubscriptionCheckout("evt_checkout_sync_cas", "checkout.session.completed", now, order.TradeNo, "{}", state))

	var previous ProviderSubscription
	require.NoError(t, DB.Where("provider_subscription_id = ?", state.SubscriptionId).First(&previous).Error)
	newer := previous
	newer.Status = "canceled"
	newer.CancelAtPeriodEnd = true
	newer.LastSubscriptionEventAt = now + 20
	newer.LastStateEventAt = now + 20
	claimed, err := claimStripeSubscriptionSyncTx(DB, previous, newer)
	require.NoError(t, err)
	require.True(t, claimed)

	stale := previous
	stale.Status = "active"
	stale.CancelAtPeriodEnd = false
	stale.LastSubscriptionEventAt = now + 10
	stale.LastStateEventAt = now + 10
	claimed, err = claimStripeSubscriptionSyncTx(DB, previous, stale)
	require.NoError(t, err)
	require.False(t, claimed)

	var current ProviderSubscription
	require.NoError(t, DB.First(&current, previous.Id).Error)
	require.Equal(t, "canceled", current.Status)
	require.True(t, current.CancelAtPeriodEnd)
}
