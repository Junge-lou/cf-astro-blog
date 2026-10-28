#!/usr/bin/env python
"""参考票面精确测量工具。

用途
----
把 `.reference/bill/` 里的纸币照片归一化到「10 px/mm、156 × 66.3 mm」的
标准画布，再逐个铭文测出墨迹包围盒（mm），输出可直接写进
`src/lib/bill-config.ts` 的矩形。

为什么不用简单的暗像素包围盒
--------------------------
纸币的雕版底纹本身也接近纯黑，直接取「暗像素 bbox」会得到一个填满窗口的
结果。这里用了三件事才把字和底纹分开：

  1. 透视归一化：照片有轻微倾斜与透视，先 warp 成标准矩形，否则 mm 换算带系统误差
  2. 局部 Otsu：每个窗口单独求阈值，适应金/绿/黑三种油墨的亮度差异
  3. 形态学开运算：雕版线条只有 1–2 px 宽，文字笔画 3–6 px，
     一次 3×3 开运算就能把细线磨掉而保住文字

用法
----
    py scripts/measure-bill-reference.py                # 只打印测量表
    py scripts/measure-bill-reference.py --overlay out.png   # 另存核对图
"""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent

# 测量对象是 prepare-bill-reference.py 输出的规范图：
# 已转正、已裁到票面、已是 10 px/mm 的 156 × 66.3 mm 横版。
REFERENCE = ROOT / ".reference" / "bill" / "reference-landscape.png"

# 美元纸币实物尺寸
NOTE_W_MM = 156.0
NOTE_H_MM = 66.3


@dataclass
class Feature:
    """一个待测铭文。"""

    name: str
    zone: str | None
    #: 宽松搜索窗口 (x0, y0, x1, y1)，单位 mm
    window: tuple[float, float, float, float]
    #: 期望行数；用于校验测到的是不是一整块
    rows: int = 1
    #: 开运算核大小。粗体数字用 5 才能磨掉花边的细线；
    #: 小字用 1（=不做开运算），否则 2 px 的笔画会被整个磨掉
    open_ksize: int = 1


FEATURES: list[Feature] = [
    Feature("角100 左上", "Z5", (5.0, 3.0, 24.0, 9.0), open_ksize=5),
    Feature("角100 右上", "Z6", (126.5, 3.0, 147.0, 9.0), open_ksize=5),
    Feature("角100 左下", "Z7", (5.0, 54.5, 24.0, 63.0), open_ksize=5),
    Feature("角100 右下", "Z8", (124.0, 51.5, 145.0, 61.0), open_ksize=5),
    Feature("FEDERAL RESERVE NOTE", "Z4", (6.0, 9.0, 47.0, 13.2)),
    Feature("序列号（上）", "Z3", (5.5, 14.5, 43.0, 21.0)),
    Feature("区号 H8", None, (4.0, 20.5, 14.0, 26.0)),
    Feature("ONE HUNDRED DOLLARS（上）", "Z10", (68.5, 2.0, 127.0, 7.5)),
    Feature("THE UNITED STATES OF AMERICA", None, (77.0, 9.0, 127.0, 18.0), rows=2),
    Feature("THIS NOTE IS LEGAL TENDER", "Z16", (88.0, 18.0, 120.0, 23.0), rows=2),
    Feature("JULY 4, 1776", None, (81.0, 23.5, 102.0, 28.0)),
    Feature("序列号（右）", "Z15", (105.0, 45.0, 147.0, 49.8)),
    Feature("SERIES 2009", None, (106.5, 50.0, 116.0, 56.5), rows=3),
    Feature("签名1 姓名", "Z11", (5.5, 41.5, 33.0, 46.5)),
    Feature("签名1 职衔", None, (9.0, 46.5, 30.0, 49.5)),
    Feature("签名2 姓名", "Z12", (5.5, 48.5, 32.0, 52.5)),
    Feature("签名2 职衔", None, (6.5, 52.5, 28.0, 55.5)),
    Feature("FRANKLIN", None, (51.0, 58.5, 66.0, 62.5)),
    Feature("大数字 100（金）", "Z2", (109.0, 21.0, 136.0, 43.5), open_ksize=5),
    Feature("联邦储备徽记", "Z9", (15.0, 22.5, 38.0, 42.5)),
    # 羽毛笔：真钞上斜倚在墨水瓶上方、"States of America" 铭文带附近，
    # 墨迹很淡且与铭文交叠，窗口故意放宽，结果需对照 overlay 人工核对
    Feature("羽毛笔", "Z22", (99.0, 24.0, 114.0, 36.0)),
]


