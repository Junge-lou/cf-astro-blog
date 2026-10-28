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
	| "marker";

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
}

export interface BillSheetConfig {
	aspectRatio: number;
	paperColor: string;
	inkColor: string;
	frameWeight: number;
	guillocheDensity: number;
	cornerOrnament: boolean;
	microText: string;
	portraitShape: "oval" | "plain";
}

export const DEFAULT_BILL_SHEET_CONFIG: BillSheetConfig = {
	aspectRatio: 156 / 66.3,
	paperColor: "#f2efe3",
	inkColor: "#0047ab",
	frameWeight: 1,
	guillocheDensity: 3,
	cornerOrnament: true,
	microText: "KIWI · 一百 · ONE HUNDRED · 云端记录 · ",
	portraitShape: "oval",
};

/** 15 个可交互区块。几何按参考票面分区，可在后台整体重排。 */
export const DEFAULT_BILL_ZONES: BillZone[] = [
	{
		id: "Z1",
		kind: "portrait",
		ariaLabel: "打开站点入口",
		label: "",
		href: "/api/auth/login",
		x: 30,
		y: 3,
		w: 26,
		h: 88,
		enabled: true,
	},
	{
		id: "Z2",
		kind: "denomination",
		ariaLabel: "查看文章归档",
		label: "",
		href: "/blog",
		x: 63,
		y: 19,
		w: 21,
		h: 23,
		enabled: true,
		tier: 1,
	},
	{
		id: "Z3",
		kind: "serial",
		ariaLabel: "返回首页",
		label: "",
		href: "/",
		x: 8,
		y: 9,
		w: 21,
		h: 9,
		enabled: true,
	},
	{
		id: "Z4",
		kind: "rule",
		ariaLabel: "浏览全部分类",
		label: "云端记录",
		href: "/blog",
		x: 8,
		y: 3.5,
		w: 21,
		h: 4.5,
		enabled: true,
		tier: 3,
	},
	{
		id: "Z5",
		kind: "denomination",
		ariaLabel: "返回首页",
		label: "",
		href: "/",
		x: 1,
		y: 1,
		w: 7,
		h: 20,
		enabled: true,
		tier: 3,
	},
	{
		id: "Z6",
		kind: "denomination",
		ariaLabel: "未启用",
		label: "",
		href: "",
		x: 92,
		y: 1,
		w: 7,
		h: 20,
		enabled: false,
		tier: 3,
	},
	{
		id: "Z7",
		kind: "denomination",
		ariaLabel: "订阅 RSS",
		label: "",
		href: "/rss.xml",
		x: 1,
		y: 79,
		w: 7,
		h: 20,
		enabled: true,
		tier: 3,
	},
	{
		id: "Z8",
		kind: "denomination",
		ariaLabel: "看看说说",
		label: "",
		href: "/shuoshuo",
		x: 92,
		y: 79,
		w: 7,
		h: 20,
		enabled: true,
		tier: 3,
	},
	{
		id: "Z9",
		kind: "seal",
		ariaLabel: "进入文章归档",
		label: "",
		href: "/blog",
		x: 5.5,
		y: 33,
		w: 17,
		h: 34,
		enabled: true,
	},
	{
		id: "Z10",
		kind: "rule",
		ariaLabel: "站内搜索",
		label: "站内搜索",
		href: "/search",
		x: 31,
		y: 90,
		w: 40,
		h: 7.5,
		enabled: true,
		tier: 2,
	},
	{
		id: "Z11",
		kind: "signature",
		ariaLabel: "全部文章",
		label: "Kiwi",
		href: "/blog",
		x: 8,
		y: 73,
		w: 24,
		h: 12,
		enabled: true,
	},
	{
		id: "Z12",
		kind: "signature",
		ariaLabel: "阅读最新一篇",
		label: "最新",
		href: "",
		x: 45,
		y: 73,
		w: 18,
		h: 12,
		enabled: true,
	},
	{
		id: "Z13",
		kind: "denomination",
		ariaLabel: "置顶文章",
		label: "",
		href: "",
		x: 24,
		y: 81,
		w: 12,
		h: 14,
		enabled: true,
		tier: 2,
	},
	{
		id: "Z14",
		kind: "marker",
		ariaLabel: "切换主题",
		label: "",
		href: "",
		x: 77,
		y: 44,
		w: 13,
		h: 21,
		enabled: true,
	},
	{
		id: "Z15",
		kind: "serial",
		ariaLabel: "申请友链",
		label: "",
		href: "/friends/apply",
		x: 63,
		y: 66,
		w: 27,
		h: 9,
		enabled: true,
	},
];
