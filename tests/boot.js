/* Boot p1.html's inline script in Node with DOM + WebGL stubs.
   Usage:  const app = require('./boot').boot();   */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { makeDocument, FakeEl } = require("./dom");

const ROOT = path.resolve(__dirname, "..");
const HTML = path.join(ROOT, "src/index.html");
const THREEJS = path.join(ROOT, "src/lib/three.min.js");

function extractInline(html){
  // the inline block is the <script> with NO src attribute
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  const m = re.exec(html);
  if(!m) throw new Error("no inline <script> found");
  return m[1];
}

function stubRenderer(){
  const canvas = new FakeEl("canvas");
  canvas.id = "gl";
  canvas.width = 900; canvas.height = 600;
  function Renderer(){
    this.domElement = canvas;
    this.info = { render: {}, memory: { geometries: 0, textures: 0 } };
    this.capabilities = { isWebGL2: true, maxTextureSize: 4096, getMaxAnisotropy: function(){ return 1; } };
    this.shadowMap = { enabled: false, type: 0 };
    this.localClippingEnabled = false;
    this.outputColorSpace = "srgb";
    this.toneMapping = 0;
    this.autoClear = true;
    this._renderCount = 0;
    this.setSize = function(){};
    this.setPixelRatio = function(){};
    this.setClearColor = function(){};
    this.setClearAlpha = function(){};
    this.setViewport = function(){};
    this.setScissor = function(){};
    this.setScissorTest = function(){};
    this.clear = function(){};
    this.clearDepth = function(){};
    this.compile = function(){};
    this.dispose = function(){};
    this.setAnimationLoop = function(){};
    this.render = function(){ this._renderCount++; };
    this.getContext = function(){
      return {
        VERSION: "WebGL 2.0 (stub)",
        getParameter: function(){ return 4096; },
        getExtension: function(){ return null; },
        getShaderPrecisionFormat: function(){ return { precision: 23, rangeMin: 127, rangeMax: 127 }; },
        createTexture: function(){ return {}; },
        createBuffer: function(){ return {}; },
        getProgramParameter: function(){ return true; },
        getShaderParameter: function(){ return true; }
      };
    };
  }
  return Renderer;
}

function stubOrbitControls(){
  function OrbitControls(object, domElement){
    this.object = object;
    this.domElement = domElement;
    this.enabled = true;
    this.enableDamping = false;
    this.dampingFactor = 0.05;
    this.minDistance = 1;
    this.maxDistance = 5000;
    this.enablePan = true;
    this.enableZoom = true;
    this.enableRotate = true;
    this.target = new (require("./boot")._THREE().Vector3)();
    this._ls = {};
  }
  OrbitControls.prototype.addEventListener = function(t, fn){ (this._ls[t] = this._ls[t] || []).push(fn); };
  OrbitControls.prototype.removeEventListener = function(){};
  OrbitControls.prototype.update = function(){ return true; };
  OrbitControls.prototype.dispose = function(){};
  OrbitControls.prototype.saveState = function(){};
  OrbitControls.prototype.reset = function(){};
  return OrbitControls;
}

let _threeCache = null;
function _THREE(){ return _threeCache; }

