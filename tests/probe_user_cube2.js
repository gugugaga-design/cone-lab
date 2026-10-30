/* 诊断2：用户场景（圆锥 + 实体正方体 x=-29 y=-22.5 z=0 棱长29）
   1) 打印每条相贯线链条的原始点，逐个点验证是否同时落在"锥面"和"立方体表面"上；
   2) 用解析/暴力采样求出真实的 立方体表面 ∩ 锥面 全集（6 个面各采样），
      再和 penetrationCurves 的结果比覆盖率 —— 定位到底缺哪一段。
   用法: node tests/probe_user_cube2.js */
"use strict";
const { boot } = require("./boot");
const app = boot();

const res = app.run(`(function(){
  applyShape('cone');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  cutShape = 'sq'; cutHole = false;
  addCyl('frontal');
  var c = cyls[0];
  c.w = 29; c.h = 29; c.len = 29; c.x = -29; c.y = -22.5; c.z = 0; c.on = true; c.hole = false;
  renderCylList(); mode = 'all'; refresh();

  var a = cylAxis(c), P = cylPoint(c), B = cylBasis(a), hs = cutHalf(c), L = bodyLen(c);

  /* 立方体 6 个面：世界坐标下的"面定义"（点 + 两个切向 + 法向 + 半尺寸） */
  function faceOf(k){
    // k=0..3 侧面（对应 perimeter 的 4 条边方向），4/5 = 端盖
    var U=B.U, V=B.V, ax=a;
    if(k===0) return {o:P.clone().addScaledVector(V,-hs.hh), e1:U, e2:ax, h1:hs.hw, h2:L/2, n:V.clone().negate(), tag:'-V 面'};
    if(k===1) return {o:P.clone().addScaledVector(U, hs.hw), e1:V, e2:ax, h1:hs.hh, h2:L/2, n:U, tag:'+U 面'};
    if(k===2) return {o:P.clone().addScaledVector(V, hs.hh), e1:U, e2:ax, h1:hs.hw, h2:L/2, n:V, tag:'+V 面'};
    if(k===3) return {o:P.clone().addScaledVector(U,-hs.hw), e1:V, e2:ax, h1:hs.hh, h2:L/2, n:U.clone().negate(), tag:'-U 面'};
    if(k===4) return {o:P.clone().addScaledVector(ax,-L/2), e1:U, e2:V, h1:hs.hw, h2:hs.hh, n:ax.clone().negate(), tag:'-轴向端盖'};
    return {o:P.clone().addScaledVector(ax, L/2), e1:U, e2:V, h1:hs.hw, h2:hs.hh, n:ax, tag:'+轴向端盖'};
  }
  /* 在每个面上取样，找 solidOutside 的零点（只在该面内），返回点列 */
  function faceCurve(k, N){
    var F = faceOf(k), M = N || 120, pts = [];
    for(var i=0;i<=M;i++){
      for(var j=0;j<=M;j++){
        var u = (-1 + 2*i/M)*F.h1, v = (-1 + 2*j/M)*F.h2;
        var q = F.o.clone().addScaledVector(F.e1,u).addScaledVector(F.e2,v);
        var f = solidOutside(q);
        if(Math.abs(f) < 0.02) pts.push(q);
      }
    }
    return pts;
  }
  var out = {faces:[], samples:[]};
  for(var k=0;k<6;k++){
    var ps = faceCurve(k, 100);
    out.faces.push({tag:faceOf(k).tag, n:ps.length});
    /* 抽 6 个点看坐标 */
    out.samples.push(ps.filter(function(_,i){ return i % Math.max(1, Math.ceil(ps.length/6)) === 0; })
      .slice(0,6).map(function(p){ return [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)]; }));
  }

  /* penetrationCurves 结果 + 每个点是否贴在锥面/立方体表面 */
  function distCone(p){
    return Math.abs(Math.hypot(p.x,p.z) - radiusAt(p.y));
  }
  function distBox(p){
    var q = p.clone().sub(P);
    var t = q.dot(a);
    var w = q.clone().addScaledVector(a, -t);
    return Math.min(Math.abs(Math.abs(w.dot(B.U)) - hs.hw), Math.abs(Math.abs(w.dot(B.V)) - hs.hh), Math.abs(Math.abs(t) - L/2));
  }
  var curves = penetrationCurves(c);
  out.curves = curves.map(function(pts){
    var dc=0, db=0;
    pts.forEach(function(p){ dc = Math.max(dc, distCone(p)); db = Math.max(db, distBox(p)); });
    return {n:pts.length, devCone:+dc.toFixed(2), devBox:+db.toFixed(2),
            pts:pts.map(function(p){ return [+p.x.toFixed(1), +p.y.toFixed(1), +p.z.toFixed(1)]; })};
  });
  return out;
})()`);

console.log("== 立方体 6 个面各自的 锥面∩面 取样点数 ==");
res.faces.forEach(function(f, i){
  console.log("  " + f.tag + " : " + f.n + " 点  e.g. " + JSON.stringify(res.samples[i]));
});
console.log("\n== penetrationCurves 结果 ==");
res.curves.forEach(function(c, i){
  console.log("  #" + i + " n=" + c.n + " devCone=" + c.devCone + " devBox=" + c.devBox);
  console.log("     " + JSON.stringify(c.pts));
});
