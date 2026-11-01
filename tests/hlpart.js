/* v33.30 两项需求的回归套件
   ① 左侧「取消高亮」按钮：点击后相贯体那一整套"高亮"（半透明本体 / 圆环 /
      棱线 / 填充片 / 轴线 / 标签）全部不显示；但打出来的孔仍然在，
      相贯线归「相贯线」按钮管，不跟着一起消失。再点一次全部恢复。
   ② 「拼装变实」后必须是**真正的实体**：不能再出现 depthTest:false 的穿透轮廓
      把后棱画在前壁上面（用户看到的就是"能透过模型看到里面"）。
      穿透轮廓只在部件"整块埋在主立体里"时才画。

   跑法：node test2/hlpart.js
*/
"use strict";
const fs = require("fs");
const path = require("path");
const { boot } = require("./boot");
const app = boot();
const doc = app.__doc;

let pass = 0, fail = 0;
function check(name, cond, detail){
  if(cond){ pass++; console.log("  PASS  " + name + (detail ? "   [" + detail + "]" : "")); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "   [" + detail + "]" : "")); }
}
function section(t){ console.log("\n=== " + t + " ==="); }

const HTML = fs.readFileSync(path.join(__dirname, "..", "src", "index.html"), "utf8");

/* 相贯体组里所有"可画对象"的可见性快照 */
function cylDrawables(idx){
  return app.run(`(function(){
    var v = cylVis[${idx}]; if(!v || !v.g) return null;
    var out = [];
    v.g.traverse(function(ch){
      if(!(ch.isMesh || ch.isLine || ch.isLineSegments || ch.isSprite)) return;
      out.push({type: ch.type, geo: (ch.geometry && ch.geometry.type) || "",
                vis: ch.visible,
                decor: !!(ch.userData && ch.userData.hlDecor),
                keep: !!(ch.userData && ch.userData.hlKeep),
                curve: !!(ch.userData && ch.userData.hlCurve)});
    });
    return out;
  })()`);
}
function partDecor(){
  return app.run(`(function(){
    var out = [];
    partGroup.children.forEach(function(ch){
      if(!ch.material) return;
      out.push({c: ch.material.color.getHexString(), dt: ch.material.depthTest,
                tr: ch.material.transparent, decor: !!(ch.userData && ch.userData.hlDecor),
                pi: (ch.userData && ch.userData.pi != null)});
    });
    return out;
  })()`);
}
function clickBtn(id){ doc.getElementById(id).dispatch("click"); }

/* ============ 一、按钮本身 ============ */
section("一、「取消高亮」按钮（UI）");
check("源码里有 #btnHl 按钮", /<button id="btnHl">/.test(HTML));
check("按钮文字是「取消高亮」", /<button id="btnHl">取消<br>高亮<\/button>/.test(HTML));
check("按钮挂在左侧按钮列 #leftbtns 里",
      /id="leftbtns"[\s\S]*?id="btnHl"[\s\S]*?<\/div>/.test(HTML));
check("DOM 里拿得到该按钮", !!doc.getElementById("btnHl"));
check("默认状态：高亮开着（未取消）", app.run("(function(){ return cylHighlightOff === false; })()") === true);

/* ============ 二、贯穿圆：点一下 → 圆环/轴线全消失，孔还在 ============ */
section("二、贯穿圆：取消高亮后圆环/轴线不显示，孔仍在");
app.run("applyShape('cyl'); cyls.length=0; faces.length=0; parts.length=0; showCurves=false; " +
        "cutShape='cyl'; cutHole=true; addCyl('horiz'); mode='all'; refresh();");
let d0 = cylDrawables(0);
check("默认画着贯穿圆的青色圆环（hlKeep 把手）",
      !!d0 && d0.some(function(x){ return x.keep && x.vis; }), "n=" + (d0 ? d0.length : -1));
check("默认画着轴线", !!d0 && d0.some(function(x){ return x.decor && !x.keep && x.vis; }));

clickBtn("btnHl");
check("按钮置为 on", doc.getElementById("btnHl").classList.contains("on"));
check("按钮文字翻成「恢复高亮」", /恢复<br>高亮/.test(doc.getElementById("btnHl").innerHTML));
let d1 = cylDrawables(0);
check("取消高亮后：圆环不显示（连 hlKeep 把手也收掉）",
      !!d1 && d1.filter(function(x){ return x.keep; }).every(function(x){ return !x.vis; }));
check("取消高亮后：轴线/其它装饰不显示",
      !!d1 && d1.filter(function(x){ return x.decor && !x.curve; }).every(function(x){ return !x.vis; }));
check("取消高亮后：整个相贯体组一个可见对象都没有",
      !!d1 && d1.every(function(x){ return !x.vis; }), "visible=" + (d1 || []).filter(function(x){ return x.vis; }).length);
check("对象没有被删掉（只是 visible=false，仍可点中/拖动）",
      !!d0 && !!d1 && d0.length === d1.length, "before=" + (d0 || []).length + " after=" + (d1 || []).length);
/* 关键：孔是着色器 discard 出来的真孔，跟圆环显示与否无关 */
check("孔仍然存在（轴心点仍落在孔内）",
      app.run("(function(){ return cylMargin(cyls[0], new THREE.Vector3(0,0,0)) > 0; })()") === true);
check("相贯体参数没被动过（hole 仍是打孔）",
      app.run("(function(){ return cyls.length===1 && cyls[0].hole===true && cyls[0].on===true; })()") === true);

