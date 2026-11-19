"use strict";
const { boot } = require("./boot");
const app = boot();
function run(code){ return app.run(code); }
function dump(){ 
  return run('JSON.stringify(cells.map(function(c){ var o={key:c.key,sel:c.sel,owner:c.ownerPart||null,cyls:[]}; (c.cyls||[]).forEach(function(s){o.cyls.push(s?s.keep:null);}); return o; }))');
}
run("applyShape('hcyl')");
run("faces.length=0; cyls.length=0; cutHole=false; pickSel={}; mode='all'; refresh();");
run("addCyl('frontal')");
run("(function(){ var c=cyls[0]; c.r=11; c.len=90; c.x=0; c.y=35; c.z=60; c.on=true; refresh(); })()");
run("mode='pick'; refresh();");
console.log("cells:", dump());
const overlapKey = run("(function(){ var c = cells.filter(function(c){ return (c.cyls||[]).some(function(s){ return s && s.keep<0; }); })[0]; return c ? c.key : null; })()");
console.log("overlap key:", overlapKey);
run("pickSel[" + JSON.stringify(overlapKey) + "]=false; cells.forEach(function(c){ if(c.key===" + JSON.stringify(overlapKey) + ") c.sel=false; }); buildCellVis(); buildBoreVis();");
console.log("after hide:", dump());
console.log("bore walls after hide:", run("(function(){ buildBoreVis(); return boreGroup ? boreGroup.children.length : -1; })()"));
// 检查保留块的封盖几何里有没有覆盖圆柱切面的三角形（cellCaps 只切平面，不切圆柱）
// 孔壁规格：贯穿圆非 hole → 无孔壁。检查把该相贯体标成 hole 后孔壁是否能生成（对照）
run("mode='all'; cyls[0].hole=true; refresh(); buildBoreVis();");
console.log("if hole=true, all-mode bore walls:", run("(function(){ return boreGroup ? boreGroup.children.length : -1; })()"));

/* --- 关键回归：all 模式（还没进点选）也要有切面 --- */
run("mode='all'; cyls[0].hole=false; pickSel={}; refresh(); buildBoreVis();");
console.log("all-mode (非孔相贯体) 切面网格数:", run("(function(){ return boreGroup ? boreGroup.children.length : -1; })()"));
console.log("切面包围盒:", run(`(function(){
  if(!boreGroup) return null;
  var mn={x:1e9,y:1e9,z:1e9}, mx={x:-1e9,y:-1e9,z:-1e9};
  boreGroup.children.forEach(function(m){
    m.geometry.computeBoundingBox();
    var b = m.geometry.boundingBox;
    mn.x=Math.min(mn.x,b.min.x);mn.y=Math.min(mn.y,b.min.y);mn.z=Math.min(mn.z,b.min.z);
    mx.x=Math.max(mx.x,b.max.x);mx.y=Math.max(mx.y,b.max.y);mx.z=Math.max(mx.z,b.max.z);
  });
  var r2=function(q){return Math.round(q*10)/10;};
  return [r2(mn.x),r2(mn.y),r2(mn.z),r2(mx.x),r2(mx.y),r2(mx.z)];
})()`));

/* 贯体变实后本体不透明 → 不该再补切面（z-fighting） */
run("bodyTint=true; refresh(); buildBoreVis();");
console.log("贯体变实 all-mode 切面网格数（应为 -1 或 0）:", run("(function(){ return boreGroup ? boreGroup.children.length : -1; })()"));
run("bodyTint=false; refresh();");
console.log("关掉变实后恢复切面:", run("(function(){ return boreGroup ? boreGroup.children.length : -1; })()"));
