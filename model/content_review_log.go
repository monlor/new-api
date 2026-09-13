package model

import (
	"context"
	"errors"
	"math"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/types"

	"gorm.io/gorm"
)

const (
	ContentReviewDecisionPass  = "pass"
	ContentReviewDecisionFlag  = "flag"
	ContentReviewDecisionBlock = "block"
	ContentReviewDecisionError = "error"
)

type ContentReviewLog struct {
	Id               int     `json:"id" gorm:"primaryKey;index:idx_cr_created_at_id,priority:2"`
	CreatedAt        int64   `json:"created_at" gorm:"bigint;index:idx_cr_created_at_id,priority:1"`
	UserId           int     `json:"user_id" gorm:"index"`
	Username         string  `json:"username" gorm:"index;default:''"`
	RequestId        string  `json:"request_id" gorm:"type:varchar(64);index;default:''"`
	Mode             string  `json:"mode" gorm:"type:varchar(16);default:''"`
	Decision         string  `json:"decision" gorm:"type:varchar(16);index;default:''"`
	Confidence       float64 `json:"confidence" gorm:"default:0"`
	Reason           string  `json:"reason" gorm:"type:varchar(255);default:''"`
	ReviewModel      string  `json:"review_model" gorm:"index;default:''"`
	ChannelId        int     `json:"channel" gorm:"index"`
	ChannelName      string  `json:"channel_name" gorm:"->"`
	Group            string  `json:"group" gorm:"index;default:''"`
	PromptTokens     int     `json:"prompt_tokens" gorm:"default:0"`
	CompletionTokens int     `json:"completion_tokens" gorm:"default:0"`
	EstimatedQuota   int     `json:"estimated_quota" gorm:"default:0"`
	UseTimeMs        int     `json:"use_time_ms" gorm:"default:0"`
	OriginalModel    string  `json:"original_model" gorm:"default:''"`
	TokenName        string  `json:"token_name" gorm:"default:''"`
	TokenId          int     `json:"token_id" gorm:"default:0"`
	Failed           bool    `json:"failed" gorm:"default:false"`
	FailMessage      string  `json:"fail_message" gorm:"type:varchar(255);default:''"`
	UsageMissing     bool    `json:"usage_missing" gorm:"default:false"`
	InputPreview     string  `json:"input_preview" gorm:"type:varchar(512);default:''"`
}

type ContentReviewLogQuery struct {
	StartTimestamp int64
	EndTimestamp   int64
	Username       string
	Decision       string
	ReviewModel    string
	ChannelId      int
	RequestId      string
}

type ContentReviewLogStat struct {
	Total            int64   `json:"total"`
	Pass             int64   `json:"pass"`
	Flag             int64   `json:"flag"`
	Block            int64   `json:"block"`
	Error            int64   `json:"error"`
	PromptTokens     int64   `json:"prompt_tokens"`
	CompletionTokens int64   `json:"completion_tokens"`
	EstimatedQuota   int64   `json:"estimated_quota"`
	AvgConfidence    float64 `json:"avg_confidence"`
	AvgUseTimeMs     float64 `json:"avg_use_time_ms"`
	Sampled          bool    `json:"sampled"`
	PassSampleRate   float64 `json:"pass_sample_rate"`
	// Pass-only usage used to scale estimates. Omitted from JSON.
	PassPromptTokens     int64 `json:"-"`
	PassCompletionTokens int64 `json:"-"`
	PassEstimatedQuota   int64 `json:"-"`
}

func RecordContentReviewLog(log *ContentReviewLog) {
	if log == nil {
		return
	}
	if log.CreatedAt == 0 {
		log.CreatedAt = common.GetTimestamp()
	}
	if err := LOG_DB.Create(log).Error; err != nil {
		common.SysLog("failed to record content review log: " + err.Error())
	}
}

