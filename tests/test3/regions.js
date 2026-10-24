/* ============================================================================
   test3/regions.js — INDEPENDENT verification of "点选保留部分" region counting
   ----------------------------------------------------------------------------
   For each scenario this script computes:

     (a) cells   = the app's own `cells.length`
     (b) regions = GEOMETRICALLY distinct regions, counted HERE by this file.
                   A region = a path-connected set of in-solid points that never
                   crosses a cutter surface.  On a lattice that is exactly a
                   connected component of points sharing one region signature:
                     signature = sign of every face plane (n·p - d)
                               | inside/outside every cyl  (my own lateral math)
                               | inside/outside every part (primitive insidePartLocal)
                   counted by 6-neighbour union-find over a 61^3 lattice.
                   This does NOT assume the app's key design is correct — it
                   only uses the cutters — so it can catch both over-merging
                   (one cell spanning two pieces: the user's complaint) and
                   over-splitting (a cell with no real geometry).
     (c) PASS when cells == regions.  Two diagnostic counts are printed too:
                   sigs = distinct signatures (may exceed regions when one
                          signature covers several disconnected pieces)
                   and the same with the brief's literal binary part bit.
   ============================================================================
   Independence contract
   ---------------------
   Only geometry primitives / cutter accessors are read from the app:
       SHAPES / shape / R / H / polyBox   — solid description
       insideCone(p)                      — "is this point in the main solid"
       insidePartLocal(pr, q)             — "is this local point in the part"
       partRot / partMatrix / partGeoOf   — part placement + local bbox
       activeFaceData/activeCyls/activeParts — the cutters themselves
   NOT used: rebuildCells(), samplePoints(), partBodyPoints(), cellKeyAt(),
   partCodeAt(), partSurfDist(), partAxisExtent() or any app enumeration /
   key-building / classification code.  Lattice, jitter, signature arithmetic,
   union-find, region counting and key formatting below are all ours.

   Run:
     "C:/Users/Lenovo/.workbuddy-ai/binaries/node/versions/22.22.2-6/node.exe" test3/regions.js
     add  --verbose   for signature census + component dumps
   Deterministic: fixed lattice + fixed-seed LCG jitter. No Math.random.
   ============================================================================ */
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const { boot } = require("../boot");

const ROOT = path.resolve(__dirname, "..");
/* REGIONS_HTML lets test3/selftest.js point the suite at a mutated copy of the
   app.  Normal runs use the real app; the override never modifies it. */
const APP = process.env.REGIONS_HTML
          ? path.resolve(process.env.REGIONS_HTML)
          : path.join(ROOT, "src/index.html");
const VERBOSE = process.argv.indexOf("--verbose") >= 0;

const N = 60;        // lattice cells per axis -> (N+1)^3 points per domain box
const MIN_PTS = 8;   // a region must own >= MIN_PTS sample points

function appFingerprintFor(file){
  const buf = fs.readFileSync(file);
  return { mtime: fs.statSync(file).mtime.toISOString(), size: buf.length,
           sha: crypto.createHash("sha1").update(buf).digest("hex").slice(0, 12) };
}

function j(x){ return JSON.stringify(x); }

/* ============================================================================
   THE INDEPENDENT ENUMERATION  (runs inside the app IIFE only to reach the
   geometry primitives; every algorithm below is written in this file)
   ============================================================================ */
