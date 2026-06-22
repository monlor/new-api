# 计费 / 定价速查

## 唯一权威来源
做**表达式计费**（分层/动态定价）前，必须先完整阅读 **`pkg/billingexpr/expr.md`**（约 250 行）。它定义了设计哲学、表达式语言（变量/函数/示例）、完整系统架构（编辑器→存储→预扣→结算→日志展示）、token 归一化规则（`p`/`c` 自动排除）、quota 换算、表达式版本化。本文件只是路标，不复述细节——以 expr.md 为准。

## 系统落点（File Map，配合 expr.md 阅读）
```
pkg/billingexpr/
├── expr.md      # 权威文档，先读它
├── compile.go   # 表达式编译
├── run.go       # 求值
├── settle.go    # 结算
├── round.go     # 取整
└── types.go     # 类型
```

## 改动前关键问题（答案都在 expr.md）
- 这次改动落在哪一环：编辑器 / 存储 / 预扣(pre-consume) / 结算(settlement) / 日志展示？
- 涉及哪些 token 变量（`p`/`c`/`len`…）？归一化与 `p`/`c` 自动排除规则是否受影响？
- quota 换算与取整是否一致？
- 表达式版本化是否需要 bump？历史日志的回放是否仍正确？

## 两类计费路径
1. **同步 relay 计费**：走 ratio/model 配置 + 表达式系统。
2. **异步 task 计费**：见 `references/channel-adapter.md` 的三个钩子（`EstimateBilling` / `AdjustBillingOnSubmit` / `AdjustBillingOnComplete`）。

## 自检
- [ ] 已读 `pkg/billingexpr/expr.md`？
- [ ] 预扣与结算两端口径一致（不会出现扣多/扣少不对账）？
- [ ] 表达式改动有对应测试（参考 `pkg/billingexpr/billingexpr_test.go`）？
- [ ] 三库下存储/读取表达式一致（JSON 列用 TEXT，见 cross-db.md）？
