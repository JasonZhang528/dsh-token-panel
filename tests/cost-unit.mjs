#!/usr/bin/env node
/**
 * token 费用计价 —— 单元测试（不依赖 DSH 运行）
 *
 * 为什么单独一个文件：计价的正确性无法靠「代码里有某个字符串」证明，必须真算一遍。
 * 这里 import lib/index.mjs 的内部函数，用「模拟扫描结果 → buildCache」跑通全链路，
 * 断言每个层级的 cost，覆盖别名归一 / 无价型号 / USD 折算三个关键场景。
 *
 * 用法：node tests/cost-unit.mjs
 */
import { readFile, writeFile, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pathToFileURL, fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(import.meta.url), "..", "..");
// 与宿主同优先级解析 DSH home（被测代码就是这么解析的）
const DSH_HOME = (process.env.DSH_HOME && process.env.DSH_HOME.trim()) || join(homedir(), ".dsh");
const PRICE_FILE = join(DSH_HOME, "storages", "token-stats", "prices-auto.json");

let pass = 0, fail = 0;
const ok = (name, cond, extra) => {
  if (cond) { pass++; console.log("  ok   " + name); }
  else { fail++; console.log("  FAIL " + name + (extra ? " :: " + extra : "")); }
};
const near = (a, b, eps = 1e-9) => typeof a === "number" && Math.abs(a - b) < eps;

// 在文件末尾追加导出，得到可测的内部函数副本
const src = await readFile(join(ROOT, "lib", "index.mjs"), "utf8");
const probe = join(ROOT, "__cost-probe.mjs");
await writeFile(probe, src + [
  "",
  "export function __setPriceTable(t) { priceTable = t; }",
  "export { buildCache, readPriceTable, buildPriceTable, costOf, normalizeModelKey, PRICE_SUPPLEMENT, PRICE_PER_MILLION, USD_TO_CNY };",
  "",
].join("\n"), "utf8");

const M = await import(pathToFileURL(probe).href);

