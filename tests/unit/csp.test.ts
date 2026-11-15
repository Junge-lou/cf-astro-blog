import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, test } from "node:test";
import {
	MOMO_COMMENT_API_URL,
	MOMO_COMMENT_CDN_HOSTS,
	MOMO_COMMENT_SCRIPT_URL,
} from "../../src/lib/comment";
import { buildContentImgSrc, CONTENT_IMAGE_HOSTS } from "../../src/lib/csp";

/**
 * CSP `img-src` 白名单的回归保护。
 *
 * 这组断言的价值不在于"测试一个字符串拼接"，而在于**锁住公共页面与后台登录页
 * 实际下发的 CSP 内容**：这两处此前各写了一份相同的 5 域名列表，收敛到
 * `CONTENT_IMAGE_HOSTS` 时，任何手误都会静默改变线上 CSP —— 表现是某类图片
 * 在某个页面裂开，且极难定位。
 *
 * 下面的期望值是从收敛前的字面量逐字抄下来的，因此这个测试同时充当
 * "重构前后行为一致"的证明。**新增图床请改 CONTENT_IMAGE_HOSTS，这两条断言
 * 会一起跟上；如果它们失败了，说明有人在别处又硬编码了域名列表。**
 */
const EXPECTED_WITH_ANY_HTTPS =
	"img-src 'self' data: https: https://assets.ericterminal.com https://pic.ffaff.fun " +
	"https://junge-lou.github.io https://typora-piclists.oss-cn-shenzhen.aliyuncs.com " +
	"https://ffaff-1387930382.cos.ap-guangzhou.myqcloud.com";

const EXPECTED_HOSTS_ONLY =
	"img-src 'self' data: https://assets.ericterminal.com https://pic.ffaff.fun " +
	"https://junge-lou.github.io https://typora-piclists.oss-cn-shenzhen.aliyuncs.com " +
	"https://ffaff-1387930382.cos.ap-guangzhou.myqcloud.com";

describe("CSP img-src 白名单", () => {
	test("公共页面：允许任意 https 图源 + 全部内容图床", () => {
		assert.equal(`img-src ${buildContentImgSrc({ allowAnyHttps: true })}`, EXPECTED_WITH_ANY_HTTPS);
	});

	test("后台登录页：只放行明确的图床域名，不给 https: 通配", () => {
		assert.equal(`img-src ${buildContentImgSrc()}`, EXPECTED_HOSTS_ONLY);
	});

	test("两个页面的图床列表来自同一个来源", () => {
		const publicValue = buildContentImgSrc({ allowAnyHttps: true });
		const authValue = buildContentImgSrc();

		for (const host of CONTENT_IMAGE_HOSTS) {
			assert.ok(
				publicValue.includes(host),
				`公共页面 CSP 缺少图床 ${host} —— 新增图床应只改 CONTENT_IMAGE_HOSTS`,
			);
			assert.ok(
				authValue.includes(host),
				`后台登录页 CSP 缺少图床 ${host} —— 新增图床应只改 CONTENT_IMAGE_HOSTS`,
			);
		}
	});

	test("后台登录页不会因为通配而放宽到任意 https", () => {
		// 这条是安全边界：/auth 比公共页面严格，多一个 " https:" 就等于放开全部图源
		assert.ok(
			!buildContentImgSrc().split(" ").includes("https:"),
			"后台登录页的 img-src 不应包含 https: 通配",
		);
	});
});

/**
 * `form-action` 的回归保护。
 *
 * Webmention 面板的「发送」表单 POST 到 webmention.io。只写 `'self'` 会被浏览器
 * 直接拒绝提交，且**不产生任何网络错误**——控制台只有一行 CSP 警告，表现就是
 * 「点了按钮没反应」。这条断言锁住那个白名单，防止以后"顺手收紧 CSP"时又把它删掉。
 */
describe("CSP form-action", () => {
	test("公共页面放行 webmention.io 的表单提交", async () => {
		const source = await readFile("src/middleware.ts", "utf8");
		assert.match(source, /form-action 'self' https:\/\/webmention\.io/u);
	});

	test("后台 CSP 不为跨源表单开口子", async () => {
		const source = await readFile("src/admin/app.ts", "utf8");
		assert.ok(
			!source.includes("form-action 'self' https://webmention.io"),
			"后台没有跨源表单，不要把公开页的白名单带进去",
		);
	});
});