const ENUM_CODE = `(function(){
  var N = ${N}, MINP = ${MIN_PTS};
  var act = activeFaceData();
  var cs  = activeCyls();
  var ps  = (typeof activeParts === "function")
              ? activeParts()
              : parts.filter(function(p){ return p.on !== false && !p.locked; });
  var S = SHAPES[shape], lab = !!S.lab, lying = !!S.lying, poly = !!S.poly;

  /* ---------- fixed-seed LCG jitter (never Math.random) -------------------- */
  var seed = 987654321 >>> 0;
  function rnd(){ seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }

  /* ---------- part axis + axial extent, computed here --------------------- */
  function partAxis(pr){ return new THREE.Vector3(0,1,0).applyQuaternion(partRot(pr)).normalize(); }
  function partExtent(pr){
    if(pr.k === "sphere") return [-pr.r, pr.r];
    if(pr.k === "hemi")   return [0, pr.r];
    if(pr.k === "box")    return [-pr.h/2, pr.h/2];
    if(pr.k === "cube")   return [-pr.a/2, pr.a/2];
    if(pr.k === "slot")   return [-pr.d/2, pr.d/2];
    return [-(pr.h||20)/2, (pr.h||20)/2];
  }
  var pinv = ps.map(function(pr){ return new THREE.Matrix4().copy(partMatrix(pr)).invert(); });
  var paxes = ps.map(partAxis);
  var pext  = ps.map(partExtent);
  var tmp = new THREE.Vector3();
  function partInside(i, x, y, z){
    tmp.set(x,y,z).applyMatrix4(pinv[i]);
    return !!insidePartLocal(ps[i], tmp);
  }
  function partCode(i, x, y, z){
    if(partInside(i,x,y,z)) return 3;
    var pr = ps[i], ax = paxes[i];
    var t = (x-pr.x)*ax.x + (y-pr.y)*ax.y + (z-pr.z)*ax.z;
    if(t > pext[i][1]) return 1;
    if(t < pext[i][0]) return 2;
    return 0;
  }

  /* ---------- cylinder lateral margin (own math) -------------------------- */
  function axisOf(c){
    var s = Math.sin(c.ang*Math.PI/180), co = Math.cos(c.ang*Math.PI/180);
    switch(c.type){
      case "frontal": return [0,0,1];
      case "horiz":   return [0,1,0];
      case "lat":     return [1,0,0];
      case "fv":      return [s,co,0];
      case "pv":      return [co,0,s];
      case "lv":      return [0,co,s];
    }
    return [0,0,1];
  }
  function cylMarginMine(c, x, y, z){
    var a = axisOf(c);
    var qx = x-c.x, qy = y-c.y, qz = z-c.z;
    var axl = qx*a[0] + qy*a[1] + qz*a[2];
    var wx = qx-a[0]*axl, wy = qy-a[1]*axl, wz = qz-a[2]*axl;
    var m;
    if(c.shape === "cyl"){
      m = c.r - Math.sqrt(wx*wx + wy*wy + wz*wz);
    } else {
      var U, V;
      if(Math.abs(a[2]) > 0.9){ U=[1,0,0]; V=[0,1,0]; }
      else if(Math.abs(a[1]) > 0.9){ U=[1,0,0]; V=[0,0,1]; }
      else if(Math.abs(a[0]) > 0.9){ U=[0,0,1]; V=[0,1,0]; }
      else {
        var ref = Math.abs(a[1]) < 0.9 ? [0,1,0] : [1,0,0];
        var ux = ref[1]*a[2]-ref[2]*a[1], uy = ref[2]*a[0]-ref[0]*a[2], uz = ref[0]*a[1]-ref[1]*a[0];
        var ul = Math.sqrt(ux*ux+uy*uy+uz*uz); ux/=ul; uy/=ul; uz/=ul;
        var vx = a[1]*uz-a[2]*uy, vy = a[2]*ux-a[0]*uz, vz = a[0]*uy-a[1]*ux;
        var vl = Math.sqrt(vx*vx+vy*vy+vz*vz); vx/=vl; vy/=vl; vz/=vl;
        U=[ux,uy,uz]; V=[vx,vy,vz];
      }
      var hw = (c.w||0)/2;
      var hh = (c.shape === "sq" ? (c.w||0) : (c.h||0))/2;
      m = Math.min(hw - Math.abs(wx*U[0]+wy*U[1]+wz*U[2]),
                   hh - Math.abs(wx*V[0]+wy*V[1]+wz*V[2]));
    }
    if(c.len > 0) m = Math.min(m, c.len/2 - Math.abs(axl));
    return m;
  }

  /* ---------- domain box -------------------------------------------------- */
  function partWorldBox(pr){
    var g = partGeoOf(pr); g.computeBoundingBox();
    var b = g.boundingBox, M = partMatrix(pr), V = new THREE.Vector3();
    var mn = [1e9,1e9,1e9], mx = [-1e9,-1e9,-1e9];
    for(var sx=0;sx<2;sx++) for(var sy=0;sy<2;sy++) for(var sz=0;sz<2;sz++){
      V.set(sx?b.max.x:b.min.x, sy?b.max.y:b.min.y, sz?b.max.z:b.min.z).applyMatrix4(M);
      if(V.x<mn[0])mn[0]=V.x; if(V.y<mn[1])mn[1]=V.y; if(V.z<mn[2])mn[2]=V.z;
      if(V.x>mx[0])mx[0]=V.x; if(V.y>mx[1])mx[1]=V.y; if(V.z>mx[2])mx[2]=V.z;
    }
    return {min:mn, max:mx};
  }
  var box;
  if(!lab){
    if(poly || lying){
      var pb = polyBox();
      box = {min:[pb.min.x,pb.min.y,pb.min.z], max:[pb.max.x,pb.max.y,pb.max.z]};
    } else box = {min:[-R,-H/2,-R], max:[R,H/2,R]};
  } else {
    if(!ps.length) return JSON.stringify({empty:true, lab:true, nFaces:act.length, nCyls:cs.length, nParts:0});
    box = {min:[1e9,1e9,1e9], max:[-1e9,-1e9,-1e9]};
    ps.forEach(function(pr){
      var b = partWorldBox(pr);
      for(var i=0;i<3;i++){ box.min[i]=Math.min(box.min[i],b.min[i]); box.max[i]=Math.max(box.max[i],b.max[i]); }
    });
  }
  var x0=box.min[0], y0=box.min[1], z0=box.min[2];
  var sx=(box.max[0]-x0)/N, sy=(box.max[1]-y0)/N, sz=(box.max[2]-z0)/N;
  if(!(sx>0 && sy>0 && sz>0)) return JSON.stringify({empty:true, lab:lab, nFaces:act.length, nCyls:cs.length, nParts:ps.length});

  var W = N+1, SL = W*W, M3 = W*W*W;

  /* ---------- pass 1: classify every in-solid lattice point --------------- */
  var sigBinIdx  = new Int32Array(M3).fill(-1);   // brief's binary signature
  var sigCodeIdx = new Int32Array(M3).fill(-1);   // 4-value part code signature
  var appIdx     = new Int32Array(M3).fill(-1);   // app-style formatted key
  var sigBinList = [], sigBinMap = new Map();
  var sigCodeList = [], sigCodeMap = new Map();
  var appList = [], appMap = new Map();
  var solidN = 0;

  function intern(list, map, s){
    var i = map.get(s);
    if(i === undefined){ i = list.length; list.push(s); map.set(s, i); }
    return i;
  }
  function classify(x, y, z){
    var fb = [], cb = [], pbBin = [], pbCode = [], fk = [], ck = [], pk = [];
    for(var i=0;i<act.length;i++){
      var v = act[i].nv.x*x + act[i].nv.y*y + act[i].nv.z*z - act[i].d;
      var b = v >= 0 ? 1 : 0;
      fb.push(b); fk.push("f" + act[i].id + ":" + b);
    }
    for(var k=0;k<cs.length;k++){
      var m = cylMarginMine(cs[k], x, y, z), b2 = m >= 0 ? 1 : 0;
      cb.push(b2); ck.push("c" + cs[k]._id + ":" + b2);
    }
    for(var n=0;n<ps.length;n++){
      var ins = partInside(n,x,y,z);
      pbBin.push(ins ? 1 : 0);
      var code = ins ? 3 : partCode(n,x,y,z);
      pbCode.push(code);
      pk.push("p" + ps[n]._id + ":" + code);
    }
    return {
      bin : fb.join("") + "|" + cb.join("") + "|" + pbBin.join(""),
      code: fb.join("") + "|" + cb.join("") + "|" + pbCode.join(""),
      app : fk.join(",") + "|" + ck.join(",") + "|" + pk.join(",")
    };
  }

  for(var i=0;i<=N;i++) for(var jj=0;jj<=N;jj++) for(var kk=0;kk<=N;kk++){
    var x = x0 + sx*(i  + 0.5*(rnd()-0.5));
    var y = y0 + sy*(jj + 0.5*(rnd()-0.5));
    var z = z0 + sz*(kk + 0.5*(rnd()-0.5));
    var inSolid;
    if(!lab) inSolid = insideCone(new THREE.Vector3(x,y,z));
    else {
      inSolid = false;
      for(var q=0;q<ps.length;q++) if(partInside(q,x,y,z)){ inSolid = true; break; }
    }
    if(!inSolid) continue;
    solidN++;
    var idx = (i*W + jj)*W + kk;
    var c = classify(x,y,z);
    sigBinIdx[idx]  = intern(sigBinList,  sigBinMap,  c.bin);
    sigCodeIdx[idx] = intern(sigCodeList, sigCodeMap, c.code);
    appIdx[idx]     = intern(appList,     appMap,     c.app);
  }

  /* ---------- pass 2: connected components -------------------------------
     6-neighbour union-find over the lattice, restricted to in-solid points.

     A "geometrically distinct region" is a path-connected component of the
     solid that never crosses a cutter surface.  On a lattice that is exactly:
     two points are in the same region iff they share a signature AND are
     connected through points of that same signature.  So the component count
     computed here (sameSig = true) IS the geometric ground truth — it does not
     assume the app's key design is right, it only uses the cutters.

     (sameSig = false is kept as a sanity probe: for a single connected solid
     it must collapse to 1 piece, which confirms the lattice is not fragmented
     by jitter artefacts.)
     ---------------------------------------------------------------------- */
  function componentsOf(sigIdx, sigList, sameSig){
    var par = new Int32Array(M3).fill(-1);
    for(var a=0;a<M3;a++) if(sigIdx[a] >= 0) par[a] = a;
    function find(a){ while(par[a] !== a){ par[a] = par[par[a]]; a = par[a]; } return a; }
    function link(a, b){
      if(sigIdx[b] < 0) return;
      if(sameSig && sigIdx[b] !== sigIdx[a]) return;
      var r1 = find(a), r2 = find(b); if(r1 !== r2) par[r2] = r1;
    }
    for(var b=0;b<M3;b++){
      if(sigIdx[b] < 0) continue;
      var kb = b % W, jb = ((b-kb)/W) % W, ib = (b-kb-jb*W)/(W*W);
      if(kb < N) link(b, b+1);
      if(jb < N) link(b, b+W);
      if(ib < N) link(b, b+SL);
    }
    var size = new Map(), rep = new Map();
    for(var d=0;d<M3;d++){
      if(sigIdx[d] < 0) continue;
      var r = find(d);
      size.set(r, (size.get(r)||0)+1);
      if(!rep.has(r)) rep.set(r, d);
    }
    var out = [];
    size.forEach(function(n, r){
      var rp = rep.get(r);
      out.push({ n:n, sig:sigList[sigIdx[rp]], appKey:appList[appIdx[rp]] });
    });
    out.sort(function(p,q){ return q.n - p.n; });
    return out;
  }

  var compsCode = componentsOf(sigCodeIdx, sigCodeList, true);    // ground truth
  var compsBin  = componentsOf(sigBinIdx,  sigBinList,  true);    // brief's literal sig
  var compsAll  = componentsOf(sigCodeIdx, sigCodeList, false);   // lattice sanity

  /* ---------- signature census (code signature) --------------------------- */
  var sigCount = {};
  for(var e=0;e<M3;e++) if(sigCodeIdx[e] >= 0){
    var sk = sigCodeList[sigCodeIdx[e]];
    sigCount[sk] = (sigCount[sk]||0)+1;
  }
  var bigCode = Object.keys(sigCount).filter(function(k){ return sigCount[k] >= MINP; });
  var smallSigs = Object.keys(sigCount).filter(function(k){ return sigCount[k] < MINP; });

  /* ---------- app keys that really occur inside the solid ----------------- */
  var inSolidKeys = {};
  for(var f=0;f<M3;f++) if(appIdx[f] >= 0) inSolidKeys[appList[appIdx[f]]] = 1;

  /* ---------- app keys reachable ONLY outside the solid ------------------- */
  /* The app also samples part bodies, so a part sticking out of the main solid
     can produce a key that has no geometry inside the solid at all -> such a
     cell is invisible / unselectable.  We probe each part's own bbox. */
  var outsideOnly = {};
  if(!lab && ps.length){
    ps.forEach(function(pr, pi){
      var b = partWorldBox(pr), M = 24;
      for(var i2=0;i2<=M;i2++) for(var j2=0;j2<=M;j2++) for(var k2=0;k2<=M;k2++){
        var x2 = b.min[0] + (b.max[0]-b.min[0])*i2/M;
        var y2 = b.min[1] + (b.max[1]-b.min[1])*j2/M;
        var z2 = b.min[2] + (b.max[2]-b.min[2])*k2/M;
        if(!partInside(pi,x2,y2,z2)) continue;
        if(insideCone(new THREE.Vector3(x2,y2,z2))) continue;
        var k3 = classify(x2,y2,z2).app;
        if(!inSolidKeys[k3]) outsideOnly[k3] = 1;
      }
    });
  }

  var compsCodeBig = compsCode.filter(function(c){ return c.n >= MINP; });
  var compsBinBig  = compsBin.filter(function(c){ return c.n >= MINP; });
  var compsAllBig  = compsAll.filter(function(c){ return c.n >= MINP; });

  return JSON.stringify({
    lab: lab, N: N, minPts: MINP, solidPts: solidN,
    nFaces: act.length, nCyls: cs.length, nParts: ps.length,
    b1: bigCode.length,                    // distinct signatures (4-value part code)
    b2: compsCodeBig.length,               // GEOMETRIC REGIONS  <- ground truth
    b1bin: (function(){
      var c = {};
      for(var g=0;g<M3;g++) if(sigBinIdx[g] >= 0) c[sigBinList[sigBinIdx[g]]] = 1;
      return Object.keys(c).length;
    })(),
    b2bin: compsBinBig.length,             // brief's literal inside/outside sig
    latticePieces: compsAllBig.length,     // sanity: whole solid should be 1
    sigCount: sigCount,
    smallSigs: smallSigs,
    components: compsCodeBig.map(function(c){ return {n:c.n, sig:c.sig, appKey:c.appKey}; }),
    inSolidKeys: Object.keys(inSolidKeys),
    outsideOnly: Object.keys(outsideOnly),
    appKeysSeen: Object.keys(inSolidKeys)
  });
})()`;

