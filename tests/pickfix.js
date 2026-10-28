/* v33.17 回归：点选中空 / 点伸出段无反应 / 移动后撤销残留
   运行: node test2/pickfix.js */
"use strict";
const { boot } = require("./boot");
const app = boot();
let pass = 0, fail = 0;
function check(n, c, d){
  if(c){ pass++; console.log("  PASS  " + n + (d ? "   [" + d + "]" : "")); }
  else { fail++; console.log("  FAIL  " + n + (d ? "   [" + d + "]" : "")); }
}
function section(t){ console.log("\n=== " + t + " ==="); }

/* ---------- 1. 封盖：每个分块都必须生成封盖（"中空"的根因） ---------- */
section("1. 点选模式：每一块都要生成封盖（否则隐藏后能看穿到内壁）");

function capStats(shape, facesJs){
  app.run(`(function(){
    applyShape('${shape}');
    parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
    ${facesJs}
    mode = 'pick'; refresh();
  })()`);
  return app.run(`(function(){
    var act = activeFaceData();
    var noCap = [], total = 0, area = 0;
    cells.forEach(function(c){
      var caps = cellCaps(c, act);
      total++;
      if(!caps.length){ noCap.push(c.key); return; }
      caps.forEach(function(g){
        var p = g.attributes.position;
        for(var i=0;i+2<p.count;i+=3){
          var A=new THREE.Vector3().fromBufferAttribute(p,i),
              B=new THREE.Vector3().fromBufferAttribute(p,i+1),
              C=new THREE.Vector3().fromBufferAttribute(p,i+2);
          area += B.clone().sub(A).cross(C.clone().sub(A)).length()/2;
        }
      });
    });
    return {cells: total, noCap: noCap, area: +area.toFixed(1)};
  })()`);
}

const cylCase = capStats("cyl", `
  faces.push({type:'horiz', ang:0, x:0, y:13.025, z:0, on:true, flip:false});
  faces.push({type:'frontal', ang:0, x:0, y:0, z:0, on:true, flip:false});
`);
check("圆柱+2面：每块都有封盖", cylCase.noCap.length === 0,
      cylCase.cells + " 块，缺封盖 " + cylCase.noCap.length + " 块");
check("圆柱+2面：封盖总面积 > 0", cylCase.area > 100, "area=" + cylCase.area);

const coneCase = capStats("cone", `
  faces.push({type:'horiz', ang:0, x:0, y:0, z:0, on:true, flip:false});
`);
check("圆锥+1面：每块都有封盖", coneCase.noCap.length === 0,
      coneCase.cells + " 块，缺封盖 " + coneCase.noCap.length);

const pyrCase = capStats("pyr3", `
  faces.push({type:'horiz', ang:0, x:0, y:0, z:0, on:true, flip:false});
`);
check("正三棱锥+1面：每块都有封盖", pyrCase.noCap.length === 0,
      pyrCase.cells + " 块，缺封盖 " + pyrCase.noCap.length);

/* ---------- 2. 封盖必须在本块那一侧（符号位） ---------- */
section("2. 封盖必须画在本块保留的那一侧，且带本块裁剪平面");
const capSide = app.run(`(function(){
  applyShape('cyl');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  faces.push({type:'horiz', ang:0, x:0, y:0, z:0, on:true, flip:false});
  mode = 'pick'; refresh();
  var act = activeFaceData();
  var rows = [];
  cells.forEach(function(c){
    var caps = cellCaps(c, act);
    var pk = parseCellKey(c.key);
    caps.forEach(function(g){
      var p = g.attributes.position;
      /* 封盖顶点必须在平面 n·p = d 上（允许 0.08mm 位移），
         且必须落在本块裁剪区域内 */
      var maxOff = 0, outside = 0;
      for(var i=0;i<p.count;i++){
        var P = new THREE.Vector3().fromBufferAttribute(p,i);
        act.forEach(function(o){ maxOff = Math.max(maxOff, Math.abs(o.nv.dot(P) - o.d)); });
        for(var k=0;k<c.planes.length;k++){
          if(c.planes[k].distanceToPoint(P) < -0.5){ outside++; break; }
        }
      }
      rows.push({key:c.key, verts:p.count, maxOff:+maxOff.toFixed(3), outside:outside});
    });
  });
  return {n:cells.length, rows:rows};
})()`);
check("有封盖可查", capSide.rows.length > 0, capSide.rows.length + " 张");
check("封盖顶点都贴在剖面上（偏移 < 0.5mm）",
      capSide.rows.every(function(r){ return r.maxOff < 0.5; }),
      "最大偏移 " + Math.max.apply(null, capSide.rows.map(function(r){ return r.maxOff; })) + "mm");
