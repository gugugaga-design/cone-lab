/* v33.27 回归：相贯线覆盖率（主立体 ∩ 相贯体）
   判据：在相贯体的**全部表面**上细采样求 ground truth 零点，
   每个 GT 点到画出来的折线必须 < 1mm；且链条要连成整条（不能碎成多段）。
   覆盖用户场景 + 圆柱/方/矩形 × 6 种面型 + 8 种立体。 */
"use strict";
const { boot } = require("./boot");
const app = boot();

let pass = 0, fail = 0;
function ok(n, c, d){
  console.log((c ? "  PASS  " : "  FAIL  ") + n + (d ? "   [" + d + "]" : ""));
  if(c) pass++; else fail++;
}

const HELPER = `
function gtPoints(c, M){
  /* 与 p1.html 内部同一套"全部表面"，但采样更密，用来当 ground truth */
  var a = cylAxis(c), P = cylPoint(c), B = cylBasis(a);
  var L = bodyLen(c), hs = cutHalf(c), out = [];
  var finite = (c.len > 0);
  function scan(fn, nu, nv){
    for(var i=0;i<=nv;i++){
      var prev = null, prevF = 0;
      for(var j=0;j<=nu;j++){
        var q = fn(i/nv, j/nu);
        var f = solidOutside(q);
        if(prev && ((prevF<0&&f>=0)||(prevF>0&&f<=0))){
          var lo=prev.clone(), hi=q.clone(), fl=prevF;
          for(var k=0;k<20;k++){
            var mid=lo.clone().lerp(hi,0.5), fm=solidOutside(mid);
            if((fl<0)===(fm<0)){lo=mid;fl=fm;}else hi=mid;
          }
          out.push(lo.clone().lerp(hi,0.5));
        }
        prev=q; prevF=f;
      }
    }
  }
  if(c.shape === "cyl"){
    scan(function(u,v){ var th=u*Math.PI*2;
      return P.clone().addScaledVector(a,(v-0.5)*L)
        .addScaledVector(B.U,Math.cos(th)*c.r).addScaledVector(B.V,Math.sin(th)*c.r); }, 300, 60);
    if(finite) [1,-1].forEach(function(sg){
      scan(function(u,v){ var th=u*Math.PI*2, rr=c.r*v;
        return P.clone().addScaledVector(a,sg*L/2)
          .addScaledVector(B.U,Math.cos(th)*rr).addScaledVector(B.V,Math.sin(th)*rr); }, 200, 12);
    });
  } else {
    var w2=hs.hw, h2=hs.hh, U=B.U, V=B.V;
    scan(function(u,v){ return P.clone().addScaledVector(U,(u-0.5)*2*w2).addScaledVector(V,-h2).addScaledVector(a,(v-0.5)*L); }, 200, 60);
    scan(function(u,v){ return P.clone().addScaledVector(U,w2).addScaledVector(V,(u-0.5)*2*h2).addScaledVector(a,(v-0.5)*L); }, 200, 60);
    scan(function(u,v){ return P.clone().addScaledVector(U,(u-0.5)*2*w2).addScaledVector(V,h2).addScaledVector(a,(v-0.5)*L); }, 200, 60);
    scan(function(u,v){ return P.clone().addScaledVector(U,-w2).addScaledVector(V,(u-0.5)*2*h2).addScaledVector(a,(v-0.5)*L); }, 200, 60);
    if(finite) [1,-1].forEach(function(sg){
      scan(function(u,v){ return P.clone().addScaledVector(U,(u-0.5)*2*w2).addScaledVector(V,(v-0.5)*2*h2).addScaledVector(a,sg*L/2); }, 100, 100);
    });
  }
  return out;
}
function measured(c){
  var curves = penetrationCurves(c), drawn = [];
  curves.forEach(function(pts){ densifyPolyline(pts, 400).forEach(function(p){ drawn.push(p); }); });
  var gt = gtPoints(c, 0), worst = 0, far = 0;
  gt.forEach(function(h){
    var best = 1e9;
    for(var i=0;i<drawn.length;i++){ var d = drawn[i].distanceTo(h); if(d<best) best = d; }
    if(best > 1.0) far++;
    if(best > worst) worst = best;
  });
  return {gt:gt.length, far:far, worst:+worst.toFixed(2), chains:curves.length,
          chainLens:curves.map(function(p){return p.length;})};
}
`;

