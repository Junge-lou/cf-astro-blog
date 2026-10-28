#!/usr/bin/env python
"""把参考纸币照片转正、裁到票面、统一到 10 px/mm 的标准横版。

为什么单独一步
--------------
测量脚本要的是「156 × 66.3 mm 的横向票面」。原始素材可能：
  - 是竖版（手机竖着拍），需要转 90°
  - 背景是白纸也可能是深色桌面，不能用固定阈值当蒙版
  - 票面有轻微旋转，不纠正的话 mm 换算会带系统误差

这一步把上面的问题一次性处理掉，输出一张规范的 `reference-landscape.png`，
后续测量脚本只认这张，保证可复现。

用法
----
    py scripts/prepare-bill-reference.py
    py scripts/prepare-bill-reference.py --source .reference/bill/2.webp --debug
"""

from __future__ import annotations

import argparse
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SOURCE = ROOT / ".reference" / "bill" / "2.webp"
DEFAULT_OUT = ROOT / ".reference" / "bill" / "reference-landscape.png"

NOTE_W_MM = 156.0
NOTE_H_MM = 66.3
TARGET_PX_PER_MM = 10.0


def note_mask(image: np.ndarray) -> np.ndarray:
    """票面蒙版。

    不假设背景是黑还是白——先取四条外边框的中位色当作背景色，
    再把「和背景色差得够远」的像素算作票面。这样深色桌面和白纸都能用。
    """
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    band = max(2, min(h, w) // 100)

    ring = np.concatenate(
        [
            gray[:band, :].ravel(),
            gray[-band:, :].ravel(),
            gray[:, :band].ravel(),
            gray[:, -band:].ravel(),
        ]
    )
    background = float(np.median(ring))

    # 票面既可能比背景亮（白纸/深桌面），也可能比背景暗（浅桌面），取绝对差
    diff = np.abs(gray.astype(np.int16) - background)
    mask = (diff > 28).astype(np.uint8)

    # 闭运算补上票面内部的浅色区域（防伪线、大面积浅底）
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, np.ones((11, 11), np.uint8))
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))

    # 只保留最大连通域，去掉桌面杂物
    count, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if count <= 1:
        raise SystemExit("找不到票面：整张图与背景同色")
    largest = 1 + int(np.argmax(stats[1:, cv2.CC_STAT_AREA]))
    return (labels == largest).astype(np.uint8)


def deskew(gray: np.ndarray, mask: np.ndarray) -> tuple[np.ndarray, float]:
    """按票面顶边斜率做一次仿射旋转，返回 (图像, 角度)。"""
    h, w = gray.shape
    cols = range(w // 10, w * 9 // 10, 3)
    xs: list[int] = []
    ys: list[int] = []
    for x in cols:
        column = np.where(mask[:, x] > 0)[0]
        if column.size:
            xs.append(x)
            ys.append(int(column[0]))

    if len(xs) < 10:
        return gray, 0.0

    slope, _ = np.polyfit(
        np.array(xs, dtype=np.float64), np.array(ys, dtype=np.float64), 1
    )
    angle = float(np.degrees(np.arctan(slope)))
    if abs(angle) < 0.05:
        return gray, 0.0

    matrix = cv2.getRotationMatrix2D((w / 2, h / 2), angle, 1.0)
    rotated = cv2.warpAffine(
        gray, matrix, (w, h), flags=cv2.INTER_CUBIC, borderValue=int(np.median(gray[:5, :]))
    )
    return rotated, angle


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", type=Path, default=DEFAULT_SOURCE)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    parser.add_argument("--debug", action="store_true")
    args = parser.parse_args()

    image = cv2.imread(str(args.source), cv2.IMREAD_COLOR)
    if image is None:
        raise SystemExit(f"读不到 {args.source}")

    h, w = image.shape[:2]
    print(f"源图 {w} × {h}  （比例 {w / h:.3f}）")

    # 竖版就转 90°。票面实际是横的，转完长边应当变宽。
    # 实测：`2.webp` 顺时针转会得到倒置的票面，逆时针才是正的。
    rotated = False
    if h > w:
        image = cv2.rotate(image, cv2.ROTATE_90_COUNTERCLOCKWISE)
        rotated = True
        h, w = image.shape[:2]
        print(f"已逆时针旋转 90° → {w} × {h}  （比例 {w / h:.3f}）")

    mask = note_mask(image)
    rows = np.where(mask.any(axis=1))[0]
    cols = np.where(mask.any(axis=0))[0]
    if rows.size == 0:
        raise SystemExit("蒙版为空")

    crop_mask = mask[rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1]
    gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY)[
        rows[0] : rows[-1] + 1, cols[0] : cols[-1] + 1
    ]
    ch, cw = gray.shape
    print(f"票面框 {cw} × {ch}  px  比例 {cw / ch:.3f}  （目标 {NOTE_W_MM / NOTE_H_MM:.3f}）")

    gray, angle = deskew(gray, crop_mask)
    if angle:
        print(f"去斜 {angle:+.2f}°")

    # 重新取一次外接矩形（旋转后可能多出边界）
    mask2 = (np.abs(gray.astype(np.int16) - np.median(gray[:3, :])) > 28).astype(np.uint8)
    rows2 = np.where(mask2.any(axis=1))[0]
    cols2 = np.where(mask2.any(axis=0))[0]
    gray = gray[rows2[0] : rows2[-1] + 1, cols2[0] : cols2[-1] + 1]

    out_w = int(round(NOTE_W_MM * TARGET_PX_PER_MM))
    out_h = int(round(NOTE_H_MM * TARGET_PX_PER_MM))
    flat = cv2.resize(gray, (out_w, out_h), interpolation=cv2.INTER_AREA)

    args.out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(args.out), flat)
    print(f"已输出 {args.out.relative_to(ROOT)}  {out_w} × {out_h}  @ {TARGET_PX_PER_MM:g} px/mm")

    if args.debug:
        debug_path = args.out.with_name("_prepare-debug.png")
        cv2.imwrite(str(debug_path), cv2.resize(mask * 255, (out_w, out_h)))
        print(f"蒙版 {debug_path.relative_to(ROOT)}")

    # 方向自检：顶部细、底部厚通常是上部留白 + 下部签名区
    top_ink = float(flat[: flat.shape[0] // 8, :].mean())
    bottom_ink = float(flat[-flat.shape[0] // 8 :, :].mean())
    print(f"方向自检：上缘均亮 {top_ink:.0f} / 下缘均亮 {bottom_ink:.0f}（旋转过={rotated}）")


if __name__ == "__main__":
    main()