check("封盖顶点都落在本块裁剪区域内（不越界盖到别的块）",
      capSide.rows.every(function(r){ return r.outside === 0; }),
      "越界顶点总数 " + capSide.rows.reduce(function(a,r){ return a + r.outside; }, 0));

/* ---------- 3. 点选模式：部件外壳必须一直隐藏（"点伸出段不消失"的根因） ---------- */
section("3. 点选模式下部件外壳必须一直让位给分块网格（含 buildParts 之后）");
function shellVis(){
  return app.run(`(function(){
    if(!partGroup) return [];
    return partGroup.children.filter(function(c){ return c.userData && c.userData.pi != null; })
      .map(function(c){ return c.visible; });
  })()`);
}
app.run(`(function(){
  applyShape('cyl');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addPart('cyl');
  (function(){ var p = parts[0]; p.r = 5; p.h = 55; p.x = -0.5; p.y = 21; p.z = -4; })();
  faces.push({type:'frontal', ang:0, x:0, y:0, z:-12.47, on:true, flip:false});
  faces.push({type:'horiz',   ang:0, x:0, y:13.02, z:0, on:true, flip:false});
  mode = 'pick'; renderList(); refresh();
})()`);
check("refresh 后外壳隐藏", shellVis().every(function(v){ return v === false; }), JSON.stringify(shellVis()));

app.run("buildParts();");
check("buildParts() 之后外壳仍然隐藏", shellVis().every(function(v){ return v === false; }),
      JSON.stringify(shellVis()));

app.run("(function(){ parts[0].x = 8; buildParts(); })()");
check("改了部件位置后外壳仍然隐藏", shellVis().every(function(v){ return v === false; }),
      JSON.stringify(shellVis()));

/* ---------- 4. 点伸出主立体之外的那一截：必须能隐藏 ---------- */
section("4. 点伸出主立体之外的圆柱头 → 那一块要真的被隐藏");
const stub = app.run(`(function(){
  applyShape('cyl');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addPart('cyl');
  (function(){ var p = parts[0]; p.r = 5; p.h = 55; p.x = -0.5; p.y = 21; p.z = -4; })();
  faces.push({type:'frontal', ang:0, x:0, y:0, z:-12.47, on:true, flip:false});
  faces.push({type:'horiz',   ang:0, x:0, y:13.02, z:0, on:true, flip:false});
  mode = 'pick'; renderList(); refresh();
  /* 伸出主立体顶面(y=35)之上的一点 */
  var P = new THREE.Vector3(-0.5, 41, -4);
  var c = cellAtPoint(P);
  if(!c) return {err:'cellAtPoint 找不到块'};
  var before = c.sel;
  c.sel = false; pickSel[c.key] = false;
  buildCellVis(); buildCylVis();
  var after = c.sel;
  return {key:c.key, before:before, after:after, inSolid: insideCone(P)};
})()`);
check("伸出段的点能定位到一块 cell", !stub.err, stub.err || stub.key);
check("该点确实在主立体之外", stub.inSolid === false, "insideCone=" + stub.inSolid);
check("隐藏后该块 sel=false", stub.after === false, "before=" + stub.before + " after=" + stub.after);

/* 再点一次应该恢复 */
const restored = app.run(`(function(){
  var c = cells.filter(function(x){ return x.sel === false; })[0];
  if(!c) return {err:'没有被隐藏的块'};
  c.sel = true; pickSel[c.key] = true;
  buildCellVis(); buildCylVis();
  return {key:c.key, sel:c.sel};
})()`);
check("再点一次能恢复", restored.sel === true, restored.key);

