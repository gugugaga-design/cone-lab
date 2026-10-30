/* 诊断：用户报的「圆锥 + 实体相贯正方体（左右-29，高低-22.5，前后0，棱长29）相贯线显示不全」
   打印相贯线链条数、每条的点数/跨度/闭合性，以及逐母线命中情况。
   用法: node tests/probe_user_cube.js [NS] [NT] */
"use strict";
const { boot } = require("./boot");
const app = boot();

const NS = parseInt(process.argv[2] || "0", 10) || 0;

const res = app.run(`(function(){
  applyShape('cone');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  cutShape = 'sq'; cutHole = false;
  addCyl('frontal');
  var c = cyls[0];
  c.w = 29; c.h = 29; c.len = 29; c.x = -29; c.y = -22.5; c.z = 0; c.on = true; c.hole = false;
  renderCylList(); mode = 'all'; refresh();
  var a = cylAxis(c), P = cylPoint(c), B = cylBasis(a);
  var L = bodyLen(c);
  var out = {ax:[a.x,a.y,a.z], P:[P.x,P.y,P.z], len:c.len};
  var curves = penetrationCurves(c);
  out.nCurves = curves.length;
  out.curves = curves.map(function(pts){
    var per = 0, i;
    for(i=1;i<pts.length;i++) per += pts[i].distanceTo(pts[i-1]);
    var close = pts[0].distanceTo(pts[pts.length-1]);
    var bb = {x:[1e9,-1e9], y:[1e9,-1e9], z:[1e9,-1e9]};
    pts.forEach(function(p){
      bb.x[0]=Math.min(bb.x[0],p.x); bb.x[1]=Math.max(bb.x[1],p.x);
      bb.y[0]=Math.min(bb.y[0],p.y); bb.y[1]=Math.max(bb.y[1],p.y);
      bb.z[0]=Math.min(bb.z[0],p.z); bb.z[1]=Math.max(bb.z[1],p.z);
    });
    return {n:pts.length, per:+per.toFixed(2), closeGap:+close.toFixed(2),
            bb:bb, cls:classifyCurve(pts)};
  });
  /* 逐母线（每条 s）统计命中数，看看有没有"本该有交点却漏掉"的母线 */
  var NSs = (c.shape === 'cyl') ? 144 : 112, NTt = 84;
  var perS = [];
  for(var si=0; si<NSs; si++){
    var s = si/NSs, hits = 0, prev = null, prevF = 0;
    for(var ti=0; ti<=NTt; ti++){
      var pt = bodySurfPoint(c, s, ti/NTt, B, a, P);
      var f = solidOutside(pt);
      if(prev && ((prevF < 0 && f >= 0) || (prevF > 0 && f <= 0))) hits++;
      prev = pt; prevF = f;
    }
    perS.push(hits);
  }
  out.perS = perS;
  var hist = {};
  perS.forEach(function(h){ hist[h] = (hist[h]||0)+1; });
  out.hist = hist;
  /* 连续性：命中数为 1 的母线是否成段 */
  var zs = [];
  for(var i2=0;i2<perS.length;i2++){
    if(perS[i2]===0){
      var st = i2;
      while(i2<perS.length && perS[i2]===0) i2++;
      zs.push([st, i2-1, i2-st]);
    }
  }
  out.zeroRuns = zs;
  return out;
})()`);

console.log("ax=" + JSON.stringify(res.ax), "P=" + JSON.stringify(res.P), "len=" + res.len);
console.log("nCurves=" + res.nCurves);
res.curves.forEach(function(c, i){
  console.log("  #" + i + " pts=" + c.n + " perim=" + c.per + " closeGap=" + c.closeGap +
              " cls=" + c.cls + " bb=" + JSON.stringify(c.bb));
});
console.log("hit histogram over side lines: " + JSON.stringify(res.hist));
console.log("zero-hit runs (s index) : " + JSON.stringify(res.zeroRuns));
