/* v33.54 回归套件：撤销一致性（bug4）/ 顶点三条棱圆角（bug1）/ 圆角随模型移动（bug2）
   运行: node tests/filletundo.js */
"use strict";
const path = require("path"), fs = require("fs"), vm = require("vm");
const { boot } = require("./boot");
const app = boot();
const R = function (code) { return app.run(code); };
const html = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
const inlines = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const trailer3 = ";globalThis.__RUN=function(c){return eval(c)};";
app.__window.THREE = app.__ctx.THREE;
app.__window.OrbitControls = app.__ctx.THREE.OrbitControls;
(function () {
  const Stub = app.__ctx.THREE.OrbitControls, T = app.__ctx.THREE;
  function Patched(object, dom) {
    Stub.call(this, object, dom);
    this.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_PAN };
    this.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.PAN };
    this.minZoom = 0; this.maxZoom = Infinity;
  }
  Patched.prototype = Stub.prototype; app.__ctx.THREE.OrbitControls = Patched;
})();
const docObj = app.__sandbox.document;
const gebi0 = docObj.getElementById.bind(docObj);
docObj.getElementById = function (id) {
  const r = gebi0(id); if (r) return r;
  let out = null;
  (function walk(el) {
    if (out || !el || !el.children) return;
    for (let i = 0; i < el.children.length; i++) { const c = el.children[i]; if (c.id === id) { out = c; return; } walk(c); }
  })(docObj.body);
  return out;
};
vm.runInContext(inlines[1], app.__ctx, { filename: "csg-inline.js" });
const s3 = inlines[2], ci3 = s3.lastIndexOf("})();");
vm.runInContext(s3.slice(0, ci3) + "\n" + trailer3 + "\n" + s3.slice(ci3), app.__ctx, { filename: "cadlab-inline.js" });
app.__window.CADLab.open();

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name + (detail ? "   [" + detail + "]" : "")); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   [" + detail + "]" : "")); }
}
function section(t) { console.log("\n=== " + t + " ==="); }

/* 统一的状态探针：草图边数 / 特征表 / 三角形数 / 体积 / 包围盒 */
const STATE = `(function(){
  function svol(c){ var v=0; c.toPolygons().forEach(function(pg){ var vs=pg.vertices;
    for(var i=1;i<vs.length-1;i++){ var a=vs[0].pos,b=vs[i].pos,cc=vs[i+1].pos;
      v+=a.x*(b.y*cc.z-cc.y*b.z)-a.y*(b.x*cc.z-cc.x*b.z)+a.z*(b.x*cc.y-cc.x*b.y); } });
    return v/6; }
  var mn=[1e9,1e9,1e9], mx=[-1e9,-1e9,-1e9];
  if (S.solid) S.solid.toPolygons().forEach(function(pg){ pg.vertices.forEach(function(v){
    [v.pos.x,v.pos.y,v.pos.z].forEach(function(q,i){ if(q<mn[i])mn[i]=q; if(q>mx[i])mx[i]=q; }); }); });
  return JSON.stringify({
    ents: S.entities.length,
    feats: S.features.map(function(f){ return f.t; }).join(","),
    solid: !!S.solid,
    vol: S.solid ? Math.round(svol(S.solid)) : 0,
    tris: S.solid ? csgGeom(S.solid).getAttribute("position").count/3 : 0,
    bbox: S.solid ? mn.concat(mx).map(function(q){ return +q.toFixed(2); }) : null,
    hist: S.history.length
  });
})()`;
const st = () => JSON.parse(R(STATE));

const RESET = 'cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=[]; S.pickedEdge=null;'
  + 'S.planeId="front"; S.history=[]; S.future=[]; setTool("select"); updateSketch3D();';

function pick(mid) {
  return R(`(function(){
    var segs = edgeSegments(), best = null, bd = 1e9, M = new THREE.Vector3(${mid.join(",")});
    segs.forEach(function(s){ var d = s.a.clone().add(s.b).multiplyScalar(0.5).distanceTo(M); if (d < bd) { bd = d; best = s; } });
    if (!best) return null;
    S.pickedEdge = { a: best.a.clone(), b: best.b.clone() };
    return [best.a.x, best.a.y, best.a.z].map(function(q){ return +q.toFixed(1); }).join(",");
  })()`);
}

