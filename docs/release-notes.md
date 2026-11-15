# cf-astro-blog v1.12 — 评论组件自托管 + 纯透明模式

**2026-11-15**

## 评论组件从 CDN 搬到 `public/vendor/`

实测到 jsDelivr 的链路：DNS 63ms → TCP 236ms → **TLS 3.62s** → 首字节 4.23s → 228KB 下完 5.27s。
而组件是在页面渲染之后才被发现的，这段耗时完全无法与首屏重叠。

- 包体落到 `public/vendor/momo-comment/momo-comment.1.8.3.min.js`（228,500 B，br ≈ 68 KB），
  版本写进文件名 → `public/_headers` 里 `/vendor/*` 声明 `immutable` 一年
- `src/lib/comment.ts` 的 `MOMO_COMMENT_SCRIPT_URL` 改为同源相对路径，跨域 TLS 直接消失
- `public/momo-comments.js` 改为**解析期就发起请求**（原先要等 `astro:page-load`），
  下载与剩余 HTML/CSS 并行；`astro:page-load` 只负责客户端导航后的重新挂载
- CSP 相应撤掉 `script-src https://cdn.jsdelivr.net`（少一个可被前置的外域脚本源）

本地实测：`/vendor/momo-comment/…` 41ms 起 44ms 结束，`/api/comments` 106ms 开始请求（不再等 page-load）。

> **升级组件时**：同时替换 `public/vendor/momo-comment/` 下的文件与常量，并保持后端协议配套
> （1.8.x ⇄ 协议 v2 + 表情契约 v3）。`tests/unit/csp.test.ts` 会断言常量指向的文件真实存在。

## 纯透明模式（面板可以真的全透明）

根因是 `.glass-panel::after` 里写死的 `clamp(0.45, opacity × 2.6, 0.92)`：下限 0.45 让
「透明度」滑块在 0–83% 的行程里**完全不生效**（默认 opacity 14 已经落在下限内，算出来的填充色
与拖到 100% 一模一样）。染色渐变的 `clamp(0.14, …)` 同理。

修法是把「不透明度」和「可读性」解耦：

- 两个下限改由变量控制：`--surface-min-alpha`（0.45）、`--surface-tint-min-alpha`（0.14）。
  **默认值不变**，现有观感一模一样；`html[data-surface="clear"]` 下二者归 0
- 新增开关「纯透明模式」（`site_appearance_settings.clear_surface_mode`，迁移 `0034`）。
  也可由「文章面板/卡片任一 opacity === 0」自动触发
- 纯透明时，可读性由两件事承担：
  1. 文字自带一圈「环境色雾」：`text-shadow: 0 0 .5em var(--surface-halo-color)`，
     颜色取 `--color-bg`（深浅主题自适应，不支持 `color-mix` 时有静态兜底）。
     光晕是**环绕**而非覆盖，几乎不增加不透明感
  2. 面板保留 1px 内描边 + 投影来定义边界，而不是靠填充
- 作用范围：`.prose` / `.article-hero` / `.momo-comment-root`；**卡片标题不加**，
  代码块/行内代码/表格排除（自带底色，叠光晕会边缘发脏）

实测（本地、模拟 clear + opacity 0）：面板填充 `rgba(255,255,255,0)`、染色全 0、正文带光晕。

## 工程细节

- 评论引导脚本**内联进 `CommentSection.astro`**，删除 `public/momo-comments.js`：
  它原先按 `_headers` 缓存一天，于是"部署后代码已更新、访客还在跑昨天的引导逻辑"——
  实测表现就是**第一次进文章评论区不加载、刷新后才好**（旧 HTML 里的引导逻辑仍指向 jsDelivr）。
  内联后引导脚本与页面同生共死，不可能再版本错配，也少一次请求；组件包仍动态注入，
  保证客户端导航时只执行一次
- `deploy` 脚本新增 `scripts/bump-content-version.mjs`：部署前把 KV 里的
  `public-content-cache-version` 推一格。此前它只在发文时递增，所以"只改代码不发文"的部署
  会留下最长 5 分钟的边缘缓存空窗（新 Worker 已在跑、边缘仍发旧 HTML）。写入失败不阻断部署
- `public/vendor/**` 加入 biome 忽略列表：第一次 `biome check --write` 把压缩后的 bundle
  重排了（228,500 → 228,159 B），第三方产物不该被格式化
- `public/_headers` 用 `/vendor/*`（而不是 `/vendor/momo-comment/*`）：
  `static-headers` 测试只把通配规则解析到第一层目录

