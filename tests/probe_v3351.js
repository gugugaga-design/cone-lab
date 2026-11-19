"use strict";
const path = require("path"); const fs = require("fs"); const vm = require("vm");
const { boot } = require("./boot");
const app = boot();
const R = function (code) { return app.run(code); };
const html = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
const inlines = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const trailer3 = ";globalThis.__RUN=function(c){return eval(c)};";
app.__window.THREE = app.__ctx.THREE;
app.__window.OrbitControls = app.__ctx.THREE.OrbitControls;
(function () { const Stub = app.__ctx.THREE.OrbitControls; const T = app.__ctx.THREE;
  function Patched(object, dom) { Stub.call(this, object, dom);
    this.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_PAN };
    this.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.PAN };
    this.minZoom = 0; this.maxZoom = Infinity; }
  Patched.prototype = Stub.prototype; app.__ctx.THREE.OrbitControls = Patched; })();
const docObj = app.__sandbox.document;
const gebi0 = docObj.getElementById.bind(docObj);
docObj.getElementById = function (id) { const r = gebi0(id); if (r) return r; let out = null;
  (function walk(el) { if (out || !el || !el.children) return;
    for (let i = 0; i < el.children.length; i++) { const c = el.children[i]; if (c.id === id) { out = c; return; } walk(c); }
  })(docObj.body); return out; };
vm.runInContext(inlines[1], app.__ctx, { filename: "csg-inline.js" });
const s3 = inlines[2], ci3 = s3.lastIndexOf("})();");
vm.runInContext(s3.slice(0, ci3) + "\n" + trailer3 + "\n" + s3.slice(ci3), app.__ctx, { filename: "cadlab-inline.js" });
app.__window.CADLab.open();

console.log("splitLoopByAxis:", R("typeof splitLoopByAxis"));
console.log("clipPolyHalf2:", R("typeof clipPolyHalf2"));
console.log("split test:", R('JSON.stringify(splitLoopByAxis([{x:-30,y:-10},{x:-10,y:-10},{x:-10,y:10},{x:-30,y:10}], {x:0,y:0}, {x:0,y:1}).map(function(p){return p.length;}))'));

const probe = `(function(){
  var pl = plane();
  var loops = [{pts:[{x:-30,y:-10},{x:-10,y:-10},{x:-10,y:10},{x:-30,y:10}], ids:[1], area:400, holes:[]}];
  var c = revolveLoops(loops, pl, {x:0,y:1}, {x:0,y:0}, 360);
  if(!c) return "null";
  var vol=0;
  c.toPolygons().forEach(function(pg){
    var vs=pg.vertices;
    for(var i=1;i<vs.length-1;i++){
      var a=vs[0].pos,b=vs[i].pos,cc=vs[i+1].pos;
      vol += a.x*(b.y*cc.z-cc.y*b.z) - a.y*(b.x*cc.z-cc.x*b.z) + a.z*(b.x*cc.y-cc.x*b.y);
    }
  });
  return "polys=" + c.toPolygons().length + " signedVol=" + Math.round(vol/6);
})()`;
console.log("revolveLoops direct:", R(probe));

