/* Validate 相贯线 quality: points must lie on BOTH surfaces; chains must be continuous. */
"use strict";
const { boot } = require("./boot");
const app = boot();
function section(t){ console.log("\n===== " + t + " ====="); }
let bad = 0;
function ok(n, c, d){ console.log((c?"  PASS  ":"  FAIL  ")+n+(d?"   ["+d+"]":"")); if(!c) bad++; }

/* helper: max deviation of curve points from a part's surface */
const checkPart = `
function devFromPart(pr, P){
  var inv = new THREE.Matrix4().copy(partMatrix(pr)).invert();
  var q = P.clone().applyMatrix4(inv);
  var rho = Math.hypot(q.x, q.z);
  if(pr.k === "pyr3"){
    /* 棱锥侧面是**平面三角形**，不能用"极坐标半径"去比（三角形截面的边界半径
       在棱方向是 r、在棱间方向是 r/2，公式容易写错）。
       正确做法：到三个侧面平面 + 底面的最小距离。 */
    var H = pr.h, R = pr.r;
    var best = Math.abs(q.y + H/2);                 // 底面
    for(var f=0; f<3; f++){
      var t0 = f/3*Math.PI*2, t1 = (f+1)/3*Math.PI*2;
      var A = new THREE.Vector3(Math.sin(t0)*R, -H/2, Math.cos(t0)*R);
      var B = new THREE.Vector3(Math.sin(t1)*R, -H/2, Math.cos(t1)*R);
      var T = new THREE.Vector3(0, H/2, 0);
      var n = new THREE.Vector3().crossVectors(B.clone().sub(A), T.clone().sub(A));
      var len = n.length(); if(len < 1e-9) continue;
      n.divideScalar(len);
      best = Math.min(best, Math.abs(n.dot(q.clone().sub(A))));
    }
    return best;
  }
  if(pr.k === "box") return Math.min(Math.abs(Math.abs(q.x)-pr.w/2), Math.abs(Math.abs(q.y)-pr.h/2), Math.abs(Math.abs(q.z)-pr.d/2));
  if(pr.k === "cyl") return Math.min(Math.abs(rho-pr.r), Math.abs(Math.abs(q.y)-pr.h/2));
  if(pr.k === "sphere") return Math.abs(q.length()-pr.r);
  if(pr.k === "cone"){ var t2=(q.y+pr.h/2)/pr.h; return Math.min(Math.abs(rho-pr.r*(1-t2)), Math.abs(q.y+pr.h/2)); }
  if(pr.k === "frustum"){ var t3=(q.y+pr.h/2)/pr.h; return Math.min(Math.abs(rho-(pr.r+(pr.rt-pr.r)*t3)), Math.abs(Math.abs(q.y)-pr.h/2)); }
  return 1e9;
}
`;

section("1. 棱锥 vs 长方体：曲线点必须同时在两个表面上");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; showCurves=true;");
app.run("addPart('pyr3'); addPart('box');");
app.run("(function(){ var a=parts[0],b=parts[1]; a.r=24;a.h=50;a.type='horiz';a.x=a.y=a.z=0;" +
        " b.w=90;b.d=90;b.h=26;b.type='horiz';b.x=0;b.y=-18;b.z=0; buildParts(); })()");
const r1 = app.run(`(function(){
  ${checkPart}
  var ch = partPairCurves(0,1), a = parts[0], b = parts[1];
  return ch.map(function(c){
    var da=0, db=0, maxJump=0;
    c.forEach(function(P){ da=Math.max(da, devFromPart(a,P)); db=Math.max(db, devFromPart(b,P)); });
    for(var i=1;i<c.length;i++) maxJump=Math.max(maxJump, c[i].distanceTo(c[i-1]));
    return {n:c.length, devA:Math.round(da*100)/100, devB:Math.round(db*100)/100,
            maxJump:Math.round(maxJump*100)/100};
  });
})()`);
console.log(JSON.stringify(r1,null,1));
ok("曲线点都贴在棱锥表面上", r1.every(function(x){ return x.devA < 1.5; }), JSON.stringify(r1.map(function(x){return x.devA;})));
ok("曲线点都贴在长方体表面上", r1.every(function(x){ return x.devB < 1.5; }), JSON.stringify(r1.map(function(x){return x.devB;})));
ok("相邻点没有跳变", r1.every(function(x){ return x.maxJump < 25; }));

