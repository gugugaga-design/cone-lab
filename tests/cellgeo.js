/* v33.1 核心回归：每个分块的裁剪几何必须"互斥且完备"。
   这是「隐藏锥顶 → 整块消失」bug 的直接断言层（key 正确 ≠ 渲染区域正确）。
   对每个 cell：CPU 复算其 planes + partSpecs 裁剪语义，统计它接受多少
   属于自己 key 的采样点（覆盖率，应=100%）和多少属于别人 key 的点（越界，应=0）。
   运行: node test2/cellgeo.js */
"use strict";
const { boot } = require("./boot");
const app = boot();
function section(t){ console.log("\n===== " + t + " ====="); }
let bad = 0;
function ok(n, c, d){ console.log((c?"  PASS  ":"  FAIL  ")+n+(d?"   ["+d+"]":"")); if(!c) bad++; }

/* 在主立体内部均匀取采样点（柱坐标，贴着锥尖也有分辨率） */
function scenario(shapeName, setupBox, label){
  app.run("applyShape('" + shapeName + "'); parts.length=0; cyls.length=0; faces.length=0;");
  setupBox();
  app.run("mode='pick'; refresh();");
  const r = app.run(`(function(){
    var act=activeFaceData(), cs=activeCyls(), ps=activeParts(), S=SHAPES[shape];
    /* CPU 复算一个 cell 的裁剪语义 */
    function accepts(cell, P){
      for(var i=0;i<cell.planes.length;i++){
        var pl=cell.planes[i];
        if(pl.normal.dot(P) + pl.constant < -1e-6) return false;
      }
      for(var j=0;j<ps.length;j++){
        var sp=(cell.parts||[])[j];
        if(!sp || !sp.c) continue;
        var inside = insidePartWorld(ps[j], P);
        if(sp.keep > 0){ if(inside) return false; }
        else            { if(!inside) return false; }
      }
      for(var m=0;m<cs.length;m++){
        var csp=(cell.cyls||[])[m];
        if(!csp) continue;
        var mg = cylMargin(cs[m], P);
        if(csp.keep > 0){ if(mg > 0) return false; }
        else            { if(mg < 0) return false; }
      }
      return true;
    }
    var pts=[];
    for(var i2=0;i2<=70;i2++){
      var y=-S.H/2+S.H*i2/70, rmax=radiusAt(y);
      if(rmax<=0) continue;
      for(var j2=0;j2<40;j2++){
        var th=j2/40*Math.PI*2;
        for(var q=0;q<=5;q++){
          var rr=rmax*q/5;
          var P=new THREE.Vector3(rr*Math.cos(th), y, rr*Math.sin(th));
          if(insideCone(P)) pts.push(P);
        }
      }
    }
    var report=[];
    cells.forEach(function(c){
      var ownAccepted=0, ownTotal=0, foreignAccepted=0;
      pts.forEach(function(P){
        var k=cellKeyAt(P,act,cs,ps);
        if(k===null) return;
        var acc=accepts(c,P);
        if(k===c.key){ ownTotal++; if(acc) ownAccepted++; }
        else if(acc) foreignAccepted++;
      });
      report.push({key:c.key,
                   coverage: ownTotal? Math.round(ownAccepted/ownTotal*1000)/10 : 0,
                   foreign: foreignAccepted,
                   ownPts: ownTotal});
    });
    /* 再验证「隐藏任意一块，其余块仍可见」 */
    var vanishCombos=0;
    cells.forEach(function(c){
      var others=cells.filter(function(x){return x.key!==c.key;});
      if(!others.length) return;
      // 若把 c 隐藏，还有没有任何一块能接受到 >=1 个自己的采样点？
      var anyVisible = others.some(function(x){
        var acc=0;
        for(var t=0;t<pts.length;t++){
          var P=pts[t];
          var k=cellKeyAt(P,act,cs,ps);
          if(k!==x.key) continue;
          if(accepts(x,P)) acc++;
          if(acc>=3) return true;
        }
        return acc>=3;
      });
      if(!anyVisible) vanishCombos++;
    });
    return {cells:cells.length, report:report, vanishCombos:vanishCombos};
  })()`);

  section(label);
  r.report.forEach(function(x){
    console.log("    " + JSON.stringify(x));
  });
  ok("所有分块覆盖率 100%（自己的区域全覆盖）",
     r.report.every(function(x){ return x.coverage >= 99.9; }),
     "min=" + Math.min.apply(null, r.report.map(function(x){return x.coverage;})) + "%");
  ok("无越界覆盖（不接受任何别块的点）",
     r.report.every(function(x){ return x.foreign === 0; }),
     "foreign=" + JSON.stringify(r.report.map(function(x){return x.foreign;})));
  ok("隐藏任意一块都不会整块消失（vanishCombos=0）", r.vanishCombos === 0, "vanishCombos=" + r.vanishCombos);
}

/* —— 场景 —— */
scenario("pyr3", function(){
  app.run("addPart('box');");   // 用户真实操作：全默认
}, "A. 正三棱锥 + 默认长方体（用户场景，v33 初版在此翻车）");