/**
 * `video-src` 不是 CSP 指令。
 *
 * 曾经两份策略里都写着 `video-src 'self' https: data:`，浏览器会丢弃整条并打印
 * "Unrecognized Content-Security-Policy directive 'video-src'"，于是 `<video>`
 * 回落到 `default-src 'self'`——外链视频全被拦住，而控制台只有一行看起来
 * 人畜无害的报错。视频/音频统一由 `media-src` 管辖。
 */
describe("CSP 指令合法性", () => {
	const POLICY_SOURCES = ["src/middleware.ts", "src/admin/app.ts"];

	test("两份策略都不包含不存在的 video-src 指令", async () => {
		for (const path of POLICY_SOURCES) {
			const source = await readFile(path, "utf8");
			// 只匹配"真正的指令条目"（列表里以引号开头的字符串），
			// 这样注释里提到这个错误指令名不会误报。
			assert.doesNotMatch(
				source,
				/"video-src /u,
				`${path} 里出现了 video-src 指令 —— 正确的指令是 media-src`,
			);
		}
	});

	test("两份策略都保留了 media-src，且覆盖外链视频", async () => {
		for (const path of POLICY_SOURCES) {
			const source = await readFile(path, "utf8");
			assert.match(source, /"media-src 'self' https: data:"/u, `${path} 缺少 media-src`);
		}
	});
});

/**
 * 评论区的 CSP 依赖。
 *
 * 这四条断言锁的都是「坏了以后看不出坏在哪」的配置：
 * - 少了 `'wasm-unsafe-eval'`：评论区显示正常，只有提交时无感验证失败；
 * - 少了 jsDelivr：整块评论区空白（脚本 404/被拦）；
 * - 少了 blob: worker：只是解题变慢，肉眼几乎判定不出是否生效；
 * - 少了接口域名：一直显示「加载中」，且控制台只有一行 CORS/CSP 报错。
 */
describe("CSP 评论区", () => {
	test("脚本源放行 jsDelivr 组件与 WASM 编译", async () => {
		const source = await readFile("src/middleware.ts", "utf8");
		assert.match(source, /"'wasm-unsafe-eval'"/u, "缺少 'wasm-unsafe-eval'，HashWX 验证会失败");
		assert.match(source, /"https:\/\/cdn\.jsdelivr\.net"/u, "缺少 jsDelivr，评论组件加载不到");
	});

	test("放行 blob: worker，保住并行求解的快速路径", async () => {
		const source = await readFile("src/middleware.ts", "utf8");
		assert.match(source, /"worker-src 'self' blob:"/u, "缺少 worker-src blob:，PoW 会退回主线程");
		assert.ok(!source.includes('"worker-src *"'), "worker-src 不能写成通配，只放行 blob: 即可");
	});

	test("connect-src 引用 comment.ts 的常量而不是另写一份地址", async () => {
		const source = await readFile("src/middleware.ts", "utf8");
		assert.ok(
			source.includes("MOMO_COMMENT_API_URL"),
			"connect-src 应引用 @/lib/comment 的 MOMO_COMMENT_API_URL",
		);
		assert.ok(
			source.includes("MOMO_COMMENT_CDN_HOSTS"),
			"connect-src 应引用 @/lib/comment 的 MOMO_COMMENT_CDN_HOSTS（表情与头像）",
		);
		for (const host of MOMO_COMMENT_CDN_HOSTS) {
			assert.ok(
				!source.includes(host),
				`${host} 不应在 middleware 里硬编码 —— 改 @/lib/comment 里的列表`,
			);
		}
	});

	test("评论后端地址固定、组件版本按官方建议锁死", () => {
		assert.equal(MOMO_COMMENT_API_URL, "https://comments.ffaff.fun");
		assert.match(
			MOMO_COMMENT_SCRIPT_URL,
			/@motues\/momo-comment@\d+\.\d+\.\d+\/dist\/momo-comment\.min\.js$/u,
			"组件必须锁版本号，否则后端的验证协议升级会静默打断评论提交",
		);
	});
});
