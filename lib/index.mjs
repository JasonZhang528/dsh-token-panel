// dsh-token-panel —— 使用统计(宿主侧)
// 扫描全历史会话(sessionPersistence.list + readFrom),回放事件聚合 Token 用量:
//   - 按天聚合(趋势图 + 热力图素材)
//   - 按小时聚合到天(单日窗口"按小时"趋势图素材)
//   - 按模型聚合(仪表盘)
//   - 额外统计:会话数、消息数、活跃天数、当前连续天数、最常用模型
// 暴露 GET /api/usage-stats   (?refresh=1 强制重新扫描)
// 性能:扫描结果做内存缓存 + 磁盘持久化缓存;过期后"先返回旧数据、后台异步刷新"(SWR),
//       首屏由磁盘缓存秒速渲染,不再因全量扫描卡顿。
import { readFile, writeFile, mkdir, rename } from "node:fs/promises";
import { homedir } from "node:os";
import { join, dirname } from "node:path";

// ---------- 计价（token 费用） ----------
// 价格来源两段：
//   1) 宿主维护的 prices-auto.json（自动更新，覆盖 300+ 型号，USD/CNY 混排）
//   2) 插件自带 supplements.json（宿主表缺型号时兜底，如 deepseek-v4.1-flash）
// 单位口径：单价均为「每 1M token 的货币数」，与宿主表一致。
// 铁律：表里没有的型号**绝不猜价**——不计入金额，单独进 unpriced 清单交给前端展示。
const PRICE_PER_MILLION = 1_000_000;
// USD → CNY 折算汇价（常数，显式可改）。宿主表 USD/CNY 混排，为可加总必须统一币种。
const USD_TO_CNY = 7.2;

// 取某型号的价格（含别名归一 + 补充价目），供扫描期直接计价
function table_get(table, model) {
  if (!table) return null;
  return table.get(normalizeModelKey(model, PRICE_SUPPLEMENT)) || null;
}

function priceFilePath() {
  return join(dshHome(), "storages", "token-stats", "prices-auto.json");
}

// 宿主表是「_」前缀字段混在型号键里的扁平结构，读时要剔掉元数据键
function readPriceTable(raw) {
  let j;
  try { j = JSON.parse(raw); } catch { return null; }
  if (!j || typeof j !== "object") return null;
  const out = new Map();
  for (const [k, v] of Object.entries(j)) {
    if (k.startsWith("_")) continue; // _updatedAt / _currency 等元数据
    if (!v || typeof v !== "object") continue;
    out.set(k, {
      input: typeof v.input === "number" ? v.input : 0,
      output: typeof v.output === "number" ? v.output : 0,
      cacheRead: typeof v.cacheRead === "number" ? v.cacheRead : 0,
      // 宿主表多数型号没有 cacheWrite 单价：缺失时回退到 input 价
      // （缓存写入通常按输入价计费，ahui 缺项时取输入价是行业通行做法）
      cacheWrite: typeof v.cacheWrite === "number" ? v.cacheWrite : (typeof v.input === "number" ? v.input : 0),
      name: typeof v._name === "string" ? v._name : k,
      currency: typeof v._currency === "string" ? v._currency : "USD",
    });
  }
  return out;
}

// 渲染价格表（宿主表 + 插件补充价目）。补充价目优先级更低，不覆盖宿主表。
const PRICE_SUPPLEMENT = {
  models: {},
  aliases: {
    "deepseek-v4.1-flash": "deepseek-flash",
  },
};

function normalizeModelKey(model, supplement) {
  const a = (supplement && supplement.aliases) || {};
  return a[model] || model;
}

function buildPriceTable(hostTable, supplement) {
  const merged = new Map(hostTable || []);
  for (const [k, v] of Object.entries(supplement.models || {})) {
    if (merged.has(k)) continue; // 宿主表有的型号以宿主为准
    merged.set(k, {
      input: v.input || 0,
      output: v.output || 0,
      cacheRead: v.cacheRead || 0,
      cacheWrite: v.cacheWrite ?? v.input ?? 0,
      name: v.name || k,
      currency: v.currency || "CNY",
    });
  }
  return merged;
}

// 按四件套算单个模型的费用（CNY）。无价返回 null，由调用方记入 unpriced。
// 返回数字而非 0 是有意的：0 会被误读成「免费」，null 才能表达「不知道」。
function costOf(metrics, price) {
  if (!price) return null;
  const scale = PRICE_PER_MILLION;
  const rate = price.currency === "USD" ? USD_TO_CNY : 1;
  const amount =
    ((metrics.input || 0) * (price.input || 0) +
      (metrics.output || 0) * (price.output || 0) +
      (metrics.cacheRead || 0) * (price.cacheRead || 0) +
      (metrics.cacheWrite || 0) * (price.cacheWrite || 0)) / scale;
  return amount * rate;
}

// connection:exact 路由优先于 /api prefix 的信任栅栏,必须自己过栅栏(见 handler)
export const inject = ["sessionPersistence", "webServer", "connection"];

// 已知模型 → 固定颜色(与「使用统计子组件库」视觉一致);其余按名称散列取调色板
const MODEL_COLORS = {
  "GLM-5.2": "#3d91e7",
  "jiaorong-deepseek-v4-pro": "#41b87b",
  "glm-5.2": "#8c64ef",
  "deepseek-v4-flash": "#ff4d4f",
  "deepseek-v4-pro": "#faad14",
};
const FALLBACK_PALETTE = [
  "#4da6ff", "#50d682", "#a684ff", "#ff7a9e", "#f2b95b",
  "#5ad0ce", "#e07bd0", "#7ac04f", "#e28a5a", "#6d8ef2",
];

function modelColor(model) {
  if (MODEL_COLORS[model]) return MODEL_COLORS[model];
  let h = 0;
  for (let i = 0; i < model.length; i++) h = (h * 31 + model.charCodeAt(i)) >>> 0;
  return FALLBACK_PALETTE[h % FALLBACK_PALETTE.length];
}

// 把 UNIX 毫秒时间戳折叠成本地日期键 YYYY-MM-DD
function dateKey(ms) {
  try {
    const d = new Date(ms);
    const m = String(d.getMonth() + 1).padStart(2, "0");
    const day = String(d.getDate()).padStart(2, "0");
    return `${d.getFullYear()}-${m}-${day}`;
  } catch {
    return null;
  }
}

// 本地小时 0-23
function hourOf(ms) {
  try {
    return new Date(ms).getHours();
  } catch {
    return null;
  }
}

// 连续活跃天数(活跃日 = 当天有 ≥1 条 usage 事件):当前连续 / 历史最长
function computeStreaks(activeKeys) {
  const sorted = [...activeKeys].sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const key of sorted) {
    // 日期键 YYYY-MM-DD 按整日比较,相邻日恰好差 86400000ms
    const diff = prev === null ? -1 : Math.round((Date.parse(key) - Date.parse(prev)) / 86_400_000);
    run = diff === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    prev = key;
  }
  let current = 0;
  if (sorted.length > 0 && activeKeys.has(dateKey(Date.now()))) {
    current = 1;
    const d = new Date();
    while (true) {
      d.setDate(d.getDate() - 1);
      if (activeKeys.has(dateKey(d.getTime()))) current += 1;
      else break;
    }
  }
  return { current, longest };
}

function emptyMetrics() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
}

