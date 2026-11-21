/* v33.61 / v33.62 回归套件：自建模型
   ① 保存剩余实体（暂时 / 永久）
   ② 库在**所有功能卡之间通用**（不再按卡归属），入口在「相贯体 → 自建模型」最下面一行
   ③ 点名字放进当前场景、可拖动、放完若跑出画面会自动把视角拉远
   ④ 可以自行命名 / 改名
   运行: node tests/custommodel.js */
"use strict";
const path = require("path"), fs = require("fs"), vm = require("vm");
const { boot } = require("./boot");
const app = boot();
const R = function (code) { return app.run(code); };

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name + (detail ? "   [" + detail + "]" : "")); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   [" + detail + "]" : "")); }
}
function section(t) { console.log("\n=== " + t + " ==="); }
const STATE = '(function(){return JSON.stringify({lib:window.ConeLabCustom.list(),placed:window.ConeLabCustom.placed(),state:window.ConeLabCustom.state()});})()';
const st = () => JSON.parse(R(STATE));
const chips = () => JSON.parse(R("JSON.stringify(window.ConeLabCustom.chips())"));
const libNames = (s) => (s || st()).lib.map(function (r) { return r.name; });

/* 内存版 localStorage：验证"永久"真的落盘、"暂时"不落盘 */
const store = {};
app.__window.localStorage.getItem = function (k) { return Object.prototype.hasOwnProperty.call(store, k) ? store[k] : null; };
app.__window.localStorage.setItem = function (k, v) { store[k] = String(v); };
app.__window.localStorage.removeItem = function (k) { delete store[k]; };
const KEY = "coneLab.customModels.v1";

section("A 几何烘焙");
check("公开接口可用", R("typeof window.ConeLabCustom === 'object'"));
let baked = JSON.parse(R("JSON.stringify(window.ConeLabCustom.bake())"));
check("全部显示：能烘出三角面", baked && baked.t > 0, baked && baked.t);
check("数组长度与三角面数一致", baked.p.length === baked.t * 9 && baked.n.length === baked.t * 9,
  baked.p.length + "/" + baked.n.length);
check("保存前几何已中心化", Math.abs(baked.c[1]) < 1e-6 && baked.c[0] < 1, JSON.stringify(baked.c));

/* 点选保留：建一个水平面，隐藏一块，剩余实体应该变少 */
R("applyShape('cone'); var d=TYPES['horiz'].defaults; faces=[{type:'horiz',ang:d.ang,x:d.x,y:d.y,z:d.z,on:true,flip:false}]; mode='pick'; refresh();");
const nCells = R("cells.length");
check("水平面把圆锥分成两块", nCells >= 2, nCells);
const full = JSON.parse(R("JSON.stringify(window.ConeLabCustom.bake())"));
R("cells[1].sel=false; buildCellVis();");
const partial = JSON.parse(R("JSON.stringify(window.ConeLabCustom.bake())"));
check("隐藏的部分不进保存", partial.t > 0 && partial.t < full.t, partial.t + " < " + full.t);

section("B 暂时保存 / 永久保存");
check("库空时卡片行没有模型、显示提示文字",
  chips().filter(function (c) { return c.id; }).length === 0 &&
  R("document.getElementById('cmRowNote').hidden") === false);
const beforeTemp = store[KEY] || "";
const temp = JSON.parse(R("JSON.stringify(window.ConeLabCustom.save(window.ConeLabCustom.bake(),'temp','测试临时','cone'))"));
check("暂时保存写进内存库", temp && temp.scope === "temp" && st().lib.length === 1);
check("暂时保存不写 localStorage", (store[KEY] || "") === beforeTemp, String(store[KEY]));
const perm = JSON.parse(R("JSON.stringify(window.ConeLabCustom.save(window.ConeLabCustom.bake(),'perm','测试永久','cone'))"));
check("永久保存写进 localStorage", !!store[KEY] && /测试永久/.test(store[KEY]));
check("库里两条都在", st().lib.length === 2, st().lib.map(function (x) { return x.scope; }).join(","));
/* 模拟重新进入 App：内存库清空后再 load */
R("customModels=[]; cmLoad()");
const reloaded = st().lib;
check("重载后永久模型还在", reloaded.length === 1 && reloaded[0].name === "测试永久", JSON.stringify(reloaded));
check("重载后临时模型不在", !reloaded.some(function (r) { return r.name === "测试临时"; }));

section("B2 入口：相贯体面板最下面的一行「自建模型」卡片");
check("面板底部有 #cmChipRow", R("!!document.getElementById('cmChipRow')"));
check("入口不再挂在首页每张卡下面", R("document.querySelectorAll('.cm-card').length") === 0,
  R("document.querySelectorAll('.cm-card').length"));
const c1 = chips();
check("卡片行按用户命名列出模型",
  c1.filter(function (c) { return c.id; }).length === 1 && c1[0].name === "测试永久",
  JSON.stringify(c1.map(function (c) { return c.name; })));
check("卡片行末尾是「管理 / 改名」入口", c1[c1.length - 1].act === "manage", c1[c1.length - 1].act);
check("计数与库一致", R("document.getElementById('cmCount').textContent") === "(1)",
  R("document.getElementById('cmCount').textContent"));

section("C 点卡片行放置 + 自由拖动");
R("window.ConeLabCustom.clearPlaced(); window.ConeLabCustom.setOwner('cone')");
R("window.ConeLabCustom.place('" + perm.id + "')");
let s = st();
check("放置进入 3D 场景", s.placed.length === 1 && s.state.placed === 1);
/* 主立体（圆锥 R=30）右侧、留 8mm 间隙，不再像 v33.61 那样固定死 55 */
const half = JSON.parse(R("JSON.stringify(cmHalfSize(placedCustom[0].mesh.geometry))"));
check("放在主立体右侧且留间隙、不压在主立体上",
  s.placed[0].x > 30 && (s.placed[0].x - half.hx) >= 30 - 0.01,
  "x=" + s.placed[0].x + " 半宽=" + half.hx.toFixed(2));
