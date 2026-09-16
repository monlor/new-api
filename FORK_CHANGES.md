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
- 「优先订阅」API Key 在用户没有可用订阅额度、或**任一单份**订阅剩余不足以覆盖本次预扣时，按余额渠道筛选（排除仅订阅渠道）；多份 leftover 合计够但单份不够仍走拆分/钱包，避免落到仅订阅渠道后 403
- 到期未写入的周期重置视为可用剩余额度（套餐非 never 时），避免 exhausted+due-reset 被当成无订阅；ResetNever 即使 NextResetTime 过期也不算重置
- 去掉钱包侧全局计费优先级（`billing_preference`）；扣费只看 API Key 与渠道计费类型，优先订阅固定为先订阅后余额
- 优先订阅在剩余额度不足一次请求时，用尽订阅剩余额度，差额从钱包补齐；拆分扣费不走信任额度旁路，且仅兼容无限制渠道

**涉及文件：** `relay/common/billing.go`、`relay/common/relay_info.go`、`relay/helper/price.go`、`relay/relay_task.go`、`service/billing_session.go`、`service/funding_source.go`、`service/channel_select.go`、`service/text_quota.go`、`service/quota.go`、`service/task_billing.go`、`pkg/billingexpr/settle.go`、`pkg/billingexpr/types.go`、`types/price_data.go`、`model/pricing.go`、`model/pricing_default.go`、`model/channel.go`、`model/channel_cache.go`、`model/ability.go`、`model/token.go`、`model/subscription.go`、`controller/relay.go`、`controller/token.go`、`middleware/distributor.go`

## 二、订阅 (Subscription)

- 管理员强制同步套餐到生效中的订阅 (force-sync)
- 批量查询用户订阅，并在用户列表 API 暴露
- 购买弹窗额度展示优化、管理员侧用户订阅视图
- Stripe 自动续费：保存 Customer/Subscription/Price 映射，幂等处理续费成功、扣款失败、订阅更新/删除事件；使用 Stripe 事件创建时间、账期和发票单调保护拒绝乱序回退；Customer Portal 套餐切换当前不受支持，订阅同步与续费发票均 fail closed 校验 Stripe Price、映射 Price 和本地套餐 Price 三者一致后，才推进本地有效期并重置周期额度
- `/api/subscription/self` 暴露可空的支付渠道订阅状态，并提供鉴权后的 Stripe Customer Portal Session 接口；Portal 按当前用户与本地订阅 ID 精确解析 Customer
- 移除钱包页计费优先级选择与 `/api/subscription/self/preference`
- Stripe 设置页增加生产上线清单：Webhook URL/签名密钥与完整事件集、Customer Portal 功能边界、recurring Price 周期一致性、test/live 模式隔离，以及仅新购且已有 Stripe 映射的订阅可进入 Portal
- 管理员直接编辑单条用户订阅 (`PUT /api/subscription/admin/user_subscriptions/:id`)：可改 `amount_used` / `amount_total` / `end_time` / `status`，事务内 `FOR UPDATE` 加锁、校验 `amount_used <= amount_total`，写入审计日志 `user_subscription.admin_edit`；订阅不再有效（`status != active` 或 `end_time` 已到期）时在同一事务内触发分组回退并刷新用户分组缓存；`status=cancelled` 仅在**转入** cancelled 时把 `end_time` 打成 now（已是 cancelled 再保存保留历史取消时间，除非请求显式带了新的 `end_time`）；重新激活（`status=active` 且 `end_time > now`）时把用户分组恢复为 `UpgradeGroup` 并刷新缓存，不改写订阅行上的 `PrevUserGroup`；`active` 且 `end_time<=0` 拒绝写入
- 钱包页为充值表单与「我的订阅」卡片并排；无订阅时充值表单占满整行。购买套餐在独立的订阅套餐页，横向卡片布局；套餐新增管理员可配置的 `IsRecommended`（推荐角标，替换原先「第一个套餐即推荐」的写死逻辑）与 `DisplayModels`（挑选系统内已有模型，逗号分隔存储，`GetDisplayModels()` 复用 `Channel.GetModels()` 的解析方式），无限额套餐显示「无限制」。移动端不再用 `absolute inset-0` 把订阅列表高度压成 0，订阅内容随页面滚动；桌面 `lg+` 仍并排等高、卡片内滚动
- 套餐卡片「预计可调用次数 / 系列原始价值」估算统一口径（`subscriptions/lib/model-value.ts` 为单一真源，`getEffectiveModelPricing()` 一次解析出 `modelRatio` / `completionRatio` / `effectiveRatio` 供全部估算共用）：
  - 支持 `billing_mode: 'tiered_expr'` 分档计费模型：取表达式首档 `p`/`c` 系数（真实 $/1M 价）换算回等效倍率，不再误读已失效的 `model_ratio`
  - 全部估算都乘上「最优分组 × 渠道倍率」（`group_channel_ratio_min_subscription` 优先，回退 `group_channel_ratio_min`），与模型广场主表展示价口径一致；此前仅「系列原始价值」计入、「预计可调用次数」按 ratio=1 计算
  - 真实可用额度公式修正为 `额度/quotaPerUnit/effectiveRatio`——`modelRatio` 在推导中会完全约掉，原先额外再除一次属重复计价
  - 有周期重置的套餐按整个订阅期的估算总额度（`calcEstimatedTotal`）计算，与卡片上已展示的「总额度: ≈」一致，此前只按单个周期额度算
