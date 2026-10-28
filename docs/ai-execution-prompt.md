# 交给执行方 AI 的任务提示词（票面组件图改造）

> 用法：把本文件**全文**复制给执行方 AI。它包含背景、已定决策、实施步骤、
> 质量闸门与本项目的环境坑，应当可以独立开工，不需要再补充上下文。

---

## 你的角色

你是这个仓库的高级前端工程师。任务是把首页票面（`BillSheet`）里由代码「画」或「排」
出来的元素，换成站长自绘的组件图，让票面更接近真实美元纸币。
**位置、尺寸、点击区、无障碍标签全部沿用现有毫米几何**，只替换视觉层。

先读这三份文档，再动手：

1. `docs/bill-image-components-plan.md` —— 本次任务的实施方案（**主文档**）
2. `docs/design-banknote-plan.md` —— 设计规范，注意 §0.6 已标注的红线变更
3. `docs/maintenance-guide.md` §9 —— 上线后换图流程（你要实现的正是它描述的能力）

---

## 项目背景（必须先理解）

- **Astro 7 SSR**，部署在 Cloudflare Workers，`output: "server"`
- 数据库 D1 + Drizzle，迁移在 `drizzle/`；票面配置存在
  `site_appearance_settings.home_bill_json` 单列里
- 质量闸门：`astro check` + `tsc --noEmit` + `biome check src public tests scripts` + `npm test`
- **当前基线**：`npm test` 279/279 通过，`astro build` 通过，`astro check` 0 error。
  你的改动结束时必须维持这个状态，不能引入新的失败。
- 票面坐标系是**毫米制**：票面实物 156 × 66.3 mm，区块几何存百分比，
  `1mm = 100/156 cqw`。字号不是「排版层级」，是从实物量出来的毫米值，
  所以 `type-scale` 测试给 `BillSheet.astro` 开了例外。

### 票面当前的 18 个区块

| 区块 | 位置 x,y (mm) | 尺寸 w×h | kind | 现在显示 |
| --- | --- | --- | --- | --- |
| Z1 | 34.0, 4.0 | 46.0×58.0 | portrait | 头像图 |
| Z2 | 110.0, 23.2 | 26.0×19.0 | denomination | 文字（文章数） |
| Z3 | 6.1, 14.2 | 36.3×6.0 | serial | `CB 000006 B` |
| Z4 | 6.2, 8.6 | 41.8×6.0 | rule | `FEDERAL RESERVE NOTE` |
| Z5 | 4.0, 2.4 | 21.0×7.4 | denomination | `100` |
| Z6 | 127.1, 3.3 | 20.9×6.9 | denomination | `100` |
| Z7 | 4.0, 55.6 | 21.0×8.2 | denomination | `100` |
| Z8 | 123.0, 52.2 | 23.0×8.9 | denomination | `100` |
| Z9 | 17.0, 23.4 | 21.0×18.6 | seal | 原创同心环 + 首字母 |
| Z10 | 67.5, 1.2 | 59.4×7.3 | rule | `ONE HUNDRED DOLLARS` |
| Z11 | 6.3, 42.3 | 22.6×6.4 | signature | `Secretary of the Treasury` |
| Z12 | 6.3, 48.8 | 24.0×6.4 | signature | `Treasurer of the United States` |
| Z14 | 90.1, 43.7 | 14.1×14.4 | marker | 参数化 SVG 墨水瓶 |
| Z15 | 104.0, 44.0 | 42.6×6.8 | serial | `CB 000006 B` |
| Z16 | 87.6, 17.8 | 30.6×5.2 | rule | `THIS NOTE IS LEGAL TENDER…` |
| Z17 | 3.0, 20.4 | 10.0×5.5 | serial | `H8` |
| Z18 | 80.3, 23.2 | 22.7×5.4 | rule | `JULY 4, 1776` |
| Z21 | 50.0, 58.0 | 17.0×5.2 | rule | `FRANKLIN` |