def load_normalized(path: Path) -> tuple[np.ndarray, float]:
    """读入参考图，返回 (灰度图, 每毫米像素数)。

    如果传入的是 `prepare-bill-reference.py` 已经规范化的图（比例对、宽度够），
    直接按比例算出 px/mm 就用——再归一化一次只会引入二次缩放误差。
    其它情况（原始照片）才走「去斜 + 裁剪 + 缩放」的完整流程。

    这里刻意不用 `minAreaRect` + `warpPerspective`：四角点序一旦判错就会
    得到 90° 旋转的结果（实测过，整张票面被转成竖版），而点序又很难可靠判定。
    改用「按顶边斜率旋转 + 轴向裁剪」，方向天然不会错。
    """
    raw = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if raw is None:
        raise SystemExit(f"读不到参考图：{path}")

    gray = cv2.cvtColor(raw, cv2.COLOR_BGR2GRAY)

    # 已经是规范图：直接用
    ratio = gray.shape[1] / gray.shape[0]
    if abs(ratio - NOTE_W_MM / NOTE_H_MM) < 0.02 and gray.shape[1] >= 1000:
        px_per_mm = gray.shape[1] / NOTE_W_MM
        return gray, px_per_mm

    # 背景是黑的，票面是亮的
    mask = (gray > 55).astype(np.uint8)
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((7, 7), np.uint8))

    # ① 用票面顶边拟合斜率，消掉轻微倾斜
    cols = range(gray.shape[1] // 10, gray.shape[1] * 9 // 10, 3)
    xs: list[int] = []
    ys: list[int] = []
    for x in cols:
        column = np.where(mask[:, x] > 0)[0]
        if column.size:
            xs.append(x)
            ys.append(int(column[0]))
    if len(xs) > 10:
        slope, _ = np.polyfit(np.array(xs, dtype=np.float64), np.array(ys, dtype=np.float64), 1)
        angle = float(np.degrees(np.arctan(slope)))
        if abs(angle) > 0.05:
            h, w = gray.shape
            matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
            gray = cv2.warpAffine(
                gray, matrix, (w, h), flags=cv2.INTER_CUBIC, borderValue=0
            )
            mask = (gray > 55).astype(np.uint8)

    # ② 轴向裁剪到票面外接矩形
    rows_any = np.where(mask.any(axis=1))[0]
    cols_any = np.where(mask.any(axis=0))[0]
    crop = gray[rows_any[0] : rows_any[-1] + 1, cols_any[0] : cols_any[-1] + 1]

    # ③ 缩放到 10 px/mm 的标准画布
    px_per_mm = 10.0
    out_w = int(round(NOTE_W_MM * px_per_mm))
    out_h = int(round(NOTE_H_MM * px_per_mm))
    flat = cv2.resize(crop, (out_w, out_h), interpolation=cv2.INTER_AREA)
    return flat, px_per_mm


def measure(
    flat: np.ndarray, px_per_mm: float, feature: Feature, open_ksize: int = 3
) -> dict | None:
    """在窗口内测墨迹包围盒（mm）。"""
    x0, y0, x1, y1 = feature.window
    sx, ex = int(x0 * px_per_mm), int(x1 * px_per_mm)
    sy, ey = int(y0 * px_per_mm), int(y1 * px_per_mm)
    win = flat[sy:ey, sx:ex]
    if win.size == 0:
        return None

    # 局部 Otsu：适应黑色 / 金色 / 绿色三种油墨
    thresh, _ = cv2.threshold(win, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    ink = (win < thresh).astype(np.uint8) * 255

    # 开运算磨掉 1–2 px 的雕版细线，只留文字笔画。
    # 但 10 px/mm 下小字的笔画也只有 2 px —— 一开就没了，所以小字传 1 直接跳过。
    if open_ksize <= 1:
        thick = ink
    else:
        kernel = np.ones((open_ksize, open_ksize), np.uint8)
        thick = cv2.morphologyEx(ink, cv2.MORPH_OPEN, kernel)

    if cv2.countNonZero(thick) == 0:
        return None

    # 用「列/行墨量剖面」而不是裸包围盒。
    # 列方向：花边是细线，每一列只贡献几个墨像素；粗体数字贡献几十个。
    #          按峰值的 18% 设门限就能把竖向花边排除。
    # 行方向：不能用门限——一行字的字顶/字底本来就只有少量墨（圆弧端点），
    #          门限一高就会把字压矮（实测 FRN 被压成 1.9 mm，真值约 2.9）。
    #          改用「墨量加权分位数」：取承载 96% 墨量的行区间。
    #          这既排除掉零星几个像素的花边，又不会削掉字的上下端。
    cols = (thick > 0).sum(axis=0)
    rows = (thick > 0).sum(axis=1)
    col_gate = max(2.0, float(cols.max()) * 0.18)

    xs = np.where(cols >= col_gate)[0]
    if xs.size == 0:
        return None

    row_weights = rows.astype(np.float64)
    if row_weights.sum() <= 0:
        return None
    row_positions = np.arange(row_weights.size)
    y_lo = int(np.searchsorted(np.cumsum(row_weights), row_weights.sum() * 0.01))
    y_hi = int(np.searchsorted(np.cumsum(row_weights), row_weights.sum() * 0.99))
    y_lo = min(y_lo, row_positions[-1])
    y_hi = min(max(y_hi, y_lo), row_positions[-1])
    ys = np.array([y_lo, y_hi])

    # 行带数量：用于判断窗口里到底是几行字
    gate = max(rows.max() * 0.15, 1)
    bands = 0
    inside = False
    for value in rows:
        if value >= gate and not inside:
            bands += 1
            inside = True
        elif value < gate:
            inside = False

    saturated = (
        xs[0] <= 2
        and ys[0] <= 2
        and (win.shape[1] - 1 - xs[-1]) <= 2
        and (win.shape[0] - 1 - ys[-1]) <= 2
    )

    return {
        "name": feature.name,
        "zone": feature.zone,
        "x0": round(float(sx + xs[0]) / px_per_mm, 2),
        "y0": round(float(sy + ys[0]) / px_per_mm, 2),
        "x1": round(float(sx + xs[-1] + 1) / px_per_mm, 2),
        "y1": round(float(sy + ys[-1] + 1) / px_per_mm, 2),
        "bands": int(bands),
        "expected_rows": feature.rows,
        "saturated": bool(saturated),
        "otsu": round(float(thresh), 1),
    }


def draw_overlay(
    flat: np.ndarray,
    px_per_mm: float,
    results: list[dict],
    out: Path,
    zones: list[dict] | None = None,
) -> None:
    canvas = cv2.cvtColor(flat, cv2.COLOR_GRAY2BGR)
    h, w = canvas.shape[:2]

    for mm in range(0, int(NOTE_W_MM) + 1, 5):
        x = int(mm * px_per_mm)
        color = (0, 0, 255) if mm % 20 == 0 else (170, 170, 255)
        cv2.line(canvas, (x, 0), (x, h - 1), color, 1)
    for mm in range(0, int(NOTE_H_MM) + 1, 5):
        y = int(mm * px_per_mm)
        color = (255, 0, 0) if mm % 20 == 0 else (220, 200, 170)
        cv2.line(canvas, (0, y), (w - 1, y), color, 1)

    # 青色 = 当前配置里的区块框；绿色 = 实测墨迹；品红 = 测量无效
    for zone in zones or []:
        p0 = (int(zone["x0"] * px_per_mm), int(zone["y0"] * px_per_mm))
        p1 = (int(zone["x1"] * px_per_mm), int(zone["y1"] * px_per_mm))
        cv2.rectangle(canvas, p0, p1, (200, 200, 0), 1)
        cv2.putText(
            canvas,
            zone["id"],
            (p0[0] + 2, p1[1] - 4),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.45,
            (200, 200, 0),
            1,
            cv2.LINE_AA,
        )

    for item in results:
        p0 = (int(item["x0"] * px_per_mm), int(item["y0"] * px_per_mm))
        p1 = (int(item["x1"] * px_per_mm), int(item["y1"] * px_per_mm))
        color = (0, 200, 0) if not item["saturated"] else (255, 0, 255)
        cv2.rectangle(canvas, p0, p1, color, 2)
        label = item["zone"] or item["name"][:6]
        cv2.putText(
            canvas,
            label,
            (p0[0] + 3, p0[1] + 16),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            color,
            1,
            cv2.LINE_AA,
        )

    cv2.imwrite(str(out), canvas)


def main() -> int:
    parser = argparse.ArgumentParser(description="测量参考票面的铭文位置")
    parser.add_argument("--overlay", type=Path, help="输出核对图路径")
    parser.add_argument("--json", type=Path, help="输出测量结果 JSON")
    parser.add_argument("--zones", type=Path, help="区块几何 JSON（由 export-bill-zones.ts 导出）")
    parser.add_argument("--open", type=int, default=3, help="开运算核大小，默认 3")
    args = parser.parse_args()

    flat, px_per_mm = load_normalized(REFERENCE)

    results: list[dict] = []
    print(f"{'元素':<32}{'区块':<6}{'x0':>7}{'y0':>7}{'x1':>7}{'y1':>7}{'宽':>7}{'高':>6}{'行':>4}  状态")
    print("-" * 100)
    for feature in FEATURES:
        item = measure(flat, px_per_mm, feature, feature.open_ksize)
        if item is None:
            print(f"{feature.name:<32}{feature.zone or '—':<6}{'':>44}  未找到墨迹")
            continue
        results.append(item)
        width = item["x1"] - item["x0"]
        height = item["y1"] - item["y0"]
        status = []
        if item["saturated"]:
            status.append("窗口饱和")
        if item["bands"] != item["expected_rows"]:
            status.append(f"行数 {item['bands']}/{item['expected_rows']}")
        print(
            f"{item['name']:<32}{item['zone'] or '—':<6}"
            f"{item['x0']:>7.1f}{item['y0']:>7.1f}{item['x1']:>7.1f}{item['y1']:>7.1f}"
            f"{width:>7.1f}{height:>6.1f}{item['bands']:>4}  {' '.join(status) or 'ok'}"
        )

    if args.overlay:
        zones = None
        if args.zones and args.zones.exists():
            zones = json.loads(args.zones.read_text(encoding="utf-8"))
        draw_overlay(flat, px_per_mm, results, args.overlay, zones)
        print(f"\n核对图已写入 {args.overlay}")

    if args.json:
        args.json.write_text(json.dumps(results, ensure_ascii=False, indent=2), encoding="utf-8")
        print(f"测量结果已写入 {args.json}")

    return 0


if __name__ == "__main__":
    sys.exit(main())
