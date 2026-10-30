/* 诊断3：用户场景「相贯线显示不全」的定量证据
   ground truth：在相贯体的 6 个面（4 侧面 + 2 端盖）上细采样，找 solidOutside 的零点；
   再与 penetrationCurves() 画出来的折线比覆盖率（每个 GT 点到折线的最近距离）。
   用法: node tests/probe_user_cube3.js [scene] */
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

  /* 6 个面：o 原点, e1/e2 两个切向, h1/h2 半尺寸, tag */
  function faceList(){
    var U=B.U, V=B.V;
    return [
      {o:P.clone().addScaledVector(V,-hs.hh), e1:U, e2:a, h1:hs.hw, h2:L/2, tag:'侧-底(y-)'},
      {o:P.clone().addScaledVector(U, hs.hw), e1:V, e2:a, h1:hs.hh, h2:L/2, tag:'侧-右(x+)'},
      {o:P.clone().addScaledVector(V, hs.hh), e1:U, e2:a, h1:hs.hw, h2:L/2, tag:'侧-顶(y+)'},
      {o:P.clone().addScaledVector(U,-hs.hw), e1:V, e2:a, h1:hs.hh, h2:L/2, tag:'侧-左(x-)'},
      {o:P.clone().addScaledVector(a,-L/2),    e1:U, e2:V, h1:hs.hw, h2:hs.hh, tag:'端盖(z-)'},
      {o:P.clone().addScaledVector(a, L/2),    e1:U, e2:V, h1:hs.hw, h2:hs.hh, tag:'端盖(z+)'}
    ];
  }
  /* 面上零点：先沿 u 逐行扫 v，找符号变化，再对 v 二分（精确到 1e-4） */
  function faceZeroPts(F, M){
    M = M || 240;
    var out = [];
    for(var i=0;i<=M;i++){
      var u = -F.h1 + 2*F.h1*i/M;
      var prev = null, prevF = 0;
      for(var j=0;j<=M;j++){
        var v = -F.h2 + 2*F.h2*j/M;
        var q = F.o.clone().addScaledVector(F.e1,u).addScaledVector(F.e2,v);
        var f = solidOutside(q);
        if(prev && ((prevF<0&&f>=0)||(prevF>0&&f<=0))){
          var lo = prev.clone(), hi = q.clone(), fl = prevF;
          for(var k=0;k<24;k++){
            var mid = lo.clone().lerp(hi,0.5), fm = solidOutside(mid);
            if((fl<0)===(fm<0)){ lo=mid; fl=fm; } else hi=mid;
          }
          out.push({p:lo.clone().lerp(hi,0.5), face:F.tag, u:u});
        }
        prev = q; prevF = f;
      }
    }
    return out;
  }
  var FS = faceList(), gt = [];
  FS.forEach(function(F){ faceZeroPts(F, 240).forEach(function(h){ gt.push(h); }); });

  /* 画出来的折线（densify 后） */
  var curves = penetrationCurves(c);
  var drawn = [];
  curves.forEach(function(pts){
    var d = densifyPolyline(pts, 200);
    d.forEach(function(p){ drawn.push(p); });
  });
  /* 每个 GT 点到 drawn 的最近距离 */
  var worst = 0, far = 0, n = 0, byFace = {};
  gt.forEach(function(h){
    var best = 1e9;
    for(var i=0;i<drawn.length;i++){ var dd = drawn[i].distanceTo(h.p); if(dd<best) best=dd; }
    byFace[h.face] = byFace[h.face] || {n:0, far:0, worst:0};
    byFace[h.face].n++; n++;
    if(best > 1.0){ far++; byFace[h.face].far++; }
    if(best > byFace[h.face].worst) byFace[h.face].worst = +best.toFixed(2);
    if(best > worst) worst = best;
  });
  return {gtN:n, far:far, worst:+worst.toFixed(2), byFace:byFace,
          drawnN:drawn.length, curves:curves.length,
          gtSample: gt.slice(0,8).map(function(h){ return h.face+" ["+h.p.x.toFixed(1)+","+h.p.y.toFixed(1)+","+h.p.z.toFixed(1)+"]"; })};
})()`);

console.log("ground truth 点数 = " + res.gtN + "，画出来的折线点数 = " + res.drawnN + "，链条数 = " + res.curves);
console.log("GT 点里离折线 >1mm 的（=缺画）: " + res.far + " / " + res.gtN + "  (" +
            (100*res.far/res.gtN).toFixed(1) + "%)   最远 " + res.worst + " mm");
console.log("按面统计:");
Object.keys(res.byFace).forEach(function(k){
  var v = res.byFace[k];
  console.log("  " + k + ": gt=" + v.n + "  缺画=" + v.far + "  最远=" + v.worst + "mm");
});