// 对照：正侧单侧轮廓 + 部分角度；以及拉伸实体的符号基准
const probe2 = `(function(){
  function svol(c){ var vol=0; c.toPolygons().forEach(function(pg){ var vs=pg.vertices;
    for(var i=1;i<vs.length-1;i++){ var a=vs[0].pos,b=vs[i].pos,cc=vs[i+1].pos;
      vol += a.x*(b.y*cc.z-cc.y*b.z) - a.y*(b.x*cc.z-cc.x*b.z) + a.z*(b.x*cc.y-cc.x*b.y); } });
    return Math.round(vol/6); }
  var pl = plane();
  var pos = revolveLoops([{pts:[{x:10,y:-10},{x:30,y:-10},{x:30,y:10},{x:10,y:10}], ids:[1], area:400, holes:[]}], pl, {x:0,y:1}, {x:0,y:0}, 360);
  var neg = revolveLoops([{pts:[{x:-30,y:-10},{x:-10,y:-10},{x:-10,y:10},{x:-30,y:10}], ids:[1], area:400, holes:[]}], pl, {x:0,y:1}, {x:0,y:0}, 360);
  var pos90 = revolveLoops([{pts:[{x:10,y:-10},{x:30,y:-10},{x:30,y:10},{x:10,y:10}], ids:[1], area:400, holes:[]}], pl, {x:0,y:1}, {x:0,y:0}, 90);
  var neg90 = revolveLoops([{pts:[{x:-30,y:-10},{x:-10,y:-10},{x:-10,y:10},{x:-30,y:10}], ids:[1], area:400, holes:[]}], pl, {x:0,y:1}, {x:0,y:0}, 90);
  var ext = extrudeLoops([{pts:[{x:12,y:-6},{x:28,y:-6},{x:28,y:6},{x:12,y:6}], ids:[1], area:192, holes:[]}], pl, {start:0, end:8, dir:1}, false);
  return JSON.stringify({pos360: svol(pos), neg360: svol(neg), pos90: svol(pos90), neg90: svol(neg90), extrude: svol(ext)});
})()`;
console.log("对照组:", R(probe2));

/* S.regionSel 残留检查：旋转后不清区域选择，再画矩形直接拉伸 */
const probe3 = `(function(){
  cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=null;
  S.sketchOn=true; S.planeId="front"; setTool("select"); updateSketch3D();
  addEntity("rect",{x0:-30,y0:-10,x1:-10,y1:10},true);
  // 模拟点选区域（用户点封闭区域内部）
  var live = loopsFromList(collectSketch(false, S.planeId));
  S.regionSel = live.map(function(l){ return regionOfLoop(l); });
  S.feature.axis="v"; S.feature.angle=360; featureRevolve();
  var revVol = S.solid ? 1 : 0;
  // 新画矩形（不清 regionSel，模拟用户流程）
  S.entities.forEach(function(e){ e.sel=false; });
  addEntity("rect",{x0:12,y0:-6,x1:28,y1:6},true);
  S.feature.start=0; S.feature.end=8; S.feature.dir=1;
  featureExtrude("add");
  // 找最后一个特征的轮廓快照，看它拉伸的是哪一块
  var ft = S.features[S.features.length-1];
  var pts = ft.regions && ft.regions[0] ? ft.regions[0].pts : null;
  return JSON.stringify({regionSelLen: S.regionSel ? S.regionSel.length : 0,
    lastFeatRegions: ft.regions ? ft.regions.length : 0,
    firstRegionPts: pts ? pts.slice(0,4).map(function(p){return [Math.round(p.x),Math.round(p.y)];}) : null,
    errors: S.features.map(function(f){return f.error||0;})});
})()`;
console.log("残留regionSel拉伸测试:", R(probe3));

/* bug4: 棱边圆角 */
const probe4 = `(function(){
  cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=null; S.pickedEdge=null;
  S.sketchOn=true; S.planeId="front"; setTool("select"); updateSketch3D();
  addEntity("rect",{x0:-20,y0:-20,x1:20,y1:20},true);
  S.feature.start=0; S.feature.end=20; S.feature.dir=1; featureExtrude("add");
  function svol(c){ var vol=0; c.toPolygons().forEach(function(pg){ var vs=pg.vertices;
    for(var i=1;i<vs.length-1;i++){ var a=vs[0].pos,b=vs[i].pos,cc=vs[i+1].pos;
      vol += a.x*(b.y*cc.z-cc.y*b.z) - a.y*(b.x*cc.z-cc.x*b.z) + a.z*(b.x*cc.y-cc.x*b.y); } });
    return vol/6; }
  var v0 = svol(S.solid);
  var mn={x:1e9,y:1e9,z:1e9}, mx={x:-1e9,y:-1e9,z:-1e9};
  S.solid.toPolygons().forEach(function(pg){ pg.vertices.forEach(function(v){
    mn.x=Math.min(mn.x,v.pos.x);mn.y=Math.min(mn.y,v.pos.y);mn.z=Math.min(mn.z,v.pos.z);
    mx.x=Math.max(mx.x,v.pos.x);mx.y=Math.max(mx.y,v.pos.y);mx.z=Math.max(mx.z,v.pos.z); }); });
  function r2(q){return Math.round(q*10)/10;}
  // 选一条棱：顶面与侧面的交线。顶面 y=mn.y（dir=1 沿 n=[0,-1,0]），侧面 x=mx.x
  var edge = { a: new THREE.Vector3(mx.x, mn.y, mn.z), b: new THREE.Vector3(mx.x, mn.y, mx.z) };
  S.pickedEdge = edge;
  fillet(2);
  var v1 = S.solid ? svol(S.solid) : null;
  var ft = S.features[S.features.length-1];
  return JSON.stringify({bbox:[r2(mn.x),r2(mn.y),r2(mn.z),r2(mx.x),r2(mx.y),r2(mx.z)],
    v0: Math.round(v0), v1: v1===null?null:Math.round(v1),
    dv: v1===null?null:Math.round(v1-v0),
    expectDV: -Math.round((4-Math.PI)*40),
    featErr: ft.error||null});
})()`;
console.log("fillet测试:", R(probe4));

