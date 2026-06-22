---
name: upstream-sync
description: Assess and selectively port upstream (QuantumNous/new-api) changes into this fork. Assessment-FIRST, never blind-merge. Scope is primarily bug fixes (especially relay/channel adapter fixes), plus non-conflicting features. Reads FORK_CHANGES.md to judge conflict impact; large changes that conflict with our customizations are documented in an assessment file and NOT merged. Use whenever the user asks to "合并上游/同步上游/拉上游更新/评估上游变更/sync upstream/port upstream fixes".
---

# upstream-sync — 上游变更评估与选择性移植

本仓库是 [QuantumNous/new-api](https://github.com/QuantumNous/new-api)（`git remote: upstream`）的 fork。本 skill 把「评估 → 筛选 → 选择性手动移植 → 验证 → 回写 FORK 文档」固化成可重复流程。**核心原则:评估优先,绝不无脑 `git merge upstream/main`**(那会拖进 60+ 个含 feature 的提交并撞上我们的定制)。

## 铁律

1. **永远先评估,产出评估文档,等用户确认范围再动手。**
2. **默认范围 = bug fix**(`fix:` 提交)。Feature 仅在「不冲突」时才考虑。
3. **渠道/relay 适配器的修复优先考虑合并**——`relay/channel/**`、`relay/**` 的 fix 通常是上游供应商对接的正确性修复,价值高、且与我们「计费/UI/订阅」定制几乎不重叠。
4. **必读 [FORK_CHANGES.md](../../../FORK_CHANGES.md)** 判断影响面:即使文本能自动合并,语义上是否撞我们的定制要靠它判断。
5. **大且与我们当前改动冲突的 → 只写进评估文档说明「不合并 + 原因」,不动手。**
6. **不冲突的 feature → 可以考虑合并**(列在评估文档,标注价值/风险,由用户拍板)。
7. 全程在专用分支,**不碰 main**;不 commit / push,除非用户明确要求(见 `feedback_push_after_confirm`)。

---

## 阶段一:评估(Assessment)

### 1. 拉上游 + 算分叉

先看 [FORK_CHANGES.md](../../../FORK_CHANGES.md) 顶部的「上游同步水位线」——上次评估到哪个 commit,本次只需看其之后的提交(`git log <水位线>..upstream/main`),避免重复评估已处理过的。

```bash
git fetch upstream
B=$(git merge-base HEAD upstream/main)
echo "ahead:  $(git rev-list --count $B..HEAD)"     # 我们领先(=我们的定制)
echo "behind: $(git rev-list --count $B..upstream/main)"  # 上游新增(=候选)
git log -1 --format='base: %h %ci %s' $B
```
> 注意:`git fetch upstream` 偶发 `early EOF`,重试即可;失败时 `upstream/main` ref 可能陈旧,`behind` 不可信,务必重 fetch 成功后再评估。

### 2. 列候选,先筛 bug fix

```bash
# 默认范围:bug fix(最旧→最新,顺序便于后续按序 apply)
git log --reverse --oneline $B..upstream/main --grep='^fix' -E
# 同时单独列 feature/refactor,供「不冲突可考虑」环节
git log --reverse --oneline $B..upstream/main --grep='^feat' -E
# 每个候选看改了哪些文件
git log --reverse $B..upstream/main --grep='^fix' -E --format='%n### %h %s' --name-only
```

### 3. 算冲突面(我们改过 vs 上游改过的交集)

```bash
git diff --name-only $B HEAD          | sort -u > /tmp/ours.txt      # 我们碰过的文件
# 单个候选:它的文件是否落在 /tmp/ours.txt 里
git show <sha> --name-only --format='' | grep -v '^$' | while read f; do
  grep -qxF "$f" /tmp/ours.txt && echo "⚠ OVERLAP $f" || echo "clean   $f"
done
```
真冲突(非仅文件重叠)用整体模拟确认:
```bash
git merge-tree --write-tree HEAD upstream/main >/tmp/mt.txt 2>&1 || echo "有冲突"
tail -n +2 /tmp/mt.txt | sed '/^$/q' | awk '{print $4}' | sort -u   # 真冲突文件清单
```

### 4. 读 FORK_CHANGES.md 判语义影响

对每个 overlap / 落在我们定制区(计费/billing_type、订阅、钱包货币、邀请、用户批量、主题、i18n、定价页)的候选,**对照 FORK_CHANGES.md 对应小节**判断:
- 上游这次改动是否触碰我们重写过的逻辑?
- 「文本自动合并干净」≠「语义正确」——订阅/计费尤其要人工核对新 schema/字段是否与我们的定制对齐。

### 5. 分级 + 产出评估文档

把每个候选归入下表,写到 **`FORK_SYNC_ASSESSMENT.md`**(仓库根,临时文档,sync 完成后可删):

| 级别 | 含义 | 处置 |
|---|---|---|
| 🟢 **Port** | bug fix,clean(不碰我们文件),**含 relay/channel 优先** | 移植 |
| 🟡 **Port-with-care** | bug fix,与我们文件重叠但改动小、语义兼容 | 手动逐行移植 |
| 🔴 **Skip(冲突大)** | 改动大 **且** 撞我们的定制(对照 FORK_CHANGES.md) | **不合并**,写明文件 + 撞哪段定制 + 原因 |
| ⚪ **Feature(不冲突)** | feature 但不碰我们文件 | 可考虑,标价值/风险,用户拍板 |
| ❌ **Not applicable** | 依附我们没有的功能(如 channel 58 Advanced Custom)、classic 主题、重复/squash 残留 | 跳过,一句话写明原因 |

评估文档必须显式列出 🔴 项(文件 + 冲突点),这是本 skill 的关键交付物。**停在这里,把评估文档交给用户确认范围。**

---

## 阶段二:移植(Port,用户确认后)

### 1. 开专用分支
```bash
git switch -c chore/sync-upstream-$(date +%Y%m%d)   # 注:脚本里无 Date.now,手动填日期
```

### 2. 按序手动移植(`git apply --3way`,非 `git merge`)
顺序:**clean 后端 → clean 前端 → overlap 手解**。同一文件被多个 fix 改时按时间顺序 apply。
```bash
git show <sha> -- <只要的路径...> | git apply --3way --whitespace=nowarn
```
- ✅ 干净应用即可。
- ⚠️ `Applied with conflicts` → 文件进 unmerged 态,**人工解冲突标记**;若发现它在塞我们没有的功能(如给不存在的 channel 58 加配置),`git checkout HEAD -- <file>` 丢弃,该候选转 ❌ 并在评估文档记一笔。
- 范围控制:`git show` 后只列你要的路径,排除 classic 主题、无关 i18n 等。

### 3. i18n key(若候选含翻译)
`sync-i18n.mjs` 是「以 en.json 为基准向其它 locale 同步」,**不从源码抽 key**。所以:
1. 先把候选引入的、且我们代码 `t('...')` 真引用的新 key 加进 `en.json`;
2. 再 `cd web/default && bun run i18n:sync` 同步到 zh/zh-TW/fr/ru/ja/vi。

**⚠️ 致命坑:locale 文件不是扁平的,而是 `{ "translation": { ...所有 key... } }`**(CLAUDE.md 说的"flat JSON"指的是 `translation` 命名空间**内部**无嵌套,不是文件顶层扁平)。新 key 必须写进 `en.translation`,**不能写到文件根**——根级 key 会被 i18next 当成"命名空间",`t('key')` 永远解析不到,非英文 locale 全回退英文,且 sync 会把这个错误结构传播到全部 locale。脚本里务必 `obj.translation[key] = value`,绝不能 `obj[key] = value`。核对:
```bash
node -e "const o=require('./src/i18n/locales/en.json'); console.log('顶层应只有 translation:', Object.keys(o).filter(k=>k!=='translation'))"
```
注意 sync 会重新注入 obfuscated 的 `footer.newapi.projectAttributionSuffix`(语义等价,无害)。

### 4. 真跑验证(区分「新引入」与「既有」失败)
```bash
go build ./... && go vet ./...                      # 后端编译/静态检查
go test ./model/ ./service/ ./pkg/billingexpr/ ...  # 改到的包 + 相关包
cd web/default && bun run build                      # 前端生产构建(真证据)
bun run typecheck                                    # 注:fork 既有 tsc 债务,rsbuild 不跑 tsc
```
**任一失败,先判断是不是我们引入的**:`git stash -u` 回到 HEAD 跑同一条命令,若 HEAD 也失败 = 既有问题,与本次移植无关;`git stash pop` 恢复。报告时明确区分。

### 5. 回写 FORK 文档(Rule 10)
- 已 port 的 fix → 记进 **FORK_CHANGES.md** 的「已 port 的上游 bug 修复」表(commit + 修复 + 文件),下次 sync 遇到这些文件冲突可直接取上游版。
- 上游已吸收我们某项定制的 → 从 FORK_CHANGES.md 删掉对应条目。
- **更新「上游同步水位线」** —— 把 FORK_CHANGES.md 顶部那行改成本次评估到的 `upstream/main` 顶端 commit:
  ```bash
  git log -1 --format='%h — %ci — %s' upstream/main   # 取这行填进水位线
  ```
  即便本次只 port 了部分 fix、跳过了一堆 🔴/❌,水位线也记到「评估覆盖到的最新 commit」——因为那些跳过项已评估过、有结论,下次不必再看。

---

## 阶段三:收尾
- **不 commit / 不 push**,除非用户说。把结果汇总:已 port N 个 / 跳过哪些(🔴 + ❌ 各自原因)/ 既有失败(非本次引入)。
- 询问是否按 fix 分组提交,或停在分支等 review。
- 评估文档 `FORK_SYNC_ASSESSMENT.md` 可保留供 review,或确认后删除。

## 反模式(别做)
- ❌ `git merge upstream/main`(拖进全部 feature + 撞定制)。
- ❌ 不读 FORK_CHANGES.md 就判「自动合并干净 = 安全」。
- ❌ 给我们不存在的功能(channel 58 等)硬加死代码只为对齐上游 diff。
- ❌ 把 🔴 大冲突项硬塞进来——只评估、不合并、写文档。
- ❌ 只看「编译过」不真跑 build/test;或把既有失败算作本次回归。