- 管理员给用户分配订阅包（有效期 + 限制模型 + 额度，优先级最高），实现上刻意收敛在 `model/subscription.go` 内部，不动 `FundingSource` 接口与 `BillingSession` 签名：
  - `SubscriptionPlan` / `UserSubscription` 新增 `AllowedModels`（逗号分隔，复用 `SplitDisplayModels` / `DisplayModelsWellFormed`）。套餐下发时快照到用户订阅，可单条编辑覆盖；force-sync 会按套餐强制回写
  - `SubscriptionAllowsModel(allowedModels, modelName)`：空白名单或空 modelName 一律放行；否则白名单需命中 `modelName` 或 `ratio_setting.FormatMatchingModelName(modelName)`（与 token 模型限制同口径）。模型不在白名单 = **跳过该订阅**，由既有的 `trySubscription → trySplit → tryWallet` 回落链接手，不做 403 硬拒
  - 优先级：**自定义分配（`plan_id <= 0`）> 管理员绑定套餐（`source='admin'`）> 用户购买（`source='order'`）**。**不新增 priority 列**；`preConsumeUserSubscription` 与 `GetSoonestSubscriptionLeftoverForModel` 用 Go 端 `sort.SliceStable` 按 `subscriptionConsumeRank` 提前（Rule 2：禁止 `ORDER BY CASE` / `FIELD()`，SQL 侧仍是 `end_time asc, id asc`），两处排序必须一致，否则 `trySplit` 算出的 `walletNeed` 与实际扣费订阅对不上
  - `AdminAssignCustomSubscription()`：无套餐的自定义分配（`PlanId = 0`、`Source = admin`、`NextResetTime = 0`），用临时 `SubscriptionPlan` 复用 `calcPlanEndTime` 算有效期。`preConsumeUserSubscription` **仅在 `PlanId <= 0` 时**跳过套餐查询并跳过周期重置；`PlanId > 0` 查套餐失败仍 `return err`，避免套餐被删 / DB 抖动时静默跳过到期重置仍扣费
  - 五个只读辅助函数（`GetActiveSubscriptionRemaining` / `CanFullyCoverSubscriptionNeed` / `GetSoonestSubscriptionLeftover` / `HasUsableSubscriptionQuota` / `loadActiveUserSubscriptions`）新增 `*ForModel` 变体，旧签名保留为 `""` 薄包装（零破坏，既有测试与无模型上下文的调用方不用改）
  - 调用方接入模型名仅 3 处：`service/billing_session.go`（4 个调用点传 `relayInfo.OriginModelName`）、`service/channel_select.go`（读 `constant.ContextKeyOriginalModel`，取不到即 `""` 安全降级）、`middleware/distributor.go`（`getModelRequest` 成功后提前写入该 context key，`SetupContextForSelectedChannel` 后面用同值再设一次，无语义变化）
  - 复用 `POST /users/:id/subscriptions`，`plan_id <= 0` 走自定义分配分支；`AdminUpdateUserSubscription` 增加 `allowedModels *string`（nil-gated）并纳入审计字段。SQLite 需在 `ensureSubscriptionPlanTableSQLite()` 的 CREATE DDL 与 `required` 列表两处加 `allowed_models`，MySQL/PG 走 AutoMigrate
  - 前端：`plan-display-models-field.tsx` 泛化为 `plan-models-field.tsx`（`<T extends FieldValues>` + `name` prop），套餐表单 / 自定义分配表单 / 单条订阅编辑共用；`useModelOptions` 抽到 `lib/use-model-options.ts`（避免 `react-refresh/only-export-components`）；新增 `custom-subscription-assign-form.tsx`（Collapsible 折叠面板）；额度输入沿用 `parseQuotaFromDollars` + `getCurrencyLabel()`（Rule 11）
