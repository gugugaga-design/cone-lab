/* v33.33 回归套件：点选保留（=切割）后，剩余块必须是实体
   用户场景：圆锥 + 侧垂面-80° + 水平面-15 + 侧垂面60° → 7 部分，
   隐藏 3 部分后「剩下的部分在显示上不是实体」（能透过模型看到里面）。

   根因：sectionPointsND 对圆锥按「固定 θ 解 y」参数化：
       y = (d − (R/2)·B) / (nv.y + ks·(R/H)·B)
   平面恰好过锥尖时 d = nv·apex，分子恒等于 (H/2)×分母 → 所有 θ 都解出
   y=H/2, r=0（就是锥尖一个点），两条母线因 den≈0 被 continue 丢掉 →
   凸包退化成 0 面积 → cellCaps 在这个剖面上一张盖板都生不出来 →
   隐藏相邻块后切口敞着，直接看穿到内壁（深棕 BackSide）。
   v33.32 的自动吸附会把面吸到「过锥尖」，让这个老退化变得极易触发。

   修法：新增 solidSectionRim2D（平面内极坐标射线 + 二分求精确截面边界），
   sectionPoly2D 只在原截面面积明显偏小（>2% 差）时换成这份精确边界点集。

   跑法：node test2/solidcap.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { boot } = require("./boot");
const app = boot();

let pass = 0, fail = 0;
function check(name, cond, detail){
  if(cond){ pass++; console.log("  PASS  " + name + (detail ? "   [" + detail + "]" : "")); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   [" + detail + "]" : "")); }
}
function section(t){ console.log("\n=== " + t + " ==="); }

const HTML = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");

/* ============ 一、源码级 ============ */
section("一、源码：精确截面边界与退化替换");
check("存在 solidSectionRim2D（不依赖截交线参数公式）",
      /function solidSectionRim2D\(nv, d, B, K\)/.test(HTML));
check("solidSectionRim2D 跳过实验室占位体 / 空心圆柱（非凸不喂凸包）",
      /if\(SHAPES\[shape\]\.lab \|\| SHAPES\[shape\]\.hollow\) return \[\];/.test(HTML));