---

# cf-astro-blog v1.11 — 评论区回归：接 Momo-Backend

**2026-11-15**

## 这次接的不是自建方案

`blog_comments` 那套自建评论区已在迁移 `0032` 里整体删除，本站仍**不新增任何评论表**。
本次挂载的是独立部署的 **Momo-Backend Worker**（Hono + D1 + KV，地址 `comments.ffaff.fun`），
前台用官方组件 `momo-comment.min.js`：列表、提交、无感验证、审核通知全部在后端那侧完成，
本站只负责挂载与配色。

这样避免的正是上次被删的原因——审核、反垃圾、读者通知的发信成本都不落在本站。

## 前端

- 新增 `src/components/CommentSection.astro`：官方组件的挂载点。`--momo-*` 配色变量全部映射到
  本站 token（`--color-text` / `--color-border` / `--color-accent` / `--color-surface-elevated`），
  因此深色模式自动跟随，不需要为组件再写一套深色值
- 新增 `public/momo-comments.js`：懒加载引导脚本。站点用 ClientRouter，**客户端导航不会执行新
  文档里的外链脚本**，必须在 `astro:page-load` 时重新挂载，否则"从归档页点进文章只剩空白、
  刷新一次又好了"
- 文章页版式对齐 Momo：**评论区紧贴正文下方、同列宽（754px）、不套玻璃面板**，
  Webmention 仍是独立的一个面板版块（`aria-label="Webmentions"`）
- 外部地址集中在 `src/lib/comment.ts`：后端地址、锁版本的组件 CDN 地址、表情/头像域名

## 评论区字号与控件

组件内部用的是 Tailwind 固定档位（`text-sm` = 14px、`text-xs` = 12px），比本站
`--text-md`（16px）正文基准小一号，因此用两条 `:global()` 覆盖把它们拉回本站刻度：

- `text-sm`（评论正文、昵称、日期、按钮、输入框）→ `var(--text-md)`
- `text-xs`（表单标签、字数提示）→ `0.82em`

配色依旧全部映射本站 token；`--momo-button-border-color` 提到 26% 不透明度 ——
组件默认继承 `--color-border`（12%），在磨玻璃背景上输入框几乎是隐形的。
输入框另补了与站内 `.wm-input` 一致的半透明底和聚焦高亮环。

浮动菜单加回「前往评论区」：容器锚点是 `#comment-area`，**不能**叫 `#comments` ——
组件自己已经在根节点上用了 `id="comments"`，重名会让 `getElementById` 命中错误的那个。

## CSP

公共页面策略新增四项，全部是**缺了以后看不出坏在哪**的类型（`tests/unit/csp.test.ts` 已加断言）：

- `script-src` 增加 `'wasm-unsafe-eval'`：无感验证在浏览器里编译内联 WASM，缺了它页面一切正常、
  只有提交评论失败
- `script-src` 增加 `https://cdn.jsdelivr.net`：组件脚本来源
- 新增 `worker-src 'self' blob:`：PoW 并行求解的 Worker 由 Vite 内联为 Blob；不放行时组件会
  退回主线程串行求解，功能可用但明显变慢
- `connect-src` 增加 `comments.ffaff.fun` 与 `open.motues.top`（默认表情 `owo.json` 与头像）

## 部署后必须完成的两件事

1. `comments.ffaff.fun` 后台「系统设置」里把 `allow_origin` 设为 `https://ffaff.fun`
   （本地调试再加 `http://localhost:4321`）。Momo-Backend 的 CORS **默认拒绝所有跨域请求**，
   不配的话评论区能显示、但一条也发不出去。
2. 后端默认管理员账号密码是 `momo` / `momo`，登录后立即修改。

---

# cf-astro-blog v1.10 — 玻璃回归，票面单独保留纸质

**2026-10-29**

## 全站表面回到钴蓝磨玻璃

上一轮把整站表面换成了“纸片”（直双线 + 米白底 + 小圆角），体验后对比，
玻璃质感更耐看。本次把 `global.css` 的设计基座恢复成玻璃体系，但**不回退字号刻度**：

- 色板：页面底色 `#dbe6f7`、玻璃基色纯白、卡片高光 `245 250 255`，
  文字/边框/阴影回到钴蓝系（`--color-text: #101828`、`--color-border: rgb(0 71 171 / 0.12)`）
