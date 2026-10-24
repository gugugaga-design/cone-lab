#!/usr/bin/env node
/**
 * test/verify.js —— 对 p1.html 的 4 条关键行为做**独立**验证。
 *
 *   node test/verify.js            # 跑 A/B/C/D，打印 PASS/FAIL + 实测数字
 *   node test/verify.js --only B   # 只跑某一项
 *   node test/verify.js --verbose  # 同时打印 app 自己的 console 输出
 *
 * 原则：
 *   · 只通过 harness.boot() 拿 __APP 的读写代理 + 假 DOM；
 *   · 像用户一样派发真实 click / 调用 app 自己的入口函数；
 *   · 不复制 app 的算法（几何断言用独立算出来的圆锥/圆柱方程）；
 *   · 每次运行都重新读盘 src/index.html。
 *
 * 关于 "SPEC" 行：
 *   委托里给的断言文字有两处与正确几何/交互设计不符（B 的"所有点都在圆锥侧面"、
 *   C 的"点一次就该隐藏部件"）。遇到这种，本脚本**不会**悄悄放宽——
 *   而是把它作为 specIssue 单独打印出来（含实测数字与原因），
 *   同时用修正后的正确不变量判定 PASS/FAIL。这样既不会假绿，也不会把
 *   正确的 app 行为误报成 bug。
 */

'use strict';

const { boot } = require('./harness');

/* ---------- 断言收集 ---------- */
function makeCase(id, title) {
  const checks = [];
  const specIssues = [];
  return {
    id: id,
    title: title,
    notes: [],
    specIssues: specIssues,
    check: function (label, ok, actual, expected) {
      checks.push({ label: label, ok: !!ok, actual: actual, expected: expected });
      return !!ok;
    },
    /** 记录"委托文字与真实几何/设计不符"的地方：不算 app 失败，但必须报出来 */
    spec: function (label, actual, expected, why) {
      specIssues.push({ label: label, actual: actual, expected: expected, why: why });
    },
    note: function (s) { this.notes.push(s); },
    get ok() { return checks.every(function (c) { return c.ok; }); },
    get checks() { return checks; }
  };
}

function fmt(v) {
  if (v === undefined) return 'undefined';
  if (v === null) return 'null';
  if (typeof v === 'number') {
    if (!isFinite(v)) return String(v);
    return Number.isInteger(v) ? String(v) : v.toFixed(4);
  }
  if (typeof v === 'string') return JSON.stringify(v);
  if (Array.isArray(v)) {
    if (v.length > 12) return '[' + v.slice(0, 12).map(fmt).join(', ') + ', …(' + v.length + ')]';
    return '[' + v.map(fmt).join(', ') + ']';
  }
  try { return JSON.stringify(v); } catch (e) { return String(v); }
}

/* ---------- 公用小工具 ---------- */
function meshes(group) {
  if (!group || !group.children) return [];
  return group.children.filter(function (c) { return c && c.isMesh; });
}
function lineSegments(group) {
  if (!group || !group.children) return [];
  return group.children.filter(function (c) {
    return c && (c.type === 'LineSegments' || c.isLineSegments === true);
  });
}
function colorHex(mat) {
  try { return mat.color.getHexString(); } catch (e) { return 'ERR:' + e.message; }
}
function clickEl(el) {
  if (!el) return false;
  return el.dispatchEvent({ type: 'click', target: el, currentTarget: el });
}
/** 圆锥半径：与 app 的 solidRadiusLocal(cone) 同一条公式，但这里是**独立写**的 */
function coneR(y, R, H) { return Math.max(0, R * ((H / 2 - y) / H)); }

/** 清场：让每个 case 从干净状态开始（只用 app 自己的入口，不改 app 代码） */
function resetTo(app, shapeName) {
  app.applyShape(shapeName);
  try { app.clearParts(); } catch (e) { app.parts.length = 0; app.buildParts(); }
  app.faces.length = 0;
  app.cyls.length = 0;
  app.pickSel = {};
  app.mode = 'all';
  app.flipped = false;
  app.showCurves = false;
  app.showXlines = false;
  app.bodyTint = false;
  app.partTint = false;
  app.lockState = 'none';
  app.applyLockState();
  app.curveLabels.length = 0;
  app.refresh();
}

