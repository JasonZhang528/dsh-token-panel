#!/usr/bin/env node
/**
 * dsh-token-panel 验收测试
 *
 * 静态断言 + 无头浏览器端到端验证。
 *   node tests/run-acceptance.mjs            # 静态断言 + 浏览器实测（需 DSH 在跑）
 *   node tests/run-acceptance.mjs --static   # 仅静态断言
 *
 * 浏览器阶段会自动：启动 dsh web（随机端口）→ 打开页面 → 断言侧边栏入口与弹窗行为 → 关闭实例。
 */
import { readFileSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { homedir } from "node:os";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
let PAGE = 1;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CLIENT = join(ROOT, "lib", "client.js");
const HOST = join(ROOT, "lib", "index.mjs");
const PKG = join(ROOT, "package.json");

let pass = 0, fail = 0;
const ok = (name, cond) => { if (cond) { pass++; console.log("  ok   " + name); } else { fail++; console.log("  FAIL " + name); } };
const section = (t) => console.log("\n== " + t);

// ── 1. 静态断言 ────────────────────────────────────────────────
section("包元数据");
const pkg = JSON.parse(readFileSync(PKG, "utf8"));
ok("name 为 dsh-token-panel", pkg.name === "dsh-token-panel");
ok("声明 dsh.bundle.patch", pkg.dsh?.bundle?.patch === "./cordis.patch.yml");
ok("声明 client.platform = web", pkg.dsh?.client?.platform === "web");
ok("不再声明 dsh-client-runtime（0.2 已移除）", !(pkg.dsh?.client?.inject ?? []).includes("@deepseek-ai/dsh-client-runtime"));
ok("声明 slots 注入", (pkg.dsh?.client?.inject ?? []).includes("@deepseek-ai/dsh-client-ui-slots"));
ok("main 指向 lib/index.mjs", pkg.main === "./lib/index.mjs");
ok("exports 暴露 ./client", pkg.exports?.["./client"]?.default === "./lib/client.js");

section("客户端：槽位与入口");
const c = readFileSync(CLIENT, "utf8");
ok("模块 id 为 dsh-token-panel", c.includes('id: "dsh-token-panel",'));
ok("注册 sidebar.panellist（原生菜单）", c.includes('ctx.slots.inject("sidebar.panellist"'));
ok("菜单 id 为 token-usage", c.includes('const PANEL_ID = "token-usage";'));
ok("菜单排在插件之后（order 20）", c.includes("order: 20,"));
ok("注册 main 主区域页面", c.includes('ctx.slots.inject("main"'));
ok("菜单图标组件存在", c.includes("function UsageStatsPanelIcon"));
ok("页面组件存在", c.includes("function UsageStatsPage"));

section("客户端：主区域页面");
ok("页面标题为「用量统计」", c.includes('className: "ust-pageTitle" }, "用量统计"'));
ok("页面头 + 内容区", c.includes('className: "ust-pageHead" ') && c.includes('className: "ust-pageBody"'));
ok("页面样式已定义", c.includes(".ust-pageBody {"));
ok("分页组件存在", c.includes("function Pager({ page, pageCount, total, unit, onChange })"));
ok("会话统计每页 10 条", (c.match(/const PAGE_SIZE = 10;/g) || []).length >= 2);
ok("会话分页控件已挂载", c.includes('unit: "会话"'));
ok("供应商分页控件已挂载", c.includes('unit: "供应商"'));
ok("供应商表在饼图之后", c.indexOf("element(Donut,") < c.indexOf("element(ProvidersView,"));
ok("会话统计在最后", c.indexOf("element(ProvidersView,") < c.indexOf("element(SessionsView,"));
section("客户端：本轮改动（tooltip 修复）");
ok("面板不再用 transform 居中", !c.includes("transform:translate(-50%,-50%)"));
ok("面板改用 margin:auto 居中", c.includes("top:0;left:0;right:0;bottom:0;margin:auto"));
ok("tooltip 仍为 position:fixed", c.includes(".ust-tip {") && /position: *fixed/.test(c));

section("客户端：本次改动");
ok("区块标题为「活跃热力图」", c.includes("活跃热力图"));
ok("无「活跃分布」残留", !c.includes("活跃分布"));
ok("默认区间为今天", c.includes('react.useState({ id: "today" })'));
ok("入口行高 42px（对齐设置菜单）", c.includes("height:42px"));
ok("入口圆角 12px", c.includes("border-radius:12px"));
ok("入口字号 14px", c.includes("font-size:14px"));
ok("入口整行宽（width:100%）", c.includes("width:100%"));
ok("窄栏形态保留", c.includes("ust-fabBtn--rail"));

section("客户端：本次改动（热力图/指标/圆环）");
ok("热力图只保留每日模式", !c.includes("HEAT_MODES") && !c.includes("isWeekly") && !c.includes("isCum"));
ok("单日窗口隐藏活跃天数", c.includes("singleDayWindow ? null : element(Metric, { icon: element(IconCalendar)"));
ok("单日窗口隐藏日均", c.includes("singleDayWindow ? null : element(Metric, { icon: element(IconTrend)"));
ok("圆环与列表水平并排", c.includes("flex-direction: row") && c.includes(".ust-donut-wrap > .ust-models-box"));
ok("窄容器可换行回堆叠", c.includes("flex-wrap: wrap"));

section("客户端：本轮改动（GitHub 热力图/会话与供应商/冻结/名称）");
ok("热力图为 GitHub 网格风格", c.includes("ust-gh-cell") && c.includes("ust-gh-lv4"));
ok("热力图五档色阶", /ust-gh-lv[0-4]/.test(c));
ok("标题与副标题同行", c.includes(".ust-panelTitleBox{flex:1 1 auto;min-width:0;display:flex;flex-direction:row;align-items:baseline"));
ok("日期栏滚动冻结", c.includes(".ust-header") && /position:\s*sticky/.test(c));
ok("会话统计表", c.includes("function SessionsView(") && c.includes("session.days") === false);
ok("供应商统计表", c.includes("function ProvidersView("));
ok("名称为 Token用量统计", !c.includes("Token使用统计") && c.includes("Token用量统计"));

section("客户端：本轮改动（自动刷新/占比/宽度）");
ok("名称为 Token用量统计", c.includes("Token用量统计") && !/["\u0027]使用统计/.test(c.replace(/Token用量统计/g, "")));
ok("自动刷新默认开启", c.includes("react.useState(true)") && c.includes("autoRefresh"));
ok("默认间隔 5 秒", c.includes("const [autoEvery, setAutoEvery] = react.useState(5);"));
ok("间隔可选 5/10/30/60", c.includes("const AUTO_OPTIONS = [5, 10, 30, 60];"));
ok("定时器随开关启停", c.includes("setInterval(() => { load(false); }") && c.includes("clearInterval(id)"));
ok("饼图占 40% / 明细占 60%", c.includes(".ust-donut-wrap > .ust-donut { flex: 0 0 40%;") && c.includes(".ust-donut-wrap > .ust-models-box { flex: 1 1 0;"));
ok("入口铺满侧边栏行宽", c.includes(".ust-fab{position:relative;display:flex;flex:1 1 100%"));

section("客户端：数据与外壳");
ok("数据源为 /api/usage-stats", c.includes('fetch("/api/usage-stats"'));
ok("exports.apply 完好", c.includes("exports.apply = apply;"));
ok("exports.inject 完好", c.includes("exports.inject = inject;"));
ok("ModuleLoader 外壳完好", c.trimEnd().endsWith("});"));

section("宿主侧");
const h = readFileSync(HOST, "utf8");
section("宿主侧：供应商与会话维度聚合");
ok("providerTotals 累计", h.includes("const providerTotals = new Map()"));
ok("sessionList 累计", h.includes("const sessionList = []"));
ok("account 记录供应商", h.includes("const account = (dayKey, hour, model, usage, provider, sessionId, time)"));
ok("request/context 取 provider", h.includes('case "request/context":') && h.includes("currentProvider"));
ok("buildCache 输出 providers", h.includes("const providers = [...(s.providerTotals || new Map())"));
ok("buildCache 输出 sessions", h.includes("const sessions = [...(s.sessionList || [])"));

section("宿主侧：按天聚合（日期范围过滤）");
ok("按天记录消息数", h.includes("ensureDay(activeKey).messages += 1"));
ok("按天记录会话桶", h.includes("day.bySession.get(sessionId)"));
ok("按天记录供应商桶", h.includes("day.byProvider.get(provider)"));
ok("按天累计轮次", h.includes("ensureSessDay(ensureDay(key), sid).turns += 1"));
ok("按天输出会话明细", h.includes("const sessions = [...(d.bySession || new Map()).entries()]"));
ok("按天输出供应商明细", h.includes("const providers = [...(d.byProvider || new Map()).entries()]"));
ok("按天输出消息数", h.includes("messages: d.messages"));
ok("会话名取自 session/title 事件", h.includes('case "session/title":') && h.includes("sessionTitle = ev.data.title.trim()"));
ok("缓存带 schemaVersion", h.includes("const CACHE_SCHEMA_VERSION = 9") && h.includes("schemaVersion: CACHE_SCHEMA_VERSION"));
ok("旧 schemaVersion 缓存不采用", h.includes("j.schemaVersion === CACHE_SCHEMA_VERSION"));

section("客户端：日期范围过滤（Token用量统计以下）");
ok("窗口会话指标", c.includes('label: "窗口会话"'));
ok("窗口消息指标", c.includes('label: "窗口消息"'));
ok("会话表按窗口聚合", c.includes("function sessionsIn(days, wnd, meta)"));
ok("供应商表按窗口聚合", c.includes("function providersIn(days, wnd)"));
ok("会话表接收 days/window", c.includes("element(SessionsView, { days: days, window: wnd"));
ok("供应商表接收 days/window", c.includes("element(ProvidersView, { days: days, window: wnd"));
ok("meta 按 id 建索引", c.includes("meta.reduce((m, s) => (s && s.id ? (m[s.id] = s, m) : m), {})"));
ok("会话名为主、id 为副", c.includes("ust-tblId") && c.includes('className: "ust-tblSub ust-tblId"'));
ok("会话统计副标题按窗口", c.includes('(wnd.id === "all" ? "全部历史" : wnd.label) + "会话的 Token 用量与会话内模型明细"'));
ok("供应商副标题按窗口", c.includes('(wnd.id === "all" ? "全部历史" : wnd.label) + "按 API 提供商汇总，含各家模型明细"'));
ok("热力图副标题重写", c.includes('"一块 = 一天，颜色越深 = 当日 Token 越多 · 活跃 " + model.activeDays + " 天"'));
ok("热力图副标题含峰值日期", c.includes('fmtDayLabel(peakCell.key)'));
ok("粘性栏底色为两层（不透底）", c.includes("background-color: var(--surface);") && c.includes("linear-gradient(var(--dsw-alias-bg-layer-2, transparent)"));
const darkHeaderRule = /body\[data-ds-dark-theme\] \.ust-header \{[^}]*background-color: var\(--surface\)[^}]*linear-gradient\(var\(--dsw-alias-bg-layer-2, transparent\)/.test(c);
ok("深色同样两层底色", darkHeaderRule);
ok("内容区左右内边距 32px", c.includes(".ust-pageBody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 32px 0; }"));
ok("标题栏左右内边距 32px", c.includes("padding: 16px 32px 10px;"));
ok("粘性栏内边距 32px", c.includes("padding: 10px 32px;"));
ok("窄屏内边距收敛", c.includes("@media (max-width: 900px)") && c.includes("padding-left: 16px; padding-right: 16px;"));

section("客户端：日期栏贴合标题（上内边距归零）");
ok("滚动容器上内边距为 0", /\.ust-pageBody \{[^}]*padding: 0 32px 0; \}/.test(c));
ok("页脚吸附最底部", c.includes(".ust-footer {") && c.includes("position: sticky;") && c.includes("bottom: 0;"));
ok("页脚通栏并自担底部间距", c.includes("margin: 4px -32px 0;") && c.includes("padding: 6px 32px 8px;"));
ok("子标题小一号", c.includes(".ust-sub { margin: 3px 0 0; font-size: 11px;"));
ok("页脚内控件收紧", c.includes(".ust-footer .ust-btn { padding: 2px 10px;") && c.includes(".ust-footer .ust-autoSeg .ust-tab { padding: 1px 6px; }"));
ok("自定义选中后展示区间", c.includes('range.id === "custom" && range.from && range.to') && c.includes("range.from.slice(5).replace"));
ok("自定义区间徽标样式", c.includes(".ust-tab--custom { letter-spacing: 0; font-variant-numeric: tabular-nums; }"));
ok("间距改由 .ust-root 承担", c.includes("padding: 12px 0 0;"));
ok("窄屏 .ust-root 同步收敛", c.includes(".ust-root { padding-top: 8px; }"));
ok("弹窗主体同样上内边距归零", c.includes(".ust-panelBody{flex:1 1 auto;min-height:0;overflow:auto;padding:0 24px 20px}"));

section("客户端：命中口径");
ok("命中率按满量计算", c.includes("function hitRateOf(m)") && c.includes("(m.input || 0) + (m.output || 0) + (m.cacheRead || 0) + (m.cacheWrite || 0)"));
ok("分母为 0 显示占位符", c.includes('return r === null || r === undefined ? "—"'));
ok("汇总卡新增缓存命中", c.includes('label: "缓存命中"'));
ok("汇总卡新增命中率", c.includes('label: "命中率"'));
ok("窗口命中率按当期满量折算", c.includes("rate: winAgg.total > 0 ? winAgg.cacheRead / winAgg.total : null"));
ok("会话表新增缓存命中列", c.includes('element("th", { className: "ust-tblNum" }, "缓存命中")'));
ok("会话表新增命中率列", c.includes('element("th", { className: "ust-tblNum" }, "命中率")'));
ok("会话行输出命中与命中率", c.includes("fmtLarge(r.cacheRead)") && c.includes("fmtPct(hitRateOf(r))"));
ok("供应商表含命中率列", /"供应商"[\s\S]{0,600}?"命中率"/.test(c));
ok("会话窗口聚合累计四件套", c.includes("cur.cacheRead += s.cacheRead || 0;"));

section("客户端：图表改版（柱状图 + 折线双形态）");
ok("柱状与折线形态并存", c.includes('className: cF(s.rank) + " ust-bar"') && c.includes('className: cF(s.rank) + " ust-line"'));
ok("原折线路径已移除", !c.includes('cS(s.rank) + " ust-hair"'));
ok("命中率折线图已删除", !c.includes("ust-hr-line") && !c.includes('"aria-label": "各模型缓存命中率折线图"'));
ok("命中率折线相关样式已清理", !c.includes(".ust-hr-line") && !c.includes(".ust-hr-dot") && !c.includes(".ust-legend-line"));
ok("柱状图副标题", c.includes("一根柱 = 一个模型，柱高 = 当期用量"));
ok("单图单滚动容器", c.includes('className: "ust-plot" + (needScroll ? " is-scroll" : "")'));

section("客户端：模型明细色点可见性");
ok("色点显式 inline-block", /.ust-dot {[^}]*display: inline-block/.test(c));
ok("色点保留尺寸", /.ust-dot {[^}]*width: 8px; height: 8px/.test(c));
ok("相邻色点留间距", c.includes(".ust-dot + .ust-dot { margin-left: 4px; }"));

section("客户端：圆环模型列表带命中数据");
ok("模型汇总保留四件套", c.includes("function modelTotalsIn(days, wnd)") && c.includes("cur.cacheRead += x.cacheRead || 0"));
ok("其他桶合并四件套", c.includes("const sumMetrics = (rows) =>") && c.includes("...sumMetrics(tail)"));
ok("列表显示缓存命中量", c.includes('className: "ust-model-hit" }, fmtLarge(s.cacheRead)'));
ok("列表显示命中率", c.includes('className: "ust-model-rate" }, fmtPct(hitRateOf(s))'));
ok("圆环 tooltip 含命中率", c.includes('"缓存命中 " + fmtLarge(s.cacheRead || 0) + " · 命中率 " + fmtPct(hitRateOf(s))'));
ok("命中数据有样式", c.includes(".ust-model-hit {") && c.includes(".ust-model-rate {"));

section("客户端：模型明细弹窗（会话 / 供应商共用）");
ok("弹窗组件通用化", c.includes("function ModelsDetailModal({ title, sub, sumItems, models, ranks, onClose })"));
ok("供应商弹窗改用共享组件", c.includes("detail ? element(ModelsDetailModal, {") && c.includes("title: detail.provider"));
ok("会话弹窗已接入", c.includes("title: detail.title || detail.id") && c.includes("models: detail.byModel"));
ok("会话行可点击", c.includes("onClick: () => setDetail(r)"));
ok("会话行支持键盘", c.includes("onKeyDown") && c.includes("e.preventDefault()"));
ok("弹窗支持 Esc 关闭", c.includes("Escape") && c.includes('window.addEventListener("keydown", onKey)'));
ok("会话逐模型四件套", c.includes("bm.cacheRead += m.cacheRead || 0"));
ok("弹窗输出模型命中率", c.includes("fmtPct(hitRateOf(m))"));

section("客户端：柱顶数值标签");
ok("每根柱输出数值", c.includes('className: "ust-bar-val"') && c.includes('fmtLarge(v.total)'));
// 回归：刻度曾直接用原始峰值（9455万），标签落在零碎数值上。
// 现在按峰值量级向上取整到整档（94,550,000 → 95,000,000，即 9500万）。
ok("刻度按峰值向上取整", c.includes("const rawPeak = Math.max(1, ...visTotals);") && c.includes("const stepU = mag / 10;") && c.includes("const up = Math.ceil(rawPeak / stepU) * stepU;"));
ok("图表按形态渲染进 svg", c.includes('grid, xAxis, isLine ? lineSeries : bars,'));
ok("逐根柱标数值不抽稀", !c.includes("labelStride") && c.includes("const cramped = colStep < BAR_LABEL_W;"));
ok("密集时降字号不隐藏", c.includes('className: "ust-bar-val" + (cramped ? " ust-bar-val--sm" : "")') && c.includes(".ust-bar-val--sm { font-size: 9px;"));
// 需求：数值文本始终在柱子最上方，峰值柱与普通柱同一规则（不再跳过峰值柱）
ok("每根有量的柱都标数值", c.includes('if (!(v.total > 0)) return null;') && !c.includes('|| i === peakIdx) return null;'));
ok("零用量柱不标数值", c.includes('!(v.total > 0)'));
ok("标签样式已定义", c.includes('.ust-bar-val {') && c.includes('stroke: var(--surface); stroke-width: 2.5px;'));
ok("峰值判定提前", c.indexOf('let peakIdx = 0, peakVal = -1;') < c.indexOf('const bars = values.map'));

section("宿主：时长 / 工具 / Skill / MCP 统计");
ok("核心工具白名单", h.includes("const CORE_TOOLS = new Set([") && h.includes('"run_code"'));
ok("分段活跃时长口径", h.includes("const SEGMENT_GAP_MS = 30 * 60 * 1000;") && h.includes("function activeMsOf(times)"));
ok("MCP server 归并", h.includes("function mcpServerOf(name)"));
ok("消费 PTC 内层工具", h.includes('case "tool/ptc-dispatch-start"') && h.includes("pluginCounts.set"));
ok("会话行下发时长", h.includes("durationMs: activeMsOf(sessMsgTimes)"));
ok("按天下发时长", h.includes("durationMs: activeMsOf(d.msgTimes)"));
ok("洞察与三榜下发", h.includes("topPlugins: topOf(s.pluginCounts)") && h.includes("topMcp: topOf(s.mcpCounts)") && h.includes("topSkills: topOf(s.skillCounts)"));

section("客户端：时长列 / 洞察 / 三榜");
ok("时长格式化", c.includes("function fmtDuration(ms)") && c.includes("function fmtDurationShort(ms)"));
ok("会话表含时长列", c.includes('element("th", { className: "ust-tblNum" }, "时长")') && c.includes("fmtDuration(r.durationMs)"));
ok("洞察默认收起", c.includes("function Insights({ insights, sessionCount, messageCount })") && c.includes("const [open, setOpen] = react.useState(false);"));
ok("洞察头为区块标题式", c.includes("ust-insight-head") && c.includes('className: "ust-h2" }, "活动洞察"') && c.includes("ust-insight-sub"));
ok("洞察折叠用双 chevron 朝下", c.includes('const IconChevronDown2 = () => icon(["M7 6l5 5 5-5", "M7 12l5 5 5-5"]);') && c.includes("element(IconChevronDown2)"));
ok("展开时整体翻转", c.includes(".ust-insight.is-open .ust-insight-chev { transform: rotate(180deg); }"));
ok("chevron 为圆形热区", c.includes(".ust-insight-chev {") && c.includes("border-radius: 999px;"));
ok("展开体淡入", c.includes("ust-metrics ust-insight-body ust-fade"));
ok("洞察展开体为概览卡", c.includes("ust-metrics ust-insight-body") && c.includes('className: "ust-metric-value" }, v'));
ok("三榜 TOP5",
  c.includes("function TopBoards({ insights })")
  && c.includes('["最常用插件", ins.topPlugins || []],')
  && c.includes('["最常用 MCP", ins.topMcp || []],')
  && c.includes('["最常用 Skill", ins.topSkills || []],')
  // 榜单由 col(title, list) 生成：标题以变量传入，不再出现字面量调用
  && c.includes("const cols = groups.map(([title, list]) => col(title, list));"));
ok("三榜同一水平线", c.includes(".ust-top { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));"));
// 需求：三个 TOP 图表始终展示，空榜给占位
ok("三榜恒展示不按数据裁剪", !c.includes("].filter(([, list]) => list.length > 0);") && !c.includes("if (!groups.length) return null;"));
// 需求：无数据时在列表中间显示「暂无数据」
ok("空榜显示暂无数据", c.includes('className: "ust-top-empty"') && c.includes('"暂无数据"') && !c.includes("本会话未使用"));
ok("空榜文案居中", /className: "ust-top-empty"[\s\S]{0,240}?justifyContent: "center"/.test(c));
// 回归：max-width:50% 是两栏时代遗留，套在三栏上会让每栏只占轨道一半（实测 251px 列 + 286px 间距）
ok("三栏吃满轨道不再限宽", !c.includes(".ust-top-col { min-width: 0; max-width: 50%; }"));
// 回归保护只针对 Trend（用量趋势柱状图）：其基线本就是 0，再标一个 0 会与
// X 轴首刻度挤在一起。热力图 HeatTrend 的 Y 轴确实需要 0/峰值两极，故限定函数体。
{
  // Trend 签名含可选参数（会话页传 title / onPick / pickKey），按正则匹配以兼容各种形态
  const trendStart = c.search(/function Trend\(\{ days, window: wnd(, title)?, variant = "bar", showRangeLabel = true, onPick, pickKey \}\) \{/);
  const trendEnd = trendStart >= 0 ? c.indexOf("\n\t\tfunction ", trendStart + 10) : -1;
  const trendBody = trendStart >= 0 && trendEnd > trendStart ? c.slice(trendStart, trendEnd) : "";
  ok("柱状图不再标多余的 0", trendBody.length > 0 && !trendBody.includes('textAnchor: "end" }, "0")'));
}
ok("色阶移到底部", c.includes("ust-gh-scale ust-gh-scale--foot"));
ok("年度概况已删除", !c.includes("ust-gh-stats") && !c.includes("近一年合计"));
ok("每周/累计带数值标注", c.includes("ust-gh-val") && c.includes("fmtDurationShort(x.sum)"));
ok("三榜挂载在会话统计之后", c.indexOf("element(SessionsView,") < c.indexOf("element(TopBoards, { insights: winInsights })"));

section("客户端：热力图指标与三视图");
ok("Token/时长单选", c.includes('["token", "Token"], ["time", "时长"]') && c.includes("setMetric(id)"));
ok("每日/每周/累计三视图",
  c.includes('["day", "每日"], ["week", "每周"], ["cum", "累计"]')
  && /function HeatTrend\(\{ cells, metric, view, tipRow, tipHead/.test(c));
// 双 tooltip 已废弃：SVG 原生 <title> 与结构化弹窗二选一，只保留后者
ok("提示随指标切换", c.includes("fmtMetric(metricOf(c0))") === false && c.includes('view === "cum" ? "累计 Token" : "Token 用量"'));

section("客户端：模型配色统一");
ok("共享配色序号", c.includes("function modelRanksIn(days, wnd)") && c.includes("function colorVarFor(model, ranks)"));
ok("会话色点用共享序号", c.includes('title: m.model + "：" + fmtLarge(m.total), style: { background: colorVarFor(m.model, ranks) }'));
ok("弹窗色点用共享序号", c.includes('className: "ust-dot", style: { background: colorVarFor(m.model, ranks) }'));
ok("ranks 下发到三个视图", (c.match(/ranks: ranks/g) || []).length >= 3);

section("客户端：热力图标题带日期");
ok("标题不带日期取值", c.includes('element("h2", { className: "ust-h2" }, "活跃热力图")'));
ok("子标题含颜色深浅说明", c.includes('颜色越深 = 当日 Token 越多'));

section("客户端：坐标轴全刻度");
ok("逐格出刻度", c.includes("const xAxis = xData.map((d, i) => element(\"text\"") && !c.includes("labelEvery"));
ok("步长下限按标签宽度", c.includes("narrow ? 48 : 56") && c.includes("narrow ? 78 : 96"));
ok("放不下时横向滚动", c.includes("const needScroll = N > 1 && step < minStep;"));

section("客户端：进入即渲染");
ok("首次请求延后到首帧之后", c.includes("requestAnimationFrame(run)") && c.includes("cancelAnimationFrame(id)"));
ok("日期栏外壳抽为共用元素", c.includes("const headerEl =") && c.includes("headerEl,"));
ok("加载态先画页面骨架", c.includes('element("div", { className: "ust-placeholder" }, "正在读取本机会话记录…")'));
// 两拍策略：先秒回缓存渲染，紧接着强制重扫刷新——不等自动刷新档
ok("首帧两拍：先秒回再强刷", c.includes("await load(false);") && c.includes("await load(true);") && c.includes("第二拍 load(true) 强制重扫拿最新数据"));
ok("强刷落在秒回之后不并发", c.indexOf("await load(false);") < c.indexOf("await load(true);"));

section("客户端：表头与数据列严格对应");
// 回归：曾发生会话表只改表头、漏改数据行，导致「缓存命中」与「总量」互换。
// 这里逐表断言：表头次序与数据单元格次序一一对应。
{
  // 会话表：数值列中前两格是轮次/消息（String），之后依次是 输入/输出/缓存命中/总量/命中率
  const sessIdx = c.indexOf('element("th", null, "会话")');
  const sessPart = c.slice(sessIdx, sessIdx + 4000);
  const sessTh = [...sessPart.matchAll(/element\("th", \{ className: "ust-tblNum" \}, "([^"]+)"\)/g)].map((m) => m[1]);
  const sessTd = [...sessPart.matchAll(/element\("td", \{ className: "ust-tblNum" \}, (fmtLarge\(r\.\w+\)|fmtPct\(hitRateOf\(r\)\))/g)].map((m) => m[1]);
  ok("会话表表头数值列齐全", JSON.stringify(sessTh) === JSON.stringify(["轮次", "消息", "时长", "输入", "输出", "缓存命中", "总量", "命中率", "占比"]));
  // 数据行前面还有「会话名 + 轮次 + 消息」3 格，故 fmtLarge 系列从第 4 个数值格起、与表头第 3~7 项对应
  ok("会话表缓存命中列对齐", sessTh[5] === "缓存命中" && sessTd[2] === "fmtLarge(r.cacheRead)");
  ok("会话表总量列对齐", sessTh[6] === "总量" && sessTd[3] === "fmtLarge(r.total)");
  ok("会话表命中率列对齐", sessTh[7] === "命中率" && sessTd[4] === "fmtPct(hitRateOf(r))");
}

section("客户端：用量列统一口径与次序");
// 统一为 输入 / 输出 / 缓存命中 / 总量 / 命中率 / 占比（会话表在「消息」之后，供应商/弹窗在名称列之后）
const order = ["输入", "输出", "缓存命中", "总量", "命中率", "占比"];
const orderRe = new RegExp(order.map((x) => '"' + x + '"').join('[\\s\\S]{0,120}?'));
ok("会话表列序统一", /"轮次"[\s\S]{0,400}?"消息"[\s\S]{0,900}?"输入"[\s\S]{0,900}?"输出"[\s\S]{0,900}?"缓存命中"[\s\S]{0,900}?"总量"[\s\S]{0,900}?"命中率"[\s\S]{0,900}?"占比"/.test(c));
ok("供应商表列序统一", /"供应商"[\s\S]{0,900}?"输入"[\s\S]{0,900}?"输出"[\s\S]{0,900}?"缓存命中"[\s\S]{0,900}?"总量"[\s\S]{0,900}?"命中率"[\s\S]{0,900}?"占比"/.test(c));
ok("明细弹窗列序统一", /"模型"[\s\S]{0,900}?"输入"[\s\S]{0,900}?"输出"[\s\S]{0,900}?"缓存命中"[\s\S]{0,900}?"总量"[\s\S]{0,900}?"命中率"[\s\S]{0,900}?"占比"/.test(c));
ok("六列次序整体成立", orderRe.test(c));
ok("会话表补充输入输出列", c.includes("fmtLarge(r.input)") && c.includes("fmtLarge(r.output)"));
ok("弹窗摘要标签为总量", c.includes('{ label: "总量", value: fmtLarge(detail.total) }') && !c.includes('{ label: "Token", value: fmtLarge(detail.total) }'));
ok("圆环列表补齐六列", c.includes('className: "ust-model-in"') && c.includes('className: "ust-model-out"') && c.includes("ust-model-in, .ust-model-out, .ust-model-hit"));
ok("圆环输入输出列定宽", c.includes(".ust-model-in { width: 62px; }") && c.includes(".ust-model-out { width: 58px; }"));

section("客户端：模型列表列名");
ok("列表有列名表头", c.includes("ust-model--head") && c.includes('"aria-hidden": "true"'));
ok("表头列名齐全", ["模型","缓存命中","命中率","总量","占比"].every((x) => c.includes('"' + x + '"')));
ok("列表外层为 div 容器", c.includes('className: "ust-models-box"') && c.includes('className: "ust-models"'));
ok("表头样式已定义", /\.ust-model--head \{/.test(c));
ok("并排规则同步更名", c.includes(".ust-donut-wrap > .ust-models-box { flex: 1 1 0;"));

section("客户端：弹窗分页");
ok("弹窗按 10 行分页", c.includes("const PAGE_SIZE = 10;") && c.includes('pageRows.map((m) => element("tr", { key: m.model }'));
ok("弹窗超过 10 条显示分页控件", c.includes('unit: "模型", onChange: setPage'));

section("客户端：图例居中与列表对齐");
ok("图例水平居中", c.includes("justify-content: center; }") && c.includes(".ust-legend--above"));
ok("模型列表数值列右对齐", c.includes(".ust-model-in, .ust-model-out, .ust-model-hit, .ust-model-sub, .ust-model-rate, .ust-model-val { text-align: right; }"));
ok("命中量列定宽", c.includes(".ust-model-hit { width: 76px; }"));
ok("总量列定宽", c.includes(".ust-model-sub { width: 72px; }"));
ok("占比列定宽", c.includes(".ust-model-val { width: 40px; }"));
ok("命中率列定宽", c.includes(".ust-model-rate {") && c.includes("width: 42px"));

section("客户端：热力图色阶只留色块");
ok("色阶保留少/多标注", c.includes('"ust-scale-lab" }, "少"') && c.includes('"ust-scale-lab" }, "多"'));
ok("色阶方块保留", c.includes('className: "ust-gh-sw ust-gh-lv" + lv'));
ok("色块后无文字说明", !c.includes("ust-gh-scale-val"));
ok("区间改挂 title", c.includes("title: legendRanges ? legendRanges[lv] : \"\","));



section("客户端：本轮改动（tip 风格 / 概览卡 / 洞察筛选 / TOP5 / 供应商行）");
// 1) 热力图 tip：小标题与行标签同一套文案，不再混排「日期 + 英文指标」
ok("tip 小标题为纯日期", c.includes("tipHead(fmtDayLabel(c0.key))"));
ok("tip 无折算行", !c.includes("\"折算\"") && !c.includes("折算："));
// 2) 概览卡：第二行为 TOKENS 文本；窗口 Token 在窗口消息之后
ok("窗口 Token 第二行为 TOKENS", c.includes('label: "窗口 Token", value: fmtLarge(stats.total), sub: "TOKENS" '));
ok("缓存命中第二行为 TOKENS", c.includes('label: "缓存命中", value: fmtLarge(winStats.cacheRead), sub: "TOKENS" '));
{
  const iToken = c.indexOf('label: "窗口 Token"');
  const iMsg = c.indexOf('label: "窗口消息"');
  ok("窗口 Token 排在窗口消息之前", iToken > 0 && iMsg > iToken);
}
// 3) 活动洞察与 TOP5 按日期区间筛选
ok("宿主按天下发洞察计数", h.includes("day.insights") && h.includes("bumpDay"));
ok("洞察随窗口合并", c.includes("function insightsIn(days, wnd, all)") && c.includes("const winInsights = insightsIn(days, wnd, data.insights)"));
ok("洞察挂载用 winInsights", c.includes("element(Insights, { insights: winInsights") && c.includes("element(TopBoards, { insights: winInsights })"));
ok("宿主 schema 升至 9", h.includes("const CACHE_SCHEMA_VERSION = 9"));
// 回归：MCP 工具（mcp__<server>__<tool>）曾因「非核心工具即插件」的判据
// 同时进插件榜与 MCP 榜，插件榜因此出现 mcp__siyuan__http_request 之类怪名。
ok("MCP 工具不计入插件榜", h.includes("const asPlugin = !CORE_TOOLS.has(tn) && !srv;") && !h.includes("const isPlugin = !CORE_TOOLS.has(tn);"));
// 4) TOP5 序号徽标：前三名金银铜
ok("TOP5 序号分梯队", c.includes("ust-top-rank is-gold") || (c.includes('" is-gold"') && c.includes('" is-silver"') && c.includes('" is-bronze"')));
ok("序号徽标样式已定义", c.includes(".ust-top-rank.is-gold") && c.includes(".ust-top-rank.is-silver") && c.includes(".ust-top-rank.is-bronze"));
// 5) 供应商行：logo 徽标 + 名称同行
ok("供应商 logo 徽标", c.includes("ust-provLogo") && c.includes("ust-provCell"));
ok("供应商徽标内置品牌标记", c.includes("const PROVIDER_BRANDS = {") && c.includes("function ProviderBadge({ name, color })"));
ok("未收录供应商回落首字母", c.includes('String(name || "?").slice(0, 1).toUpperCase()'));
ok("品牌匹配兼容名称变体", c.includes("function providerBrandOf(name)") && c.includes("n.includes(k)"));
ok("品牌标记为内联 SVG", c.includes("ust-provLogo is-brand") && c.includes('viewBox: "0 0 24 24", fill: "currentColor"'));
ok("徽标统一浅灰块面", c.includes(".ust-provLogo {") && c.includes("background: #F0EFEC;") && c.includes("ust-provLogo is-fallback") && !c.includes('background: color || "var(--ink)"'));
// tip 数字走万 / 亿量级
ok("tip Token 用万/亿量级", c.includes('tipRow("Token 用量", fmtLarge(c0.total) + " tokens")') && c.includes('tipRow(view === "cum" ? "累计 Token" : "Token 用量", fmtLarge(x.sum) + " tokens")'));
// 回归：柱状图/圆环 tip 曾输出裸千分位（63,701,235），且与万/亿量级重复显示，不够友好。
// 现在所有「数量」类 tip 一律走 fmtLarge，不再出现 fmtFull。
ok("柱状图 tip 合计为量级", c.includes('"合计 " + fmtLarge(visTotals[i]) + " tokens"'));
ok("柱状图 tip 各模型为量级", c.includes('fmtLarge(values[i].vals[k])'));
ok("圆环 tip 合计为量级", c.includes('"合计 " + fmtLarge(s.total) + " tokens · 占比 "'));
ok("圆环 tip 命中为量级", c.includes('"缓存命中 " + fmtLarge(s.cacheRead || 0)'));
ok("tip 内不使用裸千分位", !/fmtFull\((visTotals|values\[i\]|s\.total|s\.cacheRead)/.test(c));
// 旧宿主降级：无天级 insights 时退回全历史，避免榜单整块消失
ok("洞察降级兼容旧宿主", c.includes("const hasDayLevel = (days || []).some((d) => d && d.insights)") && c.includes("if (!keys.length || !hasDayLevel) return all || {};"));
ok("徽标样式已定义", c.includes(".ust-provLogo") && c.includes(".ust-provCell"));
// 6) 每周/累计 tip 结构化
ok("每周 tip 结构化", c.includes("function HeatTrend({ cells, metric, view, tipRow, tipHead") && c.includes("const weekTip = (x) => ["));
ok("累计视图带命中带", c.includes("className: \"ust-hitband\"") && c.includes("series.map((x, i) => element(\"rect\", {"));
ok("注册 /api/usage-stats 路由", h.includes('path: "/api/usage-stats"'));
ok("自行通过信任栅栏", h.includes("requestRejection"));
ok("inject 含 webServer", h.includes('"webServer"'));
ok("不写回会话日志（只读）", !/writeFile[^\n]*sessions/i.test(h));

section("客户端：对话区「用量」tab");
ok("注册 conversation.view", c.includes('ctx.slots.inject("conversation.view"'));
ok("用量 tab 组件存在", c.includes("function SessionUsageView"));
// 回归：dateKey 只接受 Date 时，dateKey(Date.now()) 会在 getFullYear 上抛
// TypeError，被槽位错误边界吞成 <div data-slot-error>，表现为「用量」tab 一片空白。
ok("dateKey 兼容毫秒时间戳", /function dateKey\(d\) \{\s*if \(typeof d === "number"\) d = new Date\(d\);/.test(c));
ok("不再向 dateKey 传裸时间戳", !/dateKey\(Date\.now\(\)\)/.test(c));
// 用量页是纯读视图：隐藏输入框（避免占掉半屏），离开即恢复
ok("用量页隐藏输入框", c.includes('body.ust-sessview-on [data-conversation-region="composer"] { display: none !important; }'));
ok("挂载即打 body 标记", c.includes('document.body.classList.add("ust-sessview-on")') && c.includes('document.body.classList.remove("ust-sessview-on")'));
// 版心与主面板一致：左右 32px，窄屏 16px
ok("用量页左右留白 32px", /\.ust-sessview \{[^}]*padding: 16px 32px 0;/.test(c));
ok("用量页窄屏留白 16px", /\.ust-sessview \{ padding: 12px 16px 0; \}/.test(c));
// 结构：不再有「今天 / 全部历史」两套卡，指标并入一组；顺序对齐主面板
ok("不再分「今天」与「全部历史」两段", !c.includes('cards("今天"') && !c.includes('cards("全部历史"'));
ok("指标卡并入单组", c.includes('element("div", { className: "ust-metrics" }, cards)'));
{
  // 顺序断言：Token → 缓存命中 → 命中率 → 最常用模型 → 轮次 → 消息 → 活跃时长 → 活跃天数
  const start = c.indexOf("function SessionUsageView");
  const body = start >= 0 ? c.slice(start, start + 9000) : "";
  const order = ["Token 用量", "缓存命中", "命中率", "最常用模型", "轮次", "消息", "活跃时长", "活跃天数"];
  const idx = order.map((k) => body.indexOf('label: "' + k + '"'));
  ok("概览卡顺序与主面板一致", idx.every((v, i) => v >= 0 && (i === 0 || v > idx[i - 1])));
  ok("趋势在概览之后", body.indexOf("element(Trend,") > idx[idx.length - 1]);
  ok("圆环在趋势之后", body.indexOf("element(Donut,") > body.indexOf("element(Trend,"));
  ok("TOP5 在圆环之后", body.indexOf("element(TopBoards,") > body.indexOf("element(Donut,"));
}
ok("用量页展示三榜 TOP5", c.includes("element(TopBoards, { insights: sessInsights })"));
ok("会话洞察取自会话行", c.includes("(meta && meta.insights) || null"));
ok("页脚含刷新按钮", c.includes('className: "ust-sessview-foot"'));
// 小时趋势：数据源为当前会话的小时桶，Trend 走单日窗口 → 自动切 0-23 小时模式
// 需求：小时趋势标题不带日期文本（单日场景日期图已隐藏，日期信息无需重复）
ok("小时趋势标题不含日期", c.includes('title: "小时用量趋势",') && !c.includes('"小时用量趋势（"'));
ok("小时窗口只含一个日期键", c.includes('const hourWnd = { id: "hour", label: "全部", dateKeys: [activeDate] };'));
ok("小时数据取会话级 hours 字段", c.includes("meta && meta.hours") && c.includes("hourMap.set") === false && c.includes("const hourMap = new Map(hourBuckets.map"));
ok("补齐 24 格不留空洞", c.includes("Array.from({ length: 24 }"));
ok("小时趋势喂入小时窗口", c.includes("days: [hourDay], window: hourWnd,"));
// 自动刷新：默认开启、默认 5 秒、档位 5/10/30/60、定时器随开关启停
ok("用量页自动刷新默认开启", (c.match(/const \[autoRefresh, setAutoRefresh\] = react\.useState\(true\);/g) || []).length >= 2);
ok("用量页默认间隔 5 秒", (c.match(/const \[autoEvery, setAutoEvery\] = react\.useState\(5\);/g) || []).length >= 2);
ok("用量页定时器随开关启停", c.includes("setInterval(() => { load(false); }") && (c.match(/return \(\) => clearInterval\(id\);/g) || []).length >= 2);
// TOP5 三榜仍在，且取自会话数据
ok("三榜仍为插件/MCP/Skill", c.includes('["最常用插件"') && c.includes('["最常用 MCP"') && c.includes('["最常用 Skill"'));

section("宿主侧：会话级小时桶");
ok("会话小时桶已声明", h.includes("const sessHours = new Map()"));
ok("小时桶入账 usage", h.includes("const hb = ensureSessHour(hh);") && h.includes("addMetrics(hb.metrics, usage)"));
ok("小时桶累计轮次", h.includes("ensureSessHour(sh).turns += 1"));
ok("小时桶累计消息", (h.match(/ensureSessHour\(sh\)\.messages \+= 1;/g) || []).length === 2);
ok("会话行下发 hours", h.includes("hours: [...sessHours.entries()]"));
ok("缓存 schema 升至 8", h.includes("const CACHE_SCHEMA_VERSION = 9"));

section("宿主侧：会话级洞察");
ok("会话累计工具计数", h.includes("const sessToolCounts = new Map()"));
ok("会话级口径与全历史一致", h.includes("const bumpSessInsights = (tn, args)") && h.includes("const asPlugin = !CORE_TOOLS.has(tn) && !srv;"));
ok("两处工具事件均计入会话", (h.match(/bumpSessInsights\(tn, ev\.data\.arguments\);/g) || []).length === 2);
ok("会话行下发 insights", h.includes("insights: {") && h.includes("topPlugins: topOf(sessPluginCounts)"));

section("宿主侧：会话 × 天 × 小时桶");
ok("天小时桶已声明", h.includes("hours: new Map()") && h.includes("const ensureSessDayHour"));
ok("天小时桶入账 usage", h.includes("const sh = ensureSessDayHour(ss, hour);") && h.includes("addMetrics(sh.metrics, usage)"));
ok("会话行下发 dayHours", h.includes("dayHours: [...days.entries()]"));
ok("缓存 schema 升至 9", h.includes("const CACHE_SCHEMA_VERSION = 9"));

section("客户端：日期趋势联动与页脚吸附");
ok("新增日期用量趋势", c.includes('title: "日期用量趋势"'));
ok("日期趋势可点选", c.includes("onPick: (d) => setPickDate((cur) => ((cur || autoPick) === d ? null : d))"));
ok("日期趋势传选中态", c.includes("pickKey: effectivePick"));
ok("小时趋势跟随选中日", c.includes("const activeDate = pickedDay ? pickedDay.date : autoPick;"));
ok("点选后取该天小时桶", c.includes("const pickedDay = dayHours.find((d) => d.date === effectivePick) || null;"));
ok("未点选取跨天合并口径", c.includes("(Array.isArray(meta && meta.hours) ? meta.hours : [])"));
ok("Trend 支持变体与点选回调", c.includes('function Trend({ days, window: wnd, title, variant = "bar", showRangeLabel = true, onPick, pickKey })'));
ok("柱体与折线点均带选中态", c.includes('className: cF(s.rank) + " ust-bar" + (isPicked ? " is-picked" : "")') && c.includes('className: "ust-pick-ring"'));
ok("选中态样式已定义", c.includes(".ust-bar.is-picked {") && c.includes(".ust-hitband.is-picked {"));
ok("页脚始终贴合底部", /\.ust-sessview-foot \{[^}]*margin: auto -32px 0;/.test(c) && /\.ust-sessview \{[^}]*min-height: 100%;/.test(c));
ok("页脚底色两层不透底", /\.ust-sessview-foot \{[^}]*background-color: var\(--surface\)[^}]*linear-gradient/.test(c));
ok("页脚通栏负外边距", c.includes("margin: 4px -32px 0;") && c.includes("padding: 6px 32px 8px;"));
// 日期趋势：隐藏右侧「全部」区间文案
ok("日期趋势隐藏区间文案", c.includes('title: "日期用量趋势",') && /showRangeLabel: false,/.test(c));
// 小时趋势与日期趋势同为堆叠柱状，样式统一
ok("小时趋势为柱状", c.includes('title: "小时用量趋势",') && !c.includes('variant: "line", showRangeLabel: false,'));
ok("两图共用堆叠柱实现", c.includes('className: cF(s.rank) + " ust-bar"') && c.includes('title: "日期用量趋势",'));
ok("小时图不参与联动", /title: "小时用量趋势",\s*pickKey: null,/.test(c));
// 折线能力保留在 Trend 内部（future-proof），但当前无调用方
ok("折线代码仍可复用", c.includes('const isLine = variant === "line";'));
ok("折线样式已定义", c.includes(".ust-line { fill: none;") && c.includes(".ust-dot.ust-cf0"));
// 少量日期：柱状图收窄为紧凑簇
// 少量日期：改用「格位模型」——柱心落在格位中心，剩余空间成为留白。
// （曾用「收窄轴线」实现紧凑，但 SVG 被 CSS width:100% 等比放大，柱体反而变形。）
ok("少量日期走格位模型", c.includes("const sparse = N <= 3;") && c.includes("const bandW = sparse ? Math.max(minStep, spanW / N) : colStep;"));
ok("格位柱心居中", c.includes("(sparse ? (i + 0.5) * bandW : i * colStep)"));
// 回归：idxAt 曾把 scrollLeft 重复计入（rect.left 已含滚动位移），
// 无滚动时无症状，一旦横向滚动索引整体偏移。另补 SVG 被 CSS 缩放时的坐标折算。
ok("索引反算不再双算 scrollLeft", !c.includes("clientX - rect.left + (holder ? holder.scrollLeft : 0)"));
ok("索引反算折算 CSS 缩放", c.includes("local = local * (vbW / rect.width);"));
// 需求：日期柱状图默认选中当天，柱子有选中效果
ok("默认选中当天", c.includes("const autoPick = activeDaySet.has(todayKey)") && c.includes("const effectivePick = pickDate || autoPick;"));
ok("选中态传 effectivePick", c.includes("pickKey: effectivePick,"));
ok("选中柱加粗描边", c.includes(".ust-bar.is-picked { stroke: var(--ink); stroke-width: 2; }"));
ok("未选中柱降透明度", c.includes(".ust-bar.is-dim { opacity: .55; }") && c.includes("const isDim = hasPick && !isPicked;"));
ok("少量日期柱宽收窄", c.includes("const barW = Math.max(3, Math.min(bandW * (sparse ? 0.42 : 0.62), sparse ? 64 : 34));"));
// 需求：柱子是矩形，去除圆角
ok("柱体为矩形无圆角", !c.includes("rx: Math.min(4, barW / 4),") && !c.includes('barW" + (isPicked ? " is-picked" : "")'));
ok("topOf 提到模块作用域", /^function topOf\(map, n = 5\) \{/m.test(h));

section("打包内容");
ok("cordis.patch.yml 存在", existsSync(join(ROOT, "cordis.patch.yml")));
ok("LICENSE 存在", existsSync(join(ROOT, "LICENSE")));
ok("README 存在", existsSync(join(ROOT, "README.md")));

// ── 2. 语法 ────────────────────────────────────────────────────
section("语法");
for (const [label, file] of [["client.js", CLIENT], ["index.mjs", HOST]]) {
  const r = spawnSyncNode(["--check", file]);
  ok(label + " 可解析", r.status === 0);
}

function spawnSyncNode(args) {
  return spawnSync(process.execPath, args, { encoding: "utf8" });
}

// ── 3. 浏览器端到端（需 DSH 在跑） ──────────────────────────────
const STATIC_ONLY = process.argv.includes("--static");
if (!STATIC_ONLY) {
  section("浏览器端到端");
  try {
    await runBrowserE2E();
  } catch (e) {
    fail++;
    console.log("  FAIL 浏览器阶段异常：" + String(e && e.message ? e.message : e));
  }
}

async function runBrowserE2E() {
  const EXE = "D:/Program Files/DeepSeek Harness/DeepSeek Harness.exe";
  const CLI = "D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js";
  const HELPER = join(ROOT, "tests", "browser-e2e.mjs");

  // 1) 用当前源码跑 E2E：把工作副本 link 进一次性 profile，再启动它。
  //    （web profile 装的是 tgz 快照，落后于源码；缓存 schema 也会因版本差判失效，
  //     冷扫超过 7s 断言窗口，与产品行为无关。）
  const PROFILE = "__acc-" + Date.now().toString(36);
  const HOME = process.env.DSH_HOME || join(homedir(), ".dsh");
  const PROFILE_DIR = join(HOME, "profiles", PROFILE);
  const spawnSync2 = (args, opts) => spawnSync(EXE, ["--expose-internals", CLI, ...args], { encoding: "utf8", windowsHide: true, ...opts });
  try {
    // 从 web 模板复制，保留内置面板集合；失败则退回极简 profile
    spawnSync2(["--from-default-profile", "web", "--profile", PROFILE, "--dump-config"]);
    spawnSync2(["plugin", "--profile", PROFILE, "add", "link:" + ROOT]);
  } catch (e) { console.log("  -- profile 准备失败：" + String(e).slice(0, 120)); }

  // 2) 启动该 profile 的 dsh web（随机端口）
  const child = spawn(EXE, ["--expose-internals", CLI, "--profile", PROFILE, "--port", "0", "--no-open"], {
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  });
  let buf = "";
  child.stdout.on("data", (d) => (buf += d.toString()));
  child.stderr.on("data", (d) => (buf += d.toString()));

  let url = null;
  for (let i = 0; i < 70; i++) {
    await sleep(1000);
    const m = /http:\/\/127\.0\.0\.1:(\d+)\/\?token=([\w-]+)/.exec(buf);
    if (m) { url = m[0]; break; }
  }
  if (!url) { child.kill(); throw new Error("dsh web 未在 70s 内就绪"); }
  ok("dsh web 启动成功", true);

  try {
    // 3) 浏览器阶段交给 Electron 运行时执行（app.asar 内的 MCP 客户端只有它能加载）
    const res = spawnSync(EXE, [HELPER, url], {
      encoding: "utf8",
      windowsHide: true,
      timeout: 240000,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });
    const out = (res.stdout ?? "") + (res.stderr ?? "");
    const line = out.split("\n").find((l) => l.startsWith("E2E_RESULT "));
    if (!line) {
      console.log(out.slice(-800));
      throw new Error("浏览器阶段未返回结果");
    }
    const r = JSON.parse(line.slice("E2E_RESULT ".length));
    const failed = Object.entries(r).filter(([, v]) => v !== true).map(([k]) => k);
    if (failed.length) {
      console.log("  -- 失败项：" + failed.join("、"));
      for (const l of out.split("\n")) if (/(GHSIDE|GHLEGEND|GHDAYTIP|E2E_ERROR|CONSOLE_MSGS|CONSOLE_DUMP|NAV |SIX |PAGE |NEU )/.test(l)) console.log("  -- " + l.slice(0, 900));
    }
    for (const [name, cond] of Object.entries(r)) ok(name, cond === true);
  } finally {
    try { child.kill(); } catch {}
    // 清理一次性 profile：不留残余目录，也不与下次运行串缓存
    try { rmSync(PROFILE_DIR, { recursive: true, force: true }); } catch {}
  }
}

// ── 汇总 ───────────────────────────────────────────────────────
console.log("\n" + "=".repeat(46));
console.log("  通过 " + pass + " / 失败 " + fail);
console.log("=".repeat(46));
process.exit(fail === 0 ? 0 : 1);