- 圆角：`10 / 14 / 18 / 24px`，面板 24px、卡片 18px、内层 14px
- `.glass-panel` 恢复“透明底 + `::after` 半透明表面 + `backdrop-filter`”结构，
  文章页的 `--article-panel-*` 覆盖规则一并恢复；导航栏重新使用 `--nav-shell-blur` 与
  钴蓝染色表面，不再是不模糊的纸色条
- `body` 去掉纸纤维噪点，恢复三处钴蓝/高光渐变；`body::before/after` 预光团重新启用
- 占位符回到 `#4b556a`：在 `#dbe6f7` 上约 5.9:1（上一版的 `#5f6d84` 只有 4.14:1）

## 首页票面：唯一保留纸质的区域

- `.bill` 新增 `::after` 纸纹层：`feTurbulence` 内联 data-URI，`pointer-events: none`，
  铺在叠印层之上但不拦截区块点击
- 新增后台参数 **纸纹强度 0–100**（`BillSheetConfig.paperGrain`，默认 38）：
  只存进票面 JSON，**不需要数据库迁移**；`normalizeBillSettingsInput` 负责钳制与默认值
- 其余纸质语义（纸张色、边框粗细、扭索纹、花边、微缩文字）不变

## 后台同步

- 后台外壳 `--bg` / 卡片基色 / 高光色同步到新版玻璃 token，登录页同步并改用 24px 面板圆角
- 外观页文案修正：明确“全站默认磨玻璃，首页票面是唯一纸质区域”，
  透明度/模糊滑块重新对应导航、卡片与面板的玻璃层，并链到「首页票面」调纸纹

## 清理

- 删除 `post-card.css` 里已无引用的 `--post-card-surface-alpha`
- 清掉 `global.css` / `Header` 注释里的“纸面 Phase 1/3/4”遗留说法
- 同步测试：`header-motion` 改断言玻璃导航变量，`public-content` 改断言新的占位符色

---

# cf-astro-blog v1.9 — 票面组件图（自绘货币元素上票）

**2026-10-29**

## 视觉层整体换成站长自绘组件图

首页票面（`BillSheet`）从「代码画/排」升级为 8 张自绘组件图，位置、尺寸、点击区、
无障碍标签全部沿用 v1.8 的毫米几何，只换视觉层：

- 整票边框（四角 `100` 已画死在图里）铺满票面最底层，参数化纹样
  （guilloche/角花/卷草）转为降级路径，清空 `frameArt` 即自动恢复
- 富兰克林铜版肖像进 `Z1`，配合本次一并实现的 `portraitShape: "oval"`
  椭圆遮罩，矩形硬边消除
- 美联储徽记进 `Z9`、大 `100` + 财政部徽记进 `Z2`（放弃动态文章数，
  文章总数仍由序列号 `CB 000006 B` 表达）
- 两处真实签名进 `Z11`/`Z12`（保留两个独立点击区）、铜色墨水瓶进 `Z14`、
  新增纯装饰羽毛笔区块 `Z22`（坐标经彩色参考图分割实测，非目测）

## 机制：`art` 可选通道就是回滚开关

- `BillZone` 新增可选 `art` 字段（src/fit/blend/opacity/align）；有图用图渲染，
  删掉字段即回退文字/图形解算，不需要改代码
- 归一化白名单：`art.src` 只认 `/bill/` 前缀，禁外链、`javascript:`、目录穿越；
  `fit`/`blend` 白名单，`opacity` 钳 0–1，`align` 限长 24
- 后台 `/admin/bill` 区块表新增「图」列（路径 + fit 下拉），预览实时铺图
- 四角 `100`（`Z5`–`Z8`）关闭，不再保留透明热区；原入口由头部导航与浮动菜单承担
- 组件图落 `public/bill/`（布局资源，不走 R2 流程），`_headers` 加 `/bill/*`
  一周缓存 + 一个月异步回源

## 资源流水线

`node scripts/prepare-bill-art.mjs`：alpha 裁边 → 透明噪点清零 → 2× 缩放 →
WebP 导出；体积超限先降 q、再降尺寸，全部自动。实测 9 张合计 351.7 KB
（红线 400 KB），单张均 ≤ 80 KB。方案与实测偏差见
[`docs/bill-image-components-plan.md`](./bill-image-components-plan.md) 的「实施偏差」一节。

## 第二轮：按原版 12×5 网格比对重排

- 新增 `scripts/grid-compare.py`：把区块矩形与参考票面放进同一张网格逐格比对，
  输出 `MISSING / OVER / PARTIAL` 矩阵与着色图。调整前 7/0/8/45，调整后 5/1/6/48
