/**
 * 票面纹样生成器。
 *
 * ── 为什么是"生成"而不是"素材" ──────────────────────────────────────────
 * 美元纸币的肖像、联邦储备印章、票面原文版式都受美国财政部/特勤局复制限制。
 * 本项目因此**不使用任何钞票图像**：下面所有曲线都由参数方程在构建期算出，
 * 得到的是纯几何图形（内摆线 rosette），不含任何可识别的纸币元素。
 *
 * 内摆线（hypotrochoid）：一个动圆在定圆内滚动时，圆外/圆内一固定点的轨迹。
 *   x = (R − r)·cos t + d·cos((R − r)/r · t)
 *   y = (R − r)·sin t − d·sin((R − r)/r · t)
 * 钞票边框上的扭索纹（guilloché）就是它的印刷版本。
 */

/** 两个数的最大公约数，用来求曲线闭合所需的角度倍数。 */
function gcd(a: number, b: number): number {
	let x = Math.abs(a);
	let y = Math.abs(b);
	while (y) {
		[x, y] = [y, x % y];
	}
	return x || 1;
}

interface HypotrochoidOptions {
	/** 定圆半径 */
	R: number;
	/** 动圆半径 */
	r: number;
	/** 描点距动圆圆心的距离 */
	d: number;
	/** 中心 x */
	cx?: number;
	/** 中心 y */
	cy?: number;
	/** 整体缩放 */
	scale?: number;
	/** 采样点数 */
	steps?: number;
}

/** 生成一条闭合的内摆线 path。 */
export function hypotrochoidPath({
	R,
	r,
	d,
	cx = 0,
	cy = 0,
	scale = 1,
	steps = 720,
}: HypotrochoidOptions): string {
	// 转过 r/gcd(R,r) 圈后曲线回到起点，这样路径才是闭合的
	const turns = r / gcd(R, r);
	const total = Math.PI * 2 * turns;
	const ratio = (R - r) / r;
	const points: string[] = [];

	for (let i = 0; i <= steps; i++) {
		const t = (i / steps) * total;
		const x = (R - r) * Math.cos(t) + d * Math.cos(ratio * t);
		const y = (R - r) * Math.sin(t) - d * Math.sin(ratio * t);
		points.push(`${(cx + x * scale).toFixed(2)} ${(cy + y * scale).toFixed(2)}`);
	}

	return `M${points.join("L")}Z`;
}

export interface GuillocheOptions {
	/** 瓦片边长（px） */
	size?: number;
	/** 线色 */
	stroke?: string;
	/** 线宽 */
	width?: number;
	/** 整体不透明度 */
	opacity?: number;
	/** 密度 0–5：决定叠加几条曲线 */
	density?: number;
}

/**
 * 生成一块可平铺的扭索纹瓦片，返回可直接用于 `background-image` 的 data URI。
 *
 * 平铺是无缝的：所有曲线以瓦片中心为圆心，超出的部分被 viewBox 裁掉，
 * 相邻瓦片拼起来就是连续的 rosette 阵列。
 */
