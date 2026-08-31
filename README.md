<p align="center">
  <img src="./public/icons/app-192.png" width="112" height="112" alt="今日记图标：和纸上的朱红圆相与日轮" />
</p>

<h1 align="center">今日记</h1>

<p align="center">在一处安静地记录今天、完成事情、安排课程。</p>

<p align="center">
  <a href="https://ibka512.github.io/jinriji/"><strong>在线使用</strong></a> ·
  <a href="#开始使用">开始使用</a> ·
  <a href="#本地开发">本地开发</a> ·
  <a href="./docs/version-history.md">更新记录</a> ·
  <a href="https://github.com/ibka512/jinriji/issues">反馈问题</a>
</p>

<p align="center">
  <a href="https://github.com/ibka512/jinriji/actions/workflows/ci.yml"><img src="https://github.com/ibka512/jinriji/actions/workflows/ci.yml/badge.svg" alt="Quality checks" /></a>
  <a href="https://github.com/ibka512/jinriji/actions/workflows/pages.yml"><img src="https://github.com/ibka512/jinriji/actions/workflows/pages.yml/badge.svg" alt="GitHub Pages" /></a>
  <img src="https://img.shields.io/badge/version-0.7.1-667b68" alt="版本 0.7.1" />
</p>

今日记是一款将便签、备忘录、待办、日程与课程表放在一起的个人工具。无需注册，打开浏览器就能开始；记录保存在当前设备的浏览器中，也可以安装到主屏幕使用。

界面以和纸、中文衬线体和低饱和配色营造安静的阅读氛围，导航与操作层使用液态玻璃质感。手机采用胶囊 Tab Bar 与圆形新建按钮，平板和宽屏采用侧栏布局，浅色与深色模式跟随系统。

