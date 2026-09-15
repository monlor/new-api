package model

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"gorm.io/gorm"
)

// UserQuotaSummaryRow 用户用量列表的一行（来自 quota_data 预聚合表）
type UserQuotaSummaryRow struct {
	UserId    int    `json:"user_id"`
	Username  string `json:"username"`
	Count     int64  `json:"count"`
	Quota     int64  `json:"quota"`
	TokenUsed int64  `json:"token_used"`
}

// UserQuotaTotals 用户用量 KPI 汇总
type UserQuotaTotals struct {
	TotalQuota  int64 `json:"total_quota"`
	TotalCount  int64 `json:"total_count"`
	TotalTokens int64 `json:"total_tokens"`
	ActiveUsers int64 `json:"active_users"`
}

// applyQuotaDataUsernameFilter matches username. Explicit `%` uses the log
// text-filter contract; otherwise LIKE is applied only when the keyword has
// at least two runes (sanitizeLikePattern rejects shorter fuzzy patterns).
func applyQuotaDataUsernameFilter(query *gorm.DB, keyword string) (*gorm.DB, error) {
	keyword = strings.TrimSpace(keyword)
	if keyword == "" {
		return query, nil
	}
	if strings.Contains(keyword, "%") {
		return applyExplicitLogTextFilter(query, "username", keyword)
	}
	if utf8.RuneCountInString(keyword) < 2 {
		return query, nil
	}
	pattern, err := sanitizeLikePattern("%" + keyword + "%")
	if err != nil {
		return nil, err
	}
	return query.Where("username LIKE ? ESCAPE '!'", pattern), nil
}

// GetQuotaDataGroupByUserPaged 按 user_id 聚合用户用量，支持 username 过滤与分页。
//
// username 是写入时的冗余字段，改名会留下旧值；只 Group user_id，展示名取 MAX(username)。
func GetQuotaDataGroupByUserPaged(startTime int64, endTime int64, keyword string, startIdx int, num int) ([]UserQuotaSummaryRow, int64, error) {
	baseQuery := func() (*gorm.DB, error) {
		q := applyRankingQuotaTimeRange(DB.Table("quota_data"), startTime, endTime)
		return applyQuotaDataUsernameFilter(q, keyword)
	}

	// total = 去重后的用户数量。COUNT(DISTINCT col) 三库均支持。
	var countResult struct {
		Total int64
	}
	countQuery, err := baseQuery()
	if err != nil {
		return nil, 0, err
	}
	if err := countQuery.Select("COUNT(DISTINCT user_id) as total").Scan(&countResult).Error; err != nil {
		return nil, 0, err
	}
	if countResult.Total == 0 {
		return []UserQuotaSummaryRow{}, 0, nil
	}

	listQuery, err := baseQuery()
	if err != nil {
		return nil, 0, err
	}
	rows := make([]UserQuotaSummaryRow, 0)
	err = listQuery.
		Select("user_id, MAX(username) as username, sum(count) as count, sum(quota) as quota, sum(token_used) as token_used").
		Group("user_id").
		Order("quota DESC").
		Limit(num).
		Offset(startIdx).
		Scan(&rows).Error
	if err != nil {
		return nil, 0, err
	}
	return rows, countResult.Total, nil
}

// GetUserQuotaTotals 返回给定周期内的用量 KPI 汇总（用于顶部卡片与环比计算）
func GetUserQuotaTotals(startTime int64, endTime int64) (UserQuotaTotals, error) {
	var totals UserQuotaTotals
	query := applyRankingQuotaTimeRange(DB.Table("quota_data"), startTime, endTime)
	err := query.Select(
		"COALESCE(sum(quota), 0) as total_quota, " +
			"COALESCE(sum(count), 0) as total_count, " +
			"COALESCE(sum(token_used), 0) as total_tokens, " +
			"COUNT(DISTINCT user_id) as active_users",
	).Scan(&totals).Error
	return totals, err
}

// ModelQuotaRow 按模型聚合的用量（用于换算"原始价值"）
type ModelQuotaRow struct {
	ModelName string `json:"model_name"`
	Quota     int64  `json:"quota"`
}

// UserModelQuotaRow 按用户 + 模型聚合的用量
type UserModelQuotaRow struct {
	UserId    int    `json:"user_id"`
	ModelName string `json:"model_name"`
	Quota     int64  `json:"quota"`
}

// UserQuotaSparkPoint 多用户分桶用量（用于列表行内 sparkline）
type UserQuotaSparkPoint struct {
	UserId int   `json:"user_id"`
	Bucket int64 `json:"bucket"`
	Quota  int64 `json:"quota"`
}

// GetUserQuotaSparkline 一次性取回多个用户的分桶用量，避免前端按行发 N 次请求。
func GetUserQuotaSparkline(userIds []int, startTime int64, endTime int64, bucketSize int64) ([]UserQuotaSparkPoint, error) {
	rows := make([]UserQuotaSparkPoint, 0)
	if len(userIds) == 0 {
		return rows, nil
	}
	bucketExpr := rankingBucketExpr("created_at", bucketSize)
	query := DB.Table("quota_data").Where("user_id IN ?", userIds)
	query = applyRankingQuotaTimeRange(query, startTime, endTime)
	err := query.
		Select(fmt.Sprintf("user_id, %s as bucket, sum(quota) as quota", bucketExpr)).
		Group(fmt.Sprintf("user_id, %s", bucketExpr)).
		Order("bucket ASC").
		Scan(&rows).Error
	return rows, err
}
