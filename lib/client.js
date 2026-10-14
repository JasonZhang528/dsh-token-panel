// dsh-token-panel —— Token用量统计(客户端)
// 排版：固定 px 字阶、WCAG 对比度达标、4 的倍数间距阶梯
// 图表：日历点阵 / 发丝折线 / 刻度环，配色与排版自研
// 关键：按实测容器宽度 1:1 出图，不做 viewBox 缩放（缩放会让小字号变成看不见）
window.__ModuleLoader__.load({
	id: "dsh-token-panel",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const element = react.createElement;

		const inject = ["slots"];

		// ---------- 格式化 ----------
		function fmtLarge(n) {
			n = Number(n) || 0;
			if (n >= 1e8) return (n / 1e8).toFixed(2) + "亿";
			if (n >= 1e4) return (n / 1e4).toFixed(1) + "万";
			return String(Math.round(n));
		}
		function fmtFull(n) {
			return (Number(n) || 0).toLocaleString("zh-CN");
		}
		function fmtDuration(ms) {
			const totalMin = Math.floor((Number(ms) || 0) / 60000);
			if (totalMin <= 0) return "0 分";
			const d = Math.floor(totalMin / 1440);
			const h = Math.floor((totalMin % 1440) / 60);
			const m = totalMin % 60;
			if (d > 0) return d + " 天 " + h + " 时";
			if (h > 0) return h + " 时 " + m + " 分";
			return m + " 分";
		}
		function fmtClock(ms) {
			const n = Number(ms);
			if (!n) return "";
			const d = new Date(n);
			return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0");
		}
		function fmtDayLabel(dateStr) {
			const p = String(dateStr || "").split("-");
			if (p.length !== 3) return dateStr;
			return Number(p[1]) + " 月 " + Number(p[2]) + " 日";
		}
		function dateKey(d) {
			return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
		}
		function addDays(key, n) {
			const p = key.split("-").map(Number);
			const d = new Date(p[0], p[1] - 1, p[2]);
			d.setDate(d.getDate() + n);
			return dateKey(d);
		}
		function rangeKeyOf(y, m, d) {
			return y + "-" + String(m).padStart(2, "0") + "-" + String(d).padStart(2, "0");
		}

		// ---------- 容器宽度实测：图表 1:1 出图，不缩放 ----------
		function useMeasure() {
			const ref = react.useRef(null);
			const [w, setW] = react.useState(0);
			react.useEffect(() => {
				const el = ref.current;
				if (!el) return;
				const read = () => {
					const next = Math.round(el.getBoundingClientRect().width);
					setW((cur) => (Math.abs(cur - next) >= 2 ? next : cur));
				};
				read();
				if (typeof ResizeObserver !== "undefined") {
					const ro = new ResizeObserver(read);
					ro.observe(el);
					return () => ro.disconnect();
				}
				window.addEventListener("resize", read);
				return () => window.removeEventListener("resize", read);
			}, []);
			return [ref, w];
		}

		// ---------- 颜色 ----------
		// 类目色（色相 = 模型身份）：用于趋势线、环形刻度、图例、模型列表
		// 色相只在 6 个之间循环，超出时颜色不重复承担识别——列表里始终带模型名
		const CATN = 6;
		const cF = (i) => "ust-cf" + (i % CATN);
		const cS = (i) => "ust-cs" + (i % CATN);
		const cB = (i) => "ust-cb" + (i % CATN);
		const cVar = (i) => "var(--c" + (i % CATN) + ")";
		// 序数色（明度 = 用量大小）：只用于热力图，单色相蓝阶
		// 档位：0 无用量（quiet）/ 2 少量 / 3 中等 / 4 最多
		const HEAT_LEVELS = 3;
		const qLevel = (v, max) => {
			if (!(v > 0) || !(max > 0)) return 0;
			const f = v / max;
			return f > 0.66 ? HEAT_LEVELS : f > 0.33 ? 2 : 1;
		};
		const qF = (lv) => "ust-qf" + lv;
		const qB = (lv) => "ust-qb" + lv;
		const rnd = (i, k) => Math.abs(((i * 73856093) ^ (k * 19349663)) % 1000) / 1000;

		// ---------- 时间范围 ----------
		const RANGES = [
			{ id: "today", label: "今天", build: (now) => [rangeKeyOf(now.getFullYear(), now.getMonth() + 1, now.getDate())] },
			{ id: "yesterday", label: "昨天", build: (now) => { const d = new Date(now); d.setDate(now.getDate() - 1); return [rangeKeyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())]; } },
			{ id: "last7", label: "近 7 天", build: (now) => { const a = []; for (let i = 6; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); a.push(rangeKeyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())); } return a; } },
			{ id: "last30", label: "近 30 天", build: (now) => { const a = []; for (let i = 29; i >= 0; i--) { const d = new Date(now); d.setDate(now.getDate() - i); a.push(rangeKeyOf(d.getFullYear(), d.getMonth() + 1, d.getDate())); } return a; } },
			{ id: "month", label: "本月", build: (now) => { const y = now.getFullYear(), m = now.getMonth() + 1; const last = new Date(y, m, 0).getDate(); const to = Math.min(last, now.getDate()); const a = []; for (let i = 1; i <= to; i++) a.push(rangeKeyOf(y, m, i)); return a; } },
			{ id: "prevMonth", label: "上月", build: (now) => { const p = new Date(now.getFullYear(), now.getMonth() - 1, 1); const y = p.getFullYear(), m = p.getMonth() + 1; const last = new Date(y, m, 0).getDate(); const a = []; for (let i = 1; i <= last; i++) a.push(rangeKeyOf(y, m, i)); return a; } },
			{ id: "all", label: "全部", build: () => [] },
		];

		function customKeys(from, to) {
			const a = [];
			if (!from || !to || from > to) return a;
			let k = from, guard = 0;
			while (k <= to && guard < 3660) { a.push(k); k = addDays(k, 1); guard++; }
			return a;
		}
		function resolveWindow(range, now = new Date()) {
			const r = typeof range === "string" ? { id: range } : (range || {});
			if (r.id === "custom") {
				const dateKeys = customKeys(r.from, r.to);
				return { id: "custom", label: r.from || r.to ? (r.from + " 至 " + r.to) : "自定义", dateKeys };
			}
			const def = RANGES.find((x) => x.id === r.id) || RANGES[3];
			return { id: def.id, label: def.label, dateKeys: def.build(now) };
		}
		function fillDays(days, wnd) {
			const map = new Map();
			(days || []).forEach((d) => map.set(d.date, d));
			return (wnd.dateKeys || []).map((k) => map.get(k) || { date: k, total: 0, turns: 0, byModel: [] });
		}

		// ---------- 图标（1.5 描边，随字色） ----------
		function icon(paths) {
			return element("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
				paths.map((d, i) => element("path", { key: i, d })));
		}
		const IconToken = () => icon(["M12 2L2 7l10 5 10-5-10-5z", "M2 17l10 5 10-5", "M2 12l10 5 10-5"]);
		const IconBolt = () => icon(["M13 2L3 14h9l-1 8 10-12h-9l1-8z"]);
		const IconChat = () => icon(["M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"]);
		const IconCalendar = () => icon(["M3 4h18v18H3z", "M16 2v4", "M8 2v4", "M3 10h18"]);
		const IconTrend = () => icon(["M23 6l-9.5 9.5-5-5L1 18", "M17 6h6v6"]);
		const IconMail = () => icon(["M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z", "M22 6l-10 7L2 6"]);
		const IconRefresh = () => icon(["M23 4v6h-6", "M1 20v-6h6", "M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"]);
		const IconClose = () => icon(["M18 6L6 18", "M6 6l12 12"]);

		const CSS = `/* ═══════════════════════════════════════════════════════════════
   使用统计 · 设置面板样式
   排版：固定字阶 / 对比度达标 / 间距阶梯（详见下）
     · 固定 px 字阶（产品界面不用 fluid type），1.125–1.2 级差
     · 正文对比度 ≥ 4.5:1，次要文字 ≥ 3:1
     · 行高：正文 1.5 / 标题 1.25 / 说明 1.4
     · 间距取自 4 的倍数阶梯：4 8 12 16 24 32
     · 数字统一 tabular-nums 对齐
   图表配色：类目色 = 模型身份（跨色相），序数色 = 用量深浅（单色相明度阶）
   容器宽度自适应：图表按实测宽度 1:1 出图，不做缩放
   ═══════════════════════════════════════════════════════════════ */

.ust-root {
	/* 浅色（默认） */
	--ink: #191918;
	--muted: #5F5E59;
	--faint: #86857F;
	--rule: #C4C3BC;
	--surface: #F7F6F3;
	--hover: #EDECE7;
	--l0: #191918; --l1: #3F3E3A; --l2: #5A5954;
	--l3: #78776F; --l4: #93928A; --l5: #A9A8A0;
	--quiet: #C4C3BC;
	--tip-bg: #191918; --tip-fg: #F7F6F3;
	/* 类目色：6 个跨色相，承载模型身份；两两色距 >=60 保证一眼可分 */
	--c0: #C62828; --c1: #C77800; --c2: #2F7D4F; --c3: #1D5FD0; --c4: #6D4AC4; --c5: #0E7C86;
	/* 序数色：单色相蓝阶，明度 = 用量大小（浅→深） */
	--q1: #9CBEE6; --q2: #5B8FD4; --q3: #2C6BC4; --q4: #123C74;

	display: flex; flex-direction: column; gap: 32px;
	/* 顶部间距放在这里而不是 .ust-pageBody：滚动容器的上内边距会把 sticky 日期栏顶下去 */
	padding: 12px 0 0; color: var(--ink);
	font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
	font-size: 13px; line-height: 1.5;
	font-variant-numeric: tabular-nums;
	-webkit-font-smoothing: antialiased;
}
body[data-ds-dark-theme] .ust-root {
	--ink: #F2F1ED;
	--muted: #A5A49E;
	--faint: #74736E;
	--rule: #3B3A35;
	--surface: #24231F;
	--hover: #2C2B27;
	--l0: #F2F1ED; --l1: #D6D5CF; --l2: #B4B3AD;
	--l3: #8F8E88; --l4: #6A6963; --l5: #4A4944;
	--quiet: #35342F;
	--tip-bg: #F2F1ED; --tip-fg: #191918;
	/* 类目色（暗色主题）：同 6 色相提亮，暗底对比 >=3:1 */
	--c0: #FF6B6B; --c1: #FFA53D; --c2: #52C77A; --c3: #5B9DFF; --c4: #A78BFA; --c5: #2DD4BF;
	/* 序数色（暗色主题）：越亮 = 用量越大 */
	--q1: #2A4C7A; --q2: #3F6EA8; --q3: #5F97D4; --q4: #9CC4EE;
}
.ust-root *, .ust-root *::before, .ust-root *::after { box-sizing: border-box; }
.ust-root svg text { font-family: inherit; font-variant-numeric: tabular-nums; }

/* ── 排版层级 ────────────────────────────────────────────── */
.ust-page-title { margin: 0; font-size: 18px; font-weight: 700; line-height: 1.25; letter-spacing: -.01em; color: var(--ink); }
.ust-h2 { margin: 0; font-size: 15px; font-weight: 650; line-height: 1.3; letter-spacing: -.005em; color: var(--ink); }
.ust-sub { margin: 3px 0 0; font-size: 12px; line-height: 1.45; color: var(--muted); }
.ust-src { margin: 12px 0 0; font-size: 10px; font-weight: 600; line-height: 1.4; letter-spacing: .08em; text-transform: uppercase; color: var(--faint); }

/* ── 顶部：标题 + 时间范围 ───────────────────────────────── */
.ust-header {
  position: sticky;
  top: 0;
  z-index: 5;
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 12px 16px;
  margin: 0 -32px 14px;
  padding: 10px 32px;
  /* 背景穿透：皮肤会把 bg-layer-2 换成半透明玻璃色，单用它会让滚动内容透出来。
     故以不透明的 --surface 兜底，再把主题色作为顶层的半透明玻璃层叠上去：
     有玻璃的宿主保持毛玻璃观感，无皮肤的宿主合成后与原来完全同色。 */
  background-color: var(--surface);
  background-image: linear-gradient(var(--dsw-alias-bg-layer-2, transparent), var(--dsw-alias-bg-layer-2, transparent));
  border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08));
}
/* 深色同理：不透明底 + 玻璃色叠层（顺序不可交换，否则背景又被单层半透明色覆盖） */
body[data-ds-dark-theme] .ust-header {
  background-color: var(--surface);
  background-image: linear-gradient(var(--dsw-alias-bg-layer-2, transparent), var(--dsw-alias-bg-layer-2, transparent));
  border-bottom-color: rgba(255,255,255,.08);
}
.ust-rangebox { position: relative; }
.ust-tabs { display: flex; flex-wrap: wrap; gap: 2px 4px; }
.ust-tab {
	padding: 4px 9px; font-size: 12px; font-weight: 600; line-height: 1.4;
	color: var(--muted); border-radius: 6px; cursor: pointer;
	transition: background-color .15s ease, color .15s ease;
}
.ust-tab:hover { background: var(--hover); color: var(--ink); }
.ust-tab.active { background: var(--ink); color: var(--surface); }
body[data-ds-dark-theme] .ust-tab.active { background: var(--ink); color: #191918; }
.ust-tab:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; }

/* ── 指标组 ─────────────────────────────────────────────── */
.ust-metrics { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 16px 20px; }
.ust-metric { border-top: 1px solid var(--rule); padding-top: 10px; min-width: 0; }
.ust-metric-label {
	display: flex; align-items: center; gap: 5px;
	font-size: 11px; font-weight: 600; line-height: 1.4; letter-spacing: .04em;
	color: var(--muted); text-transform: uppercase;
}
.ust-metric-label svg { width: 11px; height: 11px; flex: none; opacity: .85; }
.ust-metric-value { margin-top: 6px; font-size: 25px; font-weight: 700; line-height: 1.15; letter-spacing: -.02em; color: var(--ink); overflow-wrap: anywhere; }
.ust-metric-value.is-text { font-size: 15px; font-weight: 650; line-height: 1.35; letter-spacing: 0; overflow-wrap: anywhere; hyphens: auto; }
.ust-metric-sub { margin-top: 4px; font-size: 12px; line-height: 1.4; color: var(--muted); }

/* ── 图表区块 ───────────────────────────────────────────── */
.ust-block { display: flex; flex-direction: column; }
.ust-block-titleRow { display: flex; flex-direction: row; align-items: baseline; flex-wrap: wrap; gap: 2px 10px; min-width: 0; }
.ust-block-head { display: flex; flex-wrap: wrap; align-items: baseline; justify-content: space-between; gap: 8px 16px; margin-bottom: 14px; }
.ust-block-head .ust-tabs { gap: 2px; }

/* 图表容器：等实测宽度后 1:1 出图 */
.ust-plot { width: 100%; }
.ust-plot svg { display: block; width: 100%; height: auto; }
.ust-plot.is-scroll { overflow-x: auto; overflow-y: hidden; scrollbar-width: thin; scrollbar-color: var(--rule) transparent; cursor: pointer; }
.ust-plot.is-scroll svg { width: auto; max-width: none; }
.ust-plot.is-scroll::-webkit-scrollbar { height: 6px; }
.ust-plot.is-scroll::-webkit-scrollbar-track { background: transparent; }
.ust-plot.is-scroll::-webkit-scrollbar-thumb { background: var(--rule); border-radius: 3px; }
.ust-plot.is-scroll::-webkit-scrollbar-thumb:hover { background: var(--faint); }

/* ── 图表内的图形语法 ───────────────────────────────────── */
.ust-hitcell { fill: transparent; cursor: pointer; }
.ust-hitband { fill: transparent; cursor: pointer; }
.ust-axis { font-size: 11px; font-weight: 500; fill: var(--muted); }
.ust-axis-strong { font-size: 11px; font-weight: 650; fill: var(--ink); }
.ust-grid { stroke: var(--rule); stroke-width: 1; }
.ust-baseline { stroke: var(--faint); stroke-width: 1; }
.ust-floor-tick { stroke: var(--rule); stroke-width: 1; }
.ust-hair { fill: none; stroke-width: 2.7; stroke-linejoin: round; stroke-linecap: round; }
.ust-dot { stroke: none; }
.ust-dot-quiet { fill: var(--quiet); }
.ust-cursor { stroke: var(--faint); stroke-width: 1; stroke-dasharray: 3 3; pointer-events: none; }
.ust-hit { fill: transparent; cursor: crosshair; }
.ust-callout { font-size: 11px; font-weight: 700; fill: var(--ink); paint-order: stroke; stroke: var(--surface); stroke-width: 3px; }
/* 柱顶数值：比轴标签略小、比峰值标注弱；描边保证压在柱体上也能读清 */
.ust-bar-val {
	font-size: 10px; font-weight: 600; fill: var(--muted);
	paint-order: stroke; stroke: var(--surface); stroke-width: 2.5px;
	pointer-events: none;
}
.ust-peak-ring { fill: none; stroke: var(--ink); stroke-width: 1; stroke-dasharray: 2 3; }
.ust-tick { stroke-width: 3.6; stroke-linecap: round; pointer-events: none; }
.ust-tickmark { fill: var(--faint); }
.ust-caption { font-size: 10px; font-weight: 600; letter-spacing: .06em; fill: var(--faint); text-transform: uppercase; }

/* 类目色（模型身份）：填充 / 描边 / 圆点三套，色相区分模型 */
.ust-cf0 { fill: var(--c0); } .ust-cf1 { fill: var(--c1); } .ust-cf2 { fill: var(--c2); }
.ust-cf3 { fill: var(--c3); } .ust-cf4 { fill: var(--c4); } .ust-cf5 { fill: var(--c5); }
.ust-cs0 { stroke: var(--c0); } .ust-cs1 { stroke: var(--c1); } .ust-cs2 { stroke: var(--c2); }
.ust-cs3 { stroke: var(--c3); } .ust-cs4 { stroke: var(--c4); } .ust-cs5 { stroke: var(--c5); }
.ust-cb0 { background: var(--c0); } .ust-cb1 { background: var(--c1); } .ust-cb2 { background: var(--c2); }
.ust-cb3 { background: var(--c3); } .ust-cb4 { background: var(--c4); } .ust-cb5 { background: var(--c5); }

/* 序数色（用量深浅）：单色相，明度即数值 */
.ust-qf1 { fill: var(--q1); } .ust-qf2 { fill: var(--q2); } .ust-qf3 { fill: var(--q3); } .ust-qf4 { fill: var(--q4); }
.ust-qs1 { stroke: var(--q1); } .ust-qs2 { stroke: var(--q2); } .ust-qs3 { stroke: var(--q3); } .ust-qs4 { stroke: var(--q4); }
.ust-qb1 { background: var(--q1); } .ust-qb2 { background: var(--q2); } .ust-qb3 { background: var(--q3); } .ust-qb4 { background: var(--q4); }

/* 明度阶梯（明度即数据：最重要 = 对比度最高） */
.ust-f0 { fill: var(--l0); } .ust-f1 { fill: var(--l1); } .ust-f2 { fill: var(--l2); }
.ust-f3 { fill: var(--l3); } .ust-f4 { fill: var(--l4); } .ust-f5 { fill: var(--l5); }
.ust-s0 { stroke: var(--l0); } .ust-s1 { stroke: var(--l1); } .ust-s2 { stroke: var(--l2); }
.ust-s3 { stroke: var(--l3); } .ust-s4 { stroke: var(--l4); } .ust-s5 { stroke: var(--l5); }
.ust-b0 { background: var(--l0); } .ust-b1 { background: var(--l1); } .ust-b2 { background: var(--l2); }
.ust-b3 { background: var(--l3); } .ust-b4 { background: var(--l4); } .ust-b5 { background: var(--l5); }

/* ── 色阶图例（热力图：少 → 多） ───────────────────────── */
.ust-scale { display: flex; align-items: center; gap: 5px; margin-top: 6px; }
.ust-scale-lab { font-size: 11px; font-weight: 600; color: var(--muted); }
.ust-scale-sw { width: 9px; height: 9px; border-radius: 50%; }

/* ── 模型列表 ───────────────────────────────────────────── */
.ust-models-box { flex: 1 1 0; min-width: 0; display: flex; flex-direction: column; }
.ust-models { list-style: none; margin: 0; padding: 0; }
/* 列名表头：与数据行共用同一套列宽，天然对齐 */
.ust-model--head {
	padding: 0 0 6px; cursor: default;
	font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase;
	color: var(--muted); border-bottom: 1px solid var(--rule);
}
.ust-model--head .ust-model-name { font-size: 11px; font-weight: 600; color: var(--muted); }
.ust-model--head .ust-model-hit, .ust-model--head .ust-model-sub { color: var(--muted); font-weight: 600; }
.ust-model--head .ust-model-rate, .ust-model--head .ust-model-val { color: var(--muted); font-weight: 600; }
.ust-model {
	display: flex; align-items: center; justify-content: space-between; gap: 12px;
	padding: 9px 0; border-bottom: 1px solid var(--rule); cursor: default;
}
.ust-model:last-child { border-bottom: 0; }
.ust-model--head:last-child { border-bottom: 1px solid var(--rule); }
.ust-model-name { display: flex; align-items: center; gap: 8px; min-width: 0; font-size: 13px; font-weight: 600; color: var(--ink); }
.ust-model-name span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ust-model-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.ust-model-val { flex: none; font-size: 13px; font-weight: 650; color: var(--ink); }
.ust-model-sub { flex: none; font-size: 12px; color: var(--muted); }
/* 命中量 / 命中率：等宽数字右对齐，便于纵向比对 */
.ust-model-hit { flex: none; font-size: 12px; color: var(--muted); font-variant-numeric: tabular-nums; }
.ust-model-rate { flex: none; width: 42px; text-align: right; font-size: 12px; font-weight: 600; color: var(--ink); font-variant-numeric: tabular-nums; }
/* 右侧数值列定宽右对齐：三列在每一行都落在同一竖线上，上下对齐 */
.ust-model-row { display: flex; align-items: baseline; gap: 12px; }
.ust-model-hit, .ust-model-sub, .ust-model-val { text-align: right; }
.ust-model-hit { width: 108px; }
.ust-model-sub { width: 76px; }
.ust-model-val { width: 40px; }

/* ── 图表下方的图例（可点击显隐） ───────────────────────── */
.ust-legend { display: flex; flex-wrap: wrap; gap: 6px 16px; margin-top: 12px; }
/* 图例置于图表之上时：贴着图表，且两行图例之间不留大缝 */
.ust-legend--above { margin-top: 0; margin-bottom: 6px; justify-content: center; }
.ust-legend--above + .ust-legend--above { margin-top: -4px; }
.ust-legend-item {
	display: flex; align-items: center; gap: 7px;
	font-size: 12px; font-weight: 550; line-height: 1.5; color: var(--muted);
	cursor: pointer; transition: color .15s ease, opacity .15s ease;
}
.ust-legend-item:hover { color: var(--ink); }
.ust-legend-dot { width: 8px; height: 8px; border-radius: 50%; flex: none; }
/* 命中率图例样本：短虚线（当前仅用量趋势图使用实心圆点，此处保留给后续图表扩展） */
.ust-legend-dash { width: 15px; height: 0; border-top: 2px dashed var(--ink); flex: none; }

/* 占位：柱体本身用类目色填充，不加描边避免相邻柱粘连 */
.ust-bar { stroke: none; }

/* 柱状图容器 */
.ust-charts { display: flex; flex-direction: column; gap: 2px; width: 100%; }
.ust-plot.is-scroll .ust-charts { width: max-content; }

/* ── 环形图 ─────────────────────────────────────────────── */
/* 圆环与模型明细各占一半；容器过窄时自动换行回上下堆叠 */
.ust-donut-wrap { display: flex; flex-direction: row; flex-wrap: wrap; align-items: center; gap: 24px 32px; }
.ust-donut-wrap > .ust-donut { flex: 0 0 40%; margin: 0 auto; }
.ust-donut-wrap > .ust-models-box { flex: 1 1 0; min-width: 0; }
.ust-donut { position: relative; width: 168px; height: 168px; margin: 4px auto 0; flex: none; }
.ust-donut svg { display: block; width: 100%; height: 100%; overflow: visible; }
.ust-donut-center {
	position: absolute; inset: 0; display: flex; flex-direction: column;
	align-items: center; justify-content: center; pointer-events: none;
}
.ust-donut-center .num { font-size: 22px; font-weight: 700; line-height: 1.1; letter-spacing: -.02em; color: var(--ink); }
.ust-donut-center .lab { margin-top: 2px; font-size: 10px; font-weight: 600; letter-spacing: .1em; color: var(--muted); }

/* ── 提示条 ─────────────────────────────────────────────── */
.ust-warn {
	padding: 10px 14px; font-size: 12px; line-height: 1.5; color: var(--ink);
	background: var(--surface); border: 1px solid var(--rule); border-radius: 8px;
}

/* ── 供应商明细弹窗 ─────────────────────────────────────── */
/* 表格行可点击：给出明确的可点反馈 */
.ust-tbl tbody tr.is-clickable { cursor: pointer; }
.ust-tbl tbody tr.is-clickable:focus-visible { outline: 2px solid var(--ink); outline-offset: -2px; }
.ust-dlgMask {
  position: fixed; inset: 0; z-index: 1000;
  display: flex; align-items: center; justify-content: center;
  padding: 24px;
  background: var(--dsw-alias-bg-mask-2, rgba(0, 0, 0, .35));
  backdrop-filter: blur(2px);
  animation: ustFadeIn .18s ease both;
}
.ust-dlg {
  display: flex; flex-direction: column;
  width: min(720px, 100%); max-height: min(76vh, 640px);
  background: var(--surface);
  border: 1px solid var(--rule);
  border-radius: 12px;
  box-shadow: var(--dsw-shadow-lv3, 0 12px 40px rgba(0, 0, 0, .18));
  overflow: hidden;
}
.ust-dlgHead {
  flex: none; display: flex; align-items: center; gap: 10px;
  padding: 14px 18px 10px; border-bottom: 1px solid var(--rule);
}
.ust-dlgTitleBox { flex: 1 1 auto; min-width: 0; }
.ust-dlgTitle { margin: 0; font-size: 14px; font-weight: 650; color: var(--ink); }
.ust-dlgSub { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.ust-dlgClose {
  flex: none; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center;
  color: var(--muted); background: transparent; border: 0; border-radius: 6px; cursor: pointer;
}
.ust-dlgClose:hover { color: var(--ink); background: var(--hover); }
.ust-dlgClose svg { width: 15px; height: 15px; }
.ust-dlgBody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 4px 18px 16px; }
.ust-dlgSum {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
  gap: 10px 18px; padding: 12px 0 4px;
}
.ust-dlgSumItem { min-width: 0; }
.ust-dlgSumLab { font-size: 11px; font-weight: 600; letter-spacing: .04em; text-transform: uppercase; color: var(--muted); }
.ust-dlgSumVal { margin-top: 3px; font-size: 17px; font-weight: 700; color: var(--ink); font-variant-numeric: tabular-nums; }

/* ── 底部：页脚 + 按钮 ─────────────────────────────────── */
.ust-footer {
/* 底部自动刷新控件 */
.ust-auto { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
.ust-autoToggle { display: inline-flex; align-items: center; gap: 6px; font-size: 12px; color: var(--muted); cursor: pointer; user-select: none; }
.ust-autoCheck { width: 14px; height: 14px; margin: 0; accent-color: var(--ink); cursor: pointer; }
.ust-autoSeg { display: flex; align-items: center; gap: 2px; }
.ust-autoSeg .ust-tab { font-size: 12px; }
	display: flex; align-items: center; justify-content: space-between; gap: 16px;
	margin-top: 4px; padding-top: 16px; border-top: 1px solid var(--rule);
}
.ust-meta { font-size: 12px; line-height: 1.5; color: var(--muted); font-variant-numeric: tabular-nums; }
.ust-actions { display: flex; justify-content: flex-end; }
.ust-btn {
	display: inline-flex; align-items: center; gap: 7px;
	padding: 7px 14px; font-family: inherit; font-size: 12.5px; font-weight: 600; line-height: 1.4;
	letter-spacing: .01em; color: var(--ink);
	background: var(--surface); border: 1px solid var(--rule);
	border-radius: 8px; cursor: pointer;
	transition: background-color .15s ease, border-color .15s ease, color .15s ease;
}
.ust-btn:hover:not(:disabled) { background: var(--hover); border-color: var(--faint); }
.ust-btn:active:not(:disabled) { background: var(--rule); }
.ust-btn:disabled { opacity: .55; cursor: progress; }
.ust-btn:focus-visible { outline: 2px solid var(--ink); outline-offset: 2px; }
.ust-btn--primary { background: var(--ink); border-color: var(--ink); color: var(--surface); }
body[data-ds-dark-theme] .ust-btn--primary { color: #191918; }
.ust-btn--primary:hover:not(:disabled) { background: var(--ink); border-color: var(--faint); }
.ust-btn--ghost { background: transparent; border-color: transparent; color: var(--muted); }
.ust-btn--ghost:hover:not(:disabled) { background: var(--hover); border-color: var(--rule); color: var(--ink); }
.ust-btn-ico { display: inline-flex; width: 13px; height: 13px; }
.ust-btn-ico svg { width: 13px; height: 13px; }
.ust-btn-ico.is-spin { animation: ustSpin 900ms linear infinite; }
@keyframes ustSpin { to { transform: rotate(360deg); } }
@media (prefers-reduced-motion: reduce) { .ust-btn-ico.is-spin { animation: none; } }

/* ── 自定义区间面板 ─────────────────────────────────────── */
.ust-custom {
	position: absolute; top: calc(100% + 8px); right: 0; z-index: 60;
	display: flex; flex-direction: column; gap: 10px;
	min-width: 272px; padding: 14px;
	background: var(--surface); border: 1px solid var(--rule); border-radius: 12px;
}
.ust-custom-row { display: flex; align-items: center; gap: 8px; }
.ust-custom-sep { font-size: 12px; color: var(--muted); }
.ust-custom-actions { display: flex; justify-content: flex-end; gap: 8px; }
.ust-date {
	flex: 1; min-width: 0; padding: 6px 10px;
	font-family: inherit; font-size: 12px; color: var(--ink);
	background: transparent; border: 1px solid var(--rule); border-radius: 8px;
}
.ust-date:focus-visible { outline: 2px solid var(--ink); outline-offset: 1px; border-color: transparent; }
.ust-date::-webkit-calendar-picker-indicator { filter: none; opacity: .6; cursor: pointer; }
body[data-ds-dark-theme] .ust-date::-webkit-calendar-picker-indicator { filter: invert(1); opacity: .7; }

/* ── 浮动提示 ───────────────────────────────────────────── */
.ust-tip {
	position: fixed; z-index: 10000; pointer-events: none;
	max-width: 260px; padding: 9px 12px;
	font-size: 12px; line-height: 1.45;
	color: var(--tip-fg); background: var(--tip-bg);
	border-radius: 8px;
}
.ust-tip-title { font-weight: 700; }
.ust-tip-body { margin-top: 2px; opacity: .75; }
.ust-tip-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-top: 5px; }
.ust-tip-row:first-of-type { margin-top: 7px; }
.ust-tip-key { display: flex; align-items: center; gap: 7px; min-width: 0; }
.ust-tip-key span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.ust-tip-swatch { width: 8px; height: 8px; border-radius: 50%; flex: none; }
.ust-tip-val { flex: none; opacity: .75; }

/* ── 载入 / 空态 ────────────────────────────────────────── */
.ust-placeholder { padding: 32px 0; font-size: 13px; line-height: 1.5; color: var(--muted); text-align: center; }
.ust-skeleton {
	height: 12px; margin-top: 10px; border-radius: 6px;
	background: var(--hover); animation: ustPulse 1.4s ease-in-out infinite;
}
@keyframes ustPulse { 0%, 100% { opacity: 1; } 50% { opacity: .45; } }

/* ── 动画（150–250ms，只表达状态，不做装饰） ────────────── */
.ust-fade { animation: ustFade .24s ease-out both; }
@keyframes ustFade { from { opacity: 0; } }
.ust-draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: ustDraw .5s ease-out both; }
@keyframes ustDraw { to { stroke-dashoffset: 0; } }
.ust-pop { transform-box: fill-box; transform-origin: center; animation: ustPop .22s ease-out both; }
@keyframes ustPop { from { opacity: 0; transform: scale(.6); } to { opacity: 1; transform: none; } }
@media (prefers-reduced-motion: reduce) {
	.ust-fade, .ust-draw, .ust-pop, .ust-skeleton { animation: none; }
	.ust-draw { stroke-dasharray: none; stroke-dashoffset: 0; }
}

/* tooltip portal 宿主（脱离面板 transform 包含块，才能用真正的视口坐标） */
.ust-tipRoot { position: fixed; top: 0; left: 0; z-index: 10000; pointer-events: none; }

/* ── 活跃热力图（GitHub 贡献网格风格） ── */
.ust-gh-wrap { width: 100%; overflow-x: auto; overflow-y: hidden; padding: 4px 0 2px; display: flex; justify-content: center; }
.ust-gh-wrap svg { display: block; }
.ust-gh-cell { stroke: rgba(0,0,0,.05); stroke-width: 1; }
body[data-ds-dark-theme] .ust-gh-cell { stroke: rgba(255,255,255,.06); }
.ust-gh-cell.is-today { stroke: var(--ink); stroke-width: 1.5; }
/* 五档底色：0 = 无数据 */
.ust-gh-lv0 { fill: #E6E5E0; }
.ust-gh-lv1 { fill: #A8D4F5; }
.ust-gh-lv2 { fill: #6FBBEF; }
.ust-gh-lv3 { fill: #3D9BE0; }
.ust-gh-lv4 { fill: #1B7FD4; }
body[data-ds-dark-theme] .ust-gh-lv0 { fill: #2E2D28; }
body[data-ds-dark-theme] .ust-gh-lv1 { fill: #1F5C8B; }
body[data-ds-dark-theme] .ust-gh-lv2 { fill: #2E7FB8; }
body[data-ds-dark-theme] .ust-gh-lv3 { fill: #4AA3DC; }
body[data-ds-dark-theme] .ust-gh-lv4 { fill: #7CC4F0; }
.ust-gh-axis { fill: var(--faint, #86857F); font-size: 10px; font-family: inherit; }
.ust-gh-scale { display: flex; align-items: center; gap: 4px; margin-top: 6px; }
.ust-gh-sw { width: 11px; height: 11px; border-radius: 2.5px; display: inline-block; }
.ust-gh-legend { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 10px; }
.ust-gh-note { font-size: 12px; color: var(--muted, #5F5E59); font-variant-numeric: tabular-nums; }

/* ── 会话统计 / 供应商统计（新表格） ── */
.ust-tblWrap { overflow-x: auto; }
.ust-tbl { width: 100%; border-collapse: collapse; font-size: 13px; }
.ust-tbl th, .ust-tbl td { text-align: left; padding: 9px 12px; border-bottom: 1px solid var(--rule, #C4C3BC); white-space: nowrap; }
body[data-ds-dark-theme] .ust-tbl th, body[data-ds-dark-theme] .ust-tbl td { border-bottom-color: #3B3A35; }
.ust-tbl th { color: var(--muted, #5F5E59); font-weight: 600; font-size: 12px; }
.ust-tbl tbody tr:hover { background: var(--hover, #EDECE7); }
.ust-tblNum { text-align: right; font-variant-numeric: tabular-nums; }
.ust-tblName { display: flex; flex-direction: column; align-items: flex-start; gap: 2px; min-width: 0; }
/* 会话名称：名称为主、id 为副，仍保持单行省略 */
.ust-tblName .ust-tblId { font-size: 11px; font-variant-numeric: tabular-nums; color: var(--muted, #5F5E59); }
/* 模型明细色点：必须显式 inline-block，否则行内元素的 width/height 被忽略、点不可见 */
.ust-dot {
  display: inline-block; width: 8px; height: 8px; border-radius: 50%;
  flex: none; vertical-align: middle;
}
/* 单元格不是 flex 容器，用相邻外边距代替 gap */
.ust-dot + .ust-dot { margin-left: 4px; }
.ust-tblSub { color: var(--muted, #5F5E59); font-size: 12px; font-weight: 400; }
.ust-ellip { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 260px; }

/* ── 分页控件 ── */
.ust-pager { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
.ust-pgInfo { font-size: 12px; color: var(--muted, #5F5E59); font-variant-numeric: tabular-nums; }
.ust-pgBtns { display: flex; align-items: center; gap: 4px; }
.ust-pgBtn { min-width: 28px; height: 28px; padding: 0 8px; border: 1px solid var(--rule, #C4C3BC); background: transparent; color: var(--ink, #0F1115); font: inherit; font-size: 12px; border-radius: 7px; cursor: pointer; transition: background-color .15s ease, border-color .15s ease; }
.ust-pgBtn:hover:not(:disabled) { background: var(--hover, #EDECE7); }
.ust-pgBtn:disabled { opacity: .4; cursor: not-allowed; }
.ust-pgBtn.is-active { background: var(--ink, #0F1115); color: var(--surface, #fff); border-color: var(--ink, #0F1115); }
body[data-ds-dark-theme] .ust-pgBtn { border-color: #3B3A35; color: #EDECE7; }
body[data-ds-dark-theme] .ust-pgBtn:hover:not(:disabled) { background: #2E2D28; }
body[data-ds-dark-theme] .ust-pgBtn.is-active { background: #EDECE7; color: #1A1917; border-color: #EDECE7; }

/* ── 原生菜单项图标 + 主区域页面 ── */
.ust-panelGlyph { display: inline-flex; align-items: center; justify-content: center; }
.ust-panelGlyph svg { width: 100%; height: 100%; }
.ust-page { display: flex; flex-direction: column; height: 100%; min-height: 0; }
.ust-pageHead { flex: none; padding: 16px 32px 10px; border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,.08)); }
.ust-pageTitle { margin: 0; font-size: 16px; font-weight: 600; color: var(--dsw-alias-label-primary, #191918); }
.ust-pageSub { margin: 2px 0 0; font-size: 12px; color: var(--dsw-alias-label-tertiary, #86857F); }
/* 上内边距必须为 0：sticky 的 .ust-header 会被滚动容器的上内边距顶住，
   「下滑固定」后与上方标题之间会留着一道透出内容的缝。间距改由 .ust-root 的 padding-top 承担。 */
.ust-pageBody { flex: 1 1 auto; min-height: 0; overflow: auto; padding: 0 32px 24px; }
/* 窄屏：横向留白收敛到 16px，避免内容被过度挤压 */
@media (max-width: 900px) {
  .ust-pageHead { padding-left: 16px; padding-right: 16px; }
  .ust-pageBody { padding-left: 16px; padding-right: 16px; }
  .ust-root { padding-top: 8px; }
  .ust-header { margin-left: -16px; margin-right: -16px; padding-left: 16px; padding-right: 16px; }
}
body[data-ds-dark-theme] .ust-pageHead { border-bottom-color: rgba(255,255,255,.08); }
body[data-ds-dark-theme] .ust-pageTitle { color: #EDECE7; }
`;

		// ---------- 弹窗样式（对齐 dsh-token-usage 的展示方式） ----------
		const MODAL_CSS = `
/* 侧边栏入口：与左下角用户菜单同宽同高（铺满 footerActions 行） */
.ust-fab{position:relative;display:flex;flex:1 1 100%;min-width:0;margin:4px -2px}
.ust-fabBtn{min-width:0;width:100%;height:42px;box-sizing:border-box;color:var(--dsw-alias-label-primary,#0f1115);cursor:pointer;background:transparent;border:0;border-radius:12px;padding:0 10px 0 8px;font:inherit;font-size:14px;line-height:22px;display:flex;align-items:center;gap:8px;transition:color .15s ease,background-color .15s ease}
.ust-fabBtn:hover,.ust-fabBtn:focus-visible{background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.ust-fabBtn--rail{width:42px;height:42px;padding:0;justify-content:center;margin:0}
.ust-fabLabel{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ust-fabIco{display:inline-flex;width:16px;height:16px;flex:none}
.ust-fabIco svg{width:100%;height:100%}

/* 遮罩与面板 */
.ust-overlay{position:fixed;inset:0;z-index:900}
.ust-mask{position:absolute;inset:0;background:var(--dsw-alias-bg-mask-2,rgba(0,0,0,.35));backdrop-filter:blur(2px);animation:ustFadeIn .22s ease both}
.ust-panel{position:absolute;top:0;left:0;right:0;bottom:0;margin:auto;width:min(1120px,calc(100vw - 40px));height:min(calc(100vh - 48px),820px);max-width:calc(100vw - 40px);max-height:calc(100vh - 48px);box-sizing:border-box;background:var(--dsw-alias-bg-layer-2,#fff);border:1px solid var(--dsw-alias-border-l2,rgba(0,0,0,.12));border-radius:16px;box-shadow:var(--dsw-shadow-lv3,0 12px 40px rgba(0,0,0,.18));display:flex;flex-direction:column;overflow:hidden;animation:ustPanelIn .32s cubic-bezier(.16,1,.3,1) both}
.ust-overlay.is-closing .ust-mask{animation:ustFadeOut .18s ease both}
.ust-overlay.is-closing .ust-panel{animation:ustPanelOut .18s ease both}
@keyframes ustFadeIn{from{opacity:0}to{opacity:1}}
@keyframes ustFadeOut{from{opacity:1}to{opacity:0}}
@keyframes ustPanelIn{from{opacity:0;scale:.97}to{opacity:1;scale:1}}
@keyframes ustPanelOut{from{opacity:1;scale:1}to{opacity:0;scale:.98}}
@media (prefers-reduced-motion: reduce){.ust-mask,.ust-panel{animation:none!important}}

/* 面板头部 / 主体 */
.ust-panelHead{flex:none;display:flex;align-items:center;gap:14px;padding:14px 24px 10px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(0,0,0,.08))}
.ust-panelTitleBox{flex:1 1 auto;min-width:0;display:flex;flex-direction:row;align-items:baseline;gap:10px}
.ust-panelTitle{margin:0;color:var(--dsw-alias-label-primary,#191918);font-size:16px;font-weight:600;line-height:22px}
.ust-panelSub{margin:0;color:var(--dsw-alias-label-tertiary,#86857F);font-size:12px;line-height:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.ust-closeBtn{flex:none;width:30px;height:30px;display:inline-flex;align-items:center;justify-content:center;color:var(--dsw-alias-label-tertiary,#86857F);background:transparent;border:0;border-radius:8px;cursor:pointer;transition:color .15s ease,background-color .15s ease}
.ust-closeBtn:hover{color:var(--dsw-alias-label-primary,#191918);background:var(--dsw-alias-interactive-bg-hover,rgba(0,0,0,.05))}
.ust-closeBtn svg{width:16px;height:16px}
.ust-panelBody{flex:1 1 auto;min-height:0;overflow:auto;padding:0 24px 20px}
/* 弹窗已有标题，隐藏视图内重复的 h1 */
.ust-panelBody .ust-page-title{display:none}
`;

		// ---------- 数据辅助 ----------
		const totalOf = (d) => (d ? d.total : 0);
		const turnsOf = (d) => (d ? d.turns : 0);
		function calcStats(days, wnd) {
			const list = fillDays(days, wnd);
			const total = list.reduce((s, d) => s + totalOf(d), 0);
			const turns = list.reduce((s, d) => s + turnsOf(d), 0);
			const activeDays = list.filter((d) => totalOf(d) > 0).length;
			return { total, turns, activeDays };
		}
		// 尾部模型并入「其他」：颜色才能落在阶梯上，且图例不爆
		// 四件套求和：命中率需要分母（输入+输出+缓存读写），只合并 total 会算错
		const sumMetrics = (rows) => rows.reduce((a, m) => ({
			input: a.input + (m.input || 0),
			output: a.output + (m.output || 0),
			cacheRead: a.cacheRead + (m.cacheRead || 0),
			cacheWrite: a.cacheWrite + (m.cacheWrite || 0),
			total: a.total + (m.total || 0),
		}), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
		function foldModels(list, n = 4) {
			const sorted = [...list].sort((a, b) => b.total - a.total);
			if (sorted.length <= n + 1) return sorted.map((m, i) => ({ ...m, rank: i }));
			const head = sorted.slice(0, n).map((m, i) => ({ ...m, rank: i }));
			const tail = sorted.slice(n);
			head.push({
				model: "其他 " + tail.length + " 个模型",
				...sumMetrics(tail),
				children: tail,
				rank: n,
			});
			return head;
		}
		// 按模型汇总完整四件套：圆环右侧列表要显示缓存命中量与命中率
		function modelTotalsIn(days, wnd) {
			const m = new Map();
			fillDays(days, wnd).forEach((d) => (d.byModel || []).forEach((x) => {
				const cur = m.get(x.model) || { model: x.model, color: x.color, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
				cur.input += x.input || 0; cur.output += x.output || 0;
				cur.cacheRead += x.cacheRead || 0; cur.cacheWrite += x.cacheWrite || 0;
				cur.total += x.total || 0;
				if (!cur.color && x.color) cur.color = x.color;
				m.set(x.model, cur);
			}));
			return [...m.values()];
		}
		// 缓存命中率：命中量 / 当期满量（含输入、输出、缓存读写）。分母为 0 时返回 null，
		// 由 fmtPct 显示「—」，避免误导性的 0%
		function hitRateOf(m) {
			if (!m) return null;
			const total = (m.input || 0) + (m.output || 0) + (m.cacheRead || 0) + (m.cacheWrite || 0);
			if (total <= 0) return null;
			return (m.cacheRead || 0) / total;
		}
		function fmtPct(r) {
			return r === null || r === undefined ? "—" : Math.round(r * 100) + "%";
		}
		// 模型取色：优先沿用宿主给的颜色；缺失时按名称散列到类目色，
		// 保证弹窗里的模型色块与柱状图 / 圆环一致
		function modelColorOf(model) {
			let h = 0;
			const s = String(model || "");
			for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
			return "var(--c" + (h % CATN) + ")";
		}
		// 按窗口聚合「会话」维度：把窗口内各天的会话桶合并成一个会一行（无记录的日补 0）
		function sessionsIn(days, wnd, meta) {
			const acc = new Map();
			(days || []).forEach((d) => {
				if (!((wnd.dateKeys || []).includes(d.date))) return;
				(d.sessions || []).forEach((s) => {
					const cur = acc.get(s.id) || { id: s.id, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, messages: 0, lastTime: null, byModel: {} };
					cur.total += s.total || 0;
					cur.input += s.input || 0;
					cur.output += s.output || 0;
					cur.cacheRead += s.cacheRead || 0;
					cur.cacheWrite += s.cacheWrite || 0;
					cur.turns += s.turns || 0;
					cur.messages += s.messages || 0;
					if (s.lastTime && (!cur.lastTime || s.lastTime > cur.lastTime)) cur.lastTime = s.lastTime;
					// 逐模型的完整四件套：会话弹窗要按模型给命中率，只留 total 不够
					(s.byModel || []).forEach((m) => {
						const bm = cur.byModel[m.model] || { model: m.model, color: m.color, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
						bm.input += m.input || 0; bm.output += m.output || 0;
						bm.cacheRead += m.cacheRead || 0; bm.cacheWrite += m.cacheWrite || 0;
						bm.total += m.total || 0;
						if (!bm.color && m.color) bm.color = m.color;
						cur.byModel[m.model] = bm;
					});
					acc.set(s.id, cur);
				});
			});
			return [...acc.values()]
				.map((s) => ({
					...s,
					title: (meta && (meta[s.id] || {}).title) || null,
					cwd: (meta && (meta[s.id] || {}).cwd) || null,
					byModel: Object.values(s.byModel).sort((a, b) => b.total - a.total),
				}))
				.sort((a, b) => b.total - a.total);
		}
		// 按窗口聚合「供应商」维度：合并窗口内各天的供应商桶，占比按窗口总量重算
		function providersIn(days, wnd) {
			const acc = new Map();
			// 逐模型的完整四件套：弹窗要按模型给命中率，只留 total 不够
			const bump = (box, m) => {
				const cur = box[m.model] || { model: m.model, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 };
				cur.input += m.input || 0; cur.output += m.output || 0;
				cur.cacheRead += m.cacheRead || 0; cur.cacheWrite += m.cacheWrite || 0;
				cur.total += m.total || 0;
				box[m.model] = cur;
			};
			fillDays(days, wnd).forEach((d) => {
				(d.providers || []).forEach((p) => {
					const cur = acc.get(p.provider) || { provider: p.provider, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0, byModel: {} };
					cur.input += p.input || 0; cur.output += p.output || 0;
					cur.cacheRead += p.cacheRead || 0; cur.cacheWrite += p.cacheWrite || 0;
					cur.total += p.total || 0;
					(p.byModel || []).forEach((m) => bump(cur.byModel, m));
					acc.set(p.provider, cur);
				});
			});
			const list = [...acc.values()].map((p) => ({
				...p,
				// 宿主已带 color：沿用它与圆环 / 柱状图同色，缺失时才按名称兜底
				byModel: Object.values(p.byModel).map((m) => ({ ...m, color: m.color || modelColorOf(m.model) })).sort((a, b) => b.total - a.total),
			}));
			return list.sort((a, b) => b.total - a.total);
		}

		// ---------- 指标 ----------
		function Metric({ icon, label, value, sub, text }) {
			return element("div", { className: "ust-metric" },
				element("div", { className: "ust-metric-label" }, icon, element("span", null, label)),
				element("div", { className: "ust-metric-value" + (text ? " is-text" : "") }, value),
				sub ? element("div", { className: "ust-metric-sub" }, sub) : null,
			);
		}

		function SummaryMetrics({ summary }) {
			const s = summary || {};
			return element("div", { className: "ust-metrics" },
				element(Metric, { icon: element(IconToken), label: "累计 Token", value: fmtLarge(s.totalTokens), sub: fmtFull(s.totalTokens || 0) }),
				element(Metric, { icon: element(IconBolt), label: "单日峰值", value: fmtLarge(s.peakDayTokens), sub: "历史最高一天" }),
				element(Metric, { icon: element(IconChat), label: "最长会话", value: fmtDuration(s.longestSessionMs), sub: "单个会话持续最久", text: true }),
				element(Metric, { icon: element(IconCalendar), label: "当前连续", value: String(s.currentStreak || 0) + " 天", sub: "有用量的连续天" }),
				element(Metric, { icon: element(IconTrend), label: "最长连续", value: String(s.longestStreak || 0) + " 天", sub: "历史最长连续" }),
			);
		}

		// ---------- 提示框（跟随鼠标，边界内翻转） ----------
		function useTip() {
			const [tip, setTip] = react.useState(null);
			const place = (e, node) => {
				const W = 240, H = 140;
				// 贴近鼠标：偏移 10px，右侧/下方放不下时翻到另一侧
				let x = e.clientX + 10, y = e.clientY + 10;
				if (x + W > window.innerWidth) x = e.clientX - W - 10;
				if (y + H > window.innerHeight) y = e.clientY - H - 10;
				if (x < 8) x = 8;
				if (y < 8) y = 8;
				setTip({ node, x, y });
			};
			const clear = () => setTip(null);
			// .ust-panel 已改用 flex/margin 居中（无 transform），
			// 因此 position:fixed 的包含块回到视口，坐标可直接用 clientX/clientY。
			const el = tip ? element("div", { className: "ust-tip", style: { left: tip.x + "px", top: tip.y + "px" } }, tip.node) : null;
			return [place, clear, el];
		}

		// ---------- 1) 活跃热力图 ----------
		// 日历点阵：一格一天，点面积 = 当天用量（sqrt 换算，面积才与数值成正比）
		// 只保留「每日」一种展示：一格一天
		const WD = ["日", "一", "二", "三", "四", "五", "六"];
		// 自动刷新可选的间隔（秒）
		const AUTO_OPTIONS = [5, 10, 30, 60];

		// ---------- 活跃热力图（GitHub 贡献网格风格：周列 × 星期行，方块按用量着色） ----------
		function Heatmap({ days, window: wnd }) {
			const model = react.useMemo(() => {
				const map = new Map();
				(days || []).forEach((d) => map.set(d.date, d));
				const today = new Date();
				today.setHours(0, 0, 0, 0);
				// GitHub 风格：固定展示最近一年（53 周），结束于本周
				const end0 = new Date(today);
				end0.setDate(end0.getDate() + (6 - end0.getDay()));
				const start0 = new Date(end0);
				start0.setDate(start0.getDate() - (53 * 7 - 1));
				const cells = [];
				let maxDay = 0, peak = null, activeDays = 0;
				const cumMap = new Map();
				let cum = 0;
				(days || []).forEach((d) => { cum += totalOf(d); cumMap.set(d.date, cum); });
				for (let cur = new Date(start0); cur <= end0; cur.setDate(cur.getDate() + 1)) {
					const key = dateKey(cur);
					const day = map.get(key);
					const total = totalOf(day);
					const col = Math.floor((cur - start0) / 86400000 / 7);
					cells.push({
						key, col, row: cur.getDay(), total, turns: turnsOf(day), cum: cumMap.get(key),
						month: cur.getMonth() + 1, dom: cur.getDate(), isToday: key === dateKey(today),
					});
					if (total > 0) activeDays += 1;
					if (total > maxDay) { maxDay = total; peak = cells[cells.length - 1]; }
				}
				return { cells, maxDay, peak, activeDays, start: start0, end: end0 };
			}, [days]);

			// GitHub 五档底色：按用量占比分档（无数据用 quiet）
			const level = (v) => {
				if (!(v > 0) || !(model.maxDay > 0)) return 0;
				const r = v / model.maxDay;
				return r > 0.66 ? 4 : r > 0.33 ? 3 : r > 0.12 ? 2 : 1;
			};

			const CELL = 13, GAP = 3, MONTH_GAP = 10, PAD_L = 28, PAD_T = 20, PAD_B = 8;
			const cols = 53, rows = 7;
			// 每月之间额外留白，月份边界一眼可辨
			const colX = [];
			{
				let lastM = -1;
				for (let c0 = 0; c0 < cols; c0++) {
					const cell = model.cells.find((x) => x.col === c0);
					const m = cell ? cell.month : -1;
					const extra = (lastM !== -1 && m !== lastM) ? MONTH_GAP : 0;
					colX[c0] = (c0 === 0 ? PAD_L : colX[c0 - 1] + CELL + GAP) + extra;
					lastM = m;
				}
			}
			const W = (colX[cols - 1] || PAD_L) + CELL + 2;
			const H = PAD_T + rows * (CELL + GAP) - GAP + PAD_B;
			const cx = (col) => colX[col] || 0;
			const cy = (row) => PAD_T + row * (CELL + GAP);

			// 月份标尺（出现新的月份时标注）
			const monthMarks = [];
			let lastMonth = -1;
			for (let c0 = 0; c0 < cols; c0++) {
				const cell = model.cells.find((x) => x.col === c0);
				if (!cell) continue;
				if (cell.month !== lastMonth) { monthMarks.push({ col: c0, month: cell.month }); lastMonth = cell.month; }
			}

			const wdKey = "ust-gh-axis"
			const wdAxis = [1, 3, 5].map((k) =>
				element("text", { key: "wd" + k, className: wdKey, x: 0, y: cy(k) + CELL - 2.5, textAnchor: "start" }, WD[k]));

			return element("div", { className: "ust-block" },
				element("div", { className: "ust-block-head" },
					element("div", { className: "ust-block-titleRow" },
						element("h2", { className: "ust-h2" }, "活跃热力图"),
						element("div", { className: "ust-sub" },
							// 口径改为「最近一年 / 窗口内」两项：总天数无信息量，活跃与峰值才有行动价值
							(wnd && wnd.id !== "all" ? wnd.label + " · " : "") + "最近一年 · 活跃 " + model.activeDays + " 天",
							model.peak && model.peak.total > 0
								? element("span", null, " · 峰值 " + fmtLarge(model.peak.total) + "（" + fmtDayLabel(model.peak.key) + "）")
								: null,
						),
						// 只留色阶方块：颜色深浅的含义已由副标题说明，再挂「少/多」是冗余
						element("div", { className: "ust-gh-scale" },
							[0, 1, 2, 3, 4].map((lv) => element("span", { key: lv, className: "ust-gh-sw ust-gh-lv" + lv })),
						),
					),
				),
				element("div", { className: "ust-gh-wrap" },
					element("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "活跃热力图", style: { margin: "0 auto" } },
						wdAxis,
						monthMarks.map((m0) => element("g", { key: "m" + m0.col },
							element("text", { className: wdKey, x: cx(m0.col), y: PAD_T - 8, textAnchor: "start" }, m0.month + "月"),
						)),
						model.cells.map((c0) => element("rect", {
							key: c0.key,
							className: "ust-gh-cell ust-gh-lv" + level(c0.total) + (c0.isToday ? " is-today" : ""),
							x: cx(c0.col), y: cy(c0.row), width: CELL, height: CELL, rx: 2.5,
							children: element("title", null, fmtDayLabel(c0.key) + (c0.total > 0 ? " · " + fmtFull(c0.total) + " tokens" : " · 无用量")),
						})),
					),
				),
			);
		}
		// ---------- 分页控件（会话 / 供应商共用） ----------
		function Pager({ page, pageCount, total, unit, onChange }) {
			if (pageCount <= 1) return null;
			const btn = (label, target, disabled, title) => element("button", {
				type: "button", className: "ust-pgBtn", disabled, title,
				onClick: () => onChange(Math.max(0, Math.min(pageCount - 1, target))),
			}, label);
			// 页码窗口：当前页附近最多 5 个
			const win = [];
			const from = Math.max(0, Math.min(page - 2, pageCount - 5));
			for (let i = from; i < Math.min(pageCount, from + 5); i++) win.push(i);
			return element("div", { className: "ust-pager" },
				element("span", { className: "ust-pgInfo" }, "共 " + total + " 个" + unit + " · 第 " + (page + 1) + " / " + pageCount + " 页"),
				element("div", { className: "ust-pgBtns" },
					btn("上一页", page - 1, page === 0, "上一页"),
					win.map((i) => element("button", {
						key: i, type: "button",
						className: "ust-pgBtn" + (i === page ? " is-active" : ""),
						"aria-current": i === page ? "page" : undefined,
						onClick: () => onChange(i),
					}, String(i + 1))),
					btn("下一页", page + 1, page >= pageCount - 1, "下一页"),
				),
			);
		}
		// ---------- 会话统计 / 会话模型明细 ----------
		function SessionsView({ days, window: wnd, meta }) {
			const rows = react.useMemo(() => {
				// meta 是宿主返回的全历史会话数组，按 id 建索引后才能补标题
				const idx = Array.isArray(meta) ? meta.reduce((m, s) => (s && s.id ? (m[s.id] = s, m) : m), {}) : (meta || {});
				return sessionsIn(days, wnd, idx);
			}, [days, wnd, meta]);
			const [detail, setDetail] = react.useState(null);
			const [page, setPage] = react.useState(0);
			const PAGE_SIZE = 10;
			const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
			const safePage = Math.min(page, pageCount - 1);
			const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
			if (!rows.length) return null;
			const grand = rows.reduce((sum, r) => sum + r.total, 0) || 0;
			// 相对时间：今天显示时刻，更早显示日期（复用 fmtClock / dateKey）
			const fmtWhen = (t) => {
				if (!t) return "—";
				const d = new Date(t);
				const clock = fmtClock(t);
				const ymd = dateKey(d);
				const isToday = ymd === dateKey(new Date());
				return isToday && clock ? clock : ymd;
			};
			return element("div", { className: "ust-block" },
				element("div", { className: "ust-block-head" },
					element("div", { className: "ust-block-titleRow" },
						element("h2", { className: "ust-h2" }, "会话统计"),
						element("div", { className: "ust-sub" }, (wnd.id === "all" ? "全部历史" : wnd.label) + "会话的 Token 用量与会话内模型明细"),
					),
					element("div", { className: "ust-sub" }, rows.length + " 个会话"),
				),
				element("div", { className: "ust-tblWrap" },
					element("table", { className: "ust-tbl" },
						element("thead", null, element("tr", null,
							element("th", null, "会话"),
							element("th", { className: "ust-tblNum" }, "轮次"),
							element("th", { className: "ust-tblNum" }, "消息"),
							element("th", { className: "ust-tblNum" }, "Token"),
							element("th", { className: "ust-tblNum" }, "命中"),
							element("th", { className: "ust-tblNum" }, "命中率"),
							element("th", { className: "ust-tblNum" }, "占比"),
							element("th", null, "模型明细"),
							element("th", null, "最近活动"),
						)),
					element("tbody", null,
						pageRows.map((r) => element("tr", {
							key: r.id,
							className: "is-clickable",
							tabIndex: 0,
							role: "button",
							"aria-label": (r.title || r.id) + " 模型明细",
							title: "点击查看该会话的模型明细",
							onClick: () => setDetail(r),
							onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(r); } },
						},
							element("td", null, element("div", { className: "ust-tblName" },
								element("span", { className: "ust-ellip", title: r.title || r.id }, r.title || r.id),
								// 有名称为主、id 为副：同名会话仍可分辨
								r.title ? element("span", { className: "ust-tblSub ust-tblId", title: r.id }, r.id) : null)),
							element("td", { className: "ust-tblNum" }, String(r.turns || 0)),
							element("td", { className: "ust-tblNum" }, String(r.messages || 0)),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.total)),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.cacheRead)),
							element("td", { className: "ust-tblNum" }, fmtPct(hitRateOf(r))),
							element("td", { className: "ust-tblNum" }, (grand > 0 ? Math.round((r.total / grand) * 100) : 0) + "%"),
							element("td", null, (r.byModel || []).slice(0, 4).map((m, i) =>
								element("span", { key: i, className: "ust-dot", title: m.model + "：" + fmtLarge(m.total), style: { background: m.color || "var(--ink)" } }))),
							element("td", { className: "ust-tblSub" }, fmtWhen(r.lastTime || r.createdAt)),
						)),
					),
				),
			),
				rows.length > PAGE_SIZE ? element(Pager, { page: safePage, pageCount, total: rows.length, unit: "会话", onChange: setPage }) : null,
				detail ? element(ModelsDetailModal, {
					title: detail.title || detail.id,
					sub: (wnd.id === "all" ? "全部历史" : wnd.label) + " · " + ((detail.byModel || []).length) + " 个模型",
					sumItems: [
						{ label: "Token", value: fmtLarge(detail.total) },
						{ label: "缓存命中", value: fmtLarge(detail.cacheRead) },
						{ label: "命中率", value: fmtPct(hitRateOf(detail)) },
						{ label: "轮次", value: String(detail.turns || 0) },
						{ label: "消息", value: String(detail.messages || 0) },
					],
					models: detail.byModel,
					onClose: () => setDetail(null),
				}) : null,
		);
		}
		// ---------- 模型明细弹窗（供应商 / 会话共用） ----------
		// 标题 + 摘要项 + 逐模型行；点遮罩、点关闭按钮或按 Esc 关闭
		function ModelsDetailModal({ title, sub, sumItems, models, onClose }) {
			react.useEffect(() => {
				const onKey = (e) => { if (e.key === "Escape") onClose(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [onClose]);
			const rows = models || [];
			const sum = rows.reduce((a, m) => a + (m.total || 0), 0);
			// 模型超过一屏时分页，避免弹窗内长列表
			const [page, setPage] = react.useState(0);
			const PAGE_SIZE = 10;
			const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
			const safePage = Math.min(page, pageCount - 1);
			const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
			return element("div", { className: "ust-dlgMask", onClick: onClose },
				element("div", {
					className: "ust-dlg", role: "dialog", "aria-modal": "true",
					"aria-label": "模型明细", onClick: (e) => e.stopPropagation(),
				},
					element("div", { className: "ust-dlgHead" },
						element("div", { className: "ust-dlgTitleBox" },
							element("h3", { className: "ust-dlgTitle", title: title }, title),
							sub ? element("p", { className: "ust-dlgSub" }, sub) : null,
						),
						element("button", { type: "button", className: "ust-dlgClose", "aria-label": "关闭", title: "关闭", onClick: onClose }, element(IconClose)),
					),
					element("div", { className: "ust-dlgBody" },
						sumItems && sumItems.length ? element("div", { className: "ust-dlgSum" },
							sumItems.map((it) => element("div", { key: it.label, className: "ust-dlgSumItem" },
								element("div", { className: "ust-dlgSumLab" }, it.label),
								element("div", { className: "ust-dlgSumVal" }, it.value))),
						) : null,
						element("div", { className: "ust-tblWrap" },
							element("table", { className: "ust-tbl" },
								element("thead", null, element("tr", null,
									element("th", null, "模型"),
									element("th", { className: "ust-tblNum" }, "输入"),
									element("th", { className: "ust-tblNum" }, "输出"),
									element("th", { className: "ust-tblNum" }, "缓存命中"),
									element("th", { className: "ust-tblNum" }, "命中率"),
									element("th", { className: "ust-tblNum" }, "总量"),
									element("th", { className: "ust-tblNum" }, "占比"),
								)),
								element("tbody", null, pageRows.map((m) => element("tr", { key: m.model },
									element("td", null, element("div", { className: "ust-tblName" },
										element("span", { className: "ust-dot", style: { background: m.color || "var(--ink)" } }),
										element("span", { className: "ust-ellip", title: m.model }, m.model))),
									element("td", { className: "ust-tblNum" }, fmtLarge(m.input)),
									element("td", { className: "ust-tblNum" }, fmtLarge(m.output)),
									element("td", { className: "ust-tblNum" }, fmtLarge(m.cacheRead)),
									element("td", { className: "ust-tblNum" }, fmtPct(hitRateOf(m))),
									element("td", { className: "ust-tblNum" }, fmtLarge(m.total)),
									element("td", { className: "ust-tblNum" }, (sum > 0 ? Math.round((m.total / sum) * 100) : 0) + "%"),
								))),
							),
						),
						rows.length > PAGE_SIZE ? element(Pager, { page: safePage, pageCount, total: rows.length, unit: "模型", onChange: setPage }) : null,
					),
				),
			);
		}
		// ---------- 供应商用量统计 ----------
		function ProvidersView({ days, window: wnd }) {
			const rows = react.useMemo(() => providersIn(days, wnd), [days, wnd]);
			const [detail, setDetail] = react.useState(null);
			const [page, setPage] = react.useState(0);
			const PAGE_SIZE = 10;
			const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
			const safePage = Math.min(page, pageCount - 1);
			const pageRows = rows.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
			if (!rows.length) return null;
			const grand = rows.reduce((sum, r) => sum + r.total, 0) || 0;
			return element("div", { className: "ust-block" },
				element("div", { className: "ust-block-head" },
					element("div", { className: "ust-block-titleRow" },
						element("h2", { className: "ust-h2" }, "供应商用量统计"),
						element("div", { className: "ust-sub" }, (wnd.id === "all" ? "全部历史" : wnd.label) + "按 API 提供商汇总，含各家模型明细"),
					),
					element("div", { className: "ust-sub" }, rows.length + " 个供应商"),
				),
				element("div", { className: "ust-tblWrap" },
					element("table", { className: "ust-tbl" },
						element("thead", null, element("tr", null,
							element("th", null, "供应商"),
							element("th", { className: "ust-tblNum" }, "输入"),
							element("th", { className: "ust-tblNum" }, "输出"),
							element("th", { className: "ust-tblNum" }, "缓存命中"),
							element("th", { className: "ust-tblNum" }, "命中率"),
							element("th", { className: "ust-tblNum" }, "总量"),
							element("th", { className: "ust-tblNum" }, "占比"),
							element("th", null, "模型明细"),
						)),
					element("tbody", null,
						pageRows.map((r) => element("tr", {
							key: r.provider,
							className: "is-clickable",
							tabIndex: 0,
							role: "button",
							"aria-label": r.provider + " 模型明细",
							title: "点击查看该供应商的模型明细",
							onClick: () => setDetail(r),
							onKeyDown: (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDetail(r); } },
						},
							element("td", null, element("div", { className: "ust-tblName" },
								element("span", { className: "ust-dot", style: { background: r.color || "var(--ink)" } }),
								element("span", { className: "ust-ellip", title: r.provider }, r.provider))),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.input)),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.output)),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.cacheRead)),
							element("td", { className: "ust-tblNum" }, fmtPct(hitRateOf(r))),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.total)),
							element("td", { className: "ust-tblNum" }, (grand > 0 ? Math.round((r.total / grand) * 100) : 0) + "%"),
							element("td", null, (r.byModel || []).slice(0, 4).map((m, i) =>
								element("span", { key: i, className: "ust-dot", title: m.model + "：" + fmtLarge(m.total), style: { background: m.color || "var(--ink)" } }))),
						)),
					),
				),
			),
				rows.length > PAGE_SIZE ? element(Pager, { page: safePage, pageCount, total: rows.length, unit: "供应商", onChange: setPage }) : null,
				detail ? element(ModelsDetailModal, {
					title: detail.provider,
					sub: (wnd && wnd.id !== "all" ? wnd.label + " · " : "") + ((detail.byModel || []).length) + " 个模型",
					sumItems: [
						{ label: "总量", value: fmtLarge(detail.total) },
						{ label: "缓存命中", value: fmtLarge(detail.cacheRead) },
						{ label: "命中率", value: fmtPct(hitRateOf(detail)) },
					],
					models: detail.byModel,
					onClose: () => setDetail(null),
				}) : null,
		);
		}
		function Trend({ days, window: wnd }) {
			const [boxRef, boxW] = useMeasure();
			const [hidden, setHidden] = react.useState({});
			const [hover, setHover] = react.useState(null);
			const [placeTip, clearTip, tipEl] = useTip();
			const scrollRef = react.useRef(null);

			const isHour = (wnd.dateKeys || []).length === 1;
			const singleDate = isHour ? wnd.dateKeys[0] : null;
			const dayList = fillDays(days, wnd);
			const singleDay = dayList[0] || null;
			const hourMap = new Map((isHour && singleDay && Array.isArray(singleDay.hours) ? singleDay.hours : []).map((h) => [h.hour, h]));
			const xData = isHour
				? Array.from({ length: 24 }, (_, h) => hourMap.get(h) || { hour: h, total: 0, byModel: [] })
				: dayList;
			const xLabel = (d) => (isHour ? String(d.hour).padStart(2, "0") + ":00" : fmtDayLabel(d.date));

			// 柱顶数值（如「6816.5万」）在 11px 字号下大约占用的宽度，用于判断标签是否会被压字
			const BAR_LABEL_W = 46;
			// 窄面板里柱子太多会糊成一团：按宽度决定显示几条
			const series = react.useMemo(() => foldModels(modelTotalsIn(days, wnd), (boxW || 400) < 520 ? 4 : 5), [days, wnd, boxW]);
			// 把一个 fold 出来的段（可能是「其他 N 个模型」）在当期的 byModel 里还原成用量
			const segTotalOf = (by, s) => (s.children
				? s.children.reduce((acc, c) => acc + (((by.find((x) => x.model === c.model) || {}).total) || 0), 0)
				: (((by.find((x) => x.model === s.model) || {}).total) || 0));
			const values = react.useMemo(() => xData.map((d) => {
				const by = d.byModel || [];
				const vals = series.map((s) => segTotalOf(by, s));
				return { total: vals.reduce((a, b) => a + b, 0), vals };
			}), [xData, series]);

			const visible = series.map((s) => !hidden[s.model]);
			const visTotals = values.map((v) => v.vals.reduce((a, b, i) => a + (visible[i] ? b : 0), 0));
			const peakTotal = Math.max(1, ...visTotals);

			const N = xData.length || 1;
			// 极窄容器压缩左右留白，保证 svg 不超容器宽（避免横向溢出）
			const narrow = (boxW || 400) < 380;
			const PAD_L = narrow ? 30 : 40, PAD_R = narrow ? 6 : 10, PAD_T = 20, PAD_B = 34;
			const avail = Math.max(120, boxW - PAD_L - PAD_R);
			const step = N > 1 ? avail / (N - 1) : avail;
			// 单点太挤时横向滚动，保证柱间距不小于 9px
			const minStep = isHour ? 14 : (narrow ? 7.5 : 9);
			const needScroll = N > 1 && step < minStep;
			let plotW = needScroll ? (N - 1) * minStep : avail;
			// 不滚动时必须严丝合缝落在容器内（避免 1–2px 溢出触发横向滚动条）
			if (!needScroll) plotW = Math.max(80, Math.min(plotW, (boxW || 400) - PAD_L - PAD_R));
			const W = PAD_L + plotW + PAD_R;
			const H = (boxW || 400) < 520 ? 168 : 200;
			const baseY = H - PAD_B;
			const topY = PAD_T;
			const bandW = N > 1 ? (needScroll ? minStep : plotW / (N - 1)) : avail;
			const barW = Math.max(3, Math.min(bandW * 0.62, 30));
			const xc = (i) => (N > 1 ? PAD_L + i * (needScroll ? minStep : plotW / (N - 1)) : PAD_L + plotW / 2);
			const y = (v) => baseY - (v / peakTotal) * (baseY - topY);

			// 柱状图 Y 轴：0 与峰值两档刻度，避免密集小字
			const grid = [
				element("line", { key: "g0", className: "ust-grid", x1: PAD_L, y1: topY, x2: PAD_L + plotW, y2: topY }),
				element("line", { key: "g1", className: "ust-baseline", x1: PAD_L, y1: baseY, x2: PAD_L + plotW, y2: baseY }),
				element("text", { key: "t0", className: "ust-axis", x: PAD_L - 7, y: topY + 4, textAnchor: "end" }, fmtLarge(peakTotal)),
				element("text", { key: "t1", className: "ust-axis", x: PAD_L - 7, y: baseY + 4, textAnchor: "end" }, "0"),
			];

			// X 轴标签：首、尾、中间均匀 3 个，共 5 个
			const labelEvery = narrow ? Math.max(1, Math.ceil(N / 3)) : Math.max(1, Math.ceil(N / 5));
			const labelIdx = N <= 1 ? [0] : (() => {
				const set = new Set([0, N - 1]);
				for (let i = labelEvery; i < N - 1; i += labelEvery) set.add(i);
				return [...set].sort((a, b) => a - b);
			})();
			const xAxis = labelIdx.map((i) => element("text", {
				key: "x" + i, className: "ust-axis", x: xc(i), y: baseY + 20, textAnchor: i === 0 ? "start" : i === N - 1 ? "end" : "middle",
			}, xLabel(xData[i])));

			// 峰值判定：柱顶标签与峰值标注都要用，先算出来
			let peakIdx = 0, peakVal = -1;
			visTotals.forEach((v, i) => { if (v > peakVal) { peakVal = v; peakIdx = i; } });

			// 堆叠柱：一根柱 = 一格，段序与图例一致
			const bars = values.map((v, i) => {
				let acc = 0;
				const segs = series.map((s, k) => {
					if (!visible[k] || !(v.vals[k] > 0)) return null;
					const y0 = y(acc), y1 = y(acc + v.vals[k]);
					acc += v.vals[k];
					return element("rect", {
						key: "s" + k, className: cF(s.rank) + " ust-bar",
						x: xc(i) - barW / 2, y: y1, width: barW, height: Math.max(1, y0 - y1),
					});
				});
				return element("g", { key: "b" + i }, segs,
					element("rect", { className: "ust-hitband", x: xc(i) - bandW / 2, y: topY, width: bandW, height: baseY - topY }));
			});

			// 峰值标注：比普通数值更醒目，故该柱不再重复普通标签
			const peakMark = peakVal > 0 ? element("text", {
				className: "ust-callout", x: xc(peakIdx), y: Math.max(topY + 10, y(peakVal) - 7),
				textAnchor: peakIdx === 0 ? "start" : peakIdx === N - 1 ? "end" : "middle",
			}, fmtLarge(peakVal)) : null;

			// 柱顶数值：每根柱标出合计用量。
			// 步长放不下一个数值时按步长稀疏，避免相邻文字互相压字；峰值另有更醒目的标注，此处跳过以免重复。
			const effStep = needScroll ? minStep : (N > 1 ? plotW / (N - 1) : plotW);
			const labelStride = Math.max(1, Math.ceil(BAR_LABEL_W / Math.max(1, effStep)));
			const barLabels = values.map((v, i) => {
				if (!(v.total > 0) || i === peakIdx) return null;
				if (i % labelStride !== 0 && i !== N - 1) return null;
				return element("text", {
					key: "v" + i, className: "ust-bar-val",
					x: xc(i), y: Math.max(topY + 9, y(v.total) - 6),
					textAnchor: i === 0 ? "start" : i === N - 1 ? "end" : "middle",
				}, fmtLarge(v.total));
			});

			const onMove = (e) => {
				if (!boxW) return;
				const rect = e.currentTarget.getBoundingClientRect();
				// 取所在滚动容器的位移，横向滚动后仍算得准
				const holder = e.currentTarget.closest(".ust-plot");
				const local = e.clientX - rect.left + (holder ? holder.scrollLeft : 0);
				const i = needScroll
					? Math.max(0, Math.min(N - 1, Math.round((local - PAD_L) / minStep)))
					: Math.max(0, Math.min(N - 1, Math.round(((local - PAD_L) / plotW) * (N - 1))));
				setHover(i);
				const rows = series.map((s, k) => visible[k]
					? element("div", { key: s.model, className: "ust-tip-row" },
						element("span", { className: "ust-tip-key" },
							element("span", { className: "ust-tip-swatch", style: { background: cVar(s.rank) } }),
							element("span", null, s.model)),
						element("span", { className: "ust-tip-val" }, fmtFull(values[i].vals[k])))
					: null);
				placeTip(e, element("div", null,
					element("div", { className: "ust-tip-title" }, (isHour ? fmtDayLabel(singleDate) + " " : "") + xLabel(xData[i])),
					element("div", { className: "ust-tip-body" }, fmtFull(visTotals[i]) + " tokens · " + fmtLarge(visTotals[i])),
					rows,
				));
			};

			return element("div", { className: "ust-block" },
				element("div", { className: "ust-block-head" },
					element("div", { className: "ust-block-titleRow" },
						element("h2", { className: "ust-h2" }, isHour ? "按小时的用量分布" : "用量趋势"),
						element("div", { className: "ust-sub" }, "一根柱 = 一个模型，柱高 = 当期用量"),
					),
					element("div", { className: "ust-sub" }, wnd.label),
				),
				// 图例置于图表上方
				element("div", { className: "ust-legend ust-legend--above" },
					series.map((s) => element("span", {
						key: s.model,
						className: "ust-legend-item",
						style: { opacity: hidden[s.model] ? 0.4 : 1 },
						onClick: () => setHidden((h) => ({ ...h, [s.model]: !h[s.model] })),
						role: "button", tabIndex: 0,
					},
						element("span", { className: "ust-legend-dot " + cB(s.rank) }),
						element("span", null, s.model),
					)),
				),
				element("div", { ref: boxRef },
					element("div", { className: "ust-plot" + (needScroll ? " is-scroll" : ""), ref: scrollRef },
						boxW > 0 ? element("svg", { width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "用量分布柱状图" },
							grid, xAxis, bars, barLabels, peakMark,
							hover !== null && element("line", { className: "ust-cursor", x1: xc(hover), y1: topY, x2: xc(hover), y2: baseY }),
							element("rect", { className: "ust-hit", x: 0, y: 0, width: W, height: H, onMouseMove: onMove, onMouseLeave: () => { setHover(null); clearTip(); } }),
						) : null,
					),
				),
				tipEl,
			);
		}

		// ---------- 3) 模型用量 ----------
		// 一刻度 = 1%，段内刻度同色，段名与数值由下方列表承担（窄容器不放外圈标签）
		function Donut({ days, window: wnd }) {
			const [boxRef, boxW] = useMeasure();
			const [active, setActive] = react.useState(null);
			const [placeTip, clearTip, tipEl] = useTip();

			const list = modelTotalsIn(days, wnd);
			const sum = list.reduce((s, m) => s + m.total, 0);
			const segs = foldModels(list, 5);
			const TICKS = 100;
			let used = 0;
			const counts = segs.map((m) => {
				const t = sum > 0 ? Math.round((m.total / sum) * TICKS) : 0;
				used += t;
				return t;
			});
			if (sum > 0 && counts.length) counts[0] += TICKS - used;

			const SIZE = Math.max(140, Math.min(176, boxW || 168));
			const CX = SIZE / 2, CY = SIZE / 2;
			const R = SIZE / 2 - 20;
			const C = SIZE / 2;

			// 极坐标：0° 指向 12 点，顺时针
			const pol = (r, deg) => {
				const a = (deg - 90) * Math.PI / 180;
				return [CX + r * Math.cos(a), CY + r * Math.sin(a)];
			};
			// 环形扇区：内外两段弧 + 两条径向边
			const annulus = (d0, d1, r0, r1) => {
				const [ax0, ay0] = pol(r0, d0), [ax1, ay1] = pol(r0, d1);
				const [bx1, by1] = pol(r1, d1), [bx0, by0] = pol(r1, d0);
				const big = d1 - d0 > 180 ? 1 : 0;
				return "M" + ax0 + " " + ay0 + " A" + r0 + " " + r0 + " 0 " + big + " 1 " + ax1 + " " + ay1 +
					" L" + bx1 + " " + by1 + " A" + r1 + " " + r1 + " 0 " + big + " 0 " + bx0 + " " + by0 + " Z";
			};
			const TIP_MAX = 15; // 刻度最长 9 + 6
			const ticks = [];
			const hitBands = [];
			let acc = 0;
			segs.forEach((s, si) => {
				const n = counts[si];
				for (let k = 0; k < n; k++) {
					const idx = acc + k;
					const a = (idx * 3.6 - 90) * Math.PI / 180;
					const len = 9 + rnd(idx + 1, si + 2) * 6;
					// 视觉刻度不绑事件：缝隙处会丢命中，统一交给下面的扇区
					ticks.push(element("line", {
						key: "t" + idx,
						className: cS(s.rank) + " ust-tick",
						x1: CX + R * Math.cos(a), y1: CY + R * Math.sin(a),
						x2: CX + (R + len) * Math.cos(a), y2: CY + (R + len) * Math.sin(a),
					}));
					if (idx % 10 === 0) {
						ticks.push(element("circle", { key: "m" + idx, className: "ust-tickmark", cx: CX + (R - 6) * Math.cos(a), cy: CY + (R - 6) * Math.sin(a), r: 1.2 }));
					}
				}
				if (n > 0) {
					// 命中扇区：从本段第一刻中心到末刻中心，左右各扩半格 = 整圈无缝
					const tip = element("div", null,
						element("div", { className: "ust-tip-title" }, s.model),
						element("div", { className: "ust-tip-body" }, fmtFull(s.total) + " tokens · " + (sum > 0 ? (s.total / sum * 100).toFixed(1) : "0") + "%"),
						element("div", { className: "ust-tip-body" }, "命中 " + fmtFull(s.cacheRead || 0) + " · 命中率 " + fmtPct(hitRateOf(s))),
						s.children ? element("div", { className: "ust-tip-body" }, "含 " + s.children.map((c) => c.model).join("、")) : null,
					);
					const show = (e) => { setActive(s.model); placeTip(e, tip); };
					hitBands.push(element("path", {
						key: "hb" + si, className: "ust-hitband",
						d: annulus((acc - 0.5) * 3.6, (acc + n - 0.5) * 3.6, R - 5, R + TIP_MAX + 6),
						onMouseEnter: show, onMouseMove: show,
						onMouseLeave: () => { setActive(null); clearTip(); },
					}));
				}
				acc += n;
			});

			return element("div", { className: "ust-block" },
				element("div", { className: "ust-block-head" },
					element("div", { className: "ust-block-titleRow" },
						element("h2", { className: "ust-h2" }, "模型用量"),
						element("div", { className: "ust-sub" }, "一刻度 = 1%，每 10 刻一枚锚点，颜色 = 模型"),
					),
					element("div", { className: "ust-sub" }, wnd.label),
				),
				element("div", { ref: boxRef },
					element("div", { className: "ust-donut-wrap" },
						element("div", { className: "ust-donut", style: { width: SIZE + "px", height: SIZE + "px" } },
							element("svg", { viewBox: "0 0 " + SIZE + " " + SIZE, role: "img", "aria-label": "模型用量刻度环" }, ticks, hitBands),
							element("div", { className: "ust-donut-center" },
								element("div", { className: "num" }, fmtLarge(sum)),
								element("div", { className: "lab" }, "TOKENS"),
							),
						),
						element("div", { className: "ust-models-box" },
							// 列名表头：与下面各行同宽同对齐，读数字时不必猜列的含义
							element("div", { className: "ust-model ust-model--head", "aria-hidden": "true" },
								element("span", { className: "ust-model-name" }, "模型"),
								element("span", { className: "ust-model-row" },
									element("span", { className: "ust-model-hit" }, "缓存命中"),
									element("span", { className: "ust-model-rate" }, "命中率"),
									element("span", { className: "ust-model-sub" }, "总量"),
									element("span", { className: "ust-model-val" }, "占比"))),
							element("ul", { className: "ust-models" },
							segs.map((s) => element("li", {
								key: s.model,
								className: "ust-model",
								style: { opacity: active && active !== s.model ? 0.45 : 1 },
								onMouseEnter: () => setActive(s.model),
								onMouseLeave: () => setActive(null),
							},
								element("span", { className: "ust-model-name" },
									element("span", { className: "ust-model-dot " + cB(s.rank) }),
									element("span", { title: s.children ? s.children.map((c) => c.model).join("、") : s.model }, s.model)),
								element("span", { className: "ust-model-row" },
									// 命中量与命中率：命中率沿用全局口径（缓存命中 / 当期满量）
									element("span", { className: "ust-model-hit" }, "命中 " + fmtLarge(s.cacheRead)),
									element("span", { className: "ust-model-rate" }, fmtPct(hitRateOf(s))),
									element("span", { className: "ust-model-sub" }, fmtLarge(s.total)),
									element("span", { className: "ust-model-val" }, (sum > 0 ? Math.round((s.total / sum) * 100) : 0) + "%")),
							)),
						),
					),
					),
				),
				tipEl,
			);
		}

		// ---------- 主视图 ----------
		function UsageStatsContent() {
			const [data, setData] = react.useState(null);
			const [error, setError] = react.useState(null);
			const [loading, setLoading] = react.useState(true);
			const [range, setRange] = react.useState({ id: "today" });
			const [showCustom, setShowCustom] = react.useState(false);
			const [from, setFrom] = react.useState("");
			const [to, setTo] = react.useState("");
			// 自动刷新：默认开启，默认 5 秒
			const [autoRefresh, setAutoRefresh] = react.useState(true);
			const [autoEvery, setAutoEvery] = react.useState(5);

			const load = react.useCallback(async (force) => {
				setLoading(true);
				try {
					const res = await fetch("/api/usage-stats" + (force ? "?refresh=1" : ""), { credentials: "same-origin" });
					if (!res.ok) throw new Error("HTTP " + res.status);
					const json = await res.json();
					if (!json || json.ok === false) throw new Error((json && json.error) || "响应异常");
					setData(json);
					setError(null);
				} catch (e) {
					setError(String((e && e.message) || e));
				}
				setLoading(false);
			}, []);

			react.useEffect(() => { load(false); }, [load]);

			// 自动刷新：定时重新拉取（不强制重扫，走服务端 SWR 缓存）
			react.useEffect(() => {
				if (!autoRefresh) return;
				const id = setInterval(() => { load(false); }, Math.max(1, autoEvery) * 1000);
				return () => clearInterval(id);
			}, [autoRefresh, autoEvery, load]);

			const days = (data && data.days) || [];
			const hasData = days.length > 0;
			const wnd = react.useMemo(() => {
				if ((typeof range === "string" ? range : range.id) === "all") {
					return { id: "all", label: "全部", dateKeys: days.map((d) => d.date).sort() };
				}
				return resolveWindow(range);
			}, [range, days]);

			if (loading && !data) {
				return element("div", { className: "ust-root" },
					element("div", { className: "ust-skeleton", style: { width: "40%" } }),
					element("div", { className: "ust-skeleton", style: { width: "100%", height: 96 } }),
					element("div", { className: "ust-placeholder" }, "统计加载中"),
				);
			}
			if (error && !data) {
				return element("div", { className: "ust-root" },
					element("div", { className: "ust-warn" }, "加载失败：" + error),
					element("div", { className: "ust-actions", style: { marginTop: 16 } },
						element("button", { className: "ust-btn", onClick: () => load(true) }, "重试")),
				);
			}

			const stats = calcStats(days, wnd);
			const winList = modelTotalsIn(days, wnd);
			const winTop = winList.length ? [...winList].sort((a, b) => b.total - a.total)[0] : null;
			const topName = winTop ? winTop.model : ((data.topModel && data.topModel.name) || "无");
			const topSub = winTop && stats.total > 0
				? "占本窗口 " + Math.round((winTop.total / stats.total) * 100) + "%"
				: "";
			const avgPerActive = stats.activeDays > 0 ? stats.total / stats.activeDays : 0;
			// 窗口内会话数与消息数：会话按「天」去重（跨天会话只计一次），消息按天累加
			const winAgg = fillDays(days, wnd).reduce((acc, d) => {
				acc.messages += d.messages || 0;
				acc.total += d.total || 0;
				(d.byModel || []).forEach((m) => { acc.cacheRead += m.cacheRead || 0; });
				(d.sessions || []).forEach((s) => acc.ids.add(s.id));
				return acc;
			}, { messages: 0, total: 0, cacheRead: 0, ids: new Set() });
			const winStats = {
				sessions: winAgg.ids.size,
				messages: winAgg.messages,
				cacheRead: winAgg.cacheRead,
				rate: winAgg.total > 0 ? winAgg.cacheRead / winAgg.total : null,
			};
			// 窗口显示名：全部区间不显示（此时指标本身就是全历史口径）
			const winName = wnd.id === "all" ? "" : wnd.label;
			// 副标题口径：窗口内汇总则补一句全历史，避免读者误以为是全部
			const winScoped = winName ? wnd.label + " · 共 " + ((data && data.sessionCount) || 0) + " 个" : "全部历史";
			// 统计周期只有一天时，「活跃天数」「日均」恒为 1 / 等于总量，无信息量，不展示
			const singleDayWindow = (wnd.dateKeys || []).length <= 1;
			const invalid = !!(from && to && from > to);

			return element("div", { className: "ust-root" },
				element(SummaryMetrics, { summary: data.summary }),
				hasData ? element(Heatmap, { days, window: wnd }) : null,
				element("div", { className: "ust-header" },
					element("h1", { className: "ust-page-title" }, "Token用量统计"),
					element("div", { className: "ust-rangebox" },
						element("div", { className: "ust-tabs", role: "tablist" },
							RANGES.map((r) => element("span", {
								key: r.id, role: "tab", "aria-selected": range.id === r.id,
								className: "ust-tab" + (range.id === r.id ? " active" : ""),
								onClick: () => { setRange({ id: r.id }); setShowCustom(false); },
							}, r.label)),
							element("span", {
								role: "tab", "aria-selected": range.id === "custom",
								className: "ust-tab" + (range.id === "custom" ? " active" : ""),
								onClick: () => setShowCustom((v) => !v),
							}, "自定义"),
						),
						showCustom ? element("div", { className: "ust-custom" },
							element("div", { className: "ust-custom-row" },
								element("input", { className: "ust-date", type: "date", value: from, max: to || undefined, "aria-label": "开始日期", onChange: (e) => setFrom(e.target.value) }),
								element("span", { className: "ust-custom-sep" }, "至"),
								element("input", { className: "ust-date", type: "date", value: to, min: from || undefined, "aria-label": "结束日期", onChange: (e) => setTo(e.target.value) }),
							),
							invalid ? element("div", { className: "ust-warn" }, "结束日期不能早于开始日期") : null,
							element("div", { className: "ust-custom-actions" },
								element("button", { className: "ust-btn ust-btn--ghost", onClick: () => { setShowCustom(false); setFrom(""); setTo(""); } }, "取消"),
								element("button", {
									className: "ust-btn ust-btn--primary",
									disabled: !(from && to) || invalid,
									onClick: () => { setRange({ id: "custom", from, to }); setShowCustom(false); },
								}, "应用"),
							),
						) : null,
					),
				),
				element("div", { className: "ust-metrics" },
					element(Metric, { icon: element(IconToken), label: "窗口 Token", value: fmtLarge(stats.total), sub: fmtFull(stats.total) }),
					singleDayWindow ? null : element(Metric, { icon: element(IconCalendar), label: "活跃天数", value: String(stats.activeDays) + " 天", sub: "有用量的天" }),
					singleDayWindow ? null : element(Metric, { icon: element(IconTrend), label: "日均", value: fmtLarge(avgPerActive), sub: "按活跃天平均" }),
					element(Metric, { icon: element(IconChat), label: "窗口会话", value: String(winStats.sessions), sub: winScoped } ),
					element(Metric, { icon: element(IconMail), label: "窗口消息", value: fmtFull(winStats.messages), sub: "assistant/message" }),
					element(Metric, { icon: element(IconToken), label: "缓存命中", value: fmtLarge(winStats.cacheRead), sub: fmtFull(winStats.cacheRead) + " tokens" }),
					element(Metric, { icon: element(IconTrend), label: "命中率", value: fmtPct(winStats.rate), sub: "缓存命中 / 当期满量" }),
					element(Metric, { icon: element(IconBolt), label: "最常用模型", value: topName, sub: topSub, text: true }),
				),
				wnd.dateKeys.length === 0 ? element("div", { className: "ust-warn" }, "当前时间范围没有数据") : null,
				data.warnings && data.warnings.length > 0 ? element("div", { className: "ust-warn" }, data.warnings.join("；")) : null,
				hasData && wnd.dateKeys.length > 0 ? element(Trend, { days, window: wnd }) : null,
				hasData && wnd.dateKeys.length > 0 ? element(Donut, { days, window: wnd }) : null,
			element(ProvidersView, { days: days, window: wnd }),
			element(SessionsView, { days: days, window: wnd, meta: data.sessions }),
				element("div", { className: "ust-footer" },
					element("div", { className: "ust-meta" },
						loading ? "正在重新扫描全部会话…" : (data.generatedAt ? "数据更新于 " + fmtClock(data.generatedAt) : ""),
					),
					element("div", { className: "ust-auto" },
						element("label", { className: "ust-autoToggle", title: "开启后按所选间隔自动刷新数据" },
							element("input", {
								type: "checkbox",
								className: "ust-autoCheck",
								checked: autoRefresh,
								onChange: (e) => setAutoRefresh(e.target.checked),
							}),
							element("span", null, "自动刷新"),
						),
						autoRefresh ? element("div", { className: "ust-autoSeg", role: "tablist", "aria-label": "自动刷新间隔" },
							AUTO_OPTIONS.map((sec) => element("span", {
								key: sec, role: "tab", "aria-selected": autoEvery === sec,
								className: "ust-tab" + (autoEvery === sec ? " active" : ""),
								onClick: () => setAutoEvery(sec),
							}, sec + " 秒")),
						) : null,
					),
					element("button", {
						className: "ust-btn", disabled: loading, onClick: () => load(true),
						title: "重新扫描本机全部会话记录",
					},
						element("span", { className: "ust-btn-ico" + (loading ? " is-spin" : "") }, element(IconRefresh)),
						loading ? "刷新中" : "刷新",
					),
				),
			);
		}

		// ---------- 侧边栏菜单项（原生 panellist 风格） ----------
		const PANEL_ID = "token-usage";
		function UsageStatsPanelIcon({ size }) {
			return element("span", { className: "ust-panelGlyph", style: { width: (size || 16) + "px", height: (size || 16) + "px" } }, element(IconTrend));
		}

		// ---------- 主区域页面（点击菜单后显示） ----------
		function UsageStatsPage() {
			return element("div", { className: "ust-page" },
				element("div", { className: "ust-pageHead" },
					element("h1", { className: "ust-pageTitle" }, "用量统计"),
					element("p", { className: "ust-pageSub" }, "按天 / 按小时趋势、模型用量与活跃热力图"),
				),
				element("div", { className: "ust-pageBody" }, element(UsageStatsContent)),
			);
		}
		// ---------- 弹窗容器（对齐 dsh-token-usage 的展示方式） ----------
		function UsageStatsModal(props) {
			const { onClose } = props;
			const [closing, setClosing] = react.useState(false);
			const close = react.useCallback(() => {
				setClosing(true);
				setTimeout(onClose, 180);
			}, [onClose]);
			react.useEffect(() => {
				const onKey = (e) => { if (e.key === "Escape") close(); };
				window.addEventListener("keydown", onKey);
				return () => window.removeEventListener("keydown", onKey);
			}, [close]);
			return element("div", { className: "ust-overlay" + (closing ? " is-closing" : "") },
				element("div", { className: "ust-mask", "aria-hidden": "true", onClick: close }),
				element("div", { className: "ust-panel", role: "dialog", "aria-modal": "true", "aria-label": "Token用量统计" },
					element("div", { className: "ust-panelHead" },
						element("div", { className: "ust-panelTitleBox" },
							element("h2", { className: "ust-panelTitle" }, "Token用量统计"),
							element("p", { className: "ust-panelSub" }, "按天 / 按小时趋势、模型用量与活跃热力图"),
						),
						element("button", { type: "button", className: "ust-closeBtn", "aria-label": "关闭", title: "关闭", onClick: close }, element(IconClose)),
					),
					element("div", { className: "ust-panelBody" }, element(UsageStatsContent)),
				),
			);
		}

		// ---------- 侧边栏入口（与 dsh-token-usage 同槽位、同位置） ----------
		function UsageStatsAction(props) {
			const { wide } = props;
			const [open, setOpen] = react.useState(false);
			return element("div", { className: "ust-fab" },
				element("button", {
					type: "button",
					className: "ust-fabBtn" + (wide ? "" : " ust-fabBtn--rail"),
					"aria-haspopup": "dialog",
					"aria-expanded": open,
					"aria-label": "Token用量统计",
					title: "Token用量统计",
					onClick: () => setOpen(true),
				},
					element("span", { className: "ust-fabIco" }, element(IconTrend)),
					wide ? element("span", { className: "ust-fabLabel" }, "Token用量统计") : null,
				),
				open ? element(UsageStatsModal, { onClose: () => setOpen(false) }) : null,
			);
		}
		function apply(ctx) {
			ctx.effect(() => {
				const style = document.createElement("style");
				style.dataset.plugin = "dsh-token-panel";
				style.textContent = CSS + MODAL_CSS;
				document.head.appendChild(style);
				return () => {
					style.remove();
				};
			});
			// 侧边栏菜单项：与原生「插件」「定时任务」同级（插件 order 0，本项 20）
			ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({
				name: "sidebar.panellist",
				id: PANEL_ID,
				order: 20,
				label: () => "用量统计",
			}, UsageStatsPanelIcon));
			// 主区域页面：点击菜单后渲染的内容（keyed by PANEL_ID）
			ctx.slots.inject("main", () => ctx.slots.register({
				name: "main",
				key: PANEL_ID,
			}, UsageStatsPage));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