- 管理员分配的订阅（`plan_id <= 0`）支持自定义名称：`UserSubscription` 新增 `CustomName`（`json:"custom_name"`、`varchar(128)`，纯 GORM AutoMigrate 覆盖三库，无需手写 DDL），`AdminAssignCustomSubscription()` 增加尾参 `customName string`（`strings.TrimSpace` 后落库），`AdminUpdateUserSubscription()` 增加 nil-gated 的 `customName *string`（与 `allowedModels` 同模式）并纳入审计字段；controller 两个请求体分别新增 `custom_name` / `*custom_name` 并做 128 字符（rune）上限校验；管理端弹窗与钱包「我的订阅」在 `plan_id <= 0` 时均以 `custom_name || t('Custom assignment')` 展示
- 管理员订阅 UI 补齐自定义名称与展示排序：自定义分配表单新增「订阅名称」输入（留空回落默认名），单条订阅编辑抽屉仅在 `plan_id <= 0` 时渲染该字段（套餐订阅沿用套餐标题），提交走与 `allowed_models` 一致的 dirty-gate 增量写入；钱包「我的订阅」与 `user-subscriptions-dialog.tsx` 共用 `compareSubscriptionsForDisplay` 做纯展示排序——有效在前，其中自定义分配（`plan_id <= 0`）> 管理员套餐 > 购买，同级再按 `end_time` 升序，无效的按 `end_time` 倒序垫底，与后端扣费候选顺序一致但完全独立实现

**涉及文件：** `controller/subscription.go`、`controller/subscription_payment_epay.go`、`controller/subscription_payment_stripe.go`、`controller/subscription_payment_waffo_pancake.go`、`controller/topup_stripe.go`、`model/subscription.go`、`model/subscription_allowed_models_test.go`、`model/provider_subscription.go`、`model/main.go`、`router/api-router.go`、`service/billing_session.go`、`service/channel_select.go`、`middleware/distributor.go`、`dto/user_settings.go`、`common/str.go`、`web/default/src/features/subscriptions/`、`web/default/src/features/subscriptions/lib/model-value.ts`、`web/default/src/features/subscriptions/components/subscriptions-mutate-drawer.tsx`、`web/default/src/features/wallet/`、`web/default/src/features/system-settings/integrations/payment-settings-section.tsx`、`web/default/src/i18n/locales/*.json`

## 三、支付货币 / 钱包货币显示 (Payment Currency)

- 新增 `PaymentCurrency` 选项，并在 topup info API 暴露
- 个人资料余额与累计消费复用全站 `formatQuotaWithCurrency`，随界面语言使用统一币种与汇率（简体中文显示 CNY，其他语言遵循系统显示配置）
- 充值表单支持按本地货币输入
- Stripe 固定 Price 充值在本地币种换算出非整美元时，确认界面会明确显示向上补足后的实际应付金额，并以同一金额创建 Checkout；不再静默向下截断导致少收款
- Epay 充值保留本地币种换算后的小数美元额度，确认页使用后端实际报价；新增订单小数金额和到账 quota 快照，回调、人工补单及充值历史均保留精度，兼容旧整数订单，Stripe 继续按整数美元充值（`controller/topup.go`、`controller/topup_epay_decimal_test.go`、`model/topup.go`、`web/default/src/features/wallet/{index.tsx,hooks/use-payment.ts,lib/payment.ts,lib/payment.test.ts,components/dialogs/payment-confirm-dialog.tsx}`）
- Stripe 余额充值复用 `StripeMinTopUp` 作为唯一最低额度配置：topup info、默认钱包灰显和两个 Stripe 接口使用相同门槛；令牌显示模式会同步换算上下限与 Checkout 数量，避免界面和服务端金额单位不一致
- 余额统一使用 `formatCurrencyFromUSD` / `formatQuotaWithCurrency` 换汇显示；Epay 应付报价以 CNY 返回，确认页通过全局 `formatBillingCurrencyFromCNY` 按 `USDExchangeRate` 换算后复用统一账单币种与符号，保留报价中的充值定价、分组倍率和折扣，不再将 `PaymentCurrency` 直接贴到 CNY 数值上（回归测试：`web/default/src/lib/currency.test.ts`）
- 钱包充值与订阅购买复用统一支付方式选择器，并按余额、银行卡、Epay、普通方式、虚拟货币稳定排序
- 修复：货币符号、转账显示货币、低于全局下限禁用按钮、zh-TW 排除简中 CNY 覆盖

**涉及文件（后端）：** `setting/operation_setting/payment_setting.go`、`controller/topup.go`、`controller/misc.go`、`model/topup.go`、`model/option.go`
**涉及文件（前端）：** `web/default/src/features/wallet/**`、`web/default/src/features/profile/components/profile-header.tsx`、`web/default/src/features/subscriptions/components/dialogs/subscription-purchase-dialog.tsx`、`web/default/src/i18n/locales/*.json`、`web/default/src/lib/currency.ts`、`web/default/src/hooks/use-system-config.ts`、`web/default/src/stores/system-config-store.ts`

### Stripe 支付兼容性 (Stripe Payments)