/* ============================================================================
   Scenario construction — mirrors the user's UI path
   ============================================================================ */
function build(app, sc){
  app.run(`(function(){
    applyShape(${j(sc.shape)});
    faces.length = 0; cyls.length = 0; parts.length = 0; pickSel = {}; showCurves = false;
  })()`);

  (sc.faces || []).forEach(function(f){
    app.run(`(function(){
      var chips = document.querySelectorAll("#addRow .chip");
      for(var i=0;i<chips.length;i++)
        if(chips[i].getAttribute("data-t") === ${j(f.type)}){ chips[i].dispatch("click"); return; }
      throw new Error("no #addRow chip for " + ${j(f.type)});
    })()`);
    app.run(`(function(){
      var f = faces[faces.length-1];
      f.x = ${f.x != null ? f.x : 0};
      f.y = ${f.y != null ? f.y : 0};
      f.z = ${f.z != null ? f.z : 0};
      ${f.flip ? "f.flip = true;" : ""}
    })()`);
  });

  (sc.cyls || []).forEach(function(c){
    app.run(`(function(){
      cutShape = ${j(c.shape || "cyl")};
      cutHole  = ${!!c.hole};
      var chips = document.querySelectorAll("#cylAddRow .chip");
      for(var i=0;i<chips.length;i++)
        if(chips[i].getAttribute("data-t") === ${j(c.type || "frontal")}){ chips[i].dispatch("click"); return; }
      throw new Error("no #cylAddRow chip");
    })()`);
    if(c.props){
      app.run(`(function(){
        var c = cyls[cyls.length-1], o = ${j(c.props)};
        for(var k in o) c[k] = o[k];
      })()`);
    }
  });

  (sc.parts || []).forEach(function(p){
    app.run(`(function(){
      var chips = document.querySelectorAll("#partAddRow .chip");
      for(var i=0;i<chips.length;i++)
        if(chips[i].getAttribute("data-p") === ${j(p.k)}){ chips[i].dispatch("click"); return; }
      throw new Error("no #partAddRow chip for " + ${j(p.k)});
    })()`);
    const props = Object.assign({}, p);
    delete props.k;
    app.run(`(function(){
      var pr = parts[parts.length-1], o = ${j(props)};
      for(var k in o) pr[k] = o[k];
      buildParts();
    })()`);
  });

  app.run(`(function(){
    var sel = document.getElementById("mode");
    if(sel){ sel.value = "pick"; sel.dispatch("change"); }
    mode = "pick"; refresh();
  })()`);
}

