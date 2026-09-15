package controller

import (
	"math"
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting/ratio_setting"

	"github.com/gin-gonic/gin"
)

// statisticsSparklinePoints 用户列表行内 sparkline 的固定点数
const statisticsSparklinePoints = 12

type userStatisticsSummary struct {
	TotalQuota       int64    `json:"total_quota"`
	OriginalValueUsd *float64 `json:"original_value_usd,omitempty"`
	TotalCount       int64    `json:"total_count"`
	TotalTokens      int64    `json:"total_tokens"`
	ActiveUsers      int64    `json:"active_users"`
	QuotaGrowthPct   float64  `json:"quota_growth_pct"`
	CountGrowthPct   float64  `json:"count_growth_pct"`
}

type userStatisticsItem struct {
	UserId           int      `json:"user_id"`
	Username         string   `json:"username"`
	Count            int64    `json:"count"`
	Quota            int64    `json:"quota"`
	OriginalValueUsd *float64 `json:"original_value_usd,omitempty"`
	TokenUsed        int64    `json:"token_used"`
	Percentage       float64  `json:"percentage"`
	Trend            []int64  `json:"trend"`
}

// minEffectiveRatio 复刻前端 getMinEffectiveRatio/getSubscriptionEffectiveRatio：
// 某模型在所有已启用分组里，(group_ratio × channel_ratio 最小值) 的最小值。
func minEffectiveRatio(pricing model.Pricing, groupRatios map[string]float64) float64 {
	channelMin := pricing.GroupChannelRatioMinSubscription
	if channelMin == nil {
		channelMin = pricing.GroupChannelRatioMin
	}
	if len(pricing.EnableGroup) == 0 {
		return 1
	}
	minRatio := math.Inf(1)
	for _, g := range pricing.EnableGroup {
		gr, ok := groupRatios[g]
		if !ok {
			continue
		}
		cr := 1.0
		if v, ok := channelMin[g]; ok {
			cr = v
		}
		if eff := gr * cr; eff < minRatio {
			minRatio = eff
		}
	}
	if math.IsInf(minRatio, 1) {
		return 1
	}
	return minRatio
}

// originalValueUSDForModelQuota 把某模型的计费额度换算成"原始价值"：
// 官方 USD = quota/QuotaPerUnit 除以该模型在所有可用渠道+分组里的最小有效倍率。
func originalValueUSDForModelQuota(modelName string, quota int64, pricingByModel map[string]model.Pricing, groupRatios map[string]float64) (float64, bool) {
	pricing, ok := pricingByModel[modelName]
	if !ok {
		return 0, false
	}
	ratio := minEffectiveRatio(pricing, groupRatios)
	if ratio <= 0 {
		return 0, false
	}
	usd := float64(quota) / common.QuotaPerUnit
	return usd / ratio, true
}

// addOriginalValueUSD 仅在该行成功换算时累加，并标记 converted。
func addOriginalValueUSD(sum *float64, converted *bool, modelName string, quota int64, pricingByModel map[string]model.Pricing, groupRatios map[string]float64) {
	value, ok := originalValueUSDForModelQuota(modelName, quota, pricingByModel, groupRatios)
	if !ok {
		return
	}
	*sum += value
	*converted = true
}

func originalValueUSDPtr(sum float64, converted bool) *float64 {
	if !converted {
		return nil
	}
	return common.GetPointer(sum)
}

// buildPricingIndex 构建按模型名索引的定价表 + 全局分组倍率，供原始价值换算复用。
func buildPricingIndex() (map[string]model.Pricing, map[string]float64) {
	pricingList := model.GetPricing()
	pricingByModel := make(map[string]model.Pricing, len(pricingList))
	for _, p := range pricingList {
		pricingByModel[p.ModelName] = p
	}
	return pricingByModel, ratio_setting.GetGroupRatioCopy()
}

// growthPct 计算环比百分比。上一周期为 0 时：当前也为 0 → 0%，否则视为 100%。
func growthPct(current int64, previous int64) float64 {
	if previous == 0 {
		if current == 0 {
			return 0
		}
		return 100
	}
	return float64(current-previous) / float64(previous) * 100
}

// parseStatisticsTimeRange 读取统一的 start_timestamp / end_timestamp 参数
func parseStatisticsTimeRange(c *gin.Context) (int64, int64) {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	return startTimestamp, endTimestamp
}

// sparklineBucketSize 根据周期长度推导 sparkline 的分桶粒度。
// 最小粒度 1 小时，避免「今天」被拆成过碎的空桶。
func sparklineBucketSize(startTime int64, endTime int64) int64 {
	if startTime <= 0 || endTime <= startTime {
		return model.StatisticsBucketHour
	}
	size := (endTime - startTime) / statisticsSparklinePoints
	if size < model.StatisticsBucketHour {
		return model.StatisticsBucketHour
	}
	return size - size%model.StatisticsBucketHour
}

// buildUserSparklines 把分桶结果摊平成每个用户固定长度的 quota 数组（旧 → 新）
func buildUserSparklines(points []model.UserQuotaSparkPoint, startTime int64, bucketSize int64) map[int][]int64 {
	result := make(map[int][]int64)
	if bucketSize <= 0 {
		return result
	}
	alignedStart := startTime - startTime%model.StatisticsBucketHour
	for _, point := range points {
		series, ok := result[point.UserId]
		if !ok {
			series = make([]int64, statisticsSparklinePoints)
			result[point.UserId] = series
		}
		idx := int((point.Bucket - alignedStart) / bucketSize)
		if idx < 0 {
			idx = 0
		}
		if idx >= statisticsSparklinePoints {
			idx = statisticsSparklinePoints - 1
		}
		series[idx] += point.Quota
	}
	return result
}

