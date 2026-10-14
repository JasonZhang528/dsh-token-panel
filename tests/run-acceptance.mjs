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
ok("缓存带 schemaVersion", h.includes("const CACHE_SCHEMA_VERSION = 3") && h.includes("schemaVersion: CACHE_SCHEMA_VERSION"));
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
ok("热力图副标题重写", c.includes('"最近一年 · 活跃 " + model.activeDays + " 天"'));
ok("热力图副标题含峰值日期", c.includes('fmtDayLabel(model.peak.key)'));
ok("粘性栏底色为两层（不透底）", c.includes("background-color: var(--surface);") && c.includes("linear-gradient(var(--dsw-alias-bg-layer-2, transparent)"));
const darkHeaderRule = /body\[data-ds-dark-theme\] \.ust-header \{[^}]*background-color: var\(--surface\)[^}]*linear-gradient\(var\(--dsw-alias-bg-layer-2, transparent\)/.test(c);
ok("深色同样两层底色", darkHeaderRule);
ok("内容区左右内边距 32px", c.includes("padding: 0 32px 24px;"));
ok("标题栏左右内边距 32px", c.includes("padding: 16px 32px 10px;"));
ok("粘性栏内边距 32px", c.includes("padding: 10px 32px;"));
ok("窄屏内边距收敛", c.includes("@media (max-width: 900px)") && c.includes("padding-left: 16px; padding-right: 16px;"));

section("客户端：日期栏贴合标题（上内边距归零）");
ok("滚动容器上内边距为 0", c.includes(".ust-pageBody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 32px 24px; }"));
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

section("客户端：图表改版（柱状图，命中率折线已移除）");
ok("用量分布改为柱状图", c.includes('"aria-label": "用量分布柱状图"') && c.includes('className: cF(s.rank) + " ust-bar"'));
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
ok("圆环 tooltip 含命中率", c.includes('"命中 " + fmtFull(s.cacheRead || 0) + " · 命中率 " + fmtPct(hitRateOf(s))'));
ok("命中数据有样式", c.includes(".ust-model-hit {") && c.includes(".ust-model-rate {"));

section("客户端：模型明细弹窗（会话 / 供应商共用）");
ok("弹窗组件通用化", c.includes("function ModelsDetailModal({ title, sub, sumItems, models, onClose })"));
ok("供应商弹窗改用共享组件", c.includes("detail ? element(ModelsDetailModal, {") && c.includes("title: detail.provider"));
ok("会话弹窗已接入", c.includes("title: detail.title || detail.id") && c.includes("models: detail.byModel"));
ok("会话行可点击", c.includes("onClick: () => setDetail(r)"));
ok("会话行支持键盘", c.includes("onKeyDown") && c.includes("e.preventDefault()"));
ok("弹窗支持 Esc 关闭", c.includes("Escape") && c.includes('window.addEventListener("keydown", onKey)'));
ok("会话逐模型四件套", c.includes("bm.cacheRead += m.cacheRead || 0"));
ok("弹窗输出模型命中率", c.includes("fmtPct(hitRateOf(m))"));

section("客户端：柱顶数值标签");
ok("每根柱输出数值", c.includes('className: "ust-bar-val"') && c.includes('fmtLarge(v.total)'));
ok("标签渲染进 svg", c.includes('grid, xAxis, bars, barLabels, peakMark,'));
ok("密集时按步长稀疏", c.includes('const labelStride = Math.max(1, Math.ceil(BAR_LABEL_W / Math.max(1, effStep)));'));
ok("峰值柱不重复标数值", c.includes('if (!(v.total > 0) || i === peakIdx) return null;'));
ok("零用量柱不标数值", c.includes('!(v.total > 0)'));
ok("标签样式已定义", c.includes('.ust-bar-val {') && c.includes('stroke: var(--surface); stroke-width: 2.5px;'));
ok("峰值判定提前", c.indexOf('let peakIdx = 0, peakVal = -1;') < c.indexOf('const bars = values.map'));

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

section("客户端：热力图色阶去文字");
ok("色阶不再显示「少/多」", !c.includes('"ust-scale-lab" }, "少"') && !c.includes('"ust-scale-lab" }, "多"'));
ok("色阶方块保留", c.includes('className: "ust-gh-sw ust-gh-lv" + lv'));


ok("注册 /api/usage-stats 路由", h.includes('path: "/api/usage-stats"'));
ok("自行通过信任栅栏", h.includes("requestRejection"));
ok("inject 含 webServer", h.includes('"webServer"'));
ok("不写回会话日志（只读）", !/writeFile[^\n]*sessions/i.test(h));

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

  // 1) 启动 dsh web（随机端口）
  const child = spawn(EXE, ["--expose-internals", CLI, "--profile", "web", "--port", "0", "--no-open"], {
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
    // 2) 浏览器阶段交给 Electron 运行时执行（app.asar 内的 MCP 客户端只有它能加载）
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
      for (const l of out.split("\n")) if (/^(SIX|TRIO|CHANGES|DOM|BL) /.test(l)) console.log("  -- " + l.slice(0, 900));
    }
    for (const [name, cond] of Object.entries(r)) ok(name, cond === true);
  } finally {
    try { child.kill(); } catch {}
  }
}

// ── 汇总 ───────────────────────────────────────────────────────
console.log("\n" + "=".repeat(46));
console.log("  通过 " + pass + " / 失败 " + fail);
console.log("=".repeat(46));
process.exit(fail === 0 ? 0 : 1);
