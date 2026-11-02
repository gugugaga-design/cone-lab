/* v33.31 回归套件：拼装部件的分块封盖（"实验室拼装 + 点选保留后仍中空"）
   用户场景复现：实验室模式放一个正平面方向的圆柱（轴沿 Z），
   加 侧垂面(ang30, y17, z-2.5) 和 水平面(y-5.4)，进「点选保留部分」。

   根因①：cellCaps 对部件块（ownerPart != null）也走 sectionPoly2D ——
     它按主立体算截面，实验室没有主立体 → 恒为空 → 封盖从来没画出来，
     隐藏相邻块后直接看进切口内壁（侧垂面斜切圆柱的椭圆暗窗）。
   根因②：封盖材质挂的 capPartSpecs 全部 keep=+1（保留部件外部），
     部件块封盖的每个片元都在自己部件内部 → 整张盖子被着色器丢弃。

   修法（v33.31）：
     · partSectionPoly2D(pr, nv, d)：平面∩部件截面（网格采样 + 凸包）；
     · cellCaps 按 ownerPart 路由到 partSectionPoly2D；
     · 封盖材质跳过自己部件的 spec，颜色跟随部件配色。

   跑法：node test2/partcap.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { boot } = require("./boot");
const app = boot();
const doc = app.__doc;

let pass = 0, fail = 0;
function check(name, cond, detail){
  if(cond){ pass++; console.log("  PASS  " + name + (detail ? "   [" + detail + "]" : "")); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   [" + detail + "]" : "")); }
}
function section(t){ console.log("\n=== " + t + " ==="); }

const HTML = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");

/* ============ 一、源码级断言 ============ */
section("一、源码：partSectionPoly2D 与封盖路由");
check("存在 partSectionPoly2D（平面∩部件截面）",
      /function partSectionPoly2D\(pr, nv, d\)/.test(HTML));
check("partSectionPoly2D 有缓存（_partCapCache）",
      /var _partCapCache = \{\};/.test(HTML));