- 将 Stripe Go SDK 从 `v81.4.0` 升级到 `v82.5.1`（Basil API），恢复 Managed Payments 的 Checkout Session 创建兼容性。
- 修复订阅模式 Checkout 参数：新客户仅传 `customer_email`（若有），不再传仅限 payment 模式的 `customer_creation`；已有 Stripe Customer 仍只传 `customer`。
- Checkout 与 Subscription metadata 写入本地用户/套餐/订单标识；Webhook 按 Basil 的 subscription item 周期字段同步自动续费，并在事务提交失败时返回非 2xx 以触发 Stripe 重试。

**涉及文件：** `go.mod`、`go.sum`、`controller/topup_stripe.go`、`controller/subscription_payment_stripe.go`、`controller/subscription_payment_stripe_test.go`、`model/provider_subscription.go`、`model/provider_subscription_test.go`、`model/subscription.go`、`model/main.go`、`router/api-router.go`、`THIRD-PARTY-LICENSES.md`

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
- 前端锁定为 `web/default`：移除 classic 主题切换入口、embed 与构建产物，`theme.frontend` 只接受 `default`

**涉及文件：** `setting/system_setting/theme.go`、`model/option.go`、`controller/option.go`、`main.go`、`router/web-router.go`、`common/embed-file-system.go`、`common/constants.go`、`Dockerfile`、`Dockerfile.dev`、`web/package.json`、`web/default/src/lib/theme-customization.ts`、`web/default/src/styles/theme*.css`、`web/default/src/styles/index.css`、`web/default/src/features/system-settings/`

## 七、API 密钥与定价页 UX (Keys & Pricing)

- "Use API Key" 弹窗：多工具代码示例
- API 端点按路由（而非描述）标注
- code-block 支持额外/未知语言（单例 highlighter）
- 定价页：按计费类型拆分渠道倍率、可用性过滤、有效倍率徽章、模型卡精简；倍率徽标从名称行移至底部元数据区（避免截断模型名称）；模型广场主页卡片不展示动态计费 tag（详情页仍保留）
- 模型广场价格统一按「基础价 × 分组倍率 × 渠道倍率」展示最低折扣价，移除充值费率价格模式；模型详情默认展示分组折扣价范围，可切换为不含分组/渠道倍率的原价，并覆盖普通、按次与动态计费
- minimax / speech-0 模型映射到 MiniMax 厂商
- CC Switch 导入弹窗：新增「API Endpoint 选择器」（基于 status 的 `api_info` 多端点），并将 `homepage`（官网链接）与所选 API endpoint 解耦——`endpoint` 用所选 API 地址，`homepage` 用真实站点地址 `server_address`（上游二者同源，本 fork 拆分后修复了「官网链接=API 链接」的问题）
- OpenCode 快速导入：Use API Key 与 CC Switch 共用 `buildOpenCodeConfigParts`（`@ai-sdk/openai-compatible`、`limit.context` / `limit.output`、`model` / `small_model`）。Use API Key 输出 `opencode.json`（不含 apiKey）和官方 `auth.json`（Unix `~/.local/share/opencode/auth.json`，Windows `%userprofile%\.local\share\opencode\auth.json`，`{ type: "api", key }`）；CC Switch Config JSON 仍是带 `apiKey` 的供应商片段（顶层必须有 `npm` / `options`，并带 `model` / `small_model`），否则 live config 同步会报 invalid config structure
- Pi 快速配置：Use API Key 弹窗新增 Pi 配置（`~/.pi/agent/models.json` 只写自定义供应商/`openai-completions`/`compat`/模型限额，API key 按官方写入 `~/.pi/agent/auth.json` 的 `{ type: "api_key", key }`；内置供应商 id 如 `openai`/`anthropic` 会加 `newapi-` 前缀避免覆盖 Pi 内置目录）
- 创建 API Key 时自动选中第一个可用分组（开启 DefaultUseAutoGroup 且存在 auto 时仍优先 auto）
- Grok CLI 快速配置：Use API Key 弹窗新增 Grok CLI 标签页，输出 `~/.grok/user-settings.json`（仅 `apiKey` / `defaultModel`，与上游 `UserSettings` 接口一致），并单独提示必须设置 `GROK_BASE_URL` 环境变量（Grok CLI 配置文件无 base URL 字段，只能通过环境变量覆盖默认的 xAI 官方地址）

**涉及文件：** `web/default/src/routes/pricing/index.tsx`、定价/keys 相关前端组件（含 `web/default/src/features/keys/components/dialogs/{cc-switch-dialog,use-api-key-dialog}.tsx`、`web/default/src/features/keys/lib/{opencode-config,pi-config}.ts`、`web/default/src/features/keys/lib/api-key-form.ts`、`web/default/src/features/keys/components/api-keys-mutate-drawer.tsx`）、`constant/context_key.go`、`common/constants.go`

## 八、设置与仪表盘 UI (Settings & Dashboard)

