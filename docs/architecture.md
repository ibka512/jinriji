# 今日记架构说明

本文面向继续开发今日记的人和自动化代理，说明代码如何协作，以及哪些边界不能被局部修改破坏。产品使用方法见 [README](../README.md)，执行命令见 [开发与验证流程](development-workflow.md)。

## 总览

```text
index.html / styles.css
        │
        ▼
src/main.ts ── 启动、迁移、仓储和控制器装配
        │
        ▼
AppController ── Navigation / EntryEditor / CourseController / LibraryController
        │                         │
        ├──────── render ─────────┤
        │                         ▼
        └──────── repositories ── Dexie / IndexedDB
                                  │
                                  ├─ records and timetable
                                  ├─ drafts and note history
                                  ├─ notebooks and local assets
                                  └─ settings and recovery point
```

应用是单页、无后端、本地优先的 PWA。Hash 路由承载可恢复的页面位置；临时编辑状态保存在 IndexedDB 草稿，不依赖组件内存维持安全性。

## 启动顺序

`src/main.ts` 是组合根：

1. 初始化交互输入模式和动效降级。
2. 打开 Dexie 数据库并执行旧 localStorage 迁移。
3. 读取记录、主题、课程、笔记本和图片。
4. 创建仓储与控制器，绑定导航和渲染。
5. 初始化披露组件、离线状态和 Service Worker 更新监听。
6. 最后写入 `data-app-ready="true"`；启动失败时显示不清除数据的恢复界面。

新增启动工作时不要绕过此顺序，也不要让非关键服务阻止本地记录打开。

## 分层与职责

### `src/domain`

纯数据类型、日期推导、排课算法、笔记文档 schema、标签和笔记本规则。这里不访问 DOM、Dexie 或网络。可复现的业务规则优先放在此层，并配 Vitest。

### `src/data`

Dexie schema、事务、迁移、备份、草稿和历史。仓储负责版本冲突、跨表原子性和输入校验；UI 不直接写表。

### `src/features`

按功能组织控制器、渲染和样式。`entries/editor.ts` 同时服务笔记、待办和日程：笔记进入记录工作区的写作页，待办和日程进入独立页面式编辑器，课程使用 `CourseController` 的结构化流程。

### `src/ui`

应用级导航、主题、通知、确认、披露、动效和 DOM 工具。`AppController` 是主要协调者，但业务持久化仍由仓储承担。

### `src/platform`

浏览器和 PWA 边界。目前包含离线状态和 Service Worker 注册／更新协调。

## 数据模型和持久化

数据库名为 `jinriji`，当前 schema v3：

- v1：记录、课程、学期、排课规则、单次调整、设置和迁移记录。
- v2：编辑草稿和笔记历史。
- v3：笔记本和本地图片资产。

`Item.kind` 为 `note | task | event`；课程是独立实体。所有可编辑主记录带 `revision`，更新必须验证期望版本。删除大多通过 `deletedAt` 软删除。

不要为了“整理”旧数据而批量改写。新增表或索引时增加 Dexie 版本，并提供从每个已发布版本升级的验证。

## 笔记正文的双表示

富文本笔记包含：

- `document`：经过白名单 schema 验证的 Tiptap JSON，是真源。
- `body`：由 `documentText()` 派生的纯文本，用于搜索、摘要和旧版兼容。

保存结构化正文时必须让两者一致。普通 `updateItem` 会拒绝只用新 `body` 覆盖已有 `document` 的修改。旧纯文本通过 `textDocument()` 按字面转换，不解释 Markdown 标点。

图片不是远程 URL，而是 `assets` 表中的有界 data URL；文档只保存 `assetId`。保存、导入和备份都要验证引用完整性。

## 草稿、历史和冲突

- 待办和日程停止输入约 600ms 后保存恢复草稿，显式“保存”才创建或更新正式记录。
- 笔记自动提交到正式记录，同时保留恢复草稿和有限历史。
- 写作历史每篇最多 20 份，全站最多 100 份。
- `revision` 不一致时保留输入，允许重新打开或另存副本，绝不静默覆盖。
- 页面返回、可见性变化和更新激活前都会尝试刷新草稿或提交笔记。

## 课程与排课

课程、学期、重复规则和单次例外分表保存。课次由规则按需派生，不预先复制整个学期。所有日期计算以学期时区和第一周为基准；单双周由 `intervalWeeks` 表示。

修改规则前要验证已有例外仍在新规则范围。课程与首个时段创建、批量修改和备份导入必须在事务中完成。

## 备份与迁移

当前导出 v6，读取 v1–v6。v6 包含记录、课程、学期、规则、例外、笔记本及正文引用图片；草稿、历史和恢复点不导出。导入是完整替换，不是合并，但会先在同一个事务里建立一个恢复点。

改变模型时必须同时检查：

1. `domain/models.ts` 类型；
2. `data/database.ts` schema；
3. `data/backup.ts` 新旧格式校验；
4. 仓储事务与版本递增；
5. 迁移、导入失败回滚和旧备份测试；
6. README 数据说明与 AGENTS 契约。

## 路由和编辑页面

`Navigation` 解析并生成 Hash 路由，串行执行切换，保存页面滚动。笔记新建／编辑有可恢复路由；待办和日程使用当前计划页之上的页面编辑状态，并在浏览器历史中放置临时标记。切换侧栏时替换该临时历史，防止产生一次无视觉变化的返回。

改动编辑器时必须验证：保存、Escape、浏览器返回、侧栏跳转、刷新恢复、冲突、存储失败、移动软键盘和 200% 字号。

## 样式和动效

全局语义 token 位于 `styles.css`，主题映射位于 `src/ui/theme.ts`。功能 CSS 与功能代码放在一起，`src/ui/refinements.css` 处理跨功能收尾，`src/ui/motion.css` 统一动效。

内容表面使用实色纸张，玻璃只用于导航和操作层。不要新增孤立的十六进制主题色；先扩充语义 token，并检查四主题深浅色、强制颜色和降低透明度。动画复用既有时长与缓动，不使用 `transition: all`，减少动态时取消空间位移。

## PWA 与发布

开发模式不注册 Service Worker。`npm run build` 先构建，再生成第三方许可并将版本化 JS/CSS 注入 `dist/sw.js`；缓存名由 `package.json` 版本和构建指纹组成。不要直接编辑 `dist/sw.js`。

Service Worker 更新先完整下载新 shell，失败时继续使用旧缓存；准备完成后由用户确认激活。任何缓存策略调整都要运行 `tests/update_acceptance.py`。
