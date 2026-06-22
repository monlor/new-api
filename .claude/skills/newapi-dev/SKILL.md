---
name: newapi-dev
description: Orchestrates the new-api agent team (code-navigator, go-backend-engineer, frontend-engineer, qa-reviewer) for any development task on this Go AI API gateway — features, bugfixes, new provider channel adapters, backend/frontend changes, migrations, billing, refactors. Use this whenever the user asks to build, implement, add, change, fix, refactor, extend, review, or verify code in new-api. Also triggers on follow-ups — "重新跑/再做一遍/更新/修改/补充/继续/基于上次结果/只改某部分/改进结果". Simple one-off questions can be answered directly without the team.
---

# newapi-dev — new-api 开发编排器（Agent Team）

把 new-api 的开发任务编排成一支自协调的 agent 团队。你（主循环）是**Leader/编排器**：拆任务、组队、分发、监控、汇总。具体"怎么做"在各 agent 的技能里（`go-backend-dev` / `frontend-dev` / `qa-review` / `newapi-conventions`），这里定义"谁、何时、按什么顺序协作"。

## 团队成员（全部 `model:"opus"`）

| Agent (`subagent_type`) | 角色 | 主技能 |
|---|---|---|
| `code-navigator` | 只读探查：定位文件/符号/调用链/跨边界点 | (codebase-memory + newapi-conventions) |
| `go-backend-engineer` | Go 后端实现（含 channel 适配器/迁移/计费） | go-backend-dev, newapi-conventions |
| `frontend-engineer` | React19 前端 + i18n | frontend-dev, newapi-conventions |
| `qa-reviewer` | 三库/规则合规 + 边界比对 + 真跑验证 | qa-review, newapi-conventions |

> 不是每个任务都要全员。按任务裁剪：纯前端任务可不召 backend；纯探查可只用 navigator。

## 执行模式：Agent Team（默认）

本会话是**单一隐式团队**。用 `Agent` 工具以 `name` 命名成员即加入团队、可被 `SendMessage` 定向通信；用 `TaskCreate/TaskUpdate/TaskList` 维护共享任务板；成员间用 `SendMessage` 自协调。

> `SendMessage`、`TaskCreate/TaskUpdate/TaskList` 是延迟工具：首次使用前先 `ToolSearch("select:SendMessage,TaskCreate,TaskUpdate,TaskList,TaskGet")` 加载 schema。

**召唤成员的标准调用**（务必带 `model:"opus"`）：
```
Agent(subagent_type="go-backend-engineer", name="backend", model="opus",
      run_in_background=true, prompt="<任务+输入地图+接口契约+产物路径>")
```
- 需要并行的独立工作 → `run_in_background=true`，事后汇总。
- 有强顺序依赖（探查→实现→QA）→ 用流水线，前一棒产物喂下一棒。

何时改用**子代理/混合**：单 agent 就能闭环、只需返回结果、团队通信纯属开销时，直接 `Agent(... run_in_background)` 当子代理用即可。Phase 特性差异大时混合（如：并行探查用子代理 → 合并实现用团队）。

## 工作流

### Phase 0：上下文确认（必做，决定执行模式）
1. 检查工作区是否已有既往产物：`_workspace/` 是否存在。
2. 据此分流：
   - `_workspace/` 不存在 → **初次执行**（走完整流程）。
   - `_workspace/` 存在 + 用户要求改某部分 → **部分再执行**（只重召相关 agent，复用其余产物）。
   - `_workspace/` 存在 + 用户给了新输入/新任务 → **新执行**（先把旧 `_workspace/` 挪到 `_workspace_prev/` 再开始）。
3. 读 `CLAUDE.md` 的"Harness"段确认当前团队/规则现状。

### Phase 1：分析与拆解
1. 判定任务类型与受影响层：后端 / 前端 / channel 适配器 / 迁移 / 计费 / 全栈。
2. 拆成有依赖关系的子任务，用 `TaskCreate` 建共享任务板（标注依赖）。
3. 据规模定团队大小（见下"团队规模"）。