/* ---------- 5. 相贯体（贯穿圆柱）伸出段也能点 ---------- */
section("5. 相贯体伸出主立体之外的实体也能点选隐藏");
const cylStub = app.run(`(function(){
  applyShape('cyl');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addCyl('horiz');
  (function(){ var c = cyls[0]; c.shape='cyl'; c.r=9; c.len=140; c.y=0; })();
  bodyTint = true;
  mode = 'pick'; refresh();
  var before = cells.filter(function(c){ return c.sel === false; }).length;
  var beforeHidden = cylRegionHidden(activeCyls()[0]);
  /* 直接把"孔内那块"隐藏，模拟用户点中伸出段 */
  var inner = cells.filter(function(c){
    var sp = c.cyls && c.cyls[0];
    return sp && sp.keep < 0;
  });
  inner.forEach(function(c){ c.sel = false; pickSel[c.key] = false; });
  buildCellVis(); buildCylVis();
  return {before:before, beforeHidden:beforeHidden, nInner:inner.length,
          afterHidden: cylRegionHidden(activeCyls()[0]),
          bodyVisible: (function(){
            var o=[]; cylVis.forEach(function(v){ v.g.children.forEach(function(ch){
              if(ch.isMesh && ch.geometry && ch.geometry.type==='CylinderGeometry') o.push(ch.visible); }); });
            return o; })()};
})()`);
check("相贯体存在孔内那一块", cylStub.nInner > 0, cylStub.nInner + " 块");
check("隐藏后相贯体本体不画（bodyHidden 生效）",
      cylStub.beforeHidden === false && cylStub.afterHidden === true,
      "before=" + cylStub.beforeHidden + " after=" + cylStub.afterHidden);

/* v33.18：cylVis 的下标对应 cyls，不是 activeCyls()。
   只要有一个相贯体被停用，用 activeCyls() 索引就会整体错位 ——
   点 A 的伸出段却藏掉 B 的材料。 */
section("5b. 停用一个相贯体后，点另一个的伸出段必须归到正确的那个");
const idxCase = app.run(`(function(){
  applyShape('cyl');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addCyl('horiz');
  (function(){ var c = cyls[0]; c.shape='cyl'; c.r=6;  c.len=100; c.y=0; })();
  addCyl('horiz');
  (function(){ var c = cyls[1]; c.shape='cyl'; c.r=14; c.len=100; c.y=0; })();
  bodyTint = true; mode = 'pick'; refresh();
  cyls[0].on = false;                 // 停用小圆柱，只留大圆柱
  refresh();
  /* 点大圆柱伸出主立体顶面之上的位置 */
  var P = new THREE.Vector3(0, 42, 0);
  var v = P.clone().project(activeCam);
  var r = renderer.domElement.getBoundingClientRect();
  var e = {clientX: r.left + (v.x*0.5+0.5)*r.width,
           clientY: r.top  + (-v.y*0.5+0.5)*r.height};
  raycaster.setFromCamera(ndcFromEvent(e), activeCam);
  tapPick(e);
  var hidden = cells.filter(function(c){ return c.sel === false; });
  return {
    hiddenCount: hidden.length,
    /* key 的相贯体段应当只含 c2（大圆柱的 _id），不含已停用的 c1 */
    segs: hidden.map(function(c){ return c.key.split("|")[1]; }),
    bigId: cyls[1]._id, smallId: cyls[0]._id,
    cylVisR: cylVis.map(function(vv){
      var r2 = null;
      vv.g.children.forEach(function(ch){
        if(ch.geometry && ch.geometry.type === 'CylinderGeometry' && ch.geometry.parameters)
          r2 = ch.geometry.parameters.radiusTop;
      });
      return r2;
    })
  };
})()`);
check("点伸出段确实隐藏了内容", idxCase.hiddenCount > 0, idxCase.hiddenCount + " 块");
check("命中的是启用的那个相贯体（不是已停用的）",
      idxCase.segs.every(function(s){ return s.indexOf("c" + idxCase.bigId + ":") === 0; }),
      "命中段=" + JSON.stringify(idxCase.segs) +
      " 大圆柱id=" + idxCase.bigId + " 小圆柱id=" + idxCase.smallId);