/* bug4b: 旋转体（圆管）上的圆角 —— 拾取的棱是 1/48 段折线 */
const probe4b = `(function(){
  cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=null; S.pickedEdge=null;
  S.sketchOn=true; S.planeId="front"; setTool("select"); updateSketch3D();
  addEntity("rect",{x0:10,y0:-10,x1:30,y1:10},true);
  S.feature.axis="v"; S.feature.angle=360; featureRevolve();
  function svol(c){ var vol=0; c.toPolygons().forEach(function(pg){ var vs=pg.vertices;
    for(var i=1;i<vs.length-1;i++){ var a=vs[0].pos,b=vs[i].pos,cc=vs[i+1].pos;
      vol += a.x*(b.y*cc.z-cc.y*b.z) - a.y*(b.x*cc.z-cc.x*b.z) + a.z*(b.x*cc.y-cc.x*b.y); } });
    return vol/6; }
  var v0 = svol(S.solid);
  var segs = edgeSegments();
  // 找顶端圆环上的棱段：y=+10（顶面），到轴距离=10（内缘）
  var rim = segs.filter(function(s){
    return Math.abs(s.a.y-10)<1e-3 && Math.abs(s.b.y-10)<1e-3 &&
           Math.abs(Math.sqrt(s.a.x*s.a.x+s.a.z*s.a.z)-10)<1e-3; });
  function r2(q){return Math.round(q*10)/10;}
  var res = {rimSegs: rim.length, total: segs.length};
  if(rim.length){
    S.pickedEdge = {a: rim[0].a.clone(), b: rim[0].b.clone()};
    fillet(1.5);
    res.v0 = Math.round(v0); res.v1 = S.solid ? Math.round(svol(S.solid)) : null;
    res.dv = res.v1===null ? null : res.v1-res.v0;
    // 整圈内缘圆角的期望削减量 ≈ (r²−πr²/4)*2π*10 ≈ 0.3226²... (1.5²−π1.5²/4)*2π*10 = 0.483*62.8 ≈ 30.3
    res.expectFull = -Math.round((1.5*1.5-Math.PI*1.5*1.5/4)*2*Math.PI*10);
  }
  return JSON.stringify(res);
})()`;
console.log("旋转体圆角测试:", R(probe4b));

/* bug4b2: 检查旋转体棱段分布，找圆环棱 */
const probe4c = `(function(){
  var segs = edgeSegments();
  var ys = {};
  segs.forEach(function(s){
    var k1 = Math.round(s.a.y*10)/10, k2 = Math.round(s.b.y*10)/10;
    if(k1===k2){ ys[k1] = (ys[k1]||0)+1; }
  });
  var r10 = 0;
  segs.forEach(function(s){
    if(Math.abs(s.a.y - s.b.y) < 1e-6){
      var ra = Math.sqrt(s.a.x*s.a.x+s.a.z*s.a.z), rb = Math.sqrt(s.b.x*s.b.x+s.b.z*s.b.z);
      if(Math.abs(ra-10)<1e-3 && Math.abs(rb-10)<1e-3 && Math.abs(s.a.y-10)<1e-3) r10++;
    }
  });
  return JSON.stringify({flatYs: ys, rimTopInner: r10});
})()`;
console.log("棱段分布:", R(probe4c));