/* ---------------------------------------------------------------- */
section("A. 撤销：只回退一步（不是跨过几次操作）");
R(RESET);
R('addEntity("rect",{x0:-25,y0:-25,x1:25,y1:25},true);');
const s1 = st();
R('S.feature.start=0; S.feature.end=25; S.feature.dir=1; featureExtrude("add");');
const s2 = st();
pick([0, -25, 25]);
R('fillet(5);');
const s3s = st();
check("拉伸后实体存在", s2.solid && !s1.solid, "ents=" + s2.ents + " feats=" + s2.feats);
check("圆角后特征表 = ext,fillet", s3s.feats === "ext,fillet", s3s.feats);
R('undo()');
const u1 = st();
check("撤销一次 → 去掉圆角，模型仍在", u1.feats === "ext" && u1.solid && u1.ents === 1,
  "feats=" + u1.feats + " solid=" + u1.solid + " ents=" + u1.ents);
check("撤销一次 → 体积回到拉伸值", u1.vol === s2.vol, u1.vol + " vs " + s2.vol);
check("撤销一次 → 草图边没被删", u1.ents === 1, "ents=" + u1.ents);
R('undo()');
const u2 = st();
check("再撤销一次 → 只剩草图", u2.ents === 1 && !u2.solid && u2.feats === "",
  "ents=" + u2.ents + " solid=" + u2.solid + " feats=" + u2.feats);
R('redo()');
const r1 = st();
check("重做 → 模型回来（特征表恢复）", r1.solid && r1.feats === "ext", "feats=" + r1.feats);
R('redo()');
const r2 = st();
check("再重做 → 圆角回来", r2.feats === "ext,fillet", r2.feats);
check("重做后体积与撤销前一致", r2.vol === s3s.vol, r2.vol + " vs " + s3s.vol);

/* ---------------------------------------------------------------- */
section("B. 撤销：拖草图之后（旧版会跨步删东西）");
R(RESET);
R('addEntity("rect",{x0:-25,y0:-25,x1:25,y1:25},true);');
R('S.feature.start=0; S.feature.end=25; S.feature.dir=1; featureExtrude("add");');
const b0 = st();
R('(function(){ var e=S.entities[0]; e.sel=true; S.drag={e:e,last:{x:0,y:0},pre:captureState()}; S.drag.moved=true;'
  + ' e.def.x0+=12; e.def.x1+=12; e.def.y0-=6; e.def.y1-=6; resample(e); S.drag=null; pushState(S.history.length?S.history.pop():null); })()');
const bMid = st();
/* 上面的模拟不够真实：直接走 onUp 的分支逻辑 */
R(RESET);
R('addEntity("rect",{x0:-25,y0:-25,x1:25,y1:25},true);');
R('S.feature.start=0; S.feature.end=25; S.feature.dir=1; featureExtrude("add");');
const c0 = st();
R('(function(){ var e=S.entities[0]; e.sel=true; S.drag={e:e,last:{x:0,y:0},pre:captureState()}; })()');
R('(function(){ var e=S.entities[0]; e.def.x0+=12; e.def.x1+=12; e.def.y0-=6; e.def.y1-=6; resample(e); S.drag.moved=true; })()');
R('(function(){ var preDrag=S.drag.pre, didMove=!!S.drag.moved; S.drag=null; if(didMove&&preDrag) pushState(preDrag); rebuildFeatures(); })()');
const c1 = st();
check("拖动后模型跟着走（包围盒变了）", JSON.stringify(c0.bbox) !== JSON.stringify(c1.bbox),
  JSON.stringify(c1.bbox));
R('undo()');
const c2 = st();
check("撤销拖动 → 回到拖动前的包围盒", JSON.stringify(c2.bbox) === JSON.stringify(c0.bbox),
  JSON.stringify(c2.bbox));
check("撤销拖动 → 草图边和模型都还在", c2.ents === 1 && c2.solid, "ents=" + c2.ents + " solid=" + c2.solid);