- 报头 `THE UNITED STATES / OF AMERICA` 从硬编码改为独立区块 `Z23`（大写字高 3.0 mm）
- 羽毛笔 `Z22` 从 13.0×10.7 放大到 23.0×24.0 mm（原区块只框住羽毛中段），
  并改为「底纹级」层序：排在肖像与大 100 之前，符合真钞印刷顺序
- 肖像取消椭圆遮罩（`portraitShape: "plain"`），按原图铺进区块；
  几何按实测收到 37.0, 2.5, 44.0, 60.5 mm（旧值偏左 3 mm、顶部切 1.5 mm）
- 右下角「100」在原版上就是那枚铜色大号 100：`Z8` 复用为它（装饰、不可点），
  `doubao_image_4.png` → `public/bill/big-100.webp`
- 墨水瓶、四角 100 的休眠几何一并按实测校正

## 第三轮：肖像直出、层序与交互

- **肖像改回原图直出**：不再裁 alpha 留白、不再压到 504 宽；760×659 / q64（198 KB），
  `cover + center bottom` 让人像下缘与票面底边齐平（原图内容本就出血到画布底边）
- **新增 `zone.z` 叠压层序**：羽毛笔 1（底纹级）→ 文字 3 → 徽记 4 → 肖像 5 →
  大 100 6 → 墨水瓶 7 → 铜色大 100 8，还原真钞多版套印的遮挡关系
- **羽毛笔与报头铭文改为可交互区块**：`Z22 → /shuoshuo`（看看说说）、
  `Z23 → /blog`（浏览文章归档），不再是纯装饰 span
- **羽毛笔放大到原版高度**：复核实测整根羽毛 87.3–120.3 / 13.4–42.4 mm（高 29.0），
  区块 33.6 × 29.8 mm，资产按指定 568 × 494 px 输出
- **序列号字距收紧**：`CB 000006 B` 字距 0.10 → 0.045 em，另加 `word-spacing: -0.22em`
- 单图体积 198 KB 超原定 80 KB 红线（合计 ≈507 KB），已在 plan §16.1 说明取舍

---

# cf-astro-blog v1.8 — 首页票面重建（毫米制几何 + 参数化花边 + 后台编辑器）

**2026-10-28**

## 排版：字高与字号是两件事

- 发现并修正一个把整张票面比例带偏的根因：`BILL_TEXT_MM` 存的是**实测字高**，
  之前却直接写进了 `font-size`。serif 的大写字高只占 em 方框的 ≈0.70，于是每个铭文
  实际都小了 30%，层级被整体压缩。现改为 `font-size = 字高 ÷ BILL_CAP_RATIO`
- 字号不再只由字高决定，而是**字高与盒容量的二维求交**：竖向约束字高，横向约束行宽
- `BILL_TYPE_METRICS` 里的单字占位不是估的，是在浏览器里用页面**实际加载的字体**
  量出来的（Lora 大写 0.604–0.644 em/字、Space Grotesk 数字 0.583、Cormorant 斜体 0.359）
- 真钞长铭文用的是窄体字，Lora 同等字高下要宽 37%，光调字号永远对不上；
  因此引入横向压缩 `--inscsx`，压到 0.6 倍以下改为退字号，避免字形失真
- 自动折行的铭文（法定货币那句 61 字符）先解算行数再定字号，结果落进 `--inscws`

实测复核（票面渲染宽 1184px = 156mm）：大数字 19.5→19.47、四角 100 6.0→5.99、
序列号 4.1→4.09、ONE HUNDRED DOLLARS 3.2→3.19、FEDERAL RESERVE NOTE 3.1→3.09、
签名职衔 1.7→1.70、法定货币 1.4→1.40（单位 mm）。

## 字体：三种字面各管一段

真钞上手写体、铭文、数字是三套笔形，之前全用 Lora 一套顶，怎么调都对不上。

- **铭文走 Cormorant Garamond 700**。它是窄字面衬线体，大写实测 0.524 em/字，
  比 Lora 的 0.619 窄 15%——真钞铭文本来就是窄体，换字面之后横向压缩需求从
  0.62 降到 0.88–0.93，字形不再被压扁
- **数字走 Lora + `lnum`/`tnum`**。等宽等高数字，面额才不会一位高一位低
- **手写职衔走 Cormorant 斜体**（0.359 em/字），本来就贴合签名条