scenario("pyr3", function(){
  app.run("addPart('box'); (function(){ var p=parts[0]; p.w=200;p.d=200;p.h=26;p.y=-14;p.type='horiz';p.ang=0;p.x=0;p.z=0; })()");
}, "B. 正三棱锥 + 长方体横切（锥顶/带内/锥底三段）");

scenario("pyr3", function(){
  app.run("addPart('cyl'); (function(){ var p=parts[0]; p.r=12;p.h=60;p.type='horiz';p.ang=0;p.x=0;p.y=5;p.z=0; })()");
}, "C. 正三棱锥 + 圆柱部件（顶/内/底 + 侧外）");

scenario("cone", function(){
  app.run("addPart('box'); addPart('cyl');");
  app.run("(function(){ var a=parts[0],b=parts[1]; a.w=120;a.d=120;a.h=30;a.y=-10;a.type='horiz';" +
          " b.r=8;b.h=200;b.type='horiz';b.ang=0;b.x=6;b.y=0;b.z=0; })()");
  app.run("faces.push({type:'horiz', ang:0, x:0, y:10, z:0, on:true, flip:false});");
}, "D. 圆锥 + 长方体部件 + 圆柱部件 + 切割面（多部件叠加）");

scenario("frustum5", function(){
  app.run("addPart('box'); (function(){ var p=parts[0]; p.w=200;p.d=200;p.h=20;p.y=10;p.type='horiz';p.ang=0;p.x=0;p.z=0; })()");
}, "E. 五棱台 + 长方体（多面体主立体）");

/* ============================================================
   v33.2 专项回归：实验室模式下分块网格必须有真实几何
   （这是「点隐藏锥顶 → 整块消失」的**最终根因**）
   之前 cellGeo 一律取主立体 geo，lab 模式 geo 是空几何（0 顶点）
   → 分块网格画不出来、射线也打不中 → tapPick 只能退回去隐藏整个部件。
   ============================================================ */
section("F. 实验室模式：分块网格必须非空且可被射线命中");

app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("addPart('pyr3'); addPart('box');");
app.run("(function(){ var a=parts[0],b=parts[1]; a.r=24;a.h=50;a.type='horiz';a.x=a.y=a.z=0;" +
        " b.w=90;b.d=90;b.h=26;b.type='horiz';b.x=0;b.y=-18;b.z=0; })()");
app.run("mode='pick'; refresh();");

const labGeom = app.run(`(function(){
  var verts = cellGroup ? cellGroup.children.map(function(m){
    return m.geometry && m.geometry.attributes && m.geometry.attributes.position
           ? m.geometry.attributes.position.count : 0;
  }) : [];
  return {cells:cells.length, meshes:verts.length, verts:verts,
          allNonEmpty: verts.length>0 && verts.every(function(v){ return v>0; }),
          anyEmpty: verts.some(function(v){ return v===0; })};
})()`);
console.log("    " + JSON.stringify(labGeom));
ok("lab 模式每个分块网格都有顶点（不为空几何）", labGeom.allNonEmpty === true,
   "verts=" + JSON.stringify(labGeom.verts));
ok("没有空几何的分块网格", labGeom.anyEmpty === false);

app.run("(function(){ useOrthoCam(false); camera.position.set(120,150,180);" +
        " camera.lookAt(0,0,0); camera.updateMatrixWorld(true); controls.target.set(0,0,0); })()");
const labHit = app.run(`(function(){
  var rect=renderer.domElement.getBoundingClientRect();
  var ev={clientX:rect.width/2, clientY:rect.height/2};
  raycaster.setFromCamera(ndcFromEvent(ev), activeCam);
  var ch = cellGroup ? raycaster.intersectObjects(cellGroup.children,false) : [];
  var ph = partGroup ? raycaster.intersectObjects(partGroup.children,false) : [];
  return {cellHits:ch.length, partHits:ph.length};
})()`);
console.log("    " + JSON.stringify(labHit));
ok("lab 模式射线能命中分块（cellHits > 0）", labHit.cellHits > 0, "cellHits=" + labHit.cellHits);

const labTap = app.run(`(function(){
  var rect=renderer.domElement.getBoundingClientRect();
  var ev={clientX:rect.width/2, clientY:rect.height/2, isPrimary:true,
          preventDefault:function(){}, stopPropagation:function(){}};
  var bp = parts.map(function(p){ return !!p.hidden; });
  var bc = cells.map(function(c){ return c.sel!==false; });
  tapPick(ev);
  var ap = parts.map(function(p){ return !!p.hidden; });
  var ac = cells.map(function(c){ return c.sel!==false; });
  return {partsChanged: JSON.stringify(bp)!==JSON.stringify(ap),
          cellsChanged: JSON.stringify(bc)!==JSON.stringify(ac),
          hiddenCells: cells.filter(function(c){ return c.sel===false; }).length};
})()`);
console.log("    " + JSON.stringify(labTap));
ok("lab 模式点击先命中分块（不是整个部件）",
   labTap.cellsChanged === true && labTap.partsChanged === false,
   "cellsChanged=" + labTap.cellsChanged + " partsChanged=" + labTap.partsChanged);
ok("隐藏的是分块而不是整块部件", labTap.hiddenCells >= 1, "hiddenCells=" + labTap.hiddenCells);

console.log("\n" + (bad===0 ? "ALL OK" : bad + " FAILURE(S)"));
process.exit(bad?1:0);