const probe4d = `(function(){
  var segs = edgeSegments();
  var sample = segs.slice(0,6).map(function(s){
    return [[Math.round(s.a.x*10)/10,Math.round(s.a.y*10)/10,Math.round(s.a.z*10)/10],
            [Math.round(s.b.x*10)/10,Math.round(s.b.y*10)/10,Math.round(s.b.z*10)/10]]; });
  var yvals = {};
  segs.forEach(function(s){ var k=Math.round(s.a.y*10)/10+"/"+Math.round(s.b.y*10)/10; yvals[k]=(yvals[k]||0)+1; });
  return JSON.stringify({mesh: !!S.mesh, n: segs.length, sample: sample, ypairs: yvals});
})()`;
console.log("棱段采样:", R(probe4d));

/* bug4c: 修复后的整链圆角 —— 旋转管内缘整圈 */
const probe4e = `(function(){
  cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=null; S.pickedEdge=null;
  S.sketchOn=true; S.planeId="front"; setTool("select"); updateSketch3D();
  addEntity("rect",{x0:10,y0:-10,x1:30,y1:10},true);
  S.feature.axis="v"; S.feature.angle=360; featureRevolve();
  function svol(c){ var vol=0; c.toPolygons().forEach(function(pg){ var vs=pg.vertices;
    for(var i=1;i<vs.length-1;i++){ var a=vs[0].pos,b=vs[i].pos,cc=vs[i+1].pos;
      vol += a.x*(b.y*cc.z-cc.y*b.z) - a.y*(b.x*cc.z-cc.x*b.z) + a.z*(b.x*cc.y-cc.x*b.y); } });
    return vol/6; }
  var v0 = svol(S.solid);
  var segs = edgeSegments();
  var rim = segs.filter(function(s){
    return Math.abs(s.a.z-10)<1e-3 && Math.abs(s.b.z-10)<1e-3 &&
           Math.abs(Math.sqrt(s.a.x*s.a.x+s.a.y*s.a.y)-10)<1e-3 &&
           Math.abs(Math.sqrt(s.b.x*s.b.x+s.b.y*s.b.y)-10)<1e-3; });
  if(!rim.length) return JSON.stringify({err:"no rim segs", n: segs.length});
  S.pickedEdge = {a: rim[0].a.clone(), b: rim[0].b.clone()};
  var chain = edgeChainFrom(S.pickedEdge);
  fillet(1.5);
  function r2(q){return Math.round(q*10)/10;}
  var v1 = S.solid ? svol(S.solid) : null;
  var ft = S.features[S.features.length-1];
  return JSON.stringify({rimSegs: rim.length, chainLen: chain.length,
    v1: v1===null?null:Math.round(v1), dv: v1===null?null:Math.round(v1-v0),
    expectDV: -Math.round((1.5*1.5-Math.PI*1.5*1.5/4)*2*Math.PI*10),
    featErr: ft.error||null});
})()`;
console.log("整链圆角测试:", R(probe4e));

const probe4f = `(function(){
  cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=null; S.pickedEdge=null;
  S.sketchOn=true; S.planeId="front"; setTool("select"); updateSketch3D();
  addEntity("rect",{x0:-20,y0:-20,x1:20,y1:20},true);
  S.feature.start=0; S.feature.end=20; S.feature.dir=1; featureExtrude("add");
  var segs = edgeSegments();
  var picked = { a: new THREE.Vector3(20,-20,-20), b: new THREE.Vector3(20,-20,20) };
  var chain = edgeChainFrom(picked);
  return JSON.stringify({total: segs.length, chainLen: chain.length,
    chain: chain.map(function(s){ return [[Math.round(s.a.x),Math.round(s.a.y),Math.round(s.a.z)],[Math.round(s.b.x),Math.round(s.b.y),Math.round(s.b.z)]]; })});
})()`;
console.log("box棱链:", R(probe4f));

