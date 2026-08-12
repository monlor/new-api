package model

import (
	"errors"
	"fmt"
	"strings"
	"time"

	"github.com/QuantumNous/new-api/common"
	"gorm.io/gorm"
)

var ErrProviderSubscriptionNotFound = errors.New("provider subscription not found")

var errProviderSubscriptionCASConflict = errors.New("provider subscription changed concurrently")

// ProviderSubscription links a provider-managed recurring subscription to the
// local entitlement it renews. Provider IDs are never accepted from clients.
type ProviderSubscription struct {
	Id                 int    `json:"id"`
	Provider           string `json:"provider" gorm:"type:varchar(32);not null;uniqueIndex:idx_provider_subscription,priority:1"`
	UserId             int    `json:"user_id" gorm:"not null;index"`
	PlanId             int    `json:"plan_id" gorm:"not null;index"`
	UserSubscriptionId int    `json:"user_subscription_id" gorm:"not null;uniqueIndex"`

	ProviderCustomerId      string `json:"-" gorm:"type:varchar(255);not null;index"`
	ProviderSubscriptionId  string `json:"-" gorm:"type:varchar(255);not null;uniqueIndex:idx_provider_subscription,priority:2"`
	ProviderPriceId         string `json:"-" gorm:"type:varchar(255);not null;default:''"`
	Status                  string `json:"status" gorm:"type:varchar(32);not null;default:'';index"`
	CurrentPeriodStart      int64  `json:"current_period_start" gorm:"type:bigint;not null;default:0"`
	CurrentPeriodEnd        int64  `json:"current_period_end" gorm:"type:bigint;not null;default:0;index"`
	CancelAtPeriodEnd       bool   `json:"cancel_at_period_end" gorm:"not null;default:false"`
	LastInvoiceId           string `json:"-" gorm:"type:varchar(255);not null;default:''"`
	LastInvoiceEventAt      int64  `json:"-" gorm:"type:bigint;not null;default:0"`
	LastInvoicePeriodEnd    int64  `json:"-" gorm:"type:bigint;not null;default:0"`
	LastPaidPeriodEnd       int64  `json:"-" gorm:"type:bigint;not null;default:0"`
	LastSubscriptionEventAt int64  `json:"-" gorm:"type:bigint;not null;default:0"`
	LastStateEventAt        int64  `json:"-" gorm:"type:bigint;not null;default:0"`

	CreatedAt int64 `json:"-" gorm:"type:bigint"`
	UpdatedAt int64 `json:"-" gorm:"type:bigint"`
}

func (s *ProviderSubscription) BeforeCreate(tx *gorm.DB) error {
	now := common.GetTimestamp()
	s.CreatedAt = now
	s.UpdatedAt = now
	return nil
}

func (s *ProviderSubscription) BeforeUpdate(tx *gorm.DB) error {
	s.UpdatedAt = common.GetTimestamp()
	return nil
}

// ProviderWebhookEvent is the transaction-local idempotency marker for a
// provider webhook. It is inserted only after the associated state mutation
// succeeds, so a failed transaction remains retryable by the provider.
type ProviderWebhookEvent struct {
	Id        int    `json:"id"`
	Provider  string `json:"provider" gorm:"type:varchar(32);not null;uniqueIndex:idx_provider_event,priority:1"`
	EventId   string `json:"event_id" gorm:"type:varchar(255);not null;uniqueIndex:idx_provider_event,priority:2"`
	EventType string `json:"event_type" gorm:"type:varchar(128);not null"`
	CreatedAt int64  `json:"created_at" gorm:"type:bigint;not null"`
}

type StripeSubscriptionState struct {
	CustomerId     string
	SubscriptionId string
	PriceId        string
	Status         string
	PeriodStart    int64
	PeriodEnd      int64
	CancelAtEnd    bool
}

func providerEventProcessedTx(tx *gorm.DB, provider string, eventId string) (bool, error) {
	var count int64
	err := tx.Model(&ProviderWebhookEvent{}).
		Where("provider = ? AND event_id = ?", provider, eventId).
		Count(&count).Error
	return count > 0, err
}

func recordProviderEventTx(tx *gorm.DB, provider string, eventId string, eventType string) error {
	if strings.TrimSpace(eventId) == "" {
		return errors.New("provider event id is empty")
	}
	return tx.Create(&ProviderWebhookEvent{
		Provider: provider, EventId: eventId, EventType: eventType, CreatedAt: common.GetTimestamp(),
	}).Error
}

