/**
 * 首页票面（bill sheet）布局配置。
 *
 * 全部 15 个可交互区块的几何、文案、目标链接都集中在这里，
 * 后续接后台编辑器时，只需把这份默认值与 `home_bill_zones_json` 合并。
 *
 * 坐标系：百分比（0–100），原点为票面左上角。
 * 票面比例固定 156 : 66.3 ≈ 2.353（美元纸币实际尺寸 156 × 66.3 mm）。
 */

export type BillZoneKind =
	/** 中央肖像（放站点头像） */
	| "portrait"
	/** 面额数字 */
	| "denomination"
	/** 花体横排铭文（UNITED STATES 那一类） */
	| "rule"
	/** 序列号（等宽） */
	| "serial"
	/** 印章（原创圆章） */
	| "seal"
	/** 签名区 */
	| "signature"
	/** 光变油墨标记（墨水瓶/钟），本项用作主题切换按钮 */
	| "marker"
	/** 竖排法定货币铭文 */
	| "legal";

/**
 * 区块组件图：给了就用图片渲染，忽略文本解算。
 *
 * 这是整套票面换图方案的回滚开关——删掉 `art` 字段即回退到
 * 原来的文字/图形渲染，不需要改任何渲染代码。
 */
export interface BillZoneArt {
	/** 站内绝对路径，必须以 /bill/ 开头（归一化时按白名单校验） */
	src: string;
	/** 填充方式，默认 contain；签名这类带大量透明留白的用 cover */
	fit?: "contain" | "cover" | "fill";
	/** 与纸面的混合方式，默认 multiply：凹版印刷是墨压纸 */
	blend?: "normal" | "multiply";
	/** 0–1，默认 1 */
	opacity?: number;
	/** object-position，默认 "center"；如 "center top" 用于只保留图上缘 */
	align?: string;
}

export interface BillZone {
	id: string;
	kind: BillZoneKind;
	/** 无障碍名称；link 区块必须有 */
	ariaLabel: string;
	/** 显示文案；数字类留空则由数据填充 */
	label: string;
	/** 目标链接；为空表示不可点（渲染成 span） */
	href: string;
	/** 百分比几何 */
	x: number;
	y: number;
	w: number;
	h: number;
	/** 关掉后不渲染，且不参与 tab 顺序 */
	enabled: boolean;
	/** 递减字号层级，用于同一 kind 的视觉差异（1 最大） */
	tier?: 1 | 2 | 3;
	/** 组件图；存在时优先于文本解算渲染 */
	art?: BillZoneArt;
	/**
	 * 叠压层序：数字越大越靠上。不填 = 走 `.bill__zone` 的默认层（3，文字层）。
	 * 真钞是凹版多版套印，图像之间互相遮挡：羽毛笔是底纹级（1），
	 * 肖像（5）印在它上面，大 100（6）/ 墨水瓶（7）/ 铜色大 100（8）再逐层压上。
	 */
	z?: number;
}

export interface BillSheetConfig {
	aspectRatio: number;
	paperColor: string;
	/**
	 * 纸纹强度 0–100。票面是首页唯一保留纸质纹理的区域，
	 * 0 = 光滑纸面，100 = 明显的纤维噪点。
	 */
	paperGrain: number;
	inkColor: string;
	frameWeight: number;
	guillocheDensity: number;
	cornerOrnament: boolean;
	microText: string;
	portraitShape: "oval" | "plain";
	/**
	 * 整票边框图（站内 /bill/ 路径，空串表示不用）。
	 * 存在时铺满票面最底层，并取代参数化纹样（guilloche/角花/卷草）；
	 * 清空后参数化纹样自动恢复（cornerOrnament 为降级开关）。
	 */
	frameArt?: string;
}

/**
 * 各区块铭文的**大写字高**（cap height，单位：毫米，票面实物 156 × 66.3 mm）。
 *
 * 注意：这里存的是「字形墨迹的实际高度」，不是 CSS 的 font-size。
 * 两者关系见 BILL_CAP_RATIO。当初把字高直接当字号填进 font-size，
 * 结果每个铭文都小了约 30%，层级比例全错——这是本次修正的根因。
 *
 * 数据来源：`py scripts/measure-bill-reference.py` 对
 * `.reference/bill/reference-landscape.png`（1560×663 @ 10 px/mm）的逐像素测量。
 * 该方法用「列墨量剖面 + 墨量加权分位数」把铭文从雕版底纹里分离出来，
 * 单行铭文误差约 ±0.15 mm，多行铭文按行数折算。
 */