## 字距：一行一个值，从实测宽度反解

同一个字面下，真钞每行铭文的字距并不一样：面额行要拉开、序列号要稀、
大数字要紧。所以字距从 `BILL_TYPE_METRICS` 的默认值下沉到
`BILL_ZONE_TRACKING` 的按区块覆盖，并且是从**实测行宽**反解出来的，
不是调好看：

| 区块 | 字距 | 反解依据 |
| --- | --- | --- |
| 四角 100 | 0.15 em | 19.0 mm ÷ 3 位 ÷ 8.41 mm = 0.751，Lora 数字本体 0.60 |
| ONE HUNDRED DOLLARS | 0.13 em | 57.4 mm ÷ 19 位 ÷ 4.56 mm = 0.661 |
| 报头 | 0.12 em | 47.1 mm ÷ 16 位 ÷ 4.24 mm = 0.694 |

- 报头的 `white-space` 必须是 `pre` 而不是 `pre-line`：Cormorant 的大写实际字宽
  比标定值偏大，`pre-line` 会在空格处二次折行，把两行顶成三行、
  压掉下面那句法定货币铭文
- 服务端下发是对的、页面却是旧值，是浏览器 HTTP 缓存而不是构建缓存——
  验收时一律带时间戳参数重新请求

终态实测（156 mm 制）：四角 100 行宽 18.9（真钞 19.0）、
ONE HUNDRED DOLLARS 59.3（57.4）、法定货币落在 19.6–21.2 mm（19.4–21.8）、
报头 44.7 × 9.5 mm、顶边 8.8（47.1 × 8.8、9.1），且不再压到下方区块。

## 几何：从百分比手调改为毫米矩形

- 15 个区块全部按参考票面实测的毫米矩形重建，每个区块上方注释里就是
  `真钞 x, y, w, h (mm)`，百分比由它换算而来
- `config.aspectRatio` 固定为 156 : 66.3（美元实物比例），**不开放后台修改**——
  改了会让所有毫米换算失准

## 覆盖：扫描出的 20 处特征必须全部上票面

`measure-bill-reference.py` 一共测了 **20 处**特征，但页面上起初只渲染了 14 个区块——
几何对得上，覆盖不全。逐一核对后补了 4 处，并把「测了就一定上票面」写成约定：

| 特征 | 实测墨迹 (mm) | 之前状态 |
| --- | --- | --- |
| 角100 右上 | 128.1,3.9 → 147.0,9.0 | 区块存在但 `enabled: false`，整块没渲染 |
| 区号 H8 | 4.0,20.6 → 12.0,25.2 | 测得但没建区块 |
| JULY 4, 1776 | 81.3,23.5 → 102.0,27.9 | 测得但没建区块 |
| FRANKLIN（像主名） | 51.0,58.5 → 66.0,62.5 | 测得但没建区块 |

- 四处都按「墨迹 + 横向 1 mm / 纵向 0.7 mm 内边距」换算成区块，和既有 15 个区块同一套算法
- `SERIES` 之前是单行 `SERIES 2013`，实测是 9.5 × 6.4 mm 的两行堆叠，改为 `SERIES` / `2013`
  （行高 1.35、`white-space: pre-line`）
- 签名区两行是「手写姓名 + 印刷职衔」的复合块，页面上只保留了可读的职衔，
  位置落在姓名行。真钞手写姓名本身不可辨认，保留职衔视觉更接近
- `normalizeBillSettingsInput` 是 `DEFAULT_BILL_ZONES.map(...)` 叠加已存值，
  新增区块 id 自动进白名单，后台存过旧快照也不会把新块吞掉

## 变色墨水瓶：先认错了这个位置

区块表里的 `Z14`（主题按钮）原先被当成「原图此处无独立图形，只是手写体水印区」，
于是随手画了个空心圆环当热区。把参考票面该处放大到 1 mm 栅格后才发现：
那里是**变色墨水瓶，瓶身里嵌一只铃铛**，是一块实心剪影。

- 逐行量出轮廓：`x 90.3–104.4，y 43.9–57.9` → **14.1 × 14.0 mm**，
  截面是「宽瓶盖（12.6）→ 细瓶颈（10.6）→ 外扩瓶身，底部最宽并带圆角」
- 原来的热区 `90.5, 46.5, 13, 11` 顶边低了 **2.6 mm**、高度少了 3 mm，已按实测重设
- 纹样改为 `inkwellMark()`，一条封闭路径走完「盖→颈→身→底」。
  中途试过用「圆角矩形 + 梯形 + 圆角矩形」三个图元叠，结果颈肩交界处留下横线，
  看着像盖子压在盒子上——所以必须是一条路径