func upsertStripeSubscriptionTx(tx *gorm.DB, eventCreated int64, state StripeSubscriptionState, order *SubscriptionOrder) error {
	if order == nil || order.UserSubscriptionId <= 0 || state.CustomerId == "" || state.SubscriptionId == "" {
		return errors.New("incomplete Stripe subscription mapping")
	}
	var mapping ProviderSubscription
	err := tx.Where("provider = ? AND provider_subscription_id = ?", PaymentProviderStripe, state.SubscriptionId).
		First(&mapping).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		mapping = ProviderSubscription{
			Provider: PaymentProviderStripe, UserId: order.UserId, PlanId: order.PlanId,
			UserSubscriptionId: order.UserSubscriptionId,
		}
	} else if err != nil {
		return err
	} else if mapping.UserId != order.UserId || mapping.UserSubscriptionId != order.UserSubscriptionId {
		return errors.New("Stripe subscription is already bound to another entitlement")
	}
	mapping.ProviderCustomerId = state.CustomerId
	mapping.ProviderSubscriptionId = state.SubscriptionId
	if state.PriceId == "" {
		var plan SubscriptionPlan
		if err := tx.Select("stripe_price_id").First(&plan, order.PlanId).Error; err != nil {
			return err
		}
		state.PriceId = plan.StripePriceId
	}
	if state.Status == "" {
		state.Status = SubscriptionStatusActive
	}
	mapping.ProviderPriceId = state.PriceId
	mapping.Status = state.Status
	mapping.CurrentPeriodStart = state.PeriodStart
	mapping.CurrentPeriodEnd = state.PeriodEnd
	mapping.CancelAtPeriodEnd = state.CancelAtEnd
	if eventCreated > mapping.LastStateEventAt {
		mapping.LastStateEventAt = eventCreated
	}
	if mapping.Id == 0 {
		if err := tx.Create(&mapping).Error; err != nil {
			return err
		}
	} else if err := tx.Save(&mapping).Error; err != nil {
		return err
	}
	return tx.Model(&User{}).Where("id = ?", order.UserId).
		Update("stripe_customer", state.CustomerId).Error
}

// CompleteStripeSubscriptionCheckout completes the local order, saves the
// Stripe customer/subscription relationship, and records the event atomically.
func CompleteStripeSubscriptionCheckout(eventId string, eventType string, eventCreated int64, tradeNo string, providerPayload string, state StripeSubscriptionState) error {
	var result subscriptionCompletionResult
	err := DB.Transaction(func(tx *gorm.DB) error {
		processed, err := providerEventProcessedTx(tx, PaymentProviderStripe, eventId)
		if err != nil || processed {
			return err
		}
		result, err = completeSubscriptionOrderTx(tx, tradeNo, providerPayload, PaymentProviderStripe, "")
		if err != nil {
			return err
		}
		if err := upsertStripeSubscriptionTx(tx, eventCreated, state, &result.Order); err != nil {
			return err
		}
		return recordProviderEventTx(tx, PaymentProviderStripe, eventId, eventType)
	})
	if err != nil {
		return err
	}
	afterSubscriptionCompletion(result)
	return nil
}

func withStripeProviderEvent(eventId string, eventType string, mutate func(tx *gorm.DB) error) error {
	for attempt := 0; attempt < 5; attempt++ {
		err := DB.Transaction(func(tx *gorm.DB) error {
			processed, err := providerEventProcessedTx(tx, PaymentProviderStripe, eventId)
			if err != nil || processed {
				return err
			}
			if err := mutate(tx); err != nil {
				return err
			}
			return recordProviderEventTx(tx, PaymentProviderStripe, eventId, eventType)
		})
		if errors.Is(err, errProviderSubscriptionCASConflict) {
			continue
		}
		return err
	}
	return errProviderSubscriptionCASConflict
}

func getStripeSubscriptionTx(tx *gorm.DB, providerSubscriptionId string) (*ProviderSubscription, error) {
	var mapping ProviderSubscription
	err := tx.Where("provider = ? AND provider_subscription_id = ?", PaymentProviderStripe, providerSubscriptionId).
		First(&mapping).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, ErrProviderSubscriptionNotFound
	}
	return &mapping, err
}

