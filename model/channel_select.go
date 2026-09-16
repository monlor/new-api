package model

import (
	"context"
	"math"
	"time"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/common/chrate"
	"github.com/QuantumNous/new-api/dto"
	"github.com/QuantumNous/new-api/logger"
)

type channelLoadSnapshot struct {
	channel *Channel
	setting dto.ChannelSettings
	usage   int
}

func pickChannelByWeightAndLoad(channels []*Channel) *Channel {
	if len(channels) == 0 {
		return nil
	}
	if len(channels) == 1 {
		return channels[0]
	}

	hasLimit := false
	for _, ch := range channels {
		if ch != nil && ch.GetSetting().HasRateLimit() {
			hasLimit = true
			break
		}
	}
	if !hasLimit {
		return pickChannelByWeight(channels)
	}

	snapshots := snapshotChannelLoad(channels)
	buckets := groupChannelsByRatio(snapshots)
	selectedBucket := pickRatioBucketByWeight(buckets)
	if len(selectedBucket) == 0 {
		return channels[0]
	}
	if !bucketHasRateLimit(selectedBucket) {
		return pickChannelByWeight(channelsFromSnapshots(selectedBucket))
	}
	return pickLeastLoadedChannel(selectedBucket)
}

func snapshotChannelLoad(channels []*Channel) []channelLoadSnapshot {
	out := make([]channelLoadSnapshot, 0, len(channels))
	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	for _, ch := range channels {
		if ch == nil {
			continue
		}
		setting := ch.GetSetting()
		usage := 0
		if setting.HasRateLimit() {
			count, err := chrate.Usage(ctx, ch.Id, setting.GetRateLimitDurationMs())
			if err != nil {
				logger.LogWarn(ctx, "channel rate limit usage read failed: "+err.Error())
			} else {
				usage = count
			}
		}
		out = append(out, channelLoadSnapshot{channel: ch, setting: setting, usage: usage})
	}
	return out
}

func groupChannelsByRatio(snapshots []channelLoadSnapshot) map[float64][]channelLoadSnapshot {
	buckets := make(map[float64][]channelLoadSnapshot)
	for _, snap := range snapshots {
		ratio := snap.channel.GetRatio()
		if ratio <= 0 {
			ratio = 1
		}
		buckets[ratio] = append(buckets[ratio], snap)
	}
	return buckets
}

func pickRatioBucketByWeight(buckets map[float64][]channelLoadSnapshot) []channelLoadSnapshot {
	if len(buckets) == 1 {
		for _, bucket := range buckets {
			return bucket
		}
	}
	type ratioBucket struct {
		ratio  float64
		items  []channelLoadSnapshot
		weight int
	}
	list := make([]ratioBucket, 0, len(buckets))
	total := 0
	for ratio, items := range buckets {
		weight := 0
		for _, item := range items {
			itemWeight := item.channel.GetWeight()
			if itemWeight < 0 {
				itemWeight = 0
			}
			weight += itemWeight
		}
		if weight == 0 {
			weight = len(items) * 100
		}
		list = append(list, ratioBucket{ratio: ratio, items: items, weight: weight})
		total += weight
	}
	if total <= 0 {
		for _, bucket := range buckets {
			return bucket
		}
	}
	cursor := common.GetRandomInt(total)
	for _, bucket := range list {
		cursor -= bucket.weight
		if cursor < 0 {
			return bucket.items
		}
	}
	return list[len(list)-1].items
}

func bucketHasRateLimit(bucket []channelLoadSnapshot) bool {
	for _, item := range bucket {
		if item.setting.HasRateLimit() {
			return true
		}
	}
	return false
}

func channelsFromSnapshots(bucket []channelLoadSnapshot) []*Channel {
	out := make([]*Channel, 0, len(bucket))
	for _, item := range bucket {
		out = append(out, item.channel)
	}
	return out
}

func pickLeastLoadedChannel(bucket []channelLoadSnapshot) *Channel {
	best := bucket[0]
	bestScore := loadScore(best)
	for i := 1; i < len(bucket); i++ {
		score := loadScore(bucket[i])
		if loadLess(bucket[i], score, best, bestScore) {
			best = bucket[i]
			bestScore = score
		}
	}
	return best.channel
}

func loadScore(snap channelLoadSnapshot) float64 {
	if !snap.setting.HasRateLimit() {
		return 0
	}
	if snap.setting.RateLimitCount <= 0 {
		return 0
	}
	return float64(snap.usage) / float64(snap.setting.RateLimitCount)
}

func remainingSlots(snap channelLoadSnapshot) int {
	if !snap.setting.HasRateLimit() {
		return math.MaxInt
	}
	left := snap.setting.RateLimitCount - snap.usage
	if left < 0 {
		return 0
	}
	return left
}

func loadLess(a channelLoadSnapshot, aScore float64, b channelLoadSnapshot, bScore float64) bool {
	if aScore < bScore {
		return true
	}
	if aScore > bScore {
		return false
	}
	aLeft := remainingSlots(a)
	bLeft := remainingSlots(b)
	if aLeft != bLeft {
		return aLeft > bLeft
	}
	return a.channel.GetWeight() > b.channel.GetWeight()
}

func pickChannelByWeight(channels []*Channel) *Channel {
	if len(channels) == 0 {
		return nil
	}
	if len(channels) == 1 {
		return channels[0]
	}

	sumWeight := 0
	for _, channel := range channels {
		sumWeight += channel.GetWeight()
	}

	smoothingFactor := 1
	smoothingAdjustment := 0
	if sumWeight == 0 {
		sumWeight = len(channels) * 100
		smoothingAdjustment = 100
	} else if sumWeight/len(channels) < 10 {
		smoothingFactor = 100
	}

	totalWeight := sumWeight * smoothingFactor
	if totalWeight <= 0 {
		return channels[0]
	}
	randomWeight := common.GetRandomInt(totalWeight)
	for _, channel := range channels {
		randomWeight -= channel.GetWeight()*smoothingFactor + smoothingAdjustment
		if randomWeight < 0 {
			return channel
		}
	}
	return channels[len(channels)-1]
}