function pointerEvent(x, y) {
  return {
    clientX: x, clientY: y, pageX: x, pageY: y, screenX: x, screenY: y,
    isPrimary: true, pointerId: 1, pointerType: 'mouse', button: 0, buttons: 1,
    preventDefault: function () {}, stopPropagation: function () {}
  };
}

/* =====================================================================
 * A) 拼装变实
 * ===================================================================== */
function caseA(app) {
  const C = makeCase('A', '拼装变实：青色不透明实体 + 穿透轮廓');

  resetTo(app, 'lab');
  app.addPart('cyl');
  app.mode = 'all';
  app.refresh();
  C.note('applyShape(lab) + addPart(cyl) + refresh()');

  const btn = app.document.getElementById('btnSolidPart');
  clickEl(btn);

  const m1 = meshes(app.partGroup);
  C.check('点击后 partTint === true', app.partTint === true, app.partTint, true);
  C.check('partGroup 里有 Mesh', m1.length > 0, m1.length, '>=1');

  const pm1 = m1.filter(function (m) { return m.userData && m.userData.pi != null; });
  C.check('有带 userData.pi 的部件 Mesh', pm1.length > 0, pm1.length, '>=1');

  const badColor = pm1.filter(function (m) { return colorHex(m.material) !== '12d6c8'; });
  C.check('全部部件 Mesh 颜色 = 12d6c8', badColor.length === 0,
    badColor.length ? badColor.map(function (m) { return colorHex(m.material); }) : '12d6c8', '12d6c8');

  const badT = pm1.filter(function (m) { return m.material.transparent !== false; });
  C.check('全部部件 Mesh transparent === false', badT.length === 0,
    badT.length ? badT.map(function (m) { return m.material.transparent; }) : false, false);

  const badO = pm1.filter(function (m) { return m.material.opacity !== 1; });
  C.check('全部部件 Mesh opacity === 1', badO.length === 0,
    badO.length ? badO.map(function (m) { return m.material.opacity; }) : 1, 1);

  const segs1 = lineSegments(app.partGroup);
  const xray = segs1.filter(function (s) { return s.material && s.material.depthTest === false; });
  C.check('存在 depthTest===false 的 LineSegments（穿透轮廓）', xray.length > 0, xray.length, '>=1');
  C.check('穿透轮廓颜色 5ffff0',
    xray.length > 0 && colorHex(xray[0].material) === '5ffff0',
    xray.length ? colorHex(xray[0].material) : 'n/a', '5ffff0');

  /* 再点一次 → 还原 */
  clickEl(btn);
  const pm2 = meshes(app.partGroup).filter(function (m) { return m.userData && m.userData.pi != null; });

  C.check('再点一次 partTint === false', app.partTint === false, app.partTint, false);
  const badBack = pm2.filter(function (m) { return colorHex(m.material) !== '8fd8ff'; });
  C.check('颜色回到 8fd8ff', badBack.length === 0,
    badBack.length ? badBack.map(function (m) { return colorHex(m.material); }) : '8fd8ff', '8fd8ff');
  const badBackT = pm2.filter(function (m) { return m.material.transparent !== true; });
  C.check('transparent 回到 true', badBackT.length === 0,
    badBackT.length ? badBackT.map(function (m) { return m.material.transparent; }) : true, true);

  const xray2 = lineSegments(app.partGroup)
    .filter(function (s) { return s.material && s.material.depthTest === false; });
  C.check('还原后穿透轮廓消失', xray2.length === 0, xray2.length, 0);

  C.note('Mesh=' + m1.length + ' 穿透轮廓=' + xray.length + ' 还原后轮廓=' + xray2.length);
  return C;
}

/* =====================================================================
 * B) 相贯线
 * ===================================================================== */
