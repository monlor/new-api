# FORK_CHANGES — 本 Fork 相对上游的变更清单

> 上游 (upstream): https://github.com/QuantumNous/new-api — `git remote: upstream`
> 本 Fork (origin): git@github.com:monlor/new-api.git
>
> 本文档记录本 Fork 在上游基础上的所有自定义改动，**目的是同步上游时有据可查**：
> 知道哪些文件被改过、可能产生冲突、需要重新校验。
>
> **维护规则见 [AGENTS.md](AGENTS.md) Rule 10。** 每次对偏离上游的代码做改动，都要在本文件登记。

## 上游同步水位线 (Upstream Sync Watermark)

> **最近一次评估/移植到上游：** `e5694748` — 2026-06-22 13:38 — `chore(web): use tsgo for type checking`（≈ tag `v1.0.0-rc.14-4`）
>
> 下次同步只需看此 commit 之后的提交：`git fetch upstream && git log e5694748..upstream/main`。
> 每次跑 `upstream-sync` 完成移植后，把本行更新为当时的 `upstream/main` 顶端。

## 如何核对 / 重新生成

```bash
git fetch upstream
git log --oneline upstream/main..HEAD          # 本 Fork 领先上游的提交
git diff --stat upstream/main..HEAD            # 改动文件统计
git diff --name-only upstream/main..HEAD | grep -v '^web/'   # 后端改动文件
```

> 基准：截至 2026-06-22，领先上游 `upstream/main` 共 53 个提交，0 个落后。

---

## 一、计费与按渠道倍率 / 计费类型 (Billing)

新增「按渠道倍率 + 计费类型 (wallet / subscription) 区分」的计费体系，是本 Fork 最核心的后端改动。

- 按渠道倍率 (per-channel ratio)、计费类型过滤，修复订阅支付预扣费
- 新增 `RefundNow`、`EnsureBillingSessionForChannel`
- WSS 预扣费改用 `PriceData.ChannelRatio`
- token 创建时校验 `billing_type` 取值范围
- 渠道 `billing_type` 标签规范化（"No restriction" → "No Restriction"）

**涉及文件：** `relay/common/billing.go`、`relay/common/relay_info.go`、`relay/helper/price.go`、`service/billing_session.go`、`service/channel_select.go`、`service/text_quota.go`、`service/quota.go`、`service/task_billing.go`、`pkg/billingexpr/settle.go`、`pkg/billingexpr/types.go`、`types/price_data.go`、`model/pricing.go`、`model/pricing_default.go`、`model/channel.go`、`model/channel_cache.go`、`model/ability.go`、`model/token.go`、`controller/relay.go`、`controller/token.go`、`middleware/distributor.go`

## 二、订阅 (Subscription)

- 管理员强制同步套餐到生效中的订阅 (force-sync)
- 批量查询用户订阅，并在用户列表 API 暴露
- 购买弹窗额度展示优化、管理员侧用户订阅视图

**涉及文件：** `controller/subscription.go`、`controller/subscription_payment_epay.go`、`controller/subscription_payment_waffo_pancake.go`、`model/subscription.go`、`router/api-router.go`、`service/billing_session.go`

## 三、支付货币 / 钱包货币显示 (Payment Currency)

- 新增 `PaymentCurrency` 选项，并在 topup info API 暴露
- 个人资料 / 仪表盘余额按支付网关货币显示
- 充值表单支持按本地货币输入
- 统一货币显示：`formatCurrencyFromUSD` / `formatQuotaWithCurrency`（不再用 wallet 内部 `formatPaymentCurrency`）
- 修复：货币符号、转账显示货币、低于全局下限禁用按钮、zh-TW 排除简中 CNY 覆盖

