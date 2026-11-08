/* v33.35 回归套件：连续（扫掠）吸附 + 拖动路径去重
   ① 快速划过 / 事件合并时，一步跨过吸附位置也必须触发；
   ② 慢速拖动的吸合、渐进脱离、OFF 处无跳变保持原样；
   ③ 拖动路径的冗余重建与对象分配被清掉（性能上限）。

   跑法：node tests/snapsweep.js
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
const R = code => app.run(code);
const near = (a, b, tol) => Math.abs(a-b) <= (tol == null ? 0.5 : tol);

/* ============ 一、源码接线 ============ */
section("一、源码：连续判定与去重都接进去了");
check("存在 1D 跨越判定 snapCrossedTarget 与 3D 扫掠判定 snapContactSwept",
      /function snapCrossedTarget\(/.test(HTML) && /function snapContactSwept\(/.test(HTML));
check("snapCrossedTarget 按'本段最后经过'选目标（快速划过多个目标不倒吸）",
      /if\(at > bestAt\)\{ bestAt=at; best=t; \}/.test(HTML));
check("接触折线预编译为标量数组 + AABB 粗筛（不在每帧 clone Vector3）",
      /function snapSegFast\(/.test(HTML) && /function snapAabbHit\(/.test(HTML) &&
      /function snapPtSegDistSq\(/.test(HTML) && /segFast:\[\]/.test(HTML));
check("snapContactNearest 不再重复遍历 72 个顶点（只剩 segFast + solo）",
      /for\(i=0;i<fs\.length;i\+\+\)/.test(HTML) && /B\.solo\.length/.test(HTML) &&
      !/B\.pts\.forEach\(function\(p\)\{[\s\S]{0,160}?p\.distanceTo\(raw\)/.test(HTML));
check("snapPenT 改用预计算 c1/c2；sd0 提到 72 个方向之外",
      /function snapPenT\(c1, c2, sd0, dw, t\)/.test(HTML) &&
      /for\(k=0;k<D\.length;k\+\+\) sd0\.push\(D\[k\]\.dot\(X0\)\);/.test(HTML));
check("snapContactApply 用 ctx.prevRaw 做连续判定，脱离点不重吸",
      /var prev = ctx\.prevRaw;/.test(HTML) && /snapContactSwept\(prev, raw, ctx, avoid\)/.test(HTML) &&
      /prevRaw:anchor\.clone\(\)/.test(HTML));
check("面片拖动记录 dPrev（手指原始位置）并在吸住时统一 engage",
      /dPrev:d/.test(HTML) && /drag\.dPrev = dRaw;/.test(HTML) &&
      /function snapFaceEngage\(/.test(HTML) && /snapCrossedTarget\(drag\.targets, dPrev, dRaw, hadTgt\)/.test(HTML));
check("越过目标时本帧钉住，下一帧再按原曲线脱离",
      /if\(catchNow && aa > SNAP_ON\) dCur = tgt\.d;/.test(HTML) &&
      /dCur = tgt\.d \+ sgn\*snapEase\(aa\);/.test(HTML));
check("触摸 pointermove 的 buttons=0 不再误收尾拖动",
      /e\.pointerType !== "touch"/.test(HTML));
check("位置未变化时跳过整条重建链（部件 / 相贯体 / 面片）",
      /if\(nxP !== pr3\.x \|\| nyP !== pr3\.y \|\| nzP !== pr3\.z\)\{/.test(HTML) &&
      /if\(nxC !== c2\.x \|\| nyC !== c2\.y \|\| nzC !== c2\.z\)\{/.test(HTML));
check("applyClipping 只取一次 activeFaceData/activeCyls 并下传",
      /var actF = activeFaceData\(\), acy = activeCyls\(\);/.test(HTML) &&
      /buildInterCaps\(empty, actF, acy\);/.test(HTML) &&
      /interIsEmpty\(posP, actF\)/.test(HTML));
check("rimPoints 按 shape/R/H/flipped 缓存，避免拖动开始重复生成点云",
      /var _rimCache = null, _rimKey = "";/.test(HTML) &&
      /if\(_rimCache && _rimKey === key\) return _rimCache;/.test(HTML));

/* ============ 二、1D 跨越判定单元 ============ */
section("二、snapCrossedTarget：跨过才算，取最后经过的那个");
const ts3 = R("[{d:-5,k:'a'},{d:0,k:'b'},{d:5,k:'c'}]");
const unit = R(`(function(){
  var ts = ${JSON.stringify(ts3)};
  return {
    fwd: (function(){ var t=snapCrossedTarget(ts,-10,10,null); return t?t.d:null; })(),
    rev: (function(){ var t=snapCrossedTarget(ts,10,-10,null); return t?t.d:null; })(),
    none:(function(){ var t=snapCrossedTarget(ts,-10,-8,null); return t?t.d:null; })(),
    zero:(function(){ var t=snapCrossedTarget(ts,3,3,null); return t?t.d:null; })(),
    atStart:(function(){ var t=snapCrossedTarget(ts,-5,10,null); return t?t.d:null; })(),
    cur:(function(){ var t=snapCrossedTarget(ts,-10,10,ts[2]); return t?t.d:null; })(),
    one:(function(){ var t=snapCrossedTarget(ts,-10,-3,null); return t?t.d:null; })()
  };
})()`);
check("一步 -10→+10 跨过 3 个目标时取最晚经过的 d=5", near(unit.fwd, 5, 1e-9), ""+unit.fwd);
check("反向 +10→-10 取最晚经过的 d=-5", near(unit.rev, -5, 1e-9), ""+unit.rev);
check("没跨过任何目标时返回 null", unit.none === null && unit.zero === null);
check("目标恰好在起点不算'经过'(at=0) 被跳过", near(unit.atStart, 5, 1e-9), ""+unit.atStart);
check("当前吸住的目标被排除，不会原地重吸", near(unit.cur, 0, 1e-9), ""+unit.cur);
check("只跨过一个目标时命中它", near(unit.one, -5, 1e-9), ""+unit.one);

/* ============ 三、真实事件流：拖面片一步跨过吸附位置 ============ */
section("三、真实 pointermove 事件流：拖面片越过吸附位置");
function setupFace(){
  R(`applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; mode='all';
     faces.push({type:'lat', ang:0, x:0, y:0, z:0, on:true, flip:false});
     (function(){ useOrthoCam(false); camera.position.set(0,0,220); camera.lookAt(0,0,0);
       camera.updateMatrixWorld(true); camera.updateProjectionMatrix(); controls.target.set(0,0,0); })();
     drag={i:0,nv:new THREE.Vector3(1,0,0),p0:new THREE.Vector3(0,0,0),d0:0,
           targets:[],tgt:null,lines:[],moved:false,dPrev:0};
     drag.targets=buildTargets(0);
     partDrag=null; cylDrag=null; pendingPart=null; pendingCyl=null;
     hideSnapTip();`);
}
function faceMove(d, buttons, ptype){
  return R(`(function(){
    var P=new THREE.Vector3(${d},0,0), v=P.clone().project(activeCam);
    var e={type:'pointermove', clientX:(v.x*0.5+0.5)*900, clientY:(-v.y*0.5+0.5)*600,
           pointerId:1,isPrimary:true,buttons:${buttons === undefined ? 1 : buttons},button:0,
           pointerType:'${ptype || "mouse"}',
           preventDefault:function(){},stopPropagation:function(){}};
    ((window._listeners&&window._listeners.pointermove)||[]).forEach(function(f){f.call(window,e);});
    return {d:+faceConst(faces[0],drag.nv).toFixed(3), tgt:drag.tgt?drag.tgt.kind:null,
            tip:snapTipEl?!snapTipEl.hidden:false, text:snapTipEl?snapTipEl.textContent:'',
            moved:!!drag.moved};
  })()`);
}
setupFace();
const fTargets = R("drag.targets.map(function(t){return {k:t.kind,d:t.d};})");
check("测试场景确实含 d≈0 的吸附目标（过锥尖/中心）",
      fTargets.some(t => near(t.d, 0, 0.05)), JSON.stringify(fTargets.map(t=>t.k+":"+t.d.toFixed(1))));
const f0 = faceMove(-10);
check("起点 -10mm 在吸合带之外（不提前吸住）", f0.tgt === null && f0.d < -9, JSON.stringify(f0));
/* 一步从 -10 跳到 +10：终点离目标 10mm > SNAP_OFF(9)，逐点判定必然整段漏掉 */
const f1 = faceMove(10);
check("一步跨过触发位置后吸附生效，面片停在目标 d=0",
      near(f1.d, 0, 0.05) && f1.tgt !== null, JSON.stringify(f1));
check("触发时顶部提示条可见且写明吸附内容", f1.tip && /已吸附/.test(f1.text), f1.text);
check("终点 10mm > SNAP_OFF(9)：证明旧版逐点判定不可能命中",
      R("SNAP_OFF") === 9 && Math.abs(10-0) > R("SNAP_OFF"));
check("本次移动被记为真实拖动（moved=true）", f1.moved === true);

/* 继续往外拖：不能永久粘死，按原曲线脱离 */
const f2 = faceMove(12), f3 = faceMove(16);
check("越过目标后继续拖远可正常脱离、跟回手指",
      f2.tgt === null && f3.tgt === null && near(f3.d, 16, 0.2),
      JSON.stringify({f2:f2.d, f3:f3.d}));
/* 反向一步跨回来也必须再触发 */
const f4 = faceMove(-10);
check("反向一步跨过触发位置同样吸附（方向无关）",
      near(f4.d, 0, 0.05) && f4.tgt !== null, JSON.stringify(f4));

/* 慢速拖动：吸合 / 渐进脱离 / OFF 处连续 —— 交互行为保持 */
setupFace();
const slow = [-10,-6,-3,-2,0,2,3,5,7,9,10].map(d => faceMove(d));
check("慢速靠近在 SNAP_ON 内吸住，且吸住段位置钉在目标",
      slow[3].tgt !== null && near(slow[3].d, 0, 0.05) && near(slow[5].d, 0, 0.05),
      JSON.stringify(slow.slice(3,6).map(x=>x.d)));
check("ON<aa<OFF 渐进脱离（3→5→7 单调递增且不越过手指）",
      slow[7].d > slow[6].d && slow[8].d > slow[7].d && slow[8].d < 7.2,
      JSON.stringify(slow.slice(6,9).map(x=>x.d)));
check("SNAP_OFF 处位置连续、无 2.8mm 跳变",
      near(slow[9].d, 9, 0.1), "d@9=" + slow[9].d);
check("超过 OFF 后完全脱离", slow[10].tgt === null && near(slow[10].d, 10, 0.1));

/* 触摸事件 buttons=0 不能被误判为松手 */
setupFace();
const t0 = faceMove(-10, 0, "touch");
const t1 = faceMove(10, 0, "touch");
check("触摸 pointermove（buttons=0）不会提前结束面片拖动",
      t0.tgt === null && near(t1.d, 0, 0.05) && t1.tgt !== null,
      JSON.stringify({t0:t0.d, t1:t1.d}));

/* ============ 四、真实事件流：模型间接触一步跨过 ============ */
section("四、真实 pointermove 事件流：拖部件越过接触位置");
function setupContact(){
  R(`applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; mode='all';
     addPart('cyl'); addPart('cyl');
     [0,1].forEach(function(i){ var p=parts[i]; p.type='horiz'; p.ang=0; p.r=10; p.h=20; p.y=0; p.z=0; });
     parts[0].x=0; parts[1].x=60;
     (function(){ useOrthoCam(false); camera.position.set(0,0,220); camera.lookAt(0,0,0);
       camera.updateMatrixWorld(true); camera.updateProjectionMatrix(); controls.target.set(0,0,0); })();
     drag=null; partDrag=null; cylDrag=null; pendingPart=null; pendingCyl=null;
     hideSnapTip();`);
}
function contactJump(targetX, buttons, ptype){
  return R(`(function(){
    function scr(P){ var v=P.clone().project(activeCam); return {x:(v.x*0.5+0.5)*900, y:(-v.y*0.5+0.5)*600}; }
    parts[1].x=60;
    var o0=new THREE.Vector3(60,0,0);
    pendingPart={pi:1,p0:o0.clone(),o0:o0.clone(),nrm:new THREE.Vector3(0,0,-1),
                 sx:scr(o0).x,sy:scr(o0).y};
    var s=scr(new THREE.Vector3(${targetX},0,0));
    var e={type:'pointermove',clientX:s.x,clientY:s.y,pointerId:1,isPrimary:true,
           buttons:${buttons === undefined ? 1 : buttons},button:0,
           pointerType:'${ptype || "mouse"}',
           preventDefault:function(){},stopPropagation:function(){}};
    ((window._listeners&&window._listeners.pointermove)||[]).forEach(function(f){f.call(window,e);});
    return {x:+parts[1].x.toFixed(3), snapped:!!(partDrag&&partDrag.snap&&partDrag.snap.tgt),
            alive:!!partDrag, tip:snapTipEl?!snapTipEl.hidden:false};
  })()`);
}
setupContact();
const c1 = contactJump(4);
check("单事件 60→4 整段跨过接触面 x=20，仍然吸到 x≈20",
      near(c1.x, 20, 0.4) && c1.snapped, JSON.stringify(c1));
check("接触吸附提示条出现", c1.tip === true);
/* 连续两帧：先到 35，再一步跨过 */
setupContact();
const c2 = R(`(function(){
  function scr(P){ var v=P.clone().project(activeCam); return {x:(v.x*0.5+0.5)*900, y:(-v.y*0.5+0.5)*600}; }
  function mv(P){ var s=scr(P);
    var e={type:'pointermove',clientX:s.x,clientY:s.y,pointerId:1,isPrimary:true,
           buttons:1,button:0,pointerType:'mouse',
           preventDefault:function(){},stopPropagation:function(){}};
    ((window._listeners&&window._listeners.pointermove)||[]).forEach(function(f){f.call(window,e);});
    return +parts[1].x.toFixed(3);
  }
  var o0=new THREE.Vector3(60,0,0);
  pendingPart={pi:1,p0:o0.clone(),o0:o0.clone(),nrm:new THREE.Vector3(0,0,-1),
               sx:scr(o0).x,sy:scr(o0).y};
  return {x1:mv(new THREE.Vector3(35,0,0)), x2:mv(new THREE.Vector3(4,0,0)),
          snapped:!!(partDrag&&partDrag.snap&&partDrag.snap.tgt)};
})()`);
check("第二帧才跨过接触面时也稳定触发", near(c2.x1, 35, 0.4) && near(c2.x2, 20, 0.4) && c2.snapped,
      JSON.stringify(c2));
setupContact();
const c3 = contactJump(4, 0, "touch");
check("触摸 buttons=0 不误收尾，且吸附照样触发",
      c3.alive && c3.snapped && near(c3.x, 20, 0.4), JSON.stringify(c3));
setupContact();
const c4 = contactJump(22);
check("慢速靠近（2mm）仍按原行为吸合", near(c4.x, 20, 0.4) && c4.snapped, JSON.stringify(c4));
/* 吸住后继续远离，不能永久粘死 */
const c5 = R(`(function(){
  function scr(P){ var v=P.clone().project(activeCam); return {x:(v.x*0.5+0.5)*900, y:(-v.y*0.5+0.5)*600}; }
  function mv(P){ var s=scr(P);
    var e={type:'pointermove',clientX:s.x,clientY:s.y,pointerId:1,isPrimary:true,
           buttons:1,button:0,pointerType:'mouse',
           preventDefault:function(){},stopPropagation:function(){}};
    ((window._listeners&&window._listeners.pointermove)||[]).forEach(function(f){f.call(window,e);});
    return +parts[1].x.toFixed(3);
  }
  var a=mv(new THREE.Vector3(-5,0,0)), b=mv(new THREE.Vector3(-10,0,0));
  return {a:a,b:b,snapped:!!(partDrag&&partDrag.snap&&partDrag.snap.tgt)};
})()`);
check("钉住一帧后继续拖远能正常脱离并跟回手指",
      near(c5.b, -10, 0.4) && !c5.snapped, JSON.stringify(c5));

/* ============ 五、3D 扫掠单元 + 性能去重 ============ */
section("五、3D 扫掠 / 预编译 / 性能上限");
R(`applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0;
   addPart('cyl'); addPart('cyl');
   [0,1].forEach(function(i){ var p=parts[i]; p.type='horiz'; p.ang=0; p.r=10; p.h=20; p.y=0; p.z=0; });
   parts[0].x=0; parts[1].x=60;
   window.__SW = snapContactPrepare(new THREE.Vector3(60,0,0), new THREE.Vector3(0,0,1), 'part:1');`);
const meta = R(`(function(){ var B=window.__SW.partners[0];
  return {segs:B.segs.length, fast:B.segFast.length, solo:B.solo.length,
          pts:B.pts.length, box:!!B.box, c1:B.c1.length}; })()`);
check("接触折线预编译：72 段一一对应、孤立点为 0、包围盒已建",
      meta.segs === 72 && meta.fast === 72 && meta.solo === 0 && meta.box && meta.c1 >= 40,
      JSON.stringify(meta));
const sw = R(`(function(){
  var hit = snapContactSwept(new THREE.Vector3(60,0,0), new THREE.Vector3(4,0,0), window.__SW, null);
  var far = snapContactSwept(new THREE.Vector3(200,200,200), new THREE.Vector3(260,260,260), window.__SW, null);
  return {hit: hit ? {d:+hit.d.toFixed(3), x:+hit.p.x.toFixed(3), at:+hit.at.toFixed(2)} : null,
          far: far};
})()`);
check("扫掠线段 60→4 命中接触曲线（最近距离 <SNAP_ON）",
      sw.hit && sw.hit.d <= 2.8 && near(sw.hit.x, 20, 0.5), JSON.stringify(sw.hit));
check("完全无关的远段被 AABB 粗筛挡掉，返回 null", sw.far === null);
const alloc = R(`(function(){
  var n=0, orig=THREE.Vector3.prototype.clone;
  THREE.Vector3.prototype.clone=function(){ n++; return orig.apply(this,arguments); };
  snapContactNearest(new THREE.Vector3(25,0,0), window.__SW);
  snapContactSwept(new THREE.Vector3(60,0,0), new THREE.Vector3(4,0,0), window.__SW, null);
  THREE.Vector3.prototype.clone=orig;
  return n;
})()`);
check("最近点/扫掠判定零 Vector3.clone（旧版每帧上千次分配）", alloc === 0, "clones=" + alloc);
const perf = R(`(function(){
  window.__SW.tgt=null; window.__SW.prevRaw=new THREE.Vector3(60,0,0);
  var t0=Date.now(), i;
  for(i=0;i<300;i++) snapContactApply(new THREE.Vector3(60+(i%40)*0.7,(i%7)-3,0), window.__SW);
  return Date.now()-t0;
})()`);
check("300 次拖动吸附判定 < 120ms（真机 WebView 留余量）", perf < 120, "ms=" + perf);
const rim = R(`(function(){
  applyShape('cone'); var a=rimPoints(), b=rimPoints(), same=(a===b), n=a.length;
  applyShape('cyl');  var c=rimPoints();
  return {same:same, n:n, changed:(c!==a), shape:shape};
})()`);
check("rimPoints 缓存命中且切换立体后失效", rim.same && rim.n > 100 && rim.changed, JSON.stringify(rim));

/* 位置不变时不重建分块 */
const noRebuild = R(`(function(){
  applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; mode='pick';
  addPart('cyl'); addPart('cyl');
  [0,1].forEach(function(i){ var p=parts[i]; p.type='horiz'; p.ang=0; p.r=10; p.h=20; p.y=0; p.z=0; });
  parts[0].x=0; parts[1].x=60;
  buildParts(); if(mode==='pick'){ rebuildCells(); buildCellVis(); cellsDirty=false; }
  drag=null; partDrag=null; cylDrag=null; pendingPart=null; pendingCyl=null;
  (function(){ useOrthoCam(false); camera.position.set(0,0,220); camera.lookAt(0,0,0);
    camera.updateMatrixWorld(true); camera.updateProjectionMatrix(); controls.target.set(0,0,0); })();
  function scr(P){ var v=P.clone().project(activeCam); return {x:(v.x*0.5+0.5)*900, y:(-v.y*0.5+0.5)*600}; }
  var o0=new THREE.Vector3(60,0,0);
  pendingPart={pi:1,p0:o0.clone(),o0:o0.clone(),nrm:new THREE.Vector3(0,0,-1),
               sx:scr(o0).x,sy:scr(o0).y};
  var s=scr(new THREE.Vector3(22,0,0));
  var e={type:'pointermove',clientX:s.x,clientY:s.y,pointerId:1,isPrimary:true,
         buttons:1,button:0,pointerType:'mouse',
         preventDefault:function(){},stopPropagation:function(){}};
  ((window._listeners&&window._listeners.pointermove)||[]).forEach(function(f){f.call(window,e);});
  var np=0, nr=0, ob=buildParts, or=rebuildCells;
  buildParts=function(){ np++; return ob.apply(null,arguments); };
  rebuildCells=function(){ nr++; return or.apply(null,arguments); };
  for(var i=0;i<5;i++) ((window._listeners&&window._listeners.pointermove)||[]).forEach(function(f){f.call(window,e);});
  buildParts=ob; rebuildCells=or;
  return {np:np, nr:nr, x:+parts[1].x.toFixed(2)};
})()`);
check("吸附钉住后重复 pointermove 不再重复重建（旧版每次全量重建）",
      noRebuild.np === 0 && noRebuild.nr === 0 && near(noRebuild.x, 20, 0.5),
      JSON.stringify(noRebuild));

R("if(typeof endDrag==='function') endDrag(); drag=null; partDrag=null; cylDrag=null;");
console.log("\n=========================================");
console.log("结果: " + pass + " 通过, " + fail + " 失败");
if(fail) process.exit(1);
console.log("ALL OK");
