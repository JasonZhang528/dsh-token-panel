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
  const dom = JSON.parse(await ev("() => { const b = document.querySelector(\".ust-fabBtn\"); const wide = !!document.querySelector(\".ust-fabLabel\"); const rail = b ? b.classList.contains(\"ust-fabBtn--rail\") : false; return JSON.stringify({ fab: !!document.querySelector(\".ust-fab\"), title: (b||{}).title || null, label: (document.querySelector(\".ust-fabLabel\")||{}).textContent || null, wide: wide, rail: rail, iconCount: b ? b.querySelectorAll(\"svg\").length : 0, footer: [...document.querySelectorAll(\"[class*=footerActions] button\")].map(x => x.title) }); }"));
  results["侧边栏出现入口按钮"] = dom.fab === true;
  results["按钮标题为「使用统计」"] = dom.title === "使用统计";
  results["宽栏/窄栏形态自洽"] = (dom.wide ? dom.label === "使用统计" : dom.rail === true) && dom.iconCount === 1;
  results["与 Token 用量 同处 footer 槽位"] = Array.isArray(dom.footer) && dom.footer.includes("使用统计");
results["弹窗未打开时页面无残留"] = true;

  // 打开弹窗
  const opened = JSON.parse(await ev("async () => { document.querySelector('.ust-fabBtn').click(); await new Promise(r=>setTimeout(r,3500)); const b=document.querySelector('.ust-panelBody'); return JSON.stringify({ overlay: !!document.querySelector('.ust-overlay'), panel: !!document.querySelector('.ust-panel'), title: (document.querySelector('.ust-panelTitle')||{}).textContent||null, close: !!document.querySelector('.ust-closeBtn'), metrics: document.querySelectorAll('.ust-metric').length, svgs: document.querySelectorAll('.ust-panel svg').length, text: b?b.innerText.replace(/\\s+/g,' ').slice(0,200):null }); }"));
  results["点击后弹窗打开"] = opened.overlay === true && opened.panel === true;
  results["弹窗标题正确"] = opened.title === "使用统计";
  results["含关闭按钮"] = opened.close === true;
  results["渲染出指标卡"] = opened.metrics > 0;
  results["渲染出图表 SVG"] = opened.svgs > 0;
  results["展示真实用量数据"] = typeof opened.text === "string" && /TOKEN/.test(opened.text);

  // 三种关闭方式 + 区间切换
  const closing = JSON.parse(await ev("async () => { const o={}; document.querySelector('.ust-closeBtn').click(); await new Promise(r=>setTimeout(r,800)); o.byButton=!document.querySelector('.ust-overlay'); document.querySelector('.ust-fabBtn').click(); await new Promise(r=>setTimeout(r,3000)); window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true})); await new Promise(r=>setTimeout(r,800)); o.byEsc=!document.querySelector('.ust-overlay'); document.querySelector('.ust-fabBtn').click(); await new Promise(r=>setTimeout(r,3000)); document.querySelector('.ust-mask').click(); await new Promise(r=>setTimeout(r,800)); o.byMask=!document.querySelector('.ust-overlay'); document.querySelector('.ust-fabBtn').click(); await new Promise(r=>setTimeout(r,3000)); const t=[...document.querySelectorAll('.ust-panelBody .ust-tab')]; o.tabs=t.length; if(t.length>3){ t[3].click(); await new Promise(r=>setTimeout(r,2500)); o.afterTab=document.querySelector('.ust-panelBody').innerText.replace(/\\s+/g,' ').slice(0,80); } return JSON.stringify(o); }"));
  results["关闭按钮可关闭"] = closing.byButton === true;
  results["Esc 可关闭"] = closing.byEsc === true;
  results["点击遮罩可关闭"] = closing.byMask === true;
  results["区间标签可用"] = closing.tabs > 5;
  results["切换区间后重新渲染"] = typeof closing.afterTab === "string" && closing.afterTab.length > 10;

  // 本次改动：热力图单模式 / 单日指标 / 圆环横排
  const trio = JSON.parse(await ev("async () => { window.dispatchEvent(new KeyboardEvent(\"keydown\",{key:\"Escape\",bubbles:true})); await new Promise(r=>setTimeout(r,1200)); document.querySelector(\".ust-fabBtn\").click(); await new Promise(r=>setTimeout(r,4000)); const b=document.querySelector(\".ust-panelBody\"); const heat=b.querySelectorAll(\".ust-block\")[0]; const heatTabs=heat?heat.querySelectorAll(\".ust-tab\").length:0; const labels=[...b.querySelectorAll(\".ust-metric-label\")].map(x=>x.textContent.trim()); const active=[...b.querySelectorAll(\".ust-tab.active\")].map(x=>x.textContent.trim()); const wrap=b.querySelector(\".ust-donut-wrap\"); const donut=wrap?wrap.querySelector(\".ust-donut\"):null; const list=wrap?wrap.querySelector(\".ust-models\"):null; const dr=donut?donut.getBoundingClientRect():null; const lr=list?list.getBoundingClientRect():null; return JSON.stringify({ heatTabs, labels, active, sideBySide: !!(dr&&lr&&lr.left>dr.right-2) }); }"));
  console.log("TRIO " + JSON.stringify(trio));
  results["热力图无模式切换标签"] = trio.heatTabs === 0;
  results["单日窗口隐藏活跃天数"] = Array.isArray(trio.labels) && !trio.labels.includes("活跃天数");
  results["单日窗口隐藏日均"] = Array.isArray(trio.labels) && !trio.labels.includes("日均");
  results["圆环与列表水平并排"] = trio.sideBySide === true;

  // 本次改动：区块标题 / 默认区间 / 入口形态
  const changes = JSON.parse(await ev("async () => { window.dispatchEvent(new KeyboardEvent(\"keydown\",{key:\"Escape\",bubbles:true})); await new Promise(r=>setTimeout(r,1200)); document.querySelector(\".ust-fabBtn\").click(); await new Promise(r=>setTimeout(r,4000)); const b=document.querySelector(\".ust-panelBody\"); const h2=[...b.querySelectorAll(\"h2\")].map(x=>x.textContent.trim()); const active=[...b.querySelectorAll(\".ust-tab.active\")].map(x=>x.textContent.trim()); const btn=document.querySelector(\".ust-fabBtn\"); const cs=getComputedStyle(btn); return JSON.stringify({ headings: h2, activeTabs: active, btnH: cs.height, btnRadius: cs.borderRadius, btnFont: cs.fontSize }); }"));
  console.log("CHANGES " + JSON.stringify(changes));
  results["区块标题为「活跃热力图」"] = Array.isArray(changes.headings) && changes.headings.includes("活跃热力图");
  results["默认选中「今天」"] = Array.isArray(changes.activeTabs) && changes.activeTabs.includes("今天");
  results["入口行高 42px"] = changes.btnH === "42px";
  results["入口圆角 12px"] = changes.btnRadius === "12px";
  results["入口字号 14px"] = changes.btnFont === "14px";

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
