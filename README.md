# 圆锥截面实验室 (Cone Lab)

一个运行在浏览器里的**圆锥 / 立体截面**教学演示工具。单文件 HTML + Three.js，无构建步骤、无框架依赖，直接在浏览器打开即可使用，也可打包成 Android APK 离线运行。

> 面向工程制图 / 画法几何教学：观察平面截切立体得到的截交线、贯穿体相贯线，以及「点选保留部分」把立体拆成若干块单独查看。

---

## 功能一览

| 功能 | 说明 |
|---|---|
| **平面截切** | 六类工程面（正平面 / 正垂面 / 水平面 / 铅垂面 / 侧平面 / 侧垂面），可拖动面沿法向平移、自动吸附、参数面板精确调整 |
| **显示模式** | 显示全部 / 只显示交集 / **点选保留部分**（把立体剖分成块，逐块隐藏或保留） |
| **贯穿体（相贯体）** | 无限圆柱 / 正方柱 / 长方体切割立体；可打孔或实体相贯；**可设深度做盲孔（带孔底封盖）**；着色器裁剪 |
| **交线** | 平面与立体表面的截交线，点击线条可看类型名称 |
| **相贯线** | 贯穿体与立体的相贯线，自动判别曲线类型（圆 / 椭圆 / 圆弧 / 抛物线 / 双曲线） |
| **模型拼装** | 空白页自由摆放立体（圆锥 / 球 / 半球 / 长方体 / 正方体 / 圆柱 / 槽 / 正三棱锥 / 圆台），可拖动、改尺寸、选方向 |
| **三视图** | 主视 / 俯视 / 左视，正交相机真投影 |
| **锁定三态** | 锁定（禁拖动）→ 冻结（只可旋转查看 + 三视图）→ 取消 |
| **撤销** | 状态快照栈，最多 40 步 |

### 支持的立体

`cone` 圆锥 · `hemi` 半球 · `frustum5` 五棱台 · `prism5` 五棱柱 · `pyr3` 正三棱锥 · `cyl` 圆柱 · `cylz` 平放圆柱 · `lab` 实验室（自由拼装）

---

## 快速开始

### 在浏览器里运行

```bash
git clone https://github.com/gugugaga-design/cone-lab.git
cd cone-lab
# 直接双击打开
start src/index.html        # Windows
open  src/index.html        # macOS
```

> 无需 http 服务，`file://` 协议即可运行（Three.js 用 UMD 版本，避免 ES module 的 CORS 限制）。

### 作为 Android APK 运行