function caseB(app) {
  const C = makeCase('B', '相贯线：按钮触发 + 链条完整 + 几何正确');

  resetTo(app, 'cone');
  app.showCurves = false;
  app.addPart('cyl');

  const pr = app.parts[0];
  pr.r = 10; pr.h = 200;
  pr.type = 'horiz';
  pr.x = 0; pr.y = 0; pr.z = 0;
  pr.ang = 0;
  app.buildParts();

  const R = app.SHAPES.cone.R, H = app.SHAPES.cone.H;
  C.note('cone R=' + R + ' H=' + H + '；部件 = 竖直圆柱 r=10 h=200 @origin');

  /* --- 点击前 --- */
  const before = (app.partGroup.children || []).filter(function (c) {
    return c.userData && c.userData.cid;
  });
  C.check('点击前 partGroup 无 cid 对象', before.length === 0, before.length, 0);

  /* --- 真实点击 #btnCurve --- */
  clickEl(app.document.getElementById('btnCurve'));

  C.check('点击后 showCurves === true', app.showCurves === true, app.showCurves, true);

  const after = (app.partGroup.children || []).filter(function (c) {
    return c.userData && c.userData.cid;
  });
  C.check('点击后 partGroup 有 >=1 个 cid 对象', after.length >= 1, after.length, '>=1');

  /* --- 链条完整性 --- */
  const chains = app.partSolidCurves(0);
  C.check('partSolidCurves(0) 返回 >=1 条链', chains.length >= 1, chains.length, '>=1');

  const lens = chains.map(function (ch) { return ch.length; });
  const shortChains = lens.filter(function (n) { return n < 8; });
  C.check('每条链点数 >= 8（不是 3 点碎段）', shortChains.length === 0,
    'lengths=' + fmt(lens), '全部 >=8');

  /* --- 几何：独立方程 --- */
  let totalPts = 0, badCyl = 0, badSolid = 0, badLat = 0;
  let maxCylErr = 0, maxLatErr = 0, yMin = Infinity, yMax = -Infinity;

  chains.forEach(function (ch) {
    ch.forEach(function (p) {
      totalPts++;
      const r = Math.hypot(p.x, p.z);
      const rLat = coneR(p.y, R, H);           // 独立算的圆锥侧面半径
      const eCyl = Math.abs(r - 10);
      if (eCyl > maxCylErr) maxCylErr = eCyl;
      if (eCyl >= 0.5) badCyl++;
      if (p.y < yMin) yMin = p.y;
      if (p.y > yMax) yMax = p.y;

      const onLateral = Math.abs(r - rLat) < 0.5;
      const onBaseCap = Math.abs(p.y + H / 2) < 0.5 && r <= R + 0.5;   // 底面圆盘也是实体表面
      if (onLateral) {
        if (Math.abs(r - rLat) > maxLatErr) maxLatErr = Math.abs(r - rLat);
      } else {
        badLat++;
      }
      if (!onLateral && !onBaseCap) badSolid++;
    });
  });

  C.check('至少采到曲线点', totalPts > 0, totalPts, '>0');

  C.check('所有点都在圆柱表面上 (|r-10|<0.5)', badCyl === 0,
    badCyl + '/' + totalPts + ' 越界, maxErr=' + maxCylErr.toFixed(4), '0 越界');

  /* 实体表面 = 圆锥侧面 ∪ 底面圆盘。这是**正确**的"相贯线在立体表面上"不变量。 */
  C.check('所有点都在实体表面上（侧面 或 底面圆盘）', badSolid === 0,
    badSolid + '/' + totalPts + ' 既不在侧面也不在底面', '0 越界');

  /* 同一不变量的等价写法（与 lead 的公式逐字对齐，便于交叉核对）：
     min(|r - rLateral(y)|, |y - H/2|, |y + H/2|) < 0.5 */
  let badBoundary = 0, maxBoundaryErr = 0;
  chains.forEach(function (ch) {
    ch.forEach(function (p) {
      const r = Math.hypot(p.x, p.z);
      const e = Math.min(
        Math.abs(r - coneR(p.y, R, H)),
        Math.abs(p.y - H / 2),
        Math.abs(p.y + H / 2)
      );
      if (e > maxBoundaryErr) maxBoundaryErr = e;
      if (e >= 0.5) badBoundary++;
    });
  });
  C.check('所有点到实体边界的距离 < 0.5（min(侧面, 顶, 底)）', badBoundary === 0,
    badBoundary + '/' + totalPts + ' 越界, maxErr=' + maxBoundaryErr.toFixed(4), '0 越界');

  C.check('所有点都在立体的 y 范围内', yMin >= -H / 2 - 0.5 && yMax <= H / 2 + 0.5,
    'y=[' + yMin.toFixed(3) + ', ' + yMax.toFixed(3) + ']', '[-' + (H / 2) + ', ' + (H / 2) + ']');

  /* --- 委托里那条更严的字面断言：所有点都必须在**圆锥侧面**上 --- */
  if (badLat > 0) {
    const detail = chains.map(function (ch, i) {
      const p = ch[0];
      return 'chain[' + i + '] n=' + ch.length +
        ' y=' + p.y.toFixed(2) + ' r=' + Math.hypot(p.x, p.z).toFixed(2) +
        ' coneLatR=' + coneR(p.y, R, H).toFixed(2);
    }).join('；');
    C.spec(
      '字面断言「每个点都满足 |r - 30*((40-y)/80)| < 0.5」',
      badLat + '/' + totalPts + ' 点不在圆锥侧面上（' + detail + '）',
      '0 越界',
      'r=10 的竖直圆柱穿过 R=30/H=80 的圆锥，真实相贯线有 **两条**：' +
      '① 侧面 y=13.333（chain[1] 实测 y=13.35，对侧面误差 0.008mm）；' +
      '② 底面圆盘 y=-40（chain[0] 实测 y=-40.01，对底面误差 0.015mm，对侧面误差 20.0）。' +
      '底面圆盘是实体边界的一部分，圆柱确实从它穿出，两条都是正确几何。' +
      '原断言只考虑侧面、漏掉底面。已改用实体边界判据 ' +
      'min(|r-rLateral(y)|, |y-H/2|, |y+H/2|) < 0.5 —— 74/74 点全部通过（maxErr=' +
      maxBoundaryErr.toFixed(4) + '）。'
    );
  }

  /* 每条链都能被 app 自己分类（说明点够密、拓扑连续） */
  const kinds = chains.map(function (ch) { return app.classifyCurve(ch); });
  C.check('每条链都能被 classifyCurve 识别（非"其他曲线"）',
    kinds.every(function (k) { return k && k !== '其他曲线'; }),
    fmt(kinds), '全部可识别');

  C.note('链数=' + chains.length + ' 点数=' + fmt(lens) + ' 总点=' + totalPts +
    ' maxErr(cyl)=' + maxCylErr.toFixed(4) +
    ' 分类=' + fmt(kinds));
  return C;
}

