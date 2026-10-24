/* Verify the user's exact complaint is now fixed:
   "正四棱锥与长方体相贯时，想隐藏锥顶 → 但是整个四棱锥全没了" */
"use strict";
const { boot } = require("./boot");
const app = boot();
function section(t){ console.log("\n===== " + t + " ====="); }
let bad = 0;
function ok(n, c, d){ console.log((c?"  PASS  ":"  FAIL  ")+n+(d?"   ["+d+"]":"")); if(!c) bad++; }

section("场景1: 主立体=棱锥 + 长方体部件(水平横切) → 锥顶应独立可选");
app.run("applyShape('pyr3'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("addPart('box')");
/* 关键：长方体要**水平横切**棱锥。partRot 用 rawNormal 作轴：
   type="horiz" → 轴沿 Y（竖直），此时 w/d 是水平截面，h 是竖直厚度。
   用 type="frontal" 会让轴变成水平 Z，200 的 d 会沿世界 Y 展开把整个棱锥包住。 */
app.run("(function(){ var p=parts[0]; p.w=200;p.d=200;p.h=26;p.type='horiz';p.ang=0;p.x=0;p.y=-14;p.z=0; })()");
app.run("mode='pick'; refresh();");
const r1 = app.run(`(function(){
  var act=activeFaceData(), cs=activeCyls(), ps=activeParts();
  var H=SHAPES[shape].H;
  var apexK = cellKeyAt(new THREE.Vector3(0, H/2-2, 0), act, cs, ps);
  var midK  = cellKeyAt(new THREE.Vector3(0, -H/2+2, 0), act, cs, ps);   // 长方体内部那段
  var box = parts[0];
  return {cells:cells.length, apexK:apexK, insideBoxK:midK,
          apexDistinctFromInside: apexK!==midK,
          apexInsideBox: insidePartWorld(box, new THREE.Vector3(0, H/2-2, 0)),
          boxSpansY: [box.y-box.h/2, box.y+box.h/2],
          pyramidY: [-H/2, H/2]};
})()`);
console.log(JSON.stringify(r1,null,1));
/* 长方体跨 y∈[-27,-1]，棱锥 y∈[-22.5,22.5]：
   锥顶段 = 长方体上方那段（y>-1），被夹段 = 长方体内部那段。这两段必须是不同的块。 */
ok("锥顶段 与 长方体内部段 是两块（可分别隐藏）",
   r1.apexDistinctFromInside && r1.apexK !== null, r1.apexK + " vs " + r1.insideBoxK);
ok("锥顶点确实在长方体外部", !r1.apexInsideBox);

section("隐藏锥顶那一块 → 只隐藏锥顶，其余保留");
const r2 = app.run(`(function(){
  var act=activeFaceData(), cs=activeCyls(), ps=activeParts();
  var H=SHAPES[shape].H;
  var k = cellKeyAt(new THREE.Vector3(0, H/2-2, 0), act, cs, ps);
  pickSel[k]=false;
  cells.forEach(function(c){ if(c.key===k) c.sel=false; });
  buildCellVis();
  return {total:cells.length,
          hidden:cells.filter(function(c){return c.sel===false;}).length,
          visible:cells.filter(function(c){return c.sel!==false;}).length,
          hiddenKey:k};
})()`);
console.log(JSON.stringify(r2));
ok("只隐藏了 1 块，其余仍然可见（不是整块消失）",
   r2.hidden === 1 && r2.visible === r2.total - 1, "visible="+r2.visible+"/"+r2.total);

section("场景2: 实验室 — 棱锥 + 长方体两个自由拼装部件");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("addPart('pyr3'); addPart('box');");
app.run("(function(){ var a=parts[0], b=parts[1];" +
        "a.r=24;a.h=50;a.type='horiz';a.ang=0;a.x=0;a.y=0;a.z=0;" +
        "b.w=90;b.d=90;b.h=26;b.type='horiz';b.ang=0;b.x=0;b.y=-18;b.z=0; })()");
app.run("mode='pick'; refresh();");
const r3 = app.run(`(function(){
  var act=activeFaceData(), cs=activeCyls(), ps=activeParts();
  return {cells:cells.length, keys:cells.map(function(c){return c.key;}),
          parts:parts.length, selectable:cells.length};
})()`);
console.log(JSON.stringify(r3,null,1));
ok("实验室里两个相贯部件被切成 >=3 个可选区域", r3.cells >= 3, "cells="+r3.cells);

section("锥顶（棱锥部件内、长方体上方）是独立区域");
const r4 = app.run(`(function(){
  var act=activeFaceData(), cs=activeCyls(), ps=activeParts();
  // 棱锥部件 h=50 -> apex y=+25；长方体 y=-18,h=26 -> 跨 [-31,-5]
  var apexK = cellKeyAt(new THREE.Vector3(0, 22, 0), act, cs, ps);    // 长方体上方
  var boxK  = cellKeyAt(new THREE.Vector3(0, -18, 0), act, cs, ps);   // 长方体内部
  var belowK= cellKeyAt(new THREE.Vector3(0, -33, 0), act, cs, ps);   // 长方体下方
  return {apexK:apexK, boxK:boxK, belowK:belowK,
          apexVsBox: apexK!==boxK, apexVsBelow: apexK!==belowK, boxVsBelow: boxK!==belowK};
})()`);
console.log(JSON.stringify(r4,null,1));
ok("锥顶 / 长方体内部 / 下方 三段互不相同",
   r4.apexVsBox && r4.apexVsBelow && r4.boxVsBelow);

section("场景3: 圆锥 + 面 + 相贯体 + 部件 全部叠加");
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("addPart('box')");
app.run("(function(){ var p=parts[0]; p.w=120;p.d=120;p.h=30;p.type='horiz';p.ang=0;p.x=0;p.y=-10;p.z=0; })()");
app.run("faces.push({type:'horiz', ang:0, x:0, y:10, z:0, on:true, flip:false});");
app.run("addCyl('frontal')");
app.run("mode='pick'; refresh();");
const r5 = app.run(`(function(){ return {cells:cells.length, keys:cells.map(function(c){return c.key;})}; })()`);
console.log(JSON.stringify(r5,null,1));
/* 面分 2 段 × 相贯体分 2 × 部件分 3 类（内/上外/下外）= 最多 12，但很多组合在几何上不存在
   （例如"长方体内部"和"面以上"在圆锥里没交集）。这里只要求分区明显多于只有面时的 2 块。 */
ok("四类切割叠加后区域数明显增多（>=6）", r5.cells >= 6, "cells="+r5.cells);
ok("每个区域都有真实采样点（无伪块）", app.run(`(function(){
  var act=activeFaceData(), cs=activeCyls(), ps=activeParts();
  var pts=samplePoints(act), bad=[];
  cells.forEach(function(c){
    var n=0;
    pts.forEach(function(p){ if(insideCone(p) && cellKeyAt(p,act,cs,ps)===c.key) n++; });
    if(n===0) bad.push(c.key);
  });
  return bad.length===0;
})()`));

section("一致性：每个 cell 的 key 都能反解，且区域数 = 几何区域数（穷举对比）");
const r6 = app.run(`(function(){
  var act=activeFaceData(), cs=activeCyls(), ps=activeParts();
  var S=SHAPES[shape], found={};
  /* 只在**主立体内部**按柱坐标细扫。用均匀直角网格不行：
     锥顶附近体积很小，粗网格会整块漏掉 → 误报"多出一块"。 */
  for(var i=0;i<=160;i++){
    var y=-S.H/2+S.H*i/160;
    var rmax=radiusAt(y);
    for(var j=0;j<64;j++){
      var th=j/64*Math.PI*2;
      for(var q=0;q<=8;q++){
        var rr=rmax*q/8;
        var p=new THREE.Vector3(rr*Math.cos(th), y, rr*Math.sin(th));
        if(!insideCone(p)) continue;
        var kk=cellKeyAt(p,act,cs,ps);
        if(kk!==null) found[kk]=(found[kk]||0)+1;
      }
    }
  }
  var brute=Object.keys(found).sort();
  var have=cells.map(function(c){return c.key;}).sort();
  return {brute:brute.length, sampled:have.length,
          missing: brute.filter(function(k){ return have.indexOf(k)<0; }),
          extra: have.filter(function(k){ return brute.indexOf(k)<0; })};
})()`);
console.log(JSON.stringify(r6,null,1));
ok("穷举区域数 == 分块数", r6.brute === r6.sampled, "brute="+r6.brute+" sampled="+r6.sampled);
ok("没有漏块", r6.missing.length === 0, JSON.stringify(r6.missing));

console.log("\n" + (bad===0 ? "ALL OK" : bad + " FAILURE(S)"));
process.exit(bad?1:0);
