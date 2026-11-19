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
  pickAndFillet([25, -25, 0]),
  pickAndFillet([25, -12.5, 25])
];
const corners = R(`(function(){
  var g=csgGeom(S.solid), pos=g.getAttribute("position"), n=pos.count/3, tiny=0, sliver=0;
  for (var i=0;i<n;i++){
    var ax=pos.getX(i*3),ay=pos.getY(i*3),az=pos.getZ(i*3);
    var bx=pos.getX(i*3+1),by=pos.getY(i*3+1),bz=pos.getZ(i*3+1);
    var cx=pos.getX(i*3+2),cy=pos.getY(i*3+2),cz=pos.getZ(i*3+2);
    var ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
    var nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx;
    var A=Math.sqrt(nx*nx+ny*ny+nz*nz)/2;
    if (A < 1e-4) tiny++;
    var mx=Math.max(Math.hypot(ux,uy,uz),Math.hypot(vx,vy,vz),Math.hypot(cx-bx,cy-by,cz-bz));
    if (mx>1e-6 && A/(mx*mx) < 1e-3) sliver++;
  }
  return JSON.stringify({tris:n, tiny:tiny, sliver:sliver, chains:${JSON.stringify(chainLens)}});
})()`);
const cp = JSON.parse(corners);
check("三条棱的棱链都是单段（不再溜进圆角弧）", cp.chains.join() === "1,1,1", cp.chains.join());
check("没有零面积三角形（毛边来源）", cp.tiny === 0, "tiny=" + cp.tiny);
check("没有细长毛边三角形", cp.sliver === 0, "sliver=" + cp.sliver);
check("三角形数保持量级（旧版 16535）", cp.tris < 800, "tris=" + cp.tris);

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

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);
