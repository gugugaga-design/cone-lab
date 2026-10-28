/* 同进程内依次运行全部无头套件。
   本机沙箱禁止 node 派生子进程（EPERM），所以不能用 child_process；
   套件都是同步脚本且各自独立 boot 一个 app 实例，这里用 vm 隔离逐个执行，
   拦截 process.exit 以收集结果。
   用法: node test2/runall.js */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.resolve(__dirname, "..");
/* 仓库目录结构：测试都在 tests/ 下（tests/test3/ 是独立 harness）。
   早期版本这里写的是工作区的 test2/ 前缀，仓库里没有该目录 → 直接 ENOENT。 */
const SUITES = [
  ["tests/accept.js",   "四项需求验收"],
  ["tests/edge.js",     "边界/退化/性能"],
  ["tests/regions.js",  "分区数=几何分区数"],
  ["tests/curves.js",   "相贯线几何精度"],
  ["tests/cellgeo.js",  "分块裁剪互斥完备"],
  ["tests/cylpick.js",  "相贯体裁切点选"],
  ["tests/tintpick.js", "贯体变实+点选遮挡"],
  ["tests/eventflow.js","真实DOM事件流点选"],
  ["tests/pickfix.js",  "点选中空/伸出段/移动残留"],
  ["tests/verify.js",   "独立 harness #1"],
  ["tests/test3/regions.js", "独立 harness #2"],
];

let fail = 0;
SUITES.forEach(function(s){
  const file = path.join(ROOT, s[0]);
  const code = fs.readFileSync(file, "utf8");
  const captured = { lines: [], exitCode: 0, killed: false };
  const sandbox = {
    require: function(id){
      // 相对路径按该套件所在目录解析
      if(id.startsWith(".")) return require(path.resolve(path.dirname(file), id));
      return require(id);
    },
    console: {
      log: function(){ captured.lines.push(Array.prototype.join.call(arguments, " ")); },
      error: function(){ captured.lines.push(Array.prototype.join.call(arguments, " ")); },
      warn: function(){ captured.lines.push(Array.prototype.join.call(arguments, " ")); },
    },
    process: {
      argv: process.argv,
      exit: function(c){ captured.exitCode = c || 0; captured.killed = true; throw new Error("__EXIT__"); },
      env: process.env,
    },
    __dirname: path.dirname(file),
    __filename: file,
    module: { exports: {} },
    exports: {},
    setTimeout: setTimeout, clearTimeout: clearTimeout, setInterval: setInterval, clearInterval: clearInterval,
    Buffer: Buffer, JSON: JSON, Math: Math, Date: Date, Object: Object,
    Array: Array, String: String, Number: Number, Error: Error, RegExp: RegExp,
    isFinite: isFinite, parseFloat: parseFloat, parseInt: parseInt,
  };
  sandbox.global = sandbox; sandbox.globalThis = sandbox;
  let ok = true, note = "";
  try {
    vm.runInNewContext(code, sandbox, { filename: s[0] });
  } catch(e){
    if(String(e.message).indexOf("__EXIT__") >= 0){ ok = (captured.exitCode === 0); }
    else { ok = false; note = e.message.split("\n")[0].slice(0, 90); }
  }
  const last = captured.lines.filter(function(l){ return l.trim(); }).slice(-2).join(" | ");
  if(!ok) fail++;
  console.log((ok ? "PASS  " : "FAIL  ") + s[0].padEnd(20) + s[1].padEnd(18) +
              "  " + (note || last).slice(0, 100));
});
console.log("\n" + (fail === 0 ? "全部 " + SUITES.length + " 套件通过" : fail + " 套件失败"));
process.exit(fail ? 1 : 0);
