package middleware

import (
	"bytes"
	"fmt"
	"io"
	"os"

	"github.com/QuantumNous/new-api/common"
	"github.com/QuantumNous/new-api/constant"
	"github.com/QuantumNous/new-api/model"

	"github.com/bytedance/gopkg/util/gopool"
	"github.com/gin-gonic/gin"
)

// auditResponseWriter 包装 gin.ResponseWriter，捕获响应状态码并将响应体复制一份到
// 有限大小的缓冲区，用于判断业务是否成功（解析响应 JSON 的 success 字段）。
// 缓冲区有上限，避免大响应（如密钥导出）占用过多内存；超出上限则不再缓存，
// 此时仅依据 HTTP 状态码判断成败。
type auditResponseWriter struct {
	gin.ResponseWriter
	body    *bytes.Buffer
	maxSize int
	// reqBody 是请求体的快照（上限同 maxSize），仅用于兜底模板按白名单提取字段，
	// 绝不整体写入日志——见 auditBodyFieldsByAction。
	reqBody []byte
}

func (w *auditResponseWriter) Write(b []byte) (int, error) {
	if w.body.Len() < w.maxSize {
		remain := w.maxSize - w.body.Len()
		if remain >= len(b) {
			w.body.Write(b)
		} else {
			w.body.Write(b[:remain])
		}
	}
	return w.ResponseWriter.Write(b)
}

func (w *auditResponseWriter) WriteString(s string) (int, error) {
	return w.Write([]byte(s))
}