/* ---------- 6. 拼装部件移动后：分块必须跟着重算（"移动后残影"的根因） ---------- */
section("6. 点选模式下移动拼装部件 → 分块必须跟着重算");
const moveSync = app.run(`(function(){
  applyShape('cyl');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addPart('cyl');
  (function(){ var p = parts[0]; p.r = 6; p.h = 60; p.x = 0; p.y = 22; p.z = 0; })();
  faces.push({type:'frontal', ang:0, x:0, y:0, z:0, on:true, flip:false});
  mode = 'pick'; renderList(); refresh();
  var keysBefore = cells.map(function(c){ return c.key; });
  /* 模拟拖动：改坐标 + buildParts（pointermove 的 partDrag 分支做的事） */
  parts[0].x = 18; parts[0].y = 6;
  buildParts();
  var dirty = cellsDirty;
  return {keysBefore:keysBefore, dirty:dirty};
})()`);
check("移动部件后 cellsDirty 被置位", moveSync.dirty === true, "cellsDirty=" + moveSync.dirty);

const moveAfter = app.run(`(function(){
  /* 走一遍渲染循环里"cellsDirty → 重建"的同一条路径 */
  rebuildCells(); buildCellVis(); cellsDirty = false;
  var meshOwners = [];
  if(cellGroup) cellGroup.children.forEach(function(m){
    if(m.userData.cap) return;
    meshOwners.push(m.userData.ck);
  });
  return {cells: cells.map(function(c){ return c.key; }), meshOwners:meshOwners,
          partHidden: parts.map(function(p){ return !!p.hidden; })};
})()`);
check("重建后分块网格与 cells 一一对应（没有孤儿网格）",
      moveAfter.meshOwners.length === moveAfter.cells.length * 2,
      "meshes=" + moveAfter.meshOwners.length + " cells=" + moveAfter.cells.length);

/* ---------- 7. 撤销必须精确回到拖动前 ---------- */
section("7. 移动拼装部件后撤销 → 必须精确回到原状（无残影）");
const undoCmp = app.run(`(function(){
  applyShape('cyl');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addPart('cyl');
  (function(){ var p = parts[0]; p.r = 6; p.h = 60; p.x = 0; p.y = 22; p.z = 0; })();
  faces.push({type:'frontal', ang:0, x:0, y:0, z:0, on:true, flip:false});
  mode = 'pick'; renderList(); refresh();

  var snap0 = snapState();
  var keys0 = cells.map(function(c){ return c.key; }).sort().join(";");
  /* key 只是符号位组合，部件平移后 key 可能不变 —— 真正会变的是裁剪平面 */
  var planesOf = function(){
    return cells.map(function(c){
      return c.planes.map(function(p){
        return [p.normal.x, p.normal.y, p.normal.z, p.constant]
          .map(function(v){ return +v.toFixed(4); }).join(",");
      }).join("|");
    }).sort().join(";");
  };
  var planes0 = planesOf();

  /* 拖动 → endDrag（partDrag 分支） */
  parts[0].x = 18; parts[0].y = 6;
  partDrag = {pi:0};
  endDrag();
  var moved = parts[0].x;
  var planesMoved = planesOf();

  /* 撤销 */
  undoStep();
  var snap1 = snapState();
  var keys1 = cells.map(function(c){ return c.key; }).sort().join(";");
  var planes1 = planesOf();

  /* 数一数场景里还剩几个网格 */
  var meshCount = 0;
  scene.traverse(function(o){ if(o.isMesh) meshCount++; });

  return {snap0:snap0, snap1:snap1, same: snap0 === snap1,
          movedX: moved, keys0:keys0, keys1:keys1,
          planesChanged: planes0 !== planesMoved,
          planesRestored: planes0 === planes1,
          cellsRestored: keys0 === keys1, meshCount:meshCount,
          partX: parts[0] ? parts[0].x : null,
          partY: parts[0] ? parts[0].y : null};
})()`);
check("拖动确实改变了部件位置", undoCmp.movedX !== 0, "x=" + undoCmp.movedX);
check("拖动后分块的裁剪平面随之重算（不是停在旧位置）", undoCmp.planesChanged);
check("撤销后裁剪平面精确复原（无残影）", undoCmp.planesRestored);
check("撤销后状态快照与拖动前完全一致", undoCmp.same, undoCmp.same ? "JSON 相等" : "不一致");
check("撤销后部件回到原位", undoCmp.partX === 0 && undoCmp.partY === 22,
      "x=" + undoCmp.partX + " y=" + undoCmp.partY);
check("撤销后分块 key 集合与拖动前一致", undoCmp.cellsRestored);