`BillSheet.astro` 有 4 种渲染器：`portrait` / `seal` / `marker` / 其余走文本解算器。
**不要为每种图新增 `kind`**，只加一个可选 `art` 通道即可。

---

## 已定决策（不可推翻）

1. **允许使用真实货币元素**（富兰克林肖像、美联储徽记、整票边框、真实签名、羽毛笔）。
   这条此前是项目红线，已于 2026-10-29 由站长破例。
2. **四角 `100` 不再可点** → `Z5`/`Z6`/`Z7`/`Z8` 置 `enabled: false`，
   视觉由整票边框图承担。**不要**为它们保留透明热区。
3. **`Z2` 使用 `doubao_image_5.png`，放弃动态文章数**。
   删掉 `resolve()` 里 Z2 返回 `String(totalPosts).padStart(2, "0")` 的特例。
   文章总数仍由序列号 `CB 000006 B` 表达，信息不丢。
4. 图片资源可以从 `.reference/zujian2/` 移入仓库。

---

## 四个待定项：已按建议定稿，按此执行

> 如果你（执行方 AI）觉得某项必须改，先停下来说明理由，不要自行变更。

1. **`Z11`/`Z12` 保留两个独立点击区**，各自仍指向原目标。
   用 `fit: "cover"` + `align: "center top"`：源图是正方形画布、
   签名只占上方 1/3，下方全是透明区，`cover` 裁掉的正好是空白。
   **不要**把两块合并成一个跳转。
2. **羽毛笔坐标必须先测量，禁止目测**。在
   `scripts/measure-bill-reference.py` 的 `FEATURES` 里加一条
   `Feature("羽毛笔", "Z22", (<窗口 mm>))`，然后跑：

   ```bash
   py scripts/measure-bill-reference.py --json .reference/bill/measured.json \
       --overlay .reference/bill/measured-overlay.png
   ```

   参考图 `.reference/bill/reference-landscape.png`（1560×663 @ 10 px/mm）已在位，
   可直接用；若缺失先跑 `py scripts/prepare-bill-reference.py` 从 `2.webp` 重新生成。
   拿到墨迹矩形后，按「墨迹 + 横向 1.0mm / 纵向 0.7mm 内边距」换算成区块。
   本项目已经吃过一次「以为那里没东西」的亏（`Z14` 墨水瓶位置错 2.6mm）。
3. **旧的参数化纹样保留不删**：`guillocheTile()` / `cornerFlourish()` / `scrollBand()`
   在换上边框图后不再渲染，但要作为 `cornerOrnament` 开关的降级路径留着
   （边框图加载失败时仍是一张完整票面）。
4. **`portraitShape` 椭圆遮罩本次一并实现**。它现在是死配置（类型、默认值、
   归一化都有，渲染里一处没用），正好用来消除 `Z1` 的矩形硬边。

---

## 资源清单

源目录 `.reference/zujian2/`（在 `.gitignore` 里，不会发布）：

| 文件 | 尺寸 | 内容 | 目标 |
| --- | --- | --- | --- |
| `边框.png` | 2352×992 | 整票边框，**四角 100 已画死** | 票面背景 |
| `头像.png` | 1374×1191 | 富兰克林铜版肖像 | `Z1` |
| `doubao_image_5.png` | 1745×1344 | 大 `100` + 财政部徽记 | `Z2` |
| `doubao_image_6.png` | 1566×1599 | 美联储徽记 | `Z9` |
| `doubao_image_1.png` | 2173×1088 | 两组「手写签名 + 印刷职衔」，左右各一 | `Z11` 取左半、`Z12` 取右半 |
| `Layer 5.png` | 166×158 | 铜色墨水瓶剪影 | `Z14` |
| `doubao_image_7.png` | 1632×1567 | 铜版羽毛笔 | 新增 `Z22` |

八张都带 alpha 通道、四角无白底，可直接使用。

**处理流水线**（写一个 `scripts/prepare-bill-art.mjs`）：