const chipPerm = chips().filter(function (c) { return c.name === "测试永久"; })[0];
check("放好后对应卡片高亮（on）", !!(chipPerm && chipPerm.on), JSON.stringify(chipPerm));
/* 用户报的「放了看不见」：放完必须真的在画面里（必要时自适应会把视角拉远） */
R("if(viewAnimFinish) viewAnimFinish(); camera.updateMatrixWorld(true);");
check("放置后模型完整落在画面里",
  R("cmBoxVisible(new THREE.Box3().setFromObject(placedCustom[0].mesh),0.96)") === true);
check("进入吸附模型清单", R("snapModelList().some(function(m){return m.kind==='custom';})"));
/* 用真实 pointer 事件拖它：屏幕坐标取模型中心投影 */
const screen = JSON.parse(R(`(function(){
  var v=placedCustom[0].mesh.position.clone().project(activeCam);
  var r=renderer.domElement.getBoundingClientRect();
  return JSON.stringify([r.left+(v.x*0.5+0.5)*r.width, r.top+(-v.y*0.5+0.5)*r.height]);
})()`));
function ev(type, x, y) {
  return { type: type, clientX: x, clientY: y, isPrimary: true, pointerType: "mouse", buttons: 1,
    preventDefault: function () { }, target: app.__doc.getElementById("gl") };
}
const canvas = R("renderer.domElement");     // boot 的 renderer 画布与 DOM stub 里那张不是同一个对象
check("画布已挂拖动事件", (canvas._listeners.pointerdown || []).length > 0);
(canvas._listeners.pointerdown || []).forEach(function (f) { f.call(canvas, ev("pointerdown", screen[0], screen[1])); });
check("按下自建模型时进入候选", R("!!pendingCustom"));
(app.__window._listeners.pointermove || []).forEach(function (f) {
  f.call(app.__window, ev("pointermove", screen[0] + 70, screen[1] + 40));
});
check("超过阈值后进入拖动态", R("!!customDrag"));
(app.__window._listeners.pointerup || []).forEach(function (f) {
  f.call(app.__window, ev("pointerup", screen[0] + 70, screen[1] + 40));
});
check("松手后拖动结束", R("!customDrag && !pendingCustom"));
const moved = st().placed[0];
check("模型确实被移动了", Math.hypot(moved.x - s.placed[0].x, moved.y, moved.z) > 1, JSON.stringify(moved));

section("C3 特征可见性：法向重算 + 切面棱线（v33.63）");
const dirs = R(`(function(){
  var a=placedCustom[0].mesh.geometry.attributes.normal.array, s={};
  for(var i=0;i<a.length;i+=3) s[a[i].toFixed(2)+","+a[i+1].toFixed(2)+","+a[i+2].toFixed(2)]=1;
  return Object.keys(s).length;
})()`);
check("法向按曲面重算，不再是一律 (0,1,0)", dirs > 30, dirs + " 种方向");
const eg = JSON.parse(R(`(function(){
  var m=placedCustom[0].mesh, ch=m.children||[];
  for(var i=0;i<ch.length;i++){
    if(ch[i].isLineSegments) return JSON.stringify({n:ch[i].geometry.attributes.position.count,
      p:Array.prototype.slice.call(ch[i].geometry.attributes.position.array)});
  }
  return "null";
})()`));
check("模型带棱线层", !!eg && eg.n > 40, eg && eg.n);
/* 这块模型是"水平面 y=-15 切一刀、隐藏另一半"得到的截头圆锥：
   切面那一圈棱的端点必须都落在这个切面上（local 坐标 = -15 - 中心 y） */
const cutY = -15 - perm.geo.c[1];
let onCut = 0;
if (eg) for (let i = 1; i < eg.p.length; i += 3) if (Math.abs(eg.p[i] - cutY) < 0.06) onCut++;
check("切面（椭圆口）那一圈棱画出来了", onCut >= 20, onCut + " 个端点 y≈" + cutY.toFixed(2));
/* 明暗能不能分开：切面法向接近 ±Y，侧面法向接近水平（径向） */
const sep = JSON.parse(R(`(function(){
  var a=placedCustom[0].mesh.geometry.attributes.normal.array;
  var cap=0, side=0;
  for(var i=0;i<a.length;i+=9){
    var ny=(a[i+1]+a[i+4]+a[i+7])/3;
    if(Math.abs(ny)>0.9) cap++; else if(Math.abs(ny)<0.5) side++;
  }
  return JSON.stringify({cap:cap, side:side, all:a.length/9});
})()`));
check("切面 / 侧面法向分开（两块明暗不同）",
  sep.cap > 5 && sep.side > 5 && sep.cap + sep.side > sep.all * 0.6, JSON.stringify(sep));
/* v33.61/62 存的老记录法向全是 0：放置时必须重算，不能让老模型继续是"一块平板" */
R("customModels[0].geo.n = customModels[0].geo.n.map(function(){return 0;});");
R("window.ConeLabCustom.clearPlaced(); cmPlace('" + perm.id + "',[0,0,0])");
const dirsOld = R(`(function(){
  var a=placedCustom[0].mesh.geometry.attributes.normal.array, s={};
  for(var i=0;i<a.length;i+=3) s[a[i].toFixed(2)+","+a[i+1].toFixed(2)+","+a[i+2].toFixed(2)]=1;
  return Object.keys(s).length;
})()`);
check("老记录（法向被存成 0）放置时也会重算", dirsOld > 30, dirsOld + " 种方向");
const ms = R(`(function(){
  var t0=performance.now(); cmPlace('` + perm.id + `',[0,0,0]); return performance.now()-t0;
})()`);
check("放置（含法向重算 + 棱线）耗时 < 300ms", ms < 300, Math.round(ms) + "ms");

