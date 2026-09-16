package model

import (
	"fmt"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/setting/operation_setting"
	"gorm.io/gorm"
)

// revenueMoneyUSDExpr converts gateway `money` into system USD for aggregation.
//
// Epay persists `money` in CNY (`amountUSD * Price * groupRatio * discount`).
// Stripe / Waffo / Creem persist USD. Divide Epay by the current Price so
// mixed-provider sums are one unit. Historical Price changes are not stored
// on the row; current Price is the same approximation the checkout quote uses.
func revenueMoneyUSDExpr() string {
	price := operation_setting.Price
	if price <= 0 {
		return "money"
	}
	return fmt.Sprintf(
		"(CASE WHEN payment_provider = '%s' THEN money / %s ELSE money END)",
		PaymentProviderEpay,
		strconv.FormatFloat(price, 'f', -1, 64),
	)
}

func topUpMoneyUSD(provider string, money float64) float64 {
	if provider != PaymentProviderEpay {
		return money
	}
	price := operation_setting.Price
	if price <= 0 {
		return money
	}
	return money / price
}

// RevenueSummary 收入 KPI 汇总
type RevenueSummary struct {
	TotalMoney float64 `json:"total_money"`
	OrderCount int64   `json:"order_count"`
}

// RevenueTrendPoint 收入趋势的一个分桶点
type RevenueTrendPoint struct {
	Bucket int64   `json:"bucket"`
	Money  float64 `json:"money"`
	Count  int64   `json:"count"`
}

// RevenueProviderPoint 按支付渠道聚合的收入
type RevenueProviderPoint struct {
	Provider string  `json:"provider"`
	Money    float64 `json:"money"`
	Count    int64   `json:"count"`
}

// RevenueUserPoint Top 充值用户
type RevenueUserPoint struct {
	UserId   int     `json:"user_id"`
	Username string  `json:"username"`
	Money    float64 `json:"money"`
	Count    int64   `json:"count"`
}

// applyRevenueScope 统一收入口径：
//   - 只统计成功订单；
//   - 排除 balance（内部余额抵扣，不是真实收入）；
//   - complete_time 必须 > 0（历史脏数据里存在 complete_time = 0 的成功单）。
func applyRevenueScope(query *gorm.DB, startTime int64, endTime int64, provider string) *gorm.DB {
	query = query.
		Where("status = ?", common.TopUpStatusSuccess).
		Where("payment_provider <> ?", PaymentProviderBalance).
		Where("complete_time > 0")
	if startTime > 0 {
		query = query.Where("complete_time >= ?", startTime)
	}
	if endTime > 0 {
		query = query.Where("complete_time <= ?", endTime)
	}
	if provider != "" {
		query = query.Where("payment_provider = ?", provider)
	}
	return query
}

// GetRevenueSummary 返回周期内的收入总额与订单数
func GetRevenueSummary(startTime int64, endTime int64, provider string) (RevenueSummary, error) {
	var summary RevenueSummary
	query := applyRevenueScope(DB.Table("top_ups"), startTime, endTime, provider)
	err := query.Select(fmt.Sprintf("COALESCE(sum(%s), 0) as total_money, count(*) as order_count", revenueMoneyUSDExpr())).
		Scan(&summary).Error
	return summary, err
}

// GetRevenueTrend 返回周期内按时间分桶的收入趋势
func GetRevenueTrend(startTime int64, endTime int64, provider string, bucketSize int64) ([]RevenueTrendPoint, error) {
	bucketExpr := rankingBucketExpr("complete_time", bucketSize)
	moneyExpr := revenueMoneyUSDExpr()
	rows := make([]RevenueTrendPoint, 0)
	query := applyRevenueScope(DB.Table("top_ups"), startTime, endTime, provider)
	err := query.
		Select(fmt.Sprintf("%s as bucket, COALESCE(sum(%s), 0) as money, count(*) as count", bucketExpr, moneyExpr)).
		Group(bucketExpr).
		Order("bucket ASC").
		Scan(&rows).Error
	return rows, err
}

// GetRevenueByProvider 返回周期内按支付渠道聚合的收入
func GetRevenueByProvider(startTime int64, endTime int64, provider string) ([]RevenueProviderPoint, error) {
	rows := make([]RevenueProviderPoint, 0)
	query := applyRevenueScope(DB.Table("top_ups"), startTime, endTime, provider)
	err := query.
		Select(fmt.Sprintf("payment_provider as provider, COALESCE(sum(%s), 0) as money, count(*) as count", revenueMoneyUSDExpr())).
		Group("payment_provider").
		Order("money DESC").
		Scan(&rows).Error
	return rows, err
}