export function guillocheTile({
	size = 120,
	stroke = "#0047ab",
	width = 0.6,
	opacity = 0.45,
	density = 3,
}: GuillocheOptions = {}): string {
	const c = size / 2;
	const scale = size / 120;
	const curves = [
		hypotrochoidPath({ R: 46, r: 13, d: 26, cx: c, cy: c, scale }),
		hypotrochoidPath({ R: 46, r: 15, d: 21, cx: c, cy: c, scale }),
		hypotrochoidPath({ R: 52, r: 17, d: 30, cx: c, cy: c, scale }),
		hypotrochoidPath({ R: 38, r: 11, d: 22, cx: c, cy: c, scale }),
		hypotrochoidPath({ R: 44, r: 19, d: 18, cx: c, cy: c, scale }),
	].slice(0, Math.max(1, Math.min(5, density)));

	const paths = curves.map((d) => `<path d="${d}"/>`).join("");
	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
		`viewBox="0 0 ${size} ${size}">` +
		`<g fill="none" stroke="${stroke}" stroke-width="${width}" opacity="${opacity}">` +
		`${paths}</g></svg>`;

	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

/** 对数螺线的基本参数。卷草纹的每一片叶子都是它的一段。 */
interface SpiralOptions {
	cx: number;
	cy: number;
	/** 起始半径 */
	r0: number;
	/** 每弧度的增长率；负值向内收 */
	growth: number;
	/** 起始角（弧度） */
	start: number;
	/** 扫过的角度（弧度） */
	sweep: number;
	steps?: number;
}

/**
 * 生成一段对数螺线 path：r = r0 · e^(growth·t)。
 *
 * 钞票花边里的卷草（rinceau）从来不是圆，而是这种越卷越紧的螺线；
 * 用指数而不是线性收缩，才能得到"越往中心越密"的观感。
 */
function logSpiralPath({ cx, cy, r0, growth, start, sweep, steps = 44 }: SpiralOptions): string {
	const points: string[] = [];
	for (let i = 0; i <= steps; i++) {
		const k = i / steps;
		const t = k * sweep;
		const radius = r0 * Math.exp(growth * t);
		const angle = start + t;
		points.push(
			`${(cx + radius * Math.cos(angle)).toFixed(1)} ${(cy + radius * Math.sin(angle)).toFixed(1)}`,
		);
	}
	return `M${points.join("L")}`;
}

export interface CornerFlourishOptions {
	/** 正方形边长（px），同时决定输出精度 */
	size?: number;
	stroke?: string;
	/** 基准线宽 */
	width?: number;
	opacity?: number;
}

/**
 * 角花：占据正方形**左上角**的四分之一花饰。
 *
 * 一个角花由四层叠成，这是凹版花边的常用构造：
 *   ① 三道同心四分之一圆弧 —— 骨
 *   ② 从角点散开的渐长短射线 —— 填充
 *   ③ 两枚对数螺线 —— 卷草
 *   ④ 外弧上的珠点 —— 收边
 *
 * 只画左上象限，另外三角靠 CSS 的 scaleX / scaleY 翻转复用同一个纹样。
 */
export function cornerFlourish({
	size = 96,
	stroke = "#0047ab",
	width = 1.6,
	opacity = 0.7,
}: CornerFlourishOptions = {}): string {
	const s = size;
	const parts: string[] = [];

	const arc = (r: number, w: number, o: number) => {
		const v = (s * r).toFixed(1);
		parts.push(
			`<path d="M${v} 0A${v} ${v} 0 0 1 0 ${v}" fill="none" stroke="${stroke}" ` +
				`stroke-width="${w.toFixed(2)}" opacity="${o}"/>`,
		);
	};

	// ① 外框双线，角花的骨
	arc(0.97, width * 1.5, 0.9);
	arc(0.9, width * 0.7, 0.5);
	// ② 内圈留给卷草的轨道
	arc(0.66, width * 0.7, 0.4);

	// ③ 角点小花：三圈同心的四分之一圆
	arc(0.2, width * 0.8, 0.6);
	arc(0.145, width * 0.7, 0.45);
	arc(0.09, width * 0.7, 0.35);

	// ④ 两枚卷草，落在内外两圈之间；一枚正卷、一枚反卷
	for (const [cx, cy, r0, start, sweep, grow] of [
		[s * 0.46, s * 0.46, s * 0.19, Math.PI * 0.95, -Math.PI * 1.9, -0.22],
		[s * 0.78, s * 0.22, s * 0.13, Math.PI * 0.55, Math.PI * 1.9, -0.26],
	] as const) {
		parts.push(
			`<path d="${logSpiralPath({ cx, cy, r0, growth: grow, start, sweep })}" fill="none" ` +
				`stroke="${stroke}" stroke-width="${(width * 0.75).toFixed(2)}" opacity="0.62"/>`,
		);
	}

	// ⑤ 外弧珠点收边
	for (let i = 1; i < 11; i++) {
		const angle = (i / 11) * (Math.PI / 2);
		const r = s * 0.935;
		parts.push(
			`<circle cx="${(Math.cos(angle) * r).toFixed(1)}" cy="${(Math.sin(angle) * r).toFixed(1)}" ` +
				`r="${(width * 0.8).toFixed(2)}" fill="${stroke}" opacity="0.5"/>`,
		);
	}

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">` +
		`<g opacity="${opacity}">${parts.join("")}</g></svg>`;

	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export interface ScrollBandOptions {
	/** 一个重复周期的宽度（px），决定平铺节距 */
	period?: number;
	/** 条带高度（px） */
	height?: number;
	stroke?: string;
	width?: number;
	opacity?: number;
}

/**
 * 卷草纹横带：沿票面上下边缘连续铺开的花边。
 *
 * 无缝平铺靠的是**主茎取完整正弦周期**——x = 0 与 x = period 处高度、斜率都相同，
 * 相邻瓦片拼上就看不出来。卷草只挂在波峰/波谷（瓦片内部），不会跨过拼接缝。
 */
export function scrollBand({
	period = 220,
	height = 44,
	stroke = "#0047ab",
	width = 2.3,
	opacity = 0.62,
}: ScrollBandOptions = {}): string {
	const mid = height / 2;
	const amp = height * 0.2;
	const steps = 120;
	const parts: string[] = [];

	const sample = (fn: (k: number) => number): string => {
		const pts: string[] = [];
		for (let i = 0; i <= steps; i++) {
			const k = i / steps;
			pts.push(`${(k * period).toFixed(1)} ${fn(k).toFixed(1)}`);
		}
		return `M${pts.join("L")}`;
	};

	// 主茎：一个完整周期，首尾同相，保证横向无缝
	parts.push(
		`<path d="${sample((k) => mid + amp * Math.sin(k * Math.PI * 2))}" fill="none" ` +
			`stroke="${stroke}" stroke-width="${width.toFixed(2)}" opacity="0.85"/>`,
	);

	// 副茎：反相、幅度更小，形成一粗一细的节奏
	parts.push(
		`<path d="${sample((k) => mid - amp * 0.55 * Math.sin(k * Math.PI * 2))}" fill="none" ` +
			`stroke="${stroke}" stroke-width="${(width * 0.8).toFixed(2)}" opacity="0.45"/>`,
	);

	// 波峰、波谷各挂一枚卷草
	for (const dir of [1, -1] as const) {
		const cx = dir > 0 ? period * 0.25 : period * 0.75;
		const cy = mid + amp * dir;
		parts.push(
			`<path d="${logSpiralPath({
				cx,
				cy,
				r0: height * 0.16,
				growth: -0.24,
				start: dir > 0 ? Math.PI * 1.5 : Math.PI * 0.5,
				sweep: -Math.PI * 1.9,
			})}" fill="none" stroke="${stroke}" stroke-width="${(width * 0.9).toFixed(2)}" opacity="0.6"/>`,
		);
	}

	// 茎上的节
	for (let i = 0; i < 6; i++) {
		const k = i / 6;
		parts.push(
			`<circle cx="${(k * period).toFixed(1)}" cy="${(mid + amp * Math.sin(k * Math.PI * 2)).toFixed(1)}" ` +
				`r="${(width * 1.25).toFixed(2)}" fill="${stroke}" opacity="0.4"/>`,
		);
	}

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${period}" height="${height}" ` +
		`viewBox="0 0 ${period} ${height}"><g opacity="${opacity}">${parts.join("")}</g></svg>`;

	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}

export interface InkwellMarkOptions {
	/** 线条与瓶身颜色 */
	stroke?: string;
	/** 纸色：铃铛用纸色「挖」出来，模拟雕版留白 */
	paper?: string;
	/** 线条粗细（viewBox 单位） */
	width?: number;
	opacity?: number;
}

/**
 * 变色墨水瓶纹样（票面中右部那枚「墨水瓶 + 铃铛」标记）。
 *
 * 这个位置在真钞上是一枚随视角变色的墨水瓶，瓶身里嵌一只铃铛。
 * 之前这里画的是一个空心圆环，形状既不对、位置也偏了 2.5 mm。
 *
 * 轮廓是从参考票面逐行量出来的（票面 156 × 66.3 mm，10 px/mm）：
 *   x 90.3–104.4，y 43.9–57.9  →  14.1 × 14.0 mm
 * 截面结构：宽瓶盖（12.6 mm）→ 收窄瓶颈（10.6 mm）→ 外扩瓶身，底部最宽并带圆角。
 * 下面把这些比例折算到 100 × 100 的 viewBox 里。
 *
 * 与其它花边一致：只由几何图形拼出来，不引用任何纸币素材。
 */
export function inkwellMark({
	stroke = "#0047ab",
	paper = "#f2efe3",
	width = 1.7,
	opacity = 0.72,
}: InkwellMarkOptions = {}): string {
	const parts: string[] = [];

	// ① 瓶身轮廓：一条封闭路径走完「盖 → 颈 → 身 → 底」，不是几个图形叠出来
	//    （叠出来的版本在颈肩交界处会留下横线，看着像盖子压在盒子上）
	parts.push(
		`<path d="M5 6 Q5 0 14 0 L86 0 Q95 0 95 6 L95 14 Q95 20 88 21 L86 21 ` +
			`Q82 22 82 27 L82 30 Q82 34 86 36 L96 46 Q99 50 99 58 L99 79 ` +
			`Q99 98 78 98 L22 98 Q1 98 1 79 L1 58 Q1 50 4 46 L14 36 ` +
			`Q18 34 18 30 L18 27 Q18 22 14 21 L12 21 Q5 20 5 14 Z" ` +
			`fill="none" stroke="${stroke}" stroke-width="${width}" stroke-linejoin="round"/>`,
	);

	// ② 瓶内铃铛：纸色填充 + 细描边，读起来像凹版留白
	parts.push(
		`<path d="M50 42 C58 42 62 52 63 64 L66 80 Q67 86 58 86 L42 86 ` +
			`Q33 86 34 80 L37 64 C38 52 42 42 50 42 Z" ` +
			`fill="${paper}" stroke="${stroke}" stroke-width="${width * 0.8}" stroke-linejoin="round"/>`,
	);
	// ③ 铃舌
	parts.push(
		`<circle cx="50" cy="92" r="4" fill="${paper}" ` +
			`stroke="${stroke}" stroke-width="${width * 0.8}"/>`,
	);

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">` +
		`<g opacity="${opacity}">${parts.join("")}</g></svg>`;

	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