- 配额设置 / 支付设置 UI 优化
- 配额预警阈值按货币单位展示
- 仪表盘 SummaryCards 改用 `formatQuotaWithCurrency`
- footer 居中并移除 ProjectAttribution；combobox-input、usage-logs 列展示重构
- 控制台 Notice 支持旧版纯文本及以 `en` 为必填回退项的语言映射；仪表盘系统公告在既有英文 `content`/`extra` 字段上支持 `translations` 映射。后端保留 JSON 对象，验证英文与各语言的内容长度，前端可在目标语言缺失时回退英文。
- 系统公告保存：Notice / 仪表盘公告的内容长度按 Unicode 字符计数（不再用 Go `len` 按字节截断中文）；Notice 表单允许未填写的语言草稿、英文缺失时给出可见错误；公告列表保存会检查接口 `success`，避免校验失败仍提示已保存。

**涉及文件：** `controller/option.go`、`setting/console_setting/validation.go`、`web/default/src/features/system-settings/maintenance/notice-section.tsx`、`web/default/src/features/system-settings/content/announcements-section.tsx`、`web/default/src/features/dashboard/components/overview/announcements-panel.tsx`

## 九、国际化 (i18n)

- 新增 **zh-TW** locale
- 同步 en/zh/fr/ru/ja/vi 翻译：计费、主题、订阅、邀请阈值、批量用户、倍率徽章、可用性过滤、配额阈值等新功能
- 补齐缺失 `t()` key（25 条）及仍为英文的界面文案：统计看板、用户批量操作、渠道批量测试、公告/通知、日文页脚；品牌名（CC Switch / Waffo Pancake）保持英文并加入 sync 跳过列表

**涉及文件：** `web/default/src/i18n/locales/*.json`、`web/default/src/i18n/config.ts`、`web/default/src/i18n/languages.ts`、`web/default/scripts/sync-i18n.mjs`

## 十、开发 / CI 基础设施 (Dev & CI)

- 新增 air 热重载配置 `.air.toml`、`docker-compose.dev.yml`、`Dockerfile.dev`
- CI：`DOCKERHUB_USERNAME` secret 动态镜像名；`docker-build.yml`、`docker-image-alpha.yml`、`docker-image-nightly.yml`
- `.gitignore` 忽略 `tmp/`、`graphify-out/`
- `AGENTS.md` 记录仅供本地 Docker UI 验证使用的固定测试账号；禁止用于生产、外部部署或第三方服务

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

## 十三、内容审查 (Content Review)

- 管理员可启用对用户提示词的 LLM 审查：使用系统内已配置渠道模型，自定义审查提示词
- 运行模式线性三档 `off | async | block`（参考 sub2api）：关闭 / 后台审查不挡请求 / 同步拦截当次请求
- 按置信度阈值标记用户为高风险（用户列表展示/筛选/清除）；仅 block 模式可拦截当次请求
- 审查失败/超时默认 fail-open；审查调用不向用户计费
- 默认审查提示词聚焦 cyber abuse、网络虐待（霸凌/骚扰）与人身伤害（含 CSAM），其它内容放行；内置词只维护在后端，设置页预填该文本方便修改，「恢复默认」填回内置词
- block 拦截（含 fail-closed）写入使用日志的错误记录（type=error），不依赖 `ERROR_LOG_ENABLED`；含置信度与拦截原因
- 独立 `content_review_logs`（LOG_DB）：每条审查（pass/flag/block/error）都落库，含审查模型 tokens、预估成本、渠道、耗时；不向用户扣费、不进用量统计
- 管理员审查日志页 `/usage-logs/review`：筛选判定/模型/用户、统计条、按时间清理（仅 pass 或全部）；列表展示截断后的原因，悬停显示完整预览
- 现有「清理历史日志」同时删除审查日志与系统日志；`LogRetentionDays` 按保留天数定时自动清理用量日志、系统日志与审查日志（0=永久保留）；pass 可配采样率，输入预览默认关闭
- 跳过内容审查开关：用户级（存入 `dto.UserSetting` JSON blob 的 `skip_content_review`，管理员端点 `PUT /api/user/:id/content_review_skip`，写审计日志 `user.content_review_skip`）与渠道级（存入 `dto.ChannelOtherSettings` 的 `skip_content_review`）；命中跳过时整个 `reviewUserPrompt` 不执行，也不产生审查日志与审查模型调用。渠道级仅在请求进入 `Relay()` 前已固定渠道时生效（管理员 API 密钥带显式 channel-id 后缀），渠道 Test 按钮与普通分组负载均衡均不生效
- 审查请求抽查：全局 `content_review.request_sample_rate`（0–1，默认 1）按用户抽查是否调用审查模型；用户级 `content_review_sample_rate`（`PUT /api/user/:id/content_review_sample`，nil=沿用全局）覆盖全局；`skip_content_review` 仍为 0。未抽中的请求不调审查模型、不写审查日志
- 管理员通知：`content_review.notify_admin`（默认关）开启后，仅在用户**从未高风险变为高风险**时通过 `NotifyRootUser` 通知根管理员（邮件/Webhook/Bark/Gotify，受现有通知限流约束）。同一账号后续命中只刷新高风险原因，不再通知；管理员清除高风险后再次命中会再通知一次

