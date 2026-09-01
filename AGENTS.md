# 今日记开发代理说明

本文件是自动化开发代理进入仓库后的首要入口。开始修改前，先读本文件，再按任务读取 [架构说明](docs/architecture.md) 和 [开发与验证流程](docs/development-workflow.md)。用户文档与产品边界见 [README](README.md)。

## 项目目标与当前状态

今日记是本地优先的便签、笔记、待办、日程和课程表 PWA。技术栈为 TypeScript、Vite、原生 HTML/CSS、Dexie 和 Tiptap；没有后端、账户或云同步。

- 线上站点：<https://ibka512.github.io/jinriji/>
- 发布分支：`main`
- 当前版本：以 `package.json` 为唯一版本来源
- 数据库：Dexie schema v3
- 完整备份：v6，继续读取 v1–v5
- 项目进度：`.ibka/project-state.json` 与 `.ibka/module-plan.json`

## 首次接手

```bash
npm ci
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install chromium webkit
npm run check
npm test
npm run build
```

开发预览使用 `npm run dev`。生产构建预览使用 `npm run preview`。完整浏览器验收可直接运行 `npm run test:browser`；只验证核心与页面式事项编辑可运行 `npm run test:browser:core`。

## 修改前必须确认的契约

1. **不得清空或重建用户数据。** 旧 IndexedDB、localStorage 迁移数据、草稿、历史、图片和恢复点必须保留。
2. **结构化笔记以 `document` 为真源，`body` 是搜索投影。** 修改文档时必须同步生成 `body`，不能把富文本记录静默降为纯文本。
3. **记录更新使用 `revision` 乐观锁。** 冲突必须保留当前输入并提示，不得最后写入者静默覆盖。
4. **跨表修改必须使用 Dexie 事务。** 课程、排课、导入、批量整理、图片引用和版本历史不能部分成功。
5. **删除默认为软删除。** 不要移除最近删除、旧备份读取或迁移路径。
6. **数据库或备份格式变更属于高风险修改。** 必须同时设计迁移、旧格式读取、回退和测试；没有明确需求时不要升级版本。
7. **本地优先边界不变。** 不新增账户、远程 API、分析、云存储或遥测，除非用户明确批准。
8. **生产依赖需要明确授权。** 先检查现有能力；开发工具依赖也要说明理由并保持可复现。
9. **视觉沿用现有设计系统。** 纸面用于内容，玻璃用于导航和操作层；颜色只使用语义 token；深色、减少动态、降低透明度、强制颜色和 200% 字号必须可用。
10. **GitHub Pages 使用仓库子路径。** 保持 Vite `base: "./"` 和相对资源路径，不要写死站点根路径。

## 代码定位

| 任务 | 主要入口 |
| --- | --- |
| 启动与依赖装配 | `src/main.ts` |
| 主页面、事件与刷新 | `src/ui/app-controller.ts` |
| Hash 路由与返回历史 | `src/ui/navigation.ts` |
| 记录、待办、日程编辑 | `src/features/entries/editor.ts` |
| 富文本编辑 | `src/features/entries/rich-writer.ts`、`src/domain/note-document.ts` |
| 记录数据与事务 | `src/data/repositories.ts`、`src/data/writing-repository.ts` |
| 课程和排课 | `src/features/courses/`、`src/data/timetable-repository.ts` |
| 数据库 schema | `src/data/database.ts` |
| 备份与旧数据 | `src/data/backup.ts`、`src/data/migrate-local-storage.ts` |
| 主题与视觉 token | `styles.css`、`src/ui/theme.ts` |
| 功能样式 | 对应 `src/features/**.css`，最后由 `src/ui/refinements.css` 收尾 |
| PWA 更新 | `src/platform/service-worker.ts`、`public/sw.js`、`scripts/precache.mjs` |
| 单元与浏览器验收 | `src/**/*.test.ts`、`tests/*.py` |

## 实施纪律

- 先阅读相关模型、仓储、控制器、渲染和测试，寻找现有惯例；不要通过重复状态或特殊判断掩盖根因。
- 做满足当前需求的最小完整改动，不顺手重构无关模块。
- 保持 `domain → data → features/ui` 的方向；视图不直接操作 Dexie。
- 用户可见文本使用简体中文，功能和错误信息保持短、明确、可恢复。
- 动效只用于反馈、状态变化和空间连续；复用 140/180/240ms token，输入和键盘操作不等待动画。
- 不手工编辑 `dist/`。运行 `npm run build` 生成生产产物和构建指纹缓存。
- 不提交 `node_modules/`、`.venv/`、`dist/`、测试截图或私人备份。
- 不在测试中使用真实用户浏览器数据；所有 Playwright 流程只允许本机 loopback 地址。

## 验证要求

普通逻辑修改至少运行：

```bash
npm run check
npm test
npm run build
```

界面、路由、草稿、存储或 PWA 修改还必须运行相关 Playwright 套件。提交前优先执行：

```bash
npm run test:browser
git diff --check
```

不得声称测试通过，除非实际执行。最终说明应列出执行过的命令、未覆盖的真实设备边界以及是否提交／推送／部署。

## 发布规则

- 版本在 `package.json` 和 `package-lock.json` 中同步更新；设置页、Service Worker 缓存名和构建产物会从该版本派生。
- 推送 `main` 会并行触发 Quality checks 和 GitHub Pages；两者都成功才算发布完成。
- Pages 成功不代表质量工作流成功。发布后还要检查线上版本、核心页面、字体、图标和 Service Worker 接管。
- 未经用户明确要求，不提交、推送、创建发布或修改仓库远程设置。

## 交接要求

功能、数据契约、测试命令或发布方式发生变化时，同步更新本文件或对应文档。大版本进度还应更新 `.ibka/` 状态。不要把临时推理、机器路径或个人数据写入仓库。
