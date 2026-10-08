import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
	buildMediaObjectKeyForType,
	resolveUploadMaxWidth,
	saveMediaObjectWithDedup,
} from "../../src/lib/media";

/**
 * 上传时图片转换的行为测试。
 *
 * 这段逻辑的价值在于「后台上传 PNG 会自动变成 WebP，且顺带缩到实际需要的宽度」，
 * 而它的**安全边界比功能更重要**：转换只是锦上添花，任何异常都不能让上传失败，
 * 也不能把图换成更差的版本。所以下面重点测回退路径。
 */
interface FakeObject {
	body: Uint8Array;
	httpMetadata?: { contentType?: string };
	customMetadata?: Record<string, string>;
}

function createFakeBucket() {
	const objects = new Map<string, FakeObject>();

	return {
		objects,
		async get(key: string) {
			const entry = objects.get(key);
			if (!entry) return null;
			return { text: async () => new TextDecoder().decode(entry.body) };
		},
		async head(key: string) {
			return objects.has(key) ? { key } : null;
		},
		async put(key: string, body: unknown, options?: FakeObject) {
			const bytes =
				typeof body === "string"
					? new TextEncoder().encode(body)
					: body instanceof Uint8Array
						? body
						: new Uint8Array(body as ArrayBuffer);
			objects.set(key, {
				body: bytes,
				httpMetadata: options?.httpMetadata,
				customMetadata: options?.customMetadata,
			});
		},
		async delete(key: string) {
			objects.delete(key);
		},
	} as unknown as R2Bucket & { objects: Map<string, FakeObject> };
}

/** 假绑定：记录收到的 transform/output 参数，按需返回指定字节或抛错。 */
function createFakeImages(options: { output?: Uint8Array<ArrayBuffer>; fail?: boolean } = {}) {
	const transforms: Array<Record<string, unknown>> = [];
	const outputs: Array<Record<string, unknown>> = [];

	const binding = {
		input: () => ({
			transform: (transform: Record<string, unknown>) => {
				transforms.push(transform);
				return {
					output: (output: Record<string, unknown>) => {
						outputs.push(output);
						if (options.fail) {
							throw new Error("模拟 Images 转换失败");
						}
						const bytes = options.output ?? new Uint8Array([82, 73, 70, 70]);
						return {
							response: () => new Response(bytes, { headers: { "content-type": "image/webp" } }),
						};
					},
				};
			},
		}),
	} as unknown as ImagesBinding;

	return { binding, transforms, outputs };
}

function createFile(bytes: Uint8Array<ArrayBuffer>, type: string, name = "x"): File {
	return new File([bytes], name, { type });
}

const BIG_PNG = new Uint8Array(4096).fill(7);

describe("上传目标宽度", () => {
	test("按 key 前缀选择规格，与离线流水线一致", () => {
		assert.equal(resolveUploadMaxWidth("appearance/background"), 1920);
		assert.equal(resolveUploadMaxWidth("posts/typora/cover"), 800);
		assert.equal(resolveUploadMaxWidth("posts/typora/content"), 1600);
		assert.equal(resolveUploadMaxWidth("uploads"), 1600);
	});
});

