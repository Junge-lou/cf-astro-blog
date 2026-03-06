const ALLOWED_MEDIA_TYPES = new Map<string, string>([
	["image/jpeg", "jpg"],
	["image/png", "png"],
	["image/webp", "webp"],
	["image/avif", "avif"],
	["image/gif", "gif"],
]);

export const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;

export function getAllowedMediaAcceptValue() {
	return [...ALLOWED_MEDIA_TYPES.keys()].join(",");
}

export function isAllowedImageMimeType(value: string) {
	return ALLOWED_MEDIA_TYPES.has(value);
}

export function buildMediaObjectKey(file: File, prefix = "uploads") {
	const extension = ALLOWED_MEDIA_TYPES.get(file.type);
	if (!extension) {
		throw new Error("仅允许上传 JPG、PNG、WEBP、AVIF 或 GIF 图片喵");
	}

	return `${prefix}/${new Date().toISOString().slice(0, 10)}/${crypto.randomUUID()}.${extension}`;
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

export function buildPublicImageHeaders(contentType: string) {
	return {
		"Content-Type": contentType,
		"Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
		"X-Content-Type-Options": "nosniff",
	};
}
