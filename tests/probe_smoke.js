#!/usr/bin/env node
/**
 * test/probe_smoke.js —— 最小冒烟探针。
 *
 *   node test/probe_smoke.js
 *
 * 做三件事：boot → addPart('cone') → buildParts()，然后打印
 *   · partGroup.children 的数量
 *   · 每个子物体材质的颜色 hex
 *   · 每个子物体的 type
 *
 * 用来快速确认"harness 能跑 + 拼装部件能建出来"。
 */

'use strict';

const { boot } = require('./harness');

function main() {
  const app = boot();

  console.log('');
  console.log('probe_smoke — p1.html @ ' + app.htmlMtime.toISOString() +
    ' (' + app.htmlBytes + ' bytes)');
  console.log('  THREE r' + (app.THREE && app.THREE.REVISION) +
    '   shape=' + app.shape + '   mode=' + app.mode);

  /* 干净起步 */
  app.applyShape('cone');
  console.log('');
  console.log('  after applyShape("cone") : parts=' + app.parts.length +
    '  partGroup.children=' + (app.partGroup ? app.partGroup.children.length : 'null'));

  /* 加一个圆锥部件 */
  app.addPart('cone');
  app.buildParts();

  const group = app.partGroup;
  const children = group ? group.children : [];

  console.log('');
  console.log('  addPart("cone") + buildParts()');
  console.log('  partGroup.children.length = ' + children.length);
  console.log('');

  children.forEach(function (c, i) {
    let hex = 'n/a';
    try {
      hex = c.material.color.getHexString();
    } catch (e) {
      hex = 'ERR:' + e.message;
    }
    console.log('    [' + i + '] type=' + String(c.type).padEnd(13) +
      ' color=#' + hex +
      '  transparent=' + (c.material ? c.material.transparent : '?') +
      '  opacity=' + (c.material ? c.material.opacity : '?') +
      '  userData.pi=' + (c.userData && c.userData.pi != null ? c.userData.pi : '-'));
  });

  console.log('');
  console.log('  partGroup.children.map(c => c.type) =');
  console.log('    ' + JSON.stringify(children.map(function (c) { return c.type; })));
  console.log('');
  console.log('  partGroup.children.map(c => "#" + c.material.color.getHexString()) =');
  console.log('    ' + JSON.stringify(children.map(function (c) {
    try { return '#' + c.material.color.getHexString(); } catch (e) { return 'ERR'; }
  })));

  /* 基本自洽检查 */
  const meshes = children.filter(function (c) { return c.isMesh; });
  const segs = children.filter(function (c) { return c.type === 'LineSegments'; });
  const ok = children.length === 2 && meshes.length === 1 && segs.length === 1;

  console.log('');
  console.log('  Mesh=' + meshes.length + '  LineSegments=' + segs.length +
    '  →  ' + (ok ? 'SMOKE OK' : 'SMOKE UNEXPECTED'));
  console.log('');

  if (!ok) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { main: main };
