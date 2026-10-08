const ALLOWED_MEDIA_TYPES = new Map<string, string>([
	["image/jpeg", "jpg"],
	["image/png", "png"],
	["image/webp", "webp"],
	["image/avif", "avif"],
	["image/gif", "gif"],
]);

const MEDIA_HASH_INDEX_PREFIX = "__index/media-hash/v1";
const CONTENT_HASH_PATTERN = /^[a-f0-9]{64}$/u;

export const MAX_UPLOAD_BYTES = 50 * 1024 * 1024;

interface MediaHashIndexRecord {
	contentHash: string;
	contentType: string;
	createdAt: string;
	key: string;
	size: number;
}

function isValidContentHash(value: string) {
	return CONTENT_HASH_PATTERN.test(value);
}

function toHex(bytes: Uint8Array) {
	return [...bytes].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export function getAllowedMediaAcceptValue() {
	return [...ALLOWED_MEDIA_TYPES.keys()].join(",");
}

export function isAllowedImageMimeType(value: string) {
	return ALLOWED_MEDIA_TYPES.has(value);
}

/**
 * 按**最终存储**的内容类型生成对象 key（扩展名由内容类型决定，而不是原文件名）。
 * 之所以按内容类型而不是 file.type 取扩展名：上传时可能已经把图转成了 WebP，
 * 此时 key 必须跟着变成 .webp，否则响应会以 .png 的扩展名回一个 WebP 文件。
 */
export function buildMediaObjectKeyForType(contentType: string, prefix = "uploads") {
	const extension = ALLOWED_MEDIA_TYPES.get(contentType);
	if (!extension) {
		throw new Error("仅允许上传 JPG、PNG、WEBP、AVIF 或 GIF 图片");
	}

	return `${prefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
}

export function buildMediaObjectKey(file: File, prefix = "uploads") {
	return buildMediaObjectKeyForType(file.type, prefix);
}

export function buildMediaHashIndexKey(contentHash: string) {
	return `${MEDIA_HASH_INDEX_PREFIX}/${contentHash}.json`;
}

export function isMediaHashIndexKey(key: string) {
	return key.startsWith(`${MEDIA_HASH_INDEX_PREFIX}/`) && key.endsWith(".json");
}

export async function computeFileContentHash(file: File) {
	const buffer = await file.arrayBuffer();
	const digest = await crypto.subtle.digest("SHA-256", buffer);
	return toHex(new Uint8Array(digest));
}

async function readMediaHashIndex(
	bucket: R2Bucket,
	contentHash: string,
): Promise<MediaHashIndexRecord | null> {
	const indexKey = buildMediaHashIndexKey(contentHash);
	const indexObject = await bucket.get(indexKey);
	if (!indexObject) {
		return null;
	}

	try {
		const payload = JSON.parse(await indexObject.text()) as Partial<MediaHashIndexRecord>;
		if (
			typeof payload.key !== "string" ||
			typeof payload.contentHash !== "string" ||
			typeof payload.contentType !== "string" ||
			typeof payload.createdAt !== "string" ||
			typeof payload.size !== "number"
		) {
			return null;
		}

		if (!isValidContentHash(payload.contentHash)) {
			return null;
		}

		return payload as MediaHashIndexRecord;
	} catch {
		return null;
	}
}

async function writeMediaHashIndex(bucket: R2Bucket, record: MediaHashIndexRecord) {
	const indexKey = buildMediaHashIndexKey(record.contentHash);
	await bucket.put(indexKey, JSON.stringify(record), {
		httpMetadata: { contentType: "application/json; charset=utf-8" },
	});
}

async function resolveExistingKeyFromHashIndex(
	bucket: R2Bucket,
	contentHash: string,
): Promise<string | null> {
	const record = await readMediaHashIndex(bucket, contentHash);
	if (!record?.key) {
		return null;
	}

	const existingObject = await bucket.head(record.key);
	if (existingObject) {
		return record.key;
	}

	await bucket.delete(buildMediaHashIndexKey(contentHash));
	return null;
}

export interface SaveMediaObjectResult {
	contentHash: string;
	deduplicated: boolean;
	key: string;
	/** 是否在保存前转换成了 WebP（用于日志与排查）。 */
	converted?: boolean;
}

/**
 * 上传时按用途决定目标宽度。
 *
 * 规格与 `MEDIA-OPTIMIZATION.md` 的离线流水线保持一致，这样"后台上传"与
 * "离线批处理"两条路产出的图规格相同，不会互相矛盾：
 *   - 背景图   1920 —— 站点渲染宽度约 1184px，且叠了 CSS blur
 *   - 封面图    800 —— 卡片实际渲染宽度只有 240–272px
 *   - 正文图   1600 —— 正文栏宽 754px，按 2x 屏取两倍
 *   - 其它     1600 —— 媒体库图片用途不定，取较保守值
 */
export function resolveUploadMaxWidth(prefix: string): number {
	if (prefix.startsWith("appearance/background")) {
		return 1920;
	}
	if (/(^|\/)cover$/u.test(prefix)) {
		return 800;
	}
	return 1600;
}

/**
 * 值得转成 WebP 的输入格式。
 *
 * 刻意排除两类：
 * - `image/gif`：动图一旦被转成静态图就丢了动画，风险大于收益；
 * - `image/avif`：本身已比 WebP 更省，转换只会变大。
 */
const TRANSFORMABLE_MEDIA_TYPES = new Set(["image/jpeg", "image/png"]);

export const DEFAULT_UPLOAD_QUALITY = 80;

/**
 * 用 Cloudflare Images 绑定把图片转成 WebP 并按需缩宽。
 *
 * 返回 null 表示"不转换"（格式不适用、或转换后反而更大），调用方应回退为存原图。
 *
 * 两个实测得来的注意点（见 docs/optimization-plan.md）：
 * - `output()` 在运行时**返回 Promise**，而类型定义写的是同步返回；`await` 对两者都成立。
 * - `fit: "scale-down"` 保证小图不会被放大。
 */
async function convertImageToWebp(
	images: ImagesBinding,
	bytes: Uint8Array<ArrayBuffer>,
	contentType: string,
	options: { maxWidth: number; quality: number },
): Promise<{ bytes: Uint8Array<ArrayBuffer>; contentType: string } | null> {
	if (!TRANSFORMABLE_MEDIA_TYPES.has(contentType)) {
		return null;
	}

	const result = await images
		.input(new Blob([bytes]).stream())
		.transform({ width: options.maxWidth, fit: "scale-down" })
		.output({ format: "image/webp", quality: options.quality });

	const response = result instanceof Response ? result : result.response();
	const converted = new Uint8Array(await response.arrayBuffer());

	// 转换后反而更大（小图、或已经是高压缩比的情况）时保留原图
	if (converted.byteLength === 0 || converted.byteLength >= bytes.byteLength) {
		return null;
	}

	return { bytes: converted, contentType: "image/webp" };
}

export async function saveMediaObjectWithDedup(options: {
	bucket: R2Bucket;
	file: File;
	prefix?: string;
	/**
	 * Cloudflare Images 绑定。传了才尝试转换；账号未开通 Images 时传 undefined，
	 * 会直接存原图（不会报错）。任何转换失败也都回退为存原图。
	 */
	images?: ImagesBinding;
	/** 目标最大宽度；缺省时按 prefix 用 resolveUploadMaxWidth() 推断。 */
	maxWidth?: number;
	quality?: number;
}): Promise<SaveMediaObjectResult> {
	const { bucket, file, prefix = "uploads", images } = options;
	const contentHash = await computeFileContentHash(file);
	const existingKey = await resolveExistingKeyFromHashIndex(bucket, contentHash);
	if (existingKey) {
		return { key: existingKey, deduplicated: true, contentHash };
	}

	let storedBytes: Uint8Array<ArrayBuffer> = new Uint8Array(await file.arrayBuffer());
	let storedContentType = file.type;
	let converted = false;

	if (images) {
		try {
			const result = await convertImageToWebp(images, storedBytes, file.type, {
				maxWidth: options.maxWidth ?? resolveUploadMaxWidth(prefix),
				quality: options.quality ?? DEFAULT_UPLOAD_QUALITY,
			});
			if (result) {
				storedBytes = result.bytes;
				storedContentType = result.contentType;
				converted = true;
			}
		} catch (error) {
			// 转换是"锦上添花"：失败绝不能让上传失败，回退为存原图。
			console.warn("[media] 图片转换失败，已回退为存原图", error);
		}
	}

	const key = buildMediaObjectKeyForType(storedContentType, prefix);
	await bucket.put(key, storedBytes, {
		httpMetadata: { contentType: storedContentType },
		customMetadata: {
			contentHash,
		},
	});

	// 并发上传同一文件时，后写入者复用已有索引并清理重复对象。
	const concurrentKey = await resolveExistingKeyFromHashIndex(bucket, contentHash);
	if (concurrentKey && concurrentKey !== key) {
		await bucket.delete(key);
		return { key: concurrentKey, deduplicated: true, contentHash };
	}

	await writeMediaHashIndex(bucket, {
		key,
		contentHash,
		contentType: storedContentType,
		size: storedBytes.byteLength,
		createdAt: new Date().toISOString(),
	});

	return { key, deduplicated: false, contentHash, converted };
}

export async function deleteMediaObjectAndIndex(bucket: R2Bucket, key: string) {
	const existingObject = await bucket.head(key);
	await bucket.delete(key);

	const contentHash = existingObject?.customMetadata?.contentHash;
	if (!contentHash || !isValidContentHash(contentHash)) {
		return;
	}

	const indexedKey = await resolveExistingKeyFromHashIndex(bucket, contentHash);
	if (indexedKey === key) {
		await bucket.delete(buildMediaHashIndexKey(contentHash));
	}
}

export function getMediaContentTypeForKey(key: string): string | null {
	const extension = key.split(".").pop()?.toLowerCase();
	for (const [contentType, allowedExtension] of ALLOWED_MEDIA_TYPES.entries()) {
		if (allowedExtension === extension) {
			return contentType;
		}
	}

	return null;
}

export function isImageMediaKey(key: string) {
	return /\.(jpg|jpeg|png|gif|webp|avif)$/i.test(key);
}

/**
 * 公开图片的响应头。
 *
 * 关键点：
 * - 必须带 `s-maxage`，否则 Cloudflare 边缘层不会缓存，每个 <img> 请求都会
 *   回源 Worker + R2（实测单张图 TTFB 1.0–2.3s，连续请求无改善）。
 * - `immutable` 表示内容不变。若直接覆盖 R2 中的同名对象，已缓存的浏览器与
 *   边缘节点在 TTL 内仍会返回旧图；需要换图时请使用新的 key（或等 TTL 过期）。
 * - 不要在此响应上设置 `Vary`：图片已按格式编码，按 Accept-Encoding 拆分
 *   缓存条目没有意义，只会降低边缘命中率。
 */
export function buildPublicImageHeaders(contentType: string) {
	return {
		"Content-Type": contentType,
		"Cache-Control": "public, max-age=31536000, s-maxage=31536000, immutable",
		"X-Content-Type-Options": "nosniff",
	};
}
