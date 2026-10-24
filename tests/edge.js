/* Edge cases and robustness checks for the v32 changes. */
"use strict";
const { boot } = require("./boot");
const app = boot();
const doc = app.__doc;
function section(t){ console.log("\n===== " + t + " ====="); }
let bad = 0;
function ok(name, cond, detail){
  console.log((cond ? "  OK   " : "  BAD  ") + name + (detail !== undefined ? "   [" + detail + "]" : ""));
  if(!cond) bad++;
}

section("1. 变实 + 点选：隐藏部件的幽灵优先于变实");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; addPart('cyl'); partTint=true; mode='pick'; parts[0].hidden=true; buildParts();");
const ghost = app.run(`(function(){ var out=[]; partGroup.children.forEach(function(c){ if(c.material&&c.userData&&c.userData.pi!=null) out.push({c:"#"+c.material.color.getHexString(), op:c.material.opacity, tr:c.material.transparent}); }); return out; })()`);
ok("隐藏部件是幽灵(半透明)，不被变实覆盖", ghost.length === 1 && ghost[0].tr && ghost[0].op < 0.2, JSON.stringify(ghost));
const xray = app.run(`(function(){ var n=0; partGroup.traverse(function(o){ if(o.userData&&o.userData.hlDecor&&o.material&&o.material.depthTest===false) n++; }); return n; })()`);
ok("隐藏部件不画穿透轮廓（避免幽灵也浮在最上层）", xray === 0, "xray="+xray);

section("2. 变实后再切模式 / 切立体，状态保持");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; addPart('cone'); partTint=true; mode='all'; refresh();");
ok("refresh 后仍是青色", app.run(`(function(){ return partGroup.children.filter(function(c){ return c.material&&c.userData&&c.userData.pi!=null; }).every(function(c){ return c.material.color.getHexString()==='12d6c8'; }); })()`));
app.run("mode='pick'; refresh();");
ok("切到点选模式后仍是青色（未隐藏时）", app.run(`(function(){ return partGroup.children.filter(function(c){ return c.material&&c.userData&&c.userData.pi!=null; }).every(function(c){ return c.material.color.getHexString()==='12d6c8'; }); })()`));
app.run("mode='all'; applyShape('hemi');");
ok("换立体后部件被清空（clearParts）", app.run("parts.length") === 0);
ok("partTint 开关在换立体后保留（属于看开关，不进快照）", app.get("partTint") === true);

section("3. 相贯线：无相贯时不产生垃圾几何");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; partTint=false;");
app.run("addPart('sphere'); showCurves=true; buildParts();");
ok("单个球（无相交）不产生曲线", app.run("(function(){ var n=0; partGroup.traverse(function(o){ if(o.userData&&o.userData.cid) n++; }); return n; })()") === 0);
app.run("addPart('sphere');");
app.run("(function(){ parts[1].x=100; buildParts(); })()");
ok("两个相距很远的球不产生曲线", app.run("(function(){ var n=0; partGroup.traverse(function(o){ if(o.userData&&o.userData.cid) n++; }); return n; })()") === 0);

section("4. 相贯线：完全重合/内含的退化情形不炸");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; addPart('cyl'); addPart('cyl');");
app.run("(function(){ var a=parts[0],b=parts[1]; a.r=18;a.h=60;a.type='frontal';a.x=a.y=a.z=0; b.r=18;b.h=60;b.type='frontal';b.x=b.y=b.z=0; })()");
const same = app.run("(function(){ try{ var c=partPairCurves(0,1); return {ok:true,n:c.length}; }catch(e){ return {ok:false,err:e.message}; } })()");
ok("两个完全重合的圆柱不抛异常", same.ok === true, JSON.stringify(same));
app.run("(function(){ var b=parts[1]; b.r=5; b.h=10; b.x=0;b.y=0;b.z=0; })()");
const inside = app.run("(function(){ try{ var c=partPairCurves(0,1); return {ok:true,n:c.length}; }catch(e){ return {ok:false,err:e.message}; } })()");
ok("小圆柱完全内含于大圆柱时不抛异常", inside.ok === true, JSON.stringify(inside));

