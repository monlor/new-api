---
name: qa-review
description: QA and verification methodology for new-api changes. Use after each module is implemented (incrementally) to cross-check against the project's cross-DB / JSON-wrapper / pointer-DTO / StreamOptions / billing rules and to verify integration boundaries — backend response shape vs frontend consumption. Runs builds, tests and minimal repro scripts to confirm real behavior, not just that code exists. Pair with newapi-conventions.
---

# qa-review — QA / 集成校验方法论

QA 的价值不在"确认代码存在"，而在**经界面交叉比对**与规则合规，并**真跑**构建/测试确认行为。规则全集见 `newapi-conventions`。

## 三条方法论

1. **增量 QA** —— 每个模块完成后立即校验，而非全部完工才来一次。早发现早返工。
2. **边界比对（最高优先）** —— bug 多藏在接口缝隙。同时读后端响应定义（`dto/`、controller 返回）与前端消费点（hook/组件），逐字段比对：名称、类型、可空性、大小写、嵌套结构、数组 vs 对象。
3. **覆盖非 happy path** —— 错误分支、空/零值、分页、流式（stream）、三库差异。

## 合规清单（逐条核对实现）

- [ ] **JSON**（Rule 1）：业务代码无直接 `encoding/json` 的 marshal/unmarshal；全走 `common.*`。
      快速扫描：`grep -rn "json.Marshal\|json.Unmarshal\|json.NewDecoder\|json.NewEncoder" --include=*.go controller service model relay middleware | grep -v "common/json.go"`
- [ ] **三库**（Rule 2）：无无回退的 MySQL/PG 专属 SQL；保留字列用 `commonGroupCol/commonKeyCol`；布尔 `commonTrueVal/commonFalseVal`；SQLite 迁移无 `ALTER COLUMN`；JSON 列 `TEXT`。
- [ ] **指针 DTO**（Rule 6）：上游 relay 请求结构可选标量是指针+`omitempty`，显式 `0/false` 不被丢。
- [ ] **StreamOptions**（Rule 4）：支持的新 channel 已入 `streamSupportedChannels`。
- [ ] **计费**（Rule 7）：符合 `pkg/billingexpr/expr.md`；预扣/结算口径一致；task 钩子语义正确。
- [ ] **i18n**：新增前端文案已 `i18n:sync`，各 locale 无缺 key。

## 真跑验证（不要假装）

```bash
# 后端
go build ./...
go vet ./...
go test ./...                       # 按改动范围裁剪

# 前端
cd web/default && bun run typecheck && bun run lint
```

对涉及行为的改动，写/跑一个最小复现（单测或脚本）确认实际表现。**如实报告**：失败贴输出说失败；跳过的检查说明跳过；通过且已验证才说通过。

## 输出格式

```
## 校验结论：PASS / FAIL / PASS-with-risks
## 已运行
- <命令> → <关键结果>
## 发现（按严重度）
- [BLOCKER] file:line — 问题 + 违反规则 + 修复建议
- [WARN] file:line — ...
## 边界比对
- 后端字段 X (dto/..:NN) vs 前端 useX (web/..:NN)：一致 / 不一致<细节>
```

## 协作

- 发现 BLOCKER：SendMessage 直接回退给对应工程师并附定位，不自行大改业务逻辑。
- 中间产物写 `_workspace/` 便于审计。