> **在线地址：[ibka512.github.io/jinriji](https://ibka512.github.io/jinriji/)**
>
> 今日记目前是本地优先的 Web 应用，**不提供账户、云同步或系统提醒**。重要内容请定期导出备份。

## 界面预览

下图来自应用实际运行界面。内容是隔离环境中的演示记录，不会写入你的浏览器数据。

<img src="./docs/screenshots/desktop-today.png" width="1200" alt="宽屏浅色模式：今日安排、待办、最近记录与月历" />

<p align="center">
  <img src="./docs/screenshots/mobile-notes.png" width="300" alt="手机浅色模式：标签、置顶记录与胶囊导航" />
  &nbsp;&nbsp;
  <img src="./docs/screenshots/mobile-courses-dark.png" width="300" alt="手机深色模式：课程日列表与选中状态的导航图标" />
</p>

## 可以做什么

| 场景 | 已有能力 |
| --- | --- |
| 看今天 | 真实日期、接下来的安排、今日待办、最近记录与明日预览 |
| 随手记录 | 便签、待办、日程互相转换；搜索标题、正文和标签；置顶与标签筛选 |
| 整理事项 | 待办按逾期、今天、以后和未设日期分组；批量置顶、加标签、完成和删除 |
| 重复待办 | 按日、周或月重复；完成后生成下一次，支持安全撤销 |
| 安排课程 | 学期、周次、单双周、多个上课时段、单次调课与停课；课程可关联记录 |
| 继续上次 | 记录草稿恢复、返回时保留筛选与列表位置、编辑冲突提示、最近删除 |
| 随身使用 | 手机／平板／桌面布局、离线编辑、主屏幕安装、键盘操作与减少动态适配 |
| 管理数据 | JSON 完整备份、导入预览、事务回滚及最近一次恢复点 |

## 开始使用

1. 打开[今日记](https://ibka512.github.io/jinriji/)，点击圆形 **＋** 或“记一笔”，选择便签、待办或日程。
2. 在“记录”中查看和搜索内容；编辑时添加标签，卡片右上角可置顶。“整理”可批量处理当前筛选结果。
3. 在“计划”中切换 **本周／待办／课程表**。排课顺序是：新建学期 → 添加课程 → 打开课程详情 → 添加时段。
4. 在“设置”中选择主题、导出备份，或查看最近删除和离线页面状态。

重复待办需要设置日期。它按原计划日期推进，每次完成只生成一个未来事项，逾期时跳过遗漏日期；月末任务在短月收拢，之后恢复原日号。若自动生成的下一次已被编辑、删除或完成，撤销先前的完成会被阻止，避免覆盖后续内容。

课程单双周从学期第一周计算。学期保留创建时的时区，课程表使用学期当地时间；首页及本周安排使用设备时间。点击某个具体课次可只调整这一节，不会改变其他课次。

### 安装、离线与更新

- **iPhone / iPad**：在 Safari 中打开站点，通过分享菜单选择“添加到主屏幕”。
- **Android**：在支持安装的浏览器中选择“安装应用”或“添加到主屏幕”。
- **桌面**：在支持安装的浏览器中使用地址栏或菜单中的安装入口，也可直接作为普通网页使用。

菜单名称和安装能力由浏览器决定。首次使用请保持联网，让页面资源完成缓存；可在设置中确认离线页面是否就绪。已缓存页面支持离线记录和编辑，未缓存的字体字形可能使用系统字体回退。

出现“新版本已经准备好”时，先保存当前输入，再点击“更新”。更新不会主动清除记录。操作系统可能缓存旧的主屏幕图标，图标刷新时间取决于平台；不要为了刷新图标直接清除站点数据或卸载应用，请先导出备份。

### 常用快捷键

| 快捷键 | 操作 |
| --- | --- |
| `⌘ / Ctrl + K` | 快速记录 |
| `⌘ / Ctrl + Enter` | 保存编辑内容 |
| `N` | 按当前页面新建 |
| `/` | 搜索记录 |
| `Alt + 1 / 2 / 3 / 4` | 切换今日、记录、计划、设置 |
| `?` | 查看快捷键帮助 |

单键快捷操作在文字输入时不会触发。分段切换与主题选择也支持键盘操作。

## 数据与隐私

记录和课程保存在 **IndexedDB**；部分设置与记录草稿保存在 **localStorage**。应用没有账户服务器，不把你的记录上传到云端。站点资源由 GitHub Pages 提供，正常访问仍会产生托管平台的网络请求。

本地保存不等于永久备份，也不等于加密保险箱。不同设备、浏览器或站点地址的数据不会自动共享；清除浏览器数据、隐私模式结束或系统回收存储都可能造成丢失。重要内容请通过“设置 → 导出备份”保存为独立文件。

- 当前导出 **v4 JSON**，包含记录、课程、学期、排课规则、单次调整、主题，以及置顶、标签和重复待办信息；可导入 v1 / v2 / v3 / v4。
- **导入是替换，不是合并。** 导入前会校验并预览，确认后在同一个事务中建立恢复点并替换数据，失败则回滚。旧备份没有的排课数据会被清空，确认前请阅读预览。
- 仅保留最近一个本地恢复点。草稿和恢复点不包含在导出文件中，也无法抵御浏览器数据清除。
- 旧版 localStorage 原始数据及迁移备份会保留。新版本不批量改写旧记录；回退到旧应用前，请先保留最新格式的独立备份。
- 单个备份最大 10 MB；记录与课程各最多 20,000 条、学期 100 个、排课规则 2,000 条、单次调整 10,000 条。

## 设计与图标

今日记使用本地加载的 **Noto Serif SC**，使手机也能呈现中文衬线标题；正文和操作文字保持清晰易读。玻璃质感用于导航与操作层，正文采用较实的纸张表面，并尊重系统减少动态和降低透明度偏好。

当前提供四套经过调校的和风主题，以语义色令牌联动界面，取意于莫奈配色。**当前尚未实现从壁纸自动取色的完整 Monet 算法。** 计划页分段切换参考 [IBKA UI-001](https://github.com/ibka512/ibka-ui-designs/tree/main/components/segmented-switch)。

软件图标采用用户提供的朱红圆相与日轮，保留和纸纹理。图标母版经过构图适配，提供 favicon、Apple Touch Icon 与 PWA 图标；PNG 标记区域保留系统裁切安全边距。图标不会重新出现在侧栏文字品牌旁。

- [设计规范](./design-system.md)
- [图标来源、尺寸及再生成方式](./docs/branding/README.md)
- [历史更新记录](./docs/version-history.md)

## 本地开发

使用 **Node.js 24** 与 npm，与 GitHub Actions 保持一致：

```bash
git clone https://github.com/ibka512/jinriji.git
cd jinriji
npm ci
npm run dev
```

访问终端显示的 Vite 地址，默认是 `http://localhost:5173`。开发模式不注册 Service Worker，避免旧缓存影响热更新。

```bash
npm run check   # TypeScript 类型检查
npm test        # 单元测试
npm run build   # 类型检查、生产构建与离线资源清单
npm run preview # 预览 dist/，默认端口 4173
```

技术栈为 **TypeScript + Vite + 原生 HTML/CSS + Dexie**，无需后端服务。主要目录：

```text
src/
  domain/       日期、待办、课程与备份数据类型
  data/         IndexedDB 仓储、迁移、草稿和备份
  features/     记录、课程及页面功能
  platform/     离线状态和 Service Worker 注册
  ui/           导航、主题、弹窗和界面控制
public/         图标、字体、Manifest 和 Service Worker
scripts/        构建后离线清单、favicon 打包
tests/          单元测试和浏览器验收
docs/           界面预览、图标母版和历史说明
```

### 浏览器验收

验收脚本使用隔离的 Chromium 浏览器数据，只允许对本地站点运行。首次运行需准备 Python 3 和 Playwright：

```bash
python3 -m venv .venv
source .venv/bin/activate
python3 -m pip install playwright==1.55.0
python3 -m playwright install chromium
npm run build
python3 -m http.server 4173 --bind 127.0.0.1 --directory dist
```

保持服务运行，在另一个已激活相同 Python 环境的终端执行：

```bash
python3 tests/ui_acceptance.py
python3 tests/timetable_acceptance.py
python3 tests/organization_acceptance.py
```

现有验收包含 76 项单元测试和 20 组 Chromium 浏览器流程，覆盖记录、课程、整理、备份、离线及多标签页冲突，也检查多端尺寸、深色模式、减少动态与大字号。截图输出到 `test-results/screenshots-v0.7/`。这些结果不等同于真实 iPhone / Safari 验证。

### 部署

推送到 `main` 后会触发两个独立工作流：

- [Quality checks](https://github.com/ibka512/jinriji/actions/workflows/ci.yml)：类型检查、单元测试、生产构建和浏览器验收。
- [Deploy to GitHub Pages](https://github.com/ibka512/jinriji/actions/workflows/pages.yml)：构建并部署 `dist/`。

两条工作流并行运行，Pages 成功不代表质量验收已通过；发布时需确认两者均成功。构建使用相对资源路径，可部署在 GitHub Pages 的仓库子路径下。Service Worker 预缓存页面、版本化 JS/CSS 和图标，新版本等待用户确认后激活。

## 当前边界与反馈

当前不支持云同步、系统通知提醒、教务系统导入、跨夜课程或跨学期调课。学期和排课表单会在离开前保护未保存输入，但不提供刷新后的自动恢复；记录编辑器支持草稿恢复。真实 iPhone / Safari 和各手机系统的主屏幕图标效果仍需实机验证。

欢迎通过 [Issues](https://github.com/ibka512/jinriji/issues) 提交问题。请注明设备、浏览器版本、复现步骤和预期结果；截图与备份请先去除个人信息，勿上传私人笔记或完整个人备份。

## 来源与许可

- Noto Serif SC 使用 [SIL Open Font License 1.1](./public/fonts/noto-serif-sc/OFL.txt)。
- UI-001 的来源与 MIT 许可保留在 [第三方声明](./public/third-party-notices.txt)。
- 图标由项目用户提供，经构图适配后用于本项目；未单独授予第三方品牌使用许可。
- 仓库目前没有为项目整体指定开源许可证。公开可见不代表已授权任意再分发；第三方组件遵循各自许可。
