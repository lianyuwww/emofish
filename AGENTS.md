# AGENTS.md

Windows-only Electron 记账应用（离线、**绿色文件夹版，不打包 exe**）。环境 PowerShell 5.1，源码/文档/注释均为中文。

## 命令

- 运行应用：`npm start`（= `electron .`）
- 双击启动：`记账本.lnk` → `启动记账本.vbs`（wscript 拉起 `node_modules\electron\dist\electron.exe .`，路径相对脚本，整文件夹可拷走）。不要用 `.bat`（双击必闪 cmd 黑框）
- **无测试框架、无 lint/typecheck**（`package.json` 只有 `start`）。验证方式：`npm start` 看窗口，或 `node -e` 直接跑 `store.js` 的逻辑
- 提交/合并必须带身份（本机未配全局）：`git -c user.name=opencode -c user.email=opencode@local commit ...`

## 架构

- `main.js`：主进程 + IPC + 数据目录决策。`uncaughtException` 写 `%TEMP%\crash.log`（双击闪退先看它）
- `preload.js`：contextBridge 暴露 `window.api`。**IPC 通道名在 main.js / preload.js 两处都要同步改**
- `store.js`：JSON 存储，无原生依赖（刻意避开 better-sqlite3，本机无 VS Build Tools）。统计方法 `netStats()` / `monthlyStats(year,month)` / `yearStats(year)` / `dailyStats(year,month)` / `budgetStats(year,month)` ↔ IPC `stats:net` / `stats:monthly` / `stats:year` / `stats:daily` / `stats:budget`；分类月预算存在分类对象的 `budget` 字段，`setCategoryBudget(id,budget)` ↔ IPC `categories:setBudget`（>0 写入，<=0 删除字段）
- `renderer/`：原生 HTML/CSS/JS + 本地 `echarts.min.js`（ECharts 5.6，不联网）。左侧导航共 5 页：记一笔 / 统计 / 收支走势 / 历史 / 分类管理（`data-view`，导航 handler 在 `app.js`）。主题色变量在 `style.css` 的 `:root`；图表在 `app.js`（`renderPie()` 支出环图 / `renderDetailList()` 支出详情排行 / `renderTrendChart(t, mode)` 单序列走势图（`week`=柱形，`month|year`=面积，可切 支出/收入）。**收支走势页**由 `refreshTrend()` 驱动，按周/按月/按年切换；周视图在前端用 `records:list` 按日聚合，**没有新增 IPC 通道**。分类图标与配色集中在 `CATEGORY_META`（内置分类：彩色圆底 + 白色线性 SVG，`iconSvg()`/`categoryColor()` 取用；自定义分类按列表次序走 `FALLBACK_COLORS`，避免撞色）。储蓄罐水位在 `animateWater()`（SVG 用户坐标，空=184 / 满=14）。**历史页**由 `refreshHistory()` 驱动，支持按日期/金额排序、快捷时间范围（`quickRange()`）、图标类别筛选（`renderHistoryCatPick()`），排序在前端做、无新增 IPC
- 绿色版依赖：`node_modules\electron\dist\electron.exe`（`npm install` 装，dist 二进制自带，无 postinstall 下载）

## 数据与隐私

- 运行时数据是 `data.json`，**含真实账目，已 gitignore，绝不提交**。`crash.log`、`node_modules/`、`*.lnk`、`.idea/` 同样已 gitignore
- 数据目录：`%APPDATA%\记账本\config.json` 里的 `dataDir` 优先 → 默认项目根目录，不弹窗；无写权限才弹窗选目录

## 其他

- 图标：`build/icon.ico`（主进程窗口 / 托盘直接引用；原来随附的生成脚本已移除）
- 两个远端都配了：`origin`（GitHub `em0f1sh/Ledger`）、`gitee`（Gitee `emofish/Ledger`），只推一个另一个会落后
- 中文文件名在 PowerShell 控制台会显示成一串乱码（如 `启动记账本.vbs`），拼路径用 `-LiteralPath` 或通配符，别照抄控制台里的名字
