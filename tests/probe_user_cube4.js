/* 诊断4：把"缺画"的 GT 点按位置分类，判断是①端盖没采样 ②侧棱拐角断链 ③母线太稀
   用法: node tests/probe_user_cube4.js */
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
  function faceList(){
    var U=B.U, V=B.V;
    return [
      {o:P.clone().addScaledVector(V,-hs.hh), e1:U, e2:a, h1:hs.hw, h2:L/2, tag:'lat-y-'},
      {o:P.clone().addScaledVector(U, hs.hw), e1:V, e2:a, h1:hs.hh, h2:L/2, tag:'lat-x+'},
      {o:P.clone().addScaledVector(V, hs.hh), e1:U, e2:a, h1:hs.hw, h2:L/2, tag:'lat-y+'},
      {o:P.clone().addScaledVector(U,-hs.hw), e1:V, e2:a, h1:hs.hh, h2:L/2, tag:'lat-x-'},
      {o:P.clone().addScaledVector(a,-L/2),    e1:U, e2:V, h1:hs.hw, h2:hs.hh, tag:'cap-z-'},
      {o:P.clone().addScaledVector(a, L/2),    e1:U, e2:V, h1:hs.hw, h2:hs.hh, tag:'cap-z+'}
    ];
  }
  function zeroPts(F, M){
    var out = [];
    for(var i=0;i<=M;i++){
      var u = -F.h1 + 2*F.h1*i/M, prev = null, prevF = 0;
      for(var j=0;j<=M;j++){
        var v = -F.h2 + 2*F.h2*j/M;
        var q = F.o.clone().addScaledVector(F.e1,u).addScaledVector(F.e2,v);
        var f = solidOutside(q);
        if(prev && ((prevF<0&&f>=0)||(prevF>0&&f<=0))){
          var lo=prev.clone(), hi=q.clone(), fl=prevF;
          for(var k=0;k<24;k++){
            var mid=lo.clone().lerp(hi,0.5), fm=solidOutside(mid);
            if((fl<0)===(fm<0)){lo=mid;fl=fm;}else hi=mid;
          }
          out.push({p:lo.clone().lerp(hi,0.5), face:F.tag, u:u, v:v});
        }
        prev=q; prevF=f;
      }
    }
    return out;
  }
  var gt = [];
  faceList().forEach(function(F){ zeroPts(F, 240).forEach(function(h){ gt.push(h); }); });

  function coverage(curves){
    var drawn = [];
    curves.forEach(function(pts){ densifyPolyline(pts, 200).forEach(function(p){ drawn.push(p); }); });
    var miss = [];
    gt.forEach(function(h){
      var best=1e9;
      for(var i=0;i<drawn.length;i++){ var d=drawn[i].distanceTo(h.p); if(d<best)best=d; }
      if(best>1.0) miss.push({p:h.p, face:h.face, d:best});
    });
    return miss;
  }
  var base = coverage(penetrationCurves(c));

  /* 只统计"侧面上"的 GT，看看侧面本身有没有漏 */
  var sideMiss = base.filter(function(m){ return m.face.indexOf('lat')===0; });
  var capMiss  = base.filter(function(m){ return m.face.indexOf('cap')===0; });
  function describe(list){
    return list.slice(0,20).map(function(m){
      return m.face+" ["+m.p.x.toFixed(1)+","+m.p.y.toFixed(1)+","+m.p.z.toFixed(1)+"] d="+m.d.toFixed(2);
    });
  }
  /* 侧面上漏掉的点的 t（沿轴坐标）分布 */
  var tdist = sideMiss.map(function(m){ return +(m.p.clone().sub(P).dot(a)).toFixed(1); });
  var hist = {};
  tdist.forEach(function(t){ var b = Math.round(t); hist[b]=(hist[b]||0)+1; });

  return {gtN:gt.length, missN:base.length,
          sideMissN:sideMiss.length, capMissN:capMiss.length,
          sideSamples:describe(sideMiss), capSamples:describe(capMiss.slice(0,6)),
          tHist:hist,
          nCurves:penetrationCurves(c).length,
          chainLens: penetrationCurves(c).map(function(p){return p.length;})};
})()`);

console.log("GT=" + res.gtN + " 缺=" + res.missN + " (侧面缺 " + res.sideMissN + " / 端盖缺 " + res.capMissN + ")");
console.log("链条数=" + res.nCurves + " 各链点数=" + JSON.stringify(res.chainLens));
console.log("侧面缺失点的轴向坐标 t 直方图: " + JSON.stringify(res.tHist));
console.log("侧面缺失样例:");
res.sideSamples.forEach(function(s){ console.log("   " + s); });
console.log("端盖缺失样例:");
res.capSamples.forEach(function(s){ console.log("   " + s); });
