# dsh-token-panel

<div align="center">

**DeepSeek Harness（DSH）插件：侧边栏 Token 用量统计**

**覆盖：全历史会话扫描 × 用量柱状图 × 模型刻度环 × 活跃热力图 × 会话与供应商统计 × 深浅双主题**

[![Version](https://img.shields.io/badge/Version-v1.1.0-1D5FD0?style=for-the-badge)](#版本历史)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-0E7C86?style=for-the-badge)](#安装)
[![图表](https://img.shields.io/badge/图表-手写SVG-F59E0B?style=for-the-badge)](#设计与实现)
[![License](https://img.shields.io/badge/License-MIT-10B981?style=for-the-badge)](#许可与致谢)

[English](README.en.md) | **简体中文**

</div>

---

一个装进 DSH 侧边栏的「Token 记账本」。扫描 DSH 会话记录，把每一枚 token 按天、按小时、按模型、按会话、按供应商算清楚：今天用了多少、哪个模型最费、哪天是巅峰。**纯本地扫描、本地聚合、本地渲染**——数据不出本机。

> ⚠️ 非官方社区插件，与 DeepSeek 官方无关联。

## 📸 界面预览

| 菜单入口 | 主界面 |
|:---:|:---:|
| <img src="assets/menu-entry.png" width="400" alt="菜单入口"> | <img src="assets/panel-light.png" width="400" alt="主界面"> |

| 折线图 Tooltip | 会话与供应商统计 |
|:---:|:---:|
| <img src="assets/panel-tooltip.png" width="400" alt="Tooltip"> | <img src="assets/panel-tables.png" width="400" alt="统计表"> |

深色主题：<img src="assets/panel-dark.png" width="600" alt="深色主题">

## ✨ 功能特性

| 模块 | 说明 |
|------|------|
| 🧭 **原生菜单** | 侧边栏「插件」下方的原生菜单项，风格与内置菜单完全一致，点击进入主区域页面 |
| 📅 **时间范围** | 今天 / 昨天 / 近 7 天 / 近 30 天 / 本月 / 上月 / 全部 / 自定义区间（起止自动校验防倒序）；**默认今天**；滚动时日期栏**紧贴标题**冻结；日期栏下方的全部查询都随所选区间重算 |
| 🔥 **活跃热力图** | GitHub 贡献网格风格：周列 × 星期行，五档色阶按当日用量着色，月份之间留白分隔，最近一年 |
| 📈 **用量趋势** | 堆叠柱状图：一根柱一个模型，柱高 = 当期用量，峰值直接标数；悬停 Tooltip 跟随鼠标；图例可点击显隐 |
| 🍩 **模型用量** | 刻度环仪表盘：100 刻 = 100%，每 10 刻一枚锚点；占宽 40%，右侧明细含**缓存命中量与命中率** |
| 📊 **会话统计** | 逐会话名称 / 轮次 / 消息 / Token / 命中 / 命中率 / 占比 / 模型明细 / 最近活动，**超过 10 条自动分页**；模型明细以色点呈现各模型用量 |
| 🔌 **供应商统计** | 按 API 提供商汇总输入 / 输出 / 缓存命中 / 命中率 / 总量 / 占比 / 模型明细；**点击任意一行**弹出该供应商的逐模型用量与命中率，**超过 10 条自动分页** |
| 🧮 **顶部指标** | 累计 Token / 单日峰值 / 最长会话时长 / 当前连续天数 / 最长连续天数 |
| ♻️ **自动刷新** | 默认开启、默认 5 秒（可选 5 / 10 / 30 / 60 秒） |
| ♿ **无障碍与体验** | WCAG AA 对比度（明暗双主题逐项核算）、`prefers-reduced-motion` 降级、透明命中层让小点也轻松悬停 |

## 📦 安装

前置：已安装 `@deepseek-ai/dsh`（及 DSH 插件命令依赖的 `pnpm`）。

```bash
dsh plugin --profile web add dsh-token-panel
```

本地开发安装：

```bash
dsh plugin --profile web add link:/path/to/dsh-token-panel
```

安装后重启 DSH 进程，点击侧边栏「**用量统计**」即可看到统计页面。

## 🚀 使用

- 顶部切换时间范围；**「全部」**显示自使用以来的所有数据。
- 趋势图悬停查看各模型分项，点击图例显隐对应模型。
- 会话 / 供应商表格超过 10 条时底部出现分页控件。
- **「刷新」**强制重新扫描全部会话；自动刷新默认每 5 秒拉取一次。

## ⚙️ 工作原理

```
DSH 会话记录
        │
        ▼  sessionPersistence 全量枚举 + 回放事件
按天 / 按小时 / 按模型 / 按会话 / 按供应商聚合
        │
        ▼  内存 + 磁盘双层缓存（SWR）
GET /api/usage-stats（过宿主信任栅栏：Host/Origin + cookie）
        │
        ▼
前端：手写 SVG 按实测容器宽度 1:1 出图
```

## 🎨 设计与实现

| 设计点 | 说明 |
|--------|------|
| **菜单** | 注册 `sidebar.panellist` + `main` 槽位，复用 DSH 原生 `panelRow` 结构，风格与内置菜单一致 |
| **图表** | 手写 SVG（GitHub 网格 / 堆叠柱 / 刻度环），零运行时图表库依赖 |
| **配色** | 自研双轨色板：类目色承载模型身份，序数色明度阶承载用量大小；两套主题均满足 WCAG AA |
| **排版** | 固定 px 字阶 + 4 的倍数间距阶梯；图表按 ResizeObserver 实测容器宽度 1:1 出图 |
| **命中区** | 视觉元素不绑事件：热力图逐格透明矩形、刻度环整圈扇形 path，悬停不闪烁 |
| **Tooltip** | `position: fixed` 且挂载于无 `transform` 的容器下，保证坐标相对视口，跟随鼠标 |
| **服务端** | 复用宿主 `sessionPersistence` 聚合；内存 + 磁盘双层缓存，SWR 过期后台刷新 |
| **安全** | `/api/usage-stats` 自行通过宿主 `connection.requestRejection` 信任栅栏鉴权；只读，永不写回会话日志 |

## 🔢 数据口径

| 指标 | 口径 |
|------|------|
| Token 用量 | 以 `assistant/message` 事件携带的全量 `usage` 为准（input + output + cacheRead + cacheWrite），按 `turn:step` 去重防重复计数 |
| Turns | 以 `step/end` 事件按新 turn 计数（覆盖 completed / failed / cancelled） |
| 模型归属 | 优先取消息自身 `model`，回退 `request/context` 当前模型，再回退归并为 `other` |
| 供应商归属 | 取自 `request/context` 事件的 `provider` 字段，缺失时归入 `other` |
| 会话归属 | 按会话文件逐个累计，仅收录有用量的会话 |
| 活跃日 | 当天有 ≥1 条 usage 事件；连续天数按活跃日相邻日推算 |

## ✅ 验收测试

```bash
node tests/run-acceptance.mjs            # 静态断言 + 无头浏览器端到端
node tests/run-acceptance.mjs --static   # 仅静态断言
```

浏览器阶段会自行启动 `dsh web`（随机端口）、驱动真实 Chrome 断言菜单、页面渲染、分页、Tooltip 与图表行为，然后关闭实例。

## 🤝 兼容性

- 针对 DSH `0.2.0-rc.2` 开发与验证。
- 依赖 DSH 宿主提供的 `sessionPersistence`、`webServer`、`connection` 服务，以及客户端运行时 `@deepseek-ai/dsh-client-ui-slots`。
- Node.js `>= 20`；web / desktop profile 通用。

## 🗂️ 仓库结构

<details>
<summary><b>目录树</b>（点击展开）</summary>

```
dsh-token-panel/
├── package.json          # 插件清单（dsh 客户端注入声明）
├── cordis.patch.yml      # DSH 补丁声明
├── lib/
│   ├── index.mjs         # 宿主侧：会话扫描、聚合、/api/usage-stats
│   └── client.js         # 浏览器侧：菜单项、页面、图表（构建产物）
├── build/
│   ├── body.js           # 客户端源码（含 __CSS__ 占位符）
│   ├── panel.css         # 样式源码
│   └── assemble.cjs      # 构建脚本：body.js + panel.css → lib/client.js
├── tests/
│   ├── run-acceptance.mjs  # 验收入口（静态 + 浏览器）
│   ├── browser-e2e.mjs     # 浏览器端到端断言
│   ├── contrast.cjs        # 对比度核算
│   └── preset-conformance.cjs
├── assets/               # 截图
├── LICENSE               # MIT
└── README.md / README.en.md
```

</details>

## 📄 许可与致谢

MIT License。

本项目基于 [Amer-CN/zcode-usage-stats](https://github.com/Amer-CN/zcode-usage-stats)（MIT）改造：将原本挂在**设置页**的视图改为**侧边栏原生菜单 + 主区域页面**，并新增 GitHub 风格热力图、会话统计、供应商统计、分页与自动刷新等能力。

## 📜 版本历史

| 版本 | 变更 |
|------|------|
| **v1.1.0** | 日期栏紧贴上标题（滚动透底修复）；日期栏下方所有查询随所选区间重算；用量趋势改堆叠柱状图；缓存命中量与命中率贯通汇总卡 / 模型列表 / 会话表 / 供应商表（含供应商模型明细弹窗）；会话名展示；热力图子标题精简；左右内边距加宽 |
| **v1.0.0** | 侧边栏原生菜单 + 主区域页面；GitHub 风格热力图；会话 / 供应商统计与分页；Tooltip 跟随鼠标；自动刷新；深浅双主题 |
