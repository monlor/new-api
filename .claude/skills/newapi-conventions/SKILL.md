---
name: newapi-conventions
description: The non-negotiable project rules and conventions for new-api (Go AI API gateway). Read this BEFORE writing or reviewing any backend code, channel adapter, migration, or billing change. Covers the JSON wrapper rule, three-database compatibility (SQLite/MySQL/PostgreSQL), pointer-DTO zero-value rule, StreamOptions, billing-expression system, the layered architecture map, and where things live. Shared by go-backend-engineer, qa-reviewer, and frontend-engineer. Detailed playbooks live in references/.
---

# new-api 项目铁律与约定

这是 new-api 的"宪法"。写代码、改适配器、做迁移、动计费——动手前都先过一遍这里。规则带"为什么"，理解原因才能在边界情况下判断正确。

## 架构地图（Router → Controller → Service → Model）

```
router/      HTTP 路由 (api / relay / dashboard / web)
controller/  请求处理器（只放 HTTP 相关）
service/     业务逻辑
model/       数据模型 + GORM 数据访问
relay/       AI 代理；relay/channel/<provider>/ 各家适配器
middleware/  鉴权 / 限流 / CORS / 日志 / 分发
setting/     配置 (ratio/model/operation/system/performance)
common/      共享工具（JSON、crypto、redis、env、rate-limit…）
dto/         请求/响应 DTO        types/   relay 格式与错误
constant/    常量                  i18n/    后端 i18n (en/zh)
pkg/         内部包 (cachex, ionet, billingexpr)
web/default/ React19 前端   web/classic/ React18 前端
```

分层原则：HTTP 细节留 controller，业务进 service，数据访问进 model。新代码命名/注释/错误处理风格与周边一致。

## 七条铁律（速查；详情见 references）

### Rule 1 — JSON 统一走 `common/*`
业务代码**禁止**直接 `encoding/json` 的 marshal/unmarshal。用：
`common.Marshal` / `common.Unmarshal` / `common.UnmarshalJsonStr` / `common.DecodeJson` / `common.GetJsonType`。
*为什么*：保留单一入口，将来可整体替换更快的 JSON 库。`json.RawMessage`、`json.Number` 等**类型**仍可引用，只是不直接调用其 marshal/unmarshal。

### Rule 2 — 三库同时兼容（SQLite / MySQL≥5.7.8 / PostgreSQL≥9.6）
所有 DB 代码必须三库同时成立。优先 GORM 抽象，让 GORM 管主键（不要 `AUTO_INCREMENT`/`SERIAL`）。
裸 SQL 不可避免时：保留字列用 `commonGroupCol`/`commonKeyCol`，布尔用 `commonTrueVal`/`commonFalseVal`，按 `common.UsingPostgreSQL/UsingSQLite/UsingMySQL` 分支。
禁止：无回退的 `GROUP_CONCAT`/`STRING_AGG`、PG 专属 `@>`/`?`/JSONB 操作符、SQLite `ALTER COLUMN`、无回退的 DB 专属列类型（JSON 用 `TEXT` 不用 `JSONB`）。
→ 完整清单与迁移模式：**`references/cross-db.md`**

### Rule 3 — 前端用 Bun
`bun install` / `bun run dev` / `bun run build` / `bun run i18n:*`。不要 npm/yarn/pnpm。

### Rule 4 — 新 channel 的 StreamOptions
实现新 channel 时确认是否支持 `StreamOptions`；支持则加入 `streamSupportedChannels`。
→ 适配器全流程：**`references/channel-adapter.md`**

### Rule 6 — 上游 relay 请求 DTO 保留显式零值
从客户端 JSON 解析、再 re-marshal 到上游的请求结构，其可选标量字段**必须用指针+`omitempty`**（`*int/*uint/*float64/*bool`）。
语义：字段缺省→`nil`→marshal 时省略；显式置零/false→非 nil 指针→**仍要发上游**。
*为什么*：非指针标量+`omitempty` 会把 `0/0.0/false` 当空值静默丢掉，导致上游收不到用户的显式设置。

### Rule 7 — 计费表达式系统
做分层/动态定价（表达式计费）前，**必读** `pkg/billingexpr/expr.md`。
→ 速查与落点：**`references/billing.md`**

### Rule 8 — PR 标注 AI 贡献
建 PR 时对比当前 git user 与历史核心作者（`git log`，勿改 git config）；若非核心作者，PR body 注明 AI 生成/辅助。始终用 `.github/PULL_REQUEST_TEMPLATE.md` 模板填写。

## i18n（前后端）
- 后端 `i18n/`：go-i18n，en/zh。
- 前端 `web/default/src/i18n/locales/`：i18next，flat JSON，key 即英文源串；语言 en(base)/zh(fallback)/zh-TW/fr/ru/ja/vi。新增文案后 `cd web/default && bun run i18n:sync`。

## references 何时读
| 任务 | 读 |
|------|----|
| 新增/改 provider 适配器 | `references/channel-adapter.md` |
| 数据库读写 / 迁移 | `references/cross-db.md` |
| 计费 / 定价 | `references/billing.md` + `pkg/billingexpr/expr.md` |