try {
  // 用真实宿主价格表，而不是手写假数据——测试才有意义
  let hostTable = null;
  try { hostTable = M.readPriceTable(await readFile(PRICE_FILE, "utf8")); } catch {}
  const hasHost = !!(hostTable && hostTable.size > 0);
  console.log("== 价格表");
  ok("宿主 prices-auto.json 可读（" + (hasHost ? hostTable.size : 0) + " 个型号）", hasHost);

  const table = M.buildPriceTable(hostTable, M.PRICE_SUPPLEMENT);
  M.__setPriceTable(table);

  console.log("\n== 别名归一");
  // 宿主表用 deepseek-flash 键收录显示名为 "DeepSeek V4.1 Flash" 的型号
  ok("归一 deepseek-v4.1-flash → deepseek-flash", M.normalizeModelKey("deepseek-v4.1-flash", M.PRICE_SUPPLEMENT) === "deepseek-flash");
  ok("未知型号原样返回", M.normalizeModelKey("gpt-5.6-sol", M.PRICE_SUPPLEMENT) === "gpt-5.6-sol");
  ok("归一后表里能查到价", table.has("deepseek-flash"));

  console.log("\n== costOf 单价换算");
  const flashPrice = table.get("deepseek-flash");
  ok("CNY 型号按 1M 单价计费", near(M.costOf({ input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }, flashPrice), 0.15));
  ok("无价返回 null（不是 0）", M.costOf({ input: 1e6 }, null) === null);
  ok("cacheWrite 缺省回退 input 价", flashPrice.cacheWrite === flashPrice.input);

  const usdEntry = [...table.entries()].find(([, v]) => v.currency === "USD");
  if (usdEntry) {
    const got = M.costOf({ input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0 }, usdEntry[1]);
    ok("USD 型号按 " + M.USD_TO_CNY + " 折算 CNY（" + usdEntry[0] + "）", near(got, usdEntry[1].input * M.USD_TO_CNY));
  } else {
    ok("USD 型号折算（宿主表无 USD 型号，跳过）", true);
  }

  // ---- buildCache 全链路 ----
  const mkScan = (byModelArr) => {
    const byModel = new Map(byModelArr);
    return {
      days: new Map([["2026-10-19", {
        total: 21500000, turns: 1, messages: 2, byModel,
        bySession: new Map([["sess-A", {
          total: 21500000, turns: 1, messages: 2, lastTime: 1,
          metrics: { ...byModelArr[0][1] }, byModel, msgTimes: [1], hours: new Map(),
        }]]),
        byProvider: new Map([["workbuddy-ai", {
          metrics: { ...byModelArr[0][1] }, models: new Map(byModelArr),
        }]]),
        msgTimes: [1],
        insights: { tools: new Map(), plugins: new Map(), skills: new Map(), mcp: new Map() },
      }]]),
      hourly: new Map([["2026-10-19", new Map([[10, { total: 21500000, byModel: new Map(byModelArr) }]])]]),
      modelTotals: new Map(byModelArr),
      providerTotals: new Map(), sessionList: [],
      toolCounts: new Map(), pluginCounts: new Map(), skillCounts: new Map(), mcpCounts: new Map(),
      sessionCount: 1, messageCount: 2, longestSessionMs: 60000,
      streaks: { current: 1, longest: 1 }, currentStreak: 1, warnings: [],
    };
  };

  const mDeep = { input: 1e6, output: 5e5, cacheRead: 2e7, cacheWrite: 0, total: 21500000 };
  console.log("\n== buildCache 全链路（deepseek-v4.1-flash，别名归一）");
  const b = M.buildCache(mkScan([["deepseek-v4.1-flash", { ...mDeep }]]));
  // 手算：(1e6x0.15 + 5e5x0.6 + 2e7x0.003) / 1e6 = 0.15+0.3+0.06 = 0.51
  const WANT = 0.51;
  ok("summary.totalCost = 0.51", near(b.summary.totalCost, WANT), String(b.summary.totalCost));
  ok("day.cost = 0.51", near(b.days[0].cost, WANT));
  ok("day.byModel.cost = 0.51", near(b.days[0].byModel[0].cost, WANT));
  ok("day.sessions.cost = 0.51", near(b.days[0].sessions[0].cost, WANT));
  ok("day.providers.cost = 0.51", near(b.days[0].providers[0].cost, WANT));
  ok("day.hours.byModel.cost = 0.51", near(b.days[0].hours[0].byModel[0].cost, WANT));
  ok("无价清单为空（别名已归一）", b.pricing.unpriced.length === 0, JSON.stringify(b.pricing.unpriced));
  ok("pricing.currency = CNY", b.pricing.currency === "CNY");
  ok("pricing.priceLoaded = true", b.pricing.priceLoaded === true);

  console.log("\n== 边界：全无价型号");
  const b1 = M.buildCache(mkScan([["totally-unknown", { ...mDeep }]]));
  ok("totalCost = null（不是 ¥0）", b1.summary.totalCost === null, String(b1.summary.totalCost));
  ok("day.cost = null", b1.days[0].cost === null);
  ok("unpriced 含该型号", b1.pricing.unpriced.includes("totally-unknown"));

  console.log("\n== 边界：有价与无价混合");
  const b2 = M.buildCache(mkScan([
    ["deepseek-v4.1-flash", { input: 1e6, output: 0, cacheRead: 0, cacheWrite: 0, total: 1e6 }],
    ["unknown-xyz", { input: 5e6, output: 0, cacheRead: 0, cacheWrite: 0, total: 5e6 }],
  ]));
  ok("只累计有价部分 = 0.15", near(b2.summary.totalCost, 0.15), String(b2.summary.totalCost));
  ok("无价型号进清单", b2.pricing.unpriced.includes("unknown-xyz"));
  ok("已归一的型号不进清单", !b2.pricing.unpriced.includes("deepseek-v4.1-flash"));
} finally {
  await rm(probe, { force: true });
}

console.log("\n" + "=".repeat(46));
console.log("  通过 " + pass + " / 失败 " + fail);
console.log("=".repeat(46));
process.exit(fail === 0 ? 0 : 1);
