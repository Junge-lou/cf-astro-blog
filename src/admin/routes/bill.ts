import { Hono } from "hono";
import type { BillZone } from "@/lib/bill-config";
import {
	type BillSettings,
	DEFAULT_BILL_SETTINGS,
	getBillSettings,
	saveBillSettings,
} from "@/lib/bill-settings";
import { getDb } from "@/lib/db";
import {
	type AdminAppEnv,
	assertCsrfToken,
	getAuthenticatedSession,
	requireAuth,
} from "../middleware/auth";
import { renderBillPage } from "../views/bill";
import { adminLayout } from "../views/layout";

const bill = new Hono<AdminAppEnv>();

type BillFormValue = string | File | (string | File)[];
type BillFormBody = Record<string, BillFormValue>;

/** 表单里同名字段可能提交成数组（多值），统一取第一个字符串。 */
function field(body: BillFormBody, key: string): string {
	const value = body[key];
	if (Array.isArray(value)) {
		const first = value.find((item): item is string => typeof item === "string");
		return first?.trim() ?? "";
	}
	return typeof value === "string" ? value.trim() : "";
}

function parseStatus(url: string): "saved" | "invalid" | null {
	const status = new URL(url).searchParams.get("status");
	if (status === "saved" || status === "invalid") {
		return status;
	}
	return null;
}

bill.use("*", requireAuth);

bill.get("/", async (c) => {
	const session = getAuthenticatedSession(c);
	let settings: BillSettings = DEFAULT_BILL_SETTINGS;

	try {
		settings = await getBillSettings(getDb(c.env.DB));
	} catch {
		// D1 未绑定时回退默认票面，页面仍然可用
	}

	return c.html(
		adminLayout(
			"首页票面",
			renderBillPage({
				csrfToken: session.csrfToken,
				settings,
				status: parseStatus(c.req.url),
			}),
			{ csrfToken: session.csrfToken },
		),
	);
});

bill.post("/", async (c) => {
	const session = getAuthenticatedSession(c);
	const body = (await c.req.parseBody({ all: true })) as BillFormBody;

	if (!assertCsrfToken(field(body, "_csrf"), session)) {
		return c.text("CSRF 校验失败", 403);
	}

	let current: BillSettings = DEFAULT_BILL_SETTINGS;
	try {
		current = await getBillSettings(getDb(c.env.DB));
	} catch {
		// 读不到就用默认值作为底稿
	}

	const zones: BillZone[] = current.zones.map((zone) => {
		// 组件图：路径留空 = 删除 art（回退文本渲染）。
		// 展开 zone.art 保住 blend/opacity/align（表单只编辑 src 与 fit）。
		// 路径合法性由 normalizeBillSettingsInput 兜底（只认 /bill/ 前缀）。
		const artSrc = field(body, `artSrc_${zone.id}`);
		const artFit = field(body, `artFit_${zone.id}`);
		const fit = artFit === "cover" || artFit === "fill" ? artFit : "contain";
		return {
			...zone,
			enabled: field(body, `enabled_${zone.id}`) !== "0",
			x: Number(field(body, `x_${zone.id}`)),
			y: Number(field(body, `y_${zone.id}`)),
			w: Number(field(body, `w_${zone.id}`)),
			h: Number(field(body, `h_${zone.id}`)),
			label: field(body, `label_${zone.id}`),
			href: field(body, `href_${zone.id}`),
			art: artSrc ? { ...zone.art, src: artSrc, fit } : undefined,
		};
	});

	const textMm: Record<string, number> = { ...current.textMm };
	for (const zone of current.zones) {
		textMm[zone.id] = Number(field(body, `t_${zone.id}`));
	}

	const next: BillSettings = {
		config: {
			...current.config,
			paperColor: field(body, "paperColor") || current.config.paperColor,
			inkColor: field(body, "inkColor") || current.config.inkColor,
			frameWeight: Number(field(body, "frameWeight")),
			guillocheDensity: Number(field(body, "guillocheDensity")),
			cornerOrnament: field(body, "cornerOrnament") !== "0",
			microText: field(body, "microText"),
		},
		zones,
		textMm,
	};

	// 越界/非法值不会被拒绝，而是被 normalizeBillSettingsInput 钳到合法区间，
	// 所以这里用一个粗判：有任何数值为 NaN，就带上 invalid 提示让管理员复核。
	const hasInvalidNumber =
		zones.some(
			(zone) =>
				!Number.isFinite(zone.x) ||
				!Number.isFinite(zone.y) ||
				!Number.isFinite(zone.w) ||
				!Number.isFinite(zone.h),
		) ||
		Object.values(textMm).some((value) => !Number.isFinite(value)) ||
		!Number.isFinite(next.config.frameWeight) ||
		!Number.isFinite(next.config.guillocheDensity);

	await saveBillSettings(getDb(c.env.DB), next);

	return c.redirect(`/api/admin/bill?status=${hasInvalidNumber ? "invalid" : "saved"}`);
});

export { bill as billRoutes };
