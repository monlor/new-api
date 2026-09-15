package controller

import (
	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// statisticsTopUsersLimit Top 充值用户数量
const statisticsTopUsersLimit = 10

// statisticsRecentTopUpsLimit 最近充值记录条数
const statisticsRecentTopUpsLimit = 20

// allowedRevenueProviders 可筛选的支付渠道白名单。
// 故意不含 balance —— 余额抵扣不是真实收入，统计口径里已被排除。
var allowedRevenueProviders = map[string]bool{
	model.PaymentProviderEpay:         true,
	model.PaymentProviderStripe:       true,
	model.PaymentProviderCreem:        true,
	model.PaymentProviderWaffo:        true,
	model.PaymentProviderWaffoPancake: true,
}

type revenueStatisticsSummary struct {
	TotalMoney     float64 `json:"total_money"`
	OrderCount     int64   `json:"order_count"`
	AvgOrderValue  float64 `json:"avg_order_value"`
	MoneyGrowthPct float64 `json:"money_growth_pct"`
}

type revenueProviderItem struct {
	Provider   string  `json:"provider"`
	Money      float64 `json:"money"`
	Count      int64   `json:"count"`
	Percentage float64 `json:"percentage"`
}

// moneyGrowthPct 金额环比，语义与 growthPct 一致
func moneyGrowthPct(current float64, previous float64) float64 {
	if previous == 0 {
		if current == 0 {
			return 0
		}
		return 100
	}
	return (current - previous) / previous * 100
}

// GetRevenueStatistics GET /api/statistics/revenue
func GetRevenueStatistics(c *gin.Context) {
	startTimestamp, endTimestamp := parseStatisticsTimeRange(c)

	provider := c.Query("provider")
	if provider != "" && !allowedRevenueProviders[provider] {
		common.ApiErrorMsg(c, "不支持的支付渠道")
		return
	}

	summaryRow, err := model.GetRevenueSummary(startTimestamp, endTimestamp, provider)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	summary := revenueStatisticsSummary{
		TotalMoney: summaryRow.TotalMoney,
		OrderCount: summaryRow.OrderCount,
	}
	if summaryRow.OrderCount > 0 {
		summary.AvgOrderValue = summaryRow.TotalMoney / float64(summaryRow.OrderCount)
	}
	if startTimestamp > 0 && endTimestamp > startTimestamp {
		span := endTimestamp - startTimestamp
		prev, prevErr := model.GetRevenueSummary(startTimestamp-span, startTimestamp-1, provider)
		if prevErr == nil {
			summary.MoneyGrowthPct = moneyGrowthPct(summaryRow.TotalMoney, prev.TotalMoney)
		}
	}

	bucketSize := model.PickStatisticsBucketSize(startTimestamp, endTimestamp)
	trend, err := model.GetRevenueTrend(startTimestamp, endTimestamp, provider, bucketSize)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	providerRows, err := model.GetRevenueByProvider(startTimestamp, endTimestamp, provider)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	byProvider := make([]revenueProviderItem, 0, len(providerRows))
	for _, row := range providerRows {
		item := revenueProviderItem{
			Provider: row.Provider,
			Money:    row.Money,
			Count:    row.Count,
		}
		if summaryRow.TotalMoney > 0 {
			item.Percentage = row.Money / summaryRow.TotalMoney * 100
		}
		byProvider = append(byProvider, item)
	}

	topUsers, err := model.GetTopRechargeUsers(startTimestamp, endTimestamp, provider, statisticsTopUsersLimit)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	recent, err := model.GetRecentTopUps(startTimestamp, endTimestamp, provider, statisticsRecentTopUpsLimit)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	common.ApiSuccess(c, gin.H{
		"summary":     summary,
		"trend":       trend,
		"by_provider": byProvider,
		"top_users":   topUsers,
		"recent":      recent,
		"bucket_size": bucketSize,
	})
}
