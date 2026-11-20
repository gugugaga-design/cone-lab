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