function measure(app){
  const cells = JSON.parse(app.run(`(function(){
    return JSON.stringify({
      n: cells.length,
      keys: cells.map(function(c){ return c.key; }),
      sel:  cells.map(function(c){ return c.sel !== false; }),
      meshCk: cellGroup ? cellGroup.children.map(function(ch){ return ch.userData && ch.userData.ck; })
                        : [],
      hasPartsField: cells.length ? (cells[0].parts !== undefined) : null
    });
  })()`));
  const mine = JSON.parse(app.run(ENUM_CODE));
  return { cells, mine };
}

/* my own key for one world point (same arithmetic as ENUM_CODE) */
function keyOfPoint(app, x, y, z){
  return app.run(`(function(){
    var act = activeFaceData(), cs = activeCyls(), ps = activeParts();
    var fk = [], ck = [], pk = [];
    for(var i=0;i<act.length;i++){
      var v = act[i].nv.x*${x} + act[i].nv.y*${y} + act[i].nv.z*${z} - act[i].d;
      fk.push("f" + act[i].id + ":" + (v >= 0 ? 1 : 0));
    }
    for(var k=0;k<cs.length;k++){
      var c = cs[k], s = Math.sin(c.ang*Math.PI/180), co = Math.cos(c.ang*Math.PI/180);
      var a = c.type==="frontal"?[0,0,1]:c.type==="horiz"?[0,1,0]:c.type==="lat"?[1,0,0]:
              c.type==="fv"?[s,co,0]:c.type==="pv"?[co,0,s]:[0,co,s];
      var qx=${x}-c.x, qy=${y}-c.y, qz=${z}-c.z;
      var axl = qx*a[0]+qy*a[1]+qz*a[2];
      var wx=qx-a[0]*axl, wy=qy-a[1]*axl, wz=qz-a[2]*axl;
      var m;
      if(c.shape === "cyl") m = c.r - Math.sqrt(wx*wx+wy*wy+wz*wz);
      else {
        var U,V;
        if(Math.abs(a[2])>0.9){U=[1,0,0];V=[0,1,0];}
        else if(Math.abs(a[1])>0.9){U=[1,0,0];V=[0,0,1];}
        else if(Math.abs(a[0])>0.9){U=[0,0,1];V=[0,1,0];}
        else {
          var ref = Math.abs(a[1])<0.9?[0,1,0]:[1,0,0];
          var ux=ref[1]*a[2]-ref[2]*a[1], uy=ref[2]*a[0]-ref[0]*a[2], uz=ref[0]*a[1]-ref[1]*a[0];
          var ul=Math.sqrt(ux*ux+uy*uy+uz*uz); ux/=ul;uy/=ul;uz/=ul;
          var vx=a[1]*uz-a[2]*uy, vy=a[2]*ux-a[0]*uz, vz=a[0]*uy-a[1]*ux;
          var vl=Math.sqrt(vx*vx+vy*vy+vz*vz); vx/=vl;vy/=vl;vz/=vl;
          U=[ux,uy,uz];V=[vx,vy,vz];
        }
        var hw=(c.w||0)/2, hh=(c.shape==="sq"?(c.w||0):(c.h||0))/2;
        m = Math.min(hw - Math.abs(wx*U[0]+wy*U[1]+wz*U[2]), hh - Math.abs(wx*V[0]+wy*V[1]+wz*V[2]));
      }
      if(c.len > 0) m = Math.min(m, c.len/2 - Math.abs(axl));
      ck.push("c" + c._id + ":" + (m >= 0 ? 1 : 0));
    }
    for(var n=0;n<ps.length;n++){
      var pr = ps[n], ax = new THREE.Vector3(0,1,0).applyQuaternion(partRot(pr)).normalize();
      var inside = insidePartWorld(pr, new THREE.Vector3(${x},${y},${z}));
      var code;
      if(inside) code = 3;
      else {
        var t = (${x}-pr.x)*ax.x + (${y}-pr.y)*ax.y + (${z}-pr.z)*ax.z;
        var top, bot;
        if(pr.k==="sphere"){ top=pr.r; bot=-pr.r; }
        else if(pr.k==="hemi"){ top=pr.r; bot=0; }
        else if(pr.k==="box"){ top=pr.h/2; bot=-pr.h/2; }
        else if(pr.k==="cube"){ top=pr.a/2; bot=-pr.a/2; }
        else if(pr.k==="slot"){ top=pr.d/2; bot=-pr.d/2; }
        else { top=(pr.h||20)/2; bot=-(pr.h||20)/2; }
        code = (t > top) ? 1 : (t < bot) ? 2 : 0;
      }
      pk.push("p" + pr._id + ":" + code);
    }
    return fk.join(",") + "|" + ck.join(",") + "|" + pk.join(",");
  })()`);
}