clickBtn("btnHl");
check("再点一次：按钮回到 off", !doc.getElementById("btnHl").classList.contains("on"));
check("再点一次：文字回到「取消高亮」", /取消<br>高亮/.test(doc.getElementById("btnHl").innerHTML));
let d2 = cylDrawables(0);
check("再点一次：圆环/轴线全部显示回来",
      !!d2 && d2.filter(function(x){ return x.decor; }).every(function(x){ return x.vis; }));

/* ============ 三、长方体/正方体相贯体：本体也不显示 ============ */
section("三、长方体/正方体相贯体：连半透明本体一起收掉");
app.run("applyShape('cyl'); cyls.length=0; faces.length=0; showCurves=false; " +
        "cutShape='rect'; cutHole=false; addCyl('frontal'); mode='all'; refresh();");
let r0 = cylDrawables(0);
check("默认有半透明本体网格", !!r0 && r0.some(function(x){ return x.type === "Mesh" && !x.decor && x.vis; }));
clickBtn("btnHl");
let r1 = cylDrawables(0);
check("取消高亮后：本体网格不显示",
      !!r1 && r1.filter(function(x){ return x.type === "Mesh" && !x.decor; }).every(function(x){ return !x.vis; }));
check("取消高亮后：棱线（hlKeep）也不显示",
      !!r1 && r1.filter(function(x){ return x.keep; }).every(function(x){ return !x.vis; }));
check("正方体同样适用", app.run(`(function(){
  cyls.length=0; cutShape='sq'; cutHole=false; addCyl('frontal'); mode='all'; refresh();
  var n=0, vis=0;
  cylVis[0].g.traverse(function(ch){
    if(!(ch.isMesh||ch.isLine||ch.isLineSegments)) return;
    n++; if(ch.visible) vis++;
  });
  return n>0 && vis===0;
})()`) === true);
clickBtn("btnHl");
check("恢复后本体回来", app.run("(function(){ var v=0; cylVis[0].g.traverse(function(ch){ if(ch.isMesh && ch.visible) v++; }); return v>0; })()") === true);

/* ============ 四、相贯线不受「取消高亮」影响 ============ */
section("四、相贯线归「相贯线」按钮管，不跟着消失");
app.run("applyShape('cyl'); cyls.length=0; faces.length=0; showCurves=true; " +
        "cutShape='cyl'; cutHole=false; addCyl('horiz'); mode='all'; refresh();");
let c0 = cylDrawables(0);
check("开相贯线时有绿管", !!c0 && c0.some(function(x){ return x.curve; }), "n=" + (c0 || []).length);
clickBtn("btnHl");
let c1 = cylDrawables(0);
check("取消高亮后相贯线仍然可见",
      !!c1 && c1.filter(function(x){ return x.curve; }).every(function(x){ return x.vis; }));
check("取消高亮后其它对象全不可见",
      !!c1 && c1.filter(function(x){ return !x.curve; }).every(function(x){ return !x.vis; }));
clickBtn("btnCurve");   // 关相贯线 → 连绿管也不该留
check("关掉「相贯线」按钮后绿管也不显示",
      (function(){
        const arr = cylDrawables(0) || [];
        return arr.filter(function(x){ return x.curve; }).every(function(x){ return !x.vis; });
      })());
clickBtn("btnCurve");
clickBtn("btnHl");
check("恢复高亮后一切照旧", app.run("(function(){ return cylHighlightOff===false; })()") === true);

/* ============ 五、拼装变实：必须是真实体 ============ */
section("五、拼装变实：不再有穿透轮廓（玻璃盒）");
app.run("applyShape('lab'); parts.length=0; cyls.length=0; faces.length=0; showCurves=false; " +
        "addPart('box'); mode='all'; refresh();");
if(app.run("(function(){ return partTint; })()") !== true) clickBtn("btnSolidPart");
check("拼装变实已开", app.run("(function(){ return partTint === true; })()") === true);
let p1 = partDecor();
check("实验室模式：不画 depthTest:false 的穿透轮廓",
      !p1.some(function(x){ return x.decor && x.dt === false; }), "n=" + p1.length);
check("本体是不透明实体", p1.filter(function(x){ return x.pi; })
      .every(function(x){ return x.c === "12d6c8" && x.tr === false; }));
check("棱线是深度测试正常的普通线（后棱会被前壁挡住）",
      p1.filter(function(x){ return x.decor; }).every(function(x){ return x.dt === true; }));

section("五之二、只有整块埋在主立体里才补穿透轮廓");
app.run("applyShape('cone'); parts.length=0; cyls.length=0; faces.length=0; addPart('cyl');");
app.run("(function(){ var p=parts[0]; p.r=16;p.h=44;p.x=0;p.y=0;p.z=0; })()");
app.run("mode='all'; refresh();");
check("露在锥顶外的部件：partBuried=false",
      app.run("(function(){ return partBuried(parts[0], partGeoOf(parts[0])) === false; })()") === true);
check("露在锥顶外的部件：不画穿透轮廓",
      !partDecor().some(function(x){ return x.decor && x.dt === false; }));

app.run("parts.length=0; addPart('sphere');");
app.run("(function(){ var p=parts[0]; p.r=7;p.x=0;p.y=-8;p.z=0; })()");
app.run("mode='all'; refresh();");
check("整块埋住的部件：partBuried=true",
      app.run("(function(){ return partBuried(parts[0], partGeoOf(parts[0])) === true; })()") === true);
check("整块埋住的部件：补上穿透轮廓（不然点变实毫无反应）",
      partDecor().some(function(x){ return x.decor && x.dt === false; }));

console.log("\n=========================================");
console.log("  PASS " + pass + "   FAIL " + fail);
console.log("=========================================");
process.exit(fail ? 1 : 0);