check("buildCellVis 每次重建时清空封盖缓存",
      /function buildCellVis\(\)\{\s*_partCapCache = \{\};/.test(HTML));
check("cellCaps 对 ownerPart 块路由到 partSectionPoly2D",
      /var sp = ownPr \? partSectionPoly2D\(ownPr, o\.nv, o\.d\)\s*:\s*sectionPoly2D\(o\.nv, o\.d, 96\);/.test(HTML));
check("封盖材质跳过自己部件的 spec（不被自己挖空）",
      /setPartSpecs\(capMat, capPartSpecs\.filter\(function\(_, ii\)\{ return ii !== c\.ownerPart; \}\)\);/.test(HTML));
check("封盖颜色跟随部件配色（变实青色 / 未变实青蓝）",
      /color: ownPart \? \(tintPart \? 0x12d6c8 : 0x8fd8ff\) : 0xdd7a34/.test(HTML));

/* ============ 二、复现用户场景（实验室 + 圆柱 + 两面） ============ */
section("二、实验室复现：正放圆柱 + 侧垂面30° + 水平面");
app.run("applyShape('lab');");
app.run("addPart('cyl');");
app.run("(function(){ var pr = parts[0]; pr.type = 'frontal'; pr.ang = 0; pr.r = 16; pr.h = 44; pr.x = 0; pr.y = 0; pr.z = 0; })();");
app.run("faces.push({type:'lv', ang:30, x:0, y:17, z:-2.5, on:true, flip:false});" +
        "faces.push({type:'horiz', ang:0, x:0, y:-5.4, z:0, on:true, flip:false});");
app.run("mode = 'pick'; refresh();");

const cellInfo = app.run("(function(){ return cells.map(function(c){ return {key:c.key, ownerPart:c.ownerPart, sel:c.sel, nplanes:c.planes.length}; }); })()");
check("分出了多块", cellInfo.length >= 2, "n=" + cellInfo.length);
check("每块都属于拼装部件（ownerPart=0）",
      cellInfo.every(function(c){ return c.ownerPart === 0; }));
check("块默认全部保留（sel=true）",
      cellInfo.every(function(c){ return c.sel === true; }));

/* 根因①的对照：实验室里按主立体算截面恒为空 */
const oldEmpty = app.run("(function(){ var act = activeFaceData();" +
  " return [sectionPoly2D(act[0].nv, act[0].d, 96).poly.length," +
  "         sectionPoly2D(act[1].nv, act[1].d, 96).poly.length]; })()");
check("（对照）实验室按主立体算截面恒为空 —— 老封盖必缺失的原因",
      oldEmpty[0] === 0 && oldEmpty[1] === 0, "poly=" + oldEmpty.join(","));

/* 修好后：每块都有封盖 */
const capCounts = app.run("(function(){ var act = activeFaceData();" +
  " return cells.map(function(c){ return cellCaps(c, act).length; }); })()");
check("每个保留块都算得出封盖（≥1 张）",
      capCounts.every(function(n){ return n >= 1; }), "caps=" + capCounts.join(","));

/* ============ 三、封盖几何与材质 ============ */
section("三、封盖几何：贴在剖面上、落在部件内、颜色与挖空正确");
const caps = app.run("(function(){ var out = [];" +
  " if(!cellGroup) return out;" +
  " cellGroup.traverse(function(ch){" +
  "  if(!(ch.isMesh && ch.userData && ch.userData.cap)) return;" +
  "  var pos = ch.geometry.attributes.position, pts = [];" +
  "  for(var i=0;i<pos.count;i++) pts.push([pos.getX(i), pos.getY(i), pos.getZ(i)]);" +
  "  out.push({n: pts.length, col: ch.material.color.getHexString()," +
  "    pk: ch.material.userData.cylU.uPartK.value.map(function(v){ return v.x; }), pts: pts});" +
  " });" +
  " return out; })()");
check("场景里有封盖网格", caps.length > 0, "n=" + caps.length);
check("每张封盖至少 3 个顶点", caps.every(function(c){ return c.n >= 3; }));

/* 圆柱（轴沿 Z，r=16，h=44，中心原点）局部判定：hypot(x,y)<=r 且 |z|<=h/2 */
function inCyl(p, pad){
  return Math.hypot(p[0], p[1]) <= 16 + pad && Math.abs(p[2]) <= 22 + pad;
}
const actD = app.run("(function(){ return activeFaceData().map(function(o){" +
  " return {nx:o.nv.x, ny:o.nv.y, nz:o.nv.z, d:o.d}; }); })()");
function onSomePlane(p){
  var best = 1e9;
  actD.forEach(function(o){ best = Math.min(best, Math.abs(o.nx*p[0] + o.ny*p[1] + o.nz*p[2] - o.d)); });
  return best;
}
let worstPlane = 0, worstInside = 0;
caps.forEach(function(c){
  c.pts.forEach(function(p){
    worstPlane = Math.max(worstPlane, onSomePlane(p));
    if(!inCyl(p, 0)) worstInside = Math.max(worstInside, inCyl(p, 1.2) ? 1 : 2);
  });
});
check("封盖顶点都贴在剖面上（|n·p-d| ≤ 0.4，含 0.08 让位）",
      worstPlane <= 0.4, "max=" + worstPlane.toFixed(3));
check("封盖顶点都落在圆柱内（无越界飞点）",
      worstInside < 2, "worst=" + worstInside);
check("封盖颜色 = 部件配色 #8fd8ff（未变实），不再是切口橙",
      caps.every(function(c){ return c.col === "8fd8ff"; }),
      caps.map(function(c){ return c.col; }).join(","));
check("封盖不再被自己部件挖空（uPartK 无 +1 槽）",
      caps.every(function(c){ return c.pk.every(function(k){ return k !== 1; }); }),
      JSON.stringify(caps.map(function(c){ return c.pk; })));

/* 拼装变实后封盖颜色跟着变 */
app.run("partTint = true; refresh();");
const colsSolid = app.run("(function(){ var out = [];" +
  " cellGroup.traverse(function(ch){ if(ch.isMesh && ch.userData && ch.userData.cap) out.push(ch.material.color.getHexString()); });" +
  " return out; })()");
check("拼装变实后封盖变青色实体 #12d6c8",
      colsSolid.length > 0 && colsSolid.every(function(c){ return c === "12d6c8"; }),
      colsSolid.join(","));
app.run("partTint = false;");

/* ============ 四、非实验室回归：主立体封盖不受影响 ============ */
section("四、回归：圆锥 + 部件场景下主立体封盖仍正常");
app.run("applyShape('cone');");
app.run("addPart('box');");
app.run("faces.push({type:'horiz', ang:0, x:0, y:-10, z:0, on:true, flip:false});");
app.run("mode = 'pick'; refresh();");
const mix = app.run("(function(){ var out = {mainCaps:0, partCaps:0, mainCells:0, partCells:0};" +
  " cells.forEach(function(c){ if(c.ownerPart == null) out.mainCells++; else out.partCells++; });" +
  " if(cellGroup) cellGroup.traverse(function(ch){" +
  "  if(!(ch.isMesh && ch.userData && ch.userData.cap)) return;" +
  "  if(ch.material.color.getHexString() === 'dd7a34') out.mainCaps++;" +
  "  else out.partCaps++;" +
  " });" +
  " return out; })()");
check("主立体分块仍有橙色封盖", mix.mainCells > 0 && mix.mainCaps > 0,
      JSON.stringify(mix));
/* partCaps 统计的是"非橙色"封盖：>0 说明部件块封盖已改用部件配色 */
check("部件分块的封盖改用部件配色（非橙）", mix.partCells === 0 || mix.partCaps > 0,
      JSON.stringify(mix));

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);
