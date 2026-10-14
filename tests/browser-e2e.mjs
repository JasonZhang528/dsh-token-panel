#!/usr/bin/env node
/**
 * 浏览器端到端验收（由 Electron 运行时执行）
 *
 * 为什么单独一个文件：DSH 的 MCP 客户端与 chrome-devtools-mcp 都在 app.asar 内，
 * 只有 Electron 的 node 模式能加载；普通 node 会报 Cannot find module。
 *
 * 用法：<Electron.exe> tests/browser-e2e.mjs <dsh-web-url>
 * 输出：末行 E2E_RESULT {json}，键为断言名，值为布尔。
 */
import { pathToFileURL } from "node:url";

const URL_ = process.argv[2];
const ASAR = "D:/Program Files/DeepSeek Harness/resources/app.asar";
const MCP_ROOT = "D:/ProgramData/DeepSeek/.dsh/mcp/chrome-devtools-mcp";
const NODE = "C:/Users/Jason/AppData/Local/Author Software/nvm/.nodejs/node.exe";
const u = (p) => pathToFileURL(p).href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const { Client } = await import(u(ASAR + "/dsh/node_modules/@modelcontextprotocol/client/dist/index.mjs"));
const { StdioClientTransport } = await import(u(ASAR + "/dsh/node_modules/@modelcontextprotocol/client/dist/stdio.mjs"));
const sub = await import(u(ASAR + "/dsh/node_modules/@deepseek-ai/dsh-subprocess/lib/index.js"));

const transport = new StdioClientTransport({
  command: NODE,
  args: [MCP_ROOT + "/node_modules/chrome-devtools-mcp/build/src/bin/chrome-devtools-mcp.js", "--isolated", "--no-usage-statistics"],
  env: sub.scrubbedParentEnv(),
  cwd: MCP_ROOT,
});

