package service

import (
	"fmt"
	"time"

	"github.com/QuantumNous/new-api/model"
)

// ---------------------------------------------------------------------------
// FundingSource — 资金来源接口（钱包 or 订阅）
// ---------------------------------------------------------------------------

// FundingSource 抽象了预扣费的资金来源。
type FundingSource interface {
	// Source 返回资金来源标识："wallet" 或 "subscription"
	Source() string
	// PreConsume 从该资金来源预扣 amount 额度
	PreConsume(amount int) error
	// Settle 根据差额调整资金来源（正数补扣，负数退还）
	Settle(delta int) error
	// Refund 退还所有预扣费
	Refund() error
}

// ---------------------------------------------------------------------------
// WalletFunding — 钱包资金来源实现
// ---------------------------------------------------------------------------

type WalletFunding struct {
	userId   int
	consumed int // 实际预扣的用户额度
}

func (w *WalletFunding) Source() string { return BillingSourceWallet }

func (w *WalletFunding) PreConsume(amount int) error {
	if amount <= 0 {
		return nil
	}
	if err := model.DecreaseUserQuota(w.userId, amount, false); err != nil {
		return err
	}
	w.consumed = amount
	return nil
}

func (w *WalletFunding) Settle(delta int) error {
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		return model.DecreaseUserQuota(w.userId, delta, false)
	}
	return model.IncreaseUserQuota(w.userId, -delta, false)
}

func (w *WalletFunding) Refund() error {
	if w.consumed <= 0 {
		return nil
	}
	// IncreaseUserQuota 是 quota += N 的非幂等操作，不能重试，否则会多退额度。
	// 订阅的 RefundSubscriptionPreConsume 有 requestId 幂等保护所以可以重试。
	return model.IncreaseUserQuota(w.userId, w.consumed, false)
}

// ---------------------------------------------------------------------------
// SubscriptionFunding — 订阅资金来源实现
// ---------------------------------------------------------------------------

type SubscriptionFunding struct {
	requestId      string
	userId         int
	modelName      string
	amount         int64 // 预扣的订阅额度（subConsume）
	allowPartial   bool  // 无法全额覆盖时消耗剩余额度，供拆分扣费使用
	subscriptionId int
	preConsumed    int64
	// 以下字段在 PreConsume 成功后填充，供 RelayInfo 同步使用
	AmountTotal     int64
	AmountUsedAfter int64
	PlanId          int
	PlanTitle       string
}

func (s *SubscriptionFunding) Source() string { return BillingSourceSubscription }

func (s *SubscriptionFunding) PreConsume(_ int) error {
	// amount 参数被忽略，使用内部 s.amount（已在构造时根据 preConsumedQuota 计算）
	var res *model.SubscriptionPreConsumeResult
	var err error
	if s.allowPartial {
		res, err = model.PreConsumeUserSubscriptionUpTo(s.requestId, s.userId, s.modelName, 0, s.amount)
	} else {
		res, err = model.PreConsumeUserSubscription(s.requestId, s.userId, s.modelName, 0, s.amount)
	}
	if err != nil {
		return err
	}
	s.subscriptionId = res.UserSubscriptionId
	s.preConsumed = res.PreConsumed
	s.AmountTotal = res.AmountTotal
	s.AmountUsedAfter = res.AmountUsedAfter
	// 获取订阅计划信息
	if planInfo, err := model.GetSubscriptionPlanInfoByUserSubscriptionId(res.UserSubscriptionId); err == nil && planInfo != nil {
		s.PlanId = planInfo.PlanId
		s.PlanTitle = planInfo.PlanTitle
	}
	return nil
}

func (s *SubscriptionFunding) Settle(delta int) error {
	if delta == 0 {
		return nil
	}
	return model.PostConsumeUserSubscriptionDelta(s.subscriptionId, int64(delta))
}

func (s *SubscriptionFunding) Refund() error {
	if s.preConsumed <= 0 {
		return nil
	}
	return refundWithRetry(func() error {
		return model.RefundSubscriptionPreConsume(s.requestId)
	})
}