func GetAllContentReviewLogs(q ContentReviewLogQuery, startIdx int, num int) (logs []*ContentReviewLog, total int64, err error) {
	tx, err := buildContentReviewLogQuery(q)
	if err != nil {
		return nil, 0, err
	}
	if err = tx.Model(&ContentReviewLog{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err = tx.Order("created_at desc, id desc").Limit(num).Offset(startIdx).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	fillContentReviewLogChannelNames(logs)
	return logs, total, nil
}

func SumContentReviewLogs(q ContentReviewLogQuery) (stat ContentReviewLogStat, err error) {
	tx, err := buildContentReviewLogQuery(q)
	if err != nil {
		return stat, err
	}
	selectSQL := strings.Join([]string{
		"count(*) as total",
		"coalesce(sum(case when decision = 'pass' then 1 else 0 end), 0) as pass",
		"coalesce(sum(case when decision = 'flag' then 1 else 0 end), 0) as flag",
		"coalesce(sum(case when decision = 'block' then 1 else 0 end), 0) as block",
		"coalesce(sum(case when decision = 'error' then 1 else 0 end), 0) as error",
		"coalesce(sum(prompt_tokens), 0) as prompt_tokens",
		"coalesce(sum(completion_tokens), 0) as completion_tokens",
		"coalesce(sum(estimated_quota), 0) as estimated_quota",
		"coalesce(avg(confidence), 0) as avg_confidence",
		"coalesce(avg(use_time_ms), 0) as avg_use_time_ms",
		"coalesce(sum(case when decision = 'pass' then prompt_tokens else 0 end), 0) as pass_prompt_tokens",
		"coalesce(sum(case when decision = 'pass' then completion_tokens else 0 end), 0) as pass_completion_tokens",
		"coalesce(sum(case when decision = 'pass' then estimated_quota else 0 end), 0) as pass_estimated_quota",
	}, ", ")
	err = tx.Model(&ContentReviewLog{}).Select(selectSQL).Scan(&stat).Error
	return stat, err
}

func ApplyContentReviewLogPassSample(stat *ContentReviewLogStat, sampleRate float64) {
	if stat == nil {
		return
	}
	stat.PassSampleRate = sampleRate
	if sampleRate <= 0 || sampleRate >= 1 {
		stat.Sampled = sampleRate < 1
		return
	}
	stat.Sampled = true
	scale := 1 / sampleRate
	scaledPass, okPass := scaleSampledCount(stat.Pass, scale)
	scaledPrompt, okPrompt := scaleSampledCount(stat.PassPromptTokens, scale)
	scaledCompletion, okCompletion := scaleSampledCount(stat.PassCompletionTokens, scale)
	scaledQuota, okQuota := scaleSampledCount(stat.PassEstimatedQuota, scale)
	if !okPass || !okPrompt || !okCompletion || !okQuota {
		return
	}
	stat.Total += scaledPass - stat.Pass
	stat.Pass = scaledPass
	stat.PromptTokens += scaledPrompt - stat.PassPromptTokens
	stat.CompletionTokens += scaledCompletion - stat.PassCompletionTokens
	stat.EstimatedQuota += scaledQuota - stat.PassEstimatedQuota
}

func scaleSampledCount(n int64, scale float64) (int64, bool) {
	if n == 0 {
		return 0, true
	}
	v := float64(n) * scale
	if math.IsInf(v, 0) || math.IsNaN(v) || v > float64(math.MaxInt64) {
		return 0, false
	}
	return int64(math.Round(v)), true
}

func DeleteOldContentReviewLog(ctx context.Context, targetTimestamp int64, limit int, decision string) (int64, error) {
	var total int64
	decision = strings.ToLower(strings.TrimSpace(decision))
	for {
		if ctx != nil && ctx.Err() != nil {
			return total, ctx.Err()
		}
		tx := LOG_DB.Where("created_at < ?", targetTimestamp)
		if decision != "" && decision != "all" {
			tx = tx.Where("decision = ?", decision)
		}
		result := tx.Limit(limit).Delete(&ContentReviewLog{})
		if result.Error != nil {
			return total, result.Error
		}
		total += result.RowsAffected
		if result.RowsAffected < int64(limit) {
			break
		}
	}
	return total, nil
}

func buildContentReviewLogQuery(q ContentReviewLogQuery) (*gorm.DB, error) {
	tx := LOG_DB
	var err error
	if tx, err = applyExplicitLogTextFilter(tx, "username", q.Username); err != nil {
		return nil, err
	}
	if tx, err = applyExplicitLogTextFilter(tx, "review_model", q.ReviewModel); err != nil {
		return nil, err
	}
	if q.RequestId != "" {
		tx = tx.Where("request_id = ?", q.RequestId)
	}
	if q.StartTimestamp != 0 {
		tx = tx.Where("created_at >= ?", q.StartTimestamp)
	}
	if q.EndTimestamp != 0 {
		tx = tx.Where("created_at <= ?", q.EndTimestamp)
	}
	if q.ChannelId != 0 {
		tx = tx.Where("channel_id = ?", q.ChannelId)
	}
	decision := strings.ToLower(strings.TrimSpace(q.Decision))
	if decision != "" && decision != "all" {
		switch decision {
		case ContentReviewDecisionPass, ContentReviewDecisionFlag, ContentReviewDecisionBlock, ContentReviewDecisionError:
			tx = tx.Where("decision = ?", decision)
		default:
			return nil, errors.New("invalid content review decision")
		}
	}
	return tx, nil
}

func fillContentReviewLogChannelNames(logs []*ContentReviewLog) {
	channelIds := types.NewSet[int]()
	for _, log := range logs {
		if log != nil && log.ChannelId != 0 {
			channelIds.Add(log.ChannelId)
		}
	}
	if channelIds.Len() == 0 {
		return
	}
	var channels []struct {
		Id   int    `gorm:"column:id"`
		Name string `gorm:"column:name"`
	}
	if common.MemoryCacheEnabled {
		for _, channelId := range channelIds.Items() {
			if cacheChannel, err := CacheGetChannel(channelId); err == nil {
				channels = append(channels, struct {
					Id   int    `gorm:"column:id"`
					Name string `gorm:"column:name"`
				}{Id: channelId, Name: cacheChannel.Name})
			}
		}
	} else if err := DB.Table("channels").Select("id, name").Where("id IN ?", channelIds.Items()).Find(&channels).Error; err != nil {
		common.SysLog("failed to load content review log channels: " + err.Error())
		return
	}
	channelMap := make(map[int]string, len(channels))
	for _, channel := range channels {
		channelMap[channel.Id] = channel.Name
	}
	for i := range logs {
		if logs[i] != nil {
			logs[i].ChannelName = channelMap[logs[i].ChannelId]
		}
	}
}