section("C2 放得太远时自动把视角拉远（v33.61「放了看不见」的根因）");
R("window.ConeLabCustom.clearPlaced()");
R("cmPlace('" + perm.id + "',[400,0,0])");
check("超出画面时触发视角自适应", R("viewAnimating === true"));
R("if(viewAnimFinish) viewAnimFinish(); camera.updateMatrixWorld(true);");
check("自适应后模型完整落在画面里",
  R("cmBoxVisible(new THREE.Box3().setFromObject(placedCustom[0].mesh),0.96)") === true);
R("window.ConeLabCustom.clearPlaced(); resetView();");

section("D 换功能卡：已放置的收回，库通用不丢");
R("applyShape('cyl')");
check("换功能卡时已放置模型收回", st().placed.length === 0);
check("换卡后库里模型还在", st().lib.length === 1);
const chipsCyl = chips();
check("换到「圆柱」卡后卡片行还是同一批模型（不按卡归属）",
  chipsCyl.filter(function (c) { return c.id; }).length === 1 && chipsCyl[0].name === "测试永久",
  JSON.stringify(chipsCyl.map(function (c) { return c.name; })));

section("G 自建模型参与「点选保留部分」（v33.64）");
/* 用户需求："这些自建模型与正常添加出来的模型拼装的 3d 模型一样，
   可以对其使用点选保留部分功能（不要和相贯体一样，之前是我说错了）" */
R("applyShape('cone'); resetView(); window.ConeLabCustom.clearPlaced();");
R("cmPlace('" + perm.id + "',[100,0,0])");
/* 只放模型、没有任何面/贯穿体/部件：也要分出一块，让整块可点 */
R("mode='pick'; refresh();");
let gCells = JSON.parse(R("JSON.stringify(cells.map(function(c){return {k:c.key,own:!!c.ownerPe,sel:c.sel};}))"));
check("只放自建模型也能分出一块（可点）", gCells.length === 1 && gCells[0].own, JSON.stringify(gCells));
check("分块 key 带自建模型位 m…:1", /\|m\d+:1$/.test(gCells[0].k), gCells[0].k);
check("点选模式下自建模型外壳被分块替代（外壳隐藏）", R("placedCustom[0].mesh.visible") === false);
check("主立体没被切开时仍然正常显示（不会跟分块重复）", R("coneF.visible") === true);
/* 分块用的是模型自己的几何（放在 x=100，半宽 30 → 70..130） */
const gbox = JSON.parse(R(`(function(){
  var m=null;
  cellGroup.children.forEach(function(c){ if(c.userData.front && !c.userData.cap && c.userData.ck) m=c; });
  if(!m) return "null";
  m.geometry.computeBoundingBox();
  var b=m.geometry.boundingBox;
  return JSON.stringify([+b.min.x.toFixed(1),+b.max.x.toFixed(1)]);
})()`));
check("分块几何就是自建模型本身（世界坐标一致）",
  gbox && Math.abs(gbox[0] - 70) < 1.5 && Math.abs(gbox[1] - 130) < 1.5, JSON.stringify(gbox));
/* 加一个水平面（过模型中部）→ 自建模型被切成上下两块，和主立体一视同仁 */
R("faces=[{type:'horiz',ang:0,x:0,y:0,z:0,on:true,flip:false}]; refresh();");
gCells = JSON.parse(R("JSON.stringify(cells.map(function(c){return {k:c.key,own:!!c.ownerPe,pl:c.planes.length};}))"));
const gOwn = gCells.filter(function (c) { return c.own; });
check("启用的面同样把自建模型切开（内外各一块）", gOwn.length === 2,
  JSON.stringify(gCells.map(function (c) { return c.k; })));
check("每块都带自己的裁剪平面", gOwn.every(function (c) { return c.pl >= 1; }));
/* 切面必须封盖（不然隐藏一块就看穿到内部 = "不是实体"） */
const gcap = JSON.parse(R(`(function(){
  var area=0, n=0;
  cellGroup.children.forEach(function(c){
    if(!c.userData.cap) return;
    var cel = cellOfKey(c.userData.ck);
    if(!cel || !cel.ownerPe) return;
    var pos=c.geometry.attributes.position, i;
    for(i=0;i<pos.count;i+=3){
      var p0=new THREE.Vector3().fromBufferAttribute(pos,i), p1=new THREE.Vector3().fromBufferAttribute(pos,i+1),
          p2=new THREE.Vector3().fromBufferAttribute(pos,i+2);
      area += p1.clone().sub(p0).cross(p2.clone().sub(p0)).length()*0.5;
    }
    n++;
  });
  return JSON.stringify({n:n, area:Math.round(area*10)/10});
})()`));
check("自建模型块的切面有封盖（实体感）", gcap.n >= 1 && gcap.area > 50, JSON.stringify(gcap));
/* 轻点模型上半部分 → 只隐藏那一块 */
R("if(cellsDirty){rebuildCells();buildCellVis();cellsDirty=false;}");
const gscreen = JSON.parse(R(`(function(){
  var pe=placedCustom[0]; pe.mesh.geometry.computeBoundingBox();
  var hy=(pe.mesh.geometry.boundingBox.max.y - pe.mesh.geometry.boundingBox.min.y)/2;
  var v=new THREE.Vector3(pe.x, pe.y+hy*0.55, pe.z).project(activeCam);
  var r=renderer.domElement.getBoundingClientRect();
  return JSON.stringify([r.left+(v.x*0.5+0.5)*r.width, r.top+(-v.y*0.5+0.5)*r.height]);
})()`));
function tapAt(x, y) {
  (canvas._listeners.pointerdown || []).forEach(function (f) { f.call(canvas, ev("pointerdown", x, y)); });
  (app.__window._listeners.pointerup || []).forEach(function (f) { f.call(app.__window, ev("pointerup", x, y)); });
}
tapAt(gscreen[0], gscreen[1]);
const gAfter = JSON.parse(R("JSON.stringify(cells.filter(function(c){return c.ownerPe;}).map(function(c){return {k:c.key,sel:c.sel};}))"));
check("点自建模型的某一块 → 就隐藏那一块", gAfter.some(function (c) { return c.sel === false; }),
  JSON.stringify(gAfter));