// SplitFunding spends leftover subscription quota first, then wallet for the rest.
type SplitFunding struct {
	sub                *SubscriptionFunding
	wallet             *WalletFunding
	lastSubSettleDelta int64
}

func (s *SplitFunding) Source() string {
	if s != nil && s.sub != nil && s.sub.preConsumed > 0 {
		return BillingSourceSubscription
	}
	return BillingSourceWallet
}

func (s *SplitFunding) PreConsume(amount int) error {
	if s.sub == nil {
		s.sub = &SubscriptionFunding{}
	}
	if s.wallet == nil {
		s.wallet = &WalletFunding{}
	}
	if err := s.sub.PreConsume(amount); err != nil {
		return err
	}
	walletNeed := amount - int(s.sub.preConsumed)
	if walletNeed < 0 {
		walletNeed = 0
	}
	if walletNeed == 0 {
		return nil
	}
	userId := s.wallet.userId
	if userId <= 0 && s.sub != nil {
		userId = s.sub.userId
		s.wallet.userId = userId
	}
	quota, err := model.GetUserQuota(userId, true)
	if err != nil {
		if refundErr := s.sub.Refund(); refundErr != nil {
			return fmt.Errorf("wallet quota insufficient: lookup failed: %v; subscription refund failed: %v", err, refundErr)
		}
		return err
	}
	if quota < walletNeed {
		if refundErr := s.sub.Refund(); refundErr != nil {
			return fmt.Errorf("wallet quota insufficient, remaining=%d need=%d; subscription refund failed: %v", quota, walletNeed, refundErr)
		}
		return fmt.Errorf("wallet quota insufficient, remaining=%d need=%d", quota, walletNeed)
	}
	if err := s.wallet.PreConsume(walletNeed); err != nil {
		if refundErr := s.sub.Refund(); refundErr != nil {
			return fmt.Errorf("wallet pre-consume failed: %w; subscription refund failed: %v", err, refundErr)
		}
		return err
	}
	return nil
}

func (s *SplitFunding) Settle(delta int) error {
	s.lastSubSettleDelta = 0
	if delta == 0 {
		return nil
	}
	if delta > 0 {
		// Subscription leftover was already taken at pre-consume; extra goes to wallet.
		if s.wallet == nil {
			return fmt.Errorf("split funding wallet is nil")
		}
		if err := s.wallet.Settle(delta); err != nil {
			return err
		}
		s.wallet.consumed += delta
		return nil
	}
	refund := -delta
	if s.wallet != nil && s.wallet.consumed > 0 {
		wRefund := refund
		if wRefund > s.wallet.consumed {
			wRefund = s.wallet.consumed
		}
		if err := model.IncreaseUserQuota(s.wallet.userId, wRefund, false); err != nil {
			return err
		}
		s.wallet.consumed -= wRefund
		refund -= wRefund
	}
	if refund > 0 && s.sub != nil && s.sub.subscriptionId > 0 {
		s.lastSubSettleDelta = -int64(refund)
		return model.PostConsumeUserSubscriptionDelta(s.sub.subscriptionId, -int64(refund))
	}
	return nil
}

func (s *SplitFunding) Refund() error {
	var walletErr error
	if s.wallet != nil {
		walletErr = s.wallet.Refund()
	}
	var subErr error
	if s.sub != nil {
		subErr = s.sub.Refund()
	}
	if walletErr != nil {
		return walletErr
	}
	return subErr
}

// refundWithRetry 尝试多次执行退款操作以提高成功率，只能用于基于事务的退款函数！！！！！！
// try to refund with retries, only for refund functions based on transactions!!!
func refundWithRetry(fn func() error) error {
	if fn == nil {
		return nil
	}
	const maxAttempts = 3
	var lastErr error
	for i := 0; i < maxAttempts; i++ {
		if err := fn(); err == nil {
			return nil
		} else {
			lastErr = err
		}
		if i < maxAttempts-1 {
			time.Sleep(time.Duration(200*(i+1)) * time.Millisecond)
		}
	}
	return lastErr
}
