# dsh-token-panel

<div align="center">

**DeepSeek Harness（DSH）插件：侧边栏 Token 用量统计**

**覆盖：全历史会话扫描 × 用量柱状图 × 模型刻度环 × 活跃热力图（三视图） × 会话与供应商统计 × 活动洞察 × 插件/MCP/Skill 榜 × 深浅双主题**

[![Version](https://img.shields.io/badge/Version-v0.1.1-1D5FD0?style=for-the-badge)](package.json)
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
| 🔥 **活跃热力图** | **Token / 时长**指标单选 + **每日 / 每周 / 累计**三视图切换；提示同步给出当日 Token 用量或活跃时长；标题行右侧给出近一年概况（合计 / 活跃 / 峰值，随指标切换）与「少 → 多」色阶；GitHub 贡献网格风格：周列 × 星期行，五档色阶着色，最近一年 |
| 📈 **用量趋势** | 堆叠柱状图：一根柱一个模型，柱高 = 当期用量，**柱顶直接标出数值**；**X 轴逐格给出全部时间 / 日期刻度**（宽度不足时横向滚动，不抽稀）；悬停 Tooltip 跟随鼠标；图例可点击显隐 |
| 🍩 **模型用量** | 刻度环仪表盘：100 刻 = 100%，每 10 刻一枚锚点；占宽 40%，右侧带**列名表头**的明细依次给出输入 / 输出 / 缓存命中 / 总量 / 命中率 / 占比；**色点与柱状图 / 图例同色** |
| 📊 **会话统计** | 逐会话名称 / 轮次 / 消息 / **时长** / 输入 / 输出 / 缓存命中 / 总量 / 命中率 / 占比 / 模型明细 / 最近活动，**超过 10 条自动分页**；**点击任意一行**弹出该会话的逐模型用量与命中率（超过 10 个模型同样分页） |
| 💡 **活动洞察** | 概览指标下方的折叠区，**默认收起**、点击展开；按钮居中并带两枚向下 chevron（展开翻转朝上）。给出聊天总数 / 总消息数 / 工具调用总数 / 已探索工具 / 使用过 Skill / 使用过 MCP |
| 🏆 **三榜 TOP5** | 会话统计下方一行三栏：**最常用插件**（非核心工具）· **最常用 MCP**（按 server 归并）· **最常用 Skill**（解析 `skill` 调用参数），各取 TOP5 并标注次数 |
| 🔌 **供应商统计** | 按 API 提供商汇总输入 / 输出 / 缓存命中 / 总量 / 命中率 / 占比 / 模型明细；**点击任意一行**弹出该供应商的逐模型用量与命中率（超过 10 个模型同样分页），**超过 10 条自动分页** |
| 🧮 **顶部指标** | 累计 Token / 单日峰值 / 最长会话时长 / 当前连续天数 / 最长连续天数 |
| ♻️ **自动刷新** | 默认开启、默认 5 秒（可选 5 / 10 / 30 / 60 秒）；**进入页面先渲染界面再拉取数据**，冷启动不会卡住 |
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
- 热力图可切 **Token / 时长** 指标与 **每日 / 每周 / 累计** 视图；悬停查看单日或单周数值。
- 概览下方的**「活动洞察」**默认收起，点击展开查看工具 / Skill / MCP 用量。
- 会话 / 供应商表格超过 10 条时底部出现分页控件；**点击任意一行**查看该行的模型明细。
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
| 活跃时长 | 按消息时间线**分段活跃**口径：相邻消息间隔 > 30 分钟即断开，各段求和（剔除中途闲置）；顶部「最长会话」与逐会话「时长」同口径 |
| 工具与插件 | 同时消费外层 `tool/call` 与 PTC 内层 `tool/ptc-dispatch-start`（PTC 模式下外层多为 `run_code`，只看外层会失真）；**非核心工具**计入「插件」榜 |
| MCP | 工具名形如 `mcp__<server>__<tool>`，统计时归并到 server 维度 |
| Skill | 解析 `skill` 工具调用的 `arguments.name`；参数非 JSON 时退回通用名 |

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


### 参考实现

| 项目 | 借鉴内容 |
|------|----------|
| [jiamuAi/dsh-token-usage](https://github.com/jiamuAi/dsh-token-usage) | **活跃时长口径**（> 30 分钟断开的分段活跃时长）、**活动洞察**（工具 / Skill / MCP 统计）、**插件与 Skill TOP5**、**热力图多视图**（每日 / 每周 / 累计）等思路 |

> 上述借鉴均为**思路与口径**层面的参考；本插件的实现（聚合代码、SVG 图表、样式与测试）均为独立编写，未复制其源码。感谢 jiamuAi 作者的公开分享。