// auditRouteActions 将「METHOD + 路由模板」映射为语言无关的操作标识 action。
// 这些是未被 handler 手动埋点的写操作，由中间件兜底记录；前端依据 action 用 i18n 本地化展示。
// 未命中的写操作回退为 action="generic"，前端展示 "METHOD route"。
var auditRouteActions = map[string]string{
	// 用户管理
	"POST /api/user/":                                  "user.create",
	"PUT /api/user/":                                   "user.update",
	"DELETE /api/user/:id":                             "user.delete",
	"POST /api/user/manage":                            "user.manage",
	"POST /api/user/manage/batch":                      "user.manage_batch",
	"POST /api/user/topup/complete":                    "user.topup_complete",
	"DELETE /api/user/:id/reset_passkey":               "user.reset_passkey",
	"DELETE /api/user/:id/oauth/bindings/:provider_id": "user.oauth_unbind",
	"DELETE /api/user/:id/bindings/:binding_type":      "user.binding_clear",
	"PUT /api/user/:id/content_review_skip":            "user.content_review_skip",
	"PUT /api/user/:id/content_review_sample":          "user.content_review_sample",
	"DELETE /api/user/:id/2fa":                         "user.2fa_disable",

	// 系统设置（root）
	"PUT /api/option/":                          "option.update",
	"POST /api/option/payment_compliance":       "option.payment_compliance",
	"POST /api/option/rest_model_ratio":         "option.reset_ratio",
	"DELETE /api/option/channel_affinity_cache": "option.clear_affinity_cache",
	"POST /api/option/migrate_console_setting":  "option.migrate_console_setting",

	// 自定义 OAuth（root）
	"POST /api/custom-oauth-provider/":      "custom_oauth.create",
	"PUT /api/custom-oauth-provider/:id":    "custom_oauth.update",
	"DELETE /api/custom-oauth-provider/:id": "custom_oauth.delete",

	// 性能/缓存（root）
	"DELETE /api/performance/disk_cache": "performance.clear_disk_cache",
	"POST /api/performance/gc":           "performance.gc",
	"POST /api/performance/reset_stats":  "performance.reset_stats",
	"DELETE /api/performance/logs":       "performance.clear_logs",

	// 兑换码
	"POST /api/redemption/":          "redemption.create",
	"PUT /api/redemption/":           "redemption.update",
	"DELETE /api/redemption/:id":     "redemption.delete",
	"DELETE /api/redemption/invalid": "redemption.delete_invalid",

	// 预填组
	"POST /api/prefill_group/":      "prefill_group.create",
	"PUT /api/prefill_group/":       "prefill_group.update",
	"DELETE /api/prefill_group/:id": "prefill_group.delete",

	// 供应商
	"POST /api/vendors/":      "vendor.create",
	"PUT /api/vendors/":       "vendor.update",
	"DELETE /api/vendors/:id": "vendor.delete",

	// 模型元数据
	"POST /api/models/":              "model.create",
	"PUT /api/models/":               "model.update",
	"DELETE /api/models/:id":         "model.delete",
	"POST /api/models/sync_upstream": "model.sync_upstream",

	// 渠道（handler 已埋点的也登记，避免漏标时回退成裸路径）
	"POST /api/channel/":                            "channel.create",
	"PUT /api/channel/":                             "channel.update",
	"DELETE /api/channel/:id":                       "channel.delete",
	"DELETE /api/channel/disabled":                  "channel.delete_disabled",
	"POST /api/channel/batch":                       "channel.delete_batch",
	"POST /api/channel/:id/key":                     "channel.key_view",
	"POST /api/channel/tag/disabled":                "channel.tag_disable",
	"POST /api/channel/tag/enabled":                 "channel.tag_enable",
	"PUT /api/channel/tag":                          "channel.tag_edit",
	"POST /api/channel/batch/tag":                   "channel.tag_batch_set",
	"POST /api/channel/copy/:id":                    "channel.copy",
	"POST /api/channel/multi_key/manage":            "channel.multi_key_manage",
	"POST /api/channel/upstream_updates/apply":      "channel.upstream_apply",
	"POST /api/channel/upstream_updates/apply_all":  "channel.upstream_apply_all",
	"POST /api/channel/fix":                         "channel.fix_abilities",
	"POST /api/channel/:id/codex/refresh":           "channel.codex_refresh",
	"POST /api/channel/ollama/pull":                 "channel.ollama_pull",
	"POST /api/channel/ollama/pull/stream":          "channel.ollama_pull",
	"DELETE /api/channel/ollama/delete":             "channel.ollama_delete",
	"POST /api/channel/upstream_updates/detect":     "channel.upstream_detect",
	"POST /api/channel/upstream_updates/detect_all": "channel.upstream_detect_all",

	// 部署
	"POST /api/deployments/":           "deployment.create",
	"PUT /api/deployments/:id":         "deployment.update",
	"PUT /api/deployments/:id/name":    "deployment.rename",
	"POST /api/deployments/:id/extend": "deployment.extend",
	"DELETE /api/deployments/:id":      "deployment.delete",

	// 订阅（管理员）
	"POST /api/subscription/admin/plans":                             "subscription.plan_create",
	"PUT /api/subscription/admin/plans/:id":                          "subscription.plan_update",
	"PATCH /api/subscription/admin/plans/:id":                        "subscription.plan_status",
	"POST /api/subscription/admin/plans/:id/sync":                    "subscription.plan_sync",
	"POST /api/subscription/admin/bind":                              "subscription.bind",
	"POST /api/subscription/admin/users/:id/subscriptions":           "subscription.user_create",
	"POST /api/subscription/admin/user_subscriptions/:id/invalidate": "subscription.user_invalidate",
	"PUT /api/subscription/admin/user_subscriptions/:id":             "user_subscription.admin_edit",
	"DELETE /api/subscription/admin/user_subscriptions/:id":          "subscription.user_delete",

	// Waffo Pancake（root）
	"POST /api/option/waffo-pancake/pair":                 "option.waffo_pancake_pair",
	"POST /api/option/waffo-pancake/save":                 "option.waffo_pancake_save",
	"POST /api/option/waffo-pancake/subscription-product": "option.waffo_pancake_subscription_product",

	// 日志
	"DELETE /api/log/":               "log.clear",
	"DELETE /api/log/content_review": "log.clear_content_review",
}

// auditSkipRoutes 是管理/root 写方法里的探测、预览、凭据校验类请求：不改业务状态，
// 不应写入系统日志。未列入 skip 或 auditRouteActions 的写操作会回退为 generic。
var auditSkipRoutes = map[string]bool{
	"POST /api/custom-oauth-provider/discovery":                   true,
	"POST /api/option/waffo-pancake/catalog":                      true,
	"POST /api/option/waffo-pancake/subscription-product-options": true,
	"POST /api/ratio_sync/fetch":                                  true,
	"POST /api/channel/fetch_models":                              true,
	"POST /api/deployments/settings/test-connection":              true,
	"POST /api/deployments/test-connection":                       true,
	"POST /api/deployments/price-estimation":                      true,
}