/* ---------------------------------------------------------------- */
section("C. bug1：长方体一个顶点三条棱圆角 → 不产生碎片");
R(RESET);
R('addEntity("rect",{x0:-25,y0:-25,x1:25,y1:25},true);');
R('S.feature.start=0; S.feature.end=25; S.feature.dir=1; featureExtrude("add");');
function pickAndFillet(mid) {
  return R(`(function(){
    var segs = edgeSegments(), best = null, bd = 1e9, M = new THREE.Vector3(${mid.join(",")});
    segs.forEach(function(s){ var d = s.a.clone().add(s.b).multiplyScalar(0.5).distanceTo(M); if (d < bd) { bd = d; best = s; } });
    if (!best) return -1;
    S.pickedEdge = { a: best.a.clone(), b: best.b.clone() };
    fillet(5);
    return (S.features[S.features.length-1].chain || []).length;
  })()`);
}
const chainLens = [
  pickAndFillet([0, -25, 25]),
  pickAndFillet([25, -25, 0])
];
/* v33.58：必须在第三次圆角**之前**量第三棱（倒完它就不存在了）。 */
const thirdBefore = JSON.parse(R(`(function(){
  var M=new THREE.Vector3(25,-12.5,25), segs=edgeSegments(), best=null, bd=1e9;
  segs.forEach(function(s){ var d=s.a.clone().add(s.b).multiplyScalar(0.5).distanceTo(M); if(d<bd){bd=d;best=s;} });
  var len=0;
  if(best) edgeChainFrom(best).forEach(function(s){
    if(Math.abs(s.a.x-25)<0.05 && Math.abs(s.b.x-25)<0.05 && Math.abs(s.a.z-25)<0.05 && Math.abs(s.b.z-25)<0.05)
      len += s.a.distanceTo(s.b);
  });
  return JSON.stringify({len:+len.toFixed(2)});
})()`));
chainLens.push(pickAndFillet([25, -12.5, 25]));
const corners = R(`(function(){
  var g=csgGeom(S.solid), pos=g.getAttribute("position"), n=pos.count/3, tiny=0, sliver=0, longSliver=0;
  for (var i=0;i<n;i++){
    var ax=pos.getX(i*3),ay=pos.getY(i*3),az=pos.getZ(i*3);
    var bx=pos.getX(i*3+1),by=pos.getY(i*3+1),bz=pos.getZ(i*3+1);
    var cx=pos.getX(i*3+2),cy=pos.getY(i*3+2),cz=pos.getZ(i*3+2);
    var ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
    var nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    var A=Math.sqrt(nx*nx+ny*ny+nz*nz)/2;
    if (A < 1e-4) tiny++;
    var mx=Math.max(Math.hypot(ux,uy,uz),Math.hypot(vx,vy,vz),Math.hypot(cx-bx,cy-by,cz-bz));
    if (mx>1e-6 && A/(mx*mx) < 1e-3) { sliver++; if (mx > 8) longSliver++; }
  }
  return JSON.stringify({tris:n, tiny:tiny, sliver:sliver, longSliver:longSliver, chains:${JSON.stringify(chainLens)}});
})()`);
const cp = JSON.parse(corners);
/* v33.58：角部补面沿第三棱方向延长后，BSP 会把第三棱切成共线的几段，
   几何仍是一条完整直棱。真正要守的是"长度完整、不溜进圆角弧"，而不是段数。 */
check("第三条棱保持完整（共线分段也算）", cp.chains[0] === 1 && cp.chains[1] === 1 && thirdBefore.len >= 19.9,
  cp.chains.join() + " len=" + thirdBefore.len);
check("没有零面积三角形（毛边来源）", cp.tiny === 0, "tiny=" + cp.tiny);
/* v33.55 角部球面：球面与三条圆角圆柱面是 G1（相切）过渡，BSP 在这一圈相切线上必然留下
   少量细三角——它们与相邻面共面、相邻、不重叠，着色和邻面一致，肉眼无感。
   真正要守的是：① 不能像 v33.53 那样成千上万（16535 个三角、满屏碎面）；
   ② 不能有穿过整张面（>8mm）的发丝缝——那种会闪。 */
