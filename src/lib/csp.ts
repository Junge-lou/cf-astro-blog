/**
 * 正文内容里会出现的外链图床域名。
 *
 * 为什么单独放一个模块：公共页面（`src/middleware.ts`）与后台登录页
 * （`src/admin/app.ts` 的 `/auth` 分支）各有一份 CSP，两者的 `img-src` 需要放行
 * **同一批**域名。这张表此前被复制成两处字面量，新增图床时很容易只改一处 ——
 * 表现是"文章正文里的图正常、登录页或后台预览里的图裂开"，而这类问题几乎不会
 * 让人联想到 CSP。
 *
 * 注意：**不**要把所有 CSP 都统一到这里。三个 CSP 的差异是有意的：
 * - 公共页面：额外允许 `https:`（任意 https 图片）与更宽松的 `font-src`；
 * - `/auth`：脚本只允许 self + Turnstile，比公共页面严格（登录页没有内联脚本需求）；
 * - `/admin`：`img-src` 只放行下面这一批里的一个域名，比 `/auth` 更严格。
 * 收敛的目标是消除"同一张表写两遍"，不是把安全策略拉平。
 */
export const CONTENT_IMAGE_HOSTS = [
	"https://assets.ericterminal.com",
	"https://pic.ffaff.fun",
	"https://junge-lou.github.io",
	"https://typora-piclists.oss-cn-shenzhen.aliyuncs.com",
	"https://ffaff-1387930382.cos.ap-guangzhou.myqcloud.com",
] as const;

/**
 * 拼出 `img-src` 指令值。
 *
 * @param options.allowAnyHttps 公共页面为 true（允许任意 https 图源），
 *   后台登录页为 false。两者的域名列表都来自 `CONTENT_IMAGE_HOSTS`。
 */
export function buildContentImgSrc(options: { allowAnyHttps?: boolean } = {}): string {
	return [
		"'self'",
		"data:",
		...(options.allowAnyHttps ? ["https:"] : []),
		...CONTENT_IMAGE_HOSTS,
	].join(" ");
}
