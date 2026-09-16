package model

import (
	"fmt"

	"gorm.io/gorm"
)

func consumeLogsQuery(startTime int64, endTime int64) *gorm.DB {
	query := LOG_DB.Table("logs").Where("type = ?", LogTypeConsume)
	return applyRankingQuotaTimeRange(query, startTime, endTime)
}

func consumeLogsQueryFiltered(startTime int64, endTime int64, keyword string) (*gorm.DB, error) {
	return applyQuotaDataUsernameFilter(consumeLogsQuery(startTime, endTime), keyword)
}

const consumeLogTokenUsedExpr = "COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0)"

// GetUserConsumeStatPaged 按 user_id 聚合消耗日志（LOG_DB.logs，type=consume）。
// 与使用日志同一数据源，避免 quota_data 最多 5 分钟的落库延迟。
func GetUserConsumeStatPaged(startTime int64, endTime int64, keyword string, startIdx int, num int) ([]UserQuotaSummaryRow, int64, error) {
	baseQuery := func() (*gorm.DB, error) {
		return consumeLogsQueryFiltered(startTime, endTime, keyword)
	}

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
		Select("user_id, MAX(username) as username, count(*) as count, COALESCE(sum(quota), 0) as quota, " +
			consumeLogTokenUsedExpr + " as token_used").
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

// GetUserConsumeTotals 消耗日志周期 KPI（不含 keyword，与列表 KPI 口径一致）。
func GetUserConsumeTotals(startTime int64, endTime int64) (UserQuotaTotals, error) {
	var totals UserQuotaTotals
	err := consumeLogsQuery(startTime, endTime).Select(
		"COALESCE(sum(quota), 0) as total_quota, " +
			"count(*) as total_count, " +
			consumeLogTokenUsedExpr + " as total_tokens, " +
			"COUNT(DISTINCT user_id) as active_users",
	).Scan(&totals).Error
	return totals, err
}

// GetConsumeModelQuotaTotals 按模型聚合消耗额度，供原始价值换算。
func GetConsumeModelQuotaTotals(startTime int64, endTime int64) ([]ModelQuotaRow, error) {
	rows := make([]ModelQuotaRow, 0)
	err := consumeLogsQuery(startTime, endTime).
		Select("model_name, COALESCE(sum(quota), 0) as quota").
		Group("model_name").
		Scan(&rows).Error
	return rows, err
}

// GetConsumeLogGroupByUserAndModel 当前页用户按模型拆分的消耗额度。
func GetConsumeLogGroupByUserAndModel(userIds []int, startTime int64, endTime int64) ([]UserModelQuotaRow, error) {
	rows := make([]UserModelQuotaRow, 0)
	if len(userIds) == 0 {
		return rows, nil
	}
	query := consumeLogsQuery(startTime, endTime).Where("user_id IN ?", userIds)
	err := query.
		Select("user_id, model_name, COALESCE(sum(quota), 0) as quota").
		Group("user_id, model_name").
		Scan(&rows).Error
	return rows, err
}

// GetUserConsumeSparkline 多用户消耗日志分桶，供列表 sparkline。
func GetUserConsumeSparkline(userIds []int, startTime int64, endTime int64, bucketSize int64) ([]UserQuotaSparkPoint, error) {
	rows := make([]UserQuotaSparkPoint, 0)
	if len(userIds) == 0 {
		return rows, nil
	}
	bucketExpr := rankingBucketExpr("created_at", bucketSize)
	query := consumeLogsQuery(startTime, endTime).Where("user_id IN ?", userIds)
	err := query.
		Select(fmt.Sprintf("user_id, %s as bucket, COALESCE(sum(quota), 0) as quota", bucketExpr)).
		Group(fmt.Sprintf("user_id, %s", bucketExpr)).
		Order("bucket ASC").
		Scan(&rows).Error
	return rows, err
}

// TokenUsageStat 某用户在周期内按密钥聚合的用量。
//
// 数据来源是 LOG_DB 的 logs 表（可能是独立数据库），因此 status / token_name
// 的补全必须在主库 DB 里单独查 tokens 表，绝不跨库 JOIN。
type TokenUsageStat struct {
	TokenId          int      `json:"token_id"`
	TokenName        string   `json:"token_name"`
	RequestCount     int64    `json:"request_count"`
	Quota            int64    `json:"quota"`
	OriginalValueUsd *float64 `json:"original_value_usd,omitempty"`
	TokenUsed        int64    `json:"token_used"`
	LastUsedAt       int64    `json:"last_used_at"`
	// Status: 1 启用 / 2 禁用 / 3 过期 等（见 common.TokenStatus*）。
	// -1 表示该 token 在主库中已不存在（软删除），前端应显示为「已删除」。
	Status int `json:"status"`
}

// tokenModelQuotaRow 按密钥 + 模型聚合的用量，用于换算每个密钥的"原始价值"。
type tokenModelQuotaRow struct {
	TokenId   int    `json:"token_id"`
	ModelName string `json:"model_name"`
	Quota     int64  `json:"quota"`
}

// userConsumeLogsQuery 单个用户的消耗日志基础查询（LOG_DB.logs，type=consume）。
func userConsumeLogsQuery(userId int, startTime int64, endTime int64) *gorm.DB {
	query := LOG_DB.Table("logs").
		Where("user_id = ?", userId).
		Where("type = ?", LogTypeConsume)
	return applyRankingQuotaTimeRange(query, startTime, endTime)
}

// GetUserTokenModelQuota 统计某用户在周期内每个密钥按模型拆分的用量，
// 供上层按模型最小有效倍率换算"原始价值"。
func GetUserTokenModelQuota(userId int, startTime int64, endTime int64) ([]tokenModelQuotaRow, error) {
	rows := make([]tokenModelQuotaRow, 0)
	err := userConsumeLogsQuery(userId, startTime, endTime).
		Where("token_id > 0").
		Select("token_id, model_name, COALESCE(sum(quota), 0) as quota").
		Group("token_id, model_name").
		Scan(&rows).Error
	return rows, err
}

// UserModelUsageStat 某用户在周期内按模型聚合的用量。
//
// 与 TokenUsageStat 不同，这里不过滤 token_id，因此合计即该用户周期内的
// 真实消耗（含没有关联密钥的调用）。
type UserModelUsageStat struct {
	ModelName        string   `json:"model_name"`
	RequestCount     int64    `json:"request_count"`
	Quota            int64    `json:"quota"`
	OriginalValueUsd *float64 `json:"original_value_usd,omitempty"`
	TokenUsed        int64    `json:"token_used"`
}

// GetUserModelUsageStat 统计某用户在周期内每个模型的消耗。
func GetUserModelUsageStat(userId int, startTime int64, endTime int64) ([]UserModelUsageStat, error) {
	rows := make([]UserModelUsageStat, 0)
	err := userConsumeLogsQuery(userId, startTime, endTime).
		Select("model_name, count(*) as request_count, COALESCE(sum(quota), 0) as quota, " +
			consumeLogTokenUsedExpr + " as token_used").
		Group("model_name").
		Order("quota DESC").
		Scan(&rows).Error
	return rows, err
}

// TokenStatusDeleted 表示令牌在主库中已被（软）删除，统计接口专用的标记值。
const TokenStatusDeleted = -1

// GetUserTokenUsageStat 统计某用户在周期内每个密钥的消耗。
//
// 步骤：
//  1. 在 LOG_DB 按 token_id 聚合（限定 user_id + type=consume，数据量可控）；
//  2. 拿到 token_id 列表后，在主库 DB 用 IN 查询补 name/status。
//
// 返回结果绝不包含 Token.Key 明文。
func GetUserTokenUsageStat(userId int, startTime int64, endTime int64) ([]TokenUsageStat, error) {
	rows := make([]TokenUsageStat, 0)

	err := userConsumeLogsQuery(userId, startTime, endTime).
		Where("token_id > 0").
		Select("token_id, "+
			"max(token_name) as token_name, "+
			"count(*) as request_count, "+
			"COALESCE(sum(quota), 0) as quota, "+
			consumeLogTokenUsedExpr+" as token_used, "+
			"max(created_at) as last_used_at").
		Group("token_id").
		Order("quota DESC").
		Scan(&rows).Error
	if err != nil {
		return nil, err
	}
	if len(rows) == 0 {
		return rows, nil
	}

	tokenIds := make([]int, 0, len(rows))
	for _, row := range rows {
		tokenIds = append(tokenIds, row.TokenId)
	}

	// 主库批量补 name / status（不跨库 JOIN，且不 Select Key 字段）
	type tokenMeta struct {
		Id     int
		Name   string
		Status int
	}
	metas := make([]tokenMeta, 0, len(tokenIds))
	if err := DB.Model(&Token{}).
		Select("id, name, status").
		Where("id IN ? AND user_id = ?", tokenIds, userId).
		Scan(&metas).Error; err != nil {
		return nil, err
	}

	metaById := make(map[int]tokenMeta, len(metas))
	for _, meta := range metas {
		metaById[meta.Id] = meta
	}

	result := make([]TokenUsageStat, 0, len(rows))
	for _, row := range rows {
		if meta, ok := metaById[row.TokenId]; ok {
			row.TokenName = meta.Name
			row.Status = meta.Status
		} else {
			row.Status = TokenStatusDeleted
		}
		result = append(result, row)
	}
	return result, nil
}