// auditContentTemplates 将稳定的操作标识 action 映射为英文兜底模板，渲染后写入
// Log.Content（供导出 / 经典前端等非本地化消费者使用）。占位符为 ${name}。
var auditContentTemplates = map[string]string{
	"user.create":                    "Created user ${username} (role ${role})",
	"user.update":                    "Updated user ${username} (ID: ${id})",
	"user.delete":                    "Deleted user ${username} (ID: ${id})",
	"user.manage":                    "Performed ${action} on user ${username} (ID: ${id})",
	"user.manage_batch":              "Performed a batch user management action",
	"user.quota_add":                 "Increased user quota by ${quota}",
	"user.quota_subtract":            "Decreased user quota by ${quota}",
	"user.quota_override":            "Overrode user quota from ${from} to ${to}",
	"user.binding_clear":             "Cleared ${bindingType} binding for user ${username}",
	"user.2fa_disable":               "Force-disabled two-factor authentication for the user",
	"user.passkey_register":          "Registered a passkey",
	"user.passkey_delete":            "Deleted a passkey",
	"user.reset_passkey":             "Reset the user passkey",
	"user.clear_high_risk":           "Cleared high-risk flag for user ${username} (ID: ${id})",
	"user.content_review_skip":       "Set content-review skip=${skip} for user ${username}",
	"user.content_review_sample":     "Set content-review sample_rate=${sample_rate} for user ${username}",
	"user.topup_complete":            "Completed top-up order for the user",
	"user.oauth_unbind":              "Removed an OAuth binding for the user",
	"option.update":                  "Updated system setting ${key}",
	"option.payment_compliance":      "Confirmed payment compliance",
	"option.reset_ratio":             "Reset model ratios",
	"option.clear_affinity_cache":    "Cleared channel affinity cache",
	"option.migrate_console_setting": "Migrated console settings",
	"log.clear":                      "Cleared historical logs",
	"log.clear_content_review":       "Cleared ${count} content review logs (scope: ${decision})",

	"channel.create":              "Created channel ${name} (type ${type}, count ${count})",
	"channel.update":              "Updated channel ${name} (ID: ${id})",
	"channel.delete":              "Deleted channel ${name} (ID: ${id})",
	"channel.delete_batch":        "Batch deleted ${count} channels",
	"channel.delete_disabled":     "Deleted all disabled channels (${count})",
	"channel.key_view":            "Viewed channel key ${name} (ID: ${id})",
	"channel.tag_disable":         "Disabled channels with tag ${tag}",
	"channel.tag_enable":          "Enabled channels with tag ${tag}",
	"channel.tag_edit":            "Edited channels with tag ${tag}",
	"channel.tag_batch_set":       "Batch set tag for ${count} channels",
	"channel.copy":                "Copied channel (source ID: ${sourceId}) to ${name} (new ID: ${id})",
	"channel.multi_key_manage":    "Multi-key management ${action} on channel (ID: ${id})",
	"channel.upstream_apply":      "Applied upstream model changes to channel (ID: ${id})",
	"channel.upstream_apply_all":  "Applied upstream model changes to ${count} channels",
	"channel.fix_abilities":       "Fixed channel abilities",
	"channel.codex_refresh":       "Refreshed Codex credential for channel ${id}",
	"channel.ollama_pull":         "Pulled an Ollama model",
	"channel.ollama_delete":       "Deleted an Ollama model",
	"channel.upstream_detect":     "Detected upstream model updates",
	"channel.upstream_detect_all": "Detected upstream model updates for all channels",

	"redemption.create":            "Created ${count} redemption codes named ${name} (${quota} each)",
	"redemption.update":            "Updated a redemption code",
	"redemption.delete":            "Deleted a redemption code",
	"redemption.delete_invalid":    "Deleted invalid redemption codes",
	"prefill_group.create":         "Created a prefill group",
	"prefill_group.update":         "Updated a prefill group",
	"prefill_group.delete":         "Deleted a prefill group",
	"vendor.create":                "Created a vendor",
	"vendor.update":                "Updated a vendor",
	"vendor.delete":                "Deleted a vendor",
	"model.create":                 "Created a model",
	"model.update":                 "Updated a model",
	"model.delete":                 "Deleted a model",
	"model.sync_upstream":          "Synced upstream models",
	"custom_oauth.create":          "Created a custom OAuth provider",
	"custom_oauth.update":          "Updated a custom OAuth provider",
	"custom_oauth.delete":          "Deleted a custom OAuth provider",
	"performance.clear_disk_cache": "Cleared disk cache",
	"performance.gc":               "Triggered garbage collection",
	"performance.reset_stats":      "Reset performance statistics",
	"performance.clear_logs":       "Cleared log files",
	"deployment.create":            "Created a deployment",
	"deployment.update":            "Updated a deployment",
	"deployment.rename":            "Renamed a deployment",
	"deployment.extend":            "Extended a deployment",
	"deployment.delete":            "Deleted a deployment",

	"user_subscription.admin_edit": "Edited user subscription (ID: ${subscription_id})",
	"subscription.plan_create":     "Created a subscription plan",
	"subscription.plan_update":     "Updated a subscription plan",
	"subscription.plan_status":     "Updated a subscription plan status",
	"subscription.plan_sync":       "Synced a subscription plan",
	"subscription.bind":            "Bound a subscription",
	"subscription.user_create":     "Created a user subscription",
	"subscription.user_invalidate": "Invalidated a user subscription",
	"subscription.user_delete":     "Deleted a user subscription",

	"option.waffo_pancake_pair":                 "Paired a Waffo Pancake store",
	"option.waffo_pancake_save":                 "Saved Waffo Pancake settings",
	"option.waffo_pancake_subscription_product": "Created a Waffo Pancake subscription product",
	"generic": "${method} ${route}",
}

