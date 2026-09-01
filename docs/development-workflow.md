# 开发与验证流程

本文提供从全新克隆到提交和发布的可复现流程。自动化代理先读根目录 [AGENTS.md](../AGENTS.md)，架构与数据契约见 [architecture.md](architecture.md)。

## 环境

- Node.js 24
- npm（使用仓库内 `package-lock.json`）
- Python 3.11 或更高版本
- Playwright 1.55.0（仅开发和验收）

```bash
git clone https://github.com/ibka512/jinriji.git
cd jinriji
npm ci
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install -r requirements-dev.txt
python3 -m playwright install chromium webkit
```

Windows PowerShell 激活命令为 `.venv\Scripts\Activate.ps1`。

## 常用命令

```bash
npm run dev                 # Vite 开发预览，默认 5173
npm run check               # TypeScript 严格检查
npm test                    # Vitest 单元测试
npm run build               # 检查、生产构建、许可和离线缓存清单
npm run preview             # 预览 dist，默认 4173
npm run test:browser:core   # 构建并验证核心流程与页面式事项编辑
npm run test:browser        # 构建并执行全部浏览器验收
```

浏览器脚本只接受 `localhost`、`127.0.0.1` 或 `::1`，并为每个场景建立隔离上下文，不会读取日常浏览器中的今日记数据。

## 测试地图

| 套件 | 覆盖范围 |
| --- | --- |
| Vitest（`src/**/*.test.ts`） | 日期、备份、文档、组织、数据库、迁移、排课和仓储事务 |
| `ui_acceptance.py` | 记录、草稿、待办、备份、离线、错误、旧数据和多窗口冲突 |
| `editor_page_acceptance.py` | 待办／日程页面编辑、深色移动端、返回草稿和历史 |
| `timetable_acceptance.py` | 学期、规则、调课、停课与课程备份 |
| `organization_acceptance.py` | 标签、置顶、批量操作和重复待办 |
| `writing_acceptance.py` | 自动保存、历史、IME、长文、位置和失败恢复 |
| `library_acceptance.py` | 笔记本、模板、链接、图片、表格与页面导航 |
| `maturity_acceptance.py` | 数据保真、规模、布局、启动和持续反馈 |
| `release_acceptance.py` | 可访问性、主题、触摸、减少动态及 Chromium/WebKit 候选流程 |
| `update_acceptance.py` | 真实 Service Worker 失败、重试、激活、离线和数据保留 |

截图默认写入 `test-results/`，该目录不提交。

## 修改流程

1. 检查 `git status`，保留用户已有更改。
2. 从 AGENTS 代码地图进入相关模块，同时阅读模型、仓储、控制器和测试。
3. 明确修改是否影响数据结构、备份、路由、生产依赖或公开行为。
4. 先补充或更新能证明需求的测试，再完成最小实现。
5. 运行 TypeScript、Vitest、生产构建和相关浏览器套件。
6. 浏览器界面变更至少检查 390px 手机、768px 平板、1440px 桌面、深色和减少动态；文字密集页面再检查 200% 字号。
7. 更新 README、AGENTS、架构、版本记录或 `.ibka/` 状态中受到影响的部分。
8. 用 `git diff --check` 和 `git diff` 复核，不提交生成目录或私人数据。

## 数据变更清单

如果确实需要改变持久化结构，提交前逐项确认：

- [ ] Dexie 使用新 schema 版本，不改写旧版本定义。
- [ ] 已发布数据库可以原地升级，失败不会清空数据。
- [ ] 新备份格式继续读取 v1–v6，或明确提供新的兼容矩阵。
- [ ] 导入预览、事务回滚和恢复点已更新。
- [ ] 富文本 `document` 与 `body` 投影保持一致。
- [ ] 版本冲突和多标签页流程仍保留输入。
- [ ] 单元测试覆盖迁移幂等、旧备份和失败回滚。
- [ ] README 的数据与回退说明同步更新。

## 调试提示

- 开发模式没有 Service Worker；验证 PWA 时必须先 `npm run build`，再使用生产预览或浏览器验收脚本。
- 如果页面看起来是旧版本，先确认 URL、构建版本和 Service Worker 控制状态，不要清除用户站点数据。隔离测试上下文可以安全重建。
- IndexedDB 失败和多页面冲突要通过现有测试夹具复现，不要在真实数据上试验。
- Playwright WebKit 不是品牌 Safari；真实 iPhone/iPad、中文输入法和 VoiceOver 结论必须标记为实机测试。
- Vite 的主包体积提示目前已知。只有真实启动数据证明需要时再拆包，不要为了消除提示提前改造架构。

## Pull Request 与提交

提交信息使用简短祈使语气，例如 `feat: use page editor for tasks and schedules`。一个提交应包含实现、对应测试和必要文档，不混入无关格式化。

Pull Request 说明至少包括：用户结果、数据／兼容性影响、实际运行的验证、截图或可访问性证据、未覆盖的设备边界。不要上传真实笔记、课程或完整备份。

## 发布

1. 将 `package.json` 和 `package-lock.json` 版本同步递增。
2. 更新 README 版本徽章、版本记录和 `.ibka/project-state.json`。
3. 执行 `npm run test:browser`、`git diff --check`，确认工作树只包含本次内容。
4. 提交并推送 `main`。
5. 等待 `Quality checks` 与 `Deploy to GitHub Pages` 都成功。
6. 打开线上站点确认版本、关键创建流程、字体、图标和 Service Worker 接管。
7. 将提交、工作流 run、线上验证和剩余真机边界写入验证记录。

Pages 成功但 Quality checks 失败时不算发布完成，不要用旧的本地结果替代远程失败调查。
