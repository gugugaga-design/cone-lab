/* ============================================================================
   test3/selftest.js — proves test3/regions.js has TEETH.

   Copies the CURRENT src/index.html into test3/.fixture/, reverts the exact
   behaviour the user complained about, and checks that the suite turns FAIL.

   Mutations (each in its own fixture, applied independently):
     A) part code back to plain inside/outside (0/1) instead of the 4-value code
        -> the apex and the base of a pyramid cut by a box get the SAME key,
           they merge into one cell, and hiding "the apex" hides the whole solid
           -> scenarios 6/7 must FAIL.
     B) parts excluded from the cell key entirely (pre-v33 behaviour)
        -> a box part never splits the main solid
           -> scenarios 4/6 must FAIL.

   src/index.html is only ever READ.  Runs the suite in-process (no child
   processes, so it works under the file sandbox).

   Run:
     "C:/Users/Lenovo/.workbuddy-ai/binaries/node/versions/22.22.2-6/node.exe" test3/selftest.js
   ============================================================================ */
"use strict";

const fs = require("fs");
const path = require("path");
const { runSuite } = require("./regions");

const ROOT = path.resolve(__dirname, "..");
const APP = path.join(ROOT, "src/index.html");
const FIXDIR = path.join(__dirname, ".fixture");

if(!fs.existsSync(FIXDIR)) fs.mkdirSync(FIXDIR, { recursive: true });
const src = fs.readFileSync(APP, "utf8");

/* ---- mutation A: part code -> binary inside/outside --------------------- */
function mutateA(html){
  const needle = /function partCodeAt\(pr, p\)\{[\s\S]*?\n\}/;
  if(!needle.test(html)) throw new Error("mutation A: partCodeAt() not found (app internals changed)");
  return html.replace(needle,
    "function partCodeAt(pr, p){\n" +
    "  return insidePartWorld(pr, p) ? 3 : 0;   /* MUTATED: binary in/out */\n" +
    "}");
}

/* ---- mutation B: parts do not participate in the cell key at all -------- */
function mutateB(html){
  const needle = /for\(var n=0; n<ps\.length; n\+\+\)\{[\s\S]*?pbits\.push\("p" \+ pr\._id \+ ":" \+ partCodeAt\(pr, p\)\);\s*\n\s*\}/;
  if(!needle.test(html)) throw new Error("mutation B: pbits loop not found (app internals changed)");
  return html.replace(needle, "/* MUTATED: parts excluded from the cell key */");
}

/* ---- build fixtures ---------------------------------------------------- */
const fixtures = [];
function makeFixture(tag, fn){
  const out = path.join(FIXDIR, "p1_" + tag + ".html");
  fs.writeFileSync(out, fn(src), "utf8");
  fixtures.push({ tag: tag, file: out });
  console.log("fixture " + tag + " -> " + path.relative(ROOT, out) +
              "  (" + fs.statSync(out).size + " bytes)");
}
try{
  makeFixture("mutationA", mutateA);
  makeFixture("mutationB", mutateB);
}catch(e){
  console.error("could not build fixtures: " + e.message);
  process.exit(2);
}

/* ---- control: the real app must pass ----------------------------------- */
console.log("");
console.log("=== control: real app must PASS ===");
const control = runSuite({ quiet: true });
control.results.forEach(function(r){
  console.log("  [" + r.id + "] cells=" + (r.err ? "-" : r.cellsN) +
              " regions=" + (r.err ? "-" : r.geoN) + "  " + r.verdict);
});
console.log("  -> " + control.pass + " pass / " + control.fail + " fail" +
            (control.fail === 0 ? "  (as expected)" : "  !! expected 0 failures"));

let bad = 0;
fixtures.forEach(function(f){
  console.log("");
  console.log("=== " + f.tag + ": suite must FAIL ===");
  const r = runSuite({ html: f.file, quiet: true });
  r.results.forEach(function(rec){
    console.log("  [" + rec.id + "] cells=" + (rec.err ? "-" : rec.cellsN) +
                " regions=" + (rec.err ? "-" : rec.geoN) + "  " + rec.verdict);
  });
  const caught = r.fail > 0;
  console.log("  -> " + r.pass + " pass / " + r.fail + " fail" +
              (caught ? "  (defect detected, good)" : "  !! BUG NOT DETECTED"));
  if(!caught) bad++;
});

console.log("");
if(control.fail !== 0){ console.log("SELFTEST FAILED: the real app did not pass"); process.exit(1); }
if(bad){ console.log("SELFTEST FAILED: " + bad + " mutation(s) went undetected"); process.exit(1); }
console.log("SELFTEST OK: control passes, every injected defect is caught.");
process.exit(0);