// auditBodyFieldsByAction 是每个 action 允许从请求体提取、写入审计日志的字段白名单。
// 只列模板里真正引用的占位符——密码/token 等敏感字段永远不会进这张表，也就永远不会
// 被写入日志。只覆盖了高频的 user/channel/option/redemption 域；其余 action 的模板
// 占位符仍会渲染为空，等实际需要时再按同样方式补充白名单。
var auditBodyFieldsByAction = map[string][]string{
	"user.create":                {"username", "role"},
	"user.update":                {"username"},
	"user.manage":                {"action"},
	"user.quota_add":             {"quota"},
	"user.quota_subtract":        {"quota"},
	"user.quota_override":        {"from", "to"},
	"user.clear_high_risk":       {"username"},
	"user.content_review_skip":   {"skip"},
	"user.content_review_sample": {"sample_rate"},
	"option.update":              {"key"},
	"channel.create":             {"name", "type"},
	"channel.update":             {"name"},
	"channel.tag_disable":        {"tag"},
	"channel.tag_enable":         {"tag"},
	"channel.tag_edit":           {"tag"},
	"channel.copy":               {"name"},
	"channel.multi_key_manage":   {"action"},
	"redemption.create":          {"name", "quota", "count"},
}

// auditBodyFields 按白名单从请求体 JSON 里挑字段，其余字段一律丢弃——绝不整体转存请求体。
func auditBodyFields(action string, body []byte) map[string]interface{} {
	fields := auditBodyFieldsByAction[action]
	if len(fields) == 0 {
		return nil
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) == 0 || trimmed[0] != '{' {
		return nil
	}
	var raw map[string]interface{}
	if common.Unmarshal(trimmed, &raw) != nil {
		return nil
	}
	out := map[string]interface{}{}
	for _, k := range fields {
		if v, ok := raw[k]; ok {
			out[k] = v
		}
	}
	return out
}

// AuditContentEN 按 action 模板渲染英文兜底文本；未登记的 action 退回 action 本身。
func AuditContentEN(action string, params map[string]interface{}) string {
	tmpl, ok := auditContentTemplates[action]
	if !ok {
		return action
	}
	return os.Expand(tmpl, func(key string) string {
		if v, ok := params[key]; ok {
			return fmt.Sprintf("%v", v)
		}
		return ""
	})
}

