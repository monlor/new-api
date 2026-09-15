package model

// TokenUsageStat 某用户在周期内按密钥聚合的用量。
//
// 数据来源是 LOG_DB 的 logs 表（可能是独立数据库），因此 status / token_name
// 的补全必须在主库 DB 里单独查 tokens 表，绝不跨库 JOIN。
type TokenUsageStat struct {
	TokenId      int    `json:"token_id"`
	TokenName    string `json:"token_name"`
	RequestCount int64  `json:"request_count"`
	Quota        int64  `json:"quota"`
	TokenUsed    int64  `json:"token_used"`
	LastUsedAt   int64  `json:"last_used_at"`
	// Status: 1 启用 / 2 禁用 / 3 过期 等（见 common.TokenStatus*）。
	// -1 表示该 token 在主库中已不存在（软删除），前端应显示为「已删除」。
	Status int `json:"status"`
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

	tx := LOG_DB.Table("logs").
		Where("user_id = ?", userId).
		Where("type = ?", LogTypeConsume).
		Where("token_id > 0")
	if startTime > 0 {
		tx = tx.Where("created_at >= ?", startTime)
	}
	if endTime > 0 {
		tx = tx.Where("created_at <= ?", endTime)
	}

	err := tx.Select("token_id, " +
		"max(token_name) as token_name, " +
		"count(*) as request_count, " +
		"COALESCE(sum(quota), 0) as quota, " +
		"COALESCE(sum(prompt_tokens), 0) + COALESCE(sum(completion_tokens), 0) as token_used, " +
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
