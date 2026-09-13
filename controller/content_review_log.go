package controller

import (
	"strconv"
	"strings"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/model"
	"github.com/QuantumNous/new-api/setting"

	"github.com/gin-gonic/gin"
)

func parseContentReviewLogQuery(c *gin.Context) model.ContentReviewLogQuery {
	startTimestamp, _ := strconv.ParseInt(c.Query("start_timestamp"), 10, 64)
	endTimestamp, _ := strconv.ParseInt(c.Query("end_timestamp"), 10, 64)
	channel, _ := strconv.Atoi(c.Query("channel"))
	return model.ContentReviewLogQuery{
		StartTimestamp: startTimestamp,
		EndTimestamp:   endTimestamp,
		Username:       c.Query("username"),
		Decision:       c.Query("decision"),
		ReviewModel:    c.Query("model_name"),
		ChannelId:      channel,
		RequestId:      c.Query("request_id"),
	}
}

func GetContentReviewLogs(c *gin.Context) {
	pageInfo := common.GetPageQuery(c)
	logs, total, err := model.GetAllContentReviewLogs(parseContentReviewLogQuery(c), pageInfo.GetStartIdx(), pageInfo.GetPageSize())
	if err != nil {
		common.ApiError(c, err)
		return
	}
	pageInfo.SetTotal(int(total))
	pageInfo.SetItems(logs)
	common.ApiSuccess(c, pageInfo)
}

func GetContentReviewLogsStat(c *gin.Context) {
	stat, err := model.SumContentReviewLogs(parseContentReviewLogQuery(c))
	if err != nil {
		common.ApiError(c, err)
		return
	}
	model.ApplyContentReviewLogPassSample(&stat, setting.GetContentReviewSetting().ReviewPassSampleRate())
	common.ApiSuccess(c, stat)
}

func DeleteContentReviewLogs(c *gin.Context) {
	targetTimestamp, _ := strconv.ParseInt(c.Query("target_timestamp"), 10, 64)
	if targetTimestamp == 0 {
		common.ApiErrorMsg(c, "target timestamp is required")
		return
	}
	decision := strings.ToLower(strings.TrimSpace(c.Query("decision")))
	if decision == "" {
		decision = "all"
	}
	if decision != "pass" && decision != "all" {
		common.ApiErrorMsg(c, "decision must be pass or all")
		return
	}
	count, err := model.DeleteOldContentReviewLog(c.Request.Context(), targetTimestamp, 100, decision)
	if err != nil {
		common.ApiError(c, err)
		return
	}
	recordManageAudit(c, "log.clear_content_review", map[string]interface{}{
		"count":     count,
		"decision":  decision,
		"timestamp": targetTimestamp,
	})
	common.ApiSuccess(c, count)
}
