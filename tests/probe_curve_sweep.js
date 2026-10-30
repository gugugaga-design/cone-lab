/* v33.27 健壮性扫描：8 种主立体 × 3 种截面 × 6 种面型 × 2 类（实体/贯穿）,
   检查：① 链条内没有大跳变（会画成"穿越空气"的直线）② 每个点的 solidOutside 偏差 ③ 链条总数不会爆。
   用法: node tests/probe_curve_sweep.js */
"use strict";
const { boot } = require("./boot");
const app = boot();

const res = app.run(`(function(){
  var SHAPES8 = ['cone','hemi','frustum5','prism5','pyr3','cyl','cylz'];
  var TYPES6 = ['frontal','fv','horiz','pv','lat','lv'];
  var CUTS = [{s:'cyl', f:'c.r=13;'}, {s:'sq', f:'c.w=22;c.h=22;c.len=22;'}, {s:'rect', f:'c.w=30;c.h=15;c.len=24;'}];
  var rows = [], bad = [];
  SHAPES8.forEach(function(sh){
    TYPES6.forEach(function(tp){
      CUTS.forEach(function(cu){
        [0, 1].forEach(function(hole){
          try{
            applyShape(sh);
            parts.length=0; cyls.length=0; faces.length=0; pickSel={};
            cutShape=cu.s; cutHole=!!hole;
            addCyl(tp);
            var c = cyls[0];
            eval(cu.f);
            c.x=-8; c.y=-6; c.z=4; c.on=true;
            renderCylList(); mode='all'; refresh();
            var chs = penetrationCurves(c);
            var worstJump=0, dev=0, pts=0, per=0;
            chs.forEach(function(P){
              for(var i=0;i<P.length;i++){
                pts++; dev = Math.max(dev, Math.abs(solidOutside(P[i])));
                if(i){ var d=P[i].distanceTo(P[i-1]); worstJump=Math.max(worstJump,d); per+=d; }
              }
            });
            var rec = {sh:sh, tp:tp, cut:cu.s, hole:hole, n:chs.length, pts:pts,
                       jump:+worstJump.toFixed(1), dev:+dev.toFixed(2), per:+per.toFixed(0)};
            rows.push(rec);
            if(worstJump > 12) bad.push(rec);                  // 相邻点跳 > 12mm 一定是拼错了
            if(dev > 0.5) bad.push(Object.assign({why:'offSurface'}, rec));
            if(chs.length > 12) bad.push(Object.assign({why:'tooManyChains'}, rec));
          }catch(e){ bad.push({sh:sh,tp:tp,cut:cu.s,hole:hole,err:e.message}); }
        });
      });
    });
  });
  return {n:rows.length, bad:bad, sample:rows.slice(0,4),
          maxJump: Math.max.apply(null, rows.map(function(r){return r.jump;})),
          maxDev: Math.max.apply(null, rows.map(function(r){return r.dev;})),
          maxChains: Math.max.apply(null, rows.map(function(r){return r.n;}))};
})()`);

console.log("扫描组合数 = " + res.n);
console.log("相邻点最大跳变 = " + res.maxJump + " mm");
console.log("曲线点离表面最大偏差 = " + res.maxDev + " mm");
console.log("单场景最多链条数 = " + res.maxChains);
console.log("异常 = " + res.bad.length);
res.bad.slice(0, 20).forEach(function(b){ console.log("   " + JSON.stringify(b)); });
process.exit(res.bad.length ? 1 : 0);