describe("上传时转 WebP", () => {
	test("JPG/PNG 会被转成 WebP，并以 .webp 结尾存储", async () => {
		const bucket = createFakeBucket();
		const { binding, transforms, outputs } = createFakeImages({
			output: new Uint8Array(1024).fill(1),
		});

		const result = await saveMediaObjectWithDedup({
			bucket,
			file: createFile(BIG_PNG, "image/png", "big.png"),
			prefix: "posts/typora/cover",
			images: binding,
		});

		assert.equal(result.converted, true);
		assert.match(result.key, /\.webp$/u);

		const [transform] = transforms;
		const [output] = outputs;
		assert.ok(transform, "应调用一次 transform");
		assert.ok(output, "应调用一次 output");
		assert.equal(transform.width, 800, "封面图应缩到 800 宽");
		assert.equal(transform.fit, "scale-down", "必须防止小图被放大");
		assert.equal(output.format, "image/webp");

		const stored = bucket.objects.get(result.key);
		assert.equal(stored?.httpMetadata?.contentType, "image/webp");
		assert.equal(stored?.body.byteLength, 1024, "存的必须是转换后的字节");
	});

	test("背景图按 1920 宽转换", async () => {
		const { binding, transforms } = createFakeImages({ output: new Uint8Array(1024) });
		await saveMediaObjectWithDedup({
			bucket: createFakeBucket(),
			file: createFile(BIG_PNG, "image/png"),
			prefix: "appearance/background",
			images: binding,
		});
		const [transform] = transforms;
		assert.ok(transform, "应调用一次 transform");
		assert.equal(transform.width, 1920);
	});

	test("GIF 与 AVIF 不转换：前者会丢动画，后者本来就比 WebP 省", async () => {
		for (const [type, name] of [
			["image/gif", "a.gif"],
			["image/avif", "a.avif"],
		] as const) {
			const bucket = createFakeBucket();
			const { binding, transforms } = createFakeImages({ output: new Uint8Array(16) });
			const result = await saveMediaObjectWithDedup({
				bucket,
				file: createFile(BIG_PNG, type, name),
				images: binding,
			});

			assert.equal(result.converted ?? false, false, `${type} 不应被转换`);
			assert.equal(transforms.length, 0, `${type} 不应调用转换`);
			assert.ok(result.key.endsWith(name.slice(name.lastIndexOf("."))), "扩展名应保持原样");
		}
	});

	test("转换后反而更大时保留原图", async () => {
		const bucket = createFakeBucket();
		const { binding } = createFakeImages({ output: new Uint8Array(BIG_PNG.byteLength * 2) });

		const result = await saveMediaObjectWithDedup({
			bucket,
			file: createFile(BIG_PNG, "image/png"),
			images: binding,
		});

		assert.equal(result.converted, false);
		assert.match(result.key, /\.png$/u);
		assert.equal(bucket.objects.get(result.key)?.body.byteLength, BIG_PNG.byteLength);
	});

	test("转换抛错时上传仍然成功，并回退为存原图", async () => {
		const bucket = createFakeBucket();
		const { binding } = createFakeImages({ fail: true });
		const originalWarn = console.warn;
		console.warn = () => {};
		try {
			const result = await saveMediaObjectWithDedup({
				bucket,
				file: createFile(BIG_PNG, "image/png", "keep.png"),
				images: binding,
			});

			assert.equal(result.converted, false);
			assert.match(result.key, /\.png$/u);
			assert.equal(
				bucket.objects.get(result.key)?.body.byteLength,
				BIG_PNG.byteLength,
				"失败后必须存原图，不能留下空对象或半成品",
			);
		} finally {
			console.warn = originalWarn;
		}
	});

	test("没有 Images 绑定（账号未开通）时静默存原图", async () => {
		const bucket = createFakeBucket();
		const result = await saveMediaObjectWithDedup({
			bucket,
			file: createFile(BIG_PNG, "image/png"),
			images: undefined,
		});

		assert.equal(result.converted, false);
		assert.match(result.key, /\.png$/u);
		assert.equal(bucket.objects.get(result.key)?.body.byteLength, BIG_PNG.byteLength);
	});

	test("同一文件重复上传仍命中去重索引（哈希基于上传的原始字节）", async () => {
		const bucket = createFakeBucket();
		const file = () => createFile(BIG_PNG, "image/png", "same.png");
		const { binding } = createFakeImages({ output: new Uint8Array(1024) });

		const first = await saveMediaObjectWithDedup({ bucket, file: file(), images: binding });
		const second = await saveMediaObjectWithDedup({ bucket, file: file(), images: binding });

		assert.equal(second.deduplicated, true);
		assert.equal(second.key, first.key);
	});
});

describe("对象 key 的扩展名", () => {
	test("扩展名由内容类型决定，而不是原始文件名", () => {
		assert.match(buildMediaObjectKeyForType("image/webp", "uploads"), /\.webp$/u);
		assert.match(buildMediaObjectKeyForType("image/png", "uploads"), /\.png$/u);
		assert.throws(() => buildMediaObjectKeyForType("image/svg+xml"), /仅允许上传/u);
	});
});
