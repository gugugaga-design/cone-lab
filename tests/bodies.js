/* v33.29 专项回归：空心圆柱主立体 + 相贯体九种补全。
   运行: node test2/bodies.js */
"use strict";
const { boot } = require("./boot");
const app = boot();
let pass = 0, fail = 0;
function check(n, c, d){ if(c){pass++;console.log("  PASS  "+n+(d?"   ["+d+"]":""));} else {fail++;console.log("  FAIL  "+n+(d?"   ["+d+"]":""));} }
function section(t){ console.log("\n=== " + t + " ==="); }

/* ============ A. 空心圆柱主立体 ============ */
section("A. 空心圆柱（hcyl）几何与内部判定");
app.run("applyShape('hcyl')");
check("A1 SHAPES.hcyl 存在且带 hollow 标记", app.run("(function(){ return !!SHAPES.hcyl && !!SHAPES.hcyl.hollow && SHAPES.hcyl.Ri > 0; })()"));
check("A2 主立体网格非空（四片硬法线套筒）", app.run("(function(){ return geo.attributes && geo.attributes.position.count > 100; })()"));
check("A3 材料点在内环里（insideCone）", app.run("(function(){ return insideCone(new THREE.Vector3((SHAPES.hcyl.R+SHAPES.hcyl.Ri)/2, 0, 0)); })()"));
check("A4 内腔不是材料", app.run("(function(){ return !insideCone(new THREE.Vector3(0, 0, 0)); })()"));
check("A5 外壁之外不是材料", app.run("(function(){ return !insideCone(new THREE.Vector3(SHAPES.hcyl.R+5, 0, 0)); })()"));
check("A6 端面之外不是材料", app.run("(function(){ return !insideCone(new THREE.Vector3((SHAPES.hcyl.R+SHAPES.hcyl.Ri)/2, SHAPES.hcyl.H, 0)); })()"));
check("A7 solidOutside：材料内侧 < 0", app.run("(function(){ return solidOutside(new THREE.Vector3((SHAPES.hcyl.R+SHAPES.hcyl.Ri)/2, 0, 0)) < 0; })()"));
check("A8 solidOutside：内腔 > 0", app.run("(function(){ return solidOutside(new THREE.Vector3(0,0,0)) > 0; })()"));
check("A9 solidOutside：外壁外 > 0", app.run("(function(){ return solidOutside(new THREE.Vector3(SHAPES.hcyl.R+3,0,0)) > 0; })()"));

section("B. 空心圆柱截交线（内外双环）");
const secH = app.run(`(function(){
  var out = sectionPointsND(new THREE.Vector3(0,1,0), 0, 120);
  var radii = out.map(function(p){ return Math.sqrt(p.x*p.x + p.z*p.z); });
  var hasOuter = radii.some(function(r){ return Math.abs(r - SHAPES.hcyl.R) < 0.5; });
  var hasInner = radii.some(function(r){ return Math.abs(r - SHAPES.hcyl.Ri) < 0.5; });
  /* 外环末尾 → 内环开头的跳变要 > 14（buildXlines 分段阈值） */
  var gap = 0;
  for(var i=1;i<out.length;i++){
    var d = out[i].distanceTo(out[i-1]);
    if(d > gap) gap = d;
  }
  return {n:out.length, hasOuter:hasOuter, hasInner:hasInner, gap:gap};
})()`);
check("B1 水平面截出内外两圈", secH.hasOuter && secH.hasInner, "n=" + secH.n);
check("B2 两圈之间的折线跳变 > 14mm（不会连成 8 字）", secH.gap > 14, "gap=" + secH.gap.toFixed(1));
const secV = app.run(`(function(){
  var out = sectionPointsND(new THREE.Vector3(0,0,1), 0, 120);
  var radii = out.map(function(p){ return Math.sqrt(p.x*p.x + p.y*p.y); });
  return {n:out.length,
          hasOuter:radii.some(function(r){ return Math.abs(r-SHAPES.hcyl.R)<0.8; }),
          hasInner:radii.some(function(r){ return Math.abs(r-SHAPES.hcyl.Ri)<0.8; })};
})()`);
check("B3 正平面截出内外两个矩形环", secV.hasOuter && secV.hasInner, "n=" + secV.n);