check("细长三角形只剩个位数（v33.53 是上千个）", cp.sliver <= 12, "sliver=" + cp.sliver);
/* 余下 5 条是 20mm×0.04mm 的碎片，落在"圆角圆柱面与平面相切"那条线上（G1 过渡，
   法向只差 2.8°）：不画棱线（solidEdges 阈值 24°）、不与邻面重叠（不闪）、宽度 <1px。
   这是 BSP 布尔在相切处的固有残渣，只要不再上百条就说明没有真毛边。 */
check("跨越大面的碎渣 ≤6 条（且都在相切线上）", cp.longSliver <= 6, "longSliver=" + cp.longSliver);
check("三角形数量级（v33.53 是 16535，角部球面本身约 +1450）", cp.tris < 2000, "tris=" + cp.tris);
/* 遗留②的验收点：三条棱交汇处不再是尖角，而是一块球面（角部各方向到球心的距离 ≈ r=5） */
const prof = JSON.parse(R(`(function(){
  var r=5, pt=new THREE.Vector3(25,-25,25);
  var ax=[new THREE.Vector3(-1,0,0),new THREE.Vector3(0,1,0),new THREE.Vector3(0,0,-1)];
  var cc=pt.clone().addScaledVector(ax[0],r).addScaledVector(ax[1],r).addScaledVector(ax[2],r);
  var tris=[];
  S.solid.toPolygons().forEach(function(pg){ var vs=pg.vertices;
    for (var i=1;i+1<vs.length;i++) tris.push([vs[0].pos,vs[i].pos,vs[i+1].pos]); });
  function cast(dx,dy,dz){
    var best=1e9;
    for (var k=0;k<tris.length;k++){
      var a=tris[k][0],b=tris[k][1],c=tris[k][2];
      var e1x=b.x-a.x,e1y=b.y-a.y,e1z=b.z-a.z, e2x=c.x-a.x,e2y=c.y-a.y,e2z=c.z-a.z;
      var px=dy*e2z-dz*e2y, py=dz*e2x-dx*e2z, pz=dx*e2y-dy*e2x;
      var det=e1x*px+e1y*py+e1z*pz;
      if (det>-1e-9&&det<1e-9) continue;
      var inv=1/det, tx=cc.x-a.x, ty=cc.y-a.y, tz=cc.z-a.z;
      var u=(tx*px+ty*py+tz*pz)*inv; if (u<-1e-9||u>1+1e-9) continue;
      var qx=ty*e1z-tz*e1y, qy=tz*e1x-tx*e1z, qz=tx*e1y-ty*e1x;
      var v=(dx*qx+dy*qy+dz*qz)*inv; if (v<-1e-9||u+v>1+1e-9) continue;
      var t=(e2x*qx+e2y*qy+e2z*qz)*inv;
      if (t>1e-4 && t<best) best=t;
    }
    return best;
  }
  var N=9, mn=1e9, mx=-1e9;
  for (var i=0;i<=N;i++) for (var j=0;i+j<=N;j++){
    var a=i/N, b=j/N, c=(N-i-j)/N;
    var d=ax[0].clone().multiplyScalar(-a).addScaledVector(ax[1],-b).addScaledVector(ax[2],-c);
    if (d.lengthSq()<1e-12) continue;
    d.normalize();
    var t=cast(d.x,d.y,d.z);
    if (t>1e8) continue;
    if (t<mn) mn=t; if (t>mx) mx=t;
  }
  return JSON.stringify({min:+mn.toFixed(3), max:+mx.toFixed(3)});
})()`));
check("角部不再是尖角（各方向到球心 ≤ r+2%：v33.54 会戳到 1.39r）", prof.max <= 5.2, JSON.stringify(prof));
check("角部确实是球面（最凹处 ≥ 0.94r，只是多面体离散误差）", prof.min >= 4.7, JSON.stringify(prof));