const probe4g = `(function(){
  var segs0 = edgeSegments();
  var tol = 1e-3 * Math.max(1, segs0.reduce(function(m,s){ return Math.max(m, s.a.distanceTo(s.b)); }, 0));
  var out = [];
  segs0.forEach(function(s){
    var dup = out.some(function(u){
      return (u.a.distanceTo(s.a)<=tol && u.b.distanceTo(s.b)<=tol) || (u.a.distanceTo(s.b)<=tol && u.b.distanceTo(s.a)<=tol);
    });
    if(!dup) out.push({a: s.a.clone(), b: s.b.clone()});
  });
  return JSON.stringify({n0: segs0.length, nUniq: out.length, tol: tol,
    segs: segs0.map(function(s){ return [[+s.a.x.toFixed(3),+s.a.y.toFixed(3),+s.a.z.toFixed(3)],[+s.b.x.toFixed(3),+s.b.y.toFixed(3),+s.b.z.toFixed(3)]]; })});
})()`;
console.log("box棱去重:", R(probe4g));

/* 优化1: 多边形弹窗选边数 */
const probe5 = `(function(){
  cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=null;
  S.sketchOn=true; S.planeId="front"; setTool("select"); updateSketch3D();
  var dlgEl0 = document.getElementById("clDlg");
  setTool("polygon");
  var dlgShown = dlgEl0 && dlgEl0.hidden === false;
  var input = document.getElementById("pgN");
  var inputVal = input ? input.value : null;
  if (input) input.value = "5";
  var okBtn = document.getElementById("dlgOk");
  if (okBtn) okBtn.dispatch ? okBtn.dispatch("click") : okBtn.click();
  var dlgClosed = dlgEl0 ? dlgEl0.hidden !== false : true;
  var toolKept = S.tool === "polygon";
  // 画一个五边形：中心 (0,0)，半径 10
  var e = null;
  try {
    S.cornerStart = {x:0,y:0};
    S.drag = {x:10,y:0};
    e = commitDraw ? commitDraw() : null;
    if (!e) { tap(0,0); tap(10,0); e = S.entities[S.entities.length-1]; }
  } catch(err) { e = null; window.__pgErr = err.message; }
  return JSON.stringify({dlgShown: dlgShown, inputVal: inputVal, dlgClosed: dlgClosed,
    toolKept: toolKept, polyN: e && e.kind==="polygon" ? e.def.n : (e ? e.kind : String(e)),
    err: window.__pgErr || null, nEnts: S.entities.length});
})()`;
console.log("多边形弹窗测试:", R(probe5));

const probe5b = `(function(){
  S.polygonN = 5;
  var pv = previewFrom("polygon", {x:0,y:0}, {x:10,y:0});
  S.polygonN = 7;
  var pv7 = previewFrom("polygon", {x:0,y:0}, {x:10,y:0});
  S.polygonN = 6;
  return JSON.stringify({n5: pv ? pv.def.n : null, n7: pv7 ? pv7.def.n : null});
})()`;
console.log("previewFrom 边数:", R(probe5b));

/* v33.52：旋转轴锚点偏移（用户截图2：轴线画在草图左上角，实体整体平移 54.5） */
function bboxOf(){
  return R(`(function(){
    if(!S.solid) return null;
    var mn={x:1e9,y:1e9,z:1e9}, mx={x:-1e9,y:-1e9,z:-1e9};
    S.solid.toPolygons().forEach(function(pg){ pg.vertices.forEach(function(v){
      mn.x=Math.min(mn.x,v.pos.x);mn.y=Math.min(mn.y,v.pos.y);mn.z=Math.min(mn.z,v.pos.z);
      mx.x=Math.max(mx.x,v.pos.x);mx.y=Math.max(mx.y,v.pos.y);mx.z=Math.max(mx.z,v.pos.z); }); });
    var r2=function(q){return Math.round(q*10)/10;};
    return [r2(mn.x),r2(mn.y),r2(mn.z),r2(mx.x),r2(mx.y),r2(mx.z)];
  })()`);
}
function benchReset(){
  R('cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=null; S.pickedEdge=null; S.sketchOn=true; S.planeId="front"; setTool("select"); updateSketch3D();');
}