section("C. 空心圆柱的分块与封盖挖孔");
app.run("faces.length=0; cyls.length=0; pickSel={}; mode='all';");
app.run("faces.push({type:'horiz', ang:0, x:0, y:0, z:0, on:true, flip:false}); refresh();");
check("C1 空心圆柱 + 水平面能分块（不崩、有块）", app.run("(function(){ mode='pick'; refresh(); return cells.length >= 2; })()"),
      app.run("(function(){ return 'cells=' + cells.length; })()"));
check("C2 封盖规格带内孔挖除（withBoreCapSpec）", app.run(`(function(){
  var sp = withBoreCapSpec([]);
  return sp.length === 1 && sp[0].r === SHAPES.hcyl.Ri && sp[0].keep === 1;
})()`));
check("C3 非空心立体不追加内孔规格", app.run("(function(){ applyShape('cone'); return withBoreCapSpec([]).length === 0; })()"));

section("D. 空心圆柱的孔壁多段支持（径向孔穿两层壁）");
check("D1 穿腔径向母线 → 2 个材料区间", app.run(`(function(){
  applyShape('hcyl');
  var ax = new THREE.Vector3(1,0,0);         // 沿 X 打径向孔：穿外壁 → 内腔 → 对壁
  var o  = new THREE.Vector3(-200, 0, 0);
  var spans = boreLineSpans(o, ax, 500, null);
  return spans.length === 2 && spans[0][1]-spans[0][0] > 1 && spans[1][1]-spans[1][0] > 1;
})()`), app.run(`(function(){
  var o  = new THREE.Vector3(-200, 0, 0);
  return JSON.stringify(boreLineSpans(o, new THREE.Vector3(1,0,0), 500, null));
})()`));
check("D1b 走壁内的母线只有 1 个区间（对照）", app.run(`(function(){
  var o  = new THREE.Vector3((SHAPES.hcyl.R+SHAPES.hcyl.Ri)/2, 0, -200);
  return boreLineSpans(o, new THREE.Vector3(0,0,1), 500, null).length === 1;
})()`));
check("D2 轴向孔口（盲孔深度基准）= 外壁而非内壁", app.run(`(function(){
  /* 孔轴平行于立体轴、偏移到壁上（x=(R+Ri)/2）：+方向孔口应在外壁 y=+H/2 */
  var c = {shape:"cyl", type:"horiz", ang:0, x:(SHAPES.hcyl.R+SHAPES.hcyl.Ri)/2, y:0, z:0, r:3, len:0, depth:0, hole:true, on:true};
  var tA = cylMouthT(c, 1);
  return Math.abs(tA - SHAPES.hcyl.H/2) < 1.0;
})()`), app.run(`(function(){
  var c = {shape:"cyl", type:"horiz", ang:0, x:(SHAPES.hcyl.R+SHAPES.hcyl.Ri)/2, y:0, z:0, r:3, len:0, depth:0, hole:true, on:true};
  return "tA=" + cylMouthT(c, 1) + " 期望≈" + SHAPES.hcyl.H/2;
})()`));

/* ============ E. 相贯体九种补全 ============ */
section("E. 新相贯体的内部判定（cylMargin 与着色器同一套公式）");
app.run("(function(){ applyShape('cone'); cyls.length=0; faces.length=0; cutHole=false; })()");
var MARGIN_CASES = [
  ["sphere","horiz",{r:12},          "0,0,0",     "0,20,0",  "球"],
  ["hemi",  "horiz",{r:12},          "0,6,0",     "0,-3,0",  "半球（球冠朝+轴）"],
  ["cone",  "frontal",{r:10,len:40}, "0,0,0",     "0,9,19",  "圆锥（轴=Z）"],
  ["frustum","frontal",{r:10,rt:4,len:40}, "0,6,0", "0,6,19", "圆台"],
  ["pyr3",  "frontal",{r:10,len:40}, "0,9,-19",   "9,0,-19", "正三棱锥（顶点方位 0/±120°）"],
  ["slot",  "frontal",{r:10,len:40}, "0,-8,0",    "0,8,0",   "槽（开口朝+V）"]
];
MARGIN_CASES.forEach(function(tc){
  app.run("(function(){ cyls.length=0; cutShape='" + tc[0] + "'; addCyl('" + tc[1] + "'); })()");
  app.run("(function(){ var c=cyls[0]; var p=" + JSON.stringify(tc[2]) + "; for(var k in p){ c[k]=p[k]; } c.x=0; c.y=0; c.z=0; })()");
  const inside = app.run("(function(){ return cylMargin(cyls[0], new THREE.Vector3(" + tc[3] + ")) > 0.05; })()");
  const outside = app.run("(function(){ return cylMargin(cyls[0], new THREE.Vector3(" + tc[4] + ")) < -0.05; })()");
  check("E1 " + tc[5] + " 内部点判定", inside, "(" + tc[3] + ")");
  check("E2 " + tc[5] + " 外部点判定", outside, "(" + tc[4] + ")");
});