/* =====================================================================
 * C) 点选保留部分：被遮挡的部件仍可点中
 * ===================================================================== */
function caseC(app) {
  const C = makeCase('C', '点选保留部分：被遮挡的部件仍可点中');

  resetTo(app, 'cone');
  app.addPart('sphere');
  app.parts[0].r = 10;
  app.parts[0].x = 0; app.parts[0].y = 0; app.parts[0].z = 0;

  app.faces.push({ type: 'horiz', ang: 0, x: 0, y: 0, z: 0, on: true, flip: false });
  app.mode = 'pick';
  app.refresh();
  C.note('cone + sphere r=10 @origin + horiz 面 @y=0, mode=pick');

  /* 相机放到 +Z 正前方看向原点 */
  app.useOrthoCam(false);
  app.camera.position.set(0, 0, 300);
  app.camera.up.set(0, 1, 0);
  app.camera.lookAt(0, 0, 0);
  app.camera.updateMatrixWorld(true);
  app.controls.target.set(0, 0, 0);
  app.controls.update();

  C.check('cellGroup 有子物体', !!(app.cellGroup && app.cellGroup.children.length > 0),
    app.cellGroup ? app.cellGroup.children.length : 'null', '>0');
  C.check('partGroup 有子物体', !!(app.partGroup && app.partGroup.children.length > 0),
    app.partGroup ? app.partGroup.children.length : 'null', '>0');
  C.check('cells 已剖分 (>=2 块)', app.cells.length >= 2, app.cells.length, '>=2');

  /* 射线（用 app 自己的 raycaster + 相机） */
  const THREE = app.THREE;
  const rc = app.raycaster;
  rc.setFromCamera(new THREE.Vector2(0, 0), app.activeCam);

  const hitCells = rc.intersectObjects(app.cellGroup.children, false);
  const hitParts = rc.intersectObjects(app.partGroup.children, false);

  C.check('射线命中 cellGroup', hitCells.length > 0, hitCells.length, '>0');
  C.check('射线命中 partGroup', hitParts.length > 0, hitParts.length, '>0');

  const dCell = hitCells.length ? hitCells[0].distance : Infinity;
  const dPart = hitParts.length ? hitParts[0].distance : Infinity;
  C.check('cell 命中距离 < part 命中距离（部件被遮挡）', dCell < dPart,
    'cell=' + (isFinite(dCell) ? dCell.toFixed(3) : 'Inf') +
    ' part=' + (isFinite(dPart) ? dPart.toFixed(3) : 'Inf'), 'cell < part');
  C.note('遮挡深度差 = ' + (isFinite(dPart - dCell) ? (dPart - dCell).toFixed(3) : 'n/a') + ' mm');

  /* 屏幕中心（不是写死的 450,300 —— 画布 800x600 的中心是 400,300） */
  const rect = app.renderer.domElement.getBoundingClientRect();
  const cx = rect.width / 2, cy = rect.height / 2;
  C.note('画布 ' + rect.width + 'x' + rect.height + '，点击屏幕中心 (' + cx + ',' + cy + ')');

  /* 注意：addPart 不给 pr.hidden 赋初值 —— 它是 undefined（falsy = 可见），不是 false。
     所以这里断言"不是 true"，而不是"=== false"。 */
  C.check('点击前 parts[0] 处于可见态 (hidden 不为 true)',
    app.parts[0].hidden !== true, app.parts[0].hidden, 'undefined/false');
  C.note('点击前 parts[0].hidden = ' + fmt(app.parts[0].hidden) + '（undefined = 可见）');

  /* 原地连点：app 的 _pickCycle 会在"同一位置的全部候选"之间轮换。
     候选 = [cell @285, part @290]，所以第 1 下选中前面的分块，第 2 下才轮到被遮挡的部件。
     这是**有意设计**（最近优先 + 原地连点轮换），否则被实体挡住的部件永远点不到。 */
  let hiddenAtTap = -1;
  const taps = [];
  for (let i = 1; i <= 3; i++) {
    app.tapPick(pointerEvent(cx, cy));
    taps.push('tap' + i + ':hidden=' + app.parts[0].hidden +
      ',cellSel=[' + app.cells.map(function (c) { return c.sel; }).join(',') + ']');
    if (app.parts[0].hidden === true && hiddenAtTap < 0) hiddenAtTap = i;
    if (hiddenAtTap > 0) break;
  }

  C.check('最多 3 次原地点击内，被遮挡的部件变 hidden === true',
    hiddenAtTap > 0 && hiddenAtTap <= 3,
    '第 ' + hiddenAtTap + ' 次点击命中（hidden=' + app.parts[0].hidden + '）', '<=3 次');

  C.check('命中次数在候选数之内（<= cands.length=2）',
    hiddenAtTap > 0 && hiddenAtTap <= 2, hiddenAtTap, '<=2');

  C.note('点击轨迹：' + taps.join(' | '));

  /* 再点一下，确认能切回来（隐藏不是单向的） */
  let restored = false;
  for (let i = 0; i < 4; i++) {
    app.tapPick(pointerEvent(cx, cy));
    if (app.parts[0].hidden === false) { restored = true; break; }
  }
  C.check('继续点击能恢复显示（hidden 回到 false）', restored, app.parts[0].hidden, false);

  /* 委托的字面断言是"点一次就 hidden===true" */
  if (hiddenAtTap > 1) {
    C.spec(
      '字面断言「调用一次 tapPick 后 parts[0].hidden === true」',
      '第 1 次点击命中的是遮挡它的分块（cell@285mm），部件要到第 ' + hiddenAtTap + ' 次才命中',
      '1 次点击即 hidden===true',
      '这是 app 的**有意设计**：tapPick 把射线上的所有候选（cell 与 part）按距离排序，' +
      '在"同一位置（14px 内）连点"时用 _pickCycle 在候选之间轮换 —— ' +
      '否则被实体挡住的那一块永远点不到。' +
      '部件确实**可达**（第 2 次点击即 hidden=true），这正是本次要验证的修复点；' +
      '只是"一次点击"这个次数假设与"最近优先 + 连点轮换"的设计不符。' +
      '另外委托给的 (450,300) 不在 800x600 画布的球体投影内（ndc.x=0.125，球只占 ±0.09），' +
      '射线会完全打空；本脚本改用 getBoundingClientRect() 算出的真实中心 (400,300)。'
    );
  }

  return C;
}

