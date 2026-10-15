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
      ss = { total: 0, turns: 0, messages: 0, lastTime: null, metrics: emptyMetrics(), byModel: new Map(), msgTimes: [] };
      day.bySession.set(sessionId, ss);
    }
    return ss;
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
          }
          break;
        }
        case "tool/call": {
          // 外层工具调用：PTC 模式下多为 run_code，真实工具另见 tool/ptc-dispatch-start
          const tn = ev.data && typeof ev.data.name === "string" ? ev.data.name : null;
          if (tn) {
            toolCounts.set(tn, (toolCounts.get(tn) || 0) + 1);
            const isPlugin = !CORE_TOOLS.has(tn);
            if (isPlugin) pluginCounts.set(tn, (pluginCounts.get(tn) || 0) + 1);
            const dk = dateKey(ev.time);
            if (dk) {
              const di = ensureDayInsights(dk);
              bumpDay(di.tools, tn);
              if (isPlugin) bumpDay(di.plugins, tn);
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
            const isPlugin = !CORE_TOOLS.has(tn);
            if (isPlugin) pluginCounts.set(tn, (pluginCounts.get(tn) || 0) + 1);
            const srv = mcpServerOf(tn);
            if (srv) mcpCounts.set(srv, (mcpCounts.get(srv) || 0) + 1);
            const dk = dateKey(ev.time);
            if (dk) {
              const di = ensureDayInsights(dk);
              bumpDay(di.tools, tn);
              if (isPlugin) bumpDay(di.plugins, tn);
              if (srv) bumpDay(di.mcp, srv);
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
const CACHE_SCHEMA_VERSION = 5;
const CACHE_TTL = 60_000; // 60s 后触发后台刷新(SWR)
let inflight = null; // 并发重扫互斥:并发期间共享同一份扫描结果(规范 H3)

function cacheFilePath() {
  return join(homedir(), ".dsh", "profiles", "web", "usage-stats-cache.json");
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

// 把扫描结果转成可序列化、可直接返回给前端的响应结构
function buildCache(s) {
  const dayList = [...s.days.entries()]
    .map(([date, d]) => {
      const hours = [...(s.hourly.get(date) || new Map()).entries()]
        .map(([hour, o]) => ({
          hour,
          total: o.total,
          byModel: [...o.byModel.entries()].map(([model, m]) => ({ model, color: modelColor(model), ...m })),
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
        byModel: [...ss.byModel.entries()].map(([model, m]) => ({ model, color: modelColor(model), ...m })),
      }));
      const providers = [...(d.byProvider || new Map()).entries()].map(([provider, o]) => ({
        provider,
        color: modelColor(provider),
        ...o.metrics,
        byModel: [...o.models.entries()].map(([model, m]) => ({ model, color: modelColor(model), ...m })).sort((a, b) => b.total - a.total),
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
        byModel: [...d.byModel.entries()].map(([model, m]) => ({ model, color: modelColor(model), ...m })),
        sessions,
        providers,
        insights: dayInsights,
        hours: hours.length > 0 ? hours : undefined,
      };
    })
    .sort((a, b) => (a.date < b.date ? -1 : 1));
  const totals = [...s.modelTotals.entries()]
    .map(([model, m]) => ({ model, color: modelColor(model), ...m }))
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
      byModel: [...o.models.entries()].map(([model, m]) => ({ model, color: modelColor(model), ...m })).sort((a, b) => b.total - a.total),
    }))
    .sort((a, b) => b.total - a.total);
  // 会话维度(按用量倒序)
  const sessions = [...(s.sessionList || [])].sort((a, b) => b.total - a.total);
  // 活动洞察 + 三榜 TOP5（插件 = 非核心工具；MCP 归并到 server；Skill 取参数里的 name）
  const topOf = (map, n = 5) => [...(map || new Map()).entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([name, count]) => ({ name, count }));
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
  };
}

export function apply(ctx) {
  const { sessionPersistence, webServer, connection } = ctx;
  if (!webServer) return;

  // 启动时异步加载磁盘缓存,回填内存(不阻塞 apply)
  loadDiskCache().then((c) => { if (c && c.ok && !cache) { cache = c; cacheAt = c.generatedAt || 0; } });

  const ensureScan = () => {
    if (!inflight) {
      inflight = (async () => {
        const s = await scanSessions(sessionPersistence, { timeoutMs: 20000 });
        const built = buildCache(s);
        cache = built;
        cacheAt = built.generatedAt;
        try { await persistDiskCache(built); } catch { /* 忽略写盘失败 */ }
      })().catch((e) => {
        cache = { ok: false, error: String(e && e.message ? e.message : e), generatedAt: Date.now() };
        cacheAt = Date.now();
      }).finally(() => { inflight = null; });
    }
    return inflight;
  };

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
      if (!cache || refresh) {
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