console.log("=== I: 轴线过原点（起点不在原点）===");
benchReset();
R('addEntity("rect",{x0:-30,y0:-10,x1:-10,y1:10},false)');
R('addEntity("line",{ax:0,ay:-40,bx:0,by:40},false)');
R('S.entities.forEach(function(e){e.sel=true;}); S.feature.axis="line"; S.feature.angle=360; featureRevolve()');
console.log("bbox:", JSON.stringify(bboxOf()), " 期望 z ∈ [-10,10]（修复前是 [30,50]）");

console.log("=== J: 轴线不过原点（u=20 处的竖线）===");
benchReset();
R('addEntity("rect",{x0:25,y0:-10,x1:35,y1:10},false)');
R('addEntity("line",{ax:20,ay:-40,bx:20,by:40},false)');
R('S.entities.forEach(function(e){e.sel=true;}); S.feature.axis="line"; S.feature.angle=360; featureRevolve()');
console.log("bbox:", JSON.stringify(bboxOf()), " 期望 x∈[5,35] y∈[-15,15] z∈[-10,10]");

console.log("=== K: 轴线自上而下画（用户截图2 的形态：起点在草图顶角）===");
benchReset();
R('addEntity("rect",{x0:0,y0:-30,x1:20,y1:-10},false)');
R('addEntity("line",{ax:0,ay:-10,bx:0,by:44.5},false)');   // 起点在草图顶边，向上 54.5
R('S.entities.forEach(function(e){e.sel=true;}); S.feature.axis="line"; S.feature.angle=360; featureRevolve()');
console.log("bbox:", JSON.stringify(bboxOf()), " 期望 z∈[-30,-10]（不再被轴起点平移 54.5）");

/* v33.52 bug4b：点实体棱边（真事件流）—— 以前被"区域选中"吃掉 */
const pickProbe = `(function(){
  benchResetFn();
  addEntity("rect",{x0:-20,y0:-20,x1:20,y1:20},true);
  S.feature.start=0; S.feature.end=20; S.feature.dir=1; featureExtrude("add");
  // 取一条顶棱的中点，投影到屏幕
  var segs = edgeSegments();
  if(!segs.length) return "no segs";
  var seg = segs.filter(function(s){ return Math.abs(s.a.y - s.b.y) < 1e-6 && Math.abs(s.a.y - (-20)) < 1e-6; })[0] || segs[0];
  var mid = seg.a.clone().add(seg.b).multiplyScalar(0.5).project(S.cam3);
  var r = view.getBoundingClientRect();
  return JSON.stringify({x: r.left + (mid.x*0.5+0.5)*r.width, y: r.top + (-mid.y*0.5+0.5)*r.height,
    seg: [[+seg.a.x.toFixed(1),+seg.a.y.toFixed(1),+seg.a.z.toFixed(1)],[+seg.b.x.toFixed(1),+seg.b.y.toFixed(1),+seg.b.z.toFixed(1)]]});
})()`;
/* 注意：probe_v3351 是"多段独立 probe"的集合，这里需要 bench 重置函数 */
const setup = `globalThis.benchResetFn = function(){
  cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=null; S.pickedEdge=null;
  S.sketchOn=true; S.planeId="front"; setTool("select"); updateSketch3D(); facePlane();
  S.cam3.updateMatrixWorld(true);
};`;
R(setup);
const pos = JSON.parse(R(pickProbe));
console.log("棱边屏幕位置:", JSON.stringify(pos));