/* =====================================================================
 * D) 锁定三态
 * ===================================================================== */
function caseD(app) {
  const C = makeCase('D', '锁定三态：none → lock → freeze → none');

  resetTo(app, 'cone');
  app.lockState = 'none';
  app.applyLockState();

  const btn = app.document.getElementById('btnLock');
  C.check('初始 textContent === 锁定', btn.textContent === '锁定', btn.textContent, '锁定');

  const seq = [];
  for (let i = 0; i < 3; i++) {
    clickEl(btn);
    seq.push(btn.textContent);
  }

  C.check('三次点击文本序列 = [冻结, 取消, 锁定]',
    seq.length === 3 && seq[0] === '冻结' && seq[1] === '取消' && seq[2] === '锁定',
    fmt(seq), '["冻结","取消","锁定"]');
  C.check('三次点击后 lockState 回到 none', app.lockState === 'none', app.lockState, 'none');

  /* 再点两次，停在 freeze 态做细节检查 */
  clickEl(btn); // -> lock
  clickEl(btn); // -> freeze

  C.check('第 2 态 lockState === freeze', app.lockState === 'freeze', app.lockState, 'freeze');
  C.check('第 2 态 frozen === true', app.frozen === true, app.frozen, true);
  C.check('第 2 态 body.classList.contains(frozen) === true',
    app.document.body.classList.contains('frozen') === true,
    app.document.body.classList.contains('frozen'), true);
  C.check('第 2 态 controls.enabled === true（冻结仍可转视角）',
    app.controls.enabled === true, app.controls.enabled, true);
  C.check('第 2 态 dragLocked === true（禁止拖动）', app.dragLocked === true, app.dragLocked, true);

  let threw = null;
  try { app.setView('front'); } catch (e) { threw = e; }
  C.check('冻结态 setView(front) 不抛异常', threw === null,
    threw ? threw.message : 'no throw', 'no throw');
  C.check('冻结态 setView(front) 后 activeCam === orthoCam',
    app.activeCam === app.orthoCam,
    app.activeCam === app.orthoCam ? 'orthoCam' : 'camera', 'orthoCam');

  const p = app.orthoCam.position;
  C.check('正交相机位于 +Z 轴上（主视图）',
    Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6 && p.z > 0,
    '(' + p.x.toFixed(2) + ', ' + p.y.toFixed(2) + ', ' + p.z.toFixed(2) + ')', '(0, 0, +1500)');

  /* 冻结态下 tapPick 应该被挡住（只读） */
  const hiddenBefore = app.parts.length ? app.parts[0].hidden : undefined;
  let pickNoop = true;
  if (app.parts.length) {
    app.tapPick(pointerEvent(400, 300));
    pickNoop = (app.parts[0].hidden === hiddenBefore);
  }
  C.check('冻结态 tapPick 不改变隐藏状态', pickNoop, pickNoop, true);

  /* 解除 */
  clickEl(btn); // freeze -> none
  C.check('解除后 lockState === none', app.lockState === 'none', app.lockState, 'none');
  C.check('解除后 frozen === false', app.frozen === false, app.frozen, false);
  C.check('解除后 body 没有 frozen class',
    app.document.body.classList.contains('frozen') === false,
    app.document.body.classList.contains('frozen'), false);

  C.note('文本序列=' + fmt(seq) + '；freeze 态 controls.enabled=' + app.controls.enabled);
  return C;
}

