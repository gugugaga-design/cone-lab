/* v33.4 专项回归：**相贯体裁切**时的点选保留部分。
   这是用户第 5 次反馈的真正场景（截图里显示「已启用 1 个贯穿圆」「共 2 部分」），
   前几轮我一直在修"自由拼装部件"的分块，从未修过相贯体的二值码问题。

   根因：相贯体原来只有"内/外"两个符号位 → 它两侧的不连通区域拿到同一个 key。
   长方体横穿棱锥时锥顶和锥底都在长方体外面，key 都是 "c1:0"
   → 点"隐藏锥顶"把锥底一起隐藏 → 看起来"整个棱锥全没了"。

   运行: node test2/cylpick.js */
"use strict";
const { boot } = require("./boot");
const app = boot();
let pass = 0, fail = 0;
function check(n, c, d){ if(c){pass++;console.log("  PASS  "+n+(d?"   ["+d+"]":""));} else {fail++;console.log("  FAIL  "+n+(d?"   ["+d+"]":""));} }
function section(t){ console.log("\n=== " + t + " ==="); }

/* 走真实 DOM 事件流（pointerdown@canvas → pointerup@window） */
function realTapAt(worldPointExpr){
  return app.run(`(function(){
    var W = ${worldPointExpr};
    var v = W.clone().project(activeCam);
    var rect = renderer.domElement.getBoundingClientRect();
    var sx = rect.left + (v.x*0.5+0.5)*rect.width;
    var sy = rect.top + (-v.y*0.5+0.5)*rect.height;
    function mk(t){ return {type:t, clientX:sx, clientY:sy, pointerId:1, pointerType:'touch',
      isPrimary:true, button:0, buttons:(t==='pointerup'?0:1),
      preventDefault:function(){}, stopPropagation:function(){}}; }
    var el = renderer.domElement;
    ((el._listeners&&el._listeners.pointerdown)||[]).forEach(function(f){ f.call(el, mk('pointerdown')); });
    ((window._listeners&&window._listeners.pointerup)||[]).forEach(function(f){ f.call(window, mk('pointerup')); });
    return {x:sx, y:sy};
  })()`);
}