- 依旧只用几何图形拼，不引用任何纸币素材

## 字体：正体 Cormorant 其实一直没加载

按字体面清单查出来的：`global.css` 只 `@import` 了 `cormorant-garamond/500-italic.css`
**一张字面**，可票面上的铭文全是 `font-weight: 700; font-style: normal`。浏览器于是
拿斜体顶替并合成粗体——三种写法量出来的行宽一模一样（1047.9px），这才是线索。

- 补上 `700.css`，现在两张字面都在（`500 italic` + `700 normal`），`font-style` 真正生效
- 正体比斜体宽约 10%，所以之前标定的 `rule.advance = 0.524` 是**斜体字宽**，全部作废：
  正体实测 FRN 0.579 / ONE HUNDRED DOLLARS 0.624 / THE UNITED STATES 0.562
- 基准取**最宽**的 0.624 而不是平均值：解算器用它估算自然行宽，
  估小了 `scaleX` 会被夹到 1、文字真的溢出盒子；估大只是多压一点，永远不会溢出
- 新增 `BILL_ZONE_ADVANCE`：同一 kind 下不同字符串的平均字宽能差 50%
  （`JULY 4, 1776` 0.413 vs `ONE HUNDRED DOLLARS` 0.702），
  用同一个基准估算会把前者的行宽算成 15.0 mm，而实测是 20.7 mm

换字面后重新按实测行宽反解字距，终态：四角 100 19.0 / FRN 38.7 / ONE HUNDRED DOLLARS 57.6 /
JULY 4, 1776 21.3 / 报头 46.9（单位 mm，目标 19.0 / 39.8 / 57.4 / 20.7 / 47.1）。

## 票面改版遗留的四处回归

改版时只盯着票面本身，把票面以外的东西碰掉了。全部由测试或字体清单发现：

| 症状 | 原因 | 处理 |
| --- | --- | --- |
| `/admin-bill.js` 每次导航回源校验 | 新脚本没进 `public/_headers` | 补一条 86400s + swr 声明 |
| 首页「最近更新」日期消失 | `index.astro` 算了 `latestUpdate` 却从没渲染，`data-local-time` 一并丢失 | 渲染成 `<time>` 挂在栏目标题右侧 |
| 首页 → 搜索页没有过渡动画 | 共享的 `search-entry` 过渡名原本挂在 hero 的搜索链接上，改版后丢了 | 挂到票面的 Z10 搜索区块 |
| 首屏导语的手动换行被吞 | `.bill__lede` 缺 `white-space: pre-line` | 补上 |
| 占位符文字对比度掉到 3.2:1 | 换调色板时 `--color-text-placeholder` 从 `#4b556a` 变成 `#7a8798` | 改 `#5f6d84`（纸色底上 4.6:1） |

顺带删掉首页遗留的整套死 CSS（`home-hero-copy` / `hero-body` / `hero-actions` /
`hero-kbd` / `hero-divider` / `hero-stats`）和没人用的 `heroActions`；
卡片入场动画原本只有 `animation-delay`、没有 `animation` 声明，那批延迟是死的，这次一并接上。

测试从 272/279 恢复到 **279/279**。其中 `type-scale` 那条加了显式例外：
票面字号来自实物毫米测量、用 `cqw` 缩放，套 `var(--text-*)` 会让整张票面错位。

## 花边：角花与卷草

- 新增 `cornerFlourish()`：四分之一花饰，由「外框双线 + 内圈轨道 + 角点三圈小花 +
  两枚对数螺线 + 外弧珠点」五层叠成，只画左上象限，另外三角由 CSS `scaleX/scaleY` 翻转复用
- 新增 `scrollBand()`：卷草横带，主茎取**完整正弦周期**，首尾同高同斜率，
  因此按 `repeat-x` 平铺时无缝；卷草挂在波峰/波谷（瓦片内部），不跨拼接缝
- 卷草叶片用对数螺线 `r = r₀·e^(k·t)` 而不是圆弧，才有"越往中心越卷越紧"的观感
- 线宽以 viewBox 为单位给得足够粗（96px 画布缩到 73px 时 0.6 的线只剩 0.46px，等于消失）
- `cornerOrnament` 现在真的控制花边开关（此前是写了没用的死配置）