section("F. 四值码（cylCodeAt）与端面");
const codeSphere = app.run(`(function(){
  cyls.length=0; cutShape='sphere'; addCyl('horiz');
  var c=cyls[0]; c.r=12; c.x=0; c.y=0; c.z=0;
  return {inside: cylCodeAt(c, new THREE.Vector3(0,0,0)),
          top:    cylCodeAt(c, new THREE.Vector3(0,25,0)),
          bot:    cylCodeAt(c, new THREE.Vector3(0,-25,0)),
          side:   cylCodeAt(c, new THREE.Vector3(30,0,0))};
})()`);
check("F1 球：内=3 / +端外=1 / -端外=2 / 侧外=0",
      codeSphere.inside===3 && codeSphere.top===1 && codeSphere.bot===2 && codeSphere.side===0,
      JSON.stringify(codeSphere));
const codeHemi = app.run(`(function(){
  cyls.length=0; cutShape='hemi'; addCyl('horiz');
  var c=cyls[0]; c.r=12;
  return {below: cylCodeAt(c, new THREE.Vector3(0,-3,0)),
          above: cylCodeAt(c, new THREE.Vector3(0,20,0))};
})()`);
check("F2 半球：底面之下=2 / 球冠之上=1", codeHemi.below===2 && codeHemi.above===1, JSON.stringify(codeHemi));

section("G. 打孔限制：只有圆柱/正方体/长方体能贯穿");
const punchProbe = app.run(`(function(){
  var out = {};
  ['sphere','cone','slot','pyr3','frustum','hemi'].forEach(function(s){
    cyls.length=0; cutShape=s; cutHole=true; addCyl('horiz');
    out[s] = cyls[0].hole;
  });
  cutHole=false;
  cyls.length=0; cutShape='cyl'; cutHole=true; addCyl('horiz');
  out.cyl = cyls[0].hole;
  return out;
})()`);
check("G1 新六种即使处于打孔状态也强制实体相贯",
      ['sphere','cone','slot','pyr3','frustum','hemi'].every(function(s){ return punchProbe[s] === false; }),
      JSON.stringify(punchProbe));
check("G2 圆柱仍可贯穿打孔", punchProbe.cyl === true);

section("H. 相贯线（bodySurfPatches / penetrationCurves）");
const patchCounts = app.run(`(function(){
  var out = {};
  ['sphere','hemi','cone','frustum','pyr3','slot'].forEach(function(s){
    cyls.length=0; cutShape=s; addCyl('horiz');
    out[s] = bodySurfPatches(cyls[0]).length;
  });
  return out;
})()`);
check("H1 六种新体都有表面参数化网格",
      ['sphere','hemi','cone','frustum','pyr3','slot'].every(function(s){ return patchCounts[s] >= 1; }),
      JSON.stringify(patchCounts));
const curveSphere = app.run(`(function(){
  cyls.length=0; cutShape='sphere'; addCyl('horiz');
  var c=cyls[0]; c.r=25; c.x=0; c.y=0; c.z=0;   /* r=25：中部伸出圆锥面（锥底半径30、腰部15） */
  var curves = penetrationCurves(c);
  var n = 0; curves.forEach(function(ch){ n += ch.length; });
  return {chains:curves.length, pts:n};
})()`);
check("H2 球与圆锥的相贯线非空", curveSphere.chains >= 1 && curveSphere.pts >= 10,
      "chains=" + curveSphere.chains + " pts=" + curveSphere.pts);