**涉及文件（后端）：** `setting/operation_setting/payment_setting.go`、`controller/topup.go`、`controller/misc.go`、`model/topup.go`、`model/option.go`
**涉及文件（前端）：** `web/default/src/features/wallet/**`、`web/default/src/lib/currency.ts`、`web/default/src/hooks/use-system-config.ts`、`web/default/src/stores/system-config-store.ts`

## 四、邀请 / 返佣 (Invite & Affiliate)

- 被邀请人充值达阈值后，给邀请人发放奖励
- status 接口暴露 `quota_for_inviter` / `quota_for_invitee`
- 返佣卡片显示真实的邀请人/被邀请人额度

**涉及文件：** `controller/user.go`、`model/user.go`、`controller/misc.go`、`web/default/src/features/wallet/components/affiliate-rewards-card.tsx`

## 五、用户管理 (Users)

- 表格批量启用 / 禁用 / 删除用户（批量删除为硬删除，与单个删除 `HardDeleteUserById` 一致，避免软删除后用户残留为“注销”状态）
- 用户列表展示生效中的订阅信息

**涉及文件：** `controller/user.go`、`model/user.go`、`web/default/src/features/users/**`

## 六、主题 (Theme)

- 管理员可配置全站默认主题
- Header 加 ThemeSwitch，ConfigDrawer 仅管理员可见

**涉及文件：** `setting/system_setting/theme.go`、`model/option.go`、`web/default/src/lib/theme-customization.ts`、`web/default/src/styles/theme*.css`、`web/default/src/styles/index.css`

## 七、API 密钥与定价页 UX (Keys & Pricing)

- "Use API Key" 弹窗：多工具代码示例
- API 端点按路由（而非描述）标注
- code-block 支持额外/未知语言（单例 highlighter）
- 定价页：按计费类型拆分渠道倍率、可用性过滤、有效倍率徽章、模型卡精简
- minimax / speech-0 模型映射到 MiniMax 厂商
- CC Switch 导入弹窗：新增「API Endpoint 选择器」（基于 status 的 `api_info` 多端点），并将 `homepage`（官网链接）与所选 API endpoint 解耦——`endpoint` 用所选 API 地址，`homepage` 用真实站点地址 `server_address`（上游二者同源，本 fork 拆分后修复了「官网链接=API 链接」的问题）

**涉及文件：** `web/default/src/routes/pricing/index.tsx`、定价/keys 相关前端组件（含 `web/default/src/features/keys/components/dialogs/cc-switch-dialog.tsx`）、`constant/context_key.go`、`common/constants.go`

## 八、设置与仪表盘 UI (Settings & Dashboard)

- 配额设置 / 支付设置 UI 优化
- 配额预警阈值按货币单位展示
- 仪表盘 SummaryCards 改用 `formatQuotaWithCurrency`
- footer 居中并移除 ProjectAttribution；combobox-input、usage-logs 列展示重构

## 九、国际化 (i18n)

- 新增 **zh-TW** locale
- 同步 en/zh/fr/ru/ja/vi 翻译：计费、主题、订阅、邀请阈值、批量用户、倍率徽章、可用性过滤、配额阈值等新功能

**涉及文件：** `web/default/src/i18n/locales/*.json`、`web/default/src/i18n/config.ts`、`web/default/src/i18n/languages.ts`

## 十、开发 / CI 基础设施 (Dev & CI)

- 新增 air 热重载配置 `.air.toml`、`docker-compose.dev.yml`、`Dockerfile.dev`
- CI：`DOCKERHUB_USERNAME` secret 动态镜像名；`docker-build.yml`、`docker-image-alpha.yml`、`docker-image-nightly.yml`
- `.gitignore` 忽略 `tmp/`、`graphify-out/`

## 十一、通知限流 (Notification Throttle)

- 修复额度/订阅「即将用尽」提醒邮件短时间连发 7-8 封的问题。根因：限流计数 key 按整点分桶，但 TTL 仅
  `NotificationLimitDurationMinute`（默认 10 分钟），key 在小时内过期重置，每 10 分钟又放行一批；且
  `NotifyLimitCount` 默认 2、限流读写非原子。