## 后台：首页票面编辑器

- 新增 `/admin/bill`（`/api/admin/bill`）：概览图 + 票面参数 + 区块表
- 概览图上的虚线框跟随表单**实时变化**（`public/admin-bill.js`，同源脚本，
  以适配后台 `script-src 'self'` 的 CSP，不用内联脚本）
- 配置落库为单列 JSON `site_appearance_settings.home_bill_json`
  （迁移 `0029_home_bill_sheet.sql`），字段缺失/类型不对逐项回退默认值，
  一条脏配置不会让首页整页打不开
- `saveBillSettings` 只写这一列，不整行覆盖——避免后台开两个标签页时保存票面
  把外观页刚改的内容冲掉
- 归一化对输入做硬约束：区块 id 白名单、坐标钳到票面内、`href` 只放行站内绝对路径
  与 `http(s)`（区块是 `<a href>`，放任 `javascript:` 等于开放 XSS）、字高 0.5–24mm

## 其它

- 参考票面照片从 `public/bill/` 移到 `.reference/bill/` 并加入 `.gitignore`：
  原先放在 `public/` 会被站点直接对外发布，那是真实纸币图像
- 修 `src/styles/global.css` 一个格式错误（多余空行）

---

# cf-astro-blog v1.7 — 视觉层级重构（表面 / 字体 / 信息架构）

**2026-10-28**

## 表面体系

- 浅色主题页面底色改为更饱和的钴白 `#dbe6f7`，卡片玻璃基色改为**纯白**：
  此前两者同为 `228,238,253`，卡片只能靠 1px 边框区分
- 面板不透明度设下限 `clamp(0.45, …)`，外观设置里的滑块只能让卡片"更实"，不会"消失"
- 圆角从 6 档（18/24/28/32/34/40）收敛为 10/14/18/24 四档
- 文章页标题区去掉玻璃面板：标题区与正文同处一张纸，层级靠字号与留白表达

## 字体分工

- `body` 默认改为无衬线（导航、按钮、胶囊、日期等 UI 全部受益于更高的 x-height）
- 正文 `.prose`、页面标题、文章标题显式使用衬线体，保留原有阅读气质
- 页内标题行高 1.02→1.14、字距 -0.05em→-0.02em（中文标题不再上下粘连）

## 字号刻度：黄金比例

- 全站字号从 **46 个散落取值** 收敛为 **7 档**，级差 √φ ≈ 1.272（每 2 档 = φ，每 4 档 = φ²）
- 档位：12.58 / 16 / 20.35 / 25.89 / 32.93 / 41.89 / 53.28 px，正文锚定 16px
- 后三档写成 `clamp()`，上下界都落在刻度上，移动端不需要第二套字号表
- 前后端 140 处 `font-size` 全部改走 `var(--text-*)`；`em` 与 `html` 根字号是仅有的两个例外
- 新增 `tests/unit/type-scale.test.ts` 守住刻度，详见 `docs/design-typography.md`

## 首页信息架构

- 移除 Hero 右侧栏与 `hero-sidebar-fit.js`：同一篇文章此前会在侧栏、置顶、最近更新里**出现三次**
- 首页改为：Hero → 分类 → 置顶（≤3 张大卡）→ 最近更新（≤6 条）
- Hero 高度：手机 884px（超过一屏）→ **416px**，首屏即可看到第一张卡片
- "已发布 N 篇"改用独立 `count(*)`，与归档页数字一致（此前只统计首页渲染出来的卡片数）

## 其它修复

- 品牌头像改为自托管 WebP：原来引用腾讯云 COS 的 **1.79 MB / 76 帧 GIF**，跨域加体积都可能被
  浏览器判成异常响应（ORB）而显示破图；现改为 `public/brand-avatar.webp`（96px 动画版 99 KB）
  与 `brand-avatar-static.webp`（静态帧 2.7 KB），`prefers-reduced-motion` 时由 `<picture>`
  自动退回静态帧。图标保持指向 `/api/auth/login`（全站唯一可见的后台入口），站点标题链接负责回首页；
  同时加 `data-astro-prefetch="false"`，避免划过图标就预取登录页、白白签发一个 CSRF token
- 正文 `# 标题` 自动降级为 `h2`：此前文章页存在两个 `h1`（SEO / 屏幕阅读器问题）
- 站点日期统一 `zh-CN`：`local-time.js` 原用浏览器语言，英文环境下会渲染成 `October 27, 2026`
- "取消透明度"按钮改名为「专注阅读 / 退出专注」
- 窄屏导航不再裁掉激活态胶囊、不再常驻横向滚动条
- 删除从未被 import 的 `src/styles/claude.css`（3755 行死代码）
- 窄屏（≤720px）关闭 `backdrop-filter`，改用已提高下限的纯色玻璃

