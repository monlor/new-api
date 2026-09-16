package model

import (
	"fmt"
	"strings"
	"testing"

	"github.com/QuantumNous/new-api/common"
	"github.com/glebarez/sqlite"
	"github.com/stretchr/testify/require"
	"gorm.io/gorm"
)

func setupConsumeStatTestDB(t *testing.T) {
	t.Helper()

	oldDB, oldLogDB := DB, LOG_DB
	oldSQLite, oldMySQL, oldPG := common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL
	common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL = true, false, false

	dsn := fmt.Sprintf("file:%s?mode=memory&cache=shared", strings.ReplaceAll(t.Name(), "/", "_"))
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	require.NoError(t, err)
	DB, LOG_DB = db, db
	sqlDB, err := db.DB()
	require.NoError(t, err)
	t.Cleanup(func() { _ = sqlDB.Close() })
	t.Cleanup(func() {
		DB, LOG_DB = oldDB, oldLogDB
		common.UsingSQLite, common.UsingMySQL, common.UsingPostgreSQL = oldSQLite, oldMySQL, oldPG
	})
	require.NoError(t, db.AutoMigrate(&Log{}))
}

func TestGetUserConsumeStatExcludesNonConsumeAndOutsideWindow(t *testing.T) {
	setupConsumeStatTestDB(t)

	start, end := int64(1000), int64(2000)
	require.NoError(t, LOG_DB.Create([]*Log{
		{UserId: 3, Username: "admin", Type: LogTypeConsume, ModelName: "gpt-5", Quota: 100, PromptTokens: 10, CompletionTokens: 5, CreatedAt: 1500},
		{UserId: 3, Username: "admin", Type: LogTypeConsume, ModelName: "gpt-5", Quota: 50, PromptTokens: 4, CompletionTokens: 1, CreatedAt: 1800},
		{UserId: 3, Username: "admin", Type: LogTypeLogin, ModelName: "", Quota: 0, CreatedAt: 1600},
		{UserId: 3, Username: "admin", Type: LogTypeConsume, ModelName: "gpt-5", Quota: 999, PromptTokens: 9, CompletionTokens: 9, CreatedAt: 2500},
		{UserId: 8, Username: "alice", Type: LogTypeConsume, ModelName: "claude", Quota: 20, PromptTokens: 2, CompletionTokens: 2, CreatedAt: 1700},
	}).Error)

	rows, total, err := GetUserConsumeStatPaged(start, end, "", 0, 20)
	require.NoError(t, err)
	require.Equal(t, int64(2), total)
	require.Len(t, rows, 2)
	require.Equal(t, 3, rows[0].UserId)
	require.Equal(t, int64(2), rows[0].Count)
	require.Equal(t, int64(150), rows[0].Quota)
	require.Equal(t, int64(20), rows[0].TokenUsed)
	require.Equal(t, 8, rows[1].UserId)
	require.Equal(t, int64(1), rows[1].Count)
	require.Equal(t, int64(20), rows[1].Quota)

	totals, err := GetUserConsumeTotals(start, end)
	require.NoError(t, err)
	require.Equal(t, int64(170), totals.TotalQuota)
	require.Equal(t, int64(3), totals.TotalCount)
	require.Equal(t, int64(24), totals.TotalTokens)
	require.Equal(t, int64(2), totals.ActiveUsers)

	filtered, filteredTotal, err := GetUserConsumeStatPaged(start, end, "ali", 0, 20)
	require.NoError(t, err)
	require.Equal(t, int64(1), filteredTotal)
	require.Len(t, filtered, 1)
	require.Equal(t, "alice", filtered[0].Username)
}

// TestGetUserModelUsageStat 模型维度不按 token_id 过滤，因此合计即该用户周期内的真实消耗。
func TestGetUserModelUsageStat(t *testing.T) {
	setupConsumeStatTestDB(t)

	start, end := int64(1000), int64(2000)
	require.NoError(t, LOG_DB.Create([]*Log{
		{UserId: 3, Username: "admin", Type: LogTypeConsume, ModelName: "gpt-5", TokenId: 7, Quota: 100, PromptTokens: 10, CompletionTokens: 5, CreatedAt: 1500},
		// token_id = 0（无关联密钥）的调用同样要计入模型维度
		{UserId: 3, Username: "admin", Type: LogTypeConsume, ModelName: "gpt-5", TokenId: 0, Quota: 20, PromptTokens: 2, CompletionTokens: 1, CreatedAt: 1600},
		{UserId: 3, Username: "admin", Type: LogTypeConsume, ModelName: "claude", TokenId: 7, Quota: 300, PromptTokens: 30, CompletionTokens: 10, CreatedAt: 1700},
		// 非 consume 类型：排除
		{UserId: 3, Username: "admin", Type: LogTypeLogin, ModelName: "gpt-5", Quota: 999, CreatedAt: 1650},
		// 窗口外：排除
		{UserId: 3, Username: "admin", Type: LogTypeConsume, ModelName: "gpt-5", Quota: 888, CreatedAt: 2500},
		// 其他用户：排除
		{UserId: 8, Username: "alice", Type: LogTypeConsume, ModelName: "gpt-5", Quota: 777, CreatedAt: 1500},
	}).Error)

	rows, err := GetUserModelUsageStat(3, start, end)
	require.NoError(t, err)
	require.Len(t, rows, 2)

	// 按 quota DESC 排序
	require.Equal(t, "claude", rows[0].ModelName)
	require.Equal(t, int64(1), rows[0].RequestCount)
	require.Equal(t, int64(300), rows[0].Quota)
	require.Equal(t, int64(40), rows[0].TokenUsed)

	require.Equal(t, "gpt-5", rows[1].ModelName)
	require.Equal(t, int64(2), rows[1].RequestCount)
	require.Equal(t, int64(120), rows[1].Quota)
	require.Equal(t, int64(18), rows[1].TokenUsed)
}

func TestGetConsumeLogSparklineBucketsRequests(t *testing.T) {
	setupConsumeStatTestDB(t)

	require.NoError(t, LOG_DB.Create([]*Log{
		{UserId: 3, Username: "admin", Type: LogTypeConsume, Quota: 10, CreatedAt: 3600},
		{UserId: 3, Username: "admin", Type: LogTypeConsume, Quota: 5, CreatedAt: 3700},
		{UserId: 3, Username: "admin", Type: LogTypeConsume, Quota: 7, CreatedAt: 7200},
	}).Error)

	points, err := GetUserConsumeSparkline([]int{3}, 3600, 8000, 3600)
	require.NoError(t, err)
	require.Len(t, points, 2)
	require.Equal(t, int64(3600), points[0].Bucket)
	require.Equal(t, int64(15), points[0].Quota)
	require.Equal(t, int64(7200), points[1].Bucket)
	require.Equal(t, int64(7), points[1].Quota)
}