/* ============================================================================
   Scenarios
   ============================================================================ */
const results = [];
const BOX_S6 = { k:"box", w:200, d:200, h:26, y:-18, x:0, z:0, type:"horiz" };

const SCENARIOS = [
  { id:1, name:"圆锥 + 1 水平面", expect:"2", shape:"cone",
    faces:[{ type:"horiz", y:-15 }] },

  { id:2, name:"圆锥 + 2 水平面", expect:"3", shape:"cone",
    faces:[{ type:"horiz", y:-15 }, { type:"horiz", y:15 }] },

  { id:3, name:"圆锥 + 水平面 + 圆柱相贯体(实体)", expect:"4", shape:"cone",
    faces:[{ type:"horiz", y:-15 }],
    /* vertical (axis +Y) infinite cylinder through both halves -> 2x2 */
    cyls:[{ type:"horiz", shape:"cyl", hole:false, props:{ r:13, len:0, x:0, y:0, z:0 } }] },

  { id:4, name:"圆锥 + 水平面 + 长方体部件(120x120x30 y-10)", expect:"4", shape:"cone",
    faces:[{ type:"horiz", y:-15 }],
    parts:[{ k:"box", w:120, d:120, h:30, y:-10, x:0, z:0, type:"horiz" }] },

  { id:5, name:"实验室 + 正三棱锥部件 + 长方体部件", expect:"棱锥>=2 子区域", shape:"lab",
    parts:[{ k:"pyr3", r:24, h:50, x:0, y:0, z:0, type:"horiz" },
           { k:"box",  w:200, d:200, h:26, y:-18, x:0, z:0, type:"horiz" }] },

  { id:6, name:"正三棱锥主立体 + 长方体部件(y-18 h26)", expect:">=2 cells, 锥顶独立", shape:"pyr3",
    parts:[ Object.assign({}, BOX_S6) ] },

  { id:7, name:"隐藏锥顶区域(锥顶≠锥身, 不整块消失)", expect:"可独立隐藏", shape:"pyr3",
    parts:[ Object.assign({}, BOX_S6) ] }
];

