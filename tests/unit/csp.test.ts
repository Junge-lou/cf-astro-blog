import assert from "node:assert/strict";
import { describe, test } from "node:test";
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
