---
name: frontend-dev
description: Workflow for building and modifying new-api's React 19 default frontend (web/default) — components, hooks, routing, data fetching, dashboard/admin UI, and keeping i18n synced across all locales. Use whenever you touch files under web/default/ (or web/classic/ when explicitly asked). Enforces Bun usage, i18next conventions, and TypeScript/lint gates.
---

# frontend-dev — 前端开发工作流（web/default）

默认前端：React 19 + TypeScript + Rsbuild + Base UI + Tailwind。包管理器 **Bun**（Rule 3）。`web/classic/`（React 18 + Vite + Semi）仅在明确要求时碰。

## 工作流

1. **定位** —— 先看同目录/同模块现有组件，沿用其结构、命名、Tailwind 风格、Base UI 用法。改前先 `Read`。
2. **数据获取** —— 用 `@tanstack/react-query`；路由用 `@tanstack/react-router`；表格 `@tanstack/react-table`/`react-virtual`；图表 `@visactor/react-vchart`。沿用既有 hook 模式。
3. **接口契约对齐** —— 与 go-backend-engineer 协作时，先确认 API 响应字段名/类型/可空性再写 hook，避免 shape 不一致。契约不清就向后端 agent 求证。
4. **i18n（硬性）** —— 见下。
5. **质量门禁** —— `bun run typecheck` + `bun run lint`，必要时 `bun run build:check`。
6. **交接** —— 改了哪些组件/hook、依赖哪些后端字段、i18n 是否已 sync，交给 qa-reviewer。

## i18n 规范

- 文案用 `useTranslation()` 的 `t('English source string')`——**key 就是英文源串**（flat JSON）。
- 语言：en(base) / zh(fallback) / zh-TW / fr / ru / ja / vi，文件在 `web/default/src/i18n/locales/{lang}.json`。
- 新增或改动文案后**必须**同步：
  ```bash
  cd web/default && bun run i18n:sync
  ```
  确保所有 locale 都有该 key，不留漏翻。

## 常用命令（均在 web/default/）

```bash
bun install            # 安装依赖
bun run dev            # 开发服务器 (rsbuild dev)
bun run typecheck      # tsc -b
bun run lint           # eslint
bun run build          # 生产构建
bun run build:check    # tsc -b && rsbuild build
bun run i18n:sync      # 同步所有 locale
```

> 整库构建也可用根目录 `make dev-web`（同时起 default+classic）/ `make build-frontend`。

## 提交前必过

- [ ] `bun run typecheck` 通过（无 TS 报错）。
- [ ] `bun run lint` 通过。
- [ ] 新增/改动文案已 `bun run i18n:sync`，各 locale 无缺失。
- [ ] 用的是 Bun，不是 npm/yarn/pnpm。
- [ ] 组件/样式与同目录既有风格一致。

## 后续/再次执行

存在 `_workspace/` 既有产物或用户反馈时，先读取再增量修改。