check("隐藏状态记进 pickSel（切模式再回来还在）",
  Object.keys(JSON.parse(R("JSON.stringify(pickSel)"))).some(function (k) { return /\|m\d+:\d$/.test(k); }));
const gGhost = R(`(function(){
  var n=0;
  cellGroup.children.forEach(function(m){
    if(!m.userData.ck || m.userData.cap) return;
    var cel=cellOfKey(m.userData.ck);
    if(cel && cel.ownerPe && cel.sel===false) n++;
  });
  return n;
})()`);
check("被隐藏的那块画成幽灵层（可再点回来）", gGhost >= 2, gGhost);
/* 原地再点一次 → 恢复 */
tapAt(gscreen[0], gscreen[1]);
check("再点一次能恢复显示",
  R("cells.filter(function(c){return c.ownerPe;}).every(function(c){return c.sel!==false;})") === true);
/* 反向：点主立体时不能把拾取让给自建模型（两者在同一屏上互不抢占） */
R("camera.position.set(0,60,260); controls.target.set(30,0,0); camera.lookAt(30,0,0); camera.updateMatrixWorld(true);");
function screenPt(expr) {
  return JSON.parse(R(`(function(){
    var v=${expr}.project(activeCam), r=renderer.domElement.getBoundingClientRect();
    return JSON.stringify([r.left+(v.x*0.5+0.5)*r.width, r.top+(-v.y*0.5+0.5)*r.height]);
  })()`));
}
const gCone = screenPt("new THREE.Vector3(0,10,0)");
const gModel = screenPt("new THREE.Vector3(" + 100 + ",6,0)");
tapAt(gCone[0], gCone[1]);
check("点主立体只隐藏主立体那一块（自建模型不抢拾取）",
  R("cells.filter(function(c){return !c.ownerPe && c.sel===false;}).length >= 1 && " +
    "cells.filter(function(c){return c.ownerPe && c.sel===false;}).length === 0") === true);
tapAt(gModel[0], gModel[1]);
check("点自建模型只隐藏它自己那一块（主立体不动）",
  R("cells.filter(function(c){return c.ownerPe && c.sel===false;}).length >= 1 && " +
    "cells.filter(function(c){return !c.ownerPe && c.sel===false;}).length === 1") === true);
check("两块可以同时各隐藏各的（互不干扰）",
  R("cells.filter(function(c){return c.sel===false;}).length >= 2") === true);

/* 切回"显示全部"：外壳必须回来 */
R("mode='all'; refresh();");
check("回到其他模式后自建模型外壳显示回来", R("placedCustom[0].mesh.visible") === true);

section("H 只收回某一个放置出来的自建模型");
R("window.ConeLabCustom.clearPlaced();");
R("cmPlace('" + perm.id + "',[100,0,0]); cmPlace('" + perm.id + "',[0,60,0])");
let hPlaced = st().placed;
check("放了两个实例", hPlaced.length === 2, JSON.stringify(hPlaced.map(function (p) { return p.bodyId; })));
check("卡片行按实例列出「收回这一个」",
  chips().filter(function (c) { return c.act === "drop"; }).length === 2,
  chips().filter(function (c) { return c.act === "drop"; }).length);
check("实例号跟着下标走（№1 / №2）",
  R(`(function(){
    var row=document.getElementById('cmChipRow'), out=[];
    for(var i=0;i<row.children.length;i++){
      if(row.children[i].getAttribute('data-cm-act')==='drop'){
        out.push(row.children[i].textContent + '@' + row.children[i].getAttribute('data-cm-placed'));
      }
    }
    return out.join('|');
  })()`).indexOf("№1") >= 0);
const keepBody = hPlaced[1].bodyId;
R(`(function(){
  var row=document.getElementById('cmChipRow'), t=null;
  for(var i=0;i<row.children.length;i++){
    var b=row.children[i];
    if(b.getAttribute('data-cm-act')==='drop' && b.getAttribute('data-cm-placed')==='0'){ t=b; break; }
  }
  t.dispatch('click');
})()`);
hPlaced = st().placed;
check("点「№1 ✕」只收回第一个", hPlaced.length === 1 && hPlaced[0].bodyId === keepBody,
  JSON.stringify(hPlaced.map(function (p) { return p.bodyId; })));
check("另一个模型仍在场", R("placedCustom.length === 1 && placedCustom[0].mesh.parent === customGroup") === true);
check("收回后卡片行只剩一个「收回这一个」",
  chips().filter(function (c) { return c.act === "drop"; }).length === 1);
