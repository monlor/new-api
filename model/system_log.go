package model

import (
	"context"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/types"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
	"gorm.io/gorm"
)

// SystemLog 承载运营类日志（充值/管理员操作/系统事件/退款/登录）以及请求拒绝事件
// （限流/鉴权/模型路由）。与 logs 表（使用日志，仅 Consume+Error）完全独立，
// 不做历史数据迁移；便于单独设置保留策略、避免拒绝事件写入量拖慢使用日志查询。
type SystemLog struct {
	Id          int    `json:"id" gorm:"index:idx_syslog_created_at_id,priority:2"`
	UserId      int    `json:"user_id" gorm:"index"`
	Username    string `json:"username" gorm:"index;default:''"`
	CreatedAt   int64  `json:"created_at" gorm:"bigint;index:idx_syslog_created_at_id,priority:1;index:idx_syslog_created_at_type"`
	Type        int    `json:"type" gorm:"index:idx_syslog_created_at_type"`
	Content     string `json:"content"`
	Quota       int    `json:"quota" gorm:"default:0"`
	ChannelId   int    `json:"channel" gorm:"index"`
	ChannelName string `json:"channel_name" gorm:"->"`
	TokenId     int    `json:"token_id" gorm:"default:0;index"`
	TokenName   string `json:"token_name" gorm:"default:''"`
	ModelName   string `json:"model_name" gorm:"index;default:''"`
	Group       string `json:"group" gorm:"index"`
	Ip          string `json:"ip" gorm:"index;default:''"`
	UserAgent   string `json:"user_agent" gorm:"default:''"`
	RequestId   string `json:"request_id,omitempty" gorm:"type:varchar(64);index"`
	Other       string `json:"other"`
}

// 独立命名空间，与 model/log.go 的 LogType 常量数值无关联，不做历史兼容。
const (
	SystemLogTypeTopup       = 1 // 充值/订阅购买
	SystemLogTypeManage      = 2 // 管理员操作
	SystemLogTypeSystem      = 3 // 系统事件
	SystemLogTypeRefund      = 4 // 退款
	SystemLogTypeLogin       = 5 // 登录
	SystemLogTypeRateLimit   = 6 // 限流拒绝
	SystemLogTypeTokenReject = 7 // 鉴权/令牌拒绝
	SystemLogTypeModelReject = 8 // 模型/渠道路由拒绝
)

// legacyLogTypeToSystemLogType 把 logs 表的旧 LogType 常量映射到 system_logs 的独立命名空间，
// 仅用于内部转发（RecordLog/RecordTaskBillingLog 等函数签名不变，调用方仍传旧常量）。
func legacyLogTypeToSystemLogType(oldType int) int {
	switch oldType {
	case LogTypeTopup:
		return SystemLogTypeTopup
	case LogTypeManage:
		return SystemLogTypeManage
	case LogTypeRefund:
		return SystemLogTypeRefund
	case LogTypeLogin:
		return SystemLogTypeLogin
	default:
		return SystemLogTypeSystem
	}
}

type SystemLogParams struct {
	UserId    int
	Username  string
	Type      int
	Content   string
	Quota     int
	ChannelId int
	TokenId   int
	TokenName string
	ModelName string
	Group     string
	Ip        string
	UserAgent string
	RequestId string
	Other     map[string]interface{}
}

func RecordSystemLog(p SystemLogParams) {
	username := p.Username
	if username == "" && p.UserId > 0 {
		username, _ = GetUsernameById(p.UserId, false)
	}
	log := &SystemLog{
		UserId:    p.UserId,
		Username:  username,
		CreatedAt: common.GetTimestamp(),
		Type:      p.Type,
		Content:   p.Content,
		Quota:     p.Quota,
		ChannelId: p.ChannelId,
		TokenId:   p.TokenId,
		TokenName: p.TokenName,
		ModelName: p.ModelName,
		Group:     p.Group,
		Ip:        p.Ip,
		UserAgent: p.UserAgent,
		RequestId: p.RequestId,
		Other:     common.MapToJsonStr(p.Other),
	}
	if err := LOG_DB.Create(log).Error; err != nil {
		common.SysLog("failed to record system log: " + err.Error())
	}
}