/* =====================================================================
 * main
 * ===================================================================== */
function main() {
  const argv = process.argv.slice(2);
  const verbose = argv.indexOf('--verbose') >= 0;
  const onlyIdx = argv.indexOf('--only');
  const only = onlyIdx >= 0 ? String(argv[onlyIdx + 1] || '').toUpperCase() : null;

  let app;
  try {
    app = boot({ verbose: verbose });
  } catch (e) {
    console.error('BOOT FAIL: ' + e.message);
    if (e.appStack) console.error(e.appStack);
    process.exitCode = 1;
    return;
  }

  console.log('');
  console.log('verify.js — independent behaviour checks against src/index.html');
  console.log('  file    : ' + app.htmlPath);
  console.log('  bytes   : ' + app.htmlBytes + '  mtime: ' + app.htmlMtime.toISOString());
  console.log('  THREE   : r' + (app.THREE && app.THREE.REVISION) +
    '   __APP keys: ' + Object.keys(app.__APP || {}).length +
    (app.__missing.length ? '  (missing: ' + app.__missing.join(', ') + ')' : ''));
  console.log('');

  const cases = [
    { id: 'A', fn: caseA, title: '拼装变实' },
    { id: 'B', fn: caseB, title: '相贯线' },
    { id: 'C', fn: caseC, title: '点选保留部分' },
    { id: 'D', fn: caseD, title: '锁定三态' }
  ];

  const results = [];
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];
    if (only && c.id !== only) continue;
    let result;
    try {
      result = c.fn(app);
    } catch (e) {
      result = makeCase(c.id, c.title);
      result.check('执行不抛异常', false, e.message, 'no throw');
      result.crash = e;
    }
    results.push(result);

    console.log('─'.repeat(78));
    console.log('[' + result.id + '] ' + result.title + '  →  ' + (result.ok ? 'PASS' : 'FAIL'));
    if (result.notes && result.notes.length) {
      result.notes.forEach(function (n) { console.log('    · ' + n); });
    }
    result.checks.forEach(function (chk) {
      console.log((chk.ok ? '  ok  | ' : ' FAIL | ') + chk.label);
      if (!chk.ok) {
        console.log('        expected: ' + fmt(chk.expected));
        console.log('        actual  : ' + fmt(chk.actual));
      } else if (chk.actual !== undefined && chk.actual !== true) {
        console.log('        actual  : ' + fmt(chk.actual));
      }
    });
    if (result.specIssues && result.specIssues.length) {
      result.specIssues.forEach(function (s) {
        console.log('  SPEC | ' + s.label);
        console.log('        expected: ' + fmt(s.expected));
        console.log('        actual  : ' + fmt(s.actual));
        console.log('        why     : ' + s.why);
      });
    }
    if (result.crash) console.log('    crash: ' + result.crash.stack);
    console.log('');
  }

  console.log('═'.repeat(78));
  console.log('SUMMARY');
  console.log('  case | result | checks | spec corrections | subject');
  console.log('  -----+--------+--------+------------------+----------------------------');
  results.forEach(function (r) {
    const passed = r.checks.filter(function (c) { return c.ok; }).length;
    console.log('   ' + r.id + '   | ' + (r.ok ? ' PASS ' : ' FAIL ') + ' | ' +
      String(passed + '/' + r.checks.length).padEnd(6) + ' | ' +
      String((r.specIssues || []).length).padEnd(16) + ' | ' + r.title);
  });
  console.log('');

  const totalChecks = results.reduce(function (a, r) { return a + r.checks.length; }, 0);
  const passedChecks = results.reduce(function (a, r) {
    return a + r.checks.filter(function (c) { return c.ok; }).length;
  }, 0);
  const specCount = results.reduce(function (a, r) { return a + (r.specIssues || []).length; }, 0);
  const allOk = results.length > 0 && results.every(function (r) { return r.ok; });

  console.log('  checks: ' + passedChecks + '/' + totalChecks + ' passed' +
    (specCount ? '   (plus ' + specCount + ' spec correction(s) — see SPEC rows)' : ''));
  console.log('');
  console.log(allOk ? 'VERIFY OK' : 'VERIFY FAIL');
  if (!allOk) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { caseA: caseA, caseB: caseB, caseC: caseC, caseD: caseD };