check("不写库：库里的模型还在", st().lib.length >= 1, st().lib.length);
/* 管理浮层里也能逐个收回（从卡片行末尾的「管理 / 改名」进） */
R(`(function(){
  var row=document.getElementById('cmChipRow'), t=null;
  for(var i=0;i<row.children.length;i++){
    if(row.children[i].getAttribute('data-cm-act')==='manage'){ t=row.children[i]; break; }
  }
  t.dispatch('click');
})()`);
const hOverlay = R(`(function(){
  var box=document.getElementById('cmList'), out=[];
  Array.prototype.forEach.call(box.querySelectorAll('button'), function(b){
    if(b.getAttribute('data-act')==='drop') out.push(b.getAttribute('data-placed'));
  });
  return out.join(',');
})()`);
check("管理页列出「收回这一个」按钮", hOverlay === "0", hOverlay);
R("cmCloseOverlay(); window.ConeLabCustom.clearPlaced();");
check("收回全部仍然可用", st().placed.length === 0);
/* 后面 E/F 段接着用「圆柱」卡（本段开头切到了圆锥） */
R("applyShape('cyl');");


section("I 重叠时各方都能被面割掉（v33.65）");
/* 用户需求："拼装模型中的模型与自建模型重叠并添加一个面去切割时，
   使用点选保留部分，无法让模型拼装的模型被面割掉。"
   根因：分块 key 的 m 位只进拾取判定，没进着色器 → 各块都画完整几何、互相盖住。
   修法：把网格烘成体素表进片元，m 位像 p 位一样真正裁剪体积。 */
R("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; addPart('box');");
R("parts[0].w=44;parts[0].h=42;parts[0].d=44;parts[0].x=0;parts[0].y=0;parts[0].z=0;buildParts();");
const iData = R("JSON.stringify(cmGeomData(cmBakeTriangles()))");
const iRec = JSON.parse(R("JSON.stringify(cmSaveGeometry(" + iData + ",'perm','重叠测试','cone'))"));
R("cmPlace('" + iRec.id + "',[0,0,0])");
R("faces=[{type:'horiz',ang:0,x:0,y:0,z:0,on:true,flip:false}]; mode='pick'; refresh();");
R("if(cellsDirty){rebuildCells();buildCellVis();cellsDirty=false;}");
/* 面 id 随前面测试递增，不能写死 f1 */
const iFace = R("activeFaceData()[0].id");
const iAbove = "f" + iFace + ":1|";
const iCells = JSON.parse(R("JSON.stringify(cells.map(function(c){return {k:c.key,own:!!c.ownerPart,cm:!!c.ownerPe};}))"));
check("重叠时同侧仍有部件内/外两套块",
  iCells.some(function (c) { return /p\d+:3\|m\d+:0/.test(c.k) }) &&
  iCells.some(function (c) { return /p\d+:3\|m\d+:1/.test(c.k) }),
  iCells.length + " 块");
/* 体素表：形状正确、位置正确 */
const iMask = JSON.parse(R(`(function(){var m=cmMaskOf(customModels[customModels.length-1]);
  return JSON.stringify({n:m.n,lo:m.lo,hi:m.hi,inside:cmInsideBody(placedCustom[0],new THREE.Vector3(0,0,0)),
    out:cmInsideBody(placedCustom[0],new THREE.Vector3(200,0,0))});})()`));
check("自建模型被烘成体素表（带包围盒）",
  iMask.n > 0 && iMask.hi[0] > iMask.lo[0] && iMask.inside === true && iMask.out === false,
  JSON.stringify(iMask));
/* 关键：既在部件内又在模型内的块，画的是部件几何 → 必须照样查体素表 */
const iKeep = R(`(function(){var keep=null;
  cellGroup.children.forEach(function(m){
    if(!m.userData.front) return;
    var k=m.userData.ck;
    if(k.indexOf('${iAbove}')===0 && /p\\d+:3\\|m\\d+:1/.test(k)){
      var u=m.material.userData.cylU;
      if(u) for(var s=0;s<6;s++) if(u.uCmPos.value[s].w>0.5 && u.uCmKeep.value[s].x<0) keep=k;
    }
  });
  return keep;})()`);
check("部件∩模型 的块带着 keep=-1 体素规格（不再画满整个部件）", !!iKeep, iKeep || "none");
/* 体素纹理确实进了材质（有槽、有图、尺寸对） */
const iTex = R(`(function(){var u=null;cellGroup.children.forEach(function(m){
    if(m.userData.front && m.userData.ck.indexOf('${iAbove}')===0)u=m.material.userData.cylU;});
  return u && u.uCmMask.value ? u.uCmMask.value.image.width+'x'+u.uCmMask.value.image.height : 'none';})()`);
check("体素 atlas 已写进分块材质", /^\d+x\d+$/.test(iTex), iTex);
/* 隐藏"面上 + 部件内 + 模型外"那几块 → 这些块消失，其余块还在 */
const iHidden = R(`(function(){var n=0,m=0;cells.forEach(function(c){
    if(c.key.indexOf('${iAbove}')===0 && /p\\d+:3\\|m\\d+:0/.test(c.key)){
      c.sel=false; pickSel[c.key]=false; n++; if(c.sel===false) m++;
    }
  });buildCellVis();return n+'/'+m;})()`);
check("点选隐藏的是指定那几块（部件被面割掉）", /^(\d+)\/\1$/.test(iHidden) && parseInt(iHidden, 10) > 0, iHidden);
check("被隐藏块画成幽灵（可再点回来）",
  R(`(function(){var n=0;cellGroup.children.forEach(function(m){
    if(m.userData.front && m.userData.ck.indexOf('${iAbove}')===0 && m.material.opacity<0.1)n++;
  });return n;})()`) >= 2);
/* 反向：模型自己的块也能单独隐藏，切口仍然封盖 */
R(`(function(){cells.forEach(function(c){
    if(c.key.indexOf('${iAbove}')===0 && c.ownerPart==null && c.ownerPe){ c.sel=false; pickSel[c.key]=false; }
  });buildCellVis();})()`);