### Phase 2：探查（code-navigator）
- 召 `code-navigator` 产出"相关文件 + 调用链 + 跨边界点 + 风险"地图，写入 `_workspace/01_navigator_map.md`。
- 全栈任务务必让它同时定位**后端响应结构**与**前端消费点**，供后续 shape 对齐。

### Phase 3：实现（按需并行）
- 后端 → `go-backend-engineer`；前端 → `frontend-engineer`。可并行（`run_in_background`）。
- **全栈先定接口契约**：让两位工程师先就 API 字段名/类型/可空性达成一致，写入 `_workspace/contract.md`，再各自实现。避免前后端 shape 不一致。
- 每个工程师产物（改了哪些文件 + 决策 + 待 QA 重点）写入 `_workspace/`。

### Phase 4：增量 QA（qa-reviewer）
- **每个模块交付后立即召 `qa-reviewer`**，不要等全部完工。
- QA 跑构建/测试、核对规则清单、做后端↔前端边界比对，结论写 `_workspace/qa_report.md`。
- 出现 BLOCKER → 回退给对应工程师修，再复验。

### Phase 5：汇总
- 收齐产物，向用户给出：做了什么、改了哪些文件、验证结果（真实命令输出）、残留风险/未覆盖项。

## 数据传递协议

| 策略 | 方式 | 适用 |
|---|---|---|
| 任务板 | `TaskCreate/TaskUpdate/TaskList` | 进度、依赖、作业分配 |
| 消息 | `SendMessage(to=name)` | 实时协调、契约对齐、BLOCKER 回退 |
| 文件 | `_workspace/{phase}_{agent}_{artifact}.{ext}` | 大产物、结构化交付、审计 |

- 中间产物一律入 `_workspace/`（如 `01_navigator_map.md`、`contract.md`、`qa_report.md`），**保留**便于审计与后续增量。
- 仅最终交付落到用户指定路径（即真实源码改动）。

## 错误处理

- 单个 agent 失败：**重试 1 次**；再失败则**不带其结果继续**，并在汇总里**明确标注缺失项**，不要假装完成。
- 结果相互**冲突**：不要删任一方，**并列保留并标注出处**，交由用户/QA 裁决。
- 构建/测试**失败**：如实贴输出，定位修复或上报；禁止谎报通过。

## 团队规模

| 任务规模 | 成员数 | 每人作业数 |
|---|---|---|
| 小（5–10 作业） | 2–3 | 3–5 |
| 中（10–20） | 3–5 | 4–6 |
| 大（20+） | 5–7 | 4–5 |

> 3 个聚焦的成员胜过 5 个分散的。本团队上限 4 个角色，可多次召同角色处理不同模块。

## 测试场景

**正常流（全栈加一个后台开关）**
1. Phase 0 无 `_workspace/` → 初次执行。
2. navigator 定位后端 option 模型 + 前端设置页消费点 → 地图。
3. 定 `contract.md`（字段名/类型）→ backend 改 model/controller、frontend 改设置页+i18n，**并行**。
4. backend 交付即 QA：三库兼容、JSON 走 common、字段 shape 对齐；frontend 交付即 QA：typecheck/lint/i18n:sync。
5. 汇总 + 真实验证输出。

**错误流（QA 发现边界不一致）**
- QA 比对发现后端返回 `snake_case` 而前端按 `camelCase` 解析 → 标 BLOCKER，SendMessage 回退给对应工程师统一命名 → 复验通过 → 汇总注明该修正。

## 后续执行
- 用户说"重新跑/只改 X/基于上次改进/补充"时：走 Phase 0 的"部分再执行"，仅重召相关 agent，复用 `_workspace/` 其余产物。
- 每次结构性变更后，按需更新 `CLAUDE.md` 的"Harness"变更历史（日期/内容/对象/原因）。

## 执行后（Phase 7 进化）
- 完成后给用户一次反馈机会（"结果或团队/流程要不要调整？"），不强求。
- 同类反馈出现 ≥2 次、某 agent 反复失败、或用户绕开团队手动干，都应提议进化（改技能/改 agent 定义/改本编排器），并记入 `CLAUDE.md` 变更历史。
