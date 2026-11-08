/* v33.32 回归套件：自动吸附扩展
   ① 面与"每个模型"轮廓恰好相交（支撑平面）+ 过轮廓特征点；
   ② 拖部件/相贯体时与其它模型刚好接触；
   ③ 顺带修掉旧脱离曲线在 SNAP_OFF 处跳 2.8mm 的问题。

   跑法：node test2/snapmodel.js
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
const R = (code) => app.run(code);
const near = (a, b, tol) => Math.abs(a-b) <= (tol == null ? 0.5 : tol);
function targets(nvExpr){
  return R("(function(){ drag = {i:0, nv:" + nvExpr + ", p0:new THREE.Vector3(), d0:0," +
           " targets:[], tgt:null, lines:[]}; return buildTargets(0).map(function(t){" +
           " return {k:t.kind, d:t.d, l:t.label}; }); })()");
}
function kinds(ts, k){ return ts.filter(function(t){ return t.k === k; }); }

/* ============ 一、源码级 ============ */
section("一、源码：三类新吸附都接进去了");
check("存在统一模型清单 snapModelList（实验室跳过占位主立体）",
      /function snapModelList\(\)/.test(HTML) &&
      /function snapModelList\(\)[\s\S]{0,500}?if\(!S\.lab\)\{[\s\S]{0,220}?kind:"main"/.test(HTML));
check("部件/相贯体各有表面点云生成函数",
      /function partSurfaceCloud\(pr\)/.test(HTML) && /function cylSurfaceCloud\(c\)/.test(HTML));
check("存在接触目标预计算 snapContactPrepare 与拖动中应用 snapContactApply",
      /function snapContactPrepare\(anchor, planeNrm, skipKey\)/.test(HTML) &&
      /function snapContactApply\(raw, ctx\)/.test(HTML));
check("buildTargets 用 snapModelList 生成 modelEdge / modelPoint 两类目标",
      /var models = snapModelList\(\);/.test(HTML) &&
      /kind:"modelEdge"/.test(HTML) && /kind:"modelPoint"/.test(HTML));
check("实验室不再按 H=1,R=1 占位体生成假的'过锥尖/相切'目标",
      /if\(!S\.lab\)\{[\s\S]{0,1400}?kind:"tangent"/.test(HTML));
check("拖面片改用 snapEase（SNAP_OFF 处无跳变）",
      /dCur = tgt\.d \+ sgn\*snapEase\(aa\);/.test(HTML) &&
      /function snapEase\(aa\)/.test(HTML));
check("partDrag 分支调用 snapContactApply 且激活时预计算 snapContactPrepare",
      /partDrag\.snap = snapContactPrepare\(/.test(HTML) &&
      /snapContactApply\(rawP, partDrag\.snap\)/.test(HTML));
check("cylDrag 分支同样接入接触吸附",
      /cylDrag\.snap = snapContactPrepare\(/.test(HTML) &&
      /snapContactApply\(rawC, cylDrag\.snap\)/.test(HTML));
check("松手时清掉'刚好接触'提示条",
      (HTML.match(/hideSnapTip\(\);\s*\/\/ v33\.32/g) || []).length === 2);
check("面片吸附到非截线目标时清掉旧的绿色高亮",
      /else setCurveHi\(drag\.lines, null, false\);/.test(HTML));
check("帮助文案说明两类新吸附",
      /面与任一模型/.test(HTML) && /刚好接触/.test(HTML));

/* ============ 二、实验室：面与部件轮廓 ============ */
section("二、实验室：面与模型轮廓恰好相交 / 过轮廓特征点");
R("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0;");
R("addPart('cyl'); (function(){ var p=parts[0]; p.type='frontal'; p.ang=0; p.r=16; p.h=44; p.x=0; p.y=0; p.z=0; })();");
R("faces.push({type:'lat', ang:0, x:0, y:0, z:0, on:true, flip:false});");
const modelsLab = R("snapModelList().map(function(m){ return {k:m.kind, label:m.label, n:m.pts.length}; })");
check("实验室模型清单只含部件，不含占位主立体", modelsLab.length === 1 && modelsLab[0].k === "part", JSON.stringify(modelsLab));
check("部件表面点云有足够采样点", modelsLab[0].n >= 100, "n=" + modelsLab[0].n);

const tLab = targets("new THREE.Vector3(1,0,0)");
const edges = kinds(tLab, "modelEdge"), feats = kinds(tLab, "modelPoint");
check("临界相切目标 = 圆柱沿 X 的支撑平面 ±16",
      edges.some(function(t){ return near(t.d, 16, 0.25); }) &&
      edges.some(function(t){ return near(t.d, -16, 0.25); }),
      edges.map(function(t){ return t.d.toFixed(2); }).join(","));
check("实验室不再有 apex / tangent / center 假目标",
      !tLab.some(function(t){ return ["apex","tangent","center","base","top"].indexOf(t.k) >= 0; }));
check("存在轮廓特征点目标，且落在支撑平面之间（不是把相切点换个名字）",
      feats.length >= 2 && feats.every(function(t){ return Math.abs(t.d) < 15.5; }) &&
      feats.some(function(t){ return Math.abs(t.d) > 3; }),
      feats.map(function(t){ return t.d.toFixed(2); }).join(","));
check("目标标签写明是哪个模型", edges.every(function(t){ return /部件1/.test(t.l); }));
check("目标按 d 去重（没有 <0.6mm 的重复）",
      tLab.every(function(a, i){ return tLab.every(function(b, j){ return i === j || Math.abs(a.d-b.d) >= 0.6; }); }));

/* 部件挪走后目标跟着走 */
R("parts[0].x = 30;");
const tMoved = targets("new THREE.Vector3(1,0,0)");
check("部件平移后轮廓目标跟着移动（30±16）",
      kinds(tMoved,"modelEdge").some(function(t){ return near(t.d,46,0.25); }) &&
      kinds(tMoved,"modelEdge").some(function(t){ return near(t.d,14,0.25); }));

/* 多个模型都参与 */
R("parts[0].x = 0; addPart('cube'); (function(){ var p=parts[1]; p.a=20; p.x=50; p.y=0; p.z=0; })();");
const tTwo = targets("new THREE.Vector3(1,0,0)");
check("第二个部件也给出自己的轮廓目标（±10 平移到 40/60）",
      kinds(tTwo,"modelEdge").some(function(t){ return near(t.d,40,0.25); }) &&
      kinds(tTwo,"modelEdge").some(function(t){ return near(t.d,60,0.25); }));
check("多模型时标签可区分", tTwo.some(function(t){ return /部件2/.test(t.l); }));

/* ============ 三、主立体 + 部件 + 相贯体 ============ */
section("三、主立体模式：三类模型都在清单里，打孔不算模型");
R("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0;");
R("addPart('cube'); (function(){ var p=parts[0]; p.a=20; p.x=50; p.y=0; p.z=0; p.type='horiz'; })();");
R("addCyl('frontal'); (function(){ var c=cyls[0]; c.shape='cyl'; c.hole=false; c.r=10; c.len=40; c.x=0; c.y=40; c.z=0; })();");
const mAll = R("snapModelList().map(function(m){ return {k:m.kind,label:m.label,n:m.pts.length,model:m.isModel}; })");
check("主立体 + 部件 + 相贯体共 3 个模型", mAll.length === 3 &&
      mAll.filter(function(m){ return m.k === "main"; }).length === 1, JSON.stringify(mAll.map(function(m){return m.k;})));
check("三个模型都算出了表面点云", mAll.every(function(m){ return m.n >= 100; }));
const tX = targets("new THREE.Vector3(1,0,0)");
check("部件的支撑平面 40/60 与圆锥的 ±30 仍同时存在",
      kinds(tX,"modelEdge").some(function(t){ return near(t.d,40,0.3); }) &&
      kinds(tX,"modelEdge").some(function(t){ return near(t.d,60,0.3); }) &&
      tX.some(function(t){ return near(t.d,30,0.6); }) &&
      tX.some(function(t){ return near(t.d,-30,0.6); }));
const tY = targets("new THREE.Vector3(0,1,0)");
check("相贯体（中心 y=40, r=10）给出 30/50 的轮廓相切目标",
      kinds(tY,"modelEdge").some(function(t){ return near(t.d,30,0.4); }) &&
      kinds(tY,"modelEdge").some(function(t){ return near(t.d,50,0.4); }),
      kinds(tY,"modelEdge").map(function(t){return t.d.toFixed(1);}).join(","));
R("addCyl('horiz'); (function(){ var c=cyls[1]; c.shape='cyl'; c.hole=true; c.r=8; c.len=0; c.x=0;c.y=0;c.z=0; })();");
const ctxHole = R("(function(){ var cx=snapContactPrepare(new THREE.Vector3(50,0,0), new THREE.Vector3(0,0,-1), 'part:0');" +
                  " return {partners:cx.partners.map(function(p){return p.label;}), n:cx.partners.length}; })()");
check("贯穿打孔不进接触伙伴（它是刀具不是模型）",
      ctxHole.n === 2 && !ctxHole.partners.some(function(l){ return /相贯体2/.test(l); }),
      JSON.stringify(ctxHole.partners));
const tHole = targets("new THREE.Vector3(1,0,0)");
check("贯穿打孔也不给面片提供轮廓吸附目标（无限长孔不算模型）",
      !tHole.some(function(t){ return /相贯体2/.test(t.l || ""); }) &&
      tHole.every(function(t){ return isFinite(t.d) && Math.abs(t.d) < 500; }));

/* ============ 四、模型间刚好接触 ============ */
section("四、拖部件：与其它模型刚好接触");
R("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0;");
R("addPart('cyl'); addPart('cyl'); (function(){ [0,1].forEach(function(i){ var p=parts[i]; p.type='horiz'; p.ang=0; p.r=10; p.h=20; p.y=0; p.z=0; }); parts[0].x=0; parts[1].x=60; })();");
const ctx = R("(function(){ window.__CTX = snapContactPrepare(new THREE.Vector3(60,0,0), new THREE.Vector3(0,0,1), 'part:1');" +
              " var B=window.__CTX.partners[0]; return {n:window.__CTX.partners.length, segs:B.segs.length," +
              " near20:Math.min.apply(null, B.pts.map(function(p){ return p.distanceTo(new THREE.Vector3(20,0,0)); }))}; })()");
check("接触上下文包含 1 个伙伴 + 72 段接触折线", ctx.n === 1 && ctx.segs === 72, JSON.stringify(ctx));
check("两圆柱（r=10）的接触面在 x=20（中心距=两半径之和）",
      near(ctx.near20, 0, 0.4), "minDist=" + ctx.near20.toFixed(3));
const s1 = R("(function(){ var r=snapContactApply(new THREE.Vector3(22,0,0), window.__CTX);" +
             " return {p:r.pos.x, s:r.snapped, l:r.label}; })()");
check("靠近接触位置（2mm）时吸合到 x=20", s1.s && near(s1.p, 20, 0.4), JSON.stringify(s1));
check("提示条写明与哪个模型接触", /部件1/.test(s1.l || ""), s1.l);
const s2 = R("(function(){ var r=snapContactApply(new THREE.Vector3(25,0,0), window.__CTX);" +
             " return {p:r.pos.x, s:r.snapped}; })()");
check("拖到 5mm 仍吸着但渐进脱离（不是硬粘死）", s2.s && s2.p > 20.2 && s2.p < 25,
      "x=" + s2.p.toFixed(2));
const s3 = R("(function(){ var r=snapContactApply(new THREE.Vector3(29,0,0), window.__CTX);" +
             " return {p:r.pos.x, s:r.snapped}; })()");
check("SNAP_OFF(9mm) 脱离阈值处位置连续，无 2.8mm 跳变",
      near(s3.p, 29, 0.02), "x=" + s3.p.toFixed(3) + " snapped=" + s3.s);
const s4 = R("(function(){ var r=snapContactApply(new THREE.Vector3(32,0,0), window.__CTX);" +
             " return {p:r.pos.x, s:r.snapped}; })()");
check("拖过 9mm 后完全脱离，位置=手指位置", !s4.s && near(s4.p, 32, 0.05));

/* 正方体接触（盒子角点必须精确） */
R("parts.length=0; addPart('cube'); addPart('cube'); (function(){ [0,1].forEach(function(i){ var p=parts[i]; p.a=20; p.type='horiz'; p.y=0;p.z=0; }); parts[0].x=0; parts[1].x=60; })();");
const ctxBox = R("(function(){ var cx=snapContactPrepare(new THREE.Vector3(60,0,0), new THREE.Vector3(0,0,1), 'part:1');" +
                 " var B=cx.partners[0]; return {n:B.pts.length, near:Math.min.apply(null, B.pts.map(function(p){ return p.distanceTo(new THREE.Vector3(20,0,0)); }))}; })()");
check("两正方体（棱长20）接触面在 x=20（面贴面无重叠）",
      near(ctxBox.near, 0, 0.4), "minDist=" + ctxBox.near.toFixed(3));

/* 主立体作为接触伙伴 */
R("applyShape('cone'); parts.length=0; cyls.length=0; addPart('sphere'); (function(){ var p=parts[0]; p.r=10; p.x=90; p.y=0; p.z=0; })();");
const ctxMain = R("(function(){ var cx=snapContactPrepare(new THREE.Vector3(90,0,0), new THREE.Vector3(0,0,1), 'part:0');" +
                  " return cx.partners.map(function(p){ return p.label; }); })()");
check("主立体（圆锥）也是接触伙伴", ctxMain.length === 1 && /圆锥/.test(ctxMain[0]), JSON.stringify(ctxMain));

/* 没有其它模型时不吸附、不报错 */
R("applyShape('lab'); parts.length=0; cyls.length=0; addPart('cyl'); (function(){ parts[0].x=0; parts[0].r=10; parts[0].h=20; parts[0].type='horiz'; })();");
const noPartner = R("(function(){ var cx=snapContactPrepare(new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,1), 'part:0');" +
                    " var r=snapContactApply(new THREE.Vector3(7,3,0), cx);" +
                    " return {n:cx.partners.length, x:r.pos.x, y:r.pos.y, s:r.snapped}; })()");
check("无其它模型时原样跟手，不吸附也不抛异常",
      noPartner.n === 0 && !noPartner.s && near(noPartner.x,7) && near(noPartner.y,3), JSON.stringify(noPartner));

/* ============ 五、脱离曲线 ============ */
section("五、脱离曲线连续性（面片与模型共用）");
const ez = R("[0, 2.8, 5, 9, 12].map(function(a){ return snapEase(a); })");
check("snapEase(0)=0 且 snapEase(SNAP_ON)=0（完全吸合）", ez[0] === 0 && ez[1] === 0, JSON.stringify(ez));
check("snapEase(SNAP_OFF)=SNAP_OFF（脱离瞬间无跳变）", near(ez[3], 9, 1e-9));
check("中间段单调递增且不超过 aa（不越过手指）",
      ez[2] > 0 && ez[2] < 5 && ez[4] === 12, "at5=" + ez[2].toFixed(3));
const faceAtOff = R("(function(){ var tgt={d:10}, aa=9; return tgt.d + snapEase(aa); })()");
check("拖面片在 SNAP_OFF 处 dCur == dRaw(19)", near(faceAtOff, 19, 1e-9), "" + faceAtOff);

/* ============ 六、真实事件流：拖部件触发吸附 ============ */
section("六、真实 pointermove 事件流：拖部件到接触位置");
R("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; mode='all';");
/* 前面 targets() 直接给 drag 赋过值，真实事件流前必须清干净，否则手势仲裁会跳过部件拖动 */
R("drag=null; partDrag=null; cylDrag=null; pendingCyl=null; pendingPart=null;");
R("addPart('cyl'); addPart('cyl'); (function(){ [0,1].forEach(function(i){ var p=parts[i]; p.type='horiz'; p.r=10; p.h=20; p.y=0; p.z=0; }); parts[0].x=0; parts[1].x=60; })();");
R("(function(){ useOrthoCam(false); camera.position.set(0,0,220); camera.lookAt(0,0,0); camera.updateMatrixWorld(true); camera.updateProjectionMatrix(); controls.target.set(0,0,0); })();");
const ev = R(`(function(){
  function scr(P){ var v=P.clone().project(activeCam);
    return {x:(v.x*0.5+0.5)*900, y:(-v.y*0.5+0.5)*600}; }
  var o0=new THREE.Vector3(60,0,0), target=new THREE.Vector3(22,0,0);
  var s0=scr(o0), s1=scr(target);
  pendingPart = {pi:1, p0:o0.clone(), o0:o0.clone(), nrm:new THREE.Vector3(0,0,-1), sx:s0.x, sy:s0.y};
  var ls=(window._listeners && window._listeners.pointermove)||[];
  var e={type:'pointermove', clientX:s1.x, clientY:s1.y, pointerId:1, isPrimary:true,
         buttons:1, button:0, preventDefault:function(){}, stopPropagation:function(){}};
  ls.forEach(function(f){ f.call(window, e); });
  return {moved:Math.hypot(s1.x-s0.x,s1.y-s0.y), x:parts[1].x,
          snapped:!!(partDrag && partDrag.snap && partDrag.snap.tgt)};
})()`);
check("事件流确实进入部件拖动（超过 10px 阈值）", ev.moved > 10, "px=" + ev.moved.toFixed(1));
check("真实事件流里部件被吸到接触位置 x≈20", near(ev.x, 20, 0.5), "x=" + ev.x);
check("拖动上下文记录了吸附目标", ev.snapped === true);

/* 同一套接触吸附也要能作用在相贯体上 */
R("if(typeof endDrag==='function') endDrag(); drag=null; partDrag=null; cylDrag=null; pendingCyl=null; pendingPart=null;");
R("parts.length=0; cyls.length=0; faces.length=0; addPart('cyl'); cutShape='cyl'; cutHole=false; addCyl('frontal');");
R("(function(){ var p=parts[0]; p.type='horiz'; p.r=10; p.h=20; p.x=0;p.y=0;p.z=0;" +
  " var c=cyls[0]; c.shape='cyl'; c.hole=false; c.r=10; c.len=20; c.x=60;c.y=0;c.z=0; })();");
const evC = R(`(function(){
  function scr(P){ var v=P.clone().project(activeCam);
    return {x:(v.x*0.5+0.5)*900, y:(-v.y*0.5+0.5)*600}; }
  var o0=new THREE.Vector3(60,0,0), target=new THREE.Vector3(22,0,0);
  var s0=scr(o0), s1=scr(target);
  pendingCyl = {ci:0, p0:o0.clone(), x0:60, y0:0, z0:0,
                nrm:new THREE.Vector3(0,0,1), sx:s0.x, sy:s0.y};
  var ls=(window._listeners && window._listeners.pointermove)||[];
  var e={type:'pointermove', clientX:s1.x, clientY:s1.y, pointerId:1, isPrimary:true,
         buttons:1, button:0, preventDefault:function(){}, stopPropagation:function(){}};
  ls.forEach(function(f){ f.call(window, e); });
  return {x:cyls[0].x, snapped:!!(cylDrag && cylDrag.snap && cylDrag.snap.tgt)};
})()`);
check("拖相贯体同样吸到与部件的接触位置 x≈20", near(evC.x, 20, 0.5), "x=" + evC.x);
check("相贯体拖动上下文记录了接触目标", evC.snapped === true);
R("if(typeof endDrag==='function') endDrag();");

/* 拖动起始的一次性计算不能明显卡手（真机 WebView 上要留余量） */
const perf = R(`(function(){
  parts.length=0; cyls.length=0; applyShape('cone');
  addPart('cyl'); addPart('cube'); addPart('sphere');
  cutShape='cyl'; cutHole=false; addCyl('frontal'); addCyl('horiz');
  var t0=Date.now(), cx=snapContactPrepare(new THREE.Vector3(80,0,0), new THREE.Vector3(0,0,1), 'part:0');
  var t1=Date.now();
  var t2=Date.now(); drag={i:0,nv:new THREE.Vector3(1,0,0),targets:[],tgt:null,lines:[]}; buildTargets(0);
  var t3=Date.now();
  return {contact:t1-t0, targets:t3-t2, partners:cx.partners.length};
})()`);
check("接触目标预计算 < 250ms（拖动只算一次）", perf.contact < 250, JSON.stringify(perf));
check("面片轮廓目标计算 < 250ms", perf.targets < 250, JSON.stringify(perf));

console.log("\n=========================================");
console.log("结果: " + pass + " 通过, " + fail + " 失败");
if(fail) process.exit(1);
console.log("ALL OK");