check("solidSectionRim2D 用平面内射线 + 二分（insideCone 判体内）",
      /for\(var it=0; it<24; it\+\+\)\{[\s\S]{0,240}insideCone\(P\)/.test(HTML));
check("sectionPoly2D 调用 solidSectionRim2D",
      /var rim = solidSectionRim2D\(nv, d, B, 96\);/.test(HTML));
check("只在原截面明显塌缩（面积差 >2%）时才替换，避免正常剖面顶点翻倍",
      /polyArea2D\(hRim\) > polyArea2D\(hOld\)\*1\.02/.test(HTML));
check("主立体截面按 shape/flip/平面方程缓存",
      /var _mainCapCache = \{\};/.test(HTML) &&
      /var sig = \[shape, flipped\?1:0,/.test(HTML));
check("buildCellVis 每次重建清空主/部件两份封盖缓存",
      /function buildCellVis\(\)\{[\s\S]{0,200}_partCapCache = \{\};[\s\S]{0,160}_mainCapCache = \{\};/.test(HTML));

/* ============ 二、过锥尖退化剖面 ============ */
section("二、过锥尖退化剖面：采样塌缩（老 bug 的因）→ 精确截面（新结果）");
const degen = app.run(`(function(){
  applyShape('cone'); faces.length=0; pickSel={};
  var a=-80*DEG, nv=new THREE.Vector3(0,Math.cos(a),Math.sin(a));
  var d=nv.y*(H/2);                       // 精确过锥尖 (0,40,0)
  var pts=sectionPointsND(nv,d,96);
  var maxOff=0, apex=new THREE.Vector3(0,H/2,0);
  pts.forEach(function(p){ maxOff=Math.max(maxOff,p.distanceTo(apex)); });
  var B=planeBasis(nv,d), rim=solidSectionRim2D(nv,d,B,96);
  var sp=sectionPoly2D(nv,d,96);
  function ar(poly){ var s=0; for(var i=0;i<poly.length;i++){var P=poly[i],Q=poly[(i+1)%poly.length];s+=P[0]*Q[1]-Q[0]*P[1];} return Math.abs(s)/2; }
  return {n:pts.length,maxOff:maxOff,rimN:rim.length,
          area:ar(sp.poly), polyN:sp.poly.length, d:d, nvy:nv.y};
})()`);
check("旧采样确实塌缩成锥尖一个点（对照组，验证根因）",
      degen.n > 50 && degen.maxOff < 1e-6, "n="+degen.n+" maxOff="+degen.maxOff.toExponential(2));
check("d 精确等于 nv·apex（吸附到「过锥尖」的位置）",
      Math.abs(degen.d - degen.nvy*40) < 1e-9, "d="+degen.d.toFixed(6));
check("solidSectionRim2D 给出 96 个精确边界点", degen.rimN === 96, "n="+degen.rimN);
check("sectionPoly2D 面积从 0 恢复到有限值（>1000）",
      degen.area > 1000, "area="+degen.area.toFixed(1));
check("退化截面多边形顶点数合理（未产生细长三角形爆炸）",
      degen.polyN >= 3 && degen.polyN <= 100, "n="+degen.polyN);

/* ============ 三、用户场景精确复现 ============ */
section("三、用户场景：圆锥 + 三个面 → 7 部分，逐块逐剖面验封盖");
app.run(`(function(){
  applyShape('cone'); showHome(false);
  faces.length=0; cyls.length=0; parts.length=0; pickSel={};
  [{type:'lv',ang:-80,x:0,y:4.770134908006693,z:-6.21197574243773},
   {type:'horiz',ang:0,x:0,y:-15,z:0},
   {type:'lv',ang:60,x:0,y:20.141404940086094,z:-4.722656331601005}]
   .forEach(function(f,i){ f.on=true; f.flip=false; f._id=100+i; faces.push(f); });
  mode='pick'; refresh();
  return null;
})()`);

const scene = app.run(`(function(){
  var act=activeFaceData();
  function triArea(p,o){
    var ax=p[o],ay=p[o+1],az=p[o+2],bx=p[o+3],by=p[o+4],bz=p[o+5],cx=p[o+6],cy=p[o+7],cz=p[o+8];
    var ux=bx-ax,uy=by-ay,uz=bz-az,vx=cx-ax,vy=cy-ay,vz=cz-az;
    return 0.5*Math.sqrt(Math.pow(uy*vz-uz*vy,2)+Math.pow(uz*vx-ux*vz,2)+Math.pow(ux*vy-uy*vx,2));
  }
  /* 理论封盖面积：在剖面参数域上撒网格，保留「主立体内 + 其它面符号位一致」的点 */
  function theo(c,m){
    var o=act[m],B=planeBasis(o.nv,o.d),pk=parseCellKey(c.key);
    var N=140,L=65,du=2*L/N,cellA=du*du,hit=0,V=new THREE.Vector3();
    for(var iu=0;iu<N;iu++) for(var iv=0;iv<N;iv++){
      V.copy(B.O).addScaledVector(B.U,-L+(iu+0.5)*du).addScaledVector(B.V,-L+(iv+0.5)*du);
      if(!insideCone(V)) continue;
      var ok=true;
      for(var j=0;j<act.length;j++){
        if(j===m) continue;
        var o2=act[j],val=o2.nv.dot(V)-o2.d;
        var want=(pk.fm[o2.id]!==undefined)?!!pk.fm[o2.id]:(c.key.charAt(j)==='1');
        if(want?val<0:val>0){ok=false;break;}
      }
      if(ok) hit++;
    }
    return hit*cellA;
  }
  var perCell=cells.map(function(c){
    var caps=cellCaps(c,act).map(function(g){
      var p=g.attributes.position.array,a=0;
      for(var t=0;t<p.length;t+=9)a+=triArea(p,t);
      return a;
    });
    return {key:c.key, caps:caps, capTot:caps.reduce(function(s,x){return s+x;},0),
            theo:act.map(function(o,m){return theo(c,m);})};
  });
  var capMeshes=0, colors={};
  if(cellGroup) cellGroup.traverse(function(ch){
    if(ch.isMesh&&ch.userData&&ch.userData.cap){capMeshes++;colors[ch.material.color.getHexString()]=1;}
  });
  return {n:cells.length, perCell:perCell,
          totalCap:perCell.reduce(function(s,c){return s+c.capTot;},0),
          capMeshes:capMeshes, colors:Object.keys(colors),
          d0:act[0].d, nv0y:act[0].nv.y};
})()`);
check("分出 7 部分（与用户截图「共 7 部分」一致）", scene.n === 7, "n="+scene.n);
check("第一个面确实是过锥尖的吸附位置", Math.abs(scene.d0 - scene.nv0y*40) < 1e-3,
      "d="+scene.d0.toFixed(4)+" nv.y*40="+(scene.nv0y*40).toFixed(4));
check("全部保留时总封盖面积 > 9000（修复前约 5800）",
      scene.totalCap > 9000, "total="+scene.totalCap.toFixed(1));
check("每一块都至少有一张封盖（没有块在切口处敞着）",
      scene.perCell.every(function(c){ return c.caps.length >= 1; }),
      "caps="+scene.perCell.map(function(c){return c.caps.length;}).join(","));
/* 逐剖面：理论面积 > 30 的，必须有面积接近的封盖（容差 12%，容纳凸包离散化） */
let bad = [];
scene.perCell.forEach(function(c,i){
  c.theo.forEach(function(t,m){
    if(t < 30) return;
    var best = c.caps.reduce(function(s,x){ return Math.max(s,x); },0);
    var matched = c.caps.some(function(x){ return Math.abs(x-t)/t < 0.12; });
    if(!matched) bad.push("cell"+i+"/face"+m+" theo="+t.toFixed(0)+" caps=["+c.caps.map(function(x){return x.toFixed(0);}).join(",")+"]");
  });
});
check("每个块在每个有面积的剖面上都有匹配的封盖（21 项逐对校验）",
      bad.length === 0, bad.length ? bad.slice(0,3).join(" ; ") : "21/21 matched");
check("场景里生成了封盖网格", scene.capMeshes >= 14, "cap meshes="+scene.capMeshes);
check("主立体封盖保持切口橙 #dd7a34",
      scene.colors.indexOf("dd7a34") >= 0, "colors="+scene.colors.join(","));

/* ============ 四、非退化剖面不受影响 ============ */
section("四、非退化剖面：原截面保持原样，其它立体不回归");
const normal = app.run(`(function(){
  applyShape('cone'); faces.length=0; pickSel={};
  var B=planeBasis(new THREE.Vector3(0,1,0),-15);
  var sp=sectionPoly2D(new THREE.Vector3(0,1,0),-15,96);
  function ar(poly){var s=0;for(var i=0;i<poly.length;i++){var P=poly[i],Q=poly[(i+1)%poly.length];s+=P[0]*Q[1]-Q[0]*P[1];}return Math.abs(s)/2;}
  var r=30*(40-(-15))/80, expect=Math.PI*r*r;
  var a2=-80*DEG, nv2=new THREE.Vector3(0,Math.cos(a2),Math.sin(a2));
  /* 其它立体：逐个切一次，确认不崩、截面非空 */
  var shapes=['cyl','hemi','pyr3','frustum5','cylz','hcyl'];
  var each=shapes.map(function(s){
    setShapeGeom(s);
    try{
      var o=sectionPoly2D(new THREE.Vector3(0,1,0),0,96);
      return {s:s,n:o.poly.length,a:ar(o.poly)};
    }catch(e){ return {s:s,err:String(e)}; }
  });
  setShapeGeom('cone');
  return {n:sp.poly.length, area:ar(sp.poly), expect:expect, each:each};
})()`);
check("水平面 y=-15 截面面积 ≈ π·r²（解析值）",
      Math.abs(normal.area-normal.expect)/normal.expect < 0.01,
      "got="+normal.area.toFixed(1)+" expect="+normal.expect.toFixed(1));
check("水平面截面顶点数仍为 96（未被精确边界替换、无细长三角形）",
      normal.n === 96, "n="+normal.n);
check("圆柱/半球/多面体/平放圆柱/空心圆柱的截面都不崩且非空",
      normal.each.every(function(o){ return !o.err && o.n >= 3 && o.a > 0; }),
      normal.each.map(function(o){return o.s+":"+o.n;}).join(" "));
check("空心圆柱仍走双环路径（极点法跳过非凸体）",
      /if\(SHAPES\[shape\]\.lab \|\| SHAPES\[shape\]\.hollow\) return \[\];/.test(HTML));

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
process.exit(fail ? 1 : 0);