check("自建模型自己的上半块也能单独隐藏",
  R(`cells.some(function(c){return c.key.indexOf('${iAbove}')===0 && c.ownerPe && c.sel===false;})`) === true);
check("仍然有封盖（切面是实体）",
  R("cellGroup.children.filter(function(m){return m.userData.cap;}).length") >= 1);
/* 清场：放置收回 + 把本段新建的库记录删掉，别把后面 E 段的库长度断言顶偏 */
R(`(function(){for(var i=customModels.length-1;i>=0;i--){
    if(customModels[i].id==='${iRec.id}'){ customModels.splice(i,1); break; }
  }
  cmPersist(); cmRenderHome(); cmRenderChips();
  parts.length=0; faces.length=0; applyShape('cyl');})()`);

section("J 重叠时点选必须落在「看得见的那一块」上（v33.66）");
/* 用户报：拼装部件与自建模型重叠 + 加面切割，点选保留时青色的拼装部件割不掉。
   根因：tapPick 里 v33.64 的捷径"命中自建模型的分块网格 → 直接认这个网格自己的 key"
   只校验了裁剪平面，没校验部件的体积约束。重叠时同一位置有好几块网格共用同一份几何，
   射线最先命中的那块整片被着色器丢弃（看不见），于是点一下藏掉的是"看不见的块"
   → 用户看到的就是"点了没反应 / 面没把拼装模型割掉"。
   现在命中点一律交给 cellAtPoint（全套体积判定 + 沿视线微移兜底）。 */
R("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; addPart('frustum');");
R("parts[0].r=20;parts[0].rt=14;parts[0].h=40;parts[0].x=0;parts[0].y=0;parts[0].z=0;buildParts();");
const jData = R("JSON.stringify(cmGeomData(cmBakeTriangles()))");
const jRec = JSON.parse(R("JSON.stringify(cmSaveGeometry(" + jData + ",'perm','重叠点选','cone'))"));
R("cmPlace('" + jRec.id + "',[0,0,0])");
R("faces=[{type:'horiz',ang:0,x:0,y:0,z:0,on:true,flip:false}]; mode='pick'; refresh();");
R("if(cellsDirty){rebuildCells();buildCellVis();cellsDirty=false;}");
const jFace = R("activeFaceData()[0].id");
const jAbove = "f" + jFace + ":1|";
check("重叠处同时有「部件内+模型外」和「部件内+模型内」两套块",
  R(`cells.some(function(c){return /p\\d+:3\\|m\\d+:0/.test(c.key)&&c.key.indexOf('${jAbove}')===0;})`) === true &&
  R(`cells.some(function(c){return /p\\d+:3\\|m\\d+:1/.test(c.key)&&c.key.indexOf('${jAbove}')===0;})`) === true);
/* 部件侧面、平面上方、且在模型外面的一点（y=10 处圆台半径≈15.5，圆锥半径≈11.25） */
const jKey = R("(function(){var c=cellAtPoint(new THREE.Vector3(0,10,13));return c?c.key:'null';})()");
check("取到的是「部件内 + 模型外」那块（看得见的青色）",
  jKey !== "null" && jKey.indexOf(jAbove) === 0 && /p\d+:3\|m\d+:0/.test(jKey), jKey);
/* v33.66：重叠接缝必须"连续 + 两侧重叠"，否则就是 1 格台阶（毛边）或一条缝（空心） */
const jSD = JSON.parse(R(`(function(){
  var pe=placedCustom[0], m=cmMaskOf(customModels[customModels.length-1]);
  var vox=m.vox, x0=pe.x+15;                       // 圆锥在 y=0 处的半径正好 15
  var arr=[];
  for(var i=0;i<=40;i++){
    var x=x0-1.5*vox+3.0*vox*i/40;
    arr.push(cmMaskSDAt(pe, new THREE.Vector3(x, pe.y, pe.z)));
  }
  var dmax=0;
  for(var j=1;j<arr.length;j++) dmax=Math.max(dmax, Math.abs(arr[j]-arr[j-1]));
  /* 零交叉两侧的采样值：只要都落在 ±0.6 的"重叠余量"内，两个体在边界处就互相覆盖 → 不留缝 */
  var zi=-1;
  for(var k2=1;k2<arr.length;k2++) if(arr[k2-1]<=0 && arr[k2]>0){ zi=k2; break; }
  var sin = zi>0 ? arr[zi-1] : 99, sout = zi>0 ? arr[zi] : 99;
  var mid=0; for(var k=0;k<m.grid.length;k++){ var b=m.grid[k]; if(b>40&&b<215) mid++; }
  return JSON.stringify({dmax:dmax, sin:sin, sout:sout, mid:mid, vox:vox, zi:zi, n:arr.length});
})()`));
check("模型烘的是**距离场**（不是 0/1 占用表，有大量中间值）",
  jSD.mid > 2000, jSD.mid + " / 262144");
check("距离场沿一条穿过表面的线**连续**（相邻差 < 0.5 格 → 没有 1 格台阶）",
  jSD.dmax < 0.5, "maxΔ=" + jSD.dmax.toFixed(3) + "  vox=" + jSD.vox.toFixed(2));
check("零交叉两侧都落在 ±0.6 格的『重叠余量』里（缝合得上，不可能留缝）",
  jSD.zi > 0 && jSD.sin > -0.6 && jSD.sout < 0.6,
  "in=" + jSD.sin.toFixed(2) + " out=" + jSD.sout.toFixed(2) + " zi=" + jSD.zi);