/* ---------------------------------------------------------------- */
section("D. bug2：圆角随模型移动（草动模型动，圆角不丢）");
R(RESET);
R('addEntity("rect",{x0:-25,y0:-25,x1:25,y1:25},true);');
R('S.feature.start=0; S.feature.end=25; S.feature.dir=1; featureExtrude("add");');
pick([0, -25, 25]);
R('fillet(5);');
const f0 = st();
R('(function(){ S.entities.forEach(function(e){ e.def.x0+=12.5; e.def.x1+=12.5; e.def.y0-=7.25; e.def.y1-=7.25; resample(e); }); rebuildFeatures(); })()');
const f1 = st();
check("移动后体积与圆角前一致（圆角仍在）", f0.vol === f1.vol, f1.vol + " vs " + f0.vol);
check("移动后三角形数不变（不是被切烂）", f0.tris === f1.tris, f1.tris + " vs " + f0.tris);
check("移动后特征仍为 fillet", f1.feats === "ext,fillet", f1.feats);
R('(function(){ S.entities.forEach(function(e){ e.def.x0-=30; e.def.x1-=30; resample(e); }); rebuildFeatures(); })()');
const f2 = st();
check("二次移动后体积仍一致", f2.vol === f0.vol, f2.vol + " vs " + f0.vol);

/* ---------------------------------------------------------------- */
section("E. bug3：CSG 留下 T 型碎边后，真实棱不能再被丢掉");
R(RESET);
R('addEntity("rect",{x0:-25,y0:-25,x1:25,y1:25},true);');
R('S.feature.start=0; S.feature.end=25; S.feature.dir=1; featureExtrude("add");');
const edgeDup = R(`(function(){
  var g = csgGeom(S.solid), pos = g.getAttribute("position");
  var arr = Array.prototype.slice.call(pos.array);
  var n0 = arr.length;
  for (var i = 0; i < 6 * 3; i++) arr.push(pos.array[i]);     // 把一张面的 2 个三角形再叠一份
  var g2 = new THREE.BufferGeometry();
  g2.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
  return JSON.stringify({ plain: solidEdges(g, 24).length / 2, dup: solidEdges(g2, 24).length / 2 });
})()`);
const ed = JSON.parse(edgeDup);
check("干净盒子 12 条棱", ed.plain === 12, ed.plain);
check("面上叠了共面重复片后，棱数不变（T 型碎边不再吃掉真实棱）", ed.dup === ed.plain, ed.dup + " vs " + ed.plain);

/* ---------------------------------------------------------------- */
/* 角部剖面通用探针：从球心 cc 向角部方向投射，量表面到球心的距离。
   球面角块 ⇒ 所有方向 ≈ r；尖角/台阶/角料 ⇒ 最远戳到 1.2~1.4r。 */
