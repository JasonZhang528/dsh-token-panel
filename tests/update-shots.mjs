#!/usr/bin/env node
/**
 * 更新 assets/ 截图：启动 dsh web（随机端口）→ chrome-devtools-mcp 打开页面 → 截图。
 * 用法：node tests/update-shots.mjs
 * 产出：assets/panel-light.png（浅色整页）、assets/panel-dark.png（深色）、
 *       assets/panel-tables.png（表格区）、assets/panel-tooltip.png（tip）、
 *       assets/menu-entry.png（侧边栏菜单）
 */
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const EXE = "D:/Program Files/DeepSeek Harness/DeepSeek Harness.exe";
const CLI = "D:/Program Files/DeepSeek Harness/resources/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js";
const ASAR = "D:/Program Files/DeepSeek Harness/resources/app.asar";
const MCP_ROOT = "D:/ProgramData/DeepSeek/.dsh/mcp/chrome-devtools-mcp";
const NODE = "C:/Users/Jason/AppData/Local/Author Software/nvm/.nodejs/node.exe";
const u = (p) => pathToFileURL(p).href;

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
if (!url) { child.kill(); console.error("dsh web not ready"); process.exit(1); }
console.log("dsh web:", url);

const driver = join(ROOT, "tests", "shot-driver.mjs");
const res = spawnSync(EXE, [driver, url], {
  encoding: "utf8",
  windowsHide: true,
  timeout: 300000,
  env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
});
console.log((res.stdout ?? "") + (res.stderr ?? ""));
child.kill();
process.exit(res.status === 0 ? 0 : 1);