- 改动：`checkRedisLimit` 改为原子自增（新增 `common.RedisIncrWithExpire`：`INCR` + `EXPIRE NX` 走同一
  `TxPipeline`，仅首次创建 key 时设 TTL，固定窗口、且崩溃不会丢 TTL），key 去掉整点分桶段，window 完全
  由 TTL 决定；`checkMemoryLimit` 加互斥锁保证「读→自增→store」原子。默认值改为 `NOTIFY_LIMIT_COUNT=1`、
  `NOTIFICATION_LIMIT_DURATION_MINUTE=60`（即每用户每类型每小时最多 1 封，可用环境变量覆盖）。
- 部署约束：`EXPIRE ... NX` 语义需要 **Redis 7.0+**。

**涉及文件：** `common/redis.go`、`service/notify-limit.go`、`common/init.go`、`service/notify-limit_test.go`

## 十二、已 port 的上游 bug 修复 (Cherry-picked Upstream Fixes)

下列上游 `fix` 提交已手动 port 进本 Fork（基准 `upstream/main` @ 2026-06-22）。同步上游时这些已应用，遇到对应文件冲突可直接取上游版本。

| 上游 commit | 修复 | 文件 |
|---|---|---|
| `b798e349` | AWS ak/sk 上下文管理：标量字段改指针 + 透传 `context_management` | `relay/channel/aws/dto.go` |
| `502858d3` | 工具调用 arguments 为空时保留 `tool_use` 块 | `relay/channel/claude/relay-claude.go` |
| `97eadbef` | 硬删用户时事务内清理 oauth 绑定 | `model/user.go`、`model/user_oauth_binding.go`、`model/task_cas_test.go` |
| `fae39cd9` | 移除 `allow_balance_pay` 的 gorm default，阻止每次重启重复迁移 | `model/subscription.go` |
| `34287afe` | 表格单元格裁切 | data-table core、`usage-logs/model-badge.tsx` |
| `9b9b19e9` | 日志详情弹窗底部裁切 | `usage-logs/dialogs/details-dialog.tsx` |
| `a2f3ac02` + `a37ce3d6` | 渠道批量测试完善 + 测试结果文案 | `channels/*`（含 i18n key，已 `i18n:sync` 同步至全部 locale） |
| `1aa77e66` | 后端图片 URL 强制 HTTPS + 校验 | `wallet/lib/ui.tsx` |
| `f7dae5cb` | 绘图日志时间戳含毫秒 | `usage-logs/columns/drawing-logs-columns.tsx` |
| `6ad5dbb6` | 窗口聚焦不重新拉取（性能） | `main.tsx` |
| `74091744` | 日志按登录类型 type=7 筛选失效 | `usage-logs/$section.tsx` |
| `0c6c1b37` | 计费历史弹窗分页与列表重叠 | `wallet/dialogs/billing-history-dialog.tsx` |
| `d58029c6` | 可视化模型定价列表项无法删除 | `system-settings/models/model-ratio-visual-editor.tsx` |
| `1f1da553` + `0b7ae4ea` | CN 模型显示厂商图标 + StepFun→Stepfun | `usage-logs/model-badge.tsx` |

**未采纳：** `dfcb74b5`（`allow_wallet_overflow` 迁移——该列属上游订阅新功能，本 Fork 无）、`43c7e30a`（classic 主题，本 Fork 用 default）、`cb841850`（仅给 channel type 58 Advanced Custom 换图标，本 Fork 无该渠道类型）、`e5250d64`（与 `34287afe` 重复）。

## 十三、文档 (Docs)

- AGENTS.md 为项目规范单一来源，CLAUDE.md 软链接指向它
- 新增 agent-team harness 章节
- 移除 protected-info 规则，新增 Docker Compose 开发规则
- 本文件 (FORK_CHANGES.md)
