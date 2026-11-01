/* v33.28 探针：平放圆柱 + 正平面/水平面贯穿圆 + 过中心侧平面 → 「点选保留部分」两个问题
   用户原话：
   问题1：选择「点选保留部分」按钮的瞬间，两个贯穿圆不再贯穿。
   问题2：想只保留侧平面右半部分，点选隐藏后有一块异常消失不了（截图：内圆右缘一小块橙色）。
   运行: node test2/probe_pick_hole2.js */
"use strict";
const { boot } = require("./boot");
const app = boot();
let pass = 0, fail = 0;
function check(n, c, d){ if(c){pass++;console.log("  PASS  "+n+(d?"   ["+d+"]":""));} else {fail++;console.log("  FAIL  "+n+(d?"   ["+d+"]":""));} }
function section(t){ console.log("\n=== " + t + " ==="); }
function J(x){ return JSON.stringify(x); }

/* ---- 真实 DOM 事件流点击（同 cylpick.js） ---- */
function realTapAt(worldPointExpr){
  return app.run(`(function(){
    var W = ${worldPointExpr};
    var v = W.clone().project(activeCam);
    var rect = renderer.domElement.getBoundingClientRect();
    var sx = rect.left + (v.x*0.5+0.5)*rect.width;
    var sy = rect.top + (-v.y*0.5+0.5)*rect.height;
    function mk(t){ return {type:t, clientX:sx, clientY:sy, pointerId:1, pointerType:'touch',
      isPrimary:true, button:0, buttons:(t==='pointerup'?0:1),
      preventDefault:function(){}, stopPropagation:function(){}}; }
    var el = renderer.domElement;
    ((el._listeners&&el._listeners.pointerdown)||[]).forEach(function(f){ f.call(el, mk('pointerdown')); });
    ((window._listeners&&window._listeners.pointerup)||[]).forEach(function(f){ f.call(window, mk('pointerup')); });
    return {x:sx, y:sy};
  })()`);
}

/* ===== 场景：平放圆柱 + 正平面贯穿圆(同轴孔) + 水平面贯穿圆(竖直孔) + 侧平面过中心 ===== */
section("搭建场景");
app.run("applyShape('cylz'); parts.length=0; cyls.length=0; faces.length=0;");
app.run("cutShape='cyl'; cutHole=true;");
app.run("addCyl('frontal')");   // 轴=Z，与平放圆柱同轴的孔
app.run("addCyl('horiz')");     // 轴=Y，竖直孔
app.run("faces.push({type:'lat', ang:0, x:0, y:0, z:0, on:true, flip:false}); renderList();");
console.log(app.run(`(function(){
  return { shape: shape, R:R, H:H,
           cyls: cyls.map(function(c){ return {type:c.type, hole:c.hole, r:c.r, len:c.len, id:c._id}; }),
           faces: faces.length };
})()`));

/* all 模式下：孔是钻穿的（基础网格 keep=+1 把孔挖掉） */
section("A. 问题1：切进「点选保留部分」的瞬间，孔里那块是否默认显示");
app.run("mode='pick'; refresh();");
const A = app.run(`(function(){
  var cs = activeCyls();
  var rows = cells.map(function(c){
    var pk = parseCellKey(c.key);
    var inHole = cs.some(function(cc){ return cc.hole && pk.cm[cc._id] === 3; });
    return { key:c.key, sel:c.sel!==false, inHole:inHole, n:(c.pts?c.pts.length:0) };
  });
  return { total: cells.length,
           holeCells: rows.filter(function(r){ return r.inHole; }),
           holeVisible: rows.filter(function(r){ return r.inHole && r.sel; }).length,
           matVisible: rows.filter(function(r){ return !r.inHole && r.sel; }).length };
})()`);
console.log("    cells=" + A.total + "  孔内块数=" + A.holeCells.length +
            "  孔内默认可见=" + A.holeVisible + "  材料块可见=" + A.matVisible);
A.holeCells.forEach(function(r){ console.log("      孔内块: sel=" + r.sel + " n=" + r.n + "  " + r.key); });
check("切进点选模式时，孔里那块默认是隐藏的（孔保持贯穿外观）", A.holeVisible === 0,
      "孔内默认可见 " + A.holeVisible + "/" + A.holeCells.length);

