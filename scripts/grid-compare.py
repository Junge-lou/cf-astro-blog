#!/usr/bin/env python
"""票面「区块划分」与「原版美元参考图」的 12×5 网格对比。

用途
----
把 `src/lib/bill-config.ts` 里 `DEFAULT_BILL_ZONES` 的矩形（百分比 → 毫米）
与参考票面（`.reference/bill/reference-color.png`，10 px/mm）放在同一张
12 列 × 5 行 的网格上逐格比对，回答两个问题：

  1. 哪些格子参考图有内容、页面却没有区块盖住（MISSING）
  2. 哪些格子页面有区块、参考图却是空白（OVER）

输出：`.reference/bill/grid-diff.json` / `grid-diff.png` + stdout 的 markdown 表格。

为什么这么定阈值
----------------
* **暗像素阈值 = Otsu**。整票是凹版印刷，纸面与墨线之间是双峰分布，
  Otsu 在参考图上稳定给出 127；往下压会丢掉金色/铜色油墨（灰度 140–160），
  往上抬又会把纸纹算成墨。用「图自适应」而不是硬编码，换一张参考图也不会失效。
* **三档不用分位点，用分布里的断层**。参考图没有真正的「零墨」格子——雕版
  底纹本身就有 10% 左右的暗像素。先把 60 个格值的分位数打出来（p25 ≈ 0.17、
  p75 ≈ 0.46），但 p25 恰好切在「一行细铭文」的中间：R2C1–R2C3 密 0.13–0.16，
  那上面是序列号和 H8 区号，真的印着字，按 p25 会被判成「稀疏 → 区块白占」，
  结论正好反了。真正可分的断层在 0.09–0.13 之间（≤0.09 是右上白纸 0.01、
  票面左缘 0.08；≥0.13 全都至少有一行铭文），所以稀疏上限取 0.10；
  密集下限取 p75 = 0.46（上半区是肖像、大 100、边框这类实心内容）。
  分位数照样打印并写进 JSON 的 meta，阈值可复核、可用 CLI 覆盖。
* **覆盖率阈值**（任务给定）：<0.10 视为「没盖到」，>0.50 视为「整格占满」，
  <0.35 视为「盖到了但偏小/偏位」。

用法
----
    py -3.14 scripts/grid-compare.py

注意：必须显式指定 `-3.14`。本机裸 `py` 会按 shebang 落到一个没有 cv2 的
managed python 上，直接 ModuleNotFoundError。
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass, field
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent

REFERENCE = ROOT / ".reference" / "bill" / "reference-color.png"
# 灰度版与彩色版同尺寸、同几何，只在需要交叉核对时用
REFERENCE_GRAY = ROOT / ".reference" / "bill" / "reference-landscape.png"
CONFIG = ROOT / "src" / "lib" / "bill-config.ts"
OUT_JSON = ROOT / ".reference" / "bill" / "grid-diff.json"
OUT_PNG = ROOT / ".reference" / "bill" / "grid-diff.png"

# 美元纸币实物尺寸；参考图恰好 10 px/mm
NOTE_W_MM = 156.0
NOTE_H_MM = 66.3
PX_PER_MM = 10.0

# 网格默认 12 × 5：每格 13.0 × 13.26 mm，正好贴近各区块的最小尺寸
# （角面额 21×8 mm 会被切成 2 格，大 100 26×19 mm 覆盖 2×2 格）
GRID_COLS = 12
GRID_ROWS = 5

# 三档阈值（暗像素占比）。
#
# 不能直接用四分位：p25 = 0.165 正好切在「一行细铭文」的中间——R2C1–R2C3
# 密 0.13–0.16，那上面是序列号与 H8 区号，真的印着字，按 p25 会被判成
# 「稀疏→区块白占」，结论直接反了。
# 把 60 个格值排序列出来看，真正的断层在 0.09 和 0.13 之间：
#   ≤0.09：右上白纸（0.01）、票面左缘（0.08）、100 与印章之间的留白（0.05）
#   ≥0.13：全都是至少一行铭文/花纹
# 所以稀疏上限取 0.10（落在断层里），密集下限取 p75 = 0.46（四分位上半区
# 是肖像、大 100、边框这类实心内容）。两个数都可以用 CLI 覆盖。
SPARSE_MAX = 0.10
DENSE_MIN = 0.46

# 覆盖率阈值（任务给定）
COV_MISSING = 0.10
COV_FULL = 0.50
COV_PARTIAL_CAP = 0.35

# 区块级「落在空白区」的判据。
#
# 为什么是 0.06 而不是「跟格子一样取 p25」：
# 区块矩形通常只套住一行字，字的笔画是细线，平均暗墨量天然比格子低得多。
# 实测：Z4（FEDERAL RESERVE NOTE 深蓝粗体）0.21，Z18（JULY 4, 1776，金色细笔）
# 只有 0.09，Z22（羽毛笔）0.02 —— 前两个都有货，把它们判成「空白」会得出
# 「把 JULY 4 1776 挪到印章上」这种荒唐结论。参考图里真正的白纸区（右上
# 130–143 / 30–40 mm）是 0.08，而一整个区块平均下来低于 0.06，意味着
# 连纸面雕版底纹都不到 —— 那才是「这块基本是空纸」。
ZONE_EMPTY_DENSITY = 0.06
# 偏淡区：整块平均低于此值说明字形很细或油墨浅（Z18 金色细笔 0.09、
# Z11 手写签名 0.16），不是位置错——这类区块只提示、不给平移建议。
ZONE_FAINT_DENSITY = 0.16

# 区块级方向建议：不看「挪到哪墨最多」（那样一定会指到印章、肖像这种实心块上），
# 只看四邻域带子的墨量对比，回答「内容在区块的哪一侧」。
NEIGHBOR_MIN_GAIN = 2.0


@dataclass
class Zone:
    id: str
    kind: str
    x0: float
    y0: float
    x1: float
    y1: float
    enabled: bool

    @property
    def rect_mm(self) -> tuple[float, float, float, float]:
        return (self.x0, self.y0, self.x1, self.y1)


@dataclass
class Cell:
    row: int
    col: int
    x0: float
    y0: float
    x1: float
    y1: float
    density: float = 0.0
    tier: str = ""
    coverage: float = 0.0
    flag: str = ""


@dataclass
class ZoneVerdict:
    zone: Zone
    density: float
    tier: str
    neighbors: dict[str, float] = field(default_factory=dict)
    suggestion: str = ""


def strip_comments(text: str) -> str:
    """去掉 `//` 行注释。

    区块的注释里写满了「墨迹 5.0–24.0 / 3.0–8.6 mm → 区块 4.0, 2.4」这种
    带数字的坐标说明，不先剥掉的话解析器会把它们当成字段。本文件没有
    字符串里含 `//` 的情况（链接都是 `/xxx` 开头），行内切分是安全的。
    """
    out = []
    for line in text.splitlines():
        cut = line.find("//")
        out.append(line[:cut] if cut >= 0 else line)
    return "\n".join(out)


def load_zones(path: Path) -> list[Zone]:
    """从 TS 源码里抠出 DEFAULT_BILL_ZONES 数组。

    不调 tsx / node 是刻意的：这个脚本要能在只有 Python 的环境里复核几何，
    而数组结构非常规整（每项都是扁平的对象字面量），手写解析 40 行就够。
    """
    text = strip_comments(path.read_text(encoding="utf-8"))
    start = text.index("DEFAULT_BILL_ZONES")
    # 跳过类型注解里的 `BillZone[]`，从赋值号之后的 `[` 起算
    start = text.index("=", start) + 1
    start = text.index("[", start)
    depth = 0
    end = -1
    for index in range(start, len(text)):
        char = text[index]
        if char == "[":
            depth += 1
        elif char == "]":
            depth -= 1
            if depth == 0:
                end = index
                break
    if end < 0:
        raise SystemExit("解析 DEFAULT_BILL_ZONES 失败：数组没有闭合")

    body = text[start + 1 : end]

    # 逐个顶层对象切出来
    objects: list[str] = []
    depth = 0
    current: list[str] = []
    for char in body:
        if char == "{":
            depth += 1
        if depth > 0:
            current.append(char)
        if char == "}":
            depth -= 1
            if depth == 0:
                objects.append("".join(current))
                current = []

    zones: list[Zone] = []
    for obj in objects:
        fields = parse_object_fields(obj)
        if "id" not in fields or "x" not in fields:
            continue
        try:
            zones.append(
                Zone(
                    id=fields["id"].strip('"'),
                    kind=fields.get("kind", '""').strip('"'),
                    x0=float(fields["x"]) / 100.0 * NOTE_W_MM,
                    y0=float(fields["y"]) / 100.0 * NOTE_H_MM,
                    x1=(float(fields["x"]) + float(fields["w"])) / 100.0 * NOTE_W_MM,
                    y1=(float(fields["y"]) + float(fields["h"])) / 100.0 * NOTE_H_MM,
                    enabled=fields.get("enabled", "false").strip() == "true",
                )
            )
        except (KeyError, ValueError) as exc:
            raise SystemExit(f"区块解析失败：{obj[:60]}… ({exc})") from exc
    return zones


def parse_object_fields(obj: str) -> dict[str, str]:
    """取对象字面量的第一层 key: value，跳过 `art: { ... }` 这类嵌套。"""
    fields: dict[str, str] = {}
    depth = 0
    index = 0
    length = len(obj)
    while index < length:
        char = obj[index]
        if char in "{[":
            depth += 1
            index += 1
            continue
        if char in "}]":
            depth -= 1
            index += 1
            continue
        if depth == 1:
            match = re.match(r"([A-Za-z_][A-Za-z0-9_]*)\s*:", obj[index:])
            if match:
                key = match.group(1)
                value_start = index + match.end()
                cursor = value_start
                inner = 0
                while cursor < length:
                    now = obj[cursor]
                    if now in "{[":
                        inner += 1
                    elif now in "}]":
                        inner -= 1
                        if inner < 0:
                            break
                    elif now == "," and inner == 0:
                        break
                    cursor += 1
                fields[key] = obj[value_start:cursor].strip()
                index = cursor
                continue
        index += 1
    return fields


def load_reference(path: Path) -> tuple[np.ndarray, np.ndarray]:
    """返回 (彩色图, 灰度图)。"""
    color = cv2.imread(str(path), cv2.IMREAD_COLOR)
    if color is None:
        raise SystemExit(f"读不到参考图：{path}")
    gray = cv2.cvtColor(color, cv2.COLOR_BGR2GRAY)
    return color, gray


def ink_mask(gray: np.ndarray) -> tuple[np.ndarray, float]:
    """暗像素掩膜；阈值由 Otsu 现算，返回 (mask, 阈值)。"""
    threshold, _ = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    return (gray < threshold).astype(np.uint8), float(threshold)


def cell_bounds(rows: int, cols: int, width: int, height: int) -> list[list[Cell]]:
    grid: list[list[Cell]] = []
    for row in range(rows):
        line: list[Cell] = []
        y0 = int(round(row * height / rows))
        y1 = int(round((row + 1) * height / rows))
        for col in range(cols):
            x0 = int(round(col * width / cols))
            x1 = int(round((col + 1) * width / cols))
            line.append(
                Cell(
                    row=row,
                    col=col,
                    x0=x0 / PX_PER_MM,
                    y0=y0 / PX_PER_MM,
                    x1=x1 / PX_PER_MM,
                    y1=y1 / PX_PER_MM,
                )
            )
        grid.append(line)
    return grid


def zone_coverage(zones: list[Zone], width: int, height: int) -> np.ndarray:
    """把所有 enabled 区块栅格化成掩膜（亚像素：1/16 px。单纯取整会让
    长方形边界整体内缩 0.5 px，13 mm 的格子会因此少算 1% 覆盖率）。"""
    mask = np.zeros((height, width), np.uint8)
    for zone in zones:
        if not zone.enabled:
            continue
        pts = np.array(
            [
                [zone.x0, zone.y0],
                [zone.x1, zone.y0],
                [zone.x1, zone.y1],
                [zone.x0, zone.y1],
            ],
            dtype=np.float64,
        )
        cv2.fillPoly(
            mask,
            [np.round(pts * PX_PER_MM * 16).astype(np.int32)],
            1,
            lineType=cv2.LINE_8,
            shift=4,
        )
    return mask


def rect_mean(integral: np.ndarray, x0: float, y0: float, x1: float, y1: float) -> float:
    """积分图求矩形内均值；坐标单位 mm。"""
    height = integral.shape[0] - 1
    width = integral.shape[1] - 1
    sx = int(round(max(0.0, min(NOTE_W_MM, x0)) * PX_PER_MM))
    ex = int(round(max(0.0, min(NOTE_W_MM, x1)) * PX_PER_MM))
    sy = int(round(max(0.0, min(NOTE_H_MM, y0)) * PX_PER_MM))
    ey = int(round(max(0.0, min(NOTE_H_MM, y1)) * PX_PER_MM))
    sx, ex = min(sx, width - 1), min(ex, width)
    sy, ey = min(sy, height - 1), min(ey, height)
    if ex <= sx or ey <= sy:
        return 0.0
    total = integral[ey, ex] - integral[sy, ex] - integral[ey, sx] + integral[sy, sx]
    return float(total) / float((ex - sx) * (ey - sy))


def classify_tiers(cells: list[Cell], sparse_max: float, dense_min: float) -> None:
    for cell in cells:
        if cell.density <= sparse_max:
            cell.tier = "稀疏"
        elif cell.density >= dense_min:
            cell.tier = "密集"
        else:
            cell.tier = "中等"


def flag_cells(cells: list[Cell]) -> None:
    for cell in cells:
        has_content = cell.tier in ("密集", "中等")
        if has_content and cell.coverage < COV_MISSING:
            cell.flag = "MISSING"
        elif cell.tier == "稀疏" and cell.coverage > COV_FULL:
            cell.flag = "OVER"
        elif has_content and cell.coverage < COV_PARTIAL_CAP:
            cell.flag = "PARTIAL"
        else:
            cell.flag = "OK"


def neighbor_density(integral: np.ndarray, zone: Zone) -> dict[str, float]:
    """四邻域带子的墨量（左/右/上/下 → 密度）。

    每个带子的尺寸等于区块自身，紧贴区块外侧，裁到票面内。这样得到的结论是
    「内容在区块的哪一侧」而不是「挪到全票最黑的地方」——后者对任何区块都会
    指向印章/肖像，毫无指导意义。
    """
    width = zone.x1 - zone.x0
    height = zone.y1 - zone.y0
    sides = {
        "左": (zone.x0 - width, zone.y0, zone.x0, zone.y1),
        "右": (zone.x1, zone.y0, zone.x1 + width, zone.y1),
        "上": (zone.x0, zone.y0 - height, zone.x1, zone.y0),
        "下": (zone.x0, zone.y1, zone.x1, zone.y1 + height),
    }
    return {
        name: rect_mean(integral, *rect)
        for name, rect in sides.items()
        if rect[2] > rect[0] + 0.5 and rect[3] > rect[1] + 0.5
    }


def judge_zones(zones: list[Zone], integral: np.ndarray, faint_cut: float) -> list[ZoneVerdict]:
    verdicts: list[ZoneVerdict] = []
    for zone in zones:
        if not zone.enabled:
            continue
        density = rect_mean(integral, *zone.rect_mm)
        verdict = ZoneVerdict(zone=zone, density=density, tier="")
        verdict.neighbors = neighbor_density(integral, zone)

        if density >= faint_cut:
            verdict.tier = "有内容"
            verdict.suggestion = "保持"
        elif density >= ZONE_EMPTY_DENSITY:
            verdict.tier = "偏淡"
            verdict.suggestion = "保持；笔画细或油墨浅，墨量低不等于位置错"
        else:
            verdict.tier = "空白"
            hot = [(name, value) for name, value in verdict.neighbors.items()
                   if value >= max(NEIGHBOR_MIN_GAIN * density, ZONE_EMPTY_DENSITY)]
            hot.sort(key=lambda item: -item[1])
            if not hot:
                verdict.suggestion = "四周同样空，区块贴着纸面空白，建议缩小或删除"
            else:
                hint = "、".join(f"{name}侧 {value:.2f}" for name, value in hot[:2])
                # 相邻侧的高墨量多半属于别人的元素（印章、铭文带），
                # 直接说「往那边挪」会把人带到别人的位置上
                verdict.suggestion = (
                    f"整块几乎无墨（{density:.3f}）；{hint} 是邻近元素的墨，"
                    "不建议平移，先确认这里该不该有内容"
                )
        verdicts.append(verdict)
    return verdicts


def draw_overlay(
    color: np.ndarray,
    grid: list[list[Cell]],
    zones: list[Zone],
    out: Path,
    scale: float,
) -> None:
    height, width = color.shape[:2]
    canvas = cv2.resize(
        color, (int(width * scale), int(height * scale)), interpolation=cv2.INTER_CUBIC
    )

    palette = {
        "MISSING": (0, 0, 235),  # BGR 红
        "OVER": (235, 90, 0),  # BGR 蓝
        "PARTIAL": (0, 205, 235),  # BGR 黄
    }

    # 差异着色：半透明填充，底下的雕版细节要还能看清
    tint = canvas.copy()
    for line in grid:
        for cell in line:
            if cell.flag not in palette:
                continue
            p0 = (int(cell.x0 * PX_PER_MM * scale), int(cell.y0 * PX_PER_MM * scale))
            p1 = (int(cell.x1 * PX_PER_MM * scale), int(cell.y1 * PX_PER_MM * scale))
            cv2.rectangle(tint, p0, p1, palette[cell.flag], -1)
    cv2.addWeighted(tint, 0.42, canvas, 0.58, 0, dst=canvas)

    # 网格线
    line_color = (60, 60, 60)
    for line in grid:
        for cell in line:
            p0 = (int(cell.x0 * PX_PER_MM * scale), int(cell.y0 * PX_PER_MM * scale))
            p1 = (int(cell.x1 * PX_PER_MM * scale), int(cell.y1 * PX_PER_MM * scale))
            cv2.rectangle(canvas, p0, p1, line_color, 1, cv2.LINE_AA)

    # 当前区块框（青色），用来直观看「框和内容对不对得上」
    for zone in zones:
        if not zone.enabled:
            continue
        p0 = (int(zone.x0 * PX_PER_MM * scale), int(zone.y0 * PX_PER_MM * scale))
        p1 = (int(zone.x1 * PX_PER_MM * scale), int(zone.y1 * PX_PER_MM * scale))
        cv2.rectangle(canvas, p0, p1, (255, 255, 0), 1, cv2.LINE_AA)
        cv2.putText(
            canvas,
            zone.id,
            (p0[0] + 2, p0[1] + int(13 * scale)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.42 * scale,
            (255, 255, 0),
            1,
            cv2.LINE_AA,
        )

    # 格内标注覆盖率（两位小数）。全部格子都标，否则没法逐格复核；
    # 用「左上角小色块」而不是把字压在画面中央——中央正是肖像、铭文所在，
    # 白字描边在雕版底纹上会糊成一片，色块能保证任何底色下都可读。
    for line in grid:
        for cell in line:
            flagged = cell.flag in palette
            text = f"{cell.coverage:.2f}"
            size = (0.46 if flagged else 0.40) * scale
            thickness = 2 if flagged else 1
            (tw, th), baseline = cv2.getTextSize(text, cv2.FONT_HERSHEY_SIMPLEX, size, thickness)
            x = int(cell.x0 * PX_PER_MM * scale) + int(4 * scale)
            y = int(cell.y0 * PX_PER_MM * scale) + int(4 * scale)
            pad = int(3 * scale)
            cv2.rectangle(
                canvas,
                (x - pad, y - pad),
                (x + tw + pad, y + th + baseline + pad),
                palette[cell.flag] if flagged else (245, 245, 245),
                -1,
            )
            if not flagged:
                cv2.rectangle(
                    canvas,
                    (x - pad, y - pad),
                    (x + tw + pad, y + th + baseline + pad),
                    (150, 150, 150),
                    1,
                    cv2.LINE_AA,
                )
            cv2.putText(
                canvas,
                text,
                (x, y + th),
                cv2.FONT_HERSHEY_SIMPLEX,
                size,
                (255, 255, 255) if flagged else (70, 70, 70),
                thickness,
                cv2.LINE_AA,
            )

    # 图例条：单独加一条底边，避免压住票面
    legend_h = int(118 * scale)
    frame = np.full((canvas.shape[0] + legend_h, canvas.shape[1], 3), 245, np.uint8)
    frame[: canvas.shape[0]] = canvas

    base_y = canvas.shape[0]
    cv2.putText(
        frame,
        f"12x5 grid  cell {NOTE_W_MM / GRID_COLS:.1f} x {NOTE_H_MM / GRID_ROWS:.2f} mm"
        f"   fill = page zone coverage; cyan box = enabled zone",
        (int(10 * scale), base_y + int(26 * scale)),
        cv2.FONT_HERSHEY_SIMPLEX,
        0.5 * scale,
        (40, 40, 40),
        1,
        cv2.LINE_AA,
    )
    legend = [
        ("MISSING", "ref has content, coverage < 0.10  -> zone missing"),
        ("OVER", "ref is blank, coverage > 0.50  -> zone wasted"),
        ("PARTIAL", "covered but coverage < 0.35  -> too small / misaligned"),
    ]
    for index, (flag, note) in enumerate(legend):
        y = base_y + int((52 + index * 22) * scale)
        cv2.rectangle(
            frame,
            (int(10 * scale), y - int(9 * scale)),
            (int(30 * scale), y + int(5 * scale)),
            palette[flag],
            -1,
        )
        cv2.putText(
            frame,
            f"{flag}: {note}",
            (int(38 * scale), y + int(4 * scale)),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.46 * scale,
            (40, 40, 40),
            1,
            cv2.LINE_AA,
        )

    out.parent.mkdir(parents=True, exist_ok=True)
    cv2.imwrite(str(out), frame)


def print_markdown(cells: list[Cell]) -> None:
    print("| 格 | mm 范围 | 参考档 | 覆盖率 | 标记 |")
    print("| --- | --- | --- | --- | --- |")
    for cell in cells:
        span = f"{cell.x0:.1f}–{cell.x1:.1f} / {cell.y0:.1f}–{cell.y1:.1f}"
        print(
            f"| R{cell.row + 1}C{cell.col + 1} | {span} | {cell.tier} "
            f"({cell.density:.2f}) | {cell.coverage:.2f} | {cell.flag} |"
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="12×5 网格对比：参考票面 vs 页面区块")
    parser.add_argument("--cols", type=int, default=GRID_COLS)
    parser.add_argument("--rows", type=int, default=GRID_ROWS)
    parser.add_argument("--sparse-at", type=float, default=SPARSE_MAX, help="稀疏档上限（暗像素占比）")
    parser.add_argument("--dense-at", type=float, default=DENSE_MIN, help="密集档下限（暗像素占比）")
    parser.add_argument("--scale", type=float, default=1.5, help="输出图放大倍数")
    parser.add_argument("--json", type=Path, default=OUT_JSON)
    parser.add_argument("--png", type=Path, default=OUT_PNG)
    args = parser.parse_args()

    color, gray = load_reference(REFERENCE)
    height, width = gray.shape
    mask, threshold = ink_mask(gray)

    # 灰度版应当在同尺寸、同几何；不一致说明其中一张被重新导出过，
    # 这时 mm 换算会整体错位，先喊出来
    if REFERENCE_GRAY.exists():
        twin = cv2.imread(str(REFERENCE_GRAY), cv2.IMREAD_GRAYSCALE)
        if twin is not None and twin.shape != gray.shape:
            print(f"警告：{REFERENCE_GRAY.name} 尺寸 {twin.shape[1]}×{twin.shape[0]} "
                  f"与 {REFERENCE.name} {width}×{height} 不一致")

    zones = load_zones(CONFIG)
    enabled = [zone for zone in zones if zone.enabled]

    grid = cell_bounds(args.rows, args.cols, width, height)
    flat = [cell for line in grid for cell in line]

    for cell in flat:
        sy, ey = int(round(cell.y0 * PX_PER_MM)), int(round(cell.y1 * PX_PER_MM))
        sx, ex = int(round(cell.x0 * PX_PER_MM)), int(round(cell.x1 * PX_PER_MM))
        cell.density = float(mask[sy:ey, sx:ex].mean())

    classify_tiers(flat, args.sparse_at, args.dense_at)

    coverage_mask = zone_coverage(zones, width, height)
    for cell in flat:
        sy, ey = int(round(cell.y0 * PX_PER_MM)), int(round(cell.y1 * PX_PER_MM))
        sx, ex = int(round(cell.x0 * PX_PER_MM)), int(round(cell.x1 * PX_PER_MM))
        cell.coverage = float(coverage_mask[sy:ey, sx:ex].mean())

    flag_cells(flat)

    integral = cv2.integral(mask)
    verdicts = judge_zones(zones, integral, ZONE_FAINT_DENSITY)

    # ── stdout ───────────────────────────────────────────────────────────
    print(f"参考图 {REFERENCE.name}  {width}×{height} px  ({PX_PER_MM:.0f} px/mm)")
    print(f"暗像素阈值 Otsu = {threshold:.0f}；网格 {args.cols}×{args.rows}"
          f"（{NOTE_W_MM / args.cols:.2f} × {NOTE_H_MM / args.rows:.2f} mm/格）")
    quantiles = [float(np.quantile([c.density for c in flat], q)) for q in (0.1, 0.25, 0.5, 0.75, 0.9)]
    print("格密度分位数 p10/p25/p50/p75/p90 = "
          + " / ".join(f"{value:.2f}" for value in quantiles))
    print(f"分档阈值：稀疏 ≤ {args.sparse_at:.2f} < 中等 < {args.dense_at:.2f} ≤ 密集"
          "（阈值取在 0.09–0.13 的断层里，理由见脚本顶部注释）")
    print(f"启用区块 {len(enabled)} 个（共 {len(zones)} 个，其余 enabled=false）\n")

    print_markdown(flat)

    counts = {"MISSING": 0, "OVER": 0, "PARTIAL": 0, "OK": 0}
    for cell in flat:
        counts[cell.flag] += 1
    print("\n按标记聚合：", "  ".join(f"{key}={value}" for key, value in counts.items()))

    print("\n区块级归因（区块内参考墨量；"
          f"< {ZONE_EMPTY_DENSITY:.2f} 判为空白，< {ZONE_FAINT_DENSITY:.2f} 判为偏淡）")
    print("| 区块 | mm 矩形 | 墨量 | 判定 | 建议 |")
    print("| --- | --- | --- | --- | --- |")
    for verdict in verdicts:
        zone = verdict.zone
        print(
            f"| {zone.id} | {zone.x0:.1f},{zone.y0:.1f},{zone.x1:.1f},{zone.y1:.1f} "
            f"| {verdict.density:.3f} | {verdict.tier} | {verdict.suggestion} |"
        )

    # ── JSON ─────────────────────────────────────────────────────────────
    payload = {
        "meta": {
            "reference": str(REFERENCE.relative_to(ROOT)).replace("\\", "/"),
            "size_px": [width, height],
            "px_per_mm": PX_PER_MM,
            "note_mm": [NOTE_W_MM, NOTE_H_MM],
            "grid": {"cols": args.cols, "rows": args.rows,
                     "cell_mm": [NOTE_W_MM / args.cols, NOTE_H_MM / args.rows]},
            "ink_threshold_otsu": round(threshold, 1),
            "tiers": {
                "sparse_max": args.sparse_at,
                "dense_min": args.dense_at,
                "quantiles": dict(zip(["p10", "p25", "p50", "p75", "p90"],
                                      [round(v, 4) for v in quantiles])),
            },
            "coverage_cuts": {"missing": COV_MISSING, "full": COV_FULL,
                              "partial_cap": COV_PARTIAL_CAP},
            "zone_cuts": {"empty": ZONE_EMPTY_DENSITY, "faint": ZONE_FAINT_DENSITY},
        },
        "cells": [
            {
                "row": cell.row,
                "col": cell.col,
                "mm": [round(cell.x0, 2), round(cell.y0, 2), round(cell.x1, 2), round(cell.y1, 2)],
                "ref_density": round(cell.density, 4),
                "ref_tier": cell.tier,
                "coverage": round(cell.coverage, 3),
                "flag": cell.flag,
            }
            for cell in flat
        ],
        "stats": {
            "counts": counts,
            "by_flag": {
                flag: [f"R{cell.row + 1}C{cell.col + 1}" for cell in flat if cell.flag == flag]
                for flag in ("MISSING", "OVER", "PARTIAL")
            },
        },
        "zones": [
            {
                "id": verdict.zone.id,
                "kind": verdict.zone.kind,
                "mm": [round(v, 2) for v in verdict.zone.rect_mm],
                "ink_density": round(verdict.density, 4),
                "verdict": verdict.tier,
                "neighbor_density": {k: round(v, 4) for k, v in verdict.neighbors.items()},
                "suggestion": verdict.suggestion,
            }
            for verdict in verdicts
        ],
        "disabled_zones": [
            {"id": zone.id, "mm": [round(v, 2) for v in zone.rect_mm]}
            for zone in zones
            if not zone.enabled
        ],
    }
    args.json.parent.mkdir(parents=True, exist_ok=True)
    args.json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    draw_overlay(color, grid, zones, args.png, args.scale)

    print(f"\nJSON → {args.json}")
    print(f"PNG  → {args.png}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