**涉及文件：** `setting/content_review.go`、`service/content_review.go`、`service/content_review_test.go`、`service/log_cleanup_task.go`、`service/user_notify.go`、`controller/content_review.go`、`controller/content_review_test.go`、`controller/content_review_log.go`、`controller/log.go`、`controller/relay.go`、`controller/user.go`、`controller/audit.go`、`common/constants.go`、`dto/user_settings.go`、`dto/channel_settings.go`、`dto/notify.go`、`model/content_review_log.go`、`model/log.go`、`model/option.go`、`model/main.go`、`model/user.go`、`model/ability.go`、`main.go`、`types/error.go`、`relay/channel/api_request.go`、`router/api-router.go`、`middleware/audit.go`、`web/default/src/features/system-settings/security/**`、`web/default/src/features/system-settings/maintenance/log-settings-section.tsx`、`web/default/src/features/users/**`、`web/default/src/features/channels/**`、`web/default/src/features/usage-logs/**`、`web/default/src/hooks/use-sidebar-data.ts`、`web/default/src/hooks/use-sidebar-config.ts`、`web/default/src/i18n/locales/*.json`

## 十四、管理员统计面板 (Statistics)

- 新增 admin-only 统计接口分组 `/api/statistics`（`middleware.AdminAuth()`），供新「统计」页面使用
  - `GET /api/statistics/users`：基于 **LOG_DB `logs`（`type=consume`）** 按 `user_id` 聚合的用户用量列表，与使用日志同一数据源（不再读最多延迟 `DataExportInterval` 分钟的 `quota_data`）。`MAX(username)` 展示名；`keyword` 至少 2 个字符才模糊匹配；`p`/`page_size` 分页、`quota DESC` 排序；附 KPI 汇总与等长上一周期环比，以及每行 12 点 sparkline（`trend`，一次聚合查询批量取，不按行发请求）
  - `GET /api/statistics/users/detail`：单用户详情，一次请求返回 `summary` + `tokens`（密钥维度）+ `models`（模型维度）三段。密钥段先在 **LOG_DB** 按 `token_id` 聚合（限定 `user_id` + `type=consume`），再到主库 `tokens` 用 `IN` 批量补 `name`/`status`，**不跨库 JOIN**；软删除的令牌返回 `status = -1`；响应绝不含 `Token.Key`。模型段按 `model_name` 聚合且**不过滤 `token_id`**，因此 `summary` 才是该用户周期内的真实合计（含无关联密钥的调用），`models[].percentage` 为该模型 quota 占 `summary.quota` 的比例
  - `GET /api/statistics/revenue`：收入 KPI / 趋势 / 渠道占比 / Top 充值用户 / 最近充值记录。统一口径 `status='success' AND payment_provider <> 'balance' AND complete_time > 0`（余额抵扣不是真实收入，`complete_time=0` 为历史脏数据）。`money` 统一为系统 USD：Epay 的网关 CNY 按当前 `Price` 换算后再聚合