R("camera.position.set(110,90,170); controls.target.set(0,0,0); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);");
const jScreen = JSON.parse(R(`(function(){
  var v=new THREE.Vector3(0,10,13).project(activeCam), r=renderer.domElement.getBoundingClientRect();
  return JSON.stringify([r.left+(v.x*0.5+0.5)*r.width, r.top+(-v.y*0.5+0.5)*r.height]);
})()`));
tapAt(jScreen[0], jScreen[1]);
const jHidden = R("JSON.stringify(Object.keys(pickSel).filter(function(k){return pickSel[k]===false;}))");
/* v33.74：点选的作用单元从"单个 cell"改成"同一个体 + 同一组面侧"。
   原因：同一个体的材料会被另一个体的体积再切一刀，被挡住的那半**永远点不到**
   （用户："点黄色模型上半部分，上半部分只消失了其中一部分"、"重叠部分仍然无法切除"）。
   所以这里断言：点到的那块进了隐藏集合，并且被藏的整组都是"同一个体同一侧"，
   其中**包含被模型挡住的那半**（`p*:3|m*:1`）。 */
const jHiddenArr = JSON.parse(jHidden);
const jGrp = JSON.parse(R(`(function(){
  var g = cellGroupOf(${JSON.stringify(jKey)});
  var arr = ${JSON.stringify(jHiddenArr)};
  return JSON.stringify({
    has: arr.indexOf(${JSON.stringify(jKey)}) >= 0,
    allSame: arr.every(function(k){ return cellGroupOf(k) === g; }),
    n: arr.length,
    /* 组里必须同时包含"另一个体的内/外两侧"的多段（= 有一次点击切不到的那半） */
    segs: (function(){
      var o = {};
      arr.forEach(function(k){ var q = k.split("||")[1] || ""; o[q] = 1; });
      return Object.keys(o).length;
    })(),
    members: cellsOfGroup(g).length
  });
})()`));
check("点可见的青色部分 → 藏掉这块所在的**整组**（含被模型挡住的那半，用户点不到的部分）",
  jGrp.has && jGrp.allSame, jHidden);
check("整组跨过了『另一个体切出来的那几段』（含点不到的那半），一次点击即可切除重叠部分",
  jGrp.n >= 2 && jGrp.segs >= 2 && jGrp.members === jGrp.n,
  "藏 " + jGrp.n + " 块 / 组内 " + jGrp.members + " 块 / 跨 " + jGrp.segs + " 段");
check("藏掉之后该块进入幽灵层（还能点回来）",
  R(`(function(){var n=0;cellGroup.children.forEach(function(m){
    if(m.userData.front && m.userData.ck==='${jKey}' && m.material.opacity<0.1)n++;});return n;})()`) >= 1);
/* 原地再点一下（先把"连点轮换"指针挪开，免得切到"整个部件"那个粒度）→ 恢复 */
R("_pickCycle.x=-9999; _pickCycle.y=-9999;");
tapAt(jScreen[0], jScreen[1]);
check("原地再点一下能恢复", R("cells.every(function(c){return c.sel!==false;})") === true);
/* v33.71：体与体的分界也要补"实心面"（否则隐藏一侧后交叠处露出内壁 = 用户说的蓝色阴影） */
check("交叠处补出了『体表面』封盖（capBody），隐藏一侧后不会透出内壁",
  R(`(function(){var n=0;cellGroup.children.forEach(function(m){
    if(m.userData.capBody && m.material && m.material.color) n++;});return n;})()`) >= 1,
  R(`String((function(){var n=0;cellGroup.children.forEach(function(m){if(m.userData.capBody)n++;});return n;})())`));
/* v33.72（用户："青色模型异常变黄，转视角那块黄还跟着动" / "蓝色阴影仍在"）：
   补面必须用**被补的那个体自己的颜色**。v33.71 用的是"本块的材料色"，
   于是部件块（青）去补模型表面 = 模型被刷成青；模型块（橙）去补部件表面 = 部件被刷成橙；
   两者只差 0.06mm，深度胜负随视角变化 → 那块颜色还会"跟着转"。 */
const jCap = JSON.parse(R(`(function(){var o=[];cellGroup.children.forEach(function(m){
  if(m.userData.capBody && m.material && m.material.color)
    o.push({of:String(m.userData.capBodyOf||""), c:m.material.color.getHexString(), op:m.material.opacity});
});return JSON.stringify(o);})()`));
console.log("    capBody:", JSON.stringify(jCap));
check("补面记录了『补的是哪个体』", jCap.length > 0 && jCap.every(function(x){ return /^[pm]\d+$/.test(x.of); }),
  JSON.stringify(jCap.map(function(x){ return x.of; })));
check("补面的颜色 = 那个体自己的颜色（不再互相染色）",
  jCap.every(function(x){
    if(x.of.charAt(0) === "m") return x.c === "e7974b";
    return x.c === "12d6c8" || x.c === "8fd8ff" || x.c === "8fd8ff";
  }), JSON.stringify(jCap.map(function(x){ return x.of + ":" + x.c; })));
check("补面是不透明的（隐藏块的洞壁要能挡住内壁）",
  jCap.every(function(x){ return x.op === 1; }), JSON.stringify(jCap.map(function(x){ return x.op; })));
/* v33.72：背面（内壁）改成"同色系暗调"，不再是深蓝 0x2f6a8f / 深棕 0x4b2a14 */
const jBack = JSON.parse(R(`(function(){var o=[];cellGroup.children.forEach(function(m){
  if(m.userData.front === false && m.userData.ck && m.material && m.material.color)
    o.push(m.material.color.getHexString());
});return JSON.stringify(o);})()`));
console.log("    back colors:", JSON.stringify(jBack));
check("背面用同色系暗调（不再出现深蓝 2f6a8f / 深棕 4b2a14 / 灰蓝 39485f）",
  jBack.length > 0 && jBack.every(function(h){
    return h !== "2f6a8f" && h !== "4b2a14" && h !== "39485f" && h !== "5b3413" && h !== "0a7a72";
  }), JSON.stringify(jBack));