1. 保留 alpha
2. **按 alpha 边界裁掉透明留白**（不裁会导致 `contain` 后画面明显偏小）
3. 缩到 **2× 显示尺寸**
4. 导出 WebP q85
5. 输出到 `public/bill/`

2× 目标尺寸（按票面渲染宽 1184px、7.59 px/mm 换算）：

| 用途 | 2× 输出 |
| --- | --- |
| 整票边框 | 2400 × 1020 |
| `Z1` 肖像 | 720 × 900 |
| `Z2` 大 `100` | 420 × 300 |
| `Z9` 徽记 | 340 × 300 |
| `Z11` 签名 1 | 360 × 110 |
| `Z12` 签名 2 | 380 × 110 |
| `Z14` 墨水瓶 | 230 × 230 |
| `Z22` 羽毛笔 | 按测量结果算 |

体积上限：单张 ≤ 80 KB，全部组件图合计 ≤ 400 KB。

---

## 实施步骤

### Phase A —— 打通渲染通路

1. `src/lib/bill-config.ts` 新增：

```ts
export interface BillZoneArt {
 /** 站内绝对路径，必须以 / 开头 */
 src: string;
 /** 默认 contain */
 fit?: "contain" | "cover" | "fill";
 /** 默认 multiply：凹版印刷是墨压纸 */
 blend?: "normal" | "multiply";
 /** 0–1，默认 1 */
 opacity?: number;
 /** object-position，默认 "center" */
 align?: string;
}
```

`BillZone` 加可选字段 `art?: BillZoneArt`。

1. `src/components/bill/BillSheet.astro`：`inner` 分支最前面加 `art` 判断，
   渲染 `<span class="bill__art"><img src alt="" …></span>`。
   外层已有 `aria-label`，图片 `alt` 必须为空字符串，不要重复播报。
   图片不参与文本解算（`BILL_TEXT_MM` / `BILL_ZONE_ADVANCE` / `BILL_ZONE_TRACKING` 对它无效，
   但**不要删这些常量**——它们是回退路径）。

2. **验收**：先只把 `Z14` 换成 `Layer 5.png`，确认位置、大小、点击都正常，再往下走。

### Phase B —— 资源处理

按上面的流水线生成 `public/bill/*.webp`。
`public/_headers` 增加：

```
/bill/*
  Cache-Control: public, max-age=604800, stale-while-revalidate=2592000
```

**注意**：`tests/unit/static-headers.test.ts` 只校验 `public/*.js` 脚本，
图片不在闸门内，所以这条规则只能手动加、靠人守住。

### Phase C —— 逐块替换

按 `.reference/zujian2/` 清单逐块加 `art`。每换一块就验证一次位置，不要一次全上。

### Phase D —— 整票边框 + 关闭四角

1. `边框.png` → `public/bill/frame.webp`，作为票面最底层（`fit: "fill"`，
   比例 2.37 vs 2.353，横向差 0.7% 可以接受）。
2. `Z5`–`Z8` 置 `enabled: false`。
3. 边框图存在时，不再渲染 `guillocheTile` / `cornerFlourish` / `scrollBand`，
   但代码保留（见待定项 3）。

### Phase E —— 羽毛笔 `Z22`

先测量、后建块（见待定项 2）。纯装饰：`href: ""`、不渲染成 `<a>`。

### Phase F —— 后台与测试

1. `src/lib/bill-settings.ts`：`normalizeBillSettingsInput` 校验 `art`：
   - `src` 必须以 `/bill/` 开头，不得含 `..`，不得以 `//` 开头
   - `fit` / `blend` 走白名单，非法值回落默认
   - `opacity` 钳到 0–1，`align` 限长 24
   - `art` 无有效 `src` 时整体丢弃 → 自动回退文本渲染
