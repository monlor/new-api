# 三库兼容速查（SQLite / MySQL≥5.7.8 / PostgreSQL≥9.6）

所有 DB 代码必须在三库**同时**成立。这是 new-api 最容易踩坑、也最难在单库测试中发现的规则。

## 目录
1. 首选 GORM 抽象
2. 裸 SQL 的处理
3. 保留字、布尔、DB 分支变量
4. 迁移（Migration）
5. 禁用清单
6. 自检清单

## 1. 首选 GORM 抽象
- 用 `Create / Find / First / Where / Updates / Delete / Count / Scan` 等 GORM 方法，避免手写 SQL。
- 主键交给 GORM 生成，**不要**写 `AUTO_INCREMENT`（MySQL）或 `SERIAL`（PG）。
- 复杂查询尽量用 GORM 的链式构造 + `Scan(&dest)`，而非字符串拼接。

## 2. 裸 SQL 不可避免时
列名引用符三库不同：PG 用 `"col"`，MySQL/SQLite 用 `` `col` ``。不要硬编码任一种。

```go
// 用 model/main.go 暴露的变量（已按当前驱动初始化）
commonGroupCol  // -> `group`  或  "group"
commonKeyCol    // -> `key`    或  "key"
commonTrueVal   // -> 1 / true
commonFalseVal  // -> 0 / false
```

需要按驱动分支时：
```go
if common.UsingPostgreSQL {
    // PG 写法
} else if common.UsingSQLite {
    // SQLite 写法
} else { // MySQL
    // MySQL 写法
}
```

## 3. 保留字 / 布尔
- `group`、`key` 等保留字列名一律用 `commonGroupCol`/`commonKeyCol`（model 层还有 `logGroupCol`/`logKeyCol` 等场景化变量，沿用既有）。
- 布尔字面量用 `commonTrueVal`/`commonFalseVal`，不要写死 `true`/`1`。

## 4. 迁移（Migration）
- 迁移必须三库都能跑。参考 `model/main.go` 已有的迁移/初始化模式。
- **SQLite 不支持 `ALTER COLUMN`**：改列用"加新列 + 数据迁移"的 add-column workaround，不要 `ALTER COLUMN`。
- 新增列用 `ALTER TABLE ... ADD COLUMN`（三库都支持）。
- JSON 数据列用 `TEXT`，**不要** `JSONB`（PG 专属）。

## 5. 禁用清单（无跨库回退就禁止）
- MySQL 专属：`GROUP_CONCAT`（PG 对应 `STRING_AGG`，需同时提供两种分支）。
- PG 专属操作符：`@>`、`?`、JSONB 系列操作符。
- SQLite：`ALTER COLUMN`。
- 任何 DB 专属列类型而无 `TEXT` 等通用回退。

## 6. 自检清单
- [ ] 能用 GORM 就没写裸 SQL？
- [ ] 裸 SQL 里保留字列用了 `commonGroupCol/commonKeyCol`？
- [ ] 布尔用了 `commonTrueVal/commonFalseVal`？
- [ ] 迁移在 SQLite 上没有 `ALTER COLUMN`？
- [ ] JSON 列是 `TEXT` 不是 `JSONB`？
- [ ] 心里能回答："这段在 SQLite、MySQL、PG 上分别会怎样？"
