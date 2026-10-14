# dsh-token-panel

<div align="center">

**DeepSeek Harness (DSH) plugin: sidebar Token usage statistics**

**Covers: full-history session scan × usage trend × model dial × activity heatmap × session & provider breakdown × light/dark themes**

[![Version](https://img.shields.io/badge/Version-v1.1.0-1D5FD0?style=for-the-badge)](package.json)
[![DSH Plugin](https://img.shields.io/badge/DSH-Plugin-0E7C86?style=for-the-badge)](#installation)
[![Charts](https://img.shields.io/badge/Charts-Hand--written%20SVG-F59E0B?style=for-the-badge)](#design--implementation)
[![License](https://img.shields.io/badge/License-MIT-10B981?style=for-the-badge)](#license--credits)

**English** | [简体中文](README.md)

</div>

---

A "Token ledger" built into the DSH sidebar. It scans your DSH session records and accounts for every token by day, hour, model, session, and provider: how much you used today, which model costs the most, and which day was the peak. **Fully local scanning, aggregation, and rendering** — your data never leaves your machine.

> ⚠️ Unofficial community plugin, not affiliated with DeepSeek.

## 📸 Preview

| Menu entry | Main view |
|:---:|:---:|
| <img src="assets/menu-entry.png" width="400" alt="Menu entry"> | <img src="assets/panel-light.png" width="400" alt="Main view"> |

| Trend tooltip | Session & provider tables |
|:---:|:---:|
| <img src="assets/panel-tooltip.png" width="400" alt="Tooltip"> | <img src="assets/panel-tables.png" width="400" alt="Tables"> |

Dark theme: <img src="assets/panel-dark.png" width="600" alt="Dark theme">

## ✨ Features

| Module | Description |
|------|------|
| 🧭 **Native menu** | A native menu row directly below "Plugins" in the sidebar, styled exactly like the built-in entries; clicking it opens a main-area page |
| 📅 **Time range** | Today / Yesterday / Last 7 days / Last 30 days / This month / Last month / All / Custom (with start–end validation); **defaults to Today**; the date bar freezes flush against the title while scrolling, and every query below it follows the selected range |
| 🔥 **Activity heatmap** | **Token / duration** metric radio plus **daily / weekly / cumulative** view switch; tooltips follow the selected metric; the header row carries last-year highlights (total / active days / peak, metric-aware) and a "less → more" colour scale; GitHub contribution grid: week columns × weekday rows, five color levels, months separated by gaps, covering the last year |
| 📈 **Usage trend** | Stacked bars: one bar per model, height = usage, **each bar labelled with its value**; **the X axis ticks every point** (scrolls horizontally instead of thinning); the hover tooltip follows the mouse; legend toggles series |
| 🍩 **Model usage** | Dial gauge: 100 ticks = 100%, an anchor every 10 ticks; occupies 40% width, and the labelled breakdown beside it lists input / output / cache hits / total / hit rate / share; **dots match the bar chart and legend colours** |
| 📊 **Session stats** | Per session: name / turns / messages / **duration** / input / output / cache hits / total / hit rate / share / model breakdown / last activity, **paginated beyond 10 rows**; **click any row** for that session's per-model usage and hit rate (also paginated beyond 10 models) |
| 💡 **Activity insights** | Collapsible panel below the overview metrics, **collapsed by default**; the centred button carries two downward chevrons that flip up when expanded. Reports chat count / messages / tool calls / distinct tools / skills used / MCP used |
| 🏆 **Top 5 boards** | One row of three columns below session stats: **top plugins** (non-core tools), **top MCP** (merged by server) and **top skills** (parsed from the `skill` call arguments), five entries each with call counts |
| 🔌 **Provider stats** | Aggregated by API provider: input / output / cache hits / total / hit rate / share / model breakdown; **click any row** for that provider's per-model usage and hit rate (also paginated beyond 10 models), **paginated beyond 10 rows** |
| 🧮 **Top metrics** | Total tokens / peak day / longest session / current streak / longest streak |
| ♻️ **Auto refresh** | On by default at 5 seconds (options: 5 / 10 / 30 / 60 seconds); **the page renders first and then fetches**, so a cold start never freezes |
| ♿ **Accessibility** | WCAG AA contrast (audited per theme), `prefers-reduced-motion` fallback, transparent hit areas so even small dots are easy to hover |

## 📦 Installation

Requires `@deepseek-ai/dsh` (plus `pnpm`, which the DSH plugin command depends on).

```bash
dsh plugin --profile web add dsh-token-panel
```

Local development install:

```bash
dsh plugin --profile web add link:/path/to/dsh-token-panel
```

Restart DSH, then click **用量统计** in the sidebar.

## 🚀 Usage

- Switch the time range at the top; **All** shows everything since you started.
- Hover the trend chart for per-model figures; click the legend to toggle a model.
- The heatmap switches between the **Token / duration** metrics and the **daily / weekly / cumulative** views; hover a cell or bar for its value.
- **Activity insights** below the overview metrics is collapsed by default; click to expand the tool / skill / MCP figures.
- Pagination controls appear under the session and provider tables beyond 10 rows; **click any row** for its model breakdown.
- **Refresh** forces a full rescan; auto refresh pulls every 5 seconds by default.

## ⚙️ How it works

```
DSH session records
        │
        ▼  sessionPersistence enumeration + event replay
Aggregate by day / hour / model / session / provider
        │
        ▼  in-memory + on-disk two-tier cache (SWR)
GET /api/usage-stats (host trust fence: Host/Origin + cookie)
        │
        ▼
Client: hand-written SVG rendered 1:1 at the measured container width
```

## 🎨 Design & implementation

| Point | Notes |
|--------|------|
| **Menu** | Registers the `sidebar.panellist` and `main` slots, reusing DSH's native `panelRow` structure so the style matches built-in entries |
| **Charts** | Hand-written SVG (GitHub grid / stacked bars / dial ring), zero runtime chart libraries |
| **Palette** | Two-track palette: categorical hues carry model identity, an ordinal lightness ramp carries magnitude; both themes meet WCAG AA |
| **Typography** | Fixed px type scale plus a 4px spacing ladder; charts render 1:1 at the ResizeObserver-measured width |
| **Hit areas** | Visual elements carry no events: per-cell transparent rects on the heatmap, full-ring sector paths on the dial, so hovering never flickers |
| **Tooltip** | `position: fixed` mounted under a container without `transform`, so coordinates stay viewport-relative and follow the mouse |
| **Server** | Reuses the host `sessionPersistence` for aggregation; two-tier cache with stale-while-revalidate |
| **Security** | `/api/usage-stats` passes the host `connection.requestRejection` trust fence; read-only, never writes back to session logs |

## 🔢 Data semantics

| Metric | Definition |
|------|------|
| Token usage | Taken from the full `usage` payload on `assistant/message` events (input + output + cacheRead + cacheWrite), deduplicated by `turn:step` |
| Turns | Counted from `step/end` events per new turn (covers completed / failed / cancelled) |
| Model attribution | The message's own `model` first, then `request/context`, then folded into `other` |
| Provider attribution | The `provider` field on `request/context` events, folded into `other` when absent |
| Session attribution | Accumulated per session file; only sessions with usage are listed |
| Active day | A day with at least one usage event; streaks are derived from adjacent active days |
| Active duration | Segmented-active definition: consecutive messages more than **30 minutes** apart start a new segment, and segment lengths are summed (idle gaps excluded). The top "longest session" card and the per-session duration column share this definition |
| Tools and plugins | Both the outer `tool/call` and the PTC inner `tool/ptc-dispatch-start` events are consumed (in PTC mode the outer call is usually `run_code`, so counting it alone would be misleading); **non-core tools** count as plugins |
| MCP | Tool names of the form `mcp__<server>__<tool>` are merged to the server level |
| Skills | Parsed from the `arguments.name` of the `skill` tool call; falls back to a generic name when the arguments are not JSON |

## ✅ Acceptance tests

```bash
node tests/run-acceptance.mjs            # static assertions + headless browser E2E
node tests/run-acceptance.mjs --static   # static assertions only
```

The browser phase boots `dsh web` on a random port, drives real Chrome to assert the menu, page rendering, pagination, tooltip and chart behaviour, then shuts the instance down.

## 🤝 Compatibility

- Built and verified against DSH `0.2.0-rc.2`.
- Requires the host `sessionPersistence`, `webServer` and `connection` services, plus the `@deepseek-ai/dsh-client-ui-slots` client runtime.
- Node.js `>= 20`; works with both the web and desktop profiles.

## 🗂️ Repository layout

<details>
<summary><b>Directory tree</b> (click to expand)</summary>

```
dsh-token-panel/
├── package.json          # Plugin manifest (dsh client injection declarations)
├── cordis.patch.yml      # DSH patch declaration
├── lib/
│   ├── index.mjs         # Host side: session scan, aggregation, /api/usage-stats
│   └── client.js         # Browser side: menu, page, charts (build output)
├── build/
│   ├── body.js           # Client source (with the __CSS__ placeholder)
│   ├── panel.css         # Stylesheet source
│   └── assemble.cjs      # Build: body.js + panel.css -> lib/client.js
├── tests/
│   ├── run-acceptance.mjs  # Acceptance entry (static + browser)
│   ├── browser-e2e.mjs     # Browser E2E assertions
│   ├── contrast.cjs        # Contrast audit
│   └── preset-conformance.cjs
├── assets/               # Screenshots
├── LICENSE               # MIT
└── README.md / README.en.md
```

</details>

## 📄 License & credits

MIT License.

Based on [Amer-CN/zcode-usage-stats](https://github.com/Amer-CN/zcode-usage-stats) (MIT), reworked from a **settings page** into a **native sidebar menu plus main-area page**, with a GitHub-style heatmap, session and provider breakdowns, pagination, and auto refresh added.

### Reference implementations

| Project | What was borrowed |
|---------|-------------------|
| [Amer-CN/zcode-usage-stats](https://github.com/Amer-CN/zcode-usage-stats) | This project's origin: the settings-page view, base aggregation and chart skeleton |
| [jiamuAi/dsh-token-usage](https://github.com/jiamuAi/dsh-token-usage) | The **active-duration definition** (segments split at gaps over 30 minutes), **activity insights** (tool / skill / MCP statistics), **plugin and skill top-5 boards**, and **multi-view heatmap** (daily / weekly / cumulative) |

> These borrowings are at the level of **ideas and metric definitions**. The implementation here (aggregation code, SVG charts, styles and tests) is written independently; no source code was copied. Thanks to both authors for sharing their work.