// RecordRejectionLog 记录请求被拒绝事件（限流/鉴权/模型路由），从 gin.Context 里
// 提取来源 IP、User-Agent 与令牌/分组信息。异步写入，避免拖慢被拒绝请求的响应。
// 由调用方在 abortWithOpenAiMessage 之后紧跟调用，不改动 abortWithOpenAiMessage 本身
// （它仍被 turnstile-check.go / secure_verification.go 等排除范围内的调用方共用）。
func RecordRejectionLog(c *gin.Context, logType int, reason string, content string, statusCode int) {
	if c == nil {
		return
	}
	userId := c.GetInt("id")
	username := c.GetString("username")
	ip := c.ClientIP()
	userAgent := c.Request.UserAgent()
	tokenId := c.GetInt("token_id")
	tokenName := c.GetString("token_name")
	group := common.GetContextKeyString(c, constant.ContextKeyUsingGroup)
	requestId := c.GetString(common.RequestIdKey)
	channelId := common.GetContextKeyInt(c, constant.ContextKeyChannelId)
	modelName := common.GetContextKeyString(c, constant.ContextKeyOriginalModel)
	other := map[string]interface{}{
		"reason":      reason,
		"status_code": statusCode,
		"path":        c.Request.URL.Path,
		"method":      c.Request.Method,
	}
	gopool.Go(func() {
		RecordSystemLog(SystemLogParams{
			UserId:    userId,
			Username:  username,
			Type:      logType,
			Content:   content,
			ChannelId: channelId,
			TokenId:   tokenId,
			TokenName: tokenName,
			ModelName: modelName,
			Group:     group,
			Ip:        ip,
			UserAgent: userAgent,
			RequestId: requestId,
			Other:     other,
		})
	})
}

type SystemLogQuery struct {
	Type           int
	StartTimestamp int64
	EndTimestamp   int64
	Username       string
	ModelName      string
	Ip             string
	Group          string
}

func buildSystemLogQuery(q SystemLogQuery) (*gorm.DB, error) {
	tx := LOG_DB
	var err error
	if q.Type != 0 {
		tx = tx.Where("system_logs.type = ?", q.Type)
	}
	if tx, err = applyExplicitLogTextFilter(tx, "system_logs.username", q.Username); err != nil {
		return nil, err
	}
	if tx, err = applyExplicitLogTextFilter(tx, "system_logs.model_name", q.ModelName); err != nil {
		return nil, err
	}
	if q.Ip != "" {
		tx = tx.Where("system_logs.ip = ?", q.Ip)
	}
	if q.Group != "" {
		tx = tx.Where("system_logs."+logGroupCol+" = ?", q.Group)
	}
	if q.StartTimestamp != 0 {
		tx = tx.Where("system_logs.created_at >= ?", q.StartTimestamp)
	}
	if q.EndTimestamp != 0 {
		tx = tx.Where("system_logs.created_at <= ?", q.EndTimestamp)
	}
	return tx, nil
}

func GetAllSystemLogs(q SystemLogQuery, startIdx int, num int) (logs []*SystemLog, total int64, err error) {
	tx, err := buildSystemLogQuery(q)
	if err != nil {
		return nil, 0, err
	}
	if err = tx.Model(&SystemLog{}).Count(&total).Error; err != nil {
		return nil, 0, err
	}
	if err = tx.Order("system_logs.created_at desc, system_logs.id desc").Limit(num).Offset(startIdx).Find(&logs).Error; err != nil {
		return nil, 0, err
	}
	fillSystemLogChannelNames(logs)
	return logs, total, nil
}

func fillSystemLogChannelNames(logs []*SystemLog) {
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
		common.SysLog("failed to load system log channels: " + err.Error())
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

func DeleteOldSystemLog(ctx context.Context, targetTimestamp int64, limit int) (int64, error) {
	var total int64
	for {
		if ctx != nil && ctx.Err() != nil {
			return total, ctx.Err()
		}
		result := LOG_DB.Where("created_at < ?", targetTimestamp).Limit(limit).Delete(&SystemLog{})
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
