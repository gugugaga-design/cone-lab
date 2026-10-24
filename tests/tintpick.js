/* v33.5 专项回归：**贯体变实 + 点选保留部分** 的遮挡问题。
   用户第 6 次反馈：截图里橙色横块 = 不透明相贯体（贯体变实已开），
   它把分块网格整个盖住 → 点锥顶后分块确实隐藏了，但屏幕上橙色实体还在，
   看起来就是"整个正四棱锥全没了"。

   断言：
   ① 点选模式下不透明相贯体实体不可见
   ② 但截面轮廓/棱线（hlKeep）仍可见，用户能看见也能抓住相贯体
   ③ 分块网格可见
   ④ 真实事件流点锥顶只隐藏 1 块，其余保留

   运行: node test2/tintpick.js */
"use strict";
const { boot } = require("./boot");
const app = boot();
let pass = 0, fail = 0;
function check(n, c, d){ if(c){pass++;console.log("  PASS  "+n+(d?"   ["+d+"]":""));} else {fail++;console.log("  FAIL  "+n+(d?"   ["+d+"]":""));} }
function section(t){ console.log("\n=== " + t + " ==="); }

function setup(cylSetup){
  app.run("applyShape('pyr3'); parts.length=0; cyls.length=0; faces.length=0;");
  app.run("cutShape='rect'; cutHole=false; addCyl('horiz');");
  app.run("(function(){ var c=cyls[0]; " + cylSetup + " })()");
  app.run("bodyTint=true; mode='pick'; refresh();");
}

/* ===== A. 不透明实体必须隐藏，轮廓必须保留 ===== */
section("A. 贯体变实 + 点选：不透明实体隐藏、轮廓保留");
setup("c.w=300; c.h=300; c.len=15; c.y=-5;");
const A = app.run(`(function(){
  var rows=[];
  cylVis.forEach(function(v){
    v.g.children.forEach(function(o){
      rows.push({type:o.type, vis:o.visible, hlKeep:!!o.userData.hlKeep,
                 opaque:(o.isMesh && o.material && !o.material.transparent &&
                         o.material.opacity>0.9 && !o.userData.hlDecor)});
    });
  });
  return {rows:rows,
          opaqueVisible: rows.some(function(r){ return r.opaque && r.vis; }),
          handleVisible: rows.some(function(r){ return r.hlKeep && r.vis; }),
          cells:cells.length};
})()`);
console.log("    " + JSON.stringify(A.rows));
/* v33.6 起：相贯体实体**必须常显** —— 用户明确反馈"刚切点选模式、还没点，长方体就空了"。
   所以这里反过来断言：相贯体必须可见，否则就是回归。 */
check("不透明相贯体实体在点选模式下保持可见（不能变空）", A.opaqueVisible === true,
      'opaqueVisible=' + A.opaqueVisible);
check("相贯体轮廓（hlKeep）仍可见（能看见也能抓）", A.handleVisible === true);
check("分块网格存在", A.cells >= 2, "cells=" + A.cells);

/* ===== B. 真实事件流点锥顶 ===== */
section("B. 真实点击锥顶 → 只隐藏锥顶一块");
app.run("(function(){ useOrthoCam(false); camera.position.set(150,95,170);" +
        " camera.lookAt(0,0,0); camera.updateMatrixWorld(true); controls.target.set(0,0,0); })()");
const B = app.run(`(function(){
  var H=SHAPES[shape].H;
  var v=new THREE.Vector3(0,H/2-2,0).project(activeCam);
  var rect=renderer.domElement.getBoundingClientRect();
  var sx=rect.left+(v.x*0.5+0.5)*rect.width, sy=rect.top+(-v.y*0.5+0.5)*rect.height;
  function mk(t){ return {type:t,clientX:sx,clientY:sy,pointerId:1,pointerType:'touch',
    isPrimary:true,button:0,buttons:(t==='pointerup'?0:1),
    preventDefault:function(){},stopPropagation:function(){}}; }
  var el=renderer.domElement;
  ((el._listeners&&el._listeners.pointerdown)||[]).forEach(function(f){ f.call(el,mk('pointerdown')); });
  ((window._listeners&&window._listeners.pointerup)||[]).forEach(function(f){ f.call(window,mk('pointerup')); });
  return {hidden:cells.filter(function(c){return c.sel===false;}).map(function(c){return c.key;}),
          visible:cells.filter(function(c){return c.sel!==false;}).length,
          total:cells.length,
          visibleMeshes: cellGroup ? cellGroup.children.filter(function(m){
            return m.visible && m.material && m.material.opacity > 0.5; }).length : 0};
})()`);
console.log("    " + JSON.stringify(B));
check("只隐藏 1 块", B.hidden.length === 1, JSON.stringify(B.hidden));
check("其余块仍可见（不是整块消失）", B.visible === B.total - 1,
      "visible=" + B.visible + "/" + B.total);
check("仍有可见的分块网格（画面不会空）", B.visibleMeshes > 0, B.visibleMeshes + " 个");

/* ===== C. 扫描不同厚度，都不能整块消失 ===== */
section("C. 扫描不同长方体厚度（贯体变实开）");
let vanish = 0, cases = 0;
[8,10,12,15,18,22,26].forEach(function(th){
  setup("c.w=300; c.h=300; c.len=" + th + "; c.y=-5;");
  const r = app.run(`(function(){
    var act=activeFaceData(), cs=activeCyls(), S=SHAPES[shape];
    var best=null;
    for(var i=0;i<=60;i++){
      var y=-S.H/2+S.H*i/60, rmax=radiusAt(y);
      if(rmax<=0.3) continue;
      for(var j=0;j<16;j++){
        var t=j/16*Math.PI*2;
        for(var k=1;k<=3;k++){
          var rr=rmax*k/3;
          var P=new THREE.Vector3(rr*Math.cos(t), y, rr*Math.sin(t));
          if(!insideCone(P)) continue;
          var kk=cellKeyAt(P,act,cs);
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
    return {cells:cells.length, vis:vis};
  })()`);
  if(r.skip) return;
  cases++;
  const bad = r.vis === 0;
  if(bad) vanish++;
  console.log("    厚度=" + String(th).padStart(3) + "  cells=" + String(r.cells).padStart(2) +
              "  隐藏锥顶后可见=" + r.vis + "/" + r.cells + (bad ? "  <<< 整块消失" : ""));
});
check("所有厚度都不会整块消失", vanish === 0, vanish + "/" + cases);

/* ===== D. 关闭贯体变实（半透明相贯体）也要正常 ===== */
section("D. 关闭贯体变实（半透明相贯体）同样正常");
app.run("applyShape('pyr3'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("cutShape='rect'; cutHole=false; addCyl('horiz');");
app.run("(function(){ var c=cyls[0]; c.w=300;c.h=300;c.len=15;c.y=-5; })()");
app.run("bodyTint=false; mode='pick'; refresh();");
const D = app.run(`(function(){
  var semi = [];
  cylVis.forEach(function(v){
    v.g.children.forEach(function(o){
      if(o.isMesh && o.material && o.material.transparent && !o.userData.hlDecor)
        semi.push({vis:o.visible, op:o.material.opacity});
    });
  });
  return {cells:cells.length, semiBodies:semi};
})()`);
console.log("    " + JSON.stringify(D));
check("半透明相贯体在点选模式下同样保持可见",
      D.semiBodies.every(function(s){ return s.vis === true; }),
      JSON.stringify(D.semiBodies));

console.log("\n=========================================");
console.log("  PASS " + pass + "   FAIL " + fail);
console.log("=========================================");
process.exit(fail ? 1 : 0);