function section(t){ console.log("\n===== " + t + " ====="); }

function setup(shapeName, cut, type, params, extra){
  return app.run(`(function(){
    applyShape('${shapeName}');
    parts.length=0; cyls.length=0; faces.length=0; pickSel={};
    cutShape='${cut}'; cutHole=false;
    addCyl('${type}');
    var c = cyls[0];
    ${params}
    c.on = true; c.hole = false;
    renderCylList(); mode='all'; refresh();
    ${HELPER}
    return measured(c);
  })()`);
}

section("1. 用户报的场景：圆锥 + 实体正方体（左右-29 / 高低-22.5 / 前后0 / 棱长29）");
const r1 = setup("cone", "sq", "frontal", "c.w=29;c.h=29;c.len=29;c.x=-29;c.y=-22.5;c.z=0;");
console.log(JSON.stringify(r1));
ok("全部真实交线都被画出来（GT 点偏离 < 1mm）", r1.far === 0, "缺 " + r1.far + "/" + r1.gt + "，最远 " + r1.worst + "mm");
ok("链条不再碎成多段（≤3 条）", r1.chains <= 3, "chains=" + r1.chains + " lens=" + JSON.stringify(r1.chainLens));
ok("ground truth 规模合理（>100 点）", r1.gt > 100, r1.gt);

section("2. 同场景换到圆柱主立体 / 半球 / 五棱台 / 圆柱平放");
[["cyl",26],["hemi",36],["frustum5",30],["cylz",26]].forEach(function(sh){
  const r = setup(sh[0], "sq", "frontal", "c.w=29;c.h=29;c.len=29;c.x=-29;c.y=-22.5;c.z=0;");
  ok(sh[0] + " 上正方体相贯线完整", r.far === 0, "缺 " + r.far + "/" + r.gt + "，最远 " + r.worst);
});

section("3. 无限贯穿（len=0）的实体不能凭空长出端面交线");
const r2 = setup("cone", "cyl", "frontal", "c.r=12;c.len=0;c.x=0;c.y=0;c.z=0;");
console.log(JSON.stringify(r2));
ok("无限贯穿圆柱交线完整且不多画", r2.far === 0 && r2.chains <= 3, "缺" + r2.far + " chains=" + r2.chains);

section("4. 三种截面形状 × 六种面型（圆锥）");
const TYPES = ["frontal","fv","horiz","pv","lat","lv"];
let worstFar = 0, worstCase = "";
[["cyl","c.r=13;"],["sq","c.w=24;c.h=24;c.len=24;"],["rect","c.w=30;c.h=16;c.len=26;"]].forEach(function(cs){
  TYPES.forEach(function(t){
    const r = setup("cone", cs[0], t, cs[1] + "c.x=-8;c.y=-6;c.z=4;");
    if(r.far > worstFar){ worstFar = r.far; worstCase = cs[0] + "/" + t + " 缺" + r.far + " 最远" + r.worst; }
    ok(cs[0] + " · " + t + " 完整", r.far === 0, "缺 " + r.far + "/" + r.gt + "，最远 " + r.worst);
  });
});

section("5. 性能：相贯线重建");
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; cutShape='sq'; cutHole=false; addCyl('frontal');");
app.run("(function(){ var c=cyls[0]; c.w=29;c.h=29;c.len=29;c.x=-29;c.y=-22.5;c.z=0; c.on=true;c.hole=false; renderCylList(); refresh(); })()");
const t0 = Date.now();
for(let i=0;i<10;i++) app.run("penetrationCurves(cyls[0])");
const ms = (Date.now()-t0)/10;
console.log("单次 penetrationCurves:", ms.toFixed(1), "ms");
ok("单次 < 120ms（手机上 ×4 也够）", ms < 120, ms.toFixed(1) + "ms");

console.log("\n=========================================");
console.log("  PASS " + pass + "   FAIL " + fail + (worstCase ? "   (最差: " + worstCase + ")" : ""));
console.log("=========================================");
process.exit(fail ? 1 : 0);