func claimStripeInvoicePaidTx(tx *gorm.DB, previous ProviderSubscription, next ProviderSubscription) (bool, error) {
	claim := tx.Model(&ProviderSubscription{}).Where(map[string]any{
		"id":                         previous.Id,
		"provider_price_id":          previous.ProviderPriceId,
		"status":                     previous.Status,
		"cancel_at_period_end":       previous.CancelAtPeriodEnd,
		"last_invoice_id":            previous.LastInvoiceId,
		"last_invoice_event_at":      previous.LastInvoiceEventAt,
		"last_invoice_period_end":    previous.LastInvoicePeriodEnd,
		"last_paid_period_end":       previous.LastPaidPeriodEnd,
		"last_state_event_at":        previous.LastStateEventAt,
		"last_subscription_event_at": previous.LastSubscriptionEventAt,
		"current_period_start":       previous.CurrentPeriodStart,
		"current_period_end":         previous.CurrentPeriodEnd,
	}).Updates(map[string]any{
		"status":                  next.Status,
		"current_period_start":    next.CurrentPeriodStart,
		"current_period_end":      next.CurrentPeriodEnd,
		"last_invoice_id":         next.LastInvoiceId,
		"last_invoice_event_at":   next.LastInvoiceEventAt,
		"last_invoice_period_end": next.LastInvoicePeriodEnd,
		"last_paid_period_end":    next.LastPaidPeriodEnd,
		"last_state_event_at":     next.LastStateEventAt,
		"updated_at":              common.GetTimestamp(),
	})
	return claim.RowsAffected == 1, claim.Error
}

func claimStripeInvoiceFailedTx(tx *gorm.DB, previous ProviderSubscription, next ProviderSubscription) (bool, error) {
	claim := tx.Model(&ProviderSubscription{}).Where(map[string]any{
		"id":                         previous.Id,
		"provider_price_id":          previous.ProviderPriceId,
		"status":                     previous.Status,
		"cancel_at_period_end":       previous.CancelAtPeriodEnd,
		"last_invoice_id":            previous.LastInvoiceId,
		"last_invoice_event_at":      previous.LastInvoiceEventAt,
		"last_invoice_period_end":    previous.LastInvoicePeriodEnd,
		"last_paid_period_end":       previous.LastPaidPeriodEnd,
		"last_state_event_at":        previous.LastStateEventAt,
		"last_subscription_event_at": previous.LastSubscriptionEventAt,
		"current_period_start":       previous.CurrentPeriodStart,
		"current_period_end":         previous.CurrentPeriodEnd,
	}).Updates(map[string]any{
		"status":                  next.Status,
		"last_invoice_event_at":   next.LastInvoiceEventAt,
		"last_invoice_period_end": next.LastInvoicePeriodEnd,
		"last_state_event_at":     next.LastStateEventAt,
		"updated_at":              common.GetTimestamp(),
	})
	return claim.RowsAffected == 1, claim.Error
}

func claimStripeSubscriptionSyncTx(tx *gorm.DB, previous ProviderSubscription, next ProviderSubscription) (bool, error) {
	claim := tx.Model(&ProviderSubscription{}).Where(map[string]any{
		"id":                         previous.Id,
		"provider_customer_id":       previous.ProviderCustomerId,
		"provider_price_id":          previous.ProviderPriceId,
		"status":                     previous.Status,
		"current_period_start":       previous.CurrentPeriodStart,
		"current_period_end":         previous.CurrentPeriodEnd,
		"cancel_at_period_end":       previous.CancelAtPeriodEnd,
		"last_subscription_event_at": previous.LastSubscriptionEventAt,
		"last_state_event_at":        previous.LastStateEventAt,
		"last_invoice_id":            previous.LastInvoiceId,
		"last_invoice_event_at":      previous.LastInvoiceEventAt,
		"last_invoice_period_end":    previous.LastInvoicePeriodEnd,
		"last_paid_period_end":       previous.LastPaidPeriodEnd,
	}).Updates(map[string]any{
		"provider_price_id":          next.ProviderPriceId,
		"status":                     next.Status,
		"current_period_start":       next.CurrentPeriodStart,
		"current_period_end":         next.CurrentPeriodEnd,
		"cancel_at_period_end":       next.CancelAtPeriodEnd,
		"last_subscription_event_at": next.LastSubscriptionEventAt,
		"last_state_event_at":        next.LastStateEventAt,
		"updated_at":                 common.GetTimestamp(),
	})
	return claim.RowsAffected == 1, claim.Error
}