export const BILL_TEXT_MM: Record<string, number> = {
	// 大数字（原票右侧巨号）—— 全票最大的字，实测 19.2 mm
	Z2: 19.2,
	// 四角面额 100，四个角实测 5.1–6.7，取同一设计值
	Z5: 5.9,
	Z6: 5.9,
	Z7: 5.9,
	Z8: 5.9,
	// 序列号（等宽数字串）实测 3.6 mm
	Z3: 3.6,
	Z15: 3.6,
	// 顶部 ONE HUNDRED DOLLARS 实测 3.2 mm
	Z10: 3.2,
	// FEDERAL RESERVE NOTE 实测 3.0 mm
	Z4: 3.0,
	// 两处签名是手写体：墨迹带 3.9 / 3.0 mm 含上下伸出部，大写高约取 54%
	Z11: 2.1,
	Z12: 1.7,
	// 法定货币铭文两行，墨迹带合计 2.4 mm → 每行大写高约 0.9 mm
	Z16: 0.9,
	// 联邦储备区号（字母+数字，单行）实测墨迹带 4.6 mm
	Z17: 4.6,
	// JULY 4, 1776 单行小号铭文，按行宽 20.7 mm ÷ 12 字反解出大写高 3.0 mm
	// （之前按 2.4 算，但 Cormorant 的字母间距比预想窄，抬高后行宽才对上）
	Z18: 3.0,
	// 像主名 FRANKLIN，按行宽 15.0 mm ÷ 8 字反解出大写高 2.5 mm
	Z21: 2.5,
	// 报头铭文 THE UNITED STATES / OF AMERICA：实测两行墨迹带合计 8.0 mm，
	// 单行大写高 3.0 mm（与旧硬编码 masthead 的 2.97 mm 一致）
	Z23: 3.0,
};

/**
 * serif 字体的「大写字高 ÷ em 方框」经验值。
 *
 * font-size 描述的是 em 方框，大写字高只占其中的一部分；
 * 直接把 3.1 mm 写进 font-size，画出来的大写实际只有 3.1 × 0.7 ≈ 2.2 mm。
 * 所以字号一律由字高反算：font-size = capHeight / BILL_CAP_RATIO。
 */
export const BILL_CAP_RATIO = 0.7;

/**
 * 各类铭文的排印度量。字号不是"看上去合适"，而是由这三个数算出来的：
 *
 *   - advance：单字符平均占位（以 em 计），用来估算整行宽度
 *   - tracking：字距（em），和 CSS 的 letter-spacing 必须是同一个数
 *   - lineHeight：行高倍数，用来把行盒装进区块高度
 *
 * 只有让模板和 CSS 共用这份数据，字高、字距、行高才不会互相打架。
 */
export interface BillTypeMetric {
	advance: number;
	tracking: number;
	lineHeight: number;
}

export const BILL_TYPE_METRICS: Record<BillZoneKind, BillTypeMetric> = {
	/** 数字：Lora 700 实测 0.569 em/字（等宽数字），字距微收。
	 *  lineHeight 取 0.72 而不是 1：数字没有升部/降部，行盒收紧到字高，
	 *  否则 27.4 mm 的 em 方框会把上下邻区顶开。 */
	denomination: { advance: 0.6, tracking: -0.01, lineHeight: 0.72 },
	/** 序列号：SF Mono / JetBrains Mono 实测 0.586 em/字 */
	serial: { advance: 0.586, tracking: 0.1, lineHeight: 1.1 },
	/** 花体大写铭文：**Playfair Display 700**（凹版雕刻字形的近似）。
	 *  真钐的 FEDERAL RESERVE NOTE 是 39.8 mm / 20 字 ÷ 4.29 mm 字号 = 0.464 em/字，
	 *  比 Playfair 的自然字宽窄，所以要靠 --inscsx 做横向压缩。
	 *  2026-10-29 从 Cormorant 0.624 改为 Playfair；Cormorant 属伽拉蒙体系，
	 *  对比度只有 2:1，怎么调阴影都不像雕刻字。 */
	// Playfair Display 700 正体，浏览器实测（font-size 100px、无字距）：
	// FRN 0.618 / ONE HUNDRED DOLLARS 0.652 / THE UNITED STATES OF AMERICA 0.590。
	// 取**最宽**的那个而不是平均值：解算器用 advance 估算自然行宽，
	// 估小了 scaleX 会被夹到 1，文字就会真的溢出盒子；估大只是多压一点，永远不会溢出。
	rule: { advance: 0.652, tracking: 0, lineHeight: 1.15 },
	/** 签名体：Cormorant Garamond 斜体实测 0.359 em/字 */
	signature: { advance: 0.359, tracking: 0.02, lineHeight: 1.15 },
	/** 竖排法定铭文（目前未使用，保留口径） */
	legal: { advance: 0.46, tracking: 0.06, lineHeight: 1.1 },
	portrait: { advance: 0.583, tracking: 0, lineHeight: 1 },
	seal: { advance: 0.583, tracking: 0, lineHeight: 1 },
	marker: { advance: 0.583, tracking: 0, lineHeight: 1 },
};