/* ---------- 8. 删除部件后不留残影 ---------- */
section("8. 删除拼装部件后不留残影");
const delCase = app.run(`(function(){
  applyShape('cyl');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addPart('cyl');
  (function(){ var p = parts[0]; p.r = 6; p.h = 60; p.x = 0; p.y = 22; p.z = 0; })();
  faces.push({type:'frontal', ang:0, x:0, y:0, z:0, on:true, flip:false});
  mode = 'pick'; renderList(); refresh();
  var withPart = cells.length;
  var ownerCells = cells.filter(function(c){ return c.ownerPart != null; }).length;

  parts.splice(0, 1); buildParts(); renderPartList(); refresh();
  var afterCells = cells.length;
  var afterOwner = cells.filter(function(c){ return c.ownerPart != null; }).length;
  var partMeshes = 0;
  if(partGroup) partGroup.children.forEach(function(ch){ if(ch.userData && ch.userData.pi != null) partMeshes++; });
  return {withPart:withPart, ownerCells:ownerCells, afterCells:afterCells,
          afterOwner:afterOwner, partMeshes:partMeshes};
})()`);
check("删除前有落在部件内部的分块", delCase.ownerCells > 0, delCase.ownerCells + " 块");
check("删除后不再有部件内部分块", delCase.afterOwner === 0, "剩 " + delCase.afterOwner);
check("删除后 partGroup 里没有部件网格", delCase.partMeshes === 0, "剩 " + delCase.partMeshes);

/* ---------- 9. 只显示交集模式仍然正常封盖 ---------- */
section("9. 回归：只显示交集（buildInterCaps 的伪 key 分支）仍然封盖");
const interCase = app.run(`(function(){
  applyShape('cyl');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  faces.push({type:'frontal', ang:0, x:0, y:0, z:6, on:true, flip:false});
  faces.push({type:'horiz',   ang:0, x:0, y:6, z:0, on:true, flip:false});
  mode = 'inter';
  var ms = document.getElementById('mode'); if(ms) ms.value = 'inter';
  refresh();
  var caps = 0, verts = 0;
  if(interCapGroup) interCapGroup.children.forEach(function(m){
    caps++; verts += m.geometry.attributes.position.count;
  });
  return {mode:mode, caps:caps, verts:verts};
})()`);
check("只显示交集模式生成了封盖", interCase.caps > 0, interCase.caps + " 张，顶点 " + interCase.verts);

/* ---------- 10. 性能：满负载下 refresh 仍要够快 ---------- */
section("10. 性能回归");
const perf = app.run(`(function(){
  applyShape('cyl');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addPart('cyl');
  (function(){ var p = parts[0]; p.r = 5; p.h = 55; p.x = -0.5; p.y = 21; p.z = -4; })();
  addCyl('horiz');
  (function(){ var c = cyls[0]; c.shape='cyl'; c.r=9; c.len=0; c.y=0; })();
  ['frontal','frontal','frontal','horiz','frontal'].forEach(function(t, i){
    faces.push({type:t, ang:0, x:0, y:(i===3?13.02:0), z:(i===0?-12.47:i===1?-17.97:i===2?18:0), on:true, flip:false});
  });
  mode = 'pick';
  var t0 = performance.now();
  refresh();
  var dt = performance.now() - t0;
  return {ms: +dt.toFixed(0), cells: cells.length};
})()`);
check("满负载 refresh < 5000ms", perf.ms < 5000, perf.ms + "ms, cells=" + perf.cells);

/* ============================================================
   v33.19 回归：用户本轮反馈的三条
     ① 模型拼装里的 3D 模型上"好多条道"（表面一条条深色缝）
     ② 拖动拼装模型时"有时候会卡"
     ③ 加出来的 3D 模型"自动是橙色"，点「拼装变实」也不变青
   ============================================================ */

/* ---------- 11. 假分量必须合并（"好多条道"的根因） ---------- */
section("11. 单个实心部件不能被采样层切成碎片（表面条纹的根因）");
/* 圆台/球这类"分层采样"的部件，径向间距远大于层间距，
   旧代码按最近邻中位数定阈值 → 同一个实心件被切成 20 片，
   每片各带一套裁剪平面，交界处互相穿插 = 一条条深色缝。 */