func ProcessStripeInvoicePaid(eventId string, eventType string, eventCreated int64, providerSubscriptionId string, invoiceId string, periodStart int64, periodEnd int64, paidPriceId string, renewal bool) error {
	return withStripeProviderEvent(eventId, eventType, func(tx *gorm.DB) error {
		mapping, err := getStripeSubscriptionTx(tx, providerSubscriptionId)
		if err != nil {
			return err
		}
		if periodEnd > 0 && periodEnd < mapping.CurrentPeriodEnd {
			return nil
		}
		if eventCreated > 0 && eventCreated < mapping.LastStateEventAt && periodEnd <= mapping.CurrentPeriodEnd {
			return nil
		}
		if eventCreated > 0 && eventCreated < mapping.LastInvoiceEventAt && periodEnd <= mapping.LastInvoicePeriodEnd {
			return nil
		}
		if renewal && mapping.LastInvoiceId != "" && periodEnd > 0 && periodEnd <= mapping.LastPaidPeriodEnd && invoiceId != mapping.LastInvoiceId {
			return nil
		}
		var renewalPlan SubscriptionPlan
		if renewal {
			if paidPriceId == "" {
				return errors.New("Stripe renewal invoice is missing subscription price")
			}
			if paidPriceId != mapping.ProviderPriceId {
				return fmt.Errorf("Stripe renewal price %q does not match subscription mapping", paidPriceId)
			}
			if err := tx.First(&renewalPlan, mapping.PlanId).Error; err != nil {
				return err
			}
			if renewalPlan.StripePriceId == "" || paidPriceId != renewalPlan.StripePriceId {
				return fmt.Errorf("Stripe renewal price %q does not match local plan", paidPriceId)
			}
		}
		previous := *mapping
		isNewInvoice := invoiceId != "" && mapping.LastInvoiceId != invoiceId
		mapping.Status = "active"
		if periodStart > 0 {
			mapping.CurrentPeriodStart = periodStart
		}
		if periodEnd > 0 {
			mapping.CurrentPeriodEnd = periodEnd
		}
		if invoiceId != "" {
			mapping.LastInvoiceId = invoiceId
		}
		if eventCreated > mapping.LastInvoiceEventAt {
			mapping.LastInvoiceEventAt = eventCreated
		}
		if periodEnd > mapping.LastInvoicePeriodEnd {
			mapping.LastInvoicePeriodEnd = periodEnd
		}
		if periodEnd > mapping.LastPaidPeriodEnd {
			mapping.LastPaidPeriodEnd = periodEnd
		}
		if eventCreated > mapping.LastStateEventAt {
			mapping.LastStateEventAt = eventCreated
		}
		if !isNewInvoice && mapping.Status == "active" &&
			mapping.CurrentPeriodStart == previous.CurrentPeriodStart && mapping.CurrentPeriodEnd == previous.CurrentPeriodEnd &&
			mapping.LastInvoiceEventAt == previous.LastInvoiceEventAt && mapping.LastInvoicePeriodEnd == previous.LastInvoicePeriodEnd &&
			mapping.LastPaidPeriodEnd == previous.LastPaidPeriodEnd && mapping.LastStateEventAt == previous.LastStateEventAt {
			return nil
		}
		claimed, err := claimStripeInvoicePaidTx(tx, previous, *mapping)
		if err != nil {
			return err
		}
		if !claimed {
			return errProviderSubscriptionCASConflict
		}
		if !renewal || !isNewInvoice || periodEnd <= 0 {
			return nil
		}
		renewalPlan.NormalizeDefaults()
		resetBase := time.Unix(periodStart, 0)
		if periodStart <= 0 {
			resetBase = time.Unix(periodEnd, 0)
		}
		nextResetTime := calcNextResetTime(resetBase, &renewalPlan, periodEnd)
		return tx.Model(&UserSubscription{}).
			Where("id = ? AND end_time <= ?", mapping.UserSubscriptionId, periodEnd).
			Updates(map[string]any{
				"amount_used":     0,
				"end_time":        periodEnd,
				"status":          SubscriptionStatusActive,
				"last_reset_time": periodStart,
				"next_reset_time": nextResetTime,
			}).Error
	})
}

