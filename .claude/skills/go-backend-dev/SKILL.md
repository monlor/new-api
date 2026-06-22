---
name: go-backend-dev
description: Workflow for implementing and modifying Go backend code in new-api — features, bugfixes, new provider channel adapters, GORM models, migrations, services, controllers, middleware and billing. Use whenever you touch any .go file under router/ controller/ service/ model/ relay/ middleware/ setting/ common/ dto/ pkg/. Enforces the project's cross-DB, JSON-wrapper, pointer-DTO, StreamOptions and billing rules. Pair with newapi-conventions.
---

# go-backend-dev — Go 后端开发工作流

new-api 后端用 Go 1.25 + Gin + GORM v2。这条技能是动手流程；硬性规则在 `newapi-conventions`（先读它）。

## 工作流

1. **定位** —— 先看 code-navigator 的地图，或自己用 codebase-memory-mcp / grep 找准入口与所有相关文件。改前先 `Read`。
2. **判类型，读对应 reference**（在 `newapi-conventions/references/`）：
   - provider 适配器 → `channel-adapter.md`
   - DB / 迁移 → `cross-db.md`
   - 计费 → `billing.md` + `pkg/billingexpr/expr.md`
3. **沿分层实现** —— HTTP 留 controller，业务进 service，数据访问进 model。命名/注释/错误处理与周边一致。
4. **逐条对照铁律**（见下"提交前必过"）。
5. **编译 + 测试** —— `go build ./...`；按范围跑 `go test`。
6. **交接** —— 把改动文件、关键决策、需 QA 重点列给 qa-reviewer。

## 提交前必过（Rule 速查）

- **JSON**：无直接 `encoding/json` marshal/unmarshal，全用 `common.Marshal/Unmarshal/UnmarshalJsonStr/DecodeJson/GetJsonType`。（Rule 1）
- **三库**：能用 GORM 就别裸 SQL；裸 SQL 用 `commonGroupCol/commonKeyCol/commonTrueVal/commonFalseVal` 与 `common.UsingXxx` 分支；迁移在 SQLite 不用 `ALTER COLUMN`；JSON 列用 `TEXT`。（Rule 2）
- **指针 DTO**：上游 relay 请求结构的可选标量 = `*int/*uint/*float64/*bool` + `omitempty`，显式零值要下发。（Rule 6）
- **StreamOptions**：支持的新 channel 加入 `streamSupportedChannels`。（Rule 4）
- **计费**：符合 `expr.md`；task 适配器三个计费钩子语义正确。（Rule 7）

## 常用命令

```bash
go build ./...                       # 编译全量
go vet ./...                         # 静态检查
go test ./relay/... ./model/...      # 按改动范围裁剪
go test ./pkg/billingexpr/...        # 计费改动
go run main.go                       # 本地起后端（或 make start-backend）
```

## 新增 provider 适配器（最常见的专项任务）

照搬一个相近的现有 provider（最简 `deepseek/`，多模态 `openai/`/`gemini/`）：
1. 建 `relay/channel/<provider>/{adaptor.go,constants.go}`，实现 `Adaptor`（或异步 `TaskAdaptor`）接口。
2. 在 `constant/` 与适配器工厂处注册接线（用 code-navigator 把样板 provider 的全部引用点找全照做）。
3. 填模型列表、`GetChannelName()`、默认 base url。
4. 支持 stream_options 的加入 `streamSupportedChannels`。
5. `go build ./...` + 针对性测试。
详见 `newapi-conventions/references/channel-adapter.md`。

## 后续/再次执行

若存在 `_workspace/` 既有产物或用户给了反馈：先读取，仅改受影响部分，不要推倒重来。
