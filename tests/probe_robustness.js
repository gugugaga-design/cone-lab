#!/usr/bin/env node
/**
 * test/probe_robustness.js —— 证明 harness 对 p1.html 的变化是鲁棒的。
 *
 * 做法：把当前 p1.html 读进来，在**内存里**做几种破坏性改动，
 * 写到 test/_tmp_variant.html，再用 harness.boot({htmlPath}) 去 boot 它。
 * 原始 src/index.html 一个字节都不动。
 *
 * 验证点：
 *   1. 新增一个顶层 var → 自动被 __APP 捕获（不用改 harness）
 *   2. 删掉一个真实存在的 id（getElementById 返回 null）→ boot 不崩，且记录在 autoCreatedIds
 *   3. 删掉 inline script 里的某个函数 → 对应 key 记成 missing，其余照常
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { boot, DEFAULT_HTML } = require('./harness');

const TMP = path.join(__dirname, '_tmp_variant.html');
const WEB_DIR = path.dirname(DEFAULT_HTML);

function writeVariant(html, mutate) {
  fs.writeFileSync(TMP, mutate(html), 'utf8');
}

function run(label, mutate) {
  const base = fs.readFileSync(DEFAULT_HTML, 'utf8');
  writeVariant(base, mutate);
  try {
    /* 变体 HTML 在 test/ 下，但它的 <script src="lib/..."> 是相对 assets/web 的，
       所以用 libBase 指回去（等价于浏览器里"HTML 还在 assets/web"）。 */
    const app = boot({ htmlPath: TMP, libBase: WEB_DIR });
    return { ok: true, app: app };
  } catch (e) {
    return { ok: false, error: e };
  }
}

function main() {
  let pass = 0, fail = 0;
  function check(label, ok, detail) {
    console.log((ok ? '  ok  | ' : ' FAIL | ') + label + (detail ? '  →  ' + detail : ''));
    ok ? pass++ : fail++;
  }

  console.log('');
  console.log('probe_robustness — boot 变体 HTML（原始 p1.html 不被修改）');
  console.log('');

  /* ---- 1. 新增顶层 var ---- */
  {
    const r = run('add var', function (html) {
      return html.replace('var TYPES = {', 'var HARNESS_PROBE_MARK = 12345;\nvar TYPES = {');
    });
    check('新增顶层 var 后仍能 boot', r.ok, r.ok ? '' : r.error.message);
    if (r.ok) {
      check('新增的顶层 var 被自动捕获进 __APP',
        r.app.present('HARNESS_PROBE_MARK') && r.app.HARNESS_PROBE_MARK === 12345,
        'HARNESS_PROBE_MARK=' + r.app.HARNESS_PROBE_MARK);
      check('原有 key 依然齐全', r.app.present('parts') && r.app.present('buildParts'),
        'keys=' + Object.keys(r.app.__APP).length);
    }
  }

  /* ---- 2. 删掉一个真实 id ---- */
  {
    const r = run('drop id', function (html) {
      /* #panel 是**启动期**就会被 getElementById 拿的（var panelEl = ...） */
      return html.replace('id="panel"', 'id="panel_RENAMED"');
    });
    check('删掉启动期用到的 id 后 boot 不崩（宽容 DOM 兜底）', r.ok, r.ok ? '' : r.error.message);
    if (r.ok) {
      const auto = r.app.document.__autoIds;
      check('自动补建的 id 被记录（autoCreatedIds 非空）', auto.length > 0,
        'auto=' + JSON.stringify(auto));
      check('补建的 id 里包含 panel', auto.indexOf('panel') >= 0, JSON.stringify(auto));
      check('补建后 app 仍完整可用（refresh 不抛）', (function () {
        try { r.app.refresh(); return true; } catch (e) { return false; }
      })(), 'refresh() ok');
    }
  }

  /* ---- 3. 删掉一个函数声明 ---- */
  {
    const r = run('drop fn', function (html) {
      /* 把 partSolidCurves 改名 → 原名字在 IIFE 里不存在 */
      return html.replace(/function partSolidCurves\(ia\)/,
        'function partSolidCurves_RENAMED(ia)');
    });
    check('删掉函数声明后 boot 仍不崩', r.ok, r.ok ? '' : r.error.message);
    if (r.ok) {
      check('缺失的函数被记进 __missing',
        r.app.__missing.indexOf('partSolidCurves') >= 0,
        'missing=' + JSON.stringify(r.app.__missing));
      check('其余函数不受影响（buildParts 仍可用）',
        typeof r.app.buildParts === 'function', 'typeof buildParts=' + typeof r.app.buildParts);
    }
  }

  /* ---- 4. 每次 boot 都重新读盘 ---- */
  {
    const base = fs.readFileSync(DEFAULT_HTML, 'utf8');
    writeVariant(base, function (h) {
      return h.replace('var TYPES = {', 'var REREAD_MARK = "first";\nvar TYPES = {');
    });
    const a1 = boot({ htmlPath: TMP, libBase: WEB_DIR });
    writeVariant(base, function (h) {
      return h.replace('var TYPES = {', 'var REREAD_MARK = "second";\nvar TYPES = {');
    });
    const a2 = boot({ htmlPath: TMP, libBase: WEB_DIR });
    check('同一路径第二次 boot 读到的是新内容（不缓存）',
      a1.REREAD_MARK === 'first' && a2.REREAD_MARK === 'second',
      a1.REREAD_MARK + ' → ' + a2.REREAD_MARK);
  }

  try { fs.unlinkSync(TMP); } catch (e) {}

  console.log('');
  console.log('  ' + pass + '/' + (pass + fail) + ' passed');
  console.log('');
  console.log(fail === 0 ? 'ROBUSTNESS OK' : 'ROBUSTNESS FAIL');
  if (fail) process.exitCode = 1;
}

if (require.main === module) main();