/**
 * 逐条铭文的字距（em）。
 *
 * 真钞每行铭文的字距并**不一致**，这不是审美选择，是从实测行宽反推的：
 *   - ONE HUNDRED DOLLARS：57.4 mm / 19 字 ÷ 4.57 mm = 0.661 em/字
 *     Cormorant 本身 0.524，所以要拉开 0.13 的字距
 *   - FEDERAL RESERVE NOTE：39.8 mm / 20 字 ÷ 4.29 mm = 0.464 em/字
 *     比 Cormorant 窄，所以字距保持 0，由横向压缩补足
 * 没列出的区块走 BILL_TYPE_METRICS 里按 kind 的默认值。
 */
export const BILL_ZONE_TRACKING: Record<string, number> = {
	// ONE HUNDRED DOLLARS：实测行宽 57.4 mm ÷ 19 字 ÷ 4.571 mm 字号 = 0.661 em/字；
	// 正体实测本体 0.622，所以字距 0.04
	Z10: 0.04,
	// 报头铭文：旧硬编码 masthead 用 0.09 em 才对上实测行宽 47.9 mm，沿用
	Z23: 0.09,
	// 序列号 CB000006B（字母与数字之间无空格）：默认 0.10 em 太松，
	// 站长要求收紧字距，收到 0.045 em
	Z3: 0.045,
	Z15: 0.045,
	// 四角面额：实测 19 mm 宽 / 3 位数字 ÷ 8.41 mm 字号 = 0.751 em/位，
	// Lora 700 数字实测本体 0.650，所以要拉开 0.10 的字距
	Z5: 0.1,
	Z6: 0.1,
	Z7: 0.1,
	Z8: 0.1,
};

/**
 * 逐条铭文的单字字宽（em，已含字体本身的字面，不含字距）。
 *
 * 解算器拿这个值估算自然行宽、再算出横向压缩比。同一个 kind 下不同字符串的
 * 平均字宽能差很远，用同一个基准就会估歪——估小会把 scaleX 夹到 1 不压，
 * 文字真的溢出；估大则会过度压缩：
 *
 *   ONE HUNDRED DOLLARS（19 字）0.622   ← 全是宽大写
 *   JULY 4, 1776（12 字）     0.413   ← 含空格、逗号与窄数字
 *
 * `JULY 4, 1776` 就是被估大的那个：按 0.624 算，压缩比会被算成 0.71，
 * 行宽只剩 15.0 mm，而实测是 20.7 mm。所以这里对字宽异常的区块单独标定。
 */
export const BILL_ZONE_ADVANCE: Record<string, number> = {
	// 浏览器实测：12 字 / 3.0 mm 字高 → 行宽 17.0 mm
	Z18: 0.413,
};

/**
 * 逐条铭文的行高倍数（覆盖 BILL_TYPE_METRICS 的默认值）。
 *
 * 行高是「区块高度 → 字号」的分母：行数越多，公式 depth / (rows × lineHeight)
 * 算出的字号越小。报头铭文要在一段固定高度里装下三行，只能把行距收到
 * 接近字身高度——真钐那三行本来也是紧贴的，行距收小反而更像雕版。
 */
export const BILL_ZONE_LINE_HEIGHT: Record<string, number> = {
	// THE / UNITED STATES / OF AMERICA 三行：字体全是大写、没有下伸部，
	// 行距收到 1.0 后行盒刚好等于字身，三行之间仍留 0.3 em 的空隙。
	Z23: 1,
};