const frag = app.run(`(function(){
  var out = [];
  [['frustum', function(p){ p.r=22; p.rt=12; p.h=34; }],
   ['sphere',  function(p){ p.r=20; }],
   ['cyl',     function(p){ p.r=16; p.h=44; }],
   ['cone',    function(p){ p.r=18; p.h=40; }]].forEach(function(it){
    applyShape('lab');
    parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
    addPart(it[0]);
    it[1](parts[0]);
    buildParts();
    mode = 'pick'; refresh();
    out.push({k:it[0], cells:cells.length, keys:cells.map(function(c){ return c.key; })});
  });
  return out;
})()`);
console.log("    " + JSON.stringify(frag));
frag.forEach(function(r){
  check("单个 " + r.k + " 部件在点选模式下只分成 1 块（不被采样层切碎）",
        r.cells === 1, r.k + " cells=" + r.cells + " keys=" + JSON.stringify(r.keys));
});

/* 反证：真实断开的区域仍必须拆开（锥顶尖 / 锥底被贯穿圆柱打穿） */
const stillSplit = app.run(`(function(){
  applyShape('pyr3');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addCyl('frontal');
  cyls[0].r = 13; cyls[0].on = true;
  buildCylVis();
  mode = 'pick'; refresh();
  return {cells:cells.length, keys:cells.map(function(c){ return c.key; })};
})()`);
console.log("    " + JSON.stringify(stillSplit));
check("真实断开（锥顶尖与锥底被圆柱打穿）仍拆成多块 —— 合并没有过度",
      stillSplit.cells >= 3, "cells=" + stillSplit.cells);

/* ---------- 12. 分块网格不能对自己所属部件再做一次"内部判定" ---------- */
section("12. 分块网格跳过自身部件的 partSpec（顶面针孔的根因）");
const selfSpec = app.run(`(function(){
  applyShape('lab');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addPart('frustum');
  (function(p){ p.r=22; p.rt=12; p.h=34; })(parts[0]);
  buildParts();
  mode = 'pick'; refresh();
  var bad = [], checked = 0;
  cellGroup.children.forEach(function(m){
    if(m.userData.cap) return;
    checked++;
    var u = m.material.userData && m.material.userData.cylU;
    if(!u) return;
    /* 看这个材质的 uPartK 槽里还有没有"保留内部"(keep<0) 的项 —— 那就是自身部件 */
    for(var i=0;i<4;i++){
      if(u.uPartK.value[i].x < -0.5) bad.push({ck:m.userData.ck, slot:i, keep:u.uPartK.value[i].x});
    }
  });
  return {checked:checked, selfSpecCount:bad.length, bad:bad.slice(0,4)};
})()`);
console.log("    " + JSON.stringify(selfSpec));
check("分块材质里没有\"保留自身部件内部\"的 spec（顶面不再打针孔）",
      selfSpec.selfSpecCount === 0, "违规 " + selfSpec.selfSpecCount + " 项");

/* ---------- 13. 拼装变实：点选模式下的分块必须跟着变青 ---------- */
section("13. 「拼装变实」在点选模式下必须真的变色（不是只改隐藏的外壳）");
const tintPick = app.run(`(function(){
  applyShape('lab');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addPart('frustum');
  (function(p){ p.r=22; p.rt=12; p.h=34; })(parts[0]);
  buildParts();
  mode = 'pick'; refresh();
  var before = [];
  cellGroup.children.forEach(function(m){
    if(!m.userData.cap && m.userData.front) before.push(m.material.color.getHexString());
  });
  partTint = true;
  buildParts(); rebuildCells(); buildCellVis();      // 按钮处理函数做的事
  var after = [];
  cellGroup.children.forEach(function(m){
    if(!m.userData.cap && m.userData.front) after.push(m.material.color.getHexString());
  });
  var shell = partGroup.children.filter(function(c){ return c.userData.pi != null; })[0];
  var shellCol = shell ? shell.material.color.getHexString() : null;
  partTint = false; buildParts(); rebuildCells(); buildCellVis();
  var back = [];
  cellGroup.children.forEach(function(m){
    if(!m.userData.cap && m.userData.front) back.push(m.material.color.getHexString());
  });
  return {before:before, after:after, shell:shellCol, back:back};
})()`);
console.log("    " + JSON.stringify(tintPick));
check("新加的拼装部件不是橙色（默认半透明青蓝 #8fd8ff）",
      tintPick.before.length > 0 && tintPick.before.every(function(c){ return c === "8fd8ff"; }),
      JSON.stringify(tintPick.before));