section("2. 圆锥 vs 竖直圆柱（已知解析解：圆）");
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("addPart('cyl');");
app.run("(function(){ var p=parts[0]; p.r=10;p.h=200;p.type='horiz';p.x=p.y=p.z=0; buildParts(); })()");
const r2 = app.run(`(function(){
  ${checkPart}
  var ch = partSolidCurves(0);
  return ch.map(function(c){
    var rs=c.map(function(p){return Math.hypot(p.x,p.z);});
    var ys=c.map(function(p){return p.y;});
    var per=0; for(var i=1;i<c.length;i++) per+=c[i].distanceTo(c[i-1]);
    return {n:c.length, cls:classifyCurve(c),
            rMin:Math.round(Math.min.apply(null,rs)*100)/100, rMax:Math.round(Math.max.apply(null,rs)*100)/100,
            yMin:Math.round(Math.min.apply(null,ys)*100)/100, yMax:Math.round(Math.max.apply(null,ys)*100)/100,
            perim:Math.round(per*100)/100};
  });
})()`);
console.log(JSON.stringify(r2,null,1));
ok("侧面上那条是半径 10 的圆（周长≈62.8）",
   r2.some(function(x){ return Math.abs(x.rMax-10)<0.5 && Math.abs(x.perim-62.83)<3; }));

section("3. 圆柱 vs 圆柱 正交（经典马鞍形相贯线）");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("addPart('cyl'); addPart('cyl');");
app.run("(function(){ var a=parts[0],b=parts[1]; a.r=22;a.h=80;a.type='horiz';a.x=a.y=a.z=0;" +
        " b.r=22;b.h=80;b.type='frontal';b.x=b.y=b.z=0; buildParts(); })()");
const r3 = app.run(`(function(){
  ${checkPart}
  var ch = partPairCurves(0,1);
  return ch.map(function(c){
    var da=0,db=0;
    c.forEach(function(P){ da=Math.max(da,devFromPart(parts[0],P)); db=Math.max(db,devFromPart(parts[1],P)); });
    return {n:c.length, cls:classifyCurve(c), devA:Math.round(da*100)/100, devB:Math.round(db*100)/100};
  });
})()`);
console.log(JSON.stringify(r3,null,1));
ok("两圆柱相贯线贴在两个圆柱面上", r3.every(function(x){ return x.devA<1.5 && x.devB<1.5; }));

section("4. 棱锥 vs 圆柱");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("addPart('pyr3'); addPart('cyl');");
app.run("(function(){ var a=parts[0],b=parts[1]; a.r=26;a.h=50;a.type='horiz';a.x=a.y=a.z=0;" +
        " b.r=10;b.h=100;b.type='frontal';b.x=0;b.y=0;b.z=0; buildParts(); })()");
const r4 = app.run(`(function(){
  ${checkPart}
  var ch = partPairCurves(0,1);
  return ch.map(function(c){
    var da=0,db=0;
    c.forEach(function(P){ da=Math.max(da,devFromPart(parts[0],P)); db=Math.max(db,devFromPart(parts[1],P)); });
    return {n:c.length, devA:Math.round(da*100)/100, devB:Math.round(db*100)/100};
  });
})()`);
console.log(JSON.stringify(r4,null,1));
ok("棱锥 vs 圆柱 相贯线几何正确", r4.length>0 && r4.every(function(x){ return x.devA<2.0 && x.devB<1.5; }));

section("5. 性能：相贯线重建");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("['cyl','sphere','box','cone','frustum','cyl'].forEach(function(k){ addPart(k); });");
app.run("showCurves=true;");
const t0=Date.now();
app.run("buildParts();");
const dt=Date.now()-t0;
console.log("6 部件 + 全部两两相贯线:", dt, "ms");
ok("相贯线重建 < 3s", dt < 3000, dt+"ms");

console.log("\n" + (bad===0 ? "ALL OK" : bad + " FAILURE(S)"));
process.exit(bad?1:0);