/* 在该像素点真事件点一下，看能否选中棱边 */
const tapRes = R(`(function(){
  var x = ${pos.x}, y = ${pos.y};
  var el = view;
  function ev(t, b){ return {type:t, clientX:x, clientY:y, pointerId:7, pointerType:'touch', isPrimary:true, button:0, buttons:b,
    preventDefault:function(){}, stopPropagation:function(){}, target:el}; }
  el.dispatch("pointerdown", ev("pointerdown", 1));
  el.dispatch("pointerup", ev("pointerup", 0));
  return JSON.stringify({
    picked: S.pickedEdge ? [[+S.pickedEdge.a.x.toFixed(1),+S.pickedEdge.a.y.toFixed(1),+S.pickedEdge.a.z.toFixed(1)],
                             [+S.pickedEdge.b.x.toFixed(1),+S.pickedEdge.b.y.toFixed(1),+S.pickedEdge.b.z.toFixed(1)]] : null,
    regionSel: S.regionSel ? S.regionSel.length : 0,
    hilite: !!(typeof S !== "undefined" && S.hilite)
  });
})()`);
console.log("点棱边结果:", tapRes);

/* 选到棱后直接做圆角 */
const filletRes = R(`(function(){
  if(!S.pickedEdge) return "no pickedEdge";
  function svol(c){ var vol=0; c.toPolygons().forEach(function(pg){ var vs=pg.vertices;
    for(var i=1;i<vs.length-1;i++){ var a=vs[0].pos,b=vs[i].pos,cc=vs[i+1].pos;
      vol += a.x*(b.y*cc.z-cc.y*b.z) - a.y*(b.x*cc.z-cc.x*b.z) + a.z*(b.x*cc.y-cc.x*b.y); } });
    return vol/6; }
  var v0 = svol(S.solid);
  fillet(2);
  var v1 = S.solid ? svol(S.solid) : null;
  return JSON.stringify({dv: v1===null?null:Math.round(v1-v0), chain: (S.features[S.features.length-1].chain||[]).length,
    err: S.features[S.features.length-1].error||null});
})()`);
console.log("圆角结果:", filletRes);

const dbgPick = R(`(function(){
  var x = ${pos.x}, y = ${pos.y};
  var r = view.getBoundingClientRect();
  var seg1 = pickEdgeNearScreen({clientX:x, clientY:y}, 14);
  var seg2 = pickEdgeAt(x, y);
  return JSON.stringify({
    rect: [r.left, r.top, r.width, r.height],
    cam: S.cam3 ? [S.cam3.type, S.cam3.position.toArray().map(function(v){return +v.toFixed(1);})] : null,
    near: seg1 ? [[+seg1.a.x.toFixed(1),+seg1.a.y.toFixed(1),+seg1.a.z.toFixed(1)],[+seg1.b.x.toFixed(1),+seg1.b.y.toFixed(1),+seg1.b.z.toFixed(1)]] : null,
    ray: seg2 ? "hit" : null,
    solid: !!S.solid, edges: !!S.edges, segCount: edgeSegments().length
  });
})()`);
console.log("拾取调试:", dbgPick);

const dbg2 = R(`(function(){
  var r = view.getBoundingClientRect();
  var px = ${pos.x}, py = ${pos.y};
  var out = [];
  edgeSegments().forEach(function(sg){
    var a = sg.a.clone().project(S.cam3), b = sg.b.clone().project(S.cam3);
    var ax = (a.x*0.5+0.5)*r.width, ay = (-a.y*0.5+0.5)*r.height;
    var bx = (b.x*0.5+0.5)*r.width, by = (-b.y*0.5+0.5)*r.height;
    var dx = bx-ax, dy = by-ay, l2 = dx*dx+dy*dy;
    var t = l2 < 1e-9 ? 0 : Math.max(0, Math.min(1, ((px-ax)*dx + (py-ay)*dy)/l2));
    var d = Math.hypot(px-(ax+dx*t), py-(ay+dy*t));
    out.push({seg: [[+sg.a.x.toFixed(1),+sg.a.y.toFixed(1),+sg.a.z.toFixed(1)],[+sg.b.x.toFixed(1),+sg.b.y.toFixed(1),+sg.b.z.toFixed(1)]],
      scr: [[+ax.toFixed(0),+ay.toFixed(0)],[+bx.toFixed(0),+by.toFixed(0)]], d: +d.toFixed(1)});
  });
  out.sort(function(u,v){ return u.d - v.d; });
  return JSON.stringify(out.slice(0,5));
})()`);
console.log("最近的5条棱（像素距离）:", dbg2);