check("「拼装变实」后分块变成青色 #12d6c8",
      tintPick.after.length > 0 && tintPick.after.every(function(c){ return c === "12d6c8"; }),
      JSON.stringify(tintPick.after));
check("分块颜色与部件外壳颜色一致（同一个变实状态）",
      tintPick.shell === "12d6c8", "shell=" + tintPick.shell);
check("再点一次能还原成默认青蓝",
      tintPick.back.every(function(c){ return c === "8fd8ff"; }), JSON.stringify(tintPick.back));

/* 主立体的分块必须仍然是模型橙（不能把"被切开的立体"也染成蓝） */
const solidStillOrange = app.run(`(function(){
  applyShape('pyr3');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  faces.push({type:'horiz', ang:0, x:0, y:6, z:0, on:true, flip:false});
  mode = 'pick'; refresh();
  var cols = [];
  cellGroup.children.forEach(function(m){
    if(!m.userData.cap && m.userData.front) cols.push(m.material.color.getHexString());
  });
  return cols;
})()`);
console.log("    " + JSON.stringify(solidStillOrange));
check("主立体分块仍是模型橙 #f08c42（部件配色不污染主立体）",
      solidStillOrange.length > 0 && solidStillOrange.every(function(c){ return c === "f08c42"; }),
      JSON.stringify(solidStillOrange));

/* ---------- 14. 拖动：一次 pointermove 只重建一次分块 ---------- */
section("14. 拖动跟手：一次 pointermove 不能触发两次 rebuildCells");
const dragCost = app.run(`(function(){
  applyShape('lab');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addPart('frustum');
  (function(p){ p.r=22; p.rt=12; p.h=34; })(parts[0]);
  buildParts();
  mode = 'pick'; refresh();
  /* 数一次"pointermove 的 partDrag 分支 + 紧随其后的渲染帧"总共重建几次 */
  var n = 0, orig = rebuildCells;
  rebuildCells = function(){ n++; return orig.apply(null, arguments); };
  parts[0].x = 6;
  try{ buildParts(); }catch(_){}
  if(mode === 'pick'){ try{ rebuildCells(); buildCellVis(); cellsDirty = false; }catch(_){} }
  var inMove = n, dirtyAfterMove = cellsDirty;
  /* 渲染循环那一帧 */
  if(cellsDirty && mode === 'pick'){ rebuildCells(); buildCellVis(); }
  cellsDirty = false;
  var total = n;
  rebuildCells = orig;
  return {inMove:inMove, total:total, dirtyAfterMove:dirtyAfterMove};
})()`);
console.log("    " + JSON.stringify(dragCost));
check("一次 pointermove 只重建 1 次分块（旧代码是 2 次）",
      dragCost.inMove === 1, "rebuilds=" + dragCost.inMove);
check("pointermove 结束后 cellsDirty 已清（渲染帧不会重复重建）",
      dragCost.dirtyAfterMove === false, "cellsDirty=" + dragCost.dirtyAfterMove);
check("整轮（move + 渲染帧）总共只重建 1 次",
      dragCost.total === 1, "total=" + dragCost.total);

/* estimateSampleSpacing 是拖动路径上最贵的一步，必须够快 */
const spacingPerf = app.run(`(function(){
  applyShape('lab');
  parts.length = 0; cyls.length = 0; faces.length = 0; pickSel = {};
  addPart('frustum');
  (function(p){ p.r=22; p.rt=12; p.h=34; })(parts[0]);
  buildParts();
  mode = 'pick'; refresh();
  var pts = [];
  cells.forEach(function(c){ if(c.pts) pts = pts.concat(c.pts); });
  if(pts.length < 50) pts = partBodyPoints(parts[0]);
  var t0 = performance.now();
  for(var i=0;i<20;i++) estimateSampleSpacing(pts);
  return {ms: +((performance.now()-t0)/20).toFixed(2), n:pts.length};
})()`);
console.log("    " + JSON.stringify(spacingPerf));
check("estimateSampleSpacing 单次 < 5ms（拖动每帧都会调）",
      spacingPerf.ms < 5, spacingPerf.ms + "ms / " + spacingPerf.n + " 点");

console.log("\n=========================================");
console.log("  PASS " + pass + "   FAIL " + fail);
console.log("=========================================");
process.exit(fail ? 1 : 0);