/* ------------------------------------------------------------ extra checks */
function extraChecks(sc, app, rec){
  const out = [];
  const add = (name, ok, detail) => out.push({ name, ok: !!ok, detail: detail || "" });
  const m = rec.mine;

  if(sc.id === 1 || sc.id === 2){
    add("区域数 = " + sc.expect, rec.regionsN === Number(sc.expect), "regions=" + rec.regionsN);
  }
  if(sc.id === 3){
    add("区域数 = 4（2 面段 × 2 柱内外）", rec.regionsN === 4, "regions=" + rec.regionsN);
  }
  if(sc.id === 4){
    const seg3 = rec.app.keys.every(k => k.split("|").length === 3 && k.split("|")[2] !== "");
    add("部件进入分块 key（第 3 段 p<id>:<code> 非空）", m.nParts > 0 && seg3,
        "sample=" + j(rec.app.keys[0]));
    add("区域数 = 4（2 面段 × 2 部件内外）", rec.regionsN === 4, "regions=" + rec.regionsN);
  }
  if(sc.id === 5){
    /* part #0 in the parts array is the pyramid; inside-pyramid cells are the
       ones whose part-code segment starts with "3" */
    const inPyr = m.components.filter(function(c){
      const seg = c.sig.split("|")[2] || "";
      return seg.charAt(0) === "3";
    });
    add("棱锥被长方体切成 >=2 个可选子区域", inPyr.length >= 2,
        "pyramid sub-regions=" + inPyr.length + "  " + j(inPyr.map(c => c.appKey)));
  }
  if(sc.id === 6){
    add("cells >= 2", rec.cellsN >= 2, "cells=" + rec.cellsN);
    const H = app.run("SHAPES[shape].H");
    const ka = keyOfPoint(app, 0, H/2 - 1, 0);
    rec.apexKey = ka;
    add("锥顶所在区域是真实 cell", rec.app.keys.indexOf(ka) >= 0, "apexKey=" + ka);
  }
  if(sc.id === 7){
    const H = app.run("SHAPES[shape].H");
    const ka = keyOfPoint(app, 0, H/2 - 1, 0);   // apex, above the box
    const kb = keyOfPoint(app, 0, -18, 0);       // inside the box band
    rec.apexKey = ka; rec.bandKey = kb;
    add("锥顶区域 ≠ 长方体带内区域", !!ka && !!kb && ka !== kb, "apex=" + ka + "  band=" + kb);
    add("两个 key 都是真实 cells",
        rec.app.keys.indexOf(ka) >= 0 && rec.app.keys.indexOf(kb) >= 0,
        "apexInCells=" + (rec.app.keys.indexOf(ka) >= 0) +
        " bandInCells=" + (rec.app.keys.indexOf(kb) >= 0));

    if(rec.app.keys.indexOf(ka) >= 0){
      const r = JSON.parse(app.run(`(function(){
        var k = ${j(ka)};
        pickSel[k] = false;
        cells.forEach(function(c){ if(c.key === k) c.sel = false; });
        buildCellVis();
        var vis = cells.filter(function(c){ return c.sel !== false; }).length;
        var opaque = 0, total = 0;
        if(cellGroup) cellGroup.children.forEach(function(ch){
          if(ch.material && !ch.userData.cap){ total++; if(ch.material.opacity === 1) opaque++; }
        });
        return JSON.stringify({visible:vis, total:cells.length, opaque:opaque, meshes:total});
      })()`));
      add("只隐藏锥顶 → 仍 >=1 块可见且有不透明网格（未整块消失）",
          r.visible >= 1 && r.opaque > 0,
          "visibleCells=" + r.visible + "/" + r.total +
          " opaqueMeshes=" + r.opaque + "/" + r.meshes);

      const pc = JSON.parse(app.run(`(function(){
        var k = ${j(ka)}, c = null;
        cells.forEach(function(x){ if(x.key === k) c = x; });
        if(!c) return JSON.stringify({ok:false, why:"no cell with that key"});
        var H = SHAPES[shape].H;
        function inside(pl, px, py, pz){
          return (pl.normal.x*px + pl.normal.y*py + pl.normal.z*pz + pl.constant) >= -1e-6;
        }
        var apexOk = true, bandOk = true;
        (c.planes||[]).forEach(function(pl){
          if(!inside(pl, 0, H/2-1, 0)) apexOk = false;
          if(!inside(pl, 0, -18, 0))   bandOk = false;
        });
        return JSON.stringify({ok: apexOk && !bandOk, apexOk:apexOk, bandOk:bandOk,
                               nPlanes:(c.planes||[]).length});
      })()`));
      add("被隐藏块的裁剪平面只包住锥顶（不含带内点）", pc.ok,
          "apexInside=" + pc.apexOk + " bandInside=" + pc.bandOk + " planes=" + pc.nPlanes +
          (pc.why ? " (" + pc.why + ")" : ""));
    }
  }
  return out;
}