const curvePyr3 = app.run(`(function(){
  cyls.length=0; cutShape='pyr3'; addCyl('horiz');
  var c=cyls[0]; c.r=24; c.len=60; c.x=0; c.y=-20; c.z=0;
  var curves = penetrationCurves(c);
  var n = 0; curves.forEach(function(ch){ n += ch.length; });
  return {chains:curves.length, pts:n};
})()`);
check("H3 正三棱锥与圆锥的相贯线非空", curvePyr3.chains >= 1 && curvePyr3.pts >= 6,
      "chains=" + curvePyr3.chains + " pts=" + curvePyr3.pts);

section("I. 着色器规格编码（cylSpecOf 类型码）");
const specCodes = app.run(`(function(){
  var out = {};
  [['sphere',2],['cone',3],['frustum',4],['hemi',5],['pyr3',6],['slot',7]].forEach(function(pair){
    cyls.length=0; cutShape=pair[0]; addCyl('horiz');
    var sp = cylSpecOf(cyls[0], -1);
    out[pair[0]] = {k: sp.keep * (sp.code||1), code: sp.code};
  });
  cyls.length=0; cutShape='cyl'; addCyl('horiz');
  var spc = cylSpecOf(cyls[0], 1);
  out.cyl = spc.keep * (spc.code||1);
  return out;
})()`);
check("I1 新体 spec 的 k = keep×code（2..7）",
      specCodes.sphere.k===-2 && specCodes.cone.k===-3 && specCodes.frustum.k===-4 &&
      specCodes.hemi.k===-5 && specCodes.pyr3.k===-6 && specCodes.slot.k===-7,
      JSON.stringify(specCodes));
check("I2 圆柱保持老编码 k=±1", specCodes.cyl === 1);
check("I3 圆台 spec 带顶半径与半高", app.run(`(function(){
  cyls.length=0; cutShape='frustum'; addCyl('frontal');
  var c=cyls[0]; c.r=10; c.rt=4; c.len=40;
  var sp = cylSpecOf(c, 1);
  return sp.hw === 4 && Math.abs(sp.hh - 20) < 1e-6 && Math.abs(sp.r - 10) < 1e-6;
})()`));

section("J. 撤销快照保存 rt / depth");
check("J1 快照含 rt 与 depth", app.run(`(function(){
  cyls.length=0; cutShape='frustum'; addCyl('frontal');
  cyls[0].rt = 7; cyls[0].depth = -12;
  var s = JSON.parse(snapState());
  return s.cyls[0].rt === 7 && s.cyls[0].depth === -12;
})()`));

section("K. 点选保留部分 + 新相贯体（分块与拾取）");
const pickProbe = app.run(`(function(){
  applyShape('cone'); cyls.length=0; faces.length=0; pickSel={};
  cutShape='sphere'; cutHole=false; addCyl('horiz');
  cyls[0].r = 40; cyls[0].x = 0; cyls[0].y = 10; cyls[0].z = 0;   /* 大球拦腰截断圆锥 */
  mode='pick'; refresh();
  var act = activeFaceData(), cs = activeCyls();
  var topK = cellKeyAt(new THREE.Vector3(0, SHAPES.cone.H/2 - 2, 0), act, cs);
  var botK = cellKeyAt(new THREE.Vector3(0, -SHAPES.cone.H/2 + 2, 0), act, cs);
  return {cells:cells.length, topK:topK, botK:botK, topNeBot: topK !== botK};
})()`);
check("K1 球相贯体把圆锥分成块、锥顶/锥底 key 不同", pickProbe.cells >= 2 && pickProbe.topNeBot,
      JSON.stringify(pickProbe));
check("K2 cellAtPoint 在球内命中块（cylMargin 路径）", app.run(`(function(){
  return !!cellAtPoint(new THREE.Vector3(0, 10, 0));
})()`));

console.log("\n=========================================");
console.log((fail === 0 ? "ALL OK  " : "FAILED  ") + "PASS " + pass + "  FAIL " + fail);
process.exit(fail === 0 ? 0 : 1);
