import { BILL_ZONE_MIN_X, type BillSettings } from "@/lib/bill-settings";
import { escapeAttribute, escapeHtml } from "@/lib/security";

const billEditorStyles = `
	.bill-editor {
		display: grid;
		grid-template-columns: minmax(320px, 1fr) minmax(280px, 380px);
		gap: 1.25rem;
		align-items: start;
	}

	/* 纸纹强度：range 不必继承 form-input 的输入框外观，只保留滑轨与强调色 */
	.bill-form input[type="range"] {
		width: 100%;
		padding: 0;
		border: 0;
		background: transparent;
		accent-color: var(--accent);
	}

	.bill-preview-frame {
		position: relative;
		width: 100%;
		aspect-ratio: 156 / 66.3;
		border-radius: 3px;
		border: 1px solid var(--border);
		overflow: hidden;
		box-shadow: inset 0 0 0 3px rgb(255 255 255 / 0.5);
	}

	/* 预览里的区块：只画占地与编号，不还原印刷细节，
	   目的是让管理员看清"谁压在谁上面、占比多少"。 */
	.bill-preview-zone {
		position: absolute;
		display: grid;
		place-items: center;
		box-sizing: border-box;
		border: 1px dashed rgb(0 71 171 / 0.45);
		background: rgb(0 71 171 / 0.06);
		font-family: var(--font-mono);
		font-size: 0.6rem;
		line-height: 1.15;
		text-align: center;
		color: #0047ab;
		overflow: hidden;
		padding: 1px;
	}

	.bill-preview-zone[data-enabled="false"] {
		border-style: dotted;
		border-color: rgb(120 120 120 / 0.5);
		background: rgb(120 120 120 / 0.06);
		color: #7a7a7a;
		opacity: 0.55;
	}

	.bill-preview-zone b {
		display: block;
		font-weight: 600;
	}

	.bill-preview-zone i {
		display: block;
		font-style: normal;
		opacity: 0.7;
		font-size: 0.55rem;
	}

	.bill-zone-table {
		width: 100%;
		border-collapse: collapse;
		font-size: 0.8rem;
	}

	.bill-zone-table th,
	.bill-zone-table td {
		padding: 0.4rem 0.3rem;
		border-bottom: 1px solid var(--border);
		text-align: left;
		vertical-align: middle;
	}

	.bill-zone-table th {
		font-weight: 600;
		color: var(--text-secondary);
		font-size: 0.75rem;
		white-space: nowrap;
	}

	.bill-zone-table input[type="number"] {
		width: 4.6rem;
	}

	.bill-zone-table .bill-zone-id {
		font-family: var(--font-mono);
		font-weight: 600;
		white-space: nowrap;
	}

	.bill-zone-table .bill-zone-label,
	.bill-zone-table .bill-zone-href {
		width: 100%;
		min-width: 6rem;
	}

	.bill-zone-table .bill-zone-art {
		width: 100%;
		min-width: 9rem;
		font-family: var(--font-mono);
		font-size: 0.72rem;
	}

	.bill-zone-table .bill-zone-art-fit {
		margin-top: 0.2rem;
		width: 100%;
	}

	/* 预览里挂了组件图的区块：直接铺图，比虚线框更直观 */
	.bill-preview-zone[data-has-art="true"] {
		background-repeat: no-repeat;
		background-position: center;
	}

	.bill-table-scroll {
		overflow-x: auto;
	}

	.bill-inline-grid {
		display: grid;
		grid-template-columns: repeat(auto-fit, minmax(9rem, 1fr));
		gap: 0.75rem;
	}

	@media (max-width: 1080px) {
		.bill-editor {
			grid-template-columns: 1fr;
		}
	}
`;

