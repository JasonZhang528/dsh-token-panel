#!/usr/bin/env node
/**
 * 截图驱动（由 Electron 运行时执行）：chrome-devtools-mcp 打开用量统计页，
 * 依次截取整页（浅色 / 深色）、表格区、tooltip 与侧边栏菜单。
 * 输出末行 SHOTS_RESULT {json}。
 */
import { pathToFileURL } from "node:url";
import { writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const URL_ = process.argv[2];
const ASAR = "D:/Program Files/DeepSeek Harness/resources/app.asar";
const MCP_ROOT = "D:/ProgramData/DeepSeek/.dsh/mcp/chrome-devtools-mcp";
const NODE = "C:/Users/Jason/AppData/Local/Author Software/nvm/.nodejs/node.exe";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const ASSETS = join(ROOT, "assets");
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
const mcp = new Client({ name: "shots", version: "1.0.0" }, { capabilities: {} });
let pageId = 1;

try {
  await mcp.connect(transport);
  await mcp.callTool({ name: "new_page", arguments: { url: URL_ } });
  const pages = await mcp.callTool({ name: "list_pages", arguments: {} });
  pageId = Number(/^(\d+):.*\[selected\]/m.exec(String(pages.content?.[0]?.text ?? ""))?.[1] ?? 1);
  await sleep(9000);

  // 进入统计页并切到「全部」
  const ev = async (fn) => String((await mcp.callTool({ name: "evaluate_script", arguments: { pageId, function: fn } })).content?.[0]?.text ?? "");
  await ev("async () => { const nav = document.querySelector('nav[aria-label]'); const btn = nav ? [...nav.querySelectorAll('button')].find(b => b.getAttribute('aria-label') === '用量统计') : null; if (btn) btn.click(); await new Promise(r => setTimeout(r, 4000)); return 'ok'; }");
  await ev("async () => { const tabs = [...document.querySelectorAll('.ust-tabs .ust-tab')]; const all = tabs.find(x => x.textContent.trim() === '全部'); if (all) all.click(); await new Promise(r => setTimeout(r, 3500)); window.scrollTo(0, 0); return 'ok'; }");
  await sleep(1500);

  // 1) 浅色整页
  let shot = await mcp.callTool({ name: "take_screenshot", arguments: { pageId, fullPage: true, format: "png" } });
  const toBuf = (s) => {
    const t = String(s ?? "");
    const fence = /```(?:\w+)?\n([\s\S]*?)\n```/.exec(t);
    let body = fence ? fence[1] : t;
    body = body.trim().replace(/^data:image\/\w+;base64,/, "");
    return Buffer.from(body, "base64");
  };
  const save = (res, name) => {
    try {
      const d = res.content?.find((c) => c.type === "image");
      if (d && d.data) { writeFileSync(join(ASSETS, name), Buffer.from(d.data, "base64")); return true; }
      const txt = res.content?.find((c) => c.type === "text");
      if (txt) { const buf = toBuf(txt.text); if (buf.length > 1000) { writeFileSync(join(ASSETS, name), buf); return true; } }
    } catch (e) { console.error("save fail " + name + ": " + e.message); }
    return false;
  };
  results["浅色整页"] = save(shot, "panel-light.png");

  // 2) 深色主题
  await ev("() => { document.body.setAttribute('data-ds-dark-theme', ''); return 'ok'; }");
  await sleep(800);
  shot = await mcp.callTool({ name: "take_screenshot", arguments: { pageId, fullPage: true, format: "png" } });
  results["深色整页"] = save(shot, "panel-dark.png");
  await ev("() => { document.body.removeAttribute('data-ds-dark-theme'); return 'ok'; }");

  // 3) 表格区（会话统计）
  await ev("async () => { const b = [...document.querySelectorAll('.ust-h2')].find(x => x.textContent.includes('会话统计')); if (b) b.scrollIntoView({ block: 'start' }); await new Promise(r => setTimeout(r, 800)); return 'ok'; }");
  shot = await mcp.callTool({ name: "take_screenshot", arguments: { pageId, format: "png" } });
  results["表格区"] = save(shot, "panel-tables.png");

  // 4) tooltip：悬停热力图有数据的格子
  await ev("async () => { window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 600)); const cells = document.querySelectorAll('.ust-hitcell'); let target = null; for (let i = cells.length - 1; i >= 0; i--) { const t = cells[i].querySelector('title'); const txt = t ? t.textContent : ''; if (/tokens/.test(txt) && !/无记录/.test(txt) && !/0 tokens/.test(txt)) { target = cells[i]; break; } } if (target) target.dispatchEvent(new MouseEvent('mouseover', { clientX: 300, clientY: 300, bubbles: true, cancelable: true })); await new Promise(r => setTimeout(r, 900)); const b = document.querySelector('.ust-block'); if (b) b.scrollIntoView({ block: 'center' }); await new Promise(r => setTimeout(r, 500)); return 'ok'; }");
  shot = await mcp.callTool({ name: "take_screenshot", arguments: { pageId, format: "png" } });
  results["tooltip"] = save(shot, "panel-tooltip.png");

  // 5) 侧边栏菜单（整页顶部）
  await ev("async () => { document.querySelectorAll('.ust-tip').forEach(t => t.remove()); window.scrollTo(0, 0); await new Promise(r => setTimeout(r, 500)); return 'ok'; }");
  shot = await mcp.callTool({ name: "take_screenshot", arguments: { pageId, format: "png" } });
  results["菜单区"] = save(shot, "menu-entry.png");
} catch (e) {
  results["截图阶段未抛异常"] = false;
  console.error("SHOTS_ERROR " + String(e && e.message ? e.message : e));
} finally {
  try { await mcp.close(); } catch {}
}

console.log("SHOTS_RESULT " + JSON.stringify(results));
process.exit(0);