function addMetrics(target, usage) {
  const input = typeof usage?.inputTokens === "number" ? usage.inputTokens : 0;
  const output = typeof usage?.outputTokens === "number" ? usage.outputTokens : 0;
  const cacheRead = typeof usage?.cacheReadTokens === "number" ? usage.cacheReadTokens : 0;
  const cacheWrite = typeof usage?.cacheWriteTokens === "number" ? usage.cacheWriteTokens : 0;
  target.input += input;
  target.output += output;
  target.cacheRead += cacheRead;
  target.cacheWrite += cacheWrite;
  target.total += input + output + cacheRead + cacheWrite;
}

function usageTotal(usage) {
  if (!usage) return 0;
  return (usage.inputTokens ?? 0) + (usage.outputTokens ?? 0) + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0);
}

// DSH 核心工具集：插件榜只统计「非核心工具」，否则 run_code/pwsh 这类会长期霸榜。
// 命名与官方工具表对齐；新增核心工具时应同步补入。
const CORE_TOOLS = new Set([
  "bash", "pwsh", "read", "read_image", "write", "edit", "glob", "grep",
  "todo_write", "ask_user_question", "present", "run_code",
  "subagent", "subagent_fork", "interrupt_agent", "list_agents", "send_message",
  "job_kill", "job_list", "job_output", "wait_agent",
  "workflow", "ralph", "create_goal", "get_goal", "update_goal", "exit_plan_mode",
  "web_search", "web_fetch", "load_workspace_dependencies",
  "session_search", "session_event_search", "session_event_read", "session_event_trace", "session_trace",
  "schedule_create", "schedule_list", "schedule_delete", "schedule_update",
  "skill", "skill_mcp_list",
  "cordis_define", "cordis_run", "cordis_stop", "cordis_undefine",
  "cordis_inspect_list", "cordis_inspect_query", "cordis_inspect_self",
  "team_task_create", "team_task_get", "team_task_list", "team_task_update",
  "spawn_teammate",
]);

// 聊天段切分阈值：相邻消息间隔超过 30 分钟即视为新的一段（Codex 口径）
const SEGMENT_GAP_MS = 30 * 60 * 1000;

// 把「按毫秒的时间点序列」折算成活跃时长：>30min 断开，各段求和。
// 与「末条 − 首条」的区别在于剔除中途闲置，更贴近真实投入。
function activeMsOf(times) {
  if (!times || times.length < 2) return 0;
  const sorted = [...times].sort((a, b) => a - b);
  let total = 0;
  for (let i = 1; i < sorted.length; i++) {
    const gap = sorted[i] - sorted[i - 1];
    if (gap > SEGMENT_GAP_MS) continue; // 跨段闲置不计
    total += gap;
  }
  return total;
}

// MCP 工具名形如 mcp__<server>__<tool>，归并到 server 维度
function mcpServerOf(name) {
  if (typeof name !== "string" || name.indexOf("mcp__") !== 0) return null;
  const rest = name.slice(5);
  const i = rest.indexOf("__");
  return i > 0 ? rest.slice(0, i) : rest;
}

// 有限并发池:最多并发 limit 个任务;超过 deadline(ms) 提前返回部分结果(已处理的计入)
async function mapLimit(items, limit, deadline, fn) {
  const out = new Array(items.length);
  let i = 0;
  const run = async () => {
    while (i < items.length) {
      if (Date.now() > deadline) return; // 超时:跳过未处理项,保留已处理结果(部分结果)
      const cur = i++;
      out[cur] = await fn(items[cur], cur);
    }
  };
  const n = Math.max(1, Math.min(limit || 8, items.length) || 1);
  await Promise.all(Array.from({ length: n }, run));
  return out;
}

