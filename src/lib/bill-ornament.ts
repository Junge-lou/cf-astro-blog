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

/**
 * 四角花饰：一个扇形放射纹，由 CSS 复制到四个角并分别翻转。
 * 返回 SVG 片段（不含 `url()` 包装），交给 `background-image` 用。
 */
export function cornerRosette({
	size = 64,
	stroke = "#0047ab",
	opacity = 0.55,
}: { size?: number; stroke?: string; opacity?: number } = {}): string {
	const c = 0;
	const rings: string[] = [];
	for (let i = 1; i <= 5; i++) {
		const rad = (size / 5) * i;
		rings.push(
			`<circle cx="${c}" cy="${c}" r="${rad.toFixed(1)}" fill="none" stroke="${stroke}" ` +
				`stroke-width="${i === 5 ? 1.1 : 0.5}" opacity="${i % 2 ? 0.8 : 0.45}"/>`,
		);
	}
	// 放射线
	for (let i = 0; i < 16; i++) {
		const a = (i / 16) * Math.PI * 2;
		rings.push(
			`<line x1="0" y1="0" x2="${(Math.cos(a) * size).toFixed(1)}" ` +
				`y2="${(Math.sin(a) * size).toFixed(1)}" stroke="${stroke}" stroke-width="0.4" opacity="0.35"/>`,
		);
	}

	const svg =
		`<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" ` +
		`viewBox="0 0 ${size} ${size}"><g opacity="${opacity}">${rings.join("")}</g></svg>`;

	return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