/** 票面预览：每个区块画成一个虚线框，实时跟随表单数值；挂了组件图的直接铺图。 */
function renderPreview(settings: BillSettings): string {
	const zones = settings.zones
		.map((zone) => {
			const art = zone.art;
			const artStyle = art
				? `background-image:url(&quot;${escapeAttribute(art.src)}&quot;);background-size:${
						art.fit === "cover" ? "cover" : art.fit === "fill" ? "100% 100%" : "contain"
					};`
				: "";
			return `<span
				class="bill-preview-zone"
				data-zone="${escapeAttribute(zone.id)}"
				data-enabled="${zone.enabled ? "true" : "false"}"
				data-has-art="${art ? "true" : "false"}"
				style="left:${zone.x}%;top:${zone.y}%;width:${zone.w}%;height:${zone.h}%;${artStyle}"
			><b>${escapeHtml(zone.id)}</b><i>${escapeHtml(zone.label || zone.kind)}</i></span>`;
		})
		.join("");

	// 整票边框图也铺进预览，和首页一致
	const frameStyle = settings.config.frameArt
		? `background-image:url(&quot;${escapeAttribute(settings.config.frameArt)}&quot;);background-size:100% 100%;background-repeat:no-repeat;`
		: "";

	return `<div
		class="bill-preview-frame"
		data-bill-preview
		style="background-color:${escapeAttribute(settings.config.paperColor)};${frameStyle}"
	>${zones}</div>`;
}

function renderZoneRow(zone: BillSettings["zones"][number], textMmValue: number): string {
	const textMm = textMmValue;

	// x 允许负数：文字在盒内居中，对齐左缘时盒子需要外溢（见 bill-settings 的 asGeometry）
	const numberInput = (suffix: string, value: number, step: string, min = "0") =>
		`<input
			type="number"
			class="form-input"
			name="${suffix}_${zone.id}"
			value="${value}"
			step="${step}"
			min="${min}"
			max="100"
			data-bill-field="${suffix}"
			data-zone="${escapeAttribute(zone.id)}"
		/>`;

	return `<tr>
		<td class="bill-zone-id">${escapeHtml(zone.id)}</td>
		<td>
			<select class="form-input" name="enabled_${zone.id}" data-bill-field="enabled" data-zone="${escapeAttribute(zone.id)}">
				<option value="1"${zone.enabled ? " selected" : ""}>显示</option>
				<option value="0"${zone.enabled ? "" : " selected"}>隐藏</option>
			</select>
		</td>
		<td>${numberInput("x", zone.x, "0.01", String(BILL_ZONE_MIN_X))}</td>
		<td>${numberInput("y", zone.y, "0.01")}</td>
		<td>${numberInput("w", zone.w, "0.01")}</td>
		<td>${numberInput("h", zone.h, "0.01")}</td>
		<td>${numberInput("t", textMm, "0.1")}</td>
		<td>
			<input
				class="form-input bill-zone-label"
				name="label_${zone.id}"
				value="${escapeAttribute(zone.label)}"
				maxlength="80"
				placeholder="留空用原版铭文"
				data-bill-field="label"
				data-zone="${escapeAttribute(zone.id)}"
			/>
		</td>
		<td>
			<input
				class="form-input bill-zone-href"
				name="href_${zone.id}"
				value="${escapeAttribute(zone.href)}"
				maxlength="300"
				placeholder="/blog"
				data-bill-field="href"
				data-zone="${escapeAttribute(zone.id)}"
			/>
		</td>
		<td>
			<input
				class="form-input bill-zone-art"
				name="artSrc_${zone.id}"
				value="${escapeAttribute(zone.art?.src ?? "")}"
				maxlength="120"
				placeholder="/bill/…（留空用文字）"
				data-bill-field="artSrc"
				data-zone="${escapeAttribute(zone.id)}"
			/>
			<select
				class="form-input bill-zone-art-fit"
				name="artFit_${zone.id}"
				data-bill-field="artFit"
				data-zone="${escapeAttribute(zone.id)}"
			>
				<option value="contain"${(zone.art?.fit ?? "contain") === "contain" ? " selected" : ""}>contain 完整显示</option>
				<option value="cover"${zone.art?.fit === "cover" ? " selected" : ""}>cover 铺满裁边</option>
				<option value="fill"${zone.art?.fit === "fill" ? " selected" : ""}>fill 拉伸（仅边框）</option>
			</select>
		</td>
		<td>${escapeHtml(zone.ariaLabel)}</td>
	</tr>`;
}