// 一次全量扫描:返回聚合数据结构
async function scanSessions(sessionPersistence, { timeoutMs = 20000 } = {}) {
  const days = new Map();   // dateKey -> { total, turns, byModel: Map(model->metrics) }
  const hourly = new Map(); // dateKey -> Map<hour, { total, byModel: Map(model->metrics) }>
  const modelTotals = new Map(); // model -> metrics
  const providerTotals = new Map(); // provider -> { metrics, models: Map(model->metrics) }
  const sessionList = []; // 每个会话一行:标题/时间/用量/模型明细
  const warnings = []; // 扫描过程中的失败/降级提示(供前端展示)
  const usageDays = new Set(); // 当天有 ≥1 条 usage 事件 → 活跃日(summary 连续天数口径)
  let longestSessionMs = 0; // 最长聊天时长素材(分段活跃口径,见下)
  // 活动洞察素材：工具调用 / Skill / MCP 三类计数（全历史）
  const toolCounts = new Map(); // 工具名 -> 次数(含核心工具,用于「已探索工具」与总数)
  const pluginCounts = new Map(); // 非核心工具 -> 次数(插件榜)
  const skillCounts = new Map(); // skill 名 -> 次数
  const mcpCounts = new Map(); // mcp server -> 次数
  // 按天的洞察计数：活动洞察与三榜 TOP5 要跟随日期区间筛选，
  // 故同源再记一份「天 -> 计数」，前端在窗口内自行汇总
  const ensureDayInsights = (key) => {
    const day = ensureDay(key);
    if (!day.insights) day.insights = { tools: new Map(), plugins: new Map(), skills: new Map(), mcp: new Map() };
    return day.insights;
  };
  const bumpDay = (map, name, n = 1) => map.set(name, (map.get(name) || 0) + n);
  const deadline = Date.now() + timeoutMs;

  const ensureDay = (key) => {
    let d = days.get(key);
    if (!d) {
      // bySession / byProvider：按天细分的会话与供应商桶，
      // 供前端在本地按「时间范围」重算而不必重新扫描全量会话
      d = { total: 0, turns: 0, messages: 0, byModel: new Map(), bySession: new Map(), byProvider: new Map(), msgTimes: [] };
      days.set(key, d);
    }
    return d;
  };
  const ensureModel = (map, model) => {
    let m = map.get(model);
    if (!m) {
      m = emptyMetrics();
      map.set(model, m);
    }
    return m;
  };
  // 会话 × 天的累计桶：Token / 轮次 / 消息 / 模型明细 / 最近活动
  const ensureSessDay = (day, sessionId) => {
    let ss = day.bySession.get(sessionId);
    if (!ss) {
      // metrics 保留输入/输出/缓存四件套：前端才能算「缓存命中」与「命中率」
      // msgTimes 用于按分段活跃口径折算该会话当天的时长
      // hours 为「会话 × 天 × 小时」桶：用量页点选某天时联动该天的小时分布
      ss = { total: 0, turns: 0, messages: 0, lastTime: null, metrics: emptyMetrics(), byModel: new Map(), msgTimes: [], hours: new Map(), insights: null };
      day.bySession.set(sessionId, ss);
    }
    return ss;
  };
  // 会话 × 天 × 小时桶（0-23）：点选日期后联动该天的小时用量分布
  const ensureSessDayHour = (ss, hour) => {
    let h = ss.hours.get(hour);
    if (!h) { h = { metrics: emptyMetrics(), byModel: new Map(), turns: 0, messages: 0 }; ss.hours.set(hour, h); }
    return h;
  };
  // 供应商 × 天的累计桶：输入 / 输出 / 缓存 / 总量 + 模型明细
  const ensureProvDay = (day, provider) => {
    let pv = day.byProvider.get(provider);
    if (!pv) {
      pv = { metrics: emptyMetrics(), models: new Map() };
      day.byProvider.set(provider, pv);
    }
    return pv;
  };
  // account:按天 + 按小时 + (会话|供应商)按天 同时累计
  const account = (dayKey, hour, model, usage, provider, sessionId, time) => {
    if (!dayKey) return;
    const day = ensureDay(dayKey);
    const dayModel = ensureModel(day.byModel, model);
    const cumModel = ensureModel(modelTotals, model);
    addMetrics(dayModel, usage);
    addMetrics(cumModel, usage);
    day.total += usageTotal(usage);
    // 会话维度(按天):当前窗口内该会话的 Token 与模型明细
    if (sessionId) {
      const ss = ensureSessDay(day, sessionId);
      ss.total += usageTotal(usage);
      addMetrics(ss.metrics, usage);
      addMetrics(ensureModel(ss.byModel, model), usage);
      if (typeof time === "number" && (ss.lastTime === null || time > ss.lastTime)) ss.lastTime = time;
      // 会话 × 天 × 小时：用量页点选某天时，取该天的小时分布（跨天同钟点不合并）
      if (typeof hour === "number") {
        const sh = ensureSessDayHour(ss, hour);
        addMetrics(sh.metrics, usage);
        addMetrics(ensureModel(sh.byModel, model), usage);
      }
    }
    // 供应商维度(缺 provider 时归入 other)
    const pv = provider || "other";
    let pb = providerTotals.get(pv);
    if (!pb) { pb = { metrics: emptyMetrics(), models: new Map() }; providerTotals.set(pv, pb); }
    addMetrics(pb.metrics, usage);
    addMetrics(ensureModel(pb.models, model), usage);
    const dp = ensureProvDay(day, pv);
    addMetrics(dp.metrics, usage);
    addMetrics(ensureModel(dp.models, model), usage);
    if (typeof hour === "number") {
      let hm = hourly.get(dayKey);
      if (!hm) { hm = new Map(); hourly.set(dayKey, hm); }
      let hb = hm.get(hour);
      if (!hb) { hb = { total: 0, byModel: new Map() }; hm.set(hour, hb); }
      const hmModel = ensureModel(hb.byModel, model);
      addMetrics(hmModel, usage);
      hb.total += usageTotal(usage);
    }
  };

  let sessions;
  let messageCount = 0;
  try {
    sessions = sessionPersistence.list ? await sessionPersistence.list() : [];
  } catch (e) {
    sessions = [];
    warnings.push("无法枚举会话：" + (e && e.message ? e.message : e));
  }

  const scanOne = async (snapshot) => {
    // list() 项可能是 { header, ... } 快照,也可能直接就是 header(版本差异),两种都兼容
    const header = snapshot && typeof snapshot === "object" && snapshot.header ? snapshot.header : snapshot;
    let events;
    try {
      if (typeof sessionPersistence.readFrom === "function") {
        // 旧接口(0.1.0-rc.5 时代):service 级 readFrom
        ({ events } = await sessionPersistence.readFrom(header.id, 0));
      } else {
        // 0.1.5-rc.1:handle 式接口(官方 dsh-message-feedback 同一用法)
        const handle = await sessionPersistence.open(header.id, "read");
        try {
          ({ events } = await handle.read(0));
        } finally {
          await handle.close();
        }
      }
    } catch (e) {
      warnings.push("会话读取失败 " + (header.id ?? "?") + "：" + (e && e.message ? e.message : e));
      return;
    }
    // currentModel 缺失时归一为 "other"(杂项),避免 unknown 散落为独立饼块(规范 H6)
    let currentModel = "other";
    let currentProvider = "other";
    let lastTurn = null;
    let lastTime = null; // 会话内最后事件 time(毫秒)
    // 会话名:优先取 header.title/name;否则回落到日志里的 session/title 事件(用户改名即在此)
    let sessionTitle = (header && (header.title || header.name)) || null;
    const seenSteps = new Set();
    // 单会话累计(用于会话统计 + 会话内模型明细)
    const sessModels = new Map();
    const sessMetrics = emptyMetrics(); // 输入/输出/缓存四件套（会话统计算命中与命中率）
    let sessTotal = 0, sessTurns = 0, sessMessages = 0, sessFirstTime = null, sessLastTime = null;
    const sessMsgTimes = []; // 本会话全部消息时间点（分段活跃时长素材）
    // 本会话的工具 / 插件 / Skill / MCP 计数：会话「用量」tab 的 TOP5 素材
    const sessToolCounts = new Map();
    const sessDayInsights = new Map(); // dateKey -> { tools, plugins, skills, mcp }
    const sessPluginCounts = new Map();
    const sessSkillCounts = new Map();
    const sessMcpCounts = new Map();
    // 会话 × 天的洞察计数：会话「用量」tab 按日期筛选 TOP5 的素材。
    // 键 = dateKey，值 = { tools, plugins, skills, mcp }，各自为 Map(name -> count)。
    // 与全历史 / 日级口径完全一致：MCP 只进 MCP 榜，非核心工具才进插件榜，skill 解析 name 参数。
    const ensureSessDayInsights = (key) => {
      if (!sessDayInsights.has(key)) {
        sessDayInsights.set(key, { tools: new Map(), plugins: new Map(), skills: new Map(), mcp: new Map() });
      }
      return sessDayInsights.get(key);
    };
    // 与全历史口径完全一致：MCP 工具只进 MCP 榜，非核心工具才进插件榜
    const bumpSessInsights = (tn, args) => {
      sessToolCounts.set(tn, (sessToolCounts.get(tn) || 0) + 1);
      const srv = mcpServerOf(tn);
      const asPlugin = !CORE_TOOLS.has(tn) && !srv;
      if (asPlugin) sessPluginCounts.set(tn, (sessPluginCounts.get(tn) || 0) + 1);
      if (srv) sessMcpCounts.set(srv, (sessMcpCounts.get(srv) || 0) + 1);
      if (tn === "skill") {
        let sn = "skill";
        try {
          const parsed = typeof args === "string" ? JSON.parse(args) : args;
          if (parsed && typeof parsed.name === "string" && parsed.name) sn = parsed.name;
        } catch { /* 参数非 JSON 时退回通用名 */ }
        sessSkillCounts.set(sn, (sessSkillCounts.get(sn) || 0) + 1);
      }
    };
    // 会话级小时桶（0-23）：会话「用量」tab 的小时趋势素材。
    // 按「本地小时」累加整段会话历史（跨天同一钟点合并），容器 [@hour] 避免稀疏数组空洞。
    const sessHours = new Map();
    const ensureSessHour = (hour) => {
      let h = sessHours.get(hour);
      if (!h) { h = { metrics: emptyMetrics(), byModel: new Map(), turns: 0, messages: 0 }; sessHours.set(hour, h); }
      return h;
    };
    const accountOnce = (model, ev, usage) => {
      const turn = ev.data?.turn;
      const step = ev.data?.step;
      if (typeof turn === "number" && typeof step === "number") {
        const stepKey = `${turn}:${step}`;
        if (seenSteps.has(stepKey)) return;
        seenSteps.add(stepKey);
      }
      const t = usageTotal(usage);
      sessTotal += t;
      addMetrics(sessMetrics, usage);
      addMetrics(ensureModel(sessModels, model), usage);
      if (typeof ev.time === "number") {
        if (sessFirstTime === null || ev.time < sessFirstTime) sessFirstTime = ev.time;
        if (sessLastTime === null || ev.time > sessLastTime) sessLastTime = ev.time;
      }
      const dayKey = dateKey(ev.time);
      // 会话 × 天的用量明细由 account() 统一累计，避免总量或模型明细重复计数
      account(dayKey, hourOf(ev.time), model, usage, currentProvider, header && header.id, ev.time);
      // 会话级小时桶：同一钟点跨天合并，只累加带 usage 的 assistant/message
      const hh = hourOf(ev.time);
      if (typeof hh === "number") {
        const hb = ensureSessHour(hh);
        addMetrics(hb.metrics, usage);
        addMetrics(ensureModel(hb.byModel, model), usage);
      }
    };
    for (const ev of events || []) {
      if (!ev || typeof ev !== "object") continue;
      if (typeof ev.time === "number") lastTime = ev.time;
      switch (ev.type) {
        case "session/title":
          // 会话名:标题可由模型生成(fallback/provider)或用户改名(source.kind=user),取最后一次
          if (ev.data && typeof ev.data.title === "string" && ev.data.title.trim()) {
            sessionTitle = ev.data.title.trim();
          }
          break;
        case "request/context":
          currentModel = ev.data && typeof ev.data.model === "string" ? ev.data.model : currentModel;
          // 供应商同样来自 request/context(实测事件字段:data.provider)
          currentProvider = ev.data && typeof ev.data.provider === "string" ? ev.data.provider : currentProvider;
          break;
        case "step/end":
          // turns 官方口径:一个新 turn 记 1 次。以 step/end 为权威——每个 step 必然发出,
          // 覆盖 completed/failed/cancelled/max-tokens;而 assistant/message 会漏 cancelled、多算 max-tokens。
          if (typeof ev.data.turn === "number" && ev.data.turn !== lastTurn) {
            lastTurn = ev.data.turn;
            const key = dateKey(ev.time);
            if (key) {
              ensureDay(key).turns += 1;
              const sid = header && header.id;
              if (sid) ensureSessDay(ensureDay(key), sid).turns += 1;
              // 会话级小时桶同步累计轮次
              const sh = hourOf(ev.time);
              if (typeof sh === "number") ensureSessHour(sh).turns += 1;
            }
            sessTurns += 1;
          }
          break;
        case "user/message": {
          // 用户发话同样代表一次交互，计入时长分段（但不计 usage）
          if (typeof ev.time === "number") sessMsgTimes.push(ev.time);
          const uk = dateKey(ev.time);
          if (uk) {
            const day = ensureDay(uk);
            day.msgTimes.push(ev.time);
            const sid = header && header.id;
            if (sid) ensureSessDay(day, sid).msgTimes.push(ev.time);
            const sh = hourOf(ev.time);
            if (typeof sh === "number") ensureSessHour(sh).messages += 1;
          }
          break;
        }
        case "tool/call": {
          // 外层工具调用：PTC 模式下多为 run_code，真实工具另见 tool/ptc-dispatch-start
          const tn = ev.data && typeof ev.data.name === "string" ? ev.data.name : null;
          if (tn) {
            toolCounts.set(tn, (toolCounts.get(tn) || 0) + 1);
            const srv = mcpServerOf(tn);
            // MCP 工具（mcp__<server>__<tool>）不算插件：它归到 MCP 榜。
            // 若沿用「非核心工具即插件」，同一条调用会同时进插件与 MCP 两榜，
            // 插件榜还会冒出 mcp__ 开头的怪名（如 mcp__siyuan__http_request）。
            const asPlugin = !CORE_TOOLS.has(tn) && !srv;
            if (asPlugin) pluginCounts.set(tn, (pluginCounts.get(tn) || 0) + 1);
            if (srv) mcpCounts.set(srv, (mcpCounts.get(srv) || 0) + 1);
            const dk = dateKey(ev.time);
            if (dk) {
              const di = ensureDayInsights(dk);
              bumpDay(di.tools, tn);
              if (asPlugin) bumpDay(di.plugins, tn);
              if (srv) bumpDay(di.mcp, srv);
            }
            bumpSessInsights(tn, ev.data.arguments);
            if (dk) {
              const di2 = ensureSessDayInsights(dk);
              di2.tools.set(tn, (di2.tools.get(tn) || 0) + 1);
              if (asPlugin) di2.plugins.set(tn, (di2.plugins.get(tn) || 0) + 1);
              if (srv) di2.mcp.set(srv, (di2.mcp.get(srv) || 0) + 1);
            }
            if (tn === "skill") {
              let sn = "skill";
              try {
                const args = typeof ev.data.arguments === "string" ? JSON.parse(ev.data.arguments) : ev.data.arguments;
                if (args && typeof args.name === "string" && args.name) sn = args.name;
              } catch { /* 参数非 JSON 时退回通用名 */ }
              skillCounts.set(sn, (skillCounts.get(sn) || 0) + 1);
              if (dk) bumpDay(ensureDayInsights(dk).skills, sn);
            }
          }
          break;
        }
        case "tool/ptc-dispatch-start": {
          // PTC 内层真实工具：这才是「用了哪些工具」的权威来源
          const tn = ev.data && typeof ev.data.name === "string" ? ev.data.name : null;
          if (tn) {
            toolCounts.set(tn, (toolCounts.get(tn) || 0) + 1);
            const srv = mcpServerOf(tn);
            // MCP 工具不算插件（详见另一处 tool/call 的说明），避免两榜重复计数
            const asPlugin = !CORE_TOOLS.has(tn) && !srv;
            if (asPlugin) pluginCounts.set(tn, (pluginCounts.get(tn) || 0) + 1);
            if (srv) mcpCounts.set(srv, (mcpCounts.get(srv) || 0) + 1);
            const dk = dateKey(ev.time);
            if (dk) {
              const di = ensureDayInsights(dk);
              bumpDay(di.tools, tn);
              if (asPlugin) bumpDay(di.plugins, tn);
              if (srv) bumpDay(di.mcp, srv);
            }
            bumpSessInsights(tn, ev.data.arguments);
            if (dk) {
              const di2 = ensureSessDayInsights(dk);
              di2.tools.set(tn, (di2.tools.get(tn) || 0) + 1);
              if (asPlugin) di2.plugins.set(tn, (di2.plugins.get(tn) || 0) + 1);
              if (srv) di2.mcp.set(srv, (di2.mcp.get(srv) || 0) + 1);
            }
            if (tn === "skill") {
              let sn = "skill";
              try {
                const raw = ev.data.arguments;
                const args = typeof raw === "string" ? JSON.parse(raw) : raw;
                if (args && typeof args.name === "string" && args.name) sn = args.name;
              } catch { /* 参数非 JSON 时退回通用名 */ }
              skillCounts.set(sn, (skillCounts.get(sn) || 0) + 1);
              if (dk) bumpDay(ensureDayInsights(dk).skills, sn);
            }
          }
          break;
        }
        case "assistant/message": {
          messageCount += 1;
          const activeKey = dateKey(ev.time);
          if (typeof ev.time === "number") {
            sessMsgTimes.push(ev.time);
            if (activeKey) {
              const day = ensureDay(activeKey);
              day.msgTimes.push(ev.time);
              // 会话×天 也要记时间点，否则按会话的时长恒为 0（曾漏此步）
              const sid = header && header.id;
              if (sid) ensureSessDay(day, sid).msgTimes.push(ev.time);
            }
          }
          // 消息数按天累计，即使个别消息没有 usage，也要能按日期筛选
          if (activeKey) {
            ensureDay(activeKey).messages += 1;
            const sid = header && header.id;
            if (sid) ensureSessDay(ensureDay(activeKey), sid).messages += 1;
            const sh = hourOf(ev.time);
            if (typeof sh === "number") ensureSessHour(sh).messages += 1;
          }
          // usage 只在每步一次的全量 assistant/message 上取;assistant/chunk 的 usage 是同一步的相同全量值,再计会重复,故不再消费
          if (ev.data && ev.data.usage !== undefined) {
            if (activeKey) usageDays.add(activeKey);
            // 优先从消息自身识别模型(兜底 currentModel / other)
            const m = ev.data && typeof ev.data.model === "string" ? ev.data.model : currentModel;
            sessMessages += 1;
            accountOnce(m, ev, ev.data.usage);
          }
          break;
        }
        default:
          break;
      }
    }
    // 会话维度汇总(仅收录有用量的会话)
    if (sessTotal > 0) {
      sessionList.push({
        id: header && header.id ? header.id : "?",
        ...sessMetrics,
        title: sessionTitle || (header && (header.title || header.name)) || null,
        cwd: (header && header.cwd) || null,
        createdAt: (header && header.createdAt) || sessFirstTime || null,
        lastTime: sessLastTime,
        total: sessTotal,
        turns: sessTurns,
        messages: sessMessages,
        // 分段活跃时长：>30min 断开后求和，剔除中途闲置
        durationMs: activeMsOf(sessMsgTimes),
        byModel: [...sessModels.entries()].map(([model, m]) => ({ model, color: modelColor(model), ...m })),
        // 会话级小时桶（0-23 升序，含输入/输出/缓存四件套与逐模型明细）：
        // 跨天同一钟点合并，作为「未点选日期」时的默认小时趋势素材
        hours: [...sessHours.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([hour, h]) => ({
            hour,
            ...h.metrics,
            turns: h.turns,
            messages: h.messages,
            // byModel 带 cost：会话「用量」tab 的小时趋势在「费用」模式下需要按型号取费用。
            // 无价型号计为 0（与主面板口径一致：柱高只反映有价的那些）。
            byModel: [...h.byModel.entries()].map(([model, m]) => ({
              model, color: modelColor(model), ...m,
              cost: priceTable ? costOf(m, table_get(priceTable, model)) : null,
            })),
          })),
        // 按天的小时桶（会话 × 天 × 小时）：点选日期后联动当天的小时分布。
        // 只输出有用量的天，且与 hours 的口径不同——这里不跨天合并钟点。
        dayHours: [...days.entries()]
          .map(([date, d]) => {
            const ss = (d.bySession || new Map()).get(header && header.id);
            if (!ss || !ss.hours || ss.hours.size === 0) return null;
            const rows = [...ss.hours.entries()]
              .sort((a, b) => a[0] - b[0])
              .map(([hour, h]) => ({
                hour,
                ...h.metrics,
                turns: h.turns,
                messages: h.messages,
                // 同上：dayHours 的 byModel 也需带 cost，供费用模式下的小时趋势使用
                byModel: [...h.byModel.entries()].map(([model, m]) => ({
                  model, color: modelColor(model), ...m,
                  cost: priceTable ? costOf(m, table_get(priceTable, model)) : null,
                })),
              }));
            return { date, total: rows.reduce((s, r) => s + (r.total || 0), 0), hours: rows };
          })
          .filter(Boolean)
          .sort((a, b) => (a.date < b.date ? -1 : 1)),
        // 本会话洞察与三榜 TOP5：会话「用量」tab 直接消费，口径与全历史一致
        insights: {
          totalToolCalls: [...sessToolCounts.values()].reduce((a, b) => a + b, 0),
          distinctTools: sessToolCounts.size,
          totalSkillUses: [...sessSkillCounts.values()].reduce((a, b) => a + b, 0),
          distinctSkills: sessSkillCounts.size,
          totalMcpCalls: [...sessMcpCounts.values()].reduce((a, b) => a + b, 0),
          distinctMcp: sessMcpCounts.size,
          topPlugins: topOf(sessPluginCounts),
          topSkills: topOf(sessSkillCounts),
          topMcp: topOf(sessMcpCounts),
          topTools: topOf(sessToolCounts),
        },
        // 会话 × 天 × 洞察：会话「用量」tab 按日期筛选 TOP5 的素材。
        // sessDayInsights 是扫描期维护的 Map（dateKey -> 各榜 Map），
        // 此处转成可序列化数组，随 sessionList 一起下发。
        dayInsights: [...sessDayInsights.entries()].map(([date, di]) => ({
          date,
          tools: [...di.tools.entries()].map(([name, count]) => ({ name, count })),
          plugins: [...di.plugins.entries()].map(([name, count]) => ({ name, count })),
          skills: [...di.skills.entries()].map(([name, count]) => ({ name, count })),
          mcp: [...di.mcp.entries()].map(([name, count]) => ({ name, count })),
        })),
      });
    }
    // 最长聊天时长：同样采用分段活跃口径，保证与各会话行自洽
    const sessActive = activeMsOf(sessMsgTimes);
    if (sessActive > longestSessionMs) longestSessionMs = sessActive;
  };

  // 有限并发读取会话(规范 H4);越期自动停止(规范 H5 超时保护)
  await mapLimit(sessions || [], 8, deadline, scanOne);
  if (Date.now() > deadline) warnings.push("扫描超时，返回部分统计结果");

  // 计算当前连续活跃天数
  let currentStreak = 0;
  const sortedDates = [...days.keys()].sort();
  if (sortedDates.length > 0) {
    const todayKey = dateKey(Date.now());
    const lastActive = sortedDates[sortedDates.length - 1];
    if (lastActive === todayKey) {
      currentStreak = 1;
      const d = new Date();
      while (true) {
        d.setDate(d.getDate() - 1);
        if (days.has(dateKey(d.getTime()))) {
          currentStreak += 1;
        } else {
          break;
        }
      }
    }
  }

  return {
    days, hourly, modelTotals, providerTotals, sessionList,
    sessionCount: sessions.length, messageCount, currentStreak,
    streaks: computeStreaks(usageDays), longestSessionMs, warnings,
    // 活动洞察素材
    toolCounts, pluginCounts, skillCounts, mcpCounts,
  };
}

