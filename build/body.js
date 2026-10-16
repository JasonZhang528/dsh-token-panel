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
		// 折叠指示：双 chevron 朝下（即 `>>` 旋转 90° 的形态）。
		// 两枚折线竖向堆叠，收起点向下、展开整体翻转朝上，是通用的「可展开」语义。
		const IconChevronDown2 = () => icon(["M7 6l5 5 5-5", "M7 12l5 5 5-5"]);

		// ---------- 供应商品牌标记（内置，随包发布，不依赖外部图标资源） ----------
		// 每个供应商给一个自绘 SVG 标记 + 品牌色：形状取该供应商最具辨识度的符号，
		// 未收录的供应商回落到「首字母 + 主题色」徽标。
		// 全部为内联 path，无外部请求；fill 用 currentColor 以便跟随深浅主题。
		// 注意：只用闭合填充形状——描边式线段在 fill 下零面积，渲染出来不可见。
				// ---------- 供应商品牌 logo（内置，随包发布，零外部请求） ----------
				// 来源与授权：simple-icons（CC0 1.0）单色 path、thesvg-color（MIT）彩色 path，
				// 均允许内联再分发。单色用 currentColor 跟随主题；彩色自带 fill，双主题通用。
				// 未收录的供应商回落「首字母 + 主题色」徽标（见 ProviderBadge）。
				const PROVIDER_BRANDS = {
					deepseek: { color: "#4D6BFE", paths: ["M23.748 4.651c-.254-.124-.364.113-.512.233-.051.04-.094.09-.137.137-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.155-.708-.311-.955-.65-.172-.24-.219-.509-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.094.172.187.129.323-.082.28-.18.553-.266.833-.055.179-.137.218-.328.14a5.5 5.5 0 0 1-1.737-1.179c-.857-.828-1.631-1.743-2.597-2.46a12 12 0 0 0-.689-.47c-.985-.957.13-1.743.387-1.836.27-.098.094-.433-.778-.428-.872.003-1.67.295-2.687.685a3 3 0 0 1-.465.136a9.6 9.6 0 0 0-2.883-.101c-1.885.21-3.39 1.1-4.497 2.622C.082 8.776-.231 10.854.152 13.02c.403 2.284 1.568 4.175 3.36 5.653c1.857 1.533 3.997 2.284 6.438 2.14c1.482-.085 3.132-.284 4.994-1.86c.47.234.962.328 1.78.398c.629.058 1.235-.031 1.705-.129c.735-.155.684-.836.418-.961c-2.155-1.004-1.682-.595-2.112-.926c1.095-1.295 2.768-3.598 3.284-6.733c.05-.346.115-.834.108-1.114c-.004-.171.035-.238.23-.257a4.2 4.2 0 0 0 1.545-.475c1.397-.763 1.96-2.016 2.093-3.517c.02-.23-.004-.467-.247-.588M11.58 18.168c-2.088-1.642-3.101-2.183-3.52-2.16-.39.024-.32.472-.234.763.09.288.207.487.371.74.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.168-1.361-.801-2.5-1.86-3.301-3.306-.775-1.393-1.225-2.888-1.299-4.482-.02-.385.094-.522.477-.592a4.7 4.7 0 0 1 1.53-.038c2.131.311 3.946 1.264 5.467 2.774.868.86 1.525 1.887 2.202 2.89.72 1.066 1.494 2.082 2.48 2.915.348.291.626.513.892.677-.802.09-2.14.109-3.055-.615zm1.001-6.44a.306.306 0 0 1 .415-.287a.3.3 0 0 1 .113.074a.3.3 0 0 1 .086.214c0 .17-.136.307-.308.307a.303.303 0 0 1-.306-.307m3.11 1.596c-.2.081-.4.151-.591.16a1.25 1.25 0 0 1-.798-.254c-.274-.23-.47-.358-.551-.758a1.7 1.7 0 0 1 .015-.588c.07-.327-.007-.537-.238-.727-.188-.156-.426-.199-.689-.199a.6.6 0 0 1-.254-.078.253.253 0 0 1-.114-.358 1 1 0 0 1 .192-.21c.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.392.451.462.576.685.915.176.264.336.536.446.848.066.194-.02.353-.25.45"] },
					openai: { color: "#10A37F", paths: ["M22.282 9.821a6 6 0 0 0-.516-4.91a6.05 6.05 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a6 6 0 0 0-3.998 2.9a6.05 6.05 0 0 0 .743 7.097a5.98 5.98 0 0 0 .51 4.911a6.05 6.05 0 0 0 6.515 2.9A6 6 0 0 0 13.26 24a6.06 6.06 0 0 0 5.772-4.206a6 6 0 0 0 3.997-2.9a6.06 6.06 0 0 0-.747-7.073M13.26 22.43a4.48 4.48 0 0 1-2.876-1.04l.141-.081l4.779-2.758a.8.8 0 0 0 .392-.681v-6.737l2.02 1.168a.07.07 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494M3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085l4.783 2.759a.77.77 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646M2.34 7.896a4.5 4.5 0 0 1 2.366-1.973V11.6a.77.77 0 0 0 .388.677l5.815 3.354l-2.02 1.168a.08.08 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.08.08 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667m2.01-3.023l-.141-.085l-4.774-2.782a.78.78 0 0 0-.785 0L9.409 9.23V6.897a.07.07 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.8.8 0 0 0-.393.681zm1.097-2.365l2.602-1.5l2.607 1.5v2.999l-2.597 1.5l-2.607-1.5Z"] },
					anthropic: { color: "#D97757", paths: ["m4.714 15.956l4.718-2.648l.079-.23l-.08-.128h-.23l-.79-.048l-2.695-.073l-2.337-.097l-2.265-.122l-.57-.121l-.535-.704l.055-.353l.48-.321l.685.06l1.518.104l2.277.157l1.651.098l2.447.255h.389l.054-.158l-.133-.097l-.103-.098l-2.356-1.596l-2.55-1.688l-1.336-.972l-.722-.491L2 6.223l-.158-1.008l.656-.722l.88.06l.224.061l.893.686l1.906 1.476l2.49 1.833l.364.304l.146-.104l.018-.072l-.164-.274l-1.354-2.446l-1.445-2.49l-.644-1.032l-.17-.619a3 3 0 0 1-.103-.729L6.287.133L6.7 0l.995.134l.42.364l.619 1.415L9.735 4.14l1.555 3.03l.455.898l.243.832l.09.255h.159V9.01l.127-1.706l.237-2.095l.23-2.695l.08-.76l.376-.91l.747-.492l.583.28l.48.685l-.067.444l-.286 1.851l-.558 2.903l-.365 1.942h.213l.243-.242l.983-1.306l1.652-2.064l.728-.82l.85-.904l.547-.431h1.032l.759 1.129l-.34 1.166l-1.063 1.347l-.88 1.142l-1.263 1.7l-.79 1.36l.074.11l.188-.02l2.853-.606l1.542-.28l1.84-.315l.832.388l.09.395l-.327.807l-1.967.486l-2.307.462l-3.436.813l-.043.03l.049.061l1.548.146l.662.036h1.62l3.018.225l.79.522l.473.638l-.08.485l-1.213.62l-1.64-.389l-3.825-.91l-1.31-.329h-.183v.11l1.093 1.068l2.003 1.81l2.508 2.33l.127.578l-.321.455l-.34-.049l-2.204-1.657l-.85-.747l-1.925-1.62h-.127v.17l.443.649l2.343 3.521l.122 1.08l-.17.353l-.607.213l-.668-.122l-1.372-1.924l-1.415-2.168l-1.141-1.943l-.14.08l-.674 7.254l-.316.37l-.728.28l-.607-.461l-.322-.747l.322-1.476l.388-1.924l.316-1.53l.285-1.9l.17-.632l-.012-.042l-.14.018l-1.432 1.967l-2.18 2.945l-1.724 1.845l-.413.164l-.716-.37l.066-.662l.401-.589l2.386-3.036l1.439-1.882l.929-1.086l-.006-.158h-.055L4.138 18.56l-1.13.146l-.485-.456l.06-.746l.231-.243l1.907-1.312Z"] },
					gemini: { color: "#3B82F6", paths: ["M11.04 19.32Q12 21.51 12 24q0-2.49.93-4.68q.96-2.19 2.58-3.81t3.81-2.55Q21.51 12 24 12q-2.49 0-4.68-.93a12.3 12.3 0 0 1-3.81-2.58a12.3 12.3 0 0 1-2.58-3.81Q12 2.49 12 0q0 2.49-.96 4.68q-.93 2.19-2.55 3.81a12.3 12.3 0 0 1-3.81 2.58Q2.49 12 0 12q2.49 0 4.68.96q2.19.93 3.81 2.55t2.55 3.81"] },
					moonshot: { color: "#111111", paths: ["m1.053 16.91l9.538 2.55a21 20.981 0 0 0 .06 2.031l5.956 1.592a12 11.99 0 0 1-15.554-6.172m-1.02-5.79l11.352 3.035a21 20.981 0 0 0-.469 2.01l10.817 2.89a12 11.99 0 0 1-1.845 2.004L.658 15.918a12 11.99 0 0 1-.625-4.796m1.593-5.146L13.573 9.17a21 20.981 0 0 0-1.01 1.874l11.297 3.02a21 20.981 0 0 1-.67 2.362l-11.55-3.087L.125 10.26a12 11.99 0 0 1 1.499-4.285ZM6.067 1.58l11.285 3.016a21 20.981 0 0 0-1.688 1.719l7.824 2.091a21 20.981 0 0 1 .513 2.664L2.107 5.218a12 11.99 0 0 1 3.96-3.638M21.68 4.866L7.222 1.003A12 11.99 0 0 1 21.68 4.866"] },
					kimi: { color: "#111111", paths: ["m1.053 16.91l9.538 2.55a21 20.981 0 0 0 .06 2.031l5.956 1.592a12 11.99 0 0 1-15.554-6.172m-1.02-5.79l11.352 3.035a21 20.981 0 0 0-.469 2.01l10.817 2.89a12 11.99 0 0 1-1.845 2.004L.658 15.918a12 11.99 0 0 1-.625-4.796m1.593-5.146L13.573 9.17a21 20.981 0 0 0-1.01 1.874l11.297 3.02a21 20.981 0 0 1-.67 2.362l-11.55-3.087L.125 10.26a12 11.99 0 0 1 1.499-4.285ZM6.067 1.58l11.285 3.016a21 20.981 0 0 0-1.688 1.719l7.824 2.091a21 20.981 0 0 1 .513 2.664L2.107 5.218a12 11.99 0 0 1 3.96-3.638M21.68 4.866L7.222 1.003A12 11.99 0 0 1 21.68 4.866"] },
					qwen: { color: "#615CED", paths: ["M23.919 14.545L20.817 9.17l1.47-2.544a.56.56 0 0 0 0-.566l-1.633-2.83a.57.57 0 0 0-.49-.283h-6.207L12.487.402a.57.57 0 0 0-.49-.284H8.732a.56.56 0 0 0-.49.284L5.139 5.775h-2.94a.56.56 0 0 0-.49.284L.077 8.887a.56.56 0 0 0 0 .567L3.18 14.83l-1.47 2.545a.56.56 0 0 0 0 .566l1.634 2.83a.57.57 0 0 0 .49.283h6.205l1.47 2.545a.57.57 0 0 0 .49.284h3.266a.57.57 0 0 0 .49-.284l3.104-5.375h2.94a.57.57 0 0 0 .49-.283l1.634-2.828a.55.55 0 0 0-.004-.568M8.733.686l1.634 2.828l-1.634 2.828H21.8L20.164 9.17H7.425L5.63 6.06Zm1.306 19.801l-6.205-.002l1.634-2.83h3.265L2.201 6.344h3.267q3.182 5.517 6.367 11.032zm10.124-5.66L18.53 12l-6.532 11.315l-1.634-2.83c2.129-3.673 4.25-7.351 6.373-11.028h3.592l3.102 5.374z"] },
					opencode: { color: "#211E1E", paths: ["M22 24H2V0h20zM17 4.8H7v14.4h10z"] },
				}
		// 供应商名 -> 品牌键：做包含匹配，兼容 deepseek-account / workbuddy-ai 等变体
		function providerBrandOf(name) {
			const n = String(name || "").toLowerCase();
			if (!n) return null;
			if (PROVIDER_BRANDS[n]) return PROVIDER_BRANDS[n];
			const order = [
				"deepseek", "openai", "anthropic", "claude", "gemini", "moonshot", "kimi",
				"qwen", "opencode",
			];
			for (const k of order) {
				const brand = PROVIDER_BRANDS[k];
				if (!brand) continue;
				if (n.includes(k)) return brand;
			}
			return null;
		}
		// 供应商徽标：统一块面——同一块浅灰圆角底（20px，与 TOP5 序号徽标同阶），
		// 命中品牌画品牌色内联 SVG，未收录画供应商主题色首字母。
		// 不再用深色实心块：整页是浅色细线语言，一列里深浅混排会显得突兀。
		function ProviderBadge({ name, color }) {
			const brand = providerBrandOf(name);
			if (brand) {
				return element("span", {
					className: "ust-provLogo is-brand",
					style: { color: brand.color },
					"aria-hidden": "true", title: name,
				}, element("svg", {
					viewBox: "0 0 24 24", fill: "currentColor", stroke: "none",
					width: 14, height: 14,
				}, brand.paths.map((d, i) => element("path", { key: i, d }))));
			}
			return element("span", {
				className: "ust-provLogo is-fallback",
				style: { color: color || "var(--ink)" },
				"aria-hidden": "true", title: name,
			}, String(name || "?").slice(0, 1).toUpperCase());
		}

		const CSS = `__CSS__`;

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
		// 当日分段活跃时长（宿主按 >30min 断开求和后下发）
		const durationOf = (d) => (d && d.durationMs ? d.durationMs : 0);
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
		// 时长：毫秒 -> 中文可读。不足 1 分钟显示「<1 分」，避免出现「0 分」误导
		function fmtDuration(ms) {
			const n = Number(ms) || 0;
			if (n <= 0) return "—";
			const min = Math.floor(n / 60000);
			if (min < 1) return "<1 分";
			if (min < 60) return min + " 分";
			const h = Math.floor(min / 60);
			const m = min % 60;
			if (h < 24) return m > 0 ? h + " 小时 " + m + " 分" : h + " 小时";
			const d = Math.floor(h / 24);
			const rh = h % 24;
			return rh > 0 ? d + " 天 " + rh + " 小时" : d + " 天";
		}
		// 紧凑时长：图表刻度/提示用，尽量短
		function fmtDurationShort(ms) {
			const n = Number(ms) || 0;
			if (n <= 0) return "0";
			const min = Math.round(n / 60000);
			if (min < 60) return min + "分";
			const h = n / 3600000;
			if (h < 24) return (h >= 10 ? Math.round(h) : Math.round(h * 10) / 10) + "时";
			return Math.round(n / 86400000) + "天";
		}
		// 模型折叠档数：柱状图、圆环、表格配色都用它，保证三处看到的段划分一致
		const MODEL_FOLD = 5;
		// 窗口内「模型 → 配色序号」，必须沿用与柱状图相同的折叠规则：
		// 被并进「其他 N 个模型」的尾部模型统一取该聚合段的颜色——
		// 它们在图上本来就是这个颜色，若另给一个序号，色点就会与图例冲突（第 6 名之后必现）。
		function modelRanksIn(days, wnd) {
			const m = new Map();
			foldModels(modelTotalsIn(days, wnd), MODEL_FOLD).forEach((s) => {
				if (s.children) s.children.forEach((c) => m.set(c.model, s.rank));
				else m.set(s.model, s.rank);
			});
			return m;
		}
		// 取模型色；表里没有的模型（理论上不该出现）按名称散列兜底
		function colorVarFor(model, ranks) {
			if (ranks && ranks.has(model)) return "var(--c" + (ranks.get(model) % CATN) + ")";
			return modelColorOf(model);
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
					const cur = acc.get(s.id) || { id: s.id, total: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, turns: 0, messages: 0, durationMs: 0, lastTime: null, byModel: {} };
					cur.durationMs += s.durationMs || 0; // 窗口内各天的分段活跃时长累加
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

		// 按窗口聚合「活动洞察」计数：合并窗口内各天的工具 / 插件 / Skill / MCP 计数。
		// 兼容性：若宿主未下发天级 insights（旧版本宿主 / 旧磁盘缓存），
		// 则整份数据都没有 day.insights——此时退回全历史口径，避免整块榜单消失。
		// 注意只在「全局都没有」时退回：若只是当前窗口恰好没有调用，应如实显示为空。
		function insightsIn(days, wnd, all) {
			const keys = wnd.dateKeys || [];
			const hasDayLevel = (days || []).some((d) => d && d.insights);
			if (!keys.length || !hasDayLevel) return all || {};
			const merge = (list, box) => (list || []).forEach((it) => box.set(it.name, (box.get(it.name) || 0) + (it.count || 0)));
			const box = { tools: new Map(), plugins: new Map(), skills: new Map(), mcp: new Map() };
			fillDays(days, wnd).forEach((d) => {
				if (!d.insights) return;
				merge(d.insights.tools, box.tools);
				merge(d.insights.plugins, box.plugins);
				merge(d.insights.skills, box.skills);
				merge(d.insights.mcp, box.mcp);
			});
			const top = (m, n = 5) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([name, count]) => ({ name, count }));
			return {
				totalToolCalls: [...box.tools.values()].reduce((a, b) => a + b, 0),
				distinctTools: box.tools.size,
				totalSkillUses: [...box.skills.values()].reduce((a, b) => a + b, 0),
				distinctSkills: box.skills.size,
				totalMcpCalls: [...box.mcp.values()].reduce((a, b) => a + b, 0),
				distinctMcp: box.mcp.size,
				topPlugins: top(box.plugins),
				topSkills: top(box.skills),
				topMcp: top(box.mcp),
				topTools: top(box.tools),
			};
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
				// 第二行统一 TOKENS 文本：与「窗口 Token」「缓存命中」同一套卡面语言
				element(Metric, { icon: element(IconToken), label: "累计", value: fmtLarge(s.totalTokens), sub: "TOKENS" }),
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

		// ---------- 提示行：左「标签」右「数值」，与表格列宽同基准，扫读不必猜 ----------
		// 每个数值都配一行说明（是什么 + 精确值），不放「裸数字」——
		// 提示框停留时间短，读者没有余力在数字与含义之间做二次映射。
		function tipRow(label, value) {
			return element("div", { key: label, className: "ust-tip-row" },
				element("span", { className: "ust-tip-key" }, element("span", null, label)),
				element("span", { className: "ust-tip-val" }, value));
		}
		// 提示分组小标题：同组多行（如各模型分项）时用来分段
		function tipHead(label) {
			return element("div", { key: "h" + label, className: "ust-tip-head" }, label);
		}


		// ---------- 1) 活跃热力图 ----------
		// 日历点阵：一格一天，点面积 = 当天用量（sqrt 换算，面积才与数值成正比）
		// 只保留「每日」一种展示：一格一天
		const WD = ["日", "一", "二", "三", "四", "五", "六"];
		// 自动刷新可选的间隔（秒）
		const AUTO_OPTIONS = [5, 10, 30, 60];

		// ---------- 活跃热力图（GitHub 贡献网格风格：周列 × 星期行，方块按用量着色） ----------
		function Heatmap({ days, window: wnd }) {
			// 指标：token 用量 / 活跃时长；视图：每日格 / 每周柱 / 累计线
			const [metric, setMetric] = react.useState("token");
			const [view, setView] = react.useState("day");
		const [placeTip, clearTip, tipEl] = useTip();
		const isTime = metric === "time";
		// 提示文案：把一格背后的每个口径逐行列出，标签 + 精确值。
		// 不写「裸数字」——Token 给千分位全量，时长给出可读拆解，
		// 读者不必在心里换算，也不必回去翻副标题。
		const dayTip = (c0) => [
			// 小标题与行标签同一套文案（Token 用量 / 活跃时长），读提示时不必换词
			tipHead(fmtDayLabel(c0.key)),
			isTime
				? tipRow("活跃时长", fmtDuration(c0.durationMs))
				// Token 走「万 / 亿」量级：提示框窄，逐位数字既挤又难扫读
				: tipRow("Token 用量", fmtLarge(c0.total) + " tokens"),
			tipRow("轮次", String(c0.turns || 0) + " 次"),
			// 累计口径只在有意义时给出：首日之前没有累计值
			c0.cum !== undefined
				? tipRow("年内累计", isTime ? fmtDuration(c0.cum) : fmtLarge(c0.cum) + " tokens")
				: null,
		].filter(Boolean);
		// 悬停：命中层不改变视觉，只负责把提示挂到鼠标处。
		// 用原生事件委托而非 React 合成 onMouseEnter：委托在 svg 容器上收
		// mouseover/mouseout,真实鼠标移动与自动化派发两种来源都稳定触发。
		const gridRef = react.useRef(null);
		react.useEffect(() => {
			const el = gridRef.current;
			if (!el) return;
			const pickCell = (t) => {
				let n = t;
				while (n && n !== el) {
					if (n.classList && n.classList.contains("ust-hitcell")) return n;
					n = n.parentNode;
				}
				return null;
			};
			let lastKey = null;
			const over = (e) => {
				const cellEl = pickCell(e.target);
				if (!cellEl || cellEl.getAttribute("data-key") === lastKey) return;
				lastKey = cellEl.getAttribute("data-key");
				const c0 = model.cells.find((x) => x.key === lastKey);
				if (c0) onEnter(e, c0);
			};
			const out = (e) => {
				if (pickCell(e.target)) { lastKey = null; onLeave(); }
			};
			el.addEventListener("mouseover", over);
			el.addEventListener("mouseout", out);
			return () => {
				el.removeEventListener("mouseover", over);
				el.removeEventListener("mouseout", out);
			};
		});
		const onEnter = (e, c0) => placeTip(e, element("div", { className: "ust-tip-block" }, dayTip(c0)));
		const onLeave = () => clearTip();
			const metricOf = react.useCallback(
				(c) => (metric === "time" ? (c.durationMs || 0) : (c.total || 0)),
				[metric],
			);
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
				let maxDay = 0, peak = null, activeDays = 0, yearTotal = 0, yearDuration = 0;
				const cumMap = new Map();
				let cum = 0;
				(days || []).forEach((d) => { cum += totalOf(d); cumMap.set(d.date, cum); });
				for (let cur = new Date(start0); cur <= end0; cur.setDate(cur.getDate() + 1)) {
					const key = dateKey(cur);
					const day = map.get(key);
					const total = totalOf(day);
					const dur = durationOf(day);
					const col = Math.floor((cur - start0) / 86400000 / 7);
					cells.push({
						key, col, row: cur.getDay(), total, durationMs: dur, turns: turnsOf(day), cum: cumMap.get(key),
						month: cur.getMonth() + 1, dom: cur.getDate(), isToday: key === dateKey(today),
					});
					if (total > 0) activeDays += 1;
					yearTotal += total;
					yearDuration += dur;
					if (total > maxDay) { maxDay = total; peak = cells[cells.length - 1]; }
				}
				return { cells, maxDay, peak, activeDays, yearTotal, yearDuration, start: start0, end: end0 };
			}, [days]);

			// 当前指标下的峰值（Token / 时长口径不同，必须分别求）
			let peakMetric = 0, peakCell = model.peak || { key: "", total: 0 };
			model.cells.forEach((c0) => {
				const v = metricOf(c0);
				if (v > peakMetric) { peakMetric = v; peakCell = c0; }
			});
			// GitHub 五档底色：按当前指标占峰值的比例分档（无数据用 quiet）
			const level = (v) => {
				if (!(v > 0) || !(peakMetric > 0)) return 0;
				const r = v / peakMetric;
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

			// 五档色阶的数值区间：颜色深浅对应可读的量，不必猜。
			// 分档口径与 level() 完全一致（12% / 33% / 66% 峰值），避免图例与格子脱节。
			const legendRanges = (() => {
				if (!(peakMetric > 0)) return null;
				const fmtV = (v) => (metric === "time" ? fmtDurationShort(v) : fmtLarge(v));
				const b1 = peakMetric * 0.12, b2 = peakMetric * 0.33, b3 = peakMetric * 0.66;
				return ["无", "≤ " + fmtV(b1), fmtV(b1) + " – " + fmtV(b2), fmtV(b2) + " – " + fmtV(b3), "> " + fmtV(b3)];
			})();

			return element("div", { className: "ust-block" },
				element("div", { className: "ust-block-head ust-gh-head" },
					element("div", { className: "ust-block-titleRow" },
						element("h2", { className: "ust-h2" }, "活跃热力图"),
						element("div", { className: "ust-sub" },
							// 副标题随所选指标变化，颜色深浅的含义始终显式说明
							metric === "time"
								? "一块 = 一天，颜色越深 = 当日活跃时长越长 · 活跃 " + model.activeDays + " 天"
								: "一块 = 一天，颜色越深 = 当日 Token 越多 · 活跃 " + model.activeDays + " 天",
							peakMetric > 0
								? element("span", null, " · 峰值 " + (metric === "time" ? fmtDuration(peakMetric) : fmtLarge(peakMetric)) + "（" + fmtDayLabel(peakCell.key) + "）")
								: null,
						),
					),
					// 控件行独立于标题行：标题 / 副标题在上，两组单选在下一行居右，
					// 图表独占整行——宽幅栅格不再为侧栏让出横向空间。
					element("div", { className: "ust-gh-toolbar" },
						element("div", { className: "ust-gh-toolGroup" },
							element("span", { className: "ust-gh-toolLab" }, "指标"),
							element("div", { className: "ust-gh-metric", role: "radiogroup", "aria-label": "热力图指标" },
								[["token", "Token"], ["time", "时长"]].map(([id, label]) =>
									element("button", {
										key: id, type: "button", role: "radio", "aria-checked": metric === id,
										className: "ust-gh-mbtn" + (metric === id ? " active" : ""),
										onClick: () => setMetric(id),
									}, label)),
							),
						),
						element("div", { className: "ust-gh-toolGroup" },
							element("span", { className: "ust-gh-toolLab" }, "维度"),
							element("div", { className: "ust-gh-views", role: "tablist", "aria-label": "热力图视图" },
								[["day", "每日"], ["week", "每周"], ["cum", "累计"]].map(([id, label]) =>
									element("button", {
										key: id, type: "button", role: "tab", "aria-selected": view === id,
										className: "ust-gh-vbtn" + (view === id ? " active" : ""),
										onClick: () => setView(id),
									}, label)),
							),
						),
					),
				),
				// 图表独占一行：整行宽度都交给栅格 / 趋势图
				element("div", { className: "ust-gh-body" },
					view === "day"
						// ── 每日视图：GitHub 贡献格 ──
						? element("div", { className: "ust-gh-wrap" },
							element("svg", { ref: gridRef, width: W, height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": "活跃热力图（每日）", style: { margin: "0 auto" } },
								wdAxis,
								monthMarks.map((m0) => element("g", { key: "m" + m0.col },
									element("text", { className: wdKey, x: cx(m0.col), y: PAD_T - 8, textAnchor: "start" }, m0.month + "月"),
								)),
								// 一格两层：下层着色、上层透明命中。命中与着色解耦，
								// 事件由 svg 容器原生委托，格子只带 data-key。
								// 注意：命中层不放 <title>——原生 tooltip 会与结构化弹窗双出。
								model.cells.map((c0) => [
									element("rect", {
										key: "c" + c0.key,
										className: "ust-gh-cell ust-gh-lv" + level(metricOf(c0)) + (c0.isToday ? " is-today" : ""),
										x: cx(c0.col), y: cy(c0.row), width: CELL, height: CELL, rx: 2.5,
									}),
									element("rect", {
										key: "h" + c0.key,
										className: "ust-hitcell",
										"data-key": c0.key,
										x: cx(c0.col), y: cy(c0.row), width: CELL, height: CELL,
									}),
								]),
							),
						)
						// ── 每周 / 累计视图：柱状与折线，共用同一套指标口径 ──
						: element(HeatTrend, {
							cells: model.cells, metric: metric, view: view,
							tipRow: tipRow, tipHead: tipHead, fmtDayLabel: fmtDayLabel, fmtDuration: fmtDuration,
							placeTip: placeTip, clearTip: clearTip,
						}),
				),
				// 图例置底：只给「少 → 多」的色阶，色块后不逐档标数值区间。
				// 区间信息保留在色块的 title 上——不占视觉，悬停仍可查。
				// 格子视图用五档色阶；每周柱 / 累计折线是单色，改给单色图例，避免误导。
				view === "day"
					? element("div", { className: "ust-gh-scale ust-gh-scale--foot" },
						element("span", { className: "ust-scale-lab" }, "少"),
						[0, 1, 2, 3, 4].map((lv) => element("span", {
							key: lv,
							className: "ust-gh-sw ust-gh-lv" + lv,
							title: legendRanges ? legendRanges[lv] : "",
						})),
						element("span", { className: "ust-scale-lab" }, "多"),
					)
					// 每周 / 累计是单色图：方块本身无深浅含义，必须带一句释义
					: element("div", { className: "ust-gh-scale ust-gh-scale--foot" },
						element("span", { className: "ust-gh-sw", style: { background: "var(--c3)" } }),
						element("span", { className: "ust-gh-scale-note" },
							(metric === "time" ? "时长" : "Token") + (view === "cum" ? " · 累计折线" : " · 每周柱形")),
					),
				tipEl,
			);
		}
		// ---------- 热力图：每周柱状 / 累计折线 ----------
		// 与每日格同源（同一份 cells），切换视图不改变口径，只是换一种聚合方式
		function HeatTrend({ cells, metric, view, tipRow, tipHead, fmtDayLabel, fmtDuration, placeTip, clearTip }) {
			const [hover, setHover] = react.useState(null);
			const W = 1120, H = 180, PAD_L = 54, PAD_R = 12, PAD_T = 16, PAD_B = 26;
			const plotW = W - PAD_L - PAD_R, plotH = H - PAD_T - PAD_B;
			const val = (c) => (metric === "time" ? (c.durationMs || 0) : (c.total || 0));
			// 按周分组（col 即周序），累计视图则对同一序列求前缀和；顺带记每周活跃天数
			const weeks = [];
			for (let i = 0; i < 53; i++) {
				const inWeek = cells.filter((c) => c.col === i);
				if (!inWeek.length) continue;
				weeks.push({
					col: i,
					sum: inWeek.reduce((a, c) => a + val(c), 0),
					days: inWeek.filter((c) => val(c) > 0).length,
					first: inWeek[0], last: inWeek[inWeek.length - 1],
				});
			}
			const cum = [];
			let run = 0;
			weeks.forEach((w) => { run += w.sum; cum.push({ col: w.col, sum: run, days: w.days, first: w.first, last: w.last }); });
			const series = view === "cum" ? cum : weeks;
			const maxV = series.reduce((m, x) => Math.max(m, x.sum), 0) || 1;
			const step = plotW / Math.max(1, series.length);
			const barW = Math.max(2, Math.min(step * 0.7, 18));
			const yOf = (v) => PAD_T + plotH - (v / maxV) * plotH;
			const linePath = series.map((x, i) => (i ? "L" : "M") + (PAD_L + step * (i + 0.5)).toFixed(1) + " " + yOf(x.sum).toFixed(1)).join(" ");
			// 结构化提示：与每日格同一套「小标题 + 标签行」，口径随所选指标切换
			const isTime = metric === "time";
			const weekTip = (x) => [
				tipHead((view === "cum" ? "截至 " : "") + fmtDayLabel(x.last.key)),
				isTime
					? tipRow(view === "cum" ? "累计时长" : "活跃时长", fmtDuration(x.sum))
					// 与每日格同口径：Token 一律走万 / 亿量级
					: tipRow(view === "cum" ? "累计 Token" : "Token 用量", fmtLarge(x.sum) + " tokens"),
				tipRow("区间", fmtDayLabel(x.first.key) + " – " + fmtDayLabel(x.last.key)),
				tipRow("活跃天数", String(x.days || 0) + " 天"),
			];
			return element("div", { className: "ust-gh-wrap" },
				element("svg", { width: "100%", height: H, viewBox: "0 0 " + W + " " + H, role: "img", "aria-label": view === "cum" ? "活跃热力图（累计）" : "活跃热力图（每周）", preserveAspectRatio: "none" },
					// 基线
					element("line", { className: "ust-gh-base", x1: PAD_L, y1: PAD_T + plotH, x2: W - PAD_R, y2: PAD_T + plotH }),
					// Y 轴极值
					element("text", { className: "ust-gh-axis", x: PAD_L - 6, y: PAD_T + 4, textAnchor: "end" }, metric === "time" ? fmtDurationShort(maxV) : fmtLarge(maxV)),
					element("text", { className: "ust-gh-axis", x: PAD_L - 6, y: PAD_T + plotH + 3, textAnchor: "end" }, "0"),
					view === "cum"
						? element("path", { className: "ust-gh-line", d: linePath, fill: "none" })
						: series.map((x, i) => element("rect", {
							key: "b" + i, className: "ust-gh-bar",
							x: PAD_L + step * i + (step - barW) / 2, y: yOf(x.sum), width: barW,
							height: Math.max(1, PAD_T + plotH - yOf(x.sum)), rx: 2,
							onMouseEnter: (e) => { setHover(i); placeTip(e, element("div", { className: "ust-tip-block" }, weekTip(x))); },
							onMouseMove: (e) => placeTip(e, element("div", { className: "ust-tip-block" }, weekTip(x))),
							onMouseLeave: () => { setHover(null); clearTip(); },
						})),
					// 数值标注：每周标柱顶、累计标末端点；仅标非零值，避免空周刷屏
					view === "week"
						? series.map((x, i) => (x.sum > 0
							? element("text", {
								key: "v" + i, className: "ust-gh-val",
								x: PAD_L + step * (i + 0.5), y: Math.max(PAD_T + 8, yOf(x.sum) - 5),
								textAnchor: "middle",
							}, metric === "time" ? fmtDurationShort(x.sum) : fmtLarge(x.sum))
							: null))
						: series.map((x, i) => (i === series.length - 1 || x.sum > 0 && i % 8 === 0
							? element("text", {
								key: "v" + i, className: "ust-gh-val",
								x: PAD_L + step * (i + 0.5), y: Math.max(PAD_T + 8, yOf(x.sum) - 5),
								textAnchor: "middle",
							}, metric === "time" ? fmtDurationShort(x.sum) : fmtLarge(x.sum))
							: null)),
					// X 轴：按月标注，避免 53 个刻度糊成一片
					series.map((x, i) => (x.first.dom <= 7
						? element("text", { key: "x" + i, className: "ust-gh-axis", x: PAD_L + step * (i + 0.5), y: H - 8, textAnchor: "middle" }, x.first.month + "月")
						: null)),
					// 透明命中带：每周 / 累计视图逐列命中（柱与折线共用），事件与图形解耦
					series.map((x, i) => element("rect", {
						key: "hb" + i, className: "ust-hitband",
						x: PAD_L + step * i, y: PAD_T, width: step, height: plotH,
						onMouseEnter: (e) => { setHover(i); placeTip(e, element("div", { className: "ust-tip-block" }, weekTip(x))); },
						onMouseMove: (e) => placeTip(e, element("div", { className: "ust-tip-block" }, weekTip(x))),
						onMouseLeave: () => { setHover(null); clearTip(); },
					})),
				),
			);
		}
		// ---------- 活动洞察（默认收起，点标题行展开） ----------
		// 交互：整行是展开开关——标题行左侧 h2 + 说明，右侧双 chevron 朝下；
		// 展开后 chevron 翻转朝上，内容区淡入。键盘可聚焦，Enter / Space 触发。
		// 数据来自宿主 insights：工具 / Skill / MCP 计数与 TOP5。
		// 口径：聊天规模取全历史（宿主只下发全量），工具与扩展用量随日期区间筛选，
		// 两者都在卡片说明行写明，读者不必猜。
		function Insights({ insights, sessionCount, messageCount }) {
			const [open, setOpen] = react.useState(false);
			const ins = insights || {};
			// 一卡一指标：大号数值 = 总量，说明行 = 口径或覆盖广度
			const rows = [
				[IconChat, "聊天总数", fmtFull(sessionCount || 0), "全部历史"],
				[IconMail, "总消息数", fmtFull(messageCount || 0), "全部历史"],
				[IconBolt, "工具调用", fmtFull(ins.totalToolCalls || 0), "已探索 " + (ins.distinctTools || 0) + " 种"],
				[IconTrend, "Skill 使用", fmtFull(ins.totalSkillUses || 0), "用过 " + (ins.distinctSkills || 0) + " 个"],
				[IconToken, "MCP 调用", fmtFull(ins.totalMcpCalls || 0), "用过 " + (ins.distinctMcp || 0) + " 个"],
			];
			return element("div", { className: "ust-insight" + (open ? " is-open" : "") },
				// 整行可点：视觉是标准区块标题，语义是展开开关
				element("button", {
					type: "button", className: "ust-insight-toggle",
					"aria-expanded": open,
					title: open ? "收起活动洞察" : "展开活动洞察",
					onClick: () => setOpen((v) => !v),
				},
					element("span", { className: "ust-insight-head" },
						element("span", { className: "ust-h2" }, "活动洞察"),
						element("span", { className: "ust-insight-sub" }, "工具 / Skill / MCP 的调用量与探索广度 · 随日期区间"),
					),
					// 双 chevron 圆形热区：悬停显底色，展开时整体翻转朝上
					element("span", { className: "ust-insight-chev", "aria-hidden": "true" }, element(IconChevronDown2)),
				),
				open ? element("div", { className: "ust-metrics ust-insight-body ust-fade" },
					rows.map(([Ico, k, v, sub]) => element("div", { key: k, className: "ust-metric" },
						element("div", { className: "ust-metric-label" }, element(Ico), element("span", null, k)),
						element("div", { className: "ust-metric-value" }, v),
						element("div", { className: "ust-metric-sub" }, sub),
					)),
				) : null,
			);
		}

		// ---------- 三榜 TOP5（插件 / MCP / Skill） ----------
		function TopBoards({ insights }) {
			const ins = insights || {};
			// 序号徽标：五档全配徽章——1–3 名金 / 银 / 铜，4–5 名品牌蓝深浅档，同一造型语言
			const rankCls = (i) => "ust-top-rank" + ([" is-gold", " is-silver", " is-bronze", " is-four", " is-five"][i] || "");
			// 三栏同高：用 grid 而非 flex，保证三列顶部对齐、行高一致
			const col = (title, list) => element("div", { key: title, className: "ust-top-col" },
				element("div", { className: "ust-top-title" }, title),
				list.map((it, i) => element("div", { key: it.name, className: "ust-top-row" },
					element("span", { className: rankCls(i) }, String(i + 1)),
					element("span", { className: "ust-top-name", title: it.name }, it.name),
					element("span", { className: "ust-top-count" }, fmtFull(it.count) + " 次"))),
			);
			// 无数据的榜单整栏不渲染，避免出现空的占位列
			const groups = [
				["最常用插件", ins.topPlugins || []],
				["最常用 MCP", ins.topMcp || []],
				["最常用 Skill", ins.topSkills || []],
			].filter(([, list]) => list.length > 0);
			if (!groups.length) return null;
			const cols = groups.map(([title, list]) => col(title, list));
			return element("div", { className: "ust-block" },
				element("div", { className: "ust-block-head" },
					element("div", { className: "ust-block-titleRow" },
						element("h2", { className: "ust-h2" }, "最常用"),
						element("div", { className: "ust-sub" }, "插件 / MCP / Skill 各自 TOP5，按调用次数排序"),
					),
				),
				element("div", { className: "ust-top" }, cols),
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
		function SessionsView({ days, window: wnd, meta, ranks }) {
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
							element("th", { className: "ust-tblNum" }, "时长"),
							// 用量列统一口径与次序：输入 / 输出 / 缓存命中 / 总量 / 命中率 / 占比
							element("th", { className: "ust-tblNum" }, "输入"),
							element("th", { className: "ust-tblNum" }, "输出"),
							element("th", { className: "ust-tblNum" }, "缓存命中"),
							element("th", { className: "ust-tblNum" }, "总量"),
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
							// 分段活跃时长：>30min 断开求和，剔除中途闲置
							element("td", { className: "ust-tblNum" }, fmtDuration(r.durationMs)),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.input)),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.output)),
							// 与表头严格对应：缓存命中在前、总量在后（此前漏改导致两列互换，Sir 实测发现的正是这个）
							element("td", { className: "ust-tblNum" }, fmtLarge(r.cacheRead)),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.total)),
							element("td", { className: "ust-tblNum" }, fmtPct(hitRateOf(r))),
							element("td", { className: "ust-tblNum" }, (grand > 0 ? Math.round((r.total / grand) * 100) : 0) + "%"),
							element("td", null, (r.byModel || []).slice(0, 4).map((m, i) =>
								element("span", { key: i, className: "ust-dot", title: m.model + "：" + fmtLarge(m.total), style: { background: colorVarFor(m.model, ranks) } }))),
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
						{ label: "总量", value: fmtLarge(detail.total) },
						{ label: "缓存命中", value: fmtLarge(detail.cacheRead) },
						{ label: "命中率", value: fmtPct(hitRateOf(detail)) },
						{ label: "轮次", value: String(detail.turns || 0) },
						{ label: "消息", value: String(detail.messages || 0) },
					],
					models: detail.byModel,
					ranks: ranks,
					onClose: () => setDetail(null),
				}) : null,
		);
		}
		// ---------- 模型明细弹窗（供应商 / 会话共用） ----------
		// 标题 + 摘要项 + 逐模型行；点遮罩、点关闭按钮或按 Esc 关闭
		function ModelsDetailModal({ title, sub, sumItems, models, ranks, onClose }) {
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
									element("th", { className: "ust-tblNum" }, "总量"),
									element("th", { className: "ust-tblNum" }, "命中率"),
									element("th", { className: "ust-tblNum" }, "占比"),
								)),
								element("tbody", null, pageRows.map((m) => element("tr", { key: m.model },
									element("td", null, element("div", { className: "ust-tblName" },
										element("span", { className: "ust-dot", style: { background: colorVarFor(m.model, ranks) } }),
										element("span", { className: "ust-ellip", title: m.model }, m.model))),
									element("td", { className: "ust-tblNum" }, fmtLarge(m.input)),
									element("td", { className: "ust-tblNum" }, fmtLarge(m.output)),
									element("td", { className: "ust-tblNum" }, fmtLarge(m.cacheRead)),
									element("td", { className: "ust-tblNum" }, fmtLarge(m.total)),
									element("td", { className: "ust-tblNum" }, fmtPct(hitRateOf(m))),
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
		function ProvidersView({ days, window: wnd, ranks }) {
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
							element("th", { className: "ust-tblNum" }, "总量"),
							element("th", { className: "ust-tblNum" }, "命中率"),
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
							element("td", null, element("div", { className: "ust-provCell" },
								element(ProviderBadge, { name: r.provider, color: r.color }),
								element("span", { className: "ust-ellip", title: r.provider }, r.provider))),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.input)),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.output)),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.cacheRead)),
							element("td", { className: "ust-tblNum" }, fmtLarge(r.total)),
							element("td", { className: "ust-tblNum" }, fmtPct(hitRateOf(r))),
							element("td", { className: "ust-tblNum" }, (grand > 0 ? Math.round((r.total / grand) * 100) : 0) + "%"),
							element("td", null, (r.byModel || []).slice(0, 4).map((m, i) =>
								element("span", { key: i, className: "ust-dot", title: m.model + "：" + fmtLarge(m.total), style: { background: colorVarFor(m.model, ranks) } }))),
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
					ranks: ranks,
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
			// 与表格配色的折叠档数保持一致，否则色点与图例会对不上
			const series = react.useMemo(() => foldModels(modelTotalsIn(days, wnd), MODEL_FOLD), [days, wnd]);
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
			// 刻度按峰值向上取整到「好看的整档」：如 94,553,214 → 95,000,000（刻度 9500万）。
			// 取整档位取最高两位有效数字所在的量级（10 万 / 100 万 / 1000 万 …），
			// 既让刻度标签落在整值上，又保证最高柱不贴顶（留 ~5% 余量）。
			const rawPeak = Math.max(1, ...visTotals);
			const peakTotal = (() => {
				if (rawPeak <= 10) return Math.max(1, rawPeak);
				const mag = Math.pow(10, Math.floor(Math.log10(rawPeak))); // 量级：1e7 → 10,000,000
				const stepU = mag / 10;                                    // 档位：1e6（百万级）
				const up = Math.ceil(rawPeak / stepU) * stepU;
				// 恰好整除时给下一档，避免最高柱顶满格（贴住顶部网格线不好看）
				return up === rawPeak ? up + stepU : up;
			})();

			const N = xData.length || 1;
			// 极窄容器压缩左右留白，保证 svg 不超容器宽（避免横向溢出）
			const narrow = (boxW || 400) < 380;
			// 左留白只需容纳 Y 轴峰值刻度标签本身（右端贴轴、左端不越界），
			// 否则长数值（如「3162.7万」）会在最左侧被裁。
			// 让柱身避开刻度区的活交给下面的 innerL —— 只加 PAD_L 是无效的：
			// 刻度贴轴、柱心也在轴上，两者会一起右移，间距纹丝不动。
			const AXIS_LAB_W = narrow ? 44 : 50;
			const PAD_L = AXIS_LAB_W + 8, PAD_R = narrow ? 6 : 10, PAD_T = 20, PAD_B = 34;
			// 柱身内缩半个柱宽：首柱左缘贴住 Y 轴、末柱右缘不越右界。
			// 否则柱心落在轴线上，左半身（最多 17px）会压住峰值刻度，末柱也会被裁。
			// 注意只加大 PAD_L 治不了这个重叠——刻度贴轴、柱心也在轴上，两者同步右移。
			const COL_INSET = 17; // = 柱宽上限 34 的一半
			const avail = Math.max(120, boxW - PAD_L - PAD_R);
			// 柱心跨度：可绘图区扣掉首尾各半个柱宽
			const spanAvail = Math.max(40, avail - COL_INSET * 2);
			const step = N > 1 ? spanAvail / (N - 1) : spanAvail;
			// 刻度与柱顶数值都要逐格显示，步长下限按最宽标签取。
			// 注意首尾刻度分别用 start / end 锚点，比中间多出约半个标签宽，故步长要按「整标签宽 + 半宽」留量：
			//   时间轴「00:00」约 34px、日期轴「10 月 14 日」约 62px。
			// 放不下就横向滚动，而不是抽稀——抽稀会让「所有刻度 / 每根柱标数值」落空。
			const minStep = isHour
				? Math.max(14, narrow ? 48 : 56)
				: Math.max(narrow ? 12 : 16, narrow ? 78 : 96);
			const needScroll = N > 1 && step < minStep;
			// plotW 是轴线全长：滚动时按步长铺开并补回两侧内缩
			let plotW = needScroll ? (N - 1) * minStep + COL_INSET * 2 : avail;
			// 不滚动时必须严丝合缝落在容器内（避免 1–2px 溢出触发横向滚动条）
			if (!needScroll) plotW = Math.max(80, Math.min(plotW, (boxW || 400) - PAD_L - PAD_R));
			const W = PAD_L + plotW + PAD_R;
			const H = (boxW || 400) < 520 ? 168 : 200;
			const baseY = H - PAD_B;
			const topY = PAD_T;
			// 柱心实际可用的跨度（轴线两端各让出 COL_INSET）
			const spanW = Math.max(20, plotW - COL_INSET * 2);
			const colStep = N > 1 ? (needScroll ? minStep : spanW / (N - 1)) : spanW;
			const bandW = colStep;
			const barW = Math.max(3, Math.min(bandW * 0.62, 34));
			const xc = (i) => (N > 1 ? PAD_L + COL_INSET + i * colStep : PAD_L + COL_INSET + spanW / 2);
			const y = (v) => baseY - (v / peakTotal) * (baseY - topY);

			// 柱状图 Y 轴：只标峰值一档。基线本就是 0，再标一个「0」会与 X 轴首刻度挤在一起，
			// 看起来像凭空多出一个 0，故删除。
			const grid = [
				element("line", { key: "g0", className: "ust-grid", x1: PAD_L, y1: topY, x2: PAD_L + plotW, y2: topY }),
				element("line", { key: "g1", className: "ust-baseline", x1: PAD_L, y1: baseY, x2: PAD_L + plotW, y2: baseY }),
				element("text", { key: "t0", className: "ust-axis", x: PAD_L - 7, y: topY + 4, textAnchor: "end" }, fmtLarge(peakTotal)),
			];

			// X 轴：逐格出刻度，把全部时间点 / 日期都标出来。
			// 单日 24 小时、多日区间都不会被抽稀；宽度不足时由外层横向滚动承载。
			const xAxis = xData.map((d, i) => element("text", {
				key: "x" + i, className: "ust-axis", x: xc(i), y: baseY + 20,
				textAnchor: i === 0 ? "start" : i === N - 1 ? "end" : "middle",
			}, xLabel(d)));

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

			// 峰值标注：比普通数值更醒目，故该柱不再重复普通标签。
			// 柱顶距顶部网格线不足一行字（14px）时，柱顶上方放不下文字——
			// 此时把标注移到柱体内部顶端（描边保证在任何段色上都可读），
			// 而不是硬钳到图表顶部压住柱顶（曾与 Y 轴刻度、柱顶叠成一团）。
			const peakTopGap = y(peakVal) - topY; // 柱顶到顶部网格线的余量
			const peakMark = peakVal > 0 ? element("text", {
				className: "ust-callout",
				x: xc(peakIdx),
				y: peakTopGap < 14 ? y(peakVal) + 15 : Math.max(topY + 12, y(peakVal) - 10),
				textAnchor: "middle",
			}, fmtLarge(peakVal)) : null;

			// 柱顶数值：每根柱顶都标出合计用量——「数量显示在柱子上面」是明确需求，
			// 不再按步长抽稀（曾导致 4 根柱只标 1 根、22 根只标 6 根）。
			// 防重叠改为按字号缩放：柱距放不下整串数值时降到 k 量级（fmtLarge 已是紧凑形态，
			// 这里用字号 9px 的兜底类，比隐藏标签更可读）；峰值仍用更醒目的标注，此处跳过以免重复。
			const barLabels = values.map((v, i) => {
				if (!(v.total > 0) || i === peakIdx) return null;
				const cramped = colStep < BAR_LABEL_W;
				return element("text", {
					key: "v" + i,
					className: "ust-bar-val" + (cramped ? " ust-bar-val--sm" : ""),
					// y 是文本基线：数字没有下伸部，但 bbox 底边比基线低约 3px（内部行距），
					// 再加 2.5px 白描边会向外扩 1.25px——间隙 10px 才能保证视觉上真正悬在柱顶上方
					x: xc(i), y: Math.max(topY + 12, y(v.total) - 10),
					// 一律居中：柱心已内缩 17px，首柱居中后左缘不会压到 Y 轴刻度
					textAnchor: "middle",
				}, fmtLarge(v.total));
			});

			const onMove = (e) => {
				if (!boxW) return;
				const rect = e.currentTarget.getBoundingClientRect();
				// 取所在滚动容器的位移，横向滚动后仍算得准
				const holder = e.currentTarget.closest(".ust-plot");
				const local = e.clientX - rect.left + (holder ? holder.scrollLeft : 0);
				// 反算柱索引：与 xc(i) 同一套几何（起点含 COL_INSET，步长用 colStep）
				const i = Math.max(0, Math.min(N - 1, Math.round((local - PAD_L - COL_INSET) / Math.max(1, colStep))));
				setHover(i);
				const rows = series.map((s, k) => visible[k]
					? element("div", { key: s.model, className: "ust-tip-row" },
						element("span", { className: "ust-tip-key" },
							element("span", { className: "ust-tip-swatch", style: { background: cVar(s.rank) } }),
							element("span", null, s.model)),
						// 模型分项同样走万 / 亿量级，与合计行同一套读法
						element("span", { className: "ust-tip-val" }, fmtLarge(values[i].vals[k])))
					: null);
				placeTip(e, element("div", null,
					element("div", { className: "ust-tip-title" }, (isHour ? fmtDayLabel(singleDate) + " " : "") + xLabel(xData[i])),
					// 数量一律走「万 / 亿」量级：裸千分位（63,701,235）要逐位数位，
					// 且与下面的量级值重复显示。小于 1 万时 fmtLarge 本就是精确值，不损失信息。
					element("div", { className: "ust-tip-body" }, "合计 " + fmtLarge(visTotals[i]) + " tokens"),
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
			// 模型列表分页：超过 5 条自动分页（刻度环本身最多 5 段，此为「其他」桶还原后的明细数）
			const [page, setPage] = react.useState(0);
			const PAGE_SIZE = 5;

			const list = modelTotalsIn(days, wnd);
			const sum = list.reduce((s, m) => s + m.total, 0);
			const segs = foldModels(list, 5);
			// 页码安全：数据变化（切区间 / 刷新）后页码可能越界，钳到有效范围
			const pageCount = Math.max(1, Math.ceil(segs.length / PAGE_SIZE));
			const safePage = Math.min(page, pageCount - 1);
			const pageRows = segs.slice(safePage * PAGE_SIZE, safePage * PAGE_SIZE + PAGE_SIZE);
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
						// 数量统一万 / 亿量级：不再给裸千分位，也不与量级值重复
						element("div", { className: "ust-tip-body" }, "合计 " + fmtLarge(s.total) + " tokens · 占比 " + (sum > 0 ? (s.total / sum * 100).toFixed(1) : "0") + "%"),
						element("div", { className: "ust-tip-body" }, "缓存命中 " + fmtLarge(s.cacheRead || 0) + " · 命中率 " + fmtPct(hitRateOf(s))),
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
									// 与各用量表统一口径与次序：输入 / 输出 / 缓存命中 / 总量 / 命中率 / 占比
									element("span", { className: "ust-model-in" }, "输入"),
									element("span", { className: "ust-model-out" }, "输出"),
									element("span", { className: "ust-model-hit" }, "缓存命中"),
									element("span", { className: "ust-model-sub" }, "总量"),
									element("span", { className: "ust-model-rate" }, "命中率"),
									element("span", { className: "ust-model-val" }, "占比"))),
							element("ul", { className: "ust-models" },
							pageRows.map((s) => element("li", {
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
									// 命中率沿用全局口径（缓存命中 / 当期满量）
									element("span", { className: "ust-model-in" }, fmtLarge(s.input)),
									element("span", { className: "ust-model-out" }, fmtLarge(s.output)),
									element("span", { className: "ust-model-hit" }, fmtLarge(s.cacheRead)),
									element("span", { className: "ust-model-sub" }, fmtLarge(s.total)),
									element("span", { className: "ust-model-rate" }, fmtPct(hitRateOf(s))),
									element("span", { className: "ust-model-val" }, (sum > 0 ? Math.round((s.total / sum) * 100) : 0) + "%")),
						)),
							segs.length > PAGE_SIZE ? element(Pager, { page: safePage, pageCount, total: segs.length, unit: "模型", onChange: setPage }) : null,
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
			// 自定义区间倒序校验：页面外壳与主视图都要用，提前算
			const invalid = !!(from && to && from > to);

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

			// 首帧先把页面外壳画出来，再发起首次请求。
			// 服务端冷启动需要全量扫描会话，若在挂载时同步等待，用户看到的就是「进来即卡住」。
			// 两拍策略：第一拍 load(false) 秒回（命中缓存立即渲染），
			// 第二拍 load(true) 强制重扫拿最新数据——打开页面即刷新，不等自动刷新档。
			// 第二拍在第一拍落定后才发：请求不并发叠罗汉，UI 也不会因两次 setState 闪烁。
			react.useEffect(() => {
				let cancelled = false;
				const run = async () => {
					if (cancelled) return;
					await load(false);
					if (cancelled) return;
					await load(true);
				};
				const id = typeof requestAnimationFrame === "function" ? requestAnimationFrame(run) : setTimeout(run, 0);
				return () => {
					cancelled = true;
					if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id); else clearTimeout(id);
				};
			}, [load]);

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
			// 模型配色序号：窗口内按用量降序编号，表格色点 / 柱状图 / 圆环共用，保证同模型同色。
			// 必须放在加载态早退之前——hooks 数量在两次渲染间必须一致。
			const ranks = react.useMemo(() => modelRanksIn(days, wnd), [days, wnd]);

			// 日期栏外壳：加载态与主视图共用，保证「先进页面、再出数据」
			const headerEl = 				element("div", { className: "ust-header" },
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
								className: "ust-tab ust-tab--custom" + (range.id === "custom" ? " active" : ""),
								title: range.id === "custom" && range.from && range.to ? "当前区间：" + range.from + " 至 " + range.to : "选择起止日期",
								onClick: () => setShowCustom((v) => !v),
							},
								// 选中自定义后，tab 上直接带出所选区间，一眼可见当前范围
								range.id === "custom" && range.from && range.to
									? ("自定义 " + range.from.slice(5).replace("-", "/") + "~" + range.to.slice(5).replace("-", "/"))
									: "自定义",
							),
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
				);

			if (loading && !data) {
				// 加载态也把页面骨架（标题 + 日期栏）先画出来：
				// 首次进入时服务端可能正在全量扫描，用户至少能立刻看到界面而不是空白
				return element("div", { className: "ust-root" },
					headerEl,
					element("div", { className: "ust-metrics" },
						[0, 1, 2, 3].map((i) => element("div", { key: i, className: "ust-metric" },
							element("div", { className: "ust-skeleton", style: { width: "42%", height: 11 } }),
							element("div", { className: "ust-skeleton", style: { width: "64%", height: 25, marginTop: 6 } }),
						)),
					),
					element("div", { className: "ust-skeleton", style: { width: "100%", height: 96 } }),
					element("div", { className: "ust-placeholder" }, "正在读取本机会话记录…"),
				);
			}
			if (error && !data) {
				return element("div", { className: "ust-root" },
					headerEl,
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
			// 活动洞察与三榜 TOP5 跟随日期区间：窗口内逐天合并；「全部」退回全历史口径
			const winInsights = insightsIn(days, wnd, data.insights);

			return element("div", { className: "ust-root" },
				element(SummaryMetrics, { summary: data.summary }),
				hasData ? element(Heatmap, { days, window: wnd }) : null,
				headerEl,
				element("div", { className: "ust-metrics" },
					singleDayWindow ? null : element(Metric, { icon: element(IconCalendar), label: "活跃天数", value: String(stats.activeDays) + " 天", sub: "有用量的天" }),
					singleDayWindow ? null : element(Metric, { icon: element(IconTrend), label: "日均", value: fmtLarge(avgPerActive), sub: "按活跃天平均" }),
					// 第二行统一为 TOKENS 文本（不带数字）：全量数值已在 tooltip/表格里，卡面保持干净
					element(Metric, { icon: element(IconToken), label: "窗口 Token", value: fmtLarge(stats.total), sub: "TOKENS" }),
					element(Metric, { icon: element(IconToken), label: "缓存命中", value: fmtLarge(winStats.cacheRead), sub: "TOKENS" }),
					element(Metric, { icon: element(IconTrend), label: "命中率", value: fmtPct(winStats.rate), sub: "缓存命中 / 当期满量" }),
					element(Metric, { icon: element(IconBolt), label: "最常用模型", value: topName, sub: topSub, text: true }),
					// 会话 / 消息计数卡放行末：Token 类指标优先展示
					element(Metric, { icon: element(IconChat), label: "窗口会话", value: String(winStats.sessions), sub: winScoped } ),
					element(Metric, {
						icon: element(IconMail), label: "窗口消息", value: fmtFull(winStats.messages),
						sub: winStats.sessions > 1
							? "均 " + fmtFull(Math.round((winStats.messages || 0) / winStats.sessions)) + " 条 / 会话"
							: "按 assistant 消息计",
					}),
				),
				// 概览数据之后：活动洞察（默认收起；随日期区间筛选）
				element(Insights, { insights: winInsights, sessionCount: data.sessionCount, messageCount: data.messageCount }),
				wnd.dateKeys.length === 0 ? element("div", { className: "ust-warn" }, "当前时间范围没有数据") : null,
				data.warnings && data.warnings.length > 0 ? element("div", { className: "ust-warn" }, data.warnings.join("；")) : null,
				hasData && wnd.dateKeys.length > 0 ? element(Trend, { days, window: wnd }) : null,
				hasData && wnd.dateKeys.length > 0 ? element(Donut, { days, window: wnd }) : null,
			element(ProvidersView, { days: days, window: wnd, ranks: ranks }),
			element(SessionsView, { days: days, window: wnd, meta: data.sessions, ranks: ranks }),
				// 会话统计下方：插件 / MCP / Skill 三榜 TOP5（随日期区间筛选）
				element(TopBoards, { insights: winInsights }),
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