从 [Releases](https://github.com/gugugaga-design/cone-lab/releases) 下载最新 `cone-lab-vX.apk`，传到手机安装即可（离线运行，不联网）。

---

## 项目结构

```
cone-lab/
├── src/
│   ├── index.html          # ★ 全部源码（单文件，内嵌 CSS + 一段 <script>）
│   └── lib/
│       ├── three.min.js    # Three.js r160 (UMD)
│       └── OrbitControls.js
├── tests/                  # 无头测试套件（无需浏览器）
│   ├── boot.js             # 在 Node 里启动 index.html 的内联脚本
│   ├── dom.js              # 迷你 DOM 实现
│   ├── runall.js           # ★ 一条命令跑完全部套件
│   ├── accept.js           # 功能验收
│   ├── edge.js             # 边界 / 退化 / 性能
│   ├── regions.js          # 分区数 == 几何分区数
│   ├── curves.js           # 相贯线几何精度
│   ├── cellgeo.js          # 分块裁剪互斥完备
│   ├── cylpick.js          # 相贯体裁切下的点选
│   ├── tintpick.js         # 贯体变实 + 点选
│   ├── eventflow.js        # 真实 DOM 事件流
│   ├── verify.js           # 独立 harness（自动扫描 IIFE 顶层声明）
│   ├── verify_geom.py      # 纯 Python 独立几何验证
│   └── test3/regions.js    # 第二套独立 harness（union-find 计区域）
└── docs/
    └── ARCHITECTURE.md     # 实现原理与关键设计决策
```

---

## 测试

本项目有完整的**无头测试套件**，不需要浏览器即可验证核心逻辑：

```bash
# 需要 Node.js 18+
node tests/runall.js
```

预期输出：

```
PASS  accept.js        四项需求验收           PASS 42   FAIL 0
PASS  edge.js          边界/退化/性能         ALL EDGE CASES OK
PASS  regions.js       分区数=几何分区数       ALL OK
PASS  curves.js        相贯线几何精度         ALL OK
PASS  cellgeo.js       分块裁剪互斥完备       ALL OK
PASS  cylpick.js       相贯体裁切点选         PASS 9   FAIL 0
PASS  tintpick.js      贯体变实+点选遮挡       PASS 8   FAIL 0
PASS  eventflow.js     真实DOM事件流点选      PASS 10  FAIL 0
PASS  verify.js        独立 harness #1
PASS  test3/regions.js 独立 harness #2

全部 10 套件通过
```

测试设计上刻意做了**交叉验证**：`regions.js` 与 `test3/regions.js` 是两套完全独立的实现（不同作者、不同算法），避免「自己写的测试迁就自己的实现」。

也可以用纯 Python 独立验证几何（不依赖 Node）：

```bash
python tests/verify_geom.py
```

---

## 关键实现说明

### 为什么是单文件

教学场景需要在**无网络的手机上**离线运行。单 HTML + UMD Three.js 可以直接 `file://` 打开，无需打包、无需服务器。

### 「点选保留部分」的分块原理

这是本项目最复杂的部分，踩过不少坑，简要记录：

1. **切割体建模**：面（半空间）、相贯体（圆柱/方柱）、自由拼装部件（多种实体）都能切分立体
2. **符号位分组**：每个采样点按「在每个切割体的哪一侧」生成 key
3. **连通性分割**：符号位相同但空间不连通的区域（如锥顶尖与锥底都在圆柱外）必须拆开，用并查集按空间连通性拆分
4. **裁剪渲染**：每块用 `clippingPlanes` + 着色器 `discard` 只画自己那一部分
5. **点选命中**：射线检测**不执行裁剪**，所以拿到命中点后必须用 `cellAtPoint(P)` 反查它真正属于哪一块

详细设计见 [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)。

---

## 已知限制

- **相贯线是数值采样**（marching squares + 二分），极端的擦边相交可能断线
- **点选可点区域偏小**：细窄的分块在屏幕上只有几个像素宽，建议先放大再点
- 无头测试验证的是**几何 / 状态 / 材质**，不是像素；视觉最终仍需真机确认
- 移动端为触摸操作优化，桌面浏览器可用鼠标但手势提示仍显示触摸文案

---

## 版本

当前 **v33.25**。主要里程碑：

| 版本 | 要点 |
|---|---|
| v26–v29 | 锁定三态、贯体变实、撤销、点选保留部分 |
| v31–v32 | 拼装变实（青色实体）、拼装相贯线、拼装点选 |
| v33 | 分块语义重写（部件参与分块、连通性分割、相贯体多值码）、相贯线精度（棱锥 φ→0.00mm）、性能优化（17.3s→0.67s） |
| v33.15 | 修实验室「加相贯体/面卡 1.2~1.9 秒」：lab 不再采幻影主立体点；体素键改整数 + 连通搜索两段式（顺带消掉 51 片伪块） |
| v33.16 | 修点选「模型中空 / 加面后莫名阴影」：分块网格恢复 `depthTest`；`cellCaps` 符号位改走 `parseCellKey` |
| v33.17 | 修点选「中空 / 点伸出段无反应 / 移动后撤销残留」：`cellCaps` 常数项符号；`buildParts` 外壳复活；`tapPick` 补相贯体伸出段 |
| v33.18 | 修 v33.17 引入的 `cylVis`/`activeCyls` 下标错位；修正两个长期误报的测试 |
| **v33.19** | 修拼装「表面好多条道 / 拖动卡顿 / 加出来自动橙色」：连通性分割加符号位联合判据（圆台 20 片→1 片）；分块跳过自身 `partSpec`（顶面针孔→0）；pointermove 重建 2 次→1 次；`estimateSampleSpacing` 16.4ms→0.2ms；分块配色跟随「拼装变实」 |
| v33.20 | 环境补齐与模拟器验收 |
| v33.21 | 修「用贯穿圆后圆柱内部变成中空」：打孔终于生成**孔壁几何**（此前只在着色器里 discard） |
| v33.23 | 修孔壁「两圈颜色变深 / 内部没涂匀」：孔壁由 `MeshBasicMaterial` 退回受光 `Lambert`，三角形绕序反转为法线朝孔内 |
| v33.24 | 修孔口「翻边环 / 缺口」：孔壁改成**逐母线求交**（孔轴曲面 ∩ 立体表面），删掉多余的孔口环；实测缺口 3.00mm → 0.00mm |
| **v33.25** | 新功能**贯穿体「深度」+ 孔底封盖**（盲孔）；顺带修三处隐蔽缺陷：GLSL 链式取 uniform 数组成员导致材质静默编译失败、自建几何漏算包围球被视锥剔除、改参数不重建孔壁 |

详见 [`docs/CHANGELOG.md`](docs/CHANGELOG.md)。

---

## License

MIT