/* ===== 用户截图场景：正三棱锥 + 长方体相贯体 ===== */
section("A. 正三棱锥 + 长方体相贯体（用户截图场景）");
app.run("applyShape('pyr3'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("addCyl('horiz')");
app.run("(function(){ var c=cyls[0]; c.shape='rect'; c.w=120;c.h=120;c.len=26;c.y=-6;c.hole=false;c.on=true; })()");
app.run("bodyTint=true; mode='pick'; refresh();");

const A = app.run(`(function(){
  var act=activeFaceData(), cs=activeCyls(), H=SHAPES[shape].H;
  var apexK = cellKeyAt(new THREE.Vector3(0, H/2-2, 0), act, cs);
  var baseK = cellKeyAt(new THREE.Vector3(0, -H/2+2, 0), act, cs);
  var midK  = cellKeyAt(new THREE.Vector3(0, -6, 0), act, cs);
  return {cells:cells.length, keys:cells.map(function(c){return c.key;}),
          apexK:apexK, baseK:baseK, midK:midK,
          apexNeBase: apexK!==baseK, apexNeMid: apexK!==midK, baseNeMid: baseK!==midK};
})()`);
console.log("    " + JSON.stringify(A));
check("锥顶与锥底拿到不同 key（不再合并）", A.apexNeBase === true, A.apexK + " vs " + A.baseK);
check("锥顶与中间段不同", A.apexNeMid === true);
check("锥底与中间段不同", A.baseNeMid === true);
check("分成 3 块（顶/中/底）", A.cells === 3, "cells=" + A.cells);

section("B. 真实点击锥顶 → 只隐藏锥顶，其余保留");
app.run("(function(){ useOrthoCam(false); camera.position.set(150,95,170);" +
        " camera.lookAt(0,0,0); camera.updateMatrixWorld(true); controls.target.set(0,0,0); })()");
const tapPos = realTapAt("new THREE.Vector3(0, SHAPES[shape].H/2-2, 0)");
const B = app.run(`(function(){
  return {hidden:cells.filter(function(c){return c.sel===false;}).map(function(c){return c.key;}),
          visible:cells.filter(function(c){return c.sel!==false;}).length,
          total:cells.length};
})()`);
console.log("    tap at " + JSON.stringify(tapPos) + " → " + JSON.stringify(B));
check("只隐藏 1 块", B.hidden.length === 1, JSON.stringify(B.hidden));
check("其余块仍然可见（不是整块消失）", B.visible === B.total - 1,
      "visible=" + B.visible + "/" + B.total);
check("被隐藏的正是锥顶那块", B.hidden[0] && B.hidden[0].indexOf(":1") >= 0, B.hidden[0]);

section("C. 扫多种长方体摆法，都不能出现「整块消失」");
const CASES = [
  {n:"居中横切",  w:120, d:120, h:26, y:0},
  {n:"偏上",      w:120, d:120, h:26, y:8},
  {n:"偏下",      w:120, d:120, h:26, y:-8},
  {n:"薄片",      w:200, d:200, h:8,  y:0},
  {n:"大截面",    w:200, d:200, h:30, y:-5},
];
let vanish = 0;
CASES.forEach(function(cs){
  app.run("applyShape('pyr3'); parts.length=0; cyls.length=0; faces.length=0;");
  app.run("addCyl('horiz')");
  app.run("(function(){ var c=cyls[0]; c.shape='rect'; c.w="+cs.w+";c.h="+cs.d+
          ";c.len="+cs.h+";c.y="+cs.y+";c.hole=false;c.on=true; })()");
  app.run("mode='pick'; refresh();");
  const r = app.run(`(function(){
    var act=activeFaceData(), csl=activeCyls(), S=SHAPES[shape];
    /* 找最高的采样点（锥顶附近）所属 key */
    var best=null;
    for(var i=0;i<=70;i++){
      var y=-S.H/2+S.H*i/70, rmax=radiusAt(y);
      if(rmax<=0.3) continue;
      for(var j=0;j<20;j++){
        var th=j/20*Math.PI*2;
        for(var k=1;k<=3;k++){
          var rr=rmax*k/3;
          var P=new THREE.Vector3(rr*Math.cos(th), y, rr*Math.sin(th));
          if(!insideCone(P)) continue;
          var kk=cellKeyAt(P,act,csl);
          if(kk!==null && (!best || y>best.y)) best={y:y,k:kk};
        }
      }
    }
    if(!best) return {skip:true};
    pickSel[best.k]=false;
    cells.forEach(function(c){ if(c.key===best.k) c.sel=false; });
    buildCellVis();
    var vis=cells.filter(function(c){return c.sel!==false;}).length;
    pickSel[best.k]=true;
    cells.forEach(function(c){ if(c.key===best.k) c.sel=true; });
    return {cells:cells.length, vis:vis, apexY:Math.round(best.y*10)/10};
  })()`);
  if(r.skip) return;
  const bad = r.vis === 0;
  if(bad) vanish++;
  console.log("    " + cs.n.padEnd(8) + " cells=" + String(r.cells).padStart(2) +
              "  隐藏锥顶后可见=" + r.vis + "/" + r.cells + (bad ? "  <<< 整块消失" : ""));
});
check("所有摆法隐藏锥顶都不会整块消失", vanish === 0, vanish + "/" + CASES.length);

section("D. 无限贯穿（len=0）不应凭空多出区域");
app.run("applyShape('pyr3'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("addCyl('frontal')");
app.run("(function(){ var c=cyls[0]; c.shape='cyl'; c.r=12; c.len=0; c.hole=false; c.on=true; })()");
app.run("mode='pick'; refresh();");
const D = app.run(`(function(){
  var codes = cells.map(function(c){ return parseCellKey(c.key).cm; });
  var hasEndCode = codes.some(function(cm){
    return Object.keys(cm).some(function(id){ return cm[id]===1 || cm[id]===2; });
  });
  return {cells:cells.length, hasEndCode:hasEndCode,
          keys:cells.map(function(c){return c.key;})};
})()`);
console.log("    " + JSON.stringify(D));
check("无限贯穿只有 内/外 两码（0/3），不产生 1/2", D.hasEndCode === false,
      "cells=" + D.cells);

console.log("\n=========================================");
console.log("  PASS " + pass + "   FAIL " + fail);
console.log("=========================================");
process.exit(fail ? 1 : 0);