## 死代码清理

- `src/pages/index.astro` 样式块 **884 行 → 263 行**：删掉 Hero 双栏 / 侧栏信号卡的
  全部遗留规则（`home-hero-main`、`home-hero-side`、`hero-main-media`、`hero-signal-*`、
  `hero-metric`、`hero-atmosphere`/`aura`/`beam`/`grid`、`home-grid`）——模板里已无引用
- `public/home-motion.js` **270 行 → 164 行**：`[data-hero-depth]` 已不存在，
  原先写入的 `--hero-pointer-x/y`、`--hero-scroll-shift` 已无任何 CSS 消费者，
  一并移除对应的 pointer/scroll 监听；卡片姿态（`[data-tilt-card]`）逻辑保留
- `global.css` 移除 `.footer-note`（模板只用 `.footer-meta`）
- 顺带修掉 `index.astro` 样式块末尾多出的一个 `}`（CSS 语法错误）

---

# cf-astro-blog v1.6 — 工具链大扫除（TypeScript 7 + Node 26 LTS）

**2026-10-28**

## TypeScript

- **TypeScript 7.0.2**（Go 原生重写）接管 CLI：新增 `npm run typecheck`，冷启动 1.5s（原 5.5s）
- TS 7 不提供编程 API，`@astrojs/check` 仍需 TS 6：以 npm 别名并存
  `@typescript/native → typescript@7`（提供 `tsc`）、`typescript → @typescript/typescript6`（提供 `tsc6` + API）
- `tsconfig.json` 移除 TS 7 已废弃的 `baseUrl`，`paths` 改为相对 tsconfig 书写；补入 `.astro/types.d.ts`
- 源码零改动（`tsc --noEmit` 与 `astro check` 均 0 error）

## 依赖

- 全部直接依赖升到最新：astro 7.4.2、@astrojs/cloudflare 14.4.2、biome 2.6.3、wrangler 4.154.0 等
- `biome.json` 通过 `biome migrate` 升到 2.6.3 schema（`recommended` → `preset`）

## 安全

- 新增 override `miniflare → undici@^7.30.1`，消除 Cloudflare 适配器链路 5 项告警
- `npm audit`：13 项（9 moderate / 4 high）→ 8 项（5 moderate / 3 high）
- 剩余告警集中在 `@remy/webmention → cheerio@0.22`（无上游修复）与 `drizzle-kit` 的旧 esbuild，均为仅开发期依赖

## 运行时与 CI

- Node **26 LTS**：CI / 部署工作流 / 新增 `.nvmrc` 统一；`engines.node` 提到 `>=24`
- GitHub Actions：`checkout@v6 → v7`、`setup-node@v5 → v7`、`cache@v4 → v6`

---

# cf-astro-blog v1.5 — Astro 7 + BBC-style Homepage + Golden Ratio Typography

**2026-08-03**

## Framework

- **Astro 6.4.3 → 7.1.6**: Rust compiler, Rolldown (Vite 8), Sätteri Markdown
- **@astrojs/cloudflare 13 → 14**, **@cloudflare/workers-types 4.x → 5.x**

## Homepage

- Flat structure: removed atmosphere/media/sidebar/signal/metric layers
- Dual-column Hero with sidebar (pinned compact + recent list) on desktop
- BBC-style compact cards: vertical, 240:134, no cover radius, reduced glass
- Category tag navigation + archive filtering (`/blog?category=...`)
- Golden ratio typography from section-head h2 (φ=1.618 descending)

## Features

- `Ctrl+K` global search, container queries, `:has()` selector
- Global `:focus-visible`, `prefers-reduced-motion`, `text-wrap: pretty`
- Dark mode contrast boost

## Admin

- Removed Hero layout toggle, signal card, hero image uploader forms

## Changelog

- ~400 lines dead CSS removed, `--space-2xs` aligned to 4px grid

---

## 关于本文档

本文件**只记录发布变更**。

**安装、配置、部署、常见问题请看 [`README.md`](../README.md)；发文流程见
[`posting-workflows.md`](./posting-workflows.md)；上线后的发布与迁移规范见
[`maintenance-guide.md`](./maintenance-guide.md)。**