// GetTopRechargeUsers 返回周期内充值金额最高的用户。
//
// 用户名通过主库 users 表批量 IN 查询补齐，不做 JOIN（保持与其他统计查询一致的写法，
// 也避免 users 表大字段进入聚合）。
func GetTopRechargeUsers(startTime int64, endTime int64, provider string, limit int) ([]RevenueUserPoint, error) {
	if limit <= 0 {
		limit = 10
	}
	rows := make([]RevenueUserPoint, 0)
	query := applyRevenueScope(DB.Table("top_ups"), startTime, endTime, provider)
	err := query.
		Select(fmt.Sprintf("user_id, COALESCE(sum(%s), 0) as money, count(*) as count", revenueMoneyUSDExpr())).
		Group("user_id").
		Order("money DESC").
		Limit(limit).
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return rows, nil
	}

	userIds := make([]int, 0, len(rows))
	for _, row := range rows {
		userIds = append(userIds, row.UserId)
	}
	nameById, err := usernamesByIds(userIds)
	if err != nil {
		return nil, err
	}
	for i := range rows {
		rows[i].Username = nameById[rows[i].UserId]
	}
	return rows, nil
}

// usernamesByIds 批量查询用户名，避免统计聚合与 users 表做 JOIN。
func usernamesByIds(userIds []int) (map[int]string, error) {
	if len(userIds) == 0 {
		return map[int]string{}, nil
	}
	type userMeta struct {
		Id       int
		Username string
	}
	metas := make([]userMeta, 0, len(userIds))
	if err := DB.Model(&User{}).Select("id, username").Where("id IN ?", userIds).Scan(&metas).Error; err != nil {
		return nil, err
	}
	nameById := make(map[int]string, len(metas))
	for _, meta := range metas {
		nameById[meta.Id] = meta.Username
	}
	return nameById, nil
}

// RevenueRecentTopUp 最近充值记录的一行。
//
// 独立扁平结构而非嵌入 TopUp：TopUp 有自定义 MarshalJSON（model/topup.go）用于
// 兼容 Epay 的小数金额，嵌入会连带那套序列化逻辑。这里字段显式列出，也顺带
// 避免把 TopUp 将来新增的字段无意暴露给统计接口。
type RevenueRecentTopUp struct {
	Id              int     `json:"id"`
	UserId          int     `json:"user_id"`
	Username        string  `json:"username"`
	Amount          int64   `json:"amount"`
	Money           float64 `json:"money"`
	TradeNo         string  `json:"trade_no"`
	PaymentMethod   string  `json:"payment_method"`
	PaymentProvider string  `json:"payment_provider"`
	CreateTime      int64   `json:"create_time"`
	CompleteTime    int64   `json:"complete_time"`
	Status          string  `json:"status"`
}

// GetRecentTopUps 返回周期内最近的成功充值记录（同样排除 balance）。
//
// 现有 GetAllTopUps / SearchAllTopUps 没有时间范围与口径过滤，无法直接用于统计周期，
// 因此这里单独实现。用户名与 GetTopRechargeUsers 一样走批量 IN 查询补齐，不做 JOIN。
func GetRecentTopUps(startTime int64, endTime int64, provider string, limit int) ([]*RevenueRecentTopUp, error) {
	if limit <= 0 {
		limit = 10
	}
	topups := make([]*TopUp, 0)
	query := applyRevenueScope(DB.Model(&TopUp{}), startTime, endTime, provider)
	err := query.Order("complete_time desc, id desc").Limit(limit).Find(&topups).Error
	if err != nil {
		return nil, err
	}

	rows := make([]*RevenueRecentTopUp, 0, len(topups))
	userIds := make([]int, 0, len(topups))
	for _, topUp := range topups {
		if topUp == nil {
			continue
		}
		rows = append(rows, &RevenueRecentTopUp{
			Id:              topUp.Id,
			UserId:          topUp.UserId,
			Amount:          topUp.Amount,
			Money:           topUpMoneyUSD(topUp.PaymentProvider, topUp.Money),
			TradeNo:         topUp.TradeNo,
			PaymentMethod:   topUp.PaymentMethod,
			PaymentProvider: topUp.PaymentProvider,
			CreateTime:      topUp.CreateTime,
			CompleteTime:    topUp.CompleteTime,
			Status:          topUp.Status,
		})
		userIds = append(userIds, topUp.UserId)
	}
	if len(rows) == 0 {
		return rows, nil
	}

	nameById, err := usernamesByIds(userIds)
	if err != nil {
		return nil, err
	}
	for _, row := range rows {
		row.Username = nameById[row.UserId]
	}
	return rows, nil
}