- 分桶复用 `rankingBucketExpr(column, bucketSize)`（MySQL `FLOOR(col/N)*N`，SQLite/PostgreSQL `(col/N)*N`）；粒度按时间跨度自动选择（≤3 天用小时桶，否则天桶）
- **订阅订单镜像 `top_ups` 时补齐 `payment_provider`**（`upsertSubscriptionTopUpTx`）：此前该字段留空，导致 Epay 订阅单的网关 CNY 金额不会按 `Price` 折回系统 USD（线上 300.3 的套餐被显示成 ¥2102.1），支付方式占比也只能显示「未知」，且空 provider 行会绕过 `payment_provider <> 'balance'` 的口径过滤。更新分支与既有 `PaymentMethod` 守卫对称：为空则补齐，两者非空且冲突返回 `ErrPaymentMethodMismatch`。同时新增一次性回填 `migrateTopUpPaymentProviderBackfill()`（挂在 `migrateDB()` 的 `AutoMigrate` 之后），按 `trade_no` 从 `subscription_orders` 补历史空 provider 行——分块 `IN` + 按 provider 聚合更新，不用 MySQL 专有的 `UPDATE ... JOIN`，`WHERE payment_provider = ''` 保证幂等
- 两段汇率语义（两个独立的管理员配置项，代码里全部从 `operation_setting` 动态读取）：聚合侧用 **成交汇率** `Price` 把 Epay 的 CNY 归一成系统 USD，展示侧前端按 Rule 11 用 **展示汇率** `USDExchangeRate` 转回 CNY。默认两者相等（7.3）时精确抵消，页面金额与实付一致；若管理员把两者配成不等，统计页的 CNY 展示会按比例偏离实付（多币种聚合归一的固有代价）。钱包「计费历史」的「支付」列走 `formatNumber` 原样输出、不参与归一，不受影响
- 「最近充值记录」返回用户名而非裸用户 ID：新增扁平 DTO `RevenueRecentTopUp`（不嵌入 `TopUp`，避免继承其为兼容 Epay 小数金额而写的自定义 `MarshalJSON`），用户名走抽出的 `usernamesByIds()` 批量 `IN` 查询、与 `GetTopRechargeUsers` 共用，**不跨表 JOIN**。前端订单表与渠道占比饼图共用 `revenueProviderLabelKey()`，把 provider slug 映射成已有 i18n 文案（易支付 / Stripe / …），未命中才回落「未知」
- 「真实成本 / Real Cost」KPI 改名为「原始价值 / Original Value」（字段 `real_cost_usd` → `original_value_usd`）：旧名容易被误读成「用户实际花的钱」，且中文界面还按 Rule 11 转成人民币，进一步加深误解。公式同步换成与订阅购买页 `calculateModelUsdValue` 一致的 `quota / QuotaPerUnit / minEffectiveRatio`——`minEffectiveRatio` 取该模型所有已启用分组里 `group_ratio × channel_ratio_min` 的最小值（优先用 `group_channel_ratio_min_subscription`），数据源为 `model.GetPricing()` + `ratio_setting.GetGroupRatioCopy()`，不再依赖 `GetModelRatioOrPrice`。展示端始终显示原始 USD（Rule 11 的「官方原始值」例外场景）。`original_value_usd` 在模型拆分查询失败、或没有任何一行成功换算时省略（nil / omitempty），不把 0 当成已计算；至少一行换算成功才发数字（含 0），部分换算只累加成功行；summary / 每用户 / 每密钥同一规则
- 移动端用量 Tab 关闭 `fixedContent`：KPI 不再把用户列表挤出视口；KPI 两列、无 sparkline 时去掉空图表占位，说明文字 `sm+` 才显示
- 用户用量改为**点击整行弹出详情框**，取代原来的行内展开下钻：展开箭头列删除，弹框内上下堆叠「API 密钥」「模型」两张表并附 4 项周期汇总。原下钻只有密钥一个维度，且 `MobileCardList` 不渲染 `renderRow`，手机上完全看不到明细——为此给共享组件 `MobileCardList` / `DataTablePage` 加了向后兼容的可选 `onRowClick`（行 `role="button"` + Enter/Space 键盘可达），桌面 `DataTableRow` 同样挂 `role="button"` + Enter/Space，移动端卡片也可点开弹框

**涉及文件：** `model/statistics_common.go`、`model/statistics_usedata.go`、`model/statistics_log.go`、`model/statistics_log_test.go`、`model/statistics_topup.go`、`model/statistics_topup_test.go`、`model/subscription.go`、`model/payment_method_guard_test.go`、`model/main.go`、`controller/statistics_user.go`、`controller/statistics_revenue.go`、`router/api-router.go`、`web/default/src/features/statistics/**`、`web/default/src/components/data-table/layout/**`、`web/default/src/routes/_authenticated/statistics/**`、`web/default/src/hooks/use-sidebar-data.ts`、`web/default/src/i18n/locales/*.json`

## 十五、安全加固 (Security)

- `TRUSTED_PROXIES`：默认（空 / `private`）信任 RFC1918 + loopback + IPv6 ULA，Docker + Traefik 不用配。`none` 才是不信任任何 hop。只有把服务端口直接暴露到公网时才需要 `none` 或写死 CIDR
- SSRF：`DialContext` 只挂在 fetch/download 客户端（下载、Webhook、Bark/Gotify、用户图/视频 URL），不挂共享 relay `GetHttpClient()`，避免本地/私网渠道和 `HTTP_PROXY` 指向本机代理时被默认拦截
- 支付：易支付核对 signed `money`、行锁入账、先入账再 ACK；钱包扣费 `quota >=`；订阅/其它网关比对实付金额
- 鉴权：cookie 会话每次重读缓存角色/封禁；2FA 覆盖 OAuth/Telegram/Passkey/WeChat；Telegram `auth_date`；邮箱占用 `>=1` 且重置只改一行；Turnstile 10 分钟；过期 token 不能读 usage；公开 `/api/user/groups` 需登录
- 会话 Cookie `SESSION_COOKIE_SECURE` 默认 true（dev compose 设 false）；CORS 不再 `AllowCredentials`+`*`；SMTP 证书校验跟随 `TLS_INSECURE_SKIP_VERIFY`
- 首次初始化需 `SETUP_TOKEN`（或 `SETUP_SKIP_TOKEN=true`）；去掉 Lobe/aiaw 把 sk- 送到第三方的预设；用户日志去掉 channel id；公告 HTML 消毒
- 使用日志对普通用户剥离 `is_model_mapped` / `upstream_model_name`，列表与详情不再展示「请求模型 / 实际模型」映射