/* v33.71：换目标点选必须从 index 0 重新开始（"第一次点没反应、第二次才消失"） */
R("cells.forEach(function(c){ c.sel=true; }); pickSel={}; buildCellVis();");
R("_pickCycle.x=-9999; _pickCycle.y=-9999; _pickCycle.first=null;");
tapAt(jScreen[0], jScreen[1]);
const pkI1 = R("_pickCycle.i");
R("cells.forEach(function(c){ c.sel=true; }); pickSel={}; buildCellVis();");
tapAt(jScreen[0] + 60, jScreen[1]);      // 换个位置（离上次 > 8px）
const pkI2 = R("_pickCycle.i");
check("点新目标时从「最前面那块」开始（不会直接跳到第 2 个候选）",
  pkI1 === 0 && pkI2 === 0, "i1=" + pkI1 + " i2=" + pkI2);

/* 清场 */
R(`(function(){for(var i=customModels.length-1;i>=0;i--){
    if(customModels[i].id==='${jRec.id}'){ customModels.splice(i,1); break; }
  }
  cmPersist(); cmRenderHome(); cmRenderChips();
  parts.length=0; faces.length=0; pickSel={}; applyShape('cyl');})()`);

section("E 建模台成品也进同一个库");
const html = fs.readFileSync(path.join(__dirname, "../src/index.html"), "utf8");
const inlines = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(function (m) { return m[1]; });
app.__window.THREE = app.__ctx.THREE;
app.__window.OrbitControls = app.__ctx.THREE.OrbitControls;
(function () {
  const Stub = app.__ctx.THREE.OrbitControls, T = app.__ctx.THREE;
  function Patched(object, dom) {
    Stub.call(this, object, dom);
    this.touches = { ONE: T.TOUCH.ROTATE, TWO: T.TOUCH.DOLLY_PAN };
    this.mouseButtons = { LEFT: T.MOUSE.ROTATE, MIDDLE: T.MOUSE.DOLLY, RIGHT: T.MOUSE.PAN };
    this.minZoom = 0; this.maxZoom = Infinity;
  }
  Patched.prototype = Stub.prototype; app.__ctx.THREE.OrbitControls = Patched;
})();
const docObj = app.__sandbox.document;
const gebi0 = docObj.getElementById.bind(docObj);
docObj.getElementById = function (id) {
  const r = gebi0(id); if (r) return r;
  let out = null;
  (function walk(el) {
    if (out || !el || !el.children) return;
    for (let i = 0; i < el.children.length; i++) { const c = el.children[i]; if (c.id === id) { out = c; return; } walk(c); }
  })(docObj.body);
  return out;
};
vm.runInContext(inlines[1], app.__ctx, { filename: "csg-inline.js" });
const s3 = inlines[2], ci3 = s3.lastIndexOf("})();");
vm.runInContext(s3.slice(0, ci3) + "\n;globalThis.__RUN=function(c){return eval(c)};\n" + s3.slice(ci3),
  app.__ctx, { filename: "cadlab-inline.js" });
app.__window.CADLab.open();
R('addEntity("rect",{x0:-10,y0:-10,x1:10,y1:10},true); featureExtrude("add");');
const cadTris = R("window.CADLab.captureGeometry().getAttribute('position').count/3");
check("建模台有成品实体", cadTris > 0, cadTris);
const cadData = JSON.parse(R("JSON.stringify(window.ConeLabCustom.geomData(window.CADLab.captureGeometry()))"));
check("建模台几何转成统一格式", cadData.t > 0 && cadData.p.length === cadData.t * 9, cadData.t);
const cadRec = JSON.parse(R("JSON.stringify(window.ConeLabCustom.save(" + JSON.stringify(cadData) + ",'perm','建模台成品','cad'))"));
check("建模台成品存进同一个库（来源记 cad）", cadRec && cadRec.owner === "cad" && st().lib.length === 2,
  JSON.stringify(st().lib.map(function (r) { return r.owner; })));
check("建模台成品也出现在当前功能卡的卡片行",
  chips().some(function (c) { return c.name === "建模台成品"; }),
  JSON.stringify(chips().map(function (c) { return c.name; })));

section("F 点卡片行里的名字就地放置 / 收回 / 改名");
R("(function(){var row=document.getElementById('cmChipRow'),t=null;for(var i=0;i<row.children.length;i++){" +
  "if(row.children[i].getAttribute('data-cm-name')==='建模台成品'){t=row.children[i];break;}}t.dispatch('click');})()");
check("点名字就把模型放进当前卡（不用回首页）", st().placed.length === 1 &&
  R("window.ConeLabCustom.getOwner()") === "cyl",
  R("window.ConeLabCustom.getOwner()") + " / " + JSON.stringify(st().placed));
check("放进来的是刚点的那个模型", st().placed[0].id === cadRec.id);
R("(function(){var row=document.getElementById('cmChipRow'),t=null;for(var i=0;i<row.children.length;i++){" +
  "if(row.children[i].getAttribute('data-cm-act')==='clear'){t=row.children[i];break;}}t.dispatch('click');})()");
check("「收回全部」把放置的收回", st().placed.length === 0);
R("window.ConeLabCustom.rename('" + cadRec.id + "','我自己的名字')");
check("可以自行改名", libNames().indexOf("我自己的名字") >= 0, JSON.stringify(libNames()));
check("改名同步到卡片行", chips().some(function (c) { return c.name === "我自己的名字"; }));
check("改名写进 localStorage", /我自己的名字/.test(store[KEY] || ""));

console.log("\n结果: " + pass + " 通过, " + fail + " 失败");
if (fail) process.exit(1);