/**
 * 横向压缩的强度下限。
 *
 * 真钞的长铭文（FEDERAL RESERVE NOTE / ONE HUNDRED DOLLARS）用的是窄体字，
 * 同等字高下比 Lora 窄 30% 以上。要同时满足「字高与真钞一致」和「行宽与真钞一致」，
 * 只能像凹版印刷那样做横向压缩；压到 0.6 倍以下就不像印刷、像变形，于是改为退字号。
 */
export const BILL_MIN_SCALE_X = 0.6;

/** 票面实物尺寸（毫米）：美元纸币 156 × 66.3 mm。 */
export const NOTE_MM = { width: 156, height: 66.3 } as const;

export const DEFAULT_BILL_SHEET_CONFIG: BillSheetConfig = {
	aspectRatio: 156 / 66.3,
	paperColor: "#f2efe3",
	paperGrain: 38,
	inkColor: "#0047ab",
	frameWeight: 1,
	guillocheDensity: 3,
	cornerOrnament: true,
	microText: "KIWI · 一百 · ONE HUNDRED · 云端记录 · ",
	// 2026-10-29：肖像不再做椭圆遮罩，原图直接铺进区块（站长要求）
	portraitShape: "plain",
	// 整票边框图（边框.png → public/bill/frame.webp）：四角 100 已画死在图里，
	// 因此 Z5–Z8 关闭。清空本字段即回退到参数化纹样（guilloche/角花/卷草）。
	frameArt: "/bill/frame.webp",
};

/**
 * 15 个可交互区块。几何全部取自参考票面（1587×676，约 10.2 px/mm）实测的毫米矩形。
 * 参考图存放在 .reference/bill（已 gitignore，且不在 public 下，不会随站点发布）。
 *
 * 每个区块上方的注释就是真钞上的 x, y, 宽, 高（单位 mm）；
 * 下面四个百分比由它换算：mm / 156 或 mm / 66.3，再 × 100。
 * 改票面比例只需要改注释里的毫米值，百分比跟着重算即可。 *
 * ── 叠压层次（`z` 字段 = CSS z-index）─────────────────────────────
 *   0  整票边框图 .bill__frame-art（在 BillSheet.astro 里固定为 0，不属区块）
 *   1  Z22 羽毛笔（底纹级，被旁边所有主体压住）
 *   3  默认文字层（不写 z 的铭文、序列号、签名…）
 *   4  Z9 美联储徽记
 *   5  Z1 肖像（要压在边框图与徽记之上）
 *   6  Z2 大 100 / Z21 像主名 FRANKLIN（印在肖像衣饰之上）
 *   7  Z14 变色墨水瓶
 *   8  Z8 铜色大 100（铜箔，最上层）
 * 保证关系由 tests/unit/bill-art.test.ts 的「叠压层次」用例锁定：
 * 边框图 < 羽毛笔 < 徽记 < 肖像 < 像主名。 */