**涉及文件：** `common/trusted_proxies.go`、`common/ssrf_protection.go`、`common/money.go`、`common/init.go`、`common/email.go`、`service/http_client.go`、`service/download.go`、`service/webhook.go`、`service/user_notify.go`、`service/billing_session.go`、`middleware/auth.go`、`middleware/cors.go`、`middleware/logger.go`、`middleware/turnstile-check.go`、`controller/topup.go`、`controller/subscription_payment_epay.go`、`controller/setup.go`、`controller/oauth.go`、`controller/user.go`、`controller/telegram.go`、`model/user.go`、`model/topup.go`、`model/log.go`、`setting/chat.go`、`main.go`、`docker-compose.dev.yml`、`web/default/src/**`

## 十六、文档 (Docs)

- AGENTS.md 为项目规范单一来源，CLAUDE.md 软链接指向它
- 移除 protected-info 规则，新增 Docker Compose 开发规则
- 本文件 (FORK_CHANGES.md)

## 十七、使用日志思考强度 (Usage log thinking intensity)

使用日志 `logs.other` 更完整地持久化思考强度，供前端展示。不改表结构：

- 继续写 `other.reasoning_effort`；新增 `other.thinking_budget`（Gemini/Claude budget tokens）
- 在 adaptor 转换**之前**从请求字段 / 模型后缀提取（避免 OpenRouter 清空 `reasoning_effort`、Claude/Gemini 只改请求不写 RelayInfo）
- Claude Opus `-thinking` 记 `high`；Gemini `extra_body.google.thinking_config` 的 level/budget 写入 RelayInfo

**涉及文件（后端）：** `relay/common/relay_info.go`、`setting/reasoning/effort.go`、`service/log_info_generate.go`、`relay/compatible_handler.go`、`relay/responses_handler.go`、`relay/claude_handler.go`、`relay/gemini_handler.go`、`relay/channel/openai/adaptor.go`、`relay/channel/claude/adaptor.go`、`relay/channel/claude/thinking_info.go`、`relay/channel/gemini/relay-gemini.go`、`relay/channel/xai/adaptor.go`、`relay/channel/deepseek/adaptor.go`

模型列在思考强度徽章旁只展示请求模型名，不再带上游映射弹层。

**涉及文件（前端）：** `web/default/src/features/usage-logs/types.ts`、`web/default/src/features/usage-logs/lib/reasoning-effort.ts`、`web/default/src/features/usage-logs/components/reasoning-effort-badge.tsx`、`web/default/src/features/usage-logs/components/columns/common-logs-columns.tsx`、`web/default/src/features/usage-logs/components/dialogs/details-dialog.tsx`、`web/default/src/i18n/locales/*.json`

## 十八、渠道周期限流 (Channel Rate Limit)

按渠道配置滑动窗口速率（默认 1s N 次）。满了等当前渠道，超时 429，不因限流换渠、不占 `RetryTimes`。同优先级内先按 `ratio` 分桶（桶总 weight 抽价格），桶内有限流时选使用率最低的渠道。

- 配置挂 `dto.ChannelSettings`：`rate_limit_count`（0=不限）、`rate_limit_duration_ms`（默认 1000）、`rate_limit_wait_ms`（nil=10s，0=等到客户端断开）
- Redis ZSET 滑动窗口；无 Redis 时进程内窗口（多副本不共享）
- 选路缓存路径在 `channelSyncLock` 外读 usage；DB 路径与缓存路径共用 `pickChannelByWeightAndLoad`
- 等待挂在实际打上游前（Relay 重试循环 / Task 提交 / Midjourney 提交与换脸），渠道测试与内容审查不计
- 超时 429 写入系统拒绝日志 `SystemLogTypeRateLimit`（reason=`channel_rate_limit_exceeded`），并带上渠道 ID / 模型名
- 等待中的请求按到达顺序（FIFO）排队重试，而非各自随机抖动后重试抢槽位：进程内用内存队列（`queue_memory.go`），Redis 模式用跨实例队列（`queue_redis.go` + `lua/queue_poll.lua`，lease key TTL 兜底崩溃场景）

**涉及文件：** `common/chrate/`、`dto/channel_settings.go`、`model/channel.go`、`model/channel_cache.go`、`model/ability.go`、`model/channel_select.go`、`service/channel_rate_limit.go`、`controller/relay.go`、`relay/relay_task.go`、`relay/mjproxy_handler.go`、`constant/midjourney.go`、`types/error.go`、`i18n/keys.go`、`i18n/locales/*.yaml`、`web/default/src/features/channels/lib/channel-form.ts`、`web/default/src/features/channels/types.ts`、`web/default/src/features/channels/components/drawers/channel-mutate-drawer.tsx`、`web/default/src/i18n/locales/*.json`