/* ===== 问题2：把用户点得到的全藏掉之后，还剩哪块看得见却点不掉 ===== */
section("B. 问题2：逐一模拟「点它的位置」能否隐藏");
/* 对每个默认可见的块：取其采样点质心 → 投屏 → 真实 tap → 看是哪个 key 变了 */
const B = app.run(`(function(){
  useOrthoCam(false);
  camera.position.set(0,0,260); camera.lookAt(0,0,0); camera.updateMatrixWorld(true);
  controls.target.set(0,0,0);
  var cs = activeCyls();
  function kindOf(k){
    var pk = parseCellKey(k);
    var inAny = cs.some(function(cc){ return pk.cm[cc._id] === 3; });
    var right = pk.fm && true;
    return k;
  }
  var out = [];
  cells.forEach(function(c){
    if(c.sel === false || !c.pts || !c.pts.length) return;
    var cen = new THREE.Vector3();
    c.pts.forEach(function(p){ cen.add(p); }); cen.multiplyScalar(1/c.pts.length);
    out.push({ key:c.key, cen:[+cen.x.toFixed(1), +cen.y.toFixed(1), +cen.z.toFixed(1)] });
  });
  return out;
})()`);
console.log("    可见块数=" + B.length);
let stuck = [];
B.forEach(function(row){
  // 记录点击前各块 sel
  const before = app.run("(function(){ var m={}; cells.forEach(function(c){ m[c.key]=(c.sel!==false); }); return m; })()");
  realTapAt("new THREE.Vector3(" + row.cen.join(",") + ")");
  const after = app.run("(function(){ var m={}; cells.forEach(function(c){ m[c.key]=(c.sel!==false); }); return m; })()");
  var changed = Object.keys(after).filter(function(k){ return after[k] !== before[k]; });
  row.changed = changed;
  row.hitIntended = changed.indexOf(row.key) >= 0;
  console.log("    点击 [" + row.cen.join(",") + "] 目标=" + row.key +
              (row.hitIntended ? " → 命中" : " → 打到别的块: " + J(changed)));
  if(!row.hitIntended) stuck.push(row);
});
check("每个可见块点它自己的位置都能被选中", stuck.length === 0,
      "点不到的块 " + stuck.length + " 个" + (stuck.length ? ": " + stuck.map(function(s){return s.key;}).join(" | ") : ""));

/* ===== C. 手动把所有非目标块 sel=false 后，重建还剩什么可见 ===== */
section("C. 只保留右半材料（模拟用户目标状态）");
app.run(`(function(){
  var cs = activeCyls();
  cells.forEach(function(c){
    var pk = parseCellKey(c.key);
    var right = pk.fm[faces[0]._id] === true;                 // 侧平面法向 +X 侧
    var inHole = cs.some(function(cc){ return cc.hole && pk.cm[cc._id] === 3; });
    c.sel = (right && !inHole);
    pickSel[c.key] = c.sel;
  });
  buildCellVis();
})()`);
const C = app.run(`(function(){
  var cs = activeCyls();
  return cells.filter(function(c){ return c.sel !== false; })
    .map(function(c){ return { key:c.key, n:(c.pts?c.pts.length:0) }; });
})()`);
console.log("    保留块: " + J(C));
C.forEach(function(r){ console.log("      保留: " + r.key + "  n=" + r.n); });

/* 对保留块做同样的"点它自己"测试（找点不掉的） */
let stuck2 = [];
C.forEach(function(row){
  const before = app.run("(function(){ var m={}; cells.forEach(function(c){ m[c.key]=(c.sel!==false); }); return m; })()");
  // 重新取质心（sel 可能影响 pts 无关，pts 还在）
  const cen = app.run("(function(){ var c=cellOfKey(" + J(row.key) + "); var v=new THREE.Vector3(); c.pts.forEach(function(p){v.add(p);}); v.multiplyScalar(1/c.pts.length); return [v.x,v.y,v.z]; })()");
  realTapAt("new THREE.Vector3(" + cen.map(function(x){return +x.toFixed(2);}).join(",") + ")");
  const after = app.run("(function(){ var m={}; cells.forEach(function(c){ m[c.key]=(c.sel!==false); }); return m; })()");
  var changed = Object.keys(after).filter(function(k){ return after[k] !== before[k]; });
  var hit = changed.indexOf(row.key) >= 0;
  console.log("    点击保留块 [" + cen.map(function(x){return +x.toFixed(1);}).join(",") + "] " +
              (hit ? "→ 命中(被隐藏)" : "→ 打到: " + J(changed)));
  if(!hit) stuck2.push(row.key);
});
check("保留的材料块都能被点选隐藏", stuck2.length === 0, J(stuck2));

console.log("\n===== 结果: " + pass + " pass / " + fail + " fail =====");
process.exit(fail ? 1 : 0);