export const DEFAULT_BILL_ZONES: BillZone[] = [
	// ── 四角小面额（真钞边框内的角落 100）────────────────────────────
	// 2026-10-29 起关闭：四角 100 已由整票边框图（frame.webp）画死，
	// 不再保留透明热区；原入口由头部导航与浮动菜单承担。
	{
		id: "Z5",
		kind: "denomination",
		ariaLabel: "返回首页",
		label: "",
		href: "/",
		// 墨迹实测 5.5–24.4 / 2.9–8.4 mm → 区块 5.5, 2.9, 18.9, 5.5
		x: 3.526,
		y: 4.374,
		w: 12.115,
		h: 8.296,
		enabled: false,
		tier: 3,
	},
	{
		id: "Z6",
		kind: "denomination",
		ariaLabel: "读书笔记",
		label: "",
		href: "/blog?category=reading",
		// 墨迹实测 128.5–147.7 / 3.7–9.3 mm → 区块 128.5, 3.7, 19.2, 5.6
		x: 82.372,
		y: 5.581,
		w: 12.308,
		h: 8.446,
		enabled: false,
		tier: 3,
	},
	{
		// 原「右下角 100」在参考票面上并不存在：该位置就是铜色大号 100
		// （实测 119.8–142.0 / 53.0–60.0 mm）。Z8 改为承载这枚大 100。
		// 2026-10-29：改为**可交互**区块（原为装饰 span），入口复用已关闭的
		// Z7「订阅 RSS」（同为面额 100 的位置语义，RSS 在页面上没有第二个入口）。
		id: "Z8",
		kind: "denomination",
		ariaLabel: "订阅 RSS",
		label: "",
		href: "/rss.xml",
		// 尺寸改用 big-100.webp 的原始像素（340×93 px），按票面 2× 基准 15.18 px/mm：
		// 22.4 × 6.1 mm（原盒 22.2 × 7.0 与图比例 3.656 不符，contain 会上下留白）
		// 整体向右移 1.5 mm（119.8 → 121.3 mm），垂直中心保持 56.5 mm
		x: 77.756,
		y: 80.599,
		w: 14.358,
		h: 9.24,
		enabled: true,
		tier: 3,
		// 铜色大 100（doubao_image_4.png），铜箔压在最上层
		art: { src: "/bill/big-100.webp" },
		z: 8,
	},

	// ── 左上铭文与序列号 ────────────────────────────────────────────
	{
		id: "Z4",
		kind: "rule",
		ariaLabel: "浏览全部分类",
		label: "云端记录",
		href: "/blog",
		// 墨迹 7.2–47.0 / 9.8–12.8 mm → 区块 6.2, 8.6, 41.8, 6.0
		// 2026-10-29：左缘对齐 H8 的文字左缘（3.49 mm）。文字在盒内居中，
		// 盒子需左移到 2.39 mm（= 3.49 − 盒子左右各 1.1 mm 的留白）；宽度不变。
		// （换 Playfair 后字宽从 38.76 → 39.59 mm，这里按新宽度重算过）
		x: 1.532,
		y: 12.97,
		w: 26.79,
		h: 9.05,
		enabled: true,
		tier: 3,
	},
	{
		id: "Z3",
		kind: "serial",
		ariaLabel: "返回首页",
		label: "",
		href: "/",
		// 墨迹 7.1–41.4 / 15.4–19.0 mm → 区块 6.1, 14.2, 36.3, 6.0
		// 2026-10-29：左缘对齐 H8 的文字左缘（3.49 mm）。文字在盒内居中、偏移 3.55 mm，
		// 故盒子左移到 -0.06 mm（= 3.49 − 3.55）；宽度不变
		x: -0.04,
		y: 21.42,
		w: 23.27,
		h: 9.05,
		enabled: true,
	},

	// ── 左侧印章（美联储徽记）───────────────────────────────────────
	{
		id: "Z9",
		kind: "seal",
		ariaLabel: "进入文章归档",
		label: "",
		href: "/blog",
		// 徽记 17.6–38.0 / 24.2–41.6 mm → 区块 17.0, 23.4, 21.0, 18.6
		// 2026-10-29：等比缩到 95%（21.0×18.6 → 20.0×17.7 mm），中心 (17.63, 49.32)% 不动
		x: 11.237,
		y: 35.991,
		w: 12.787,
		h: 26.648,
		enabled: true,
		// 美联储徽记（doubao_image_6.png）
		art: { src: "/bill/seal.webp" },
		z: 4,
	},

	// ── 羽毛笔（纯装饰，压在金色安全线带上）────────────────────────
	// 层级：区块按数组顺序渲染、后渲染压在上面。羽毛笔在真钞上是**底纹级**元素，
	{
		id: "Z22",
		kind: "rule",
		ariaLabel: "看看说说",
		label: "",
		// 2026-10-29：羽毛笔改为**可交互独立区块**（原先只渲染成装饰 span）
		href: "/shuoshuo",
		// 整根羽毛：quill.webp 原始像素尺寸（568×494 px）再放大 1.4 倍，
		// 按票面 2× 基准 15.18 px/mm：37.4×32.5 → 52.4×45.6 mm，盒子比例 1.150 不变
		// 高度方向再下移 4 mm，羽尖不顶到上边框；水平仍以原中心 103.8 mm 居中
		x: 49.744,
		y: 13.756,
		w: 33.583,
		h: 68.72,
		enabled: true,
		// 铜版羽毛笔（doubao_image_7.png），底纹级 → 大 100 与徽记压在它上面
		art: { src: "/bill/quill.webp" },
		z: 1,
	},

	// ── 中央肖像（富兰克林铜版肖像）─────────────────────────────────
	{
		id: "Z1",
		kind: "portrait",
		ariaLabel: "打开站点入口",
		label: "",
		href: "/api/auth/login",
		// 尺寸依据 .reference/bill/measured-overlay.png（1560×663 px，10 px/mm）上量得的
		// 肖像框：x 34.0–80.0 mm、y 4.0–62.0 mm。
		// 采用「按参考框高铺满」：高 = 参考框高，宽 = 高 × (760/659) —— 头部尺寸与真钐一致。
		// 2026-10-29：整体放大 1.05 倍并下移（上缘保持 4 mm，下缘 62 → 64.8 mm），
		// 底边距票面底边还留 1.5 mm，不越界；宽 70.2 mm，水平仍以 57 mm 居中。
		x: 14.026,
		y: 5.882,
		w: 45.026,
		h: 91.855,
		enabled: true,
		// 富兰克林铜版肖像（头像.png 全画布直出，不裁边/不遮罩），
		// contain + 底部对齐：整幅图完整显示，人像下缘与票面底边齐平
		art: { src: "/bill/portrait.webp", fit: "contain", align: "center bottom" },
		// 肖像压在羽毛笔之上（真钞是肖像版先印、羽毛属底纹）
		z: 5,
	},

	// ── 右侧大面额（真钞：带钟形光变标记的大 100）─────────────────
	{
		id: "Z2",
		kind: "denomination",
		ariaLabel: "查看文章归档",
		label: "",
		href: "/blog",
		// 巨号墨迹 112.6–130.0 / 23.9–39.8 mm（含首尾横笔）→ 区块 110.0, 23.2, 24.0, 19.0
		// 右缘从 136.0 收到 134.0（原值多出 6 mm 全压在空白格上）
		x: 70.513,
		y: 34.993,
		w: 15.385,
		h: 28.657,
		enabled: true,
		tier: 1,
		// 大 100 + 财政部徽记（doubao_image_5.png）。
		// 2026-10-29 起放弃动态文章数；文章总数仍由序列号 CB 000006 B 表达
		art: { src: "/bill/denom-100.webp" },
		z: 6,
	},
	{
		id: "Z14",
		kind: "marker",
		ariaLabel: "切换主题",
		label: "",
		href: "",
		// 墨水瓶实测 90.3–106.5 / 43.9–58.7 mm（瓶颈唇沿比瓶身宽，旧值只量到瓶身）
		// → 区块 90.3, 43.9, 16.2, 14.8
		x: 57.885,
		y: 66.214,
		w: 10.385,
		h: 22.323,
		enabled: true,
		// 铜色墨水瓶剪影（Layer 5.png → public/bill/inkwell.webp）
		art: { src: "/bill/inkwell.webp" },
		z: 7,
	},
	{
		id: "Z15",
		kind: "serial",
		ariaLabel: "申请友链",
		label: "",
		href: "/friends/apply",
		// 墨迹 105.0–145.6 / 45.0–49.8 mm → 区块 104.0, 44.0, 42.6, 6.8
		x: 66.67,
		y: 66.37,
		w: 27.31,
		h: 10.26,
		enabled: true,
	},

	// ── 左侧竖排法定货币铭文（印章正下方）─────────────────────────
	{
		id: "Z16",
		kind: "rule",
		ariaLabel: "友情链接",
		label: "",
		href: "/friends",
		// 铭文 88.6–117.2 / 19.4–21.8 mm（两行）→ 区块 87.6, 17.8, 30.6, 5.2
		x: 56.15,
		y: 26.85,
		w: 19.62,
		h: 7.84,
		enabled: true,
	},

	// ── 底部：两处签名 + 大 100 + 铭文带 ───────────────────────────
	{
		id: "Z11",
		kind: "signature",
		ariaLabel: "全部文章",
		label: "Kiwi",
		href: "/blog",
		// 签名墨迹 7.3–27.9 / 42.3–46.2 mm → 区块 6.3, 42.3, 22.6, 6.4
		// 站长要求整体左下移（x −0.8% / y +1.7%）
		x: 3.24,
		y: 65.5,
		w: 14.49,
		h: 9.65,
		enabled: true,
		// 财政部长签名 + 职衔（doubao_image_1.png 上半）
		art: { src: "/bill/signature-1.webp" },
	},
	{
		id: "Z12",
		kind: "signature",
		ariaLabel: "阅读最新一篇",
		label: "最新",
		href: "",
		// 签名墨迹 6.7–32.0 / 49.3–52.3 mm → 区块 6.3, 48.8, 24.0, 6.4
		// 站长要求整体左下移（x −0.8% / y +1.7%）
		x: 3.24,
		y: 75.3,
		w: 15.38,
		h: 9.65,
		enabled: true,
		// 司库签名 + 职衔（doubao_image_1.png 下半）
		art: { src: "/bill/signature-2.webp" },
	},
	{
		id: "Z7",
		kind: "denomination",
		ariaLabel: "订阅 RSS",
		label: "",
		href: "/rss.xml",
		// 墨迹实测 6.4–25.0 / 56.6–62.2 mm → 区块 6.4, 56.6, 18.6, 5.6
		x: 4.103,
		y: 85.37,
		w: 11.923,
		h: 8.446,
		enabled: false,
		tier: 2,
	},
	{
		id: "Z10",
		kind: "rule",
		ariaLabel: "站内搜索",
		label: "站内搜索",
		href: "/search",
		// 墨迹 68.5–125.9 / 2.2–7.3 mm → 区块 67.5, 1.2, 59.4, 7.3
		x: 43.27,
		y: 1.81,
		w: 38.08,
		h: 11.01,
		enabled: true,
		tier: 2,
	},

	// ── 报头铭文（THE UNITED STATES / OF AMERICA）──────────────────
	// 原先硬编码在 BillSheet.astro 的 .bill__masthead 里，2026-10-29 起独立成区块
	{
		id: "Z23",
		kind: "rule",
		ariaLabel: "浏览文章归档",
		label: "",
		// 2026-10-29：报头铭文改为**可交互独立区块**
		href: "/blog",
		// 2026-10-29：改为真钐的三行排法 THE / UNITED STATES / OF AMERICA（居中）。
		// 行数变多后字号由高度反算（font = h / (3 × 行高 1.0)），区块撑到
		// ONE HUNDRED DOLLARS（墨迹到 7.8 mm）与「友情链接」（盒顶 17.8 mm）之间：
		// 区块 77.0, 8.2, 48.9, 9.5 mm → 文字 8.2–17.7，font ≈ 3.17 mm（cap ≈ 2.22 mm）。
		// 三行再用 scaleX 横向压扁到 1.45 倍宽，行宽接近真钐的 47.9 mm。
		x: 49.359,
		y: 12.368,
		w: 31.346,
		h: 14.329,
		enabled: true,
		tier: 2,
	},

	// ── 补齐：实测到但之前漏掉没上票面的四处 ───────────────────────
	{
		id: "Z17",
		kind: "serial",
		ariaLabel: "工程实践",
		label: "",
		href: "/blog?category=engineering",
		// 区号墨迹 4.0–12.0 / 20.6–25.2 mm → 区块 3.0, 20.4, 10.0, 5.5
		x: 1.923,
		y: 30.769,
		w: 6.41,
		h: 8.296,
		enabled: true,
		tier: 3,
	},
	{
		id: "Z18",
		kind: "rule",
		ariaLabel: "教程",
		label: "",
		href: "/blog?category=tutorials",
		// 铭文 81.3–102.0 / 23.5–27.9 mm → 区块 80.3, 23.2, 22.7, 5.4
		x: 51.474,
		y: 34.993,
		w: 14.551,
		h: 8.145,
		enabled: true,
		tier: 3,
	},
	{
		id: "Z21",
		kind: "rule",
		ariaLabel: "生活随笔",
		label: "",
		href: "/blog?category=life",
		// 像主名 51.0–66.0 / 58.5–62.5 mm → 区块 50.0, 58.0, 17.0, 5.2
		// 2026-10-29：下移到底部花纹带上（y 58.7 → 61.0 mm，文字实际 61.5–65.7 mm），
		// 并改为浅灰白斜体（见 BillSheet 的 [data-bill-zone="Z21"] 规则），压在底纹上像凹印
		x: 32.051,
		y: 92.006,
		w: 10.897,
		h: 7.843,
		enabled: true,
		tier: 3,
		// 肖像盒已铺到 62 mm，会盖住像主名；真钐把 FRANKLIN 印在衣饰之上，
		// 所以这一层要高于肖像（z 5）
		z: 6,
	},
];