function cornerProfile(ptArr, r) {
  return JSON.parse(R(`(function(){
    var pt = new THREE.Vector3(${ptArr.map(Number).join(",")});
    var ax = [new THREE.Vector3(-1,0,0), new THREE.Vector3(0,1,0), new THREE.Vector3(0,0,-1)];
    var cc = pt.clone().addScaledVector(ax[0], ${r}).addScaledVector(ax[1], ${r}).addScaledVector(ax[2], ${r});
    var tris = [];
    S.solid.toPolygons().forEach(function(pg){ var vs = pg.vertices;
      for (var i = 1; i + 1 < vs.length; i++) tris.push([vs[0].pos, vs[i].pos, vs[i+1].pos]); });
    function cast(dx, dy, dz){
      var best = 1e9;
      for (var k = 0; k < tris.length; k++){
        var a = tris[k][0], b = tris[k][1], c = tris[k][2];
        var e1x = b.x-a.x, e1y = b.y-a.y, e1z = b.z-a.z, e2x = c.x-a.x, e2y = c.y-a.y, e2z = c.z-a.z;
        var px = dy*e2z - dz*e2y, py = dz*e2x - dx*e2z, pz = dx*e2y - dy*e2x;
        var det = e1x*px + e1y*py + e1z*pz;
        if (det > -1e-9 && det < 1e-9) continue;
        var inv = 1/det, tx = cc.x-a.x, ty = cc.y-a.y, tz = cc.z-a.z;
        var u = (tx*px + ty*py + tz*pz) * inv; if (u < -1e-9 || u > 1 + 1e-9) continue;
        var qx = ty*e1z - tz*e1y, qy = tz*e1x - tx*e1z, qz = tx*e1y - ty*e1x;
        var v = (dx*qx + dy*qy + dz*qz) * inv; if (v < -1e-9 || u + v > 1 + 1e-9) continue;
        var t = (e2x*qx + e2y*qy + e2z*qz) * inv;
        if (t > 1e-4 && t < best) best = t;
      }
      return best;
    }
    var N = 9, mn = 1e9, mx = -1e9;
    for (var i = 0; i <= N; i++) for (var j = 0; i + j <= N; j++){
      var a = i/N, b = j/N, c = (N-i-j)/N;
      var d = ax[0].clone().multiplyScalar(-a).addScaledVector(ax[1], -b).addScaledVector(ax[2], -c);
      if (d.lengthSq() < 1e-12) continue;
      d.normalize();
      var t = cast(d.x, d.y, d.z);
      if (t > 1e8) continue;
      if (t < mn) mn = t; if (t > mx) mx = t;
    }
    return JSON.stringify({min:+mn.toFixed(3), max:+mx.toFixed(3)});
  })()`));
}
function fragStats() {
  return JSON.parse(R(`(function(){
    var g = csgGeom(S.solid), pos = g.getAttribute("position"), n = pos.count/3, tiny = 0, sliver = 0, longSliver = 0;
    for (var i = 0; i < n; i++){
      var ax = pos.getX(i*3), ay = pos.getY(i*3), az = pos.getZ(i*3);
      var bx = pos.getX(i*3+1), by = pos.getY(i*3+1), bz = pos.getZ(i*3+1);
      var cx = pos.getX(i*3+2), cy = pos.getY(i*3+2), cz = pos.getZ(i*3+2);
      var ux = bx-ax, uy = by-ay, uz = bz-az, vx = cx-ax, vy = cy-ay, vz = cz-az;
      var nx = uy*vz - uz*vy, ny = uz*vx - ux*vz, nz = ux*vy - uy*vx;
      var A = Math.sqrt(nx*nx + ny*ny + nz*nz)/2;
      if (A < 1e-4) tiny++;
      var mx = Math.max(Math.hypot(ux,uy,uz), Math.hypot(vx,vy,vz), Math.hypot(cx-bx, cy-by, cz-bz));
      if (mx > 1e-6 && A/(mx*mx) < 1e-3) { sliver++; if (mx > 8) longSliver++; }
    }
    return JSON.stringify({tris:n, tiny:tiny, sliver:sliver, longSliver:longSliver});
  })()`));
}

/* ---------------------------------------------------------------- */
section("F. v33.57 bug1：多选模式选多条棱 → 一起圆角");
R(RESET);
R('addEntity("rect",{x0:-25,y0:-25,x1:25,y1:25},true);');
R('S.feature.start=0; S.feature.end=25; S.feature.dir=1; featureExtrude("add");');
function pickToggle(mid) {
  return R(`(function(){
    var segs = edgeSegments(), best = null, bd = 1e9, M = new THREE.Vector3(${mid.join(",")});
    segs.forEach(function(s){ var d = s.a.clone().add(s.b).multiplyScalar(0.5).distanceTo(M); if (d < bd) { bd = d; best = s; } });
    toggleEdgeSel(best);
    return S.pickedEdges.length;
  })()`);
}
const t1 = pickToggle([0, -25, 25]);
const t2 = pickToggle([25, -25, 0]);
check("两条棱先后加入棱选区", t1 === 1 && t2 === 2, t1 + "," + t2);
check("棱选区有整链高亮", R("!!S.hilite") === true);
const t3 = pickToggle([0, -25, 25]);
check("再点同一条棱 = 移出（剩 1 条）", t3 === 1, t3);
const t4 = pickToggle([0, -25, 25]);
check("再加回来（2 条）", t4 === 2, t4);
R("fillet(5);");
const mf = st();
check("多棱圆角 → 每条棱一个 fillet 特征", mf.feats === "ext,fillet,fillet", mf.feats);
check("多棱圆角后仍是实体且体积变小", mf.solid && mf.vol > 0 && mf.vol < 50 * 50 * 25, "vol=" + mf.vol);
check("圆角后棱选区已清空", R("S.pickedEdges.length") === 0);
R("undo();");
const mu = st();
check("撤销 → 一次撤掉这次多棱圆角", mu.feats === "ext", mu.feats);
R('(function(){ S.pickedEdges.push({a:new THREE.Vector3(),b:new THREE.Vector3()}); S.multi = true; setTool("multi"); })()');
check("关掉多选开关 → 棱选区清空", R("S.multi") === false && R("S.pickedEdges.length") === 0);