// GetUserStatistics GET /api/statistics/users
func GetUserStatistics(c *gin.Context) {
	startTimestamp, endTimestamp := parseStatisticsTimeRange(c)
	keyword := c.Query("keyword")
	pageInfo := common.GetPageQuery(c)

	rows, total, err := model.GetUserConsumeStatPaged(
		startTimestamp, endTimestamp, keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}

	totals, err := model.GetUserConsumeTotals(startTimestamp, endTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	summary := userStatisticsSummary{
		TotalQuota:  totals.TotalQuota,
		TotalCount:  totals.TotalCount,
		TotalTokens: totals.TotalTokens,
		ActiveUsers: totals.ActiveUsers,
	}

	pricingByModel, groupRatios := buildPricingIndex()

	// 原始价值：按模型最小有效倍率换算后汇总；查询失败或无一成功换算则省略字段
	if modelRows, modelErr := model.GetConsumeModelQuotaTotals(startTimestamp, endTimestamp); modelErr == nil {
		var sum float64
		converted := false
		for _, row := range modelRows {
			addOriginalValueUSD(&sum, &converted, row.ModelName, row.Quota, pricingByModel, groupRatios)
		}
		summary.OriginalValueUsd = originalValueUSDPtr(sum, converted)
	}

	// 环比：取等长的上一周期
	if startTimestamp > 0 && endTimestamp > startTimestamp {
		span := endTimestamp - startTimestamp
		prevTotals, prevErr := model.GetUserConsumeTotals(startTimestamp-span, startTimestamp-1)
		if prevErr == nil {
			summary.QuotaGrowthPct = growthPct(totals.TotalQuota, prevTotals.TotalQuota)
			summary.CountGrowthPct = growthPct(totals.TotalCount, prevTotals.TotalCount)
		}
	}

	userIds := make([]int, 0, len(rows))
	for _, row := range rows {
		userIds = append(userIds, row.UserId)
	}

	originalValues := make(map[int]float64)
	originalValueConverted := make(map[int]bool)
	if userModelRows, modelErr := model.GetConsumeLogGroupByUserAndModel(userIds, startTimestamp, endTimestamp); modelErr == nil {
		for _, row := range userModelRows {
			sum := originalValues[row.UserId]
			converted := originalValueConverted[row.UserId]
			addOriginalValueUSD(&sum, &converted, row.ModelName, row.Quota, pricingByModel, groupRatios)
			originalValues[row.UserId] = sum
			originalValueConverted[row.UserId] = converted
		}
	}

	sparklines := make(map[int][]int64)
	if len(userIds) > 0 && startTimestamp > 0 && endTimestamp > startTimestamp {
		bucketSize := sparklineBucketSize(startTimestamp, endTimestamp)
		points, sparkErr := model.GetUserConsumeSparkline(userIds, startTimestamp, endTimestamp, bucketSize)
		if sparkErr == nil {
			sparklines = buildUserSparklines(points, startTimestamp, bucketSize)
		}
	}

	items := make([]userStatisticsItem, 0, len(rows))
	for _, row := range rows {
		item := userStatisticsItem{
			UserId:    row.UserId,
			Username:  row.Username,
			Count:     row.Count,
			Quota:     row.Quota,
			TokenUsed: row.TokenUsed,
			Trend:     sparklines[row.UserId],
		}
		if originalValueConverted[row.UserId] {
			item.OriginalValueUsd = originalValueUSDPtr(originalValues[row.UserId], true)
		}
		if item.Trend == nil {
			item.Trend = make([]int64, 0)
		}
		if totals.TotalQuota > 0 {
			item.Percentage = float64(row.Quota) / float64(totals.TotalQuota) * 100
		}
		items = append(items, item)
	}

	common.ApiSuccess(c, gin.H{
		"summary": summary,
		"items":   items,
		"total":   total,
	})
}

// GetUserTokenStatistics GET /api/statistics/users/tokens
func GetUserTokenStatistics(c *gin.Context) {
	userId, err := strconv.Atoi(c.Query("user_id"))
	if err != nil || userId <= 0 {
		common.ApiErrorMsg(c, "无效的用户 ID")
		return
	}
	startTimestamp, endTimestamp := parseStatisticsTimeRange(c)

	items, err := model.GetUserTokenUsageStat(userId, startTimestamp, endTimestamp)
	if err != nil {
		common.ApiError(c, err)
		return
	}

	// 原始价值：按密钥 + 模型拆分后换算；查询失败或该密钥无一成功换算则省略字段
	if modelRows, modelErr := model.GetUserTokenModelQuota(userId, startTimestamp, endTimestamp); modelErr == nil {
		pricingByModel, groupRatios := buildPricingIndex()
		originalValues := make(map[int]float64)
		originalValueConverted := make(map[int]bool)
		for _, row := range modelRows {
			sum := originalValues[row.TokenId]
			converted := originalValueConverted[row.TokenId]
			addOriginalValueUSD(&sum, &converted, row.ModelName, row.Quota, pricingByModel, groupRatios)
			originalValues[row.TokenId] = sum
			originalValueConverted[row.TokenId] = converted
		}
		for i := range items {
			if originalValueConverted[items[i].TokenId] {
				items[i].OriginalValueUsd = originalValueUSDPtr(originalValues[items[i].TokenId], true)
			}
		}
	}

	common.ApiSuccess(c, gin.H{
		"items": items,
	})
}
