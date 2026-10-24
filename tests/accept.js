/* Full acceptance suite for the four reported items. Run: node test2/accept.js */
"use strict";
const { boot } = require("./boot");
const app = boot();
const doc = app.__doc;

let pass = 0, fail = 0;
function check(name, cond, detail){
  if(cond){ pass++; console.log("  PASS  " + name + (detail ? "   [" + detail + "]" : "")); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   [" + detail + "]" : "")); }
}
function section(t){ console.log("\n=== " + t + " ==="); }

function partMats(){
  return app.run(`(function(){
    var out=[];
    partGroup.children.forEach(function(ch){
      if(!ch.material) return;
      out.push({t:ch.type, c:ch.material.color.getHexString(), tr:ch.material.transparent,
                op:ch.material.opacity, dt:ch.material.depthTest, pi:(ch.userData&&ch.userData.pi!=null)?ch.userData.pi:null,
                decor:!!(ch.userData&&ch.userData.hlDecor)});
    });
    return out;
  })()`);
}
function curveTubes(){
  return app.run(`(function(){ var n=0; partGroup.traverse(function(o){ if(o.userData&&o.userData.cid) n++; }); return n; })()`);
}
function tap(x,y){
  return app.run(`(function(){
    var ev={clientX:${x},clientY:${y},isPrimary:true,preventDefault:function(){},stopPropagation:function(){}};
    try{ tapPick(ev); return "ok"; }catch(e){ return "ERR:"+e.message; }
  })()`);
}
/* tap at the TRUE centre of the viewport (never hard-code, the stub rect may differ) */
function tapCentre(){
  const c = app.run("(function(){ var r=renderer.domElement.getBoundingClientRect(); return {x:r.width/2, y:r.height/2}; })()");
  return tap(c.x, c.y);
}
function centre(){
  return app.run("(function(){ var r=renderer.domElement.getBoundingClientRect(); return {x:r.width/2, y:r.height/2}; })()");
}
function aimAt(cx,cy,cz,up){
  app.run(`(function(){
    useOrthoCam(false);
    camera.position.set(${cx},${cy},${cz});
    camera.up.set(${(up||[0,1,0]).join(",")});
    camera.lookAt(0,0,0);
    camera.updateMatrixWorld(true);
    controls.target.set(0,0,0);
  })()`);
}

/* ============ 问题① 拼装变实 ============ */
section("问题① 自由拼装 → 拼装变实（青色实体）");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; addPart('cone'); addPart('sphere'); mode='all'; refresh();");
let m0 = partMats().filter(function(x){ return x.pi != null; });
check("默认是半透明蓝", m0.every(function(x){ return x.tr && Math.abs(x.op-0.55) < 1e-6; }), "n="+m0.length);
doc.getElementById("btnSolidPart").dispatch("click");
check("按钮置为 on", doc.getElementById("btnSolidPart").classList.contains("on"));
let m1 = partMats().filter(function(x){ return x.pi != null; });
check("变成青色实体 #12d6c8", m1.every(function(x){ return x.c === "12d6c8"; }), "colors="+m1.map(function(x){return x.c;}).join(","));
check("不再半透明", m1.every(function(x){ return x.tr === false && x.op === 1; }));
check("穿透轮廓已加上（埋在立体里也看得见）",
      partMats().some(function(x){ return x.decor && x.dt === false && x.c === "5ffff0"; }));
doc.getElementById("btnSolidPart").dispatch("click");
let m2 = partMats().filter(function(x){ return x.pi != null; });
check("再点一次还原半透明", m2.every(function(x){ return x.tr && x.c === "8fd8ff"; }));

// 关键：主立体页面里部件埋在立体内部时也要看得见
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; addPart('cyl');");
app.run("(function(){ var p=parts[0]; p.r=16;p.h=44;p.x=0;p.y=0;p.z=0; })()");
app.run("mode='all'; refresh();");
const buried = app.run(`(function(){
  var camPos=new THREE.Vector3(150,95,170), occ=0, tot=0;
  var pats=partSurfPatches(parts[0]), pts=[];
  pats.forEach(function(r){ r.forEach(function(row){ row.forEach(function(p){ pts.push(p); }); }); });
  var step=Math.max(1,Math.floor(pts.length/120));
  for(var k=0;k<pts.length;k+=step){
    var P=pts[k], dir=P.clone().sub(camPos), dist=dir.length(); dir.normalize();
    raycaster.set(camPos,dir); raycaster.far=dist-0.05;
    tot++; if(raycaster.intersectObject(coneF,false).length) occ++;
  }
  raycaster.far=Infinity;
  return {tot:tot, occluded:occ};
})()`);
check("确认部件确实被主立体埋住（问题场景成立）", buried.occluded > 0, JSON.stringify(buried));
doc.getElementById("btnSolidPart").dispatch("click");
check("埋住时变实仍有穿透轮廓可见", partMats().some(function(x){ return x.decor && x.dt === false; }));
check("埋住时网格也确实是青色实体", partMats().filter(function(x){ return x.pi != null; }).every(function(x){ return x.c === "12d6c8"; }));

/* ============ 问题② 相贯线 ============ */
section("问题② 自由拼装与其他模型相贯 → 显示相贯线");
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; showCurves=false; addPart('cyl');");
app.run("(function(){ var p=parts[0]; p.r=10;p.h=200;p.type='horiz';p.ang=0;p.x=0;p.y=0;p.z=0; buildParts(); })()");
check("关着相贯线时没有曲线", curveTubes() === 0);
doc.getElementById("btnCurve").dispatch("click");
check("点【相贯线】按钮后立刻画出（问题②根因）", curveTubes() > 0, "tubes="+curveTubes());
const chains = app.run("(function(){ return partSolidCurves(0).map(function(c){ return c.length; }); })()");
check("曲线是完整折线而非碎段", chains.length >= 1 && chains.every(function(n){ return n >= 8; }), "lens="+JSON.stringify(chains));
const geo = app.run(`(function(){
  var ch=partSolidCurves(0), S=SHAPES[shape], out=[];
  ch.forEach(function(c){
    var wc=0,wp=0;
    c.forEach(function(p){
      /* "在立体边界上" = 在侧面上 或 在顶/底盖平面上。
         注意不能只查侧面：竖直圆柱穿过圆锥时，除了侧面交线，
         还会在底面(y=-H/2)上切出一整圈圆 —— 那也是真实的相贯线。 */
      var rAt=S.R*((S.H/2-p.y)/S.H), rHere=Math.hypot(p.x,p.z);
      var dSide=Math.abs(rHere-rAt);
      var dCap=Math.min(Math.abs(p.y-S.H/2), Math.abs(p.y+S.H/2));
      wc=Math.max(wc, Math.min(dSide, dCap));
      wp=Math.max(wp, Math.min(Math.abs(Math.hypot(p.x,p.z)-10), Math.abs(Math.abs(p.y)-100)));
    });
    out.push({n:c.length, devSolid:Math.round(wc*1000)/1000, devPart:Math.round(wp*1000)/1000});
  });
  return out;
})()`);
check("曲线点同时落在两个实体的边界上（几何正确）",
      geo.every(function(g){ return g.devSolid < 0.5 && g.devPart < 0.5; }), JSON.stringify(geo));
const per = app.run(`(function(){ var c=partSolidCurves(0)[0], s=0;
  for(var i=1;i<c.length;i++) s+=c[i].distanceTo(c[i-1]); return Math.round(s*100)/100; })()`);
check("周长接近理论值 2πr=62.83", Math.abs(per-62.83) < 2, "perimeter="+per);

// 部件 vs 部件
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; addPart('cyl'); addPart('cyl');");
app.run("(function(){ var a=parts[0],b=parts[1]; a.r=22;a.h=80;a.type='horiz';a.x=a.y=a.z=0; b.r=22;b.h=80;b.type='frontal';b.x=b.y=b.z=0; buildParts(); })()");
const pair = app.run("(function(){ return partPairCurves(0,1).map(function(c){ return c.length; }); })()");
check("部件 vs 部件也有相贯线", pair.length >= 1 && pair.every(function(n){ return n >= 8; }), "lens="+JSON.stringify(pair));

// 部件 vs 相贯体
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; addPart('cyl');");
app.run("(function(){ var p=parts[0]; p.r=12;p.h=200;p.type='horiz';p.x=p.y=p.z=0; buildParts(); })()");
app.run("addCyl('frontal');");
const pc = app.run("(function(){ return partCylCurves(0, activeCyls()[0]).map(function(c){ return c.length; }); })()");
check("部件 vs 相贯体也有相贯线", pc.length >= 1 && pc.every(function(n){ return n >= 8; }), "lens="+JSON.stringify(pc));

/* ============ 问题③ 点选保留部分 ============ */
section("问题③ 自由拼装 → 点选保留部分");
/* v33.2 设计变更：**分块优先于整个部件**。
   实验室模式下部件也会被切成子区域（cells），点一下先隐藏"那一小块"，
   原地再点一下才切到"整个部件"。这样用户点锥顶不会整块消失。
   下面按新语义断言：连点最多 4 次，必须既能选中分块、也能选中整个部件。 */
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; addPart('cyl');");
app.run("(function(){ var p=parts[0]; p.r=18;p.h=60;p.type='horiz';p.x=p.y=p.z=0; })()");
app.run("mode='pick'; refresh();");
aimAt(0,0,300);
check("点选模式可进入", app.get("mode") === "pick");

/* 连点采样：记录每次点击后"分块状态"和"部件状态"的变化 */
const cycle = app.run(`(function(){
  var rect=renderer.domElement.getBoundingClientRect();
  var cx=rect.width/2, cy=rect.height/2;
  var out=[];
  for(var i=0;i<4;i++){
    var ev={clientX:cx,clientY:cy,isPrimary:true,preventDefault:function(){},stopPropagation:function(){}};
    var bp=!!parts[0].hidden, bc=cells.map(function(c){return c.sel!==false;}).join("");
    tapPick(ev);
    var ap=!!parts[0].hidden, ac=cells.map(function(c){return c.sel!==false;}).join("");
    out.push({partHidden:ap, cellSig:ac,
              hitPart: bp!==ap, hitCell: bc!==ac});
  }
  return out;
})()`);
console.log("    连点序列: " + JSON.stringify(cycle));
check("第一次点击先隐藏分块（不是整个部件）",
      cycle[0].hitCell === true && cycle[0].partHidden === false,
      "hitCell=" + cycle[0].hitCell + " partHidden=" + cycle[0].partHidden);
check("原地连点能切换到整个部件（可达性保留）",
      cycle.some(function(x){ return x.partHidden === true; }),
      "partHidden 序列=" + JSON.stringify(cycle.map(function(x){return x.partHidden;})));
check("连点能切回分块/部件（轮换正常）",
      cycle.filter(function(x){ return x.hitCell || x.hitPart; }).length >= 3,
      "有变化的点击数=" + cycle.filter(function(x){ return x.hitCell || x.hitPart; }).length);

/* 复位，测"全部保留" */
app.run("pickSel={}; cells.forEach(function(c){ c.sel=true; }); parts.forEach(function(p){ p.hidden=false; }); buildParts(); buildCellVis();");

// 埋在立体里的部件也要能点到（问题③的真正场景）
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; addPart('sphere');");
app.run("(function(){ parts[0].r=10; parts[0].x=0;parts[0].y=0;parts[0].z=0; })()");
app.run("faces.push({type:'horiz', ang:0, x:0, y:0, z:0, on:true, flip:false});");
app.run("mode='pick'; refresh();");
aimAt(0,0,300);
const occl = app.run(`(function(){
  raycaster.setFromCamera({x:0,y:0}, activeCam);
  var ph=raycaster.intersectObjects(partGroup.children,false);
  var ch=cellGroup?raycaster.intersectObjects(cellGroup.children,false):[];
  return {part: ph.length?Math.round(ph[0].distance*10)/10:null,
          cell: ch.length?Math.round(ch[0].distance*10)/10:null};
})()`);
check("确认分块比部件更近（遮挡场景成立）", occl.cell != null && occl.cell < occl.part, JSON.stringify(occl));
const buriedPick = app.run(`(function(){
  var rect=renderer.domElement.getBoundingClientRect();
  var ev={clientX:rect.width/2,clientY:rect.height/2,isPrimary:true,preventDefault:function(){},stopPropagation:function(){}};
  var bp=!!parts[0].hidden, bc=cells.map(function(c){return c.sel!==false;}).join("");
  tapPick(ev);
  var ap=!!parts[0].hidden, ac=cells.map(function(c){return c.sel!==false;}).join("");
  return {hitCell: bc!==ac, hitPart: bp!==ap};
})()`);
check("被分块遮挡时点击仍有响应（不会点不动）",
      buriedPick.hitCell === true || buriedPick.hitPart === true, JSON.stringify(buriedPick));

// 全部保留
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; addPart('cyl'); addPart('sphere');");
app.run("mode='pick'; parts[0].hidden=true; parts[1].hidden=true; buildParts();");
check("两个部件都隐藏了", app.run("parts.filter(function(p){return p.hidden;}).length") === 2);
doc.getElementById("pickAll").dispatch("click");
check("「全部保留」恢复所有隐藏部件", app.run("parts.filter(function(p){return p.hidden;}).length") === 0);

/* ============ 优化① 锁定 → 冻结 → 取消 ============ */
section("优化① 锁定 → 冻结 → 取消 三态");
app.run("lockState='none'; applyLockState();");
const btnLock = doc.getElementById("btnLock");
check("初始：文案「锁定」", btnLock.textContent === "锁定");
btnLock.dispatch("click");
check("第1次点击 → 文案变「冻结」", btnLock.textContent === "冻结", btnLock.textContent);
check("  锁定态禁止 3D 拖动", app.get("dragLocked") === true);
check("  锁定态尚未冻结（面板仍可改数值）", app.get("frozen") === false);
btnLock.dispatch("click");
check("第2次点击 → 文案变「取消」", btnLock.textContent === "取消", btnLock.textContent);
check("  进入冻结态", app.get("frozen") === true && doc.body.classList.contains("frozen"));
check("  冻结态仍可旋转视角（controls 可用）", app.run("controls.enabled") === true);
const v = app.run("(function(){ try{ setView('front'); setView('top'); setView('left'); return {ok:true, cam:activeCam===orthoCam}; }catch(e){ return {ok:false,err:e.message}; } })()");
check("  冻结态三视图可用", v.ok === true && v.cam === true, JSON.stringify(v));
check("  冻结态点选被禁用", app.run("(function(){ var ev={clientX:450,clientY:300,isPrimary:true,preventDefault:function(){},stopPropagation:function(){}}; var b=JSON.stringify(parts); mode='pick'; tapPick(ev); return JSON.stringify(parts)===b; })()"));
check("  冻结态面板/左按钮被 CSS 禁用",
      /body\.frozen #panel\{[^}]*pointer-events:none/.test(require("fs").readFileSync(require("path").resolve(__dirname,"..","src/index.html"),"utf8")));
btnLock.dispatch("click");
check("第3次点击 → 回到「锁定」文案并解除", btnLock.textContent === "锁定" && app.get("lockState") === "none");
check("  恢复可拖动", app.get("dragLocked") === false && app.get("frozen") === false);

/* ============ 回归 ============ */
section("回归：原有功能不受影响");
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; lockState='none'; applyLockState(); mode='all';");
app.run("addCyl('horiz'); showCurves=true; refresh();");
check("相贯体相贯线仍正常", app.run("(function(){ var n=0; cylVis.forEach(function(v){ v.g.traverse(function(o){ if(o.userData&&o.userData.hlCurve) n++; }); }); return n; })()") > 0);
app.run("faces.push({type:'horiz', ang:0, x:0, y:-10, z:0, on:true, flip:false}); showXlines=true; refresh();");
check("交线仍正常", app.run("xlineGroup ? xlineGroup.children.length : 0") > 0);
app.run("mode='pick'; refresh();");
check("主立体分块仍正常", app.run("cells.length") > 0);
app.run("mode='all'; refresh();");
app.run("applyShape('lab'); parts.length=0; ['cone','sphere','hemi','box','cube','cyl','slot','pyr3','frustum'].forEach(function(k){ addPart(k); });");
check("9 种部件都能放（上限 6 个）", app.run("parts.length") === 6);
const t0 = Date.now();
app.run("showCurves=true; buildParts();");
const ms = Date.now()-t0;
check("6 个部件重建 + 相贯线耗时可接受", ms < 3000, ms+"ms");
check("每个部件都能正常建几何", app.run("(function(){ try{ parts.forEach(function(p){ partGeoOf(p); }); return true; }catch(e){ return false; } })()"));

console.log("\n=========================================");
console.log("  PASS " + pass + "   FAIL " + fail);
console.log("=========================================");
process.exit(fail ? 1 : 0);