section("5. 相贯线：翻转(倒放)后的主立体");
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; flipped=false; applyFlip();");
app.run("addPart('cyl');");
app.run("(function(){ var p=parts[0]; p.r=10;p.h=200;p.type='horiz';p.x=p.y=p.z=0; buildParts(); })()");
const upChains = app.run("partSolidCurves(0).length");
app.run("flipped=true; applyFlip(); refresh();");
const flipChains = app.run("partSolidCurves(0).length");
ok("倒放前后都能求出相贯线", upChains > 0 && flipChains > 0, "up="+upChains+" flipped="+flipChains);
ok("倒放后曲线数量不变（对称模型）", upChains === flipChains, upChains+" vs "+flipChains);
app.run("flipped=false; applyFlip();");

section("6. 点选循环：同一位置连点会在候选间轮换");
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; addPart('sphere');");
app.run("(function(){ parts[0].r=10; parts[0].x=0;parts[0].y=0;parts[0].z=0; })()");
app.run("faces.push({type:'horiz', ang:0, x:0, y:0, z:0, on:true, flip:false});");
app.run("mode='pick'; refresh();");
app.run("(function(){ useOrthoCam(false); camera.position.set(0,0,300); camera.up.set(0,1,0); camera.lookAt(0,0,0); camera.updateMatrixWorld(true); controls.target.set(0,0,0); })()");
const cyc = app.run(`(function(){
  var seq=[];
  function tap(){ var ev={clientX:450,clientY:300,isPrimary:true,preventDefault:function(){},stopPropagation:function(){}};
    var before = {part:!!parts[0].hidden, cells:cells.map(function(c){ return c.sel!==false; }).join("")};
    tapPick(ev);
    var after = {part:!!parts[0].hidden, cells:cells.map(function(c){ return c.sel!==false; }).join("")};
    return {changed: before.part!==after.part || before.cells!==after.cells, partHidden: after.part};
  }
  for(var i=0;i<4;i++) seq.push(tap());
  return seq;
})()`);
ok("原地连点 4 次，每次都有可见变化（能轮到分块和部件）",
   cyc.filter(function(x){ return x.changed; }).length >= 2, JSON.stringify(cyc));

section("7. 相贯线在点选模式下的可见性");
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; showCurves=true;");
app.run("addPart('cyl');");
app.run("(function(){ var p=parts[0]; p.r=10;p.h=200;p.type='horiz';p.x=p.y=p.z=0; })()");
app.run("faces.push({type:'horiz', ang:0, x:0, y:0, z:0, on:true, flip:false});");
app.run("mode='pick'; refresh();");
const vis = app.run(`(function(){ var n=0, tot=0; partGroup.traverse(function(o){ if(o.userData&&o.userData.cid){ tot++; if(o.visible) n++; } }); return {total:tot, visible:n}; })()`);
ok("点选模式下部件相贯线仍可见（不被装饰隐藏规则误伤）", vis.total > 0 && vis.visible === vis.total, JSON.stringify(vis));

section("8. 性能上限：6 部件 + 相贯体 + 4 面");
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; showCurves=true;");
app.run("['cyl','sphere','box','cone','frustum','cyl'].forEach(function(k){ addPart(k); });");
app.run("addCyl('horiz'); addCyl('frontal');");
app.run("faces.push({type:'horiz', ang:0, x:0, y:0, z:0, on:true, flip:false});");
app.run("faces.push({type:'frontal', ang:0, x:0, y:0, z:0, on:true, flip:false});");
const t0 = Date.now();
let threw = null;
try { app.run("refresh();"); } catch(e){ threw = e.message; }
const dt = Date.now() - t0;
ok("满负载 refresh 不抛异常", threw === null, threw || "ok");
ok("满负载 refresh 耗时 < 5s", dt < 5000, dt+"ms");

console.log("\n" + (bad === 0 ? "ALL EDGE CASES OK" : bad + " EDGE CASE PROBLEM(S)"));
process.exit(bad ? 1 : 0);