2. `src/admin/views/bill.ts`：区块表加「图」一列（路径输入 + fit 下拉）
3. `public/admin-bill.js`：预览同步新字段
4. 新增 `tests/unit/bill-art.test.ts`：
   - 每个 `art.src` 都能在 `public/` 下找到真实文件（防 404）
   - `art.src` 必须是 `/bill/` 前缀且不含 `..`
   - 归一化脏输入：`javascript:` 路径、`fit: "hack"`、`opacity: 9` 全部被纠正

---

## 质量闸门

全部必须通过：

```
npx astro build           # 必须 Complete
npx astro check           # 0 errors
npx tsc --noEmit          # 无输出即通过
npm test                  # 279 + 新增，全部 pass
npx biome check src public tests scripts   # 不得新增问题
```

> `biome check` 有**既有**问题（`public/diagram-render.js`、`public/admin.js`、
> `src/styles/global.css` 的 `noImportantStyles` / `noDescendingSpecificity` 等），
> 它们与本次任务无关，**不要去动**，只要不新增即可。

视觉验收（逐块核对，与 `docs/bill-image-components-plan.md` 的替换表对齐）：

- [ ] 1184px 下 8 张图全部落位
- [ ] 四角 `100` 来自边框图，且点击无响应（`Z5–Z8` 不在无障碍树）
- [ ] `Z2` 与 `Z9` 的叠压顺序与真钞一致
- [ ] 组件图总体积 ≤ 400 KB
- [ ] 暗色主题下图片不发灰（`multiply` 在深底会失效，需目视确认并必要时改 `normal`）

---

## 环境坑（这些是踩过的，别再踩）

1. **Python 命令是 `py`，不是 `python`**。
2. **改了模板看不到变化** → 先删 `.wrangler/state/v3/cache` 再重启 dev server。
   `?adminPreview=1` 这类 query 不在缓存键里，加参数没用。
3. **浏览器 HTTP 缓存**会骗你：验证服务端输出时请带 `?cb=<timestamp>` 重新请求。
4. **不要直接改 `dist/`**，那是构建产物。
5. **测量渲染尺寸别用 `getBoundingClientRect()`**：带 `transform: scaleX()` 的元素
   宽度不可信。用 `element.offsetWidth`（不含 transform）再乘 `--inscsx`。
6. **大写字高 ≠ `font-size`**：`font-size = capHeight / BILL_CAP_RATIO`（0.7）。
7. **`transition:name` 是 Astro 编译期指令，不能通过 spread 传**，必须字面写在模板里。
8. **图片必须移出 `.reference/`**，那里被 `.gitignore` 掉了，不会发布。
9. 除整票边框外，**不要用 `fill`**（会变形）；只用 `contain` / `cover`。
10. 票面几何改了就同步改区块注释里的毫米值，那是唯一可信的溯源。
11. **跑单个测试文件必须用 `npx tsx --test <file>`**，不能用 `node --test`：
    部分测试直接 import 了 `src/db/schema` 等 TS 路径，`node` 会报
    `ERR_MODULE_NOT_FOUND`，看起来像代码坏了，其实只是跑错命令。
12. 本环境的**浏览器截图不稳定**（视口是真的 `673 CSS px`，`setViewportSize` 不生效，
    元素截图容易超时）。验证版式优先用 DOM 测量（`offsetWidth` / `getComputedStyle`），
    必要时给 `.bill` 注入一个固定宽度再截图。

---

## 完成定义

- 上面「质量闸门」全绿
- `docs/bill-image-components-plan.md` 顶部状态改为「已实现」，并补一节记录实际偏差
- `docs/release-notes.md` 新增 v1.9 条目（当前顶部只有一条「计划中」占位，替换掉它）
- 交付时给出一张逐块的「目标 vs 实际」尺寸对照表

## 禁止事项

- 不要 `git commit` / `git push`，也不要改分支
- 不要顺手重构与本任务无关的代码
- 不要在没测量的情况下写死任何区块坐标
- 不要删除回退路径（`art` 可选性、旧的文字解算常量、参数化纹样）