function runScenario(sc, htmlFile){
  const rec = { id: sc.id, name: sc.name, expect: sc.expect, err: null };
  const t0 = Date.now();
  try{
    const app = boot({ html: htmlFile || APP });
    build(app, sc);
    const m = measure(app);
    rec.app = m.cells;
    rec.mine = m.mine;
    rec.cellsN = m.cells.n;
    rec.sigN  = m.mine.b1;        // distinct signatures
    rec.geoN  = m.mine.b2;        // geometric regions (connected, same signature)
    rec.regionsN = rec.geoN;      // (b) in the brief's sense
    rec.verdict = (rec.cellsN === rec.geoN) ? "PASS"
                : (rec.cellsN === rec.sigN) ? "PASS(sig)"   // matches sigs, not regions
                : "FAIL";

    const appKeys = m.cells.keys.slice().sort();
    const seen = {};
    (m.mine.appKeysSeen || []).forEach(k => seen[k] = 1);
    (m.mine.outsideOnly || []).forEach(k => seen[k] = 1);
    rec.noGeometry = appKeys.filter(k => !seen[k]);
    rec.onlyMine = (m.mine.appKeysSeen || []).filter(k => appKeys.indexOf(k) < 0).sort();

    const meshSet = {};
    (m.cells.meshCk || []).forEach(k => { if(k) meshSet[k] = 1; });
    rec.noMesh = appKeys.filter(k => !meshSet[k]);

    rec.extras = extraChecks(sc, app, rec);
  }catch(e){
    rec.err = e && (e.stack || e.message || String(e));
    rec.verdict = "ERROR";
  }
  rec.ms = Date.now() - t0;
  results.push(rec);
  return rec;
}

/* ==================================================================== main
   runSuite() is exported so test3/selftest.js can run the same scenarios
   in-process against a mutated copy of the app (no child processes needed). */