export function renderBillPage(options: {
	csrfToken: string;
	settings: BillSettings;
	status: "saved" | "invalid" | null;
}): string {
	const { csrfToken, settings, status } = options;

	const alert =
		status === "saved"
			? `<p class="appearance-alert appearance-alert-success">票面已保存，刷新首页即可看到效果。</p>`
			: status === "invalid"
				? `<p class="appearance-alert appearance-alert-error">提交的内容未通过校验，已回退到合法值保存，请检查数值范围。</p>`
				: "";

	return `
		<style>${billEditorStyles}</style>
		${alert}
		<h1>首页票面</h1>
		<p class="appearance-copy">
			票面按美元纸币实物 156 × 66.3 mm 建模：区块位置用百分比，字号由实测字高换算成毫米。
			下面的 x / y / w / h 都是百分比，字高单位是毫米。
		</p>

		<form method="post" action="/api/admin/bill" class="bill-form">
			<input type="hidden" name="_csrf" value="${escapeAttribute(csrfToken)}" />

			<div class="bill-editor">
				<section class="appearance-panel">
					<h2>版面概览</h2>
					${renderPreview(settings)}
					<p class="form-help">
						虚线框是区块占地，实时跟随左侧数值变化；灰色虚点是已关闭的区块。
						想看真实印刷效果请点下方「打开首页预览」。
					</p>
				</section>

				<section class="appearance-panel">
					<h2>票面参数</h2>
					<div class="bill-inline-grid">
						<div class="form-group">
							<label for="paperColor">纸张色</label>
							<input id="paperColor" type="color" class="form-input" name="paperColor"
								value="${escapeAttribute(settings.config.paperColor)}" data-bill-color="paper" />
						</div>
						<div class="form-group">
							<label for="inkColor">油墨色</label>
							<input id="inkColor" type="color" class="form-input" name="inkColor"
								value="${escapeAttribute(settings.config.inkColor)}" data-bill-color="ink" />
						</div>
						<div class="form-group">
							<label for="frameWeight">边框粗细（px）</label>
							<input id="frameWeight" type="number" class="form-input" name="frameWeight"
								value="${settings.config.frameWeight}" min="0" max="6" step="0.5" />
						</div>
						<div class="form-group">
							<label for="guillocheDensity">扭索纹层数</label>
							<input id="guillocheDensity" type="number" class="form-input" name="guillocheDensity"
								value="${settings.config.guillocheDensity}" min="1" max="5" step="1" />
						</div>
						<div class="form-group">
							<label for="paperGrain">纸纹强度</label>
							<input id="paperGrain" type="range" class="form-input" name="paperGrain"
								value="${settings.config.paperGrain}" min="0" max="100" step="1" />
						</div>
						<div class="form-group">
							<label for="cornerOrnament">花边</label>
							<select id="cornerOrnament" class="form-input" name="cornerOrnament">
								<option value="1"${settings.config.cornerOrnament ? " selected" : ""}>角花 + 卷草</option>
								<option value="0"${settings.config.cornerOrnament ? "" : " selected"}>关闭</option>
							</select>
						</div>
					</div>
					<div class="form-group">
						<label for="microText">微缩文字（沿底边重复）</label>
						<input id="microText" class="form-input" name="microText"
							value="${escapeAttribute(settings.config.microText)}" maxlength="160" />
					</div>
					<p class="form-help">
						票面宽高比固定为 156 : 66.3（美元实物比例），不提供修改——改了会让所有毫米换算失准。
						纸纹是首页票面唯一保留的纸质特征：全站其他表面都是磨玻璃，不要在那边找纸质开关。
					</p>
				</section>
			</div>

			<section class="appearance-panel" style="margin-top:1.25rem">
				<h2>区块</h2>
				<p class="form-help">
					x / y 是左上角，w / h 是宽高，单位都是票面的百分比。
					字高（mm）只影响字号，改之前先确认盒子装得下——装不下会自动缩、不会溢出。
				</p>
				<div class="bill-table-scroll">
					<table class="bill-zone-table">
						<thead>
							<tr>
								<th>区块</th>
								<th>状态</th>
								<th>x %</th>
								<th>y %</th>
								<th>w %</th>
								<th>h %</th>
								<th>字高 mm</th>
								<th>文案覆盖</th>
								<th>目标链接</th>
								<th>图（路径 / fit）</th>
								<th>无障碍名称</th>
							</tr>
						</thead>
						<tbody>
							${settings.zones
								.map((zone) => renderZoneRow(zone, settings.textMm[zone.id] ?? 2.5))
								.join("")}
						</tbody>
					</table>
				</div>
			</section>

			<div class="appearance-actions">
				<button type="submit" class="btn">保存票面</button>
				<a class="btn" href="/?adminPreview=1" target="_blank" rel="noopener noreferrer">打开首页预览</a>
				<a class="btn" href="/api/admin/appearance">返回站点外观</a>
			</div>
		</form>

		<script src="/admin-bill.js" defer></script>
	`;
}