/* 逐条棱测圆角是否真的生效（每条都重置状态） */
const edgeFilletTest = R(`(function(){
  function svol(c){ var vol=0; c.toPolygons().forEach(function(pg){ var vs=pg.vertices;
    for(var i=1;i<vs.length-1;i++){ var a=vs[0].pos,b=vs[i].pos,cc=vs[i+1].pos;
      vol += a.x*(b.y*cc.z-cc.y*b.z) - a.y*(b.x*cc.z-cc.x*b.z) + a.z*(b.x*cc.y-cc.x*b.y); } });
    return vol/6; }
  function build(){
    cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=[]; S.pickedEdge=null;
    S.sketchOn=true; S.planeId="front"; setTool("select"); updateSketch3D();
    addEntity("rect",{x0:-20,y0:-20,x1:20,y1:20},true);
    S.feature.start=0; S.feature.end=20; S.feature.dir=1; featureExtrude("add");
  }
  var out = [];
  var cases = [
    ["底前棱 y=-20,z=-20", [-20,-20,-20], [20,-20,-20]],
    ["侧棱 x=20,y=-20",    [20,-20,-20], [20,-20,20]],
    ["顶后棱 y=0,z=-20",   [-20,0,-20],  [20,0,-20]],
    ["侧棱 x=-20,y=0",     [-20,0,-20],  [-20,0,20]]
  ];
  cases.forEach(function(cs){
    build();
    var v0 = svol(S.solid);
    S.pickedEdge = { a: new THREE.Vector3(cs[1][0],cs[1][1],cs[1][2]), b: new THREE.Vector3(cs[2][0],cs[2][1],cs[2][2]) };
    fillet(2);
    var ft = S.features[S.features.length-1];
    var v1 = S.solid ? svol(S.solid) : null;
    out.push({name: cs[0], dv: v1===null?null:Math.round(v1-v0), chain: (ft.chain||[]).length, err: ft.error||null,
              isFillet: ft.t});
  });
  return JSON.stringify(out);
})()`);
console.log("逐棱圆角:", edgeFilletTest);

const dbgFillet = R(`(function(){
  cancelDraw(); S.pointers={}; S.entities=[]; S.features=[]; S.solid=null; S.regionSel=[]; S.pickedEdge=null;
  S.sketchOn=true; S.planeId="front"; setTool("select"); updateSketch3D();
  addEntity("rect",{x0:-20,y0:-20,x1:20,y1:20},true);
  S.feature.start=0; S.feature.end=20; S.feature.dir=1; featureExtrude("add");
  var seg = { a: new THREE.Vector3(-20,0,-20), b: new THREE.Vector3(20,0,-20) };
  var norms = faceNormalsNearCsg(S.solid, seg).map(function(n){ return [+n.x.toFixed(2),+n.y.toFixed(2),+n.z.toFixed(2)]; });
  var cut = filletCutter(S.solid, seg, 2);
  var info = null;
  if(cut){
    var mn={x:1e9,y:1e9,z:1e9}, mx={x:-1e9,y:-1e9,z:-1e9};
    cut.toPolygons().forEach(function(pg){ pg.vertices.forEach(function(v){
      mn.x=Math.min(mn.x,v.pos.x);mn.y=Math.min(mn.y,v.pos.y);mn.z=Math.min(mn.z,v.pos.z);
      mx.x=Math.max(mx.x,v.pos.x);mx.y=Math.max(mx.y,v.pos.y);mx.z=Math.max(mx.z,v.pos.z); }); });
    var r2=function(q){return Math.round(q*10)/10;};
    info = [r2(mn.x),r2(mn.y),r2(mn.z),r2(mx.x),r2(mx.y),r2(mx.z)];
  }
  return JSON.stringify({norms: norms, cutterBBox: info});
})()`);
console.log("失败棱的法向/切除体:", dbgFillet);