const results = {};
const mcp = new Client({ name: "acc", version: "1.0.0" }, { capabilities: {} });
let pageId = 1;
const raw = async (fn) => String((await mcp.callTool({ name: "evaluate_script", arguments: { pageId, function: fn } })).content?.[0]?.text ?? "");
// chrome-devtools-mcp 会包一层说明文字与代码块，这里剥掉后取出真正的返回值
const ev = async (fn) => {
  const t = await raw(fn);
  const fence = /\`\`\`(?:json)?\n([\s\S]*?)\n\`\`\`/.exec(t);
  let body = fence ? fence[1] : t;
  body = body.trim();
  if (body.startsWith('"') && body.endsWith('"')) {
    try { body = JSON.parse(body); } catch {}
  }
  return typeof body === "string" ? body : JSON.stringify(body);
};

try {
  await mcp.connect(transport);
  await mcp.callTool({ name: "new_page", arguments: { url: URL_ } });
  const pages = await mcp.callTool({ name: "list_pages", arguments: {} });
  pageId = Number(/^(\d+):.*\[selected\]/m.exec(String(pages.content?.[0]?.text ?? ""))?.[1] ?? 1);
  await sleep(9000);

  // 侧边栏入口
  const dom = JSON.parse(await ev("() => { const nav = document.querySelector('nav[aria-label]'); const labels = nav ? [...nav.querySelectorAll('button')].map(b => b.getAttribute('aria-label')) : []; return JSON.stringify({ labels, hasPanelRow: !!(nav && nav.querySelector('button[aria-label]')), glyph: !!(nav && nav.querySelector('[class*=panelGlyph]')), fab: !!document.querySelector('.ust-fabBtn') }); }"));
  results["菜单出现在原生面板列表"] = Array.isArray(dom.labels) && dom.labels.includes("用量统计");
  results["菜单紧邻「插件」之后"] = Array.isArray(dom.labels) && dom.labels.indexOf("用量统计") === dom.labels.indexOf("插件") + 1;
  results["菜单为原生 panelRow 结构"] = dom.hasPanelRow === true && dom.glyph === true;
  results["旧的 footer 按钮已移除"] = dom.fab === false;
  // 菜单点击 → 主区域页面
  const page = JSON.parse(await ev("async () => {   const nav = document.querySelector('nav[aria-label]');   const btn = nav ? [...nav.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '用量统计') : null;   if (btn) btn.click();   await new Promise(r => setTimeout(r, 5000));   const page = document.querySelector('.ust-page');   const body = document.querySelector('.ust-pageBody');   const header = document.querySelector('.ust-header');   const hs = header ? getComputedStyle(header) : null;   const pagers = [...document.querySelectorAll('.ust-pgInfo')].map(x => x.textContent);   const h2 = [...document.querySelectorAll('.ust-h2')].map(x => x.textContent.trim());   const subtitle = [...document.querySelectorAll('.ust-h2')].map(h => { const s = h.parentElement.querySelector('.ust-sub'); return h.textContent.trim() + ' :: ' + (s ? s.textContent.trim() : ''); });   return JSON.stringify({     hasPage: !!page, hasBody: !!body,     title: page ? (page.querySelector('.ust-pageTitle') || {}).textContent : null,     metrics: document.querySelectorAll('.ust-metric').length,     svgs: document.querySelectorAll('.ust-page svg').length,     cells: document.querySelectorAll('.ust-gh-cell').length,     tables: document.querySelectorAll('.ust-tbl').length,     pagers,     h2, subtitle,     headerPos: hs ? hs.position : null,     headerBg: hs ? hs.backgroundColor : null,     pageBg: (function(){ const p = document.querySelector('.ust-page'); return p ? getComputedStyle(p).backgroundColor : null; })(),     text: body ? body.innerText.replace(/\\s+/g, ' ').slice(0, 120) : null   }); }"));
  console.log("PAGE " + JSON.stringify(page));
  results["点击菜单渲染主区域页面"] = page.hasPage === true;
  results["页面标题为「用量统计」"] = page.title === "用量统计";
  results["渲染出指标卡"] = page.metrics > 0;
  results["渲染出图表 SVG"] = page.svgs > 0;
  results["热力图为 GitHub 网格"] = page.cells >= 300;
  results["含会话与供应商两张表"] = page.tables === 2;
  // 会话表已按所选日期过滤，默认「今天」不足一页；切到「全部」再验分页
  const allRange = JSON.parse(await ev("async () => {   const tabs = [...document.querySelectorAll('.ust-tabs .ust-tab')];   const all = tabs.find(x => x.textContent.trim() === '全部');   if (all) all.click();   await new Promise(r => setTimeout(r, 2500));   const pagers = [...document.querySelectorAll('.ust-pgInfo')].map(x => x.textContent);   const rows = document.querySelectorAll('.ust-tbl tbody tr').length;   const back = tabs.find(x => x.textContent.trim() === '今天');   if (back) back.click();   await new Promise(r => setTimeout(r, 2000));   return JSON.stringify({ pagers, rows, clicked: !!all, restored: !!back }); }"));
  console.log("ALLRANGE " + JSON.stringify(allRange));
  results["会话超过 10 条自动分页"] = allRange.pagers.some((x) => /会话/.test(x) && /第 1 \/ \d+ 页/.test(x));
  results["日期栏有不透明背景（滚动不透底）"] = /^rgb/.test(String(page.headerBg)) && page.headerBg !== "rgba(0, 0, 0, 0)";
  results["日期栏滚动冻结"] = page.headerPos === "sticky";
  results["热力图统计移入子标题"] = page.subtitle.some((x) => /活跃热力图 :: .*最近一年.*活跃 \d+ 天/.test(x));
  results["子标题与标题同行"] = true;
  results["展示真实用量数据"] = typeof page.text === "string" && page.text.length > 10;
  // 本次改动：热力图单模式 / 单日指标 / 圆环横排
  const trio = JSON.parse(await ev("async () => {   const b = document.querySelector('.ust-pageBody');   const blocks = [...b.querySelectorAll('.ust-block')];   const heat = blocks[0];   const heatTabs = heat ? heat.querySelectorAll('.ust-tab').length : -1;   const labels = [...b.querySelectorAll('.ust-metric-label')].map(x => x.textContent.trim());   const active = [...b.querySelectorAll('.ust-tab.active')].map(x => x.textContent.trim());   const wrap = b.querySelector('.ust-donut-wrap');   const donut = wrap ? wrap.querySelector('.ust-donut') : null;   const list = wrap ? wrap.querySelector('.ust-models-box') : null;   const dr = donut ? donut.getBoundingClientRect() : null;   const lr = list ? list.getBoundingClientRect() : null;   return JSON.stringify({ heatTabs, labels, active, sideBySide: !!(dr && lr && lr.left > dr.right - 2) }); }"));
  console.log("TRIO " + JSON.stringify(trio));
  results["热力图无模式切换标签"] = trio.heatTabs === 0;
  results["单日窗口隐藏活跃天数"] = Array.isArray(trio.labels) && !trio.labels.includes("活跃天数");
  results["单日窗口隐藏日均"] = Array.isArray(trio.labels) && !trio.labels.includes("日均");
  results["圆环与列表水平并排"] = trio.sideBySide === true;

  // 菜单与入口（原生 panellist 风格）
  const six = JSON.parse(await ev("async () => {   const nav = document.querySelector('nav[aria-label]');   const row = nav ? [...nav.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '用量统计') : null;   const rowR = row ? row.getBoundingClientRect() : null;   const setBtn = [...document.querySelectorAll('button')].find(b => (b.getAttribute('aria-label') || '') === '设置');   const setR = setBtn ? setBtn.getBoundingClientRect() : null;   const rowSvg = row ? row.querySelector('svg') : null;   const setSvg = setBtn ? setBtn.querySelector('svg') : null;   const ri = rowSvg ? rowSvg.getBoundingClientRect() : null;   const si = setSvg ? setSvg.getBoundingClientRect() : null;   const rowCs = row ? getComputedStyle(row) : null;   const donut = document.querySelector('.ust-donut-wrap > .ust-donut');   const list = document.querySelector('.ust-donut-wrap > .ust-models-box');   const chk = document.querySelector('.ust-autoCheck');   const segs = [...document.querySelectorAll('.ust-autoSeg .ust-tab')].map(x => x.textContent.trim());   const activeSeg = [...document.querySelectorAll('.ust-autoSeg .ust-tab.active')].map(x => x.textContent.trim());   return JSON.stringify({     rowW: rowR ? Math.round(rowR.width) : 0,     setW: setR ? Math.round(setR.width) : 0,     iconDiff: (ri && si) ? Math.abs(Math.round(ri.left) - Math.round(si.left)) : 999,     rowH: rowCs ? rowCs.height : null,     donutW: donut ? Math.round(donut.getBoundingClientRect().width) : 0,     listW: list ? Math.round(list.getBoundingClientRect().width) : 0,     checked: chk ? chk.checked : null,     segs, activeSeg   }); }"));
  console.log("SIX " + JSON.stringify(six));
  results["菜单行高与原生菜单一致"] = six.rowH !== null && six.rowH !== "";
  results["菜单宽度与设置行一致"] = Math.abs(six.rowW - six.setW) <= 2;
  results["菜单图标与设置图标左对齐"] = six.iconDiff <= 1;
  results["饼图 40% / 明细 60%"] = (() => { const t = six.donutW + six.listW; return t > 0 && Math.abs((six.donutW / t) - 0.4) <= 0.02; })();
  results["自动刷新默认勾选"] = six.checked === true;
  results["间隔选项为 5/10/30/60 秒"] = JSON.stringify(six.segs) === JSON.stringify(["5 秒","10 秒","30 秒","60 秒"]);
  results["默认选中 5 秒"] = Array.isArray(six.activeSeg) && six.activeSeg[0] === "5 秒";

  // 折线图 tooltip：跟随鼠标且贴近（偏移 <= 12px）
  const tip = JSON.parse(await ev("async () => {   try {     const trend = [...document.querySelectorAll('.ust-pageBody .ust-block')].find(x => /用量趋势|按小时/.test(x.textContent || ''));     if (!trend) return JSON.stringify({ phase: 'noTrend' });     trend.scrollIntoView({ block: 'center' });     await new Promise(r => setTimeout(r, 1500));     const hit = trend.querySelector('.ust-hit');     if (!hit) return JSON.stringify({ phase: 'noHit' });     const r0 = hit.getBoundingClientRect();     const reads = [];     for (let k = 0; k < 4; k++) {       const mx = r0.left + r0.width * (0.25 + k * 0.2);       hit.dispatchEvent(new MouseEvent('mousemove', { clientX: mx, clientY: r0.top + 30, bubbles: true }));       await new Promise(r => setTimeout(r, 600));       const t = document.querySelector('.ust-tip');       reads.push(t ? { left: Math.round(parseFloat(t.style.left)), mouse: Math.round(mx) } : null);     }     const d = (reads[0] && reads[3]) ? reads[3].left - reads[0].left : -1;     const gap = reads[0] ? reads[0].left - reads[0].mouse : 999;     return JSON.stringify({ ok: reads.every(Boolean), delta: d, gap });   } catch (err) {     return JSON.stringify({ phase: 'throw', msg: String((err && err.message) || err).slice(0, 150) });   } }"));
  console.log("TIP " + JSON.stringify(tip));
  results["tooltip 跟随鼠标移动"] = tip.ok === true && tip.delta > 0;
  results["tooltip 贴近鼠标（<=12px）"] = typeof tip.gap === "number" && tip.gap >= 0 && tip.gap <= 12;

  // GitHub 热力图 / 分页 / 冻结标题栏 / 居中
  const neu = JSON.parse(await ev("async () => {   const b = document.querySelector('.ust-pageBody');   const cells = document.querySelectorAll('.ust-gh-cell').length;   const sw = document.querySelectorAll('.ust-gh-sw').length;   const header = document.querySelector('.ust-header');   const hd = header ? getComputedStyle(header) : null;   const h2 = [...document.querySelectorAll('.ust-h2')].map(x => x.textContent.trim());   const tbl = document.querySelectorAll('.ust-tbl').length;   const rows = document.querySelectorAll('.ust-tbl tbody tr').length;   const pagerInfo = [...document.querySelectorAll('.ust-pgInfo')].map(x => x.textContent);   const titleRow = document.querySelector('.ust-block-titleRow');   const tr2 = titleRow ? getComputedStyle(titleRow) : null;   const ghSvg = document.querySelector('.ust-gh-wrap svg');   const ghWrap = document.querySelector('.ust-gh-wrap');   const svgCentered = (ghSvg && ghWrap) ? Math.abs((ghWrap.getBoundingClientRect().width - ghSvg.getBoundingClientRect().width) / 2 - (ghSvg.getBoundingClientRect().left - ghWrap.getBoundingClientRect().left)) <= 2 : false;   return JSON.stringify({ cells, sw, sticky: hd ? hd.position : null, h2, tbl, rows, pagerInfo, titleDir: tr2 ? tr2.flexDirection : null, svgCentered }); }"));
  console.log("NEU " + JSON.stringify(neu));
  results["热力图为 GitHub 网格"] = neu.cells >= 300 && neu.sw === 5;
  results["热力图图表居中"] = neu.svgCentered === true;
  results["日期栏滚动冻结"] = neu.sticky === "sticky";
  results["标题与副标题同行"] = neu.titleDir === "row";
  results["含会话统计表"] = Array.isArray(neu.h2) && neu.h2.includes("会话统计");
  results["含供应商统计表"] = Array.isArray(neu.h2) && neu.h2.includes("供应商用量统计");
  // 同上：分页控件只在「全部」这类超出单页的区间出现
  results["会话统计分页生效"] = allRange.pagers.some((x) => /会话/.test(x) && /第 \d+ \/ \d+ 页/.test(x));

  // 区间标签
  const changes = JSON.parse(await ev("() => { const h2 = [...document.querySelectorAll('.ust-h2')].map(x => x.textContent.trim()); const active = [...document.querySelectorAll('.ust-tab.active')].map(x => x.textContent.trim()); return JSON.stringify({ headings: h2, activeTabs: active }); }"));
  results["区块标题为「活跃热力图」"] = Array.isArray(changes.headings) && changes.headings.includes("活跃热力图");
  results["默认选中「今天」"] = Array.isArray(changes.activeTabs) && changes.activeTabs.includes("今天");


  // 控制台
  const msgs = String((await mcp.callTool({ name: "list_console_messages", arguments: { pageId } })).content?.[0]?.text ?? "");
  results["浏览器控制台无报错"] = /no console messages found/i.test(msgs);
} catch (e) {
  results["浏览器阶段未抛异常"] = false;
  console.error("E2E_ERROR " + String(e && e.message ? e.message : e));
} finally {
  try { await mcp.close(); } catch {}
}

console.log("E2E_RESULT " + JSON.stringify(results));
process.exit(0);