// ---------- 缓存 ----------
// 内存 + 磁盘双层缓存;SWR:过期后先返回旧数据、后台异步刷新,首屏不因全量扫描阻塞。
let cache = null;
let cacheAt = 0;
// Increment when the day-level response shape changes; old cache cannot support date-filtered tables.
// 2 → 按天新增会话/供应商明细；3 → 会话与供应商明细再补缓存四件套（命中率所需）
// 4 → 会话补分段活跃时长；新增工具/Skill/MCP 计数与洞察数据
// 5 → 按天下发洞察计数（活动洞察与三榜 TOP5 支持日期区间筛选）
// 6：MCP 工具不再计入插件榜（pluginCounts 排除 mcp__<server>__<tool>），
// 分类口径变了，旧缓存必须失效重扫，否则插件榜仍会出现 mcp__ 开头的条目。
// 7：会话行新增 insights（会话级工具 / Skill / MCP 计数与 TOP5），
// 旧缓存没有该字段，会话「用量」tab 的 TOP5 会整块缺失。
// 8：会话行新增 hours（会话 × 小时桶），旧缓存无此字段，小时趋势会整条为 0。
// 9：会话行新增 dayHours（会话 × 天 × 小时桶），点击日期联动小时分布依赖此字段。
// 10：新增 token 费用（CNY）字段。旧缓存无 cost/pricing，前端会把费用读成 undefined，
// 必须失效重扫。
// 11：新增会话 × 天洞察（days[].sessions[].insights）。旧缓存无此字段，
// 会话「用量」tab 的 TOP5 无法按日期筛选。
// 12：会话小时桶的 cost 从「无价记 0」改为「无价下发 null」，与全站「未定价」口径一致；
//      旧缓存里记 0 的值必须失效重扫。
const CACHE_SCHEMA_VERSION = 12;
const CACHE_TTL = 60_000; // 60s 后触发后台刷新(SWR)
let inflight = null; // 并发重扫互斥:并发期间共享同一份扫描结果(规范 H3)
let priceTable = null;   // 渲染价格表（宿主表 + 补充价目），null = 尚未加载
let priceLoadedAt = 0;   // 加载时间戳，配合 PRICE_TTL 定期重读