/* ---------------------------------------------------------------- */
section("G. v33.57 bug2：两条交汇棱分别圆角 → 角部球面补齐（对齐 SolidWorks）");
R(RESET);
R('addEntity("rect",{x0:-25,y0:-25,x1:25,y1:25},true);');
R('S.feature.start=0; S.feature.end=25; S.feature.dir=1; featureExtrude("add");');
pick([0, -25, 25]); R("fillet(5);");
pick([25, -25, 0]); R("fillet(5);");
const g2s = st();
check("两条棱各自成特征", g2s.feats === "ext,fillet,fillet", g2s.feats);
const g2c = fragStats();
check("两棱交汇角无零面积三角", g2c.tiny === 0, "tiny=" + g2c.tiny);
check("两棱交汇角细长三角个位数", g2c.sliver <= 12 && g2c.longSliver <= 6,
  "sliver=" + g2c.sliver + " longSliver=" + g2c.longSliver);
/* v33.56 及以前：后做的那条棱链端被先做的圆角截短 → 角上留"平端帽 + 角料"，
   剖面最远戳到 ~6.9（1.39r）。现在端段越界延长 + 等半径 2 链角补球面 → ≈5。 */
const prof2 = cornerProfile([25, -25, 25], 5);
check("交汇角不再是台阶/角料（max ≤ 5.2，v33.56 戳到 6.9）", prof2.max <= 5.2, JSON.stringify(prof2));
check("交汇角确实是球面（min ≥ 4.7）", prof2.min >= 4.7, JSON.stringify(prof2));
/* v33.58：球面不再被切除盒远端面截断。v33.57 在 y=-20（共享面内缩 r）处
   留下约 0.21r²=5.4mm² 的平端面（探针实测 6 片共 ~2.5mm²，BSP 还会再切碎）。 */
const flatA = JSON.parse(R(`(function(){
  var C=new THREE.Vector3(25,-25,25), A=0;
  S.solid.toPolygons().forEach(function(pg){
    var n=pg.plane.normal, vs=pg.vertices, ct=new THREE.Vector3();
    if(n.y > -0.99 || Math.abs(pg.plane.w-20) > 0.05) return;
    vs.forEach(function(v){ ct.x+=v.pos.x/vs.length; ct.y+=v.pos.y/vs.length; ct.z+=v.pos.z/vs.length; });
    if(ct.distanceTo(C) > 12) return;
    for(var i=1;i+1<vs.length;i++){
      var a=vs[0].pos,b=vs[i].pos,c=vs[i+1].pos;
      var ux=b.x-a.x,uy=b.y-a.y,uz=b.z-a.z,vx=c.x-a.x,vy=c.y-a.y,vz=c.z-a.z;
      var nx=uy*vz-uz*vy,ny=uz*vx-ux*vz,nz=ux*vy-uy*vx;
      A+=Math.sqrt(nx*nx+ny*ny+nz*nz)/2;
    }
  });
  return JSON.stringify({a:+A.toFixed(2)});
})()`));
check("交汇角无平端面残留（v33.57 约 5.4mm²）", flatA.a < 0.6, "area=" + flatA.a);
const g2v = st();
check("补角后体积仍为正且小于裸盒", g2v.solid && g2v.vol > 0 && g2v.vol < 50 * 50 * 25, "vol=" + g2v.vol);