func ProcessStripeInvoiceFailed(eventId string, eventType string, eventCreated int64, providerSubscriptionId string, invoiceId string, periodEnd int64) error {
	return withStripeProviderEvent(eventId, eventType, func(tx *gorm.DB) error {
		mapping, err := getStripeSubscriptionTx(tx, providerSubscriptionId)
		if err != nil {
			return err
		}
		previous := *mapping
		if invoiceId != "" && invoiceId == mapping.LastInvoiceId {
			return nil
		}
		if mapping.LastInvoiceId != "" && periodEnd > 0 && periodEnd <= mapping.LastPaidPeriodEnd {
			return nil
		}
		if periodEnd > 0 && periodEnd < mapping.LastInvoicePeriodEnd {
			return nil
		}
		if eventCreated > 0 && eventCreated < mapping.LastInvoiceEventAt {
			return nil
		}
		if eventCreated > 0 && eventCreated < mapping.LastStateEventAt {
			return nil
		}
		mapping.Status = "past_due"
		if eventCreated > mapping.LastInvoiceEventAt {
			mapping.LastInvoiceEventAt = eventCreated
		}
		if periodEnd > mapping.LastInvoicePeriodEnd {
			mapping.LastInvoicePeriodEnd = periodEnd
		}
		if eventCreated > mapping.LastStateEventAt {
			mapping.LastStateEventAt = eventCreated
		}
		if mapping.Status == previous.Status && mapping.LastInvoiceEventAt == previous.LastInvoiceEventAt &&
			mapping.LastInvoicePeriodEnd == previous.LastInvoicePeriodEnd && mapping.LastStateEventAt == previous.LastStateEventAt {
			return nil
		}
		claimed, err := claimStripeInvoiceFailedTx(tx, previous, *mapping)
		if err != nil {
			return err
		}
		if !claimed {
			return errProviderSubscriptionCASConflict
		}
		return nil
	})
}

func SyncStripeSubscription(eventId string, eventType string, eventCreated int64, state StripeSubscriptionState, deleted bool) error {
	return withStripeProviderEvent(eventId, eventType, func(tx *gorm.DB) error {
		mapping, err := getStripeSubscriptionTx(tx, state.SubscriptionId)
		if err != nil {
			return err
		}
		if state.CustomerId != "" && mapping.ProviderCustomerId != state.CustomerId {
			return errors.New("Stripe customer does not match subscription mapping")
		}
		previous := *mapping
		if eventCreated > 0 && eventCreated < mapping.LastSubscriptionEventAt {
			return nil
		}
		if eventCreated > 0 && eventCreated < mapping.LastStateEventAt {
			return nil
		}
		if state.PeriodEnd > 0 && state.PeriodEnd < mapping.CurrentPeriodEnd {
			return nil
		}
		if state.PriceId != "" {
			var plan SubscriptionPlan
			if err := tx.Select("stripe_price_id").First(&plan, mapping.PlanId).Error; err != nil {
				return err
			}
			if plan.StripePriceId == "" || state.PriceId != plan.StripePriceId {
				return fmt.Errorf("Stripe subscription price %q does not match local plan", state.PriceId)
			}
		}
		if state.PriceId != "" {
			mapping.ProviderPriceId = state.PriceId
		}
		mapping.Status = state.Status
		if state.PeriodStart > 0 {
			mapping.CurrentPeriodStart = state.PeriodStart
		}
		if state.PeriodEnd > 0 {
			mapping.CurrentPeriodEnd = state.PeriodEnd
		}
		mapping.CancelAtPeriodEnd = state.CancelAtEnd || deleted
		if eventCreated > mapping.LastSubscriptionEventAt {
			mapping.LastSubscriptionEventAt = eventCreated
		}
		if eventCreated > mapping.LastStateEventAt {
			mapping.LastStateEventAt = eventCreated
		}
		if mapping.ProviderPriceId == previous.ProviderPriceId && mapping.Status == previous.Status &&
			mapping.CurrentPeriodStart == previous.CurrentPeriodStart && mapping.CurrentPeriodEnd == previous.CurrentPeriodEnd &&
			mapping.CancelAtPeriodEnd == previous.CancelAtPeriodEnd &&
			mapping.LastSubscriptionEventAt == previous.LastSubscriptionEventAt && mapping.LastStateEventAt == previous.LastStateEventAt {
			return nil
		}
		claimed, err := claimStripeSubscriptionSyncTx(tx, previous, *mapping)
		if err != nil {
			return err
		}
		if !claimed {
			return errProviderSubscriptionCASConflict
		}
		return nil
	})
}

func GetStripeCustomerForUserSubscription(userId int, userSubscriptionId int) (string, error) {
	if userId <= 0 || userSubscriptionId <= 0 {
		return "", ErrProviderSubscriptionNotFound
	}
	var mapping ProviderSubscription
	err := DB.Where("provider = ? AND user_id = ? AND user_subscription_id = ?", PaymentProviderStripe, userId, userSubscriptionId).
		Where("provider_customer_id <> ''").First(&mapping).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return "", ErrProviderSubscriptionNotFound
	}
	return mapping.ProviderCustomerId, err
}
