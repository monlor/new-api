package model

import (
	"math"
	"testing"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestTopUpMoneyUSDConvertsEpayCNY(t *testing.T) {
	original := operation_setting.Price
	t.Cleanup(func() { operation_setting.Price = original })
	operation_setting.Price = 7

	if got := topUpMoneyUSD(PaymentProviderEpay, 70); got != 10 {
		t.Fatalf("epay money=%v, want 10", got)
	}
	if got := topUpMoneyUSD(PaymentProviderStripe, 70); got != 70 {
		t.Fatalf("stripe money=%v, want 70", got)
	}
	if got := topUpMoneyUSD(PaymentProviderWaffo, 12.5); got != 12.5 {
		t.Fatalf("waffo money=%v, want 12.5", got)
	}

	operation_setting.Price = 0
	if got := topUpMoneyUSD(PaymentProviderEpay, 70); got != 70 {
		t.Fatalf("zero price should not convert, got %v", got)
	}
}

// 订阅镜像订单丢失 payment_provider 时，Epay 的 CNY 金额会被当作 USD 直接统计，
// 前端再按展示汇率放大一次 —— 线上 300.3 的套餐因此显示成 ¥2102.1。
func TestTopUpMoneyUSDRealWorldSubscriptionOrder(t *testing.T) {
	original := operation_setting.Price
	t.Cleanup(func() { operation_setting.Price = original })
	operation_setting.Price = 7.3

	got := topUpMoneyUSD(PaymentProviderEpay, 300.3)
	if math.Abs(got-41.13698630136986) > 1e-9 {
		t.Fatalf("epay 300.3 CNY => %v USD, want ~41.137", got)
	}

	// 回归保护：provider 为空（修复前的脏数据）不会被折算。
	if got := topUpMoneyUSD("", 300.3); got != 300.3 {
		t.Fatalf("blank provider should not convert, got %v", got)
	}
}

func TestGetRecentTopUpsIncludesUsername(t *testing.T) {
	truncateTables(t)

	originalPrice := operation_setting.Price
	t.Cleanup(func() { operation_setting.Price = originalPrice })
	operation_setting.Price = 7.3

	require.NoError(t, DB.Create(&User{
		Id:       901,
		Username: "recent_topup_user",
		Status:   common.UserStatusEnabled,
	}).Error)

	now := time.Now().Unix()
	require.NoError(t, DB.Create(&TopUp{
		UserId:          901,
		Money:           300.3,
		TradeNo:         "recent-epay-order",
		PaymentMethod:   "alipay",
		PaymentProvider: PaymentProviderEpay,
		CreateTime:      now,
		CompleteTime:    now,
		Status:          common.TopUpStatusSuccess,
	}).Error)

	rows, err := GetRecentTopUps(0, 0, "", 10)
	require.NoError(t, err)
	require.Len(t, rows, 1)
	assert.Equal(t, "recent_topup_user", rows[0].Username)
	assert.Equal(t, PaymentProviderEpay, rows[0].PaymentProvider)
	assert.InDelta(t, 41.137, rows[0].Money, 0.01)
}

func TestMigrateTopUpPaymentProviderBackfill(t *testing.T) {
	truncateTables(t)

	now := time.Now().Unix()
	require.NoError(t, DB.Create(&SubscriptionOrder{
		UserId:          902,
		PlanId:          1,
		Money:           300.3,
		TradeNo:         "backfill-order",
		PaymentMethod:   "alipay",
		PaymentProvider: PaymentProviderEpay,
		Status:          common.TopUpStatusSuccess,
		CreateTime:      now,
		CompleteTime:    now,
	}).Error)
	// 修复前的镜像行：payment_provider 为空。
	require.NoError(t, DB.Create(&TopUp{
		UserId:        902,
		Money:         300.3,
		TradeNo:       "backfill-order",
		PaymentMethod: "alipay",
		CreateTime:    now,
		CompleteTime:  now,
		Status:        common.TopUpStatusSuccess,
	}).Error)
	// 无对应订阅订单的空 provider 行不应被误填。
	require.NoError(t, DB.Create(&TopUp{
		UserId:       902,
		Money:        10,
		TradeNo:      "orphan-order",
		CreateTime:   now,
		CompleteTime: now,
		Status:       common.TopUpStatusSuccess,
	}).Error)

	require.NoError(t, migrateTopUpPaymentProviderBackfill())
	assert.Equal(t, PaymentProviderEpay, GetTopUpByTradeNo("backfill-order").PaymentProvider)
	assert.Equal(t, "", GetTopUpByTradeNo("orphan-order").PaymentProvider)

	// 幂等：二次执行不改变结果。
	require.NoError(t, migrateTopUpPaymentProviderBackfill())
	assert.Equal(t, PaymentProviderEpay, GetTopUpByTradeNo("backfill-order").PaymentProvider)
}