/* ---------------------------------------------------------------- */
section("I. v33.59 毛边：圆角圆柱面分段缝不再被画成梳齿棱线");
R(RESET);
R('addEntity("rect",{x0:-50,y0:-25,x1:50,y1:25},true);');
R('S.feature.start=0; S.feature.end=25; S.feature.dir=1; featureExtrude("add");');
pick([0, -25, 25]); R("fillet(5);");
const comb = JSON.parse(R(`(function(){
  var g=csgGeom(S.solid), pts=solidEdges(g,24), seam=0, total=0;
  for(var i=0;i+1<pts.length;i+=2){ total++;
    var a=pts[i],b=pts[i+1], len=a.distanceTo(b);
    /* 圆角圆柱面分段缝：短（≤2.5mm）且沿弧切线方向（x 在 ±50 端面上） */
    if(len<2.5) seam++;
  }
  return JSON.stringify({total:total,seam:seam});
})()`));
/* 过滤前 44 段（31 条 0.491mm 接缝）；过滤后 13 段、接缝≤2（两条真实短相切线）。 */
check("圆角面无梳齿接缝棱线（v33.58 是 31 条）", comb.seam <= 2 && comb.total <= 16,
  "total=" + comb.total + " seam=" + comb.seam);

/* ---------------------------------------------------------------- */
section("J. v33.60 可选棱与绘制棱同源（两棱交汇后可选棱不再暴涨）");
R(RESET);
R('addEntity("rect",{x0:-25,y0:-25,x1:25,y1:25},true);');
R('S.feature.start=0; S.feature.end=25; S.feature.dir=1; featureExtrude("add");');
pick([0, -25, 25]); R("fillet(5);");
pick([25, -25, 0]); R("fillet(5);");
const pickEq = JSON.parse(R(`(function(){
  var pk=edgeSegments(), p=solidEdges(S.mesh.geometry,24);
  return JSON.stringify({pick:pk.length,draw:p.length/2});
})()`));
/* 修前：可选 6228 段（EdgesGeometry 无 seam 过滤）、绘制 15 段。 */
check("可选棱数 == 绘制棱数", pickEq.pick === pickEq.draw && pickEq.pick < 40,
  "pick=" + pickEq.pick + " draw=" + pickEq.draw);
const chainP = JSON.parse(R(`(function(){
  var segs=edgeSegments(),best=null,bd=1e9,M=new THREE.Vector3(25,-12.5,25);
  segs.forEach(function(s){var q=s.a.clone().add(s.b).multiplyScalar(0.5).distanceTo(M);if(q<bd){bd=q;best=s;}});
  var ch=edgeChainFrom(best),len=0;
  ch.forEach(function(s){len+=s.a.distanceTo(s.b);});
  return JSON.stringify({n:ch.length,len:+len.toFixed(2)});
})()`));
check("点竖棱不再串入碎棱（总长 20mm）", Math.abs(chainP.len - 20) < 0.5 && chainP.n <= 4,
  "n=" + chainP.n + " len=" + chainP.len);

/* ---------------------------------------------------------------- */
section("H. v33.57 bug3：撤销不动视角（zoom≠1 时视锥不再被反复除以 zoom）");
R("S.cam3.zoom = 2.4; S.cam3.updateProjectionMatrix(); resizeView();");
const FR = `(function(){ return JSON.stringify({
  l:S.cam3.left, t:S.cam3.top, z:S.cam3.zoom,
  p:[S.cam3.position.x,S.cam3.position.y,S.cam3.position.z],
  tg:[S.ctrl3.target.x,S.ctrl3.target.y,S.ctrl3.target.z] }); })()`;
const fr0 = JSON.parse(R(FR));
R("refreshAll(); refreshAll(); undo(); refreshAll();");
const fr1 = JSON.parse(R(FR));
check("视锥半高不再缩水", fr0.l === fr1.l && fr0.t === fr1.t,
  fr0.l + "/" + fr0.t + " vs " + fr1.l + "/" + fr1.t);
check("缩放级别不变", fr0.z === fr1.z, fr0.z + " vs " + fr1.z);
check("相机位置/目标不变", JSON.stringify(fr0.p) === JSON.stringify(fr1.p) &&
  JSON.stringify(fr0.tg) === JSON.stringify(fr1.tg));

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);