// DSH home 解析：与宿主 resolveDshHome 同优先级（显式 > $DSH_HOME > ~/.dsh）。
// 不能只用 homedir()——宿主可能被 DSH_HOME 重定向到别处，
// 那时 prices-auto.json 与会话缓存在重定向后的根里，读 homedir() 会静默取不到价格。
function dshHome() {
  const env = process.env.DSH_HOME;
  if (env && env.trim()) return env.trim();
  return join(homedir(), ".dsh");
}

function cacheFilePath() {
  return join(dshHome(), "profiles", "web", "usage-stats-cache.json");
}

// 读取并渲染价格表。宿主表缺失或损坏时退回纯补充价目，
// 两条路都失败则 priceTable = null —— 全站费用显示「未定价」而非崩溃。
async function loadPriceTable() {
  try {
    const raw = await readFile(priceFilePath(), "utf8");
    const host = readPriceTable(raw);
    if (!host) throw new Error("prices-auto.json 解析失败");
    priceTable = buildPriceTable(host, PRICE_SUPPLEMENT);
  } catch (e) {
    // 宿主表不可用（文件缺失 / 损坏 / 未生成）：退回补充价目，
    // 至少让补充价目里的型号有价可用
    priceTable = buildPriceTable(null, PRICE_SUPPLEMENT);
  }
  priceLoadedAt = Date.now();
  return priceTable;
}

