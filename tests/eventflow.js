/* v33.3 关键回归：走**真实 DOM 事件流**（pointerdown@canvas → pointerup@window），
   而不是直接调用 tapPick。这是之前所有测试都缺的一环 ——
   p1.html 把 pointerup 注册在 window 上，stub 成空函数就会让"点了没反应"被误判为正常。
   运行: node test2/eventflow.js */
"use strict";
const { boot } = require("./boot");
const app = boot();
const doc = app.__doc;
let pass = 0, fail = 0;
function check(n, c, d){ if(c){pass++;console.log("  PASS  "+n+(d?"   ["+d+"]":""));} else {fail++;console.log("  FAIL  "+n+(d?"   ["+d+"]":""));} }
function section(t){ console.log("\n=== " + t + " ==="); }

/* 用真实事件流点一次：canvas.pointerdown + window.pointerup（+ pointermove 不动） */
function realTap(sx, sy){
  return app.run(`(function(){
    var el = renderer.domElement;
    function mk(type){
      return {type:type, clientX:${sx}, clientY:${sy}, pointerId:1, pointerType:'touch',
              isPrimary:true, button:0, buttons:(type==='pointerup'?0:1),
              preventDefault:function(){}, stopPropagation:function(){},
              target:el};
    }
    var canvasDown = (el._listeners && el._listeners.pointerdown) || [];
    canvasDown.forEach(function(f){ f.call(el, mk('pointerdown')); });
    var winUp = (window._listeners && window._listeners.pointerup) || [];
    winUp.forEach(function(f){ f.call(window, mk('pointerup')); });
    return {canvasDownCount: canvasDown.length, windowUpCount: winUp.length};
  })()`);
}

section("A. 事件接线是否正确（p1.html 把 pointerup 挂在 window 上）");
app.run("applyShape('pyr3'); parts.length=0; cyls.length=0; faces.length=0; addPart('box'); mode='pick'; refresh();");
app.run("(function(){ useOrthoCam(false); camera.position.set(120,150,180); camera.lookAt(0,10,0); camera.updateMatrixWorld(true); controls.target.set(0,10,0); })()");
const wiring = app.run(`(function(){
  var el = renderer.domElement;
  var cd = (el._listeners && el._listeners.pointerdown) || [];
  var wu = (window._listeners && window._listeners.pointerup) || [];
  return {canvasPointerdown: cd.length, windowPointerup: wu.length};
})()`);
console.log("    " + JSON.stringify(wiring));
check("canvas 上有 pointerdown 处理器", wiring.canvasPointerdown > 0, wiring.canvasPointerdown + " 个");
check("window 上有 pointerup 处理器", wiring.windowPointerup > 0, wiring.windowPointerup + " 个");

section("B. 真实事件流：点锥顶 → 只隐藏锥顶那一块");
const apexScreen = app.run(`(function(){
  var H=SHAPES[shape].H;
  var apex=new THREE.Vector3(0,H/2-2,0);
  var v=apex.clone().project(activeCam);
  var rect=renderer.domElement.getBoundingClientRect();
  return {x: rect.left+(v.x*0.5+0.5)*rect.width,
          y: rect.top+(-v.y*0.5+0.5)*rect.height};
})()`);
const beforeB = app.run("(function(){ return {cells:cells.map(function(c){return c.sel!==false;}), parts:parts.map(function(p){return !!p.hidden;})}; })()");
const evB = realTap(apexScreen.x, apexScreen.y);
console.log("    事件接线: " + JSON.stringify(evB));
const afterB = app.run("(function(){ return {cells:cells.map(function(c){return c.sel!==false;}), parts:parts.map(function(p){return !!p.hidden;}), hiddenKeys:cells.filter(function(c){return c.sel===false;}).map(function(c){return c.key;})}; })()");
console.log("    before cells: " + JSON.stringify(beforeB.cells));
console.log("    after  cells: " + JSON.stringify(afterB.cells) + "  hidden=" + JSON.stringify(afterB.hiddenKeys));
check("真实事件流能触发点选（有响应）",
      JSON.stringify(beforeB.cells) !== JSON.stringify(afterB.cells) ||
      JSON.stringify(beforeB.parts) !== JSON.stringify(afterB.parts));
check("只隐藏了 1 块（不是整个模型消失）",
      afterB.cells.filter(function(x){ return x === false; }).length === 1,
      "隐藏块数=" + afterB.cells.filter(function(x){ return x === false; }).length);
check("没有把整个部件隐藏掉",
      afterB.parts.every(function(h){ return h === false; }), JSON.stringify(afterB.parts));
check("仍有可见的分块（画面不会全空）",
      afterB.cells.filter(function(x){ return x !== false; }).length > 0,
      "可见=" + afterB.cells.filter(function(x){ return x !== false; }).length + "/" + afterB.cells.length);

section("C. 点选模式下部件外壳必须已隐藏（否则和分块叠在一起 = 视觉分区数虚高）");
const shell = app.run(`(function(){
  var shells = partGroup.children.filter(function(c){ return c.userData && c.userData.pi != null; });
  return {shellCount: shells.length, visible: shells.map(function(c){ return c.visible; }),
          cellMeshCount: cellGroup ? cellGroup.children.length : 0};
})()`);
console.log("    " + JSON.stringify(shell));
check("部件外壳在点选模式下不可见", shell.visible.every(function(v){ return v === false; }), JSON.stringify(shell.visible));
check("分块网格存在且有内容", shell.cellMeshCount > 0, shell.cellMeshCount + " 个 mesh");

section("D. 退出点选模式后部件外壳恢复显示");
app.run("mode='all'; refresh();");
const restored = app.run(`(function(){
  var shells = partGroup.children.filter(function(c){ return c.userData && c.userData.pi != null; });
  return shells.map(function(c){ return c.visible; });
})()`);
check("all 模式下外壳恢复可见", restored.every(function(v){ return v === true; }), JSON.stringify(restored));

section("E. 实验室模式：真实事件流点选也应命中分块");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; addPart('pyr3'); addPart('box');");
app.run("(function(){ var a=parts[0],b=parts[1]; a.r=24;a.h=50;a.type='horiz';a.x=a.y=a.z=0;" +
        " b.w=90;b.d=90;b.h=26;b.type='horiz';b.x=0;b.y=-18;b.z=0; })()");
app.run("mode='pick'; refresh();");
app.run("(function(){ useOrthoCam(false); camera.position.set(120,150,180); camera.lookAt(0,0,0); camera.updateMatrixWorld(true); controls.target.set(0,0,0); })()");
const labCentre = app.run("(function(){ var r=renderer.domElement.getBoundingClientRect(); return {x:r.width/2, y:r.height/2}; })()");
const labBefore = app.run("(function(){ return {cells:cells.map(function(c){return c.sel!==false;}), parts:parts.map(function(p){return !!p.hidden;})}; })()");
realTap(labCentre.x, labCentre.y);
const labAfter = app.run("(function(){ return {cells:cells.map(function(c){return c.sel!==false;}), parts:parts.map(function(p){return !!p.hidden;})}; })()");
console.log("    before: " + JSON.stringify(labBefore));
console.log("    after : " + JSON.stringify(labAfter));
check("lab 模式真实点击先隐藏分块（不动整个部件）",
      JSON.stringify(labBefore.cells) !== JSON.stringify(labAfter.cells) &&
      JSON.stringify(labBefore.parts) === JSON.stringify(labAfter.parts));

console.log("\n=========================================");
console.log("  PASS " + pass + "   FAIL " + fail);
console.log("=========================================");
process.exit(fail ? 1 : 0);
