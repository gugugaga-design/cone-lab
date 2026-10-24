"""独立几何验证（不依赖 node）：模拟"正三棱锥 + 长方体相贯体"的分块与点选。

完全用 Python 重写关键几何判定，与 JS 实现互相印证：
  · 正三棱锥（pyr3）：H=45, R=32，三角形截面
  · 长方体相贯体：type=horiz（轴沿 Y），w/h 为水平截面，len 为沿 Y 厚度
验证：
  1) 分块数量与 y 范围是否符合几何预期
  2) 点锥顶只隐藏锥顶那一段
  3) 各种厚度下都不会"整块消失"
"""
import math

# ---------- 正三棱锥（pyr3）----------
PYR_H = 45.0
PYR_R = 32.0          # 外接圆半径
PYR_HALF = PYR_H / 2  # 22.5

def pyr_radius_at(y):
    """给定高度 y，三角形截面的外接圆半径"""
    t = (y + PYR_HALF) / PYR_H
    return PYR_R * (1.0 - t)

def inside_pyr(x, y, z):
    """正三棱锥内部判定（三角形截面，与 JS 的 polyRadiusAt 等价）"""
    if y < -PYR_HALF - 1e-6 or y > PYR_HALF + 1e-6:
        return False
    rho = math.hypot(x, z)
    rr = pyr_radius_at(y)
    if rho > rr + 1e-6:
        return False
    ang = math.atan2(x, z)
    half = math.pi / 3
    a = ((ang + half) % (2 * half) + 2 * half) % (2 * half) - half
    rb = rr * math.cos(half) / math.cos(a)
    return rho <= rb + 1e-6

# ---------- 长方体相贯体（type=horiz：轴沿 Y）----------
class BoxCutter:
    def __init__(self, w, d, length, cy):
        self.hw = w / 2      # 沿 X 半宽
        self.hd = d / 2      # 沿 Z 半深
        self.half_len = length / 2   # 沿 Y 半厚
        self.cy = cy

    def margin(self, x, y, z):
        """>0 内部、<0 外部（沿轴=Y 的长方体）"""
        m = min(self.hw - abs(x), self.hd - abs(z))
        if self.half_len > 0:
            m = min(m, self.half_len - abs(y - self.cy))
        return m

    def code(self, x, y, z):
        """四值码：3=内部 1=正端外 2=负端外 0=两端之间"""
        if self.margin(x, y, z) > 0.05:
            return 3
        if self.margin(x, y, z) > -0.05:
            return None          # 恰在表面
        t = y - self.cy          # 轴沿 Y
        if t > self.half_len:
            return 1
        if t < -self.half_len:
            return 2
        return 0

def sample_regions(cutter, n=80):
    """采样所有落在棱锥内部的点，按 code 分类，统计每个 code 的 y 范围"""
    regions = {}
    for i in range(n + 1):
        y = -PYR_HALF + PYR_H * i / n
        rr = pyr_radius_at(y)
        if rr <= 0.05:
            continue
        for j in range(24):
            th = j / 24 * 2 * math.pi
            for k in range(1, 5):
                rho = rr * k / 4
                x, z = rho * math.cos(th), rho * math.sin(th)
                if not inside_pyr(x, y, z):
                    continue
                c = cutter.code(x, y, z)
                if c is None:
                    continue
                regions.setdefault(c, []).append(y)
    return regions

def report(title, w, d, length, cy):
    cutter = BoxCutter(w, d, length, cy)
    regions = sample_regions(cutter)
    print(f"\n--- {title} ---")
    print(f"    长方体: w={w} d={d} len={length} 中心y={cy}")
    print(f"    沿Y覆盖: [{cy-length/2:.1f}, {cy+length/2:.1f}]")
    names = {3: "内部(被夹)", 1: "正端外(锥顶)", 2: "负端外(锥底)", 0: "两端之间(侧面)"}
    total = 0
    for code in sorted(regions):
        ys = regions[code]
        total += 1
        print(f"    code {code} {names[code]:<16} y ∈ [{min(ys):7.1f}, {max(ys):7.1f}]  点数={len(ys)}")
    print(f"    => 分块数 = {total}")
    # 点锥顶（最高处）后，其他块是否还在
    if 1 in regions:
        others = [c for c in regions if c != 1]
        print(f"    点锥顶(隐藏 code 1) 后仍可见: {len(others)} 块 -> {'✓ 不会整块消失' if others else '✗ 整块消失!'}")
    else:
        print(f"    ⚠ 没有独立的锥顶块（code 1 不存在）")
        apex_code = cutter.code(0, PYR_HALF - 1, 0)
        print(f"    锥顶处 code = {apex_code}，与锥底 code = {cutter.code(0, -PYR_HALF + 1, 0)}")
    return total

print("=" * 70)
print("独立几何验证：正三棱锥(pyr3 H=45 R=32) + 长方体相贯体")
print("=" * 70)

report("用户截图场景（横块穿过中下部）", w=300, d=300, length=15, cy=-5)
report("居中横切", w=300, d=300, length=15, cy=0)
report("厚一些", w=300, d=300, length=26, cy=-5)
report("很薄", w=300, d=300, length=8, cy=0)

print("\n" + "=" * 70)
print("对照：修复前的二值码会怎样（锥顶与锥底同码）")
print("=" * 70)
cutter = BoxCutter(300, 300, 15, -5)
apex = cutter.margin(0, PYR_HALF - 1, 0)
base = cutter.margin(0, -PYR_HALF + 1, 0)
print(f"  锥顶 margin={apex:.1f}  锥底 margin={base:.1f}")
print(f"  二值码: 锥顶={'外(0)' if apex<0 else '内(1)'}  锥底={'外(0)' if base<0 else '内(1)'}")
print("  → 两者都是 0，隐藏锥顶会连锥底一起隐藏 = 用户看到的'整个棱锥全没了'")
print()
print("  四值码: 锥顶=code 1(正端外)  锥底=code 2(负端外)")
print("  → 两者不同，可以分别隐藏 ✓")