async function loadDiskCache() {
  try {
    const s = await readFile(cacheFilePath(), "utf8");
    const j = JSON.parse(s);
    if (j && typeof j === "object" && j.schemaVersion === CACHE_SCHEMA_VERSION && (j.ok || j.error)) return j;
    return null;
  } catch {
    return null;
  }
}

async function persistDiskCache(data) {
  const p = cacheFilePath();
  const tmp = p + ".tmp";
  try {
    await mkdir(dirname(p), { recursive: true });
    await writeFile(tmp, JSON.stringify(data), "utf8");
    await rename(tmp, p).catch(() => writeFile(p, JSON.stringify(data), "utf8"));
  } catch {
    // 写盘失败不影响主流程(下次启动退化回全量扫描)
  }
}

// 计数 Map -> 按次数倒序的 TOP-N 列表（活动洞察、三榜与会话级榜单共用）
function topOf(map, n = 5) {
  return [...(map || new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
}

// 把扫描结果转成可序列化、可直接返回给前端的响应结构
function buildCache(s) {
  // ---- token 费用（CNY）----
  // 每个层级的 metrics 都带 input/output/cacheRead/cacheWrite 四件套，
  // 计价只做「查价 × 四件套」的换算，不改扫描逻辑。
  // priceTable 为 null（价格表加载失败）时全站费用显示未定价，不影响其余统计。
  const table = priceTable;
  // 费用随扫描结果一起算，故 buildCache 需要同步拿到价格表
  const costOfMetrics = (metrics, model) => {
    if (!table) return null;
    const key = normalizeModelKey(model, PRICE_SUPPLEMENT);
    const price = table.get(key);
    return price ? costOf(metrics, price) : null;
  };
  // 累计某个层级的费用；同时收集无价型号，交给前端在 UI 上明示
  let unpriced = new Set();
  const sumCost = (modelMetrics) => {
    let sum = 0;
    let any = false;
    for (const [model, m] of modelMetrics) {
      const c = costOfMetrics(m, model);
      if (c === null) unpriced.add(model);
      else { sum += c; any = true; }
    }
    return any ? sum : null;
  };
  const dayList = [...s.days.entries()]
    .map(([date, d]) => {
      const hours = [...(s.hourly.get(date) || new Map()).entries()]
        .map(([hour, o]) => ({
          hour,
          total: o.total,
          byModel: [...o.byModel.entries()].map(([model, m]) => ({
            model, color: modelColor(model), ...m,
            cost: costOfMetrics(m, model),
          })),
        }))
        .sort((a, b) => a.hour - b.hour);
      // 会话 / 供应商的「按天」明细:前端按选定时间范围本地重算,不回传窗口(规范 H3)
      const sessions = [...(d.bySession || new Map()).entries()].map(([id, ss]) => ({
        id,
        total: ss.total,
        input: (ss.metrics && ss.metrics.input) || 0,
        output: (ss.metrics && ss.metrics.output) || 0,
        cacheRead: (ss.metrics && ss.metrics.cacheRead) || 0,
        cacheWrite: (ss.metrics && ss.metrics.cacheWrite) || 0,
        turns: ss.turns,
        messages: ss.messages,
        lastTime: ss.lastTime,
        // 该会话当天的分段活跃时长（前端按时间范围累加）
        durationMs: activeMsOf(ss.msgTimes),
        byModel: [...ss.byModel.entries()].map(([model, m]) => ({
          model, color: modelColor(model), ...m,
          cost: costOfMetrics(m, model),
        })),
        cost: sumCost(ss.byModel || new Map()),
      
        insights: ss.insights ? {
          tools: [...ss.insights.tools.entries()].map(([name, count]) => ({ name, count })),
          plugins: [...ss.insights.plugins.entries()].map(([name, count]) => ({ name, count })),
          skills: [...ss.insights.skills.entries()].map(([name, count]) => ({ name, count })),
          mcp: [...ss.insights.mcp.entries()].map(([name, count]) => ({ name, count })),
        } : undefined
      }));
      const providers = [...(d.byProvider || new Map()).entries()].map(([provider, o]) => ({
        provider,
        color: modelColor(provider),
        ...o.metrics,
        byModel: [...o.models.entries()].map(([model, m]) => ({
          model, color: modelColor(model), ...m,
          cost: costOfMetrics(m, model),
        })).sort((a, b) => b.total - a.total),
        cost: sumCost(o.models || new Map()),
      }));
      // 按天的洞察计数：活动洞察与三榜 TOP5 随日期区间筛选（4 → 天级明细）
      const dayInsights = d.insights ? {
        tools: [...d.insights.tools.entries()].map(([name, count]) => ({ name, count })),
        plugins: [...d.insights.plugins.entries()].map(([name, count]) => ({ name, count })),
        skills: [...d.insights.skills.entries()].map(([name, count]) => ({ name, count })),
        mcp: [...d.insights.mcp.entries()].map(([name, count]) => ({ name, count })),
      } : undefined;
      return {
        date,
        total: d.total,
        turns: d.turns,
        messages: d.messages,
        // 当日分段活跃时长（热力图「时长」视图与按天时长统计用）
        durationMs: activeMsOf(d.msgTimes),
        byModel: [...d.byModel.entries()].map(([model, m]) => ({
          model, color: modelColor(model), ...m,
          // 该模型当日费用（CNY）；无价为 null
          cost: costOfMetrics(m, model),
        })),
        // 当日总费用：null = 当日全部型号都无价（不是 0）
        cost: sumCost(d.byModel || new Map()),
        sessions,
        providers,
        insights: dayInsights,
        hours: hours.length > 0 ? hours : undefined,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const totals = [...s.modelTotals.entries()]
    .map(([model, m]) => ({
      model, color: modelColor(model), ...m,
      cost: costOfMetrics(m, model),
    }))
    .sort((a, b) => b.total - a.total);
  const grandTotal = totals.reduce((sum, m) => sum + m.total, 0);
  const top = totals[0];
  const topModel = top
    ? { name: top.model, color: top.color, tokens: top.total, percent: grandTotal > 0 ? Math.round((top.total / grandTotal) * 100) : 0 }
    : null;
  // 顶部指标卡(基于全历史,不受时间范围选择影响)
  const peakDayTokens = dayList.reduce((mx, d) => Math.max(mx, d.total), 0);
  const summary = {
    totalTokens: grandTotal, // 累计 Token 数
    // 累计费用（CNY）。null = 全历史型号都无价，前端据此显示「未定价」而非 ¥0.00
    totalCost: sumCost(s.modelTotals || new Map()),
    peakDayTokens, // 峰值 Token 数(历史单日最大)
    longestSessionMs: s.longestSessionMs || 0, // 最长聊天时长
    currentStreak: s.streaks ? s.streaks.current : 0, // 当前连续天数
    longestStreak: s.streaks ? s.streaks.longest : 0, // 最长连续天数
  };
  // 供应商维度(含各自模型明细)
  const providers = [...(s.providerTotals || new Map()).entries()]
    .map(([provider, o]) => ({
      provider,
      color: modelColor(provider),
      ...o.metrics,
      byModel: [...o.models.entries()].map(([model, m]) => ({
        model, color: modelColor(model), ...m,
        cost: costOfMetrics(m, model),
      })).sort((a, b) => b.total - a.total),
      cost: sumCost(o.models || new Map()),
    }))
    .sort((a, b) => b.total - a.total);
  // 会话维度(按用量倒序)
  const sessions = [...(s.sessionList || [])].sort((a, b) => b.total - a.total).map((sess) => ({
    ...sess,
    byModel: (sess.byModel || []).map((m) => ({ ...m, cost: costOfMetrics(m, m.model) })),
    cost: sumCost(new Map((sess.byModel || []).map((m) => [m.model, m]))),
  }));
  // 活动洞察 + 三榜 TOP5（插件 = 非核心工具；MCP 归并到 server；Skill 取参数里的 name）
  const toolTotal = [...(s.toolCounts || new Map()).values()].reduce((a, b) => a + b, 0);
  const skillTotal = [...(s.skillCounts || new Map()).values()].reduce((a, b) => a + b, 0);
  const insights = {
    totalToolCalls: toolTotal,
    distinctTools: (s.toolCounts || new Map()).size,
    totalSkillUses: skillTotal,
    distinctSkills: (s.skillCounts || new Map()).size,
    totalMcpCalls: [...(s.mcpCounts || new Map()).values()].reduce((a, b) => a + b, 0),
    distinctMcp: (s.mcpCounts || new Map()).size,
    topPlugins: topOf(s.pluginCounts),
    topSkills: topOf(s.skillCounts),
    topMcp: topOf(s.mcpCounts),
    topTools: topOf(s.toolCounts),
  };
  return {
    ok: true,
    schemaVersion: CACHE_SCHEMA_VERSION,
    generatedAt: Date.now(),
    sessionCount: s.sessionCount,
    providers,
    sessions,
    messageCount: s.messageCount,
    dayCount: dayList.length,
    currentStreak: s.currentStreak,
    summary,
    grandTotal,
    topModel,
    totals,
    days: dayList,
    insights, // 活动洞察 + 插件/MCP/Skill TOP5
    warnings: s.warnings, // 失败/降级提示(规范 H5)
    // 计价元数据：单价口径、汇率、无价型号清单。
    // 前端据此展示「以下型号未定价，未计入费用」而不是静默少算。
    pricing: {
      currency: "CNY",
      // USD→CNY 汇价：写进响应让用户知道数字怎么来的，改价时只改宿主一处
      usdToCny: USD_TO_CNY,
      perUnit: "1M tokens",
      priceLoaded: !!table,
      // 无价型号：出现即说明「这些用量没算钱」，避免总额被静默低估
      unpriced: [...unpriced],
    },
  };
}

// ---------- 账户余额（DeepSeek） ----------
// 余额来源：DEEPSEEK_API_KEY 凭据 → DeepSeek 官方 /user/balance。
// key 只存在于宿主进程（凭据服务在宿主侧解析），响应只含金额与错误分类。
// 容错铁律：任何失败都是结构化载荷而不是抛异常——余额条不能砸掉用量统计。
// credentials 不进 inject：用 ctx.get 惰性取用，服务缺失时降级为 no-credentials，
// 绝不让本插件因可选服务缺席而整体不激活（那会连用量统计一起消失）。
const BALANCE_OK_TTL = 15_000;   // 成功缓存：上游限额下最坏 1 次/15s
const BALANCE_FAIL_TTL = 5_000;  // 失败缓存：故障时不打爆上游
const BALANCE_TIMEOUT_MS = 10_000;
const BALANCE_DEFAULT_BASE = "https://api.deepseek.com";
const CREDENTIAL_REF_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;
function credentialRef(value) {
  if (!CREDENTIAL_REF_PATTERN.test(value)) {
    throw new TypeError(`credential ref "${value}" must match ${String(CREDENTIAL_REF_PATTERN)}`);
  }
  return value;
}

let balanceCache = null;   // { payload, at }
let balanceInflight = null;

// baseURL 优先级：llm-deepseek 设置段 > DEEPSEEK_BASE_URL 环境变量 > 官方默认。
// 三个来源都可能因服务缺失抛错，逐段回落，单点故障不炸路由。
function balanceBaseURL(ctx) {
  try {
    const section = ctx.get("settings")?.get("llm-deepseek");
    if (section && typeof section.baseURL === "string" && section.baseURL.length > 0) return section.baseURL;
  } catch { /* settings 缺失时走下一级 */ }
  try {
    const env = ctx.get("launchEnvironment")?.get("DEEPSEEK_BASE_URL")?.value;
    if (typeof env === "string" && env.length > 0) return env;
  } catch { /* 同上 */ }
  return BALANCE_DEFAULT_BASE;
}

async function fetchBalance(ctx) {
  const credentials = ctx.get("credentials");
  if (!credentials || typeof credentials.resolve !== "function") {
    return { ok: false, code: "no-credentials", message: "宿主未提供 credentials 服务", updatedAt: Date.now() };
  }
  let apiKey = "";
  try {
    apiKey = (await credentials.resolve(credentialRef("DEEPSEEK_API_KEY")))?.value ?? "";
  } catch (e) {
    return { ok: false, code: "no-key", message: "凭据解析失败：" + (e && e.message ? e.message : e), updatedAt: Date.now() };
  }
  apiKey = apiKey.trim();
  if (!apiKey) {
    return { ok: false, code: "no-key", message: "未配置 DEEPSEEK_API_KEY（设置或环境变量）", updatedAt: Date.now() };
  }
  const base = balanceBaseURL(ctx).replace(/\/+$/, "");
  let res;
  try {
    res = await fetch(base + "/user/balance", {
      headers: { Authorization: `Bearer ${apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(BALANCE_TIMEOUT_MS),
      redirect: "error",
    });
  } catch (e) {
    return { ok: false, code: "fetch-failed", message: "余额请求失败：" + (e && e.message ? e.message : e), updatedAt: Date.now() };
  }
  if (!res.ok) {
    return { ok: false, code: "fetch-failed", message: `余额请求失败（HTTP ${res.status}）`, updatedAt: Date.now() };
  }
  let data;
  try { data = await res.json(); } catch {
    return { ok: false, code: "bad-response", message: "余额接口返回无法解析", updatedAt: Date.now() };
  }
  if (data && typeof data === "object" && data.error !== undefined) {
    const raw = data.error;
    const msg = typeof raw === "string" ? raw : (raw && typeof raw.message === "string" ? raw.message : String(raw));
    return { ok: false, code: "api-error", message: "余额接口错误：" + msg, updatedAt: Date.now() };
  }
  const infos = data && typeof data === "object" && Array.isArray(data.balance_infos) ? data.balance_infos : [];
  if (infos.length === 0) {
    return { ok: false, code: "no-balance", message: "余额接口未返回账户信息", updatedAt: Date.now() };
  }
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : null; };
  const first = infos[0];
  return {
    ok: true,
    isAvailable: data.is_available !== false,
    currency: typeof first.currency === "string" && first.currency ? first.currency : "CNY",
    totalBalance: num(first.total_balance),
    grantedBalance: num(first.granted_balance),
    toppedUpBalance: num(first.topped_up_balance),
    updatedAt: Date.now(),
  };
}

// force 跳过新鲜度检查但共享在途请求：手动连点不放大上游压力。
function ensureBalance(ctx, force) {
  if (!force && balanceCache) {
    const ttl = balanceCache.payload.ok ? BALANCE_OK_TTL : BALANCE_FAIL_TTL;
    if (Date.now() - balanceCache.at < ttl) return Promise.resolve(balanceCache.payload);
  }
  if (!balanceInflight) {
    balanceInflight = fetchBalance(ctx)
      .then((payload) => { balanceCache = { payload, at: Date.now() }; return payload; })
      .catch((e) => {
        const payload = { ok: false, code: "internal", message: String(e && e.message ? e.message : e), updatedAt: Date.now() };
        balanceCache = { payload, at: Date.now() };
        return payload;
      })
      .finally(() => { balanceInflight = null; });
  }
  return balanceInflight;
}

async function handleBalance(ctx, connection, req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") {
    res.writeHead(405, { "Content-Type": "application/json; charset=utf-8" });
    res.end(JSON.stringify({ ok: false, code: "method-not-allowed", message: "GET only" }));
    return;
  }
  // 与 /api/usage-stats 同款信任栅栏：/api 下的 exact 路由必须自己过栅栏，不放行。
  const rejection = connection && typeof connection.requestRejection === "function"
    ? connection.requestRejection(req)
    : 503;
  if (rejection !== undefined) {
    res.statusCode = rejection;
    res.end(rejection === 401 ? "unauthorized" : rejection === 403 ? "forbidden" : "service unavailable");
    return;
  }
  const force = new URL(req.url, "http://x").searchParams.get("refresh") === "1";
  const payload = await ensureBalance(ctx, force);
  res.writeHead(payload.ok ? 200 : 502, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(JSON.stringify(payload));
}

export function apply(ctx) {
  const { sessionPersistence, webServer, connection } = ctx;
  if (!webServer) return;

  // 启动时异步加载磁盘缓存,回填内存(不阻塞 apply)
  loadDiskCache().then((c) => { if (c && c.ok && !cache) { cache = c; cacheAt = c.generatedAt || 0; } });
  // 价格表：与磁盘缓存并行加载,互不阻塞。宿主表缺失时退回补充价目。
  loadPriceTable();

  const ensureScan = async () => {
    if (!inflight) {
      inflight = (async () => {
        // 价格表未就绪时先等它:否则本次扫描全批型号算未定价,要等下一轮才补上
        if (!priceTable) await loadPriceTable();
        const s = await scanSessions(sessionPersistence, { timeoutMs: 20000 });
        const built = buildCache(s);
        cache = built;
        cacheAt = built.generatedAt;
        try { await persistDiskCache(built); } catch { /* 忽略写盘失败 */ }
      })().catch((e) => {
        const msg = "最近一次扫描失败：" + (e && e.message ? e.message : e);
        // 失败不顶掉旧缓存：可用数据比报错页有用；仅当全无缓存时才落失败快照（/api 据此返回 500）
        if (!cache) {
          cache = { ok: false, error: String(e && e.message ? e.message : e), generatedAt: Date.now() };
          cacheAt = Date.now();
        } else if (cache.ok && !(cache.warnings || []).includes(msg)) {
          cache.warnings = [...(cache.warnings || []), msg];
        }
      }).finally(() => { inflight = null; });
    }
    return inflight;
  };

  // 余额路由：GET /api/account-balance（?refresh=1 强制刷新）
  webServer.register({
    kind: "exact",
    path: "/api/account-balance",
    handler: (req, res) => handleBalance(ctx, connection, req, res),
  });

  webServer.register({
    kind: "exact",
    path: "/api/usage-stats",
    handler: async (req, res) => {
      // 本路由是 /api 下的 exact 路由,优先级高于 dsh-client-connection 挂在 /api prefix 上的
      // 信任栅栏(Host/Origin + 浏览器认证 cookie),必须自己过栅栏(官方 dsh-host-open-in-app 同一做法)。
      const rejection = connection && typeof connection.requestRejection === "function"
        ? connection.requestRejection(req)
        : 503; // 拿不到栅栏服务时拒绝服务,而不是放行
      if (rejection !== undefined) {
        res.statusCode = rejection;
        res.end(rejection === 401 ? "unauthorized" : rejection === 403 ? "forbidden" : "service unavailable");
        return;
      }
      const url = new URL(req.url, "http://x");
      const refresh = url.searchParams.get("refresh") === "1";
      if (!cache || refresh || !cache.ok) {
        // 无缓存:必须同步扫描首屏等待;或强制刷新:等待新结果
        await ensureScan();
      } else {
        // 有缓存:立即返回;若过期则后台异步刷新,不阻塞本次响应(SWR)
        const stale = Date.now() - (cache.generatedAt || 0) > CACHE_TTL;
        if (stale) ensureScan();
      }
      res.writeHead(cache && cache.ok ? 200 : 500, { "Content-Type": "application/json" });
      res.end(JSON.stringify(cache));
    },
  });
}