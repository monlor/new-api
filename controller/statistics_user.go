package controller

import (
	"strconv"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"

	"github.com/gin-gonic/gin"
)

// statisticsSparklinePoints 用户列表行内 sparkline 的固定点数
const statisticsSparklinePoints = 12

type userStatisticsSummary struct {
	TotalQuota     int64   `json:"total_quota"`
	TotalCount     int64   `json:"total_count"`
	TotalTokens    int64   `json:"total_tokens"`
	ActiveUsers    int64   `json:"active_users"`
	QuotaGrowthPct float64 `json:"quota_growth_pct"`
	CountGrowthPct float64 `json:"count_growth_pct"`
}

type userStatisticsItem struct {
	UserId     int     `json:"user_id"`
	Username   string  `json:"username"`
	Count      int64   `json:"count"`
	Quota      int64   `json:"quota"`
	TokenUsed  int64   `json:"token_used"`
	Percentage float64 `json:"percentage"`
	Trend      []int64 `json:"trend"`
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
// quota_data 按小时对齐，所以最小粒度是 1 小时。
func sparklineBucketSize(startTime int64, endTime int64) int64 {
	if startTime <= 0 || endTime <= startTime {
		return model.StatisticsBucketHour
	}
	size := (endTime - startTime) / statisticsSparklinePoints
	if size < model.StatisticsBucketHour {
		return model.StatisticsBucketHour
	}
	// 对齐到整小时，保证桶边界与 quota_data 的小时对齐一致
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

	rows, total, err := model.GetQuotaDataGroupByUserPaged(
		startTimestamp, endTimestamp, keyword, pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}

	totals, err := model.GetUserQuotaTotals(startTimestamp, endTimestamp)
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

	// 环比：取等长的上一周期
	if startTimestamp > 0 && endTimestamp > startTimestamp {
		span := endTimestamp - startTimestamp
		prevTotals, prevErr := model.GetUserQuotaTotals(startTimestamp-span, startTimestamp-1)
		if prevErr == nil {
			summary.QuotaGrowthPct = growthPct(totals.TotalQuota, prevTotals.TotalQuota)
			summary.CountGrowthPct = growthPct(totals.TotalCount, prevTotals.TotalCount)
		}
	}

	userIds := make([]int, 0, len(rows))
	for _, row := range rows {
		userIds = append(userIds, row.UserId)
	}

	sparklines := make(map[int][]int64)
	if len(userIds) > 0 && startTimestamp > 0 && endTimestamp > startTimestamp {
		bucketSize := sparklineBucketSize(startTimestamp, endTimestamp)
		points, sparkErr := model.GetUserQuotaSparkline(userIds, startTimestamp, endTimestamp, bucketSize)
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

	common.ApiSuccess(c, gin.H{
		"items": items,
	})
}