// beginAdminAudit 在管理/root 写操作进入 handler 前包装 ResponseWriter，
// 以便事后解析响应判断业务是否成功。仅对写方法（POST/PUT/PATCH/DELETE）生效；
// 只读请求返回 nil，调用方据此跳过事后兜底记录。
//
// 该函数由 authHelper 在鉴权通过、c.Next() 之前调用：因为任何管理/root 接口都
// 必然经过 AdminAuth/RootAuth，将审计兜底内聚到鉴权链路即可保证「新增接口自动留痕」，
// 无需在路由上再单独挂一层审计中间件（避免漏挂）。
func beginAdminAudit(c *gin.Context) *auditResponseWriter {
	method := c.Request.Method
	if method != "POST" && method != "PUT" && method != "PATCH" && method != "DELETE" {
		return nil
	}
	var reqBody []byte
	if c.Request.Body != nil {
		full, _ := io.ReadAll(c.Request.Body)
		c.Request.Body = io.NopCloser(bytes.NewReader(full)) // 读完原样还给 handler，不截断
		if len(full) > 64*1024 {
			reqBody = full[:64*1024] // 审计快照截断即可，handler 拿到的是完整 full
		} else {
			reqBody = full
		}
	}
	writer := &auditResponseWriter{
		ResponseWriter: c.Writer,
		body:           bytes.NewBuffer(nil),
		maxSize:        64 * 1024,
		reqBody:        reqBody,
	}
	c.Writer = writer
	return writer
}

// finishAdminAudit 在 c.Next() 之后对管理/高危写操作做兜底审计记录。
// 若 handler 内已手动埋点（设置 ContextKeyAuditLogged），则跳过，避免重复。
func finishAdminAudit(c *gin.Context, writer *auditResponseWriter) {
	if writer == nil {
		return
	}
	method := c.Request.Method

	// handler 已手动记录更精细的审计日志，跳过兜底。
	if common.GetContextKeyBool(c, constant.ContextKeyAuditLogged) {
		return
	}

	operatorId := c.GetInt("id")
	operatorName := c.GetString("username")
	operatorRole := c.GetInt("role")
	ip := c.ClientIP()
	status := writer.Status()
	success := auditResponseSuccess(status, writer.body.Bytes())

	route := c.FullPath()
	routeKey := method + " " + route
	if auditSkipRoutes[routeKey] {
		return
	}
	action := auditRouteActions[routeKey]
	if action == "" {
		action = "generic"
	}

	routeParams := map[string]string{}
	for _, p := range c.Params {
		routeParams[p.Key] = p.Value
	}

	// op.params 为语言无关参数，供前端 i18n 渲染；generic 时携带 method/route。
	// body 字段先填（白名单见 auditBodyFieldsByAction），path 参数后填并覆盖同名字段——
	// path 参数（如 :id）比请求体更权威。
	opParams := map[string]interface{}{}
	if action == "generic" {
		opParams["method"] = method
		opParams["route"] = route
	} else {
		for k, v := range auditBodyFields(action, writer.reqBody) {
			opParams[k] = v
		}
		for k, v := range routeParams {
			opParams[k] = v
		}
	}

	content := AuditContentEN(action, opParams)

	adminInfo := map[string]interface{}{
		"admin_id":       operatorId,
		"admin_username": operatorName,
		"admin_role":     operatorRole,
		"auth_method":    auditAuthMethod(c),
	}
	auditInfo := map[string]interface{}{
		"method":  method,
		"route":   route,
		"path":    c.Request.URL.Path,
		"status":  status,
		"success": success,
	}
	if len(routeParams) > 0 {
		auditInfo["params"] = routeParams
	}

	gopool.Go(func() {
		model.RecordOperationAuditLog(operatorId, content, ip, action, opParams, adminInfo, auditInfo)
	})
}

func auditAuthMethod(c *gin.Context) string {
	if c.GetBool("use_access_token") {
		return "access_token"
	}
	return "session"
}

// auditResponseSuccess 依据 HTTP 状态码与响应体推断操作是否成功。
// 优先解析响应 JSON 中的 success 字段；无法解析时退回到状态码判断。
func auditResponseSuccess(status int, body []byte) bool {
	if status >= 400 {
		return false
	}
	trimmed := bytes.TrimSpace(body)
	if len(trimmed) > 0 && trimmed[0] == '{' {
		var resp struct {
			Success *bool `json:"success"`
		}
		if err := common.Unmarshal(trimmed, &resp); err == nil && resp.Success != nil {
			return *resp.Success
		}
	}
	return status < 400
}
