/* v33.27 回归：三视图按钮"点第二次翻到对面"
   主视⇄后视、俯视⇄仰视、左视⇄右视；并且投影方向/上向量必须严格互为镜像。 */
"use strict";
const { boot } = require("./boot");
const app = boot();

let pass = 0, fail = 0;
function ok(n, c, d){
  console.log((c ? "  PASS  " : "  FAIL  ") + n + (d ? "   [" + d + "]" : ""));
  if(c) pass++; else fail++;
}
function section(t){ console.log("\n===== " + t + " ====="); }

const doc = app.__doc;
function btn(v){ return doc.querySelectorAll("#views button").filter(function(b){ return b.getAttribute("data-v") === v; })[0]; }
function camState(){
  return app.run(`(function(){
    var c = orthoCam;
    return {pos:[c.position.x, c.position.y, c.position.z],
            up:[c.up.x, c.up.y, c.up.z],
            ortho: (activeCam === orthoCam),
            curView: curView};
  })()`);
}
function click(v){ btn(v).dispatch("click"); return camState(); }

section("1. 第一次点击 = 原行为（主视/俯视/左视）");
app.run("resetView();");
let s = click("front");
ok("主视 → 相机在 +Z", s.pos[0] === 0 && s.pos[2] > 0 && s.ortho, JSON.stringify(s));
ok("主视 → up=(0,1,0)", s.up[1] === 1, JSON.stringify(s.up));
ok("主视 → 按钮亮起且文字仍是「主视」", btn("front").classList.contains("on") && btn("front").textContent === "主视", btn("front").textContent);

section("2. 第二次点击 主视 → 后视（-Z）");
s = click("front");
ok("后视 → 相机在 -Z", s.pos[2] < 0, JSON.stringify(s.pos));
ok("后视 → up 仍 +Y（不上下颠倒）", s.up[1] === 1, JSON.stringify(s.up));
ok("后视 → 按钮文字变「后视」且仍亮", btn("front").classList.contains("on") && btn("front").textContent === "后视", btn("front").textContent);
ok("后视 → curView === 'back'", s.curView === "back", s.curView);

section("3. 第三次点击 主视 → 回到前视");
s = click("front");
ok("回到主视（+Z）", s.pos[2] > 0, JSON.stringify(s.pos));
ok("按钮文字回到「主视」", btn("front").textContent === "主视", btn("front").textContent);

section("4. 俯视 → 仰视（+Y → -Y），上向量镜像");
s = click("top");
ok("俯视 → 相机在 +Y，up=(0,0,-1)", s.pos[1] > 0 && Math.abs(s.up[2] + 1) < 1e-9, JSON.stringify(s));
s = click("top");
ok("仰视 → 相机在 -Y", s.pos[1] < 0, JSON.stringify(s.pos));
ok("仰视 → up=(0,0,+1)（与俯视镜像）", Math.abs(s.up[2] - 1) < 1e-9, JSON.stringify(s.up));
ok("仰视 → 按钮文字「仰视」", btn("top").textContent === "仰视", btn("top").textContent);

section("5. 左视 → 右视（-X → +X）");
s = click("left");
ok("左视 → 相机在 -X，up +Y", s.pos[0] < 0 && s.up[1] === 1, JSON.stringify(s));
s = click("left");
ok("右视 → 相机在 +X", s.pos[0] > 0, JSON.stringify(s.pos));
ok("右视 → 按钮文字「右视」", btn("left").textContent === "右视", btn("left").textContent);

section("6. 跨按钮切换：从后视点俯视 → 直接进俯视（不先回主视）");
s = click("top");
ok("俯视（+Y）", s.pos[1] > 0 && s.curView === "top", JSON.stringify(s));
ok("主视按钮已复位成「主视」且不亮", btn("front").textContent === "主视" && !btn("front").classList.contains("on"),
   btn("front").textContent);

section("7. 复位视角 / 转成自由视角后按钮全部复位");
app.run("resetView();");
ok("resetView → 三个按钮都不亮", ["front","top","left"].every(function(v){ return !btn(v).classList.contains("on"); }));
ok("resetView → 文字回到主视/俯视/左视",
   btn("front").textContent === "主视" && btn("top").textContent === "俯视" && btn("left").textContent === "左视");
ok("resetView → curView 清空", app.run("curView") === "");

section("8. 六个方向的相机位置/上向量两两互为镜像（几何自检）");
const six = app.run(`(function(){
  var out = {};
  ['front','back','top','bottom','left','right'].forEach(function(k){
    setView(k);
    out[k] = {p:[+orthoCam.position.x.toFixed(3), +orthoCam.position.y.toFixed(3), +orthoCam.position.z.toFixed(3)],
              u:[orthoCam.up.x, orthoCam.up.y, orthoCam.up.z]};
  });
  return out;
})()`);
const pairs = [["front","back"],["top","bottom"],["left","right"]];
pairs.forEach(function(p){
  const A = six[p[0]], B = six[p[1]];
  const mirror = A.p.every(function(v,i){ return Math.abs(v + B.p[i]) < 1e-6; });
  ok(p[0] + " / " + p[1] + " 相机位置严格相反", mirror, JSON.stringify([A.p, B.p]));
});
ok("俯视 up=(0,0,-1) 而仰视 up=(0,0,+1)",
   Math.abs(six.top.u[2] + 1) < 1e-9 && Math.abs(six.bottom.u[2] - 1) < 1e-9,
   JSON.stringify([six.top.u, six.bottom.u]));
ok("主/后/左/右视的 up 都是 +Y（不歪）",
   ["front","back","left","right"].every(function(k){ return Math.abs(six[k].u[1] - 1) < 1e-9; }),
   JSON.stringify([six.front.u, six.back.u, six.left.u, six.right.u]));

section("9. 冻结态下三次点击仍可用（不抛异常）");
const frozen = app.run(`(function(){
  try {
    lockState='freeze'; applyLockState();
    var b = document.querySelector("#views button[data-v='front']");
    /* 无头 DOM stub 没有 .click()，用 dispatch('click') —— 与 accept.js 里 btnLock 同一写法 */
    b.dispatch("click"); var t1 = b.textContent;
    b.dispatch("click"); var t2 = b.textContent;
    b.dispatch("click"); var t3 = b.textContent;
    lockState='none'; applyLockState();
    return {ok:true, seq:[t1,t2,t3]};
  } catch(e){ return {ok:false, err:e.message}; }
})()`);
ok("冻结态点击三视图不抛异常", frozen.ok === true, JSON.stringify(frozen));
ok("冻结态点击顺序 主视→后视→主视", JSON.stringify(frozen.seq) === JSON.stringify(["主视","后视","主视"]), JSON.stringify(frozen.seq));

console.log("\n=========================================");
console.log("  PASS " + pass + "   FAIL " + fail);
console.log("=========================================");
process.exit(fail ? 1 : 0);
