/**
 * Momo 评论区外部地址的唯一来源。
 *
 * 评论由**独立部署**的 Momo-Backend Worker 提供（Hono + D1 + KV），与本站的
 * D1 无关：本站只负责挂载官方前端组件 `momo-comment.min.js`，数据全部落在
 * `MOMO_COMMENT_API_URL` 那一侧。
 *
 * 为什么收敛到一个模块：这两个地址都无法由本站配置推导出来 —— Worker 是独立
 * 子域，组件版本还必须与后端协议配套。此前 Webmention 的地址就是在三个文件里
 * 各硬编码了一次，换域名时必然漏改一处，症状是「面板永远空着」这种几乎无法从
 * 现象反推到根因的形态。评论区的等价症状是「一直停在评论加载中」。
 */

/** Momo-Backend Worker 的对外地址（前端 `momo.init({ apiUrl })`）。 */
export const MOMO_COMMENT_API_URL = "https://comments.ffaff.fun";

/**
 * 官方前端组件，**自托管**在 `public/vendor/momo-comment/` 下，版本写进文件名。
 *
 * 为什么不用 jsDelivr：实测从本机到 jsDelivr 的 TLS 握手就要 3.6s、228KB 原始体下完 5.3s，
 * 而组件是页面渲染后才被发现的，完全无法与首屏重叠。改成同源后，连接直接复用站点已有的
 * HTTP/2 连接，且文件名带版本号 → 可以 immutable 缓存一年（`public/_headers`）。
 *
 * 版本必须与后端配套（见 Momo-Backend `frontend/README.md`）：
 * 1.8.x ⇄ 协议 v2 无感验证 + 表情配置契约 v3 + 链接安全审查。
 * 1.8.4 相对 1.8.3 只有前端改动：头像加载失败时回落内联默认头像
 * （`avatarFallback`）、图片改 lazy/async/no-referrer、博主徽章配色；后端协议不变。
 * 升级时同时替换 `public/vendor/momo-comment/` 里的文件与本常量。
 */
export const MOMO_COMMENT_SCRIPT_URL = "/vendor/momo-comment/momo-comment.1.8.4.min.js";

/**
 * 后端默认的头像与表情来源域名。
 *
 * 组件是**在访客浏览器里**直接拉取 `owo.json`（受 `connect-src` 管辖）和头像
 * 图片（受 `img-src` 管辖）的，因此这两个域名必须进 CSP。取值来自 Momo-Backend
 * 的 `DEFAULT_EMOJI_CDN_URL` 与头像地址模板；如果在后台把表情来源换成别的域名，
 * 这里要一起改，否则表现为「表情面板一直转圈」而评论区其它功能正常。
 */
export const MOMO_COMMENT_CDN_HOSTS = ["https://open.motues.top"] as const;
