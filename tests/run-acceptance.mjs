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
ok("注册 sidebar.footer.action", c.includes('ctx.slots.inject("sidebar.footer.action"'));
ok("已移除 settings.section 注册", !c.includes('"settings.section"'));
ok("入口组件存在", c.includes("function UsageStatsAction(props)"));
ok("宽栏显示文字标签", c.includes("ust-fabLabel"));
ok("窄栏仅显示图标", c.includes("ust-fabBtn--rail"));

section("客户端：弹窗");
ok("弹窗组件存在", c.includes("function UsageStatsModal(props)"));
ok("遮罩 + 面板", c.includes('className: "ust-mask"') && c.includes('className: "ust-panel"'));
ok("点击遮罩关闭", c.includes('onClick: close'));
ok("Esc 关闭", c.includes('e.key === "Escape"'));
ok("关闭按钮存在", c.includes("ust-closeBtn"));
ok("aria 语义完整", c.includes('role: "dialog"') && c.includes('"aria-modal": "true"'));
ok("弹窗样式已定义", c.includes("const MODAL_CSS = `"));
ok("样式合并注入", c.includes("CSS + MODAL_CSS"));
ok("视图内重复标题被隐藏", c.includes(".ust-panelBody .ust-page-title{display:none}"));

section("客户端：数据与外壳");
ok("数据源为 /api/usage-stats", c.includes('fetch("/api/usage-stats"'));
ok("exports.apply 完好", c.includes("exports.apply = apply;"));
ok("exports.inject 完好", c.includes("exports.inject = inject;"));
ok("ModuleLoader 外壳完好", c.trimEnd().endsWith("});"));

section("宿主侧");
const h = readFileSync(HOST, "utf8");
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
