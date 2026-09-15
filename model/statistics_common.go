package model

// 统计面板共用的分桶粒度（秒）
const (
	StatisticsBucketHour = int64(3600)
	StatisticsBucketDay  = int64(86400)
)

// PickStatisticsBucketSize 根据时间跨度自动选择分桶粒度：
// 跨度 <= 3 天用小时桶，否则用天桶，避免前端拿到过多数据点。
func PickStatisticsBucketSize(startTime int64, endTime int64) int64 {
	if startTime <= 0 || endTime <= 0 || endTime <= startTime {
		return StatisticsBucketHour
	}
	if endTime-startTime <= 3*StatisticsBucketDay {
		return StatisticsBucketHour
	}
	return StatisticsBucketDay
}