function runSuite(opts){
  opts = opts || {};
  const htmlFile = opts.html ? path.resolve(opts.html) : APP;
  const quiet = !!opts.quiet;
  const say = quiet ? function(){} : function(s){ console.log(s); };

  const before = appFingerprintFor(htmlFile);
  say("app under test : " + htmlFile);
  say("fingerprint    : sha1=" + before.sha + "  size=" + before.size + "  mtime=" + before.mtime);
  say("lattice        : " + (N+1) + "^3 per domain box, fixed LCG jitter, minPts=" + MIN_PTS);
  say("regions = my own connected same-signature components;  sigs = distinct signatures");
  say("");

  const savedResults = results.splice(0, results.length);

  SCENARIOS.forEach(function(sc){
    const rec = runScenario(sc, htmlFile);
    say("─── [" + sc.id + "] " + sc.name + "   (expect " + sc.expect + ")");
    if(rec.err){
      say("    ERROR: " + String(rec.err).split("\n").slice(0,3).join(" | "));
      say("");
      return;
    }
    const m = rec.mine;
    say("    (a) app cells.length = " + rec.cellsN + "   " + j(rec.app.keys));
    say("    (b) my regions       = " + rec.geoN + " geometric" +
        "   [distinct signatures: " + rec.sigN + " with part-code, " + m.b1bin +
        " with plain inside/outside;  lattice pieces: " + m.latticePieces + "]");
    say("    (c) " + rec.verdict + "   [" + rec.cellsN + " cells vs " + rec.geoN +
        " geometric regions]   pts=" + m.solidPts +
        "  faces=" + m.nFaces + " cyls=" + m.nCyls + " parts=" + m.nParts + "  " + rec.ms + "ms");
    if(rec.noGeometry.length) say("    !! cells with NO geometry in the solid: " + j(rec.noGeometry));
    if(rec.onlyMine.length)   say("    !! geometry with NO cell            : " + j(rec.onlyMine));
    if(rec.noMesh.length)     say("    !! cells with NO mesh in cellGroup   : " + j(rec.noMesh));
    if(m.smallSigs && m.smallSigs.length)
      say("    -- sliver signatures (<" + MIN_PTS + " pts, ignored): " + j(m.smallSigs));
    if(rec.sigN !== rec.geoN)
      say("    -- signatures(" + rec.sigN + ") ≠ regions(" + rec.geoN +
          "): one signature covers several disconnected pieces (app splits them)");
    if(rec.verdict === "PASS(sig)")
      say("    -- cells match the SIGNATURE count but not the region count " +
          "(under-segmentation: disconnected pieces share a cell)");
    rec.extras.forEach(function(e){
      say("    " + (e.ok ? "PASS" : "FAIL") + "  " + e.name + (e.detail ? "   [" + e.detail + "]" : ""));
    });
    if(VERBOSE && !quiet){
      say("    signature census: " + j(m.sigCount));
      say("    regions: " + j(m.components));
    }
    say("");
  });

  const after = appFingerprintFor(htmlFile);
  const changed = before.sha !== after.sha;

  function pad(s, n){ s = String(s); while(s.length < n) s += " "; return s; }
  function padL(s, n){ s = String(s); while(s.length < n) s = " " + s; return s; }
  function trim(s, n){ s = String(s); return s.length > n ? s.slice(0, n-1) + "…" : s; }

  say("============================= SUMMARY =============================");
  say(pad("#", 3) + pad("scenario", 38) + padL("cells", 6) + padL("regions", 8) +
      padL("sigs", 6) + padL("expect", 18) + "  verdict");
  say("-".repeat(90));
  let pass = 0, fail = 0;
  results.forEach(function(r){
    const bad = (r.extras || []).filter(function(e){ return !e.ok; });
    const ok = !r.err && r.verdict !== "FAIL" && !bad.length;
    if(ok) pass++; else fail++;
    say(pad(r.id, 3) + pad(trim(r.name, 36), 38) +
        padL(r.err ? "-" : r.cellsN, 6) +
        padL(r.err ? "-" : r.geoN, 8) +
        padL(r.err ? "-" : r.sigN, 6) +
        padL(trim(r.expect, 16), 18) + "  " + r.verdict);
    if(r.err){
      say("      ✗ " + String(r.err).split("\n")[0]);
    } else {
      if(r.verdict === "FAIL")
        say("      ✗ cells(" + r.cellsN + ") ≠ geometric regions(" + r.geoN + ")" +
          (r.onlyMine.length ? "  geometry-without-cell=" + j(r.onlyMine) : "") +
          (r.noGeometry.length ? "  cells-without-geometry=" + j(r.noGeometry) : ""));
      if(r.verdict === "PASS(sig)" && r.sigN !== r.geoN)
        say("      ~ cells match signature count; " + (r.geoN - r.sigN) +
            " disconnected piece(s) merged into a shared cell");
      bad.forEach(function(e){
        say("      ✗ " + e.name + (e.detail ? "   [" + e.detail + "]" : ""));
      });
    }
  });
  say("-".repeat(90));
  say("PASS " + pass + "   FAIL " + fail + "   (of " + results.length + ")");
  if(changed){
    say("");
    say("!! WARNING: " + path.basename(htmlFile) + " CHANGED during this run");
    say("   before: sha1=" + before.sha + " size=" + before.size);
    say("   after : sha1=" + after.sha + " size=" + after.size);
    say("   -> re-run so every scenario is measured against one revision.");
  }

  const out = { pass: pass, fail: fail, results: results.slice() };
  results.length = 0;
  savedResults.forEach(function(r){ results.push(r); });
  return out;
}

module.exports = { runSuite: runSuite, SCENARIOS: SCENARIOS };

if(require.main === module){
  const r = runSuite({});
  process.exit(r.fail ? 1 : 0);
}