function boot(opts){
  opts = opts || {};
  const htmlPath = opts.html || HTML;
  const html = fs.readFileSync(htmlPath, "utf8");
  const body = extractInline(html);

  const doc = makeDocument();

  // ---- sandbox globals ----
  /* v33.3：window 上的事件监听必须真的记下来 —— p1.html 把 pointerup/pointermove
     注册在 window 上（不是 canvas 上），stub 成空函数会导致"点了没反应"，
     测试就会误判为功能正常。这里实现一个最小可用的事件总线。 */
  const winListeners = {};
  const win = {
    innerWidth: 900,
    innerHeight: 640,
    devicePixelRatio: 2,
    addEventListener: function(t, fn){ (winListeners[t] = winListeners[t] || []).push(fn); },
    removeEventListener: function(t, fn){
      const a = winListeners[t]; if(!a) return;
      const i = a.indexOf(fn); if(i >= 0) a.splice(i, 1);
    },
    dispatchEvent: function(ev){
      const a = winListeners[ev.type] || [];
      for(let i=0;i<a.length;i++) a[i].call(win, ev);
      return true;
    },
    _listeners: winListeners,
    requestAnimationFrame: function(){ return 0; },
    cancelAnimationFrame: function(){},
    getComputedStyle: function(){ return { getPropertyValue: function(){ return ""; } }; },
    matchMedia: function(){ return { matches: false, addEventListener: function(){}, removeEventListener: function(){} }; },
    location: { href: "file:///android_asset/web/index.html", search: "", hash: "" },
    navigator: { userAgent: "node", vibrate: function(){} },
    localStorage: { getItem: function(){ return null; }, setItem: function(){}, removeItem: function(){} },
    performance: { now: function(){ return Date.now(); } },
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    setInterval: setInterval, clearInterval: clearInterval
  };

  const sandbox = {
    console: console,
    window: win,
    document: doc,
    navigator: win.navigator,
    location: win.location,
    localStorage: win.localStorage,
    performance: win.performance,
    setTimeout: setTimeout,
    clearTimeout: clearTimeout,
    setInterval: setInterval,
    clearInterval: clearInterval,
    requestAnimationFrame: win.requestAnimationFrame,
    cancelAnimationFrame: win.cancelAnimationFrame,
    ResizeObserver: function(cb){ this.observe = function(){}; this.disconnect = function(){}; this.unobserve = function(){}; },
    MutationObserver: function(cb){ this.observe = function(){}; this.disconnect = function(){}; },
    devicePixelRatio: 2,
    innerWidth: 900,
    innerHeight: 640,
    alert: function(){},
    Math: Math, JSON: JSON, Date: Date, Object: Object, Array: Array, Number: Number,
    String: String, Boolean: Boolean, RegExp: RegExp, Error: Error, isFinite: isFinite,
    parseFloat: parseFloat, parseInt: parseInt, Float32Array: Float32Array,
    Uint8Array: Uint8Array, Uint16Array: Uint16Array, Uint32Array: Uint32Array,
    Int32Array: Int32Array, Float64Array: Float64Array, Set: Set, Map: Map,
    Promise: Promise, Symbol: Symbol
  };
  sandbox.globalThis = sandbox;
  sandbox.self = win;
  win.document = doc;

  const ctx = vm.createContext(sandbox);

  // ---- load THREE (UMD; it attaches to `this`/global) ----
  const threeSrc = fs.readFileSync(THREEJS, "utf8");
  vm.runInContext(threeSrc, ctx, { filename: "three.min.js" });
  const THREE = ctx.THREE || sandbox.THREE;
  if(!THREE) throw new Error("THREE not found after loading three.min.js");
  _threeCache = THREE;

  // ---- replace renderer + controls ----
  THREE.WebGLRenderer = stubRenderer();
  THREE.OrbitControls = stubOrbitControls();
  sandbox.OrbitControls = THREE.OrbitControls;

  // ---- run app script ----
  // NOTE: p1.html wraps everything in an IIFE `(function(){ "use strict"; ... })();`
  // so nothing leaks to globals. We must inject the export hook INSIDE that IIFE,
  // right before its final `})();`.
  const trailer = opts.trailer === false ? "" : `
;globalThis.__RUN = function(code){ return eval(code); };
;globalThis.__GET = function(name){ return eval(name); };
;globalThis.__SET = function(name, val){ var __v = val; return eval(name + " = __v"); };
;globalThis.__APP = (function(){
  var names = ${JSON.stringify(opts.expose || [
    "parts","partTint","partMatSolid","partEdgeMatSolid","partMaterials","partGhostMaterials",
    "buildParts","partGroup","mode","cells","cellGroup","tapPick","applyLockState","lockState",
    "buildPartCurves","insidePartWorld","partSurfZeroChains","partPairCurves","partCylCurves",
    "partSolidCurves","cyls","addPart","buildCylVis","refresh","shape","SHAPES","setShapeGeom",
    "applyShape","showCurves","curveLabels","partGeoOf","partMatrix","partSurfPatches","scene",
    "THREE","solidRadiusLocal","insideSolidWorld","pickHiddenCount","renderPartList","commitUndo",
    "undoStack","faces","addCyl","cylAxis","cylPoint","cylMargin","partRot","PARTS","PARTS_MAX",
    "dragLocked","frozen","snapState","applySnapshot","snapTipText","renderer","camera","orthoCam",
    "activeCam","controls","setView","resetView","curveTagSprites","pickSel","bodyTint","showXlines",
    "buildCellVis","rebuildCells","pickAllBtn","activeCyls","bodyLen","cylSpecOf","disposeObj",
    "slotGeom","partDefaults","partGeo","densifyPolyline","makeCurveLabel","classifyCurve",
    "updatePickInfo","updatePickInfoText","updateHint","nextId","flipped","applyFlip","geo",
    "coneF","coneB","matFront","raycaster","ndcFromEvent","markView","curView","useOrthoCam",
    "setCylHighlightVisible","cylDecorVisible","endDrag","DRAG_THRESH","partDrag","cylDrag",
    "attachDrag","TYPES","rawNormal","faceNormalV","COLORS"
  ])}.filter(function(n){ try { return eval("typeof " + n) !== "undefined"; } catch(e){ return false; } });
  var o = {};
  names.forEach(function(n){ try { o[n] = eval(n); } catch(e){ o[n] = undefined; } });
  return o;
})();
`;

  // splice the trailer inside the IIFE, just before the closing `})();`
  let src;
  if(opts.trailer === false){
    src = body;
  } else {
    const closeIdx = body.lastIndexOf("})();");
    if(closeIdx < 0) throw new Error("could not find IIFE closer `})();` in inline script");
    src = body.slice(0, closeIdx) + "\n" + trailer + "\n" + body.slice(closeIdx);
  }
  vm.runInContext(src, ctx, { filename: "p1-inline.js" });

  const app = sandbox.__APP || (ctx.__APP);
  if(!app) throw new Error("__APP not populated");
  // live evaluator: runs INSIDE the app's IIFE, so it can read the app's locals
  // (they get reassigned constantly, e.g. parts = []; captured refs go stale)
  app.get = function(name){
    return sandbox.__GET(name);
  };
  app.run = function(code){
    return sandbox.__RUN(code);
  };
  app.set = function(name, val){
    return sandbox.__SET(name, val);
  };
  // also expose getters for the common state vars so `app.parts` is always fresh
  ["parts","partGroup","cyls","cells","cellGroup","mode","shape","partTint","bodyTint",
   "lockState","dragLocked","frozen","showCurves","showXlines","pickSel","undoStack","faces",
   "curveLabels","scene","flipped","geo","curView","partMatSolid","partEdgeMatSolid"].forEach(function(n){
    try{
      Object.defineProperty(app, n, {
        configurable: true,
        get: function(){ try { return app.get(n); } catch(e){ return undefined; } },
        set: function(v){ app.set(n, v); }
      });
    }catch(e){}
  });
  app.__sandbox = sandbox;
  app.__ctx = ctx;
  app.__doc = doc;
  app.__window = win;
  return app;
}

module.exports = { boot: boot, _THREE: _THREE };
