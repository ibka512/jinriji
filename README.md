# 今日记

今日记是一款融合便签、待办、日程与课程表的响应式个人生活工具。视觉上结合液态玻璃操作层、莫奈式动态配色和现代和风氛围。

## v0.4

- 站点内置 Noto Serif SC 中文明朝体分片，手机端不再依赖系统字体
- 移除页面彩色渐变，改用灰绿和纸底色、轻纸纹与克制枝影
- 修正夜间容器白色高光，统一纸张、玻璃与胶囊导航的暗色边缘
- Apple 风格胶囊 Tab Bar、圆形快速记录按钮与滑动选中透镜
- 可打断的编辑器进出场、短促页面反馈与减少动态降级
- 320/390px 手机、平板、桌面、横屏、200% 字号与深色模式验收

## 核心能力

- 今日时间流
- 记录卡片与快速记录
- 本周计划和课程表
- 笔记一键转为待办
- 课程卡片与自建课程
- 四套动态主题
- 液态玻璃 / 实色表面切换
- IndexedDB 本地持久化与旧版 localStorage 安全迁移
- JSON 数据导入与导出
- TypeScript 模块化数据层与界面层
- Service Worker 更新提示与离线缓存
- 手机、平板、桌面响应式布局
- 键盘与无障碍基础支持

## 本地运行

```bash
npm install
npm run dev
```

然后访问 `http://localhost:4173`。

## 检查与构建

```bash
npm run check
npm test
npm run build
```

生产文件输出到 `dist/`。浏览器验收使用 Playwright：

```bash
python3 -m pip install playwright
python3 -m playwright install chromium
python3 -m http.server 4173 --directory dist
python3 tests/ui_acceptance.py
```

## 数据安全

首次打开 v0.2 及后续版本时，旧版 `jinriji:entries` 会一次性迁移到 IndexedDB。迁移事务成功后才写入完成标记，旧数据不会删除，并会额外保存在 `jinriji:migration-backup:v1`。导出的 v2 JSON 包含记录、课程、学期、重复规则和设置。v0.4 不改变数据结构，无需新增迁移。

## 部署

推送到 `main` 分支后，GitHub Actions 会运行类型检查、单元测试、生产构建与浏览器验收，并自动把 `dist/` 部署到 GitHub Pages。

## 设计文档

设计原则与令牌见 [design-system.md](./design-system.md)。
