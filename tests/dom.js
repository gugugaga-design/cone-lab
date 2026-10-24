/* Minimal DOM stub good enough for p1.html to boot headlessly in Node. */
"use strict";

function FakeClassList(el){
  this._s = new Set();
  this._el = el;
}
FakeClassList.prototype.add = function(){ for(var i=0;i<arguments.length;i++) this._s.add(arguments[i]); };
FakeClassList.prototype.remove = function(){ for(var i=0;i<arguments.length;i++) this._s.delete(arguments[i]); };
FakeClassList.prototype.contains = function(c){ return this._s.has(c); };
FakeClassList.prototype.toggle = function(c, force){
  var has = this._s.has(c);
  var want = (arguments.length > 1) ? !!force : !has;
  if(want) this._s.add(c); else this._s.delete(c);
  return want;
};
Object.defineProperty(FakeClassList.prototype, "value", { get: function(){ return Array.from(this._s).join(" "); } });

var _uid = 0;
function FakeEl(tag){
  this.tagName = (tag || "div").toUpperCase();
  this.id = "";
  this._uid = ++_uid;
  this.classList = new FakeClassList(this);
  this.style = {};
  this.dataset = {};
  this.children = [];
  this.childNodes = this.children;
  this.parentNode = null;
  this._attrs = {};
  this._listeners = {};
  this.textContent = "";
  this._innerHTML = "";
  this.value = "";
  this.title = "";
  this.disabled = false;
  this.hidden = false;
  this.clientWidth = 900;
  this.clientHeight = 600;
  this.offsetWidth = 900;
  this.offsetHeight = 600;
  this.scrollTop = 0;
  this.scrollHeight = 600;
}
FakeEl.prototype.addEventListener = function(t, fn){
  (this._listeners[t] = this._listeners[t] || []).push(fn);
};
FakeEl.prototype.removeEventListener = function(t, fn){
  var a = this._listeners[t]; if(!a) return;
  var i = a.indexOf(fn); if(i >= 0) a.splice(i,1);
};
FakeEl.prototype.dispatch = function(t, ev){
  ev = ev || {};
  ev.type = t;
  ev.target = ev.target || this;
  ev.preventDefault = ev.preventDefault || function(){};
  ev.stopPropagation = ev.stopPropagation || function(){};
  var a = this._listeners[t] || [];
  for(var i=0;i<a.length;i++) a[i].call(this, ev);
  return ev;
};
FakeEl.prototype.appendChild = function(c){ c.parentNode = this; this.children.push(c); return c; };
FakeEl.prototype.removeChild = function(c){
  var i = this.children.indexOf(c); if(i>=0) this.children.splice(i,1);
  c.parentNode = null; return c;
};
FakeEl.prototype.insertBefore = function(c, ref){
  var i = this.children.indexOf(ref);
  if(i < 0) this.children.push(c); else this.children.splice(i, 0, c);
  c.parentNode = this; return c;
};
FakeEl.prototype.setAttribute = function(k, v){ this._attrs[k] = String(v); if(k === "id") this.id = String(v); };
FakeEl.prototype.getAttribute = function(k){ return Object.prototype.hasOwnProperty.call(this._attrs, k) ? this._attrs[k] : null; };
FakeEl.prototype.removeAttribute = function(k){ delete this._attrs[k]; };
FakeEl.prototype.hasAttribute = function(k){ return Object.prototype.hasOwnProperty.call(this._attrs, k); };
FakeEl.prototype.getBoundingClientRect = function(){
  return {left:0, top:0, right:this.clientWidth, bottom:this.clientHeight,
          width:this.clientWidth, height:this.clientHeight, x:0, y:0};
};
FakeEl.prototype.setPointerCapture = function(){};
FakeEl.prototype.releasePointerCapture = function(){};
FakeEl.prototype.focus = function(){};
FakeEl.prototype.blur = function(){};
FakeEl.prototype.querySelector = function(sel){ return queryOne(this, sel); };
FakeEl.prototype.querySelectorAll = function(sel){ return queryAll(this, sel); };
FakeEl.prototype.closest = function(){ return null; };
FakeEl.prototype.contains = function(){ return false; };
FakeEl.prototype.getContext = function(){ return null; };
FakeEl.prototype.traverse = function(fn){ fn(this); this.children.forEach(function(c){ if(c.traverse) c.traverse(fn); }); };

/* ---------- selector matching (only the few shapes p1.html uses) ---------- */
function parseCompound(s){
  // e.g. ".chip", "#partAddRow .chip", "#cards .card", "#views button"
  var out = {tag:null, id:null, classes:[]};
  var m;
  if((m = s.match(/^#([\w-]+)/))){ out.id = m[1]; s = s.slice(m[0].length); }
  if((m = s.match(/^([a-zA-Z][\w-]*)/))){ out.tag = m[1].toUpperCase(); s = s.slice(m[0].length); }
  var re = /\.([\w-]+)/g;
  while((m = re.exec(s))) out.classes.push(m[1]);
  return out;
}
function matches(el, c){
  if(!el || !el.classList) return false;
  if(c.id && el.id !== c.id) return false;
  if(c.tag && el.tagName !== c.tag) return false;
  for(var i=0;i<c.classes.length;i++) if(!el.classList.contains(c.classes[i])) return false;
  return true;
}
function walk(el, fn){
  for(var i=0;i<el.children.length;i++){
    var c = el.children[i];
    fn(c);
    walk(c, fn);
  }
}
function queryAll(root, sel){
  var groups = String(sel).split(",").map(function(s){ return s.trim(); }).filter(Boolean);
  var res = [];
  groups.forEach(function(g){
    var parts = g.split(/\s+/).map(parseCompound);
    var last = parts[parts.length - 1];
    var anc = parts.slice(0, -1);
    walk(root, function(el){
      if(!matches(el, last)) return;
      // check ancestors chain (loose: any ancestor in order)
      var cur = el.parentNode, ok = true;
      for(var i=anc.length-1; i>=0; i--){
        var found = false;
        while(cur){
          if(matches(cur, anc[i])){ found = true; cur = cur.parentNode; break; }
          cur = cur.parentNode;
        }
        if(!found){ ok = false; break; }
      }
      if(ok) res.push(el);
    });
  });
  return res;
}
function queryOne(root, sel){
  var a = queryAll(root, sel);
  return a.length ? a[0] : null;
}

/* ---------- document ---------- */
function makeDocument(){
  var html = new FakeEl("html");
  var body = new FakeEl("body");
  html.appendChild(body);

  var byId = {};
  function reg(el, id){ el.id = id; byId[id] = el; return el; }

  // #stage > canvas#gl + #hud + #views + #leftbtns + #hint + #snapTip
  var stage = reg(new FakeEl("div"), "stage");
  body.appendChild(stage);
  reg(new FakeEl("canvas"), "gl"); stage.appendChild(byId.gl);

  var hud = new FakeEl("div"); hud.id = "hud"; stage.appendChild(hud);
  ["btnReset","btnZoomIn","btnZoomOut","btnFlip","btnArrows","btnQuads","btnHome"].forEach(function(id){
    var b = reg(new FakeEl("button"), id); hud.appendChild(b);
  });

  var views = new FakeEl("div"); views.id = "views"; stage.appendChild(views);
  [["front","主视"],["top","俯视"],["left","左视"]].forEach(function(p){
    var b = new FakeEl("button");
    b.setAttribute("data-v", p[0]); b.textContent = p[1];
    views.appendChild(b);
  });

  var left = new FakeEl("div"); left.id = "leftbtns"; stage.appendChild(left);
  ["btnSolid","btnSolidPart","btnCurve","btnXline","btnLock","btnUndo"].forEach(function(id){
    var b = reg(new FakeEl("button"), id); left.appendChild(b);
  });
  reg(new FakeEl("div"), "hint"); stage.appendChild(byId.hint);
  var snapTip = reg(new FakeEl("div"), "snapTip"); snapTip.hidden = true; stage.appendChild(snapTip);

  // #panel
  var panel = reg(new FakeEl("div"), "panel"); body.appendChild(panel);
  reg(new FakeEl("div"), "demoBar").hidden = true; panel.appendChild(byId.demoBar);
  reg(new FakeEl("div"), "demoTitle"); panel.appendChild(byId.demoTitle);
  reg(new FakeEl("div"), "demoCaseRow"); panel.appendChild(byId.demoCaseRow);
  reg(new FakeEl("div"), "demoSub"); panel.appendChild(byId.demoSub);
  reg(new FakeEl("div"), "panelHead"); panel.appendChild(byId.panelHead);
  reg(new FakeEl("span"), "mCount"); panel.appendChild(byId.mCount);
  var modeSel = reg(new FakeEl("select"), "mode"); panel.appendChild(modeSel);
  reg(new FakeEl("div"), "chev"); panel.appendChild(byId.chev);
  reg(new FakeEl("div"), "addBtn"); panel.appendChild(byId.addBtn);
  reg(new FakeEl("div"), "addRow"); panel.appendChild(byId.addRow);
  var addRow = byId.addRow;
  ["frontal","fv","horiz","pv","lat","lv"].forEach(function(t){
    var c = new FakeEl("div"); c.classList.add("chip"); c.setAttribute("data-t", t); addRow.appendChild(c);
  });
  reg(new FakeEl("div"), "pickRow").hidden = true; panel.appendChild(byId.pickRow);
  reg(new FakeEl("button"), "pickAll"); byId.pickRow.appendChild(byId.pickAll);
  reg(new FakeEl("span"), "pickInfo"); byId.pickRow.appendChild(byId.pickInfo);
  reg(new FakeEl("div"), "faces"); panel.appendChild(byId.faces);
  reg(new FakeEl("span"), "pCount"); panel.appendChild(byId.pCount);
  var partAddRow = new FakeEl("div"); partAddRow.id = "partAddRow"; panel.appendChild(partAddRow);
  ["cone","sphere","hemi","box","cube","cyl","slot","pyr3","frustum"].forEach(function(k){
    var c = new FakeEl("div"); c.classList.add("chip"); c.setAttribute("data-p", k); partAddRow.appendChild(c);
  });
  reg(new FakeEl("div"), "parts"); panel.appendChild(byId.parts);
  reg(new FakeEl("span"), "cCount"); panel.appendChild(byId.cCount);
  var cylShapeRow = new FakeEl("div"); cylShapeRow.id = "cylShapeRow"; panel.appendChild(cylShapeRow);
  ["cyl","sq","rect"].forEach(function(s){
    var c = new FakeEl("div"); c.classList.add("chip"); c.setAttribute("data-s", s); cylShapeRow.appendChild(c);
  });
  var cylUseRow = new FakeEl("div"); cylUseRow.id = "cylUseRow"; panel.appendChild(cylUseRow);
  ["solid","hole"].forEach(function(u){
    var c = new FakeEl("div"); c.classList.add("chip"); c.setAttribute("data-u", u); cylUseRow.appendChild(c);
  });
  var cylAddRow = new FakeEl("div"); cylAddRow.id = "cylAddRow"; panel.appendChild(cylAddRow);
  ["frontal","fv","horiz","pv","lat","lv"].forEach(function(t){
    var c = new FakeEl("div"); c.classList.add("chip"); c.setAttribute("data-t", t); cylAddRow.appendChild(c);
  });
  reg(new FakeEl("div"), "cyls"); panel.appendChild(byId.cyls);

  // #home + #cards
  var home = reg(new FakeEl("div"), "home"); home.hidden = true; body.appendChild(home);
  var cards = new FakeEl("div"); cards.id = "cards"; home.appendChild(cards);
  ["cone","hemi","frustum5","prism5","pyr3","cyl","cylz","lab"].forEach(function(s){
    var c = new FakeEl("div"); c.classList.add("card"); c.setAttribute("data-shape", s); cards.appendChild(c);
  });
  var demoCards = new FakeEl("div"); demoCards.id = "demoCards"; home.appendChild(demoCards);
  ["cylcyl","cylbox"].forEach(function(s){
    var c = new FakeEl("div"); c.classList.add("card"); c.setAttribute("data-demo", s); demoCards.appendChild(c);
  });

  var doc = {
    _byId: byId,
    body: body,
    documentElement: html,
    createElement: function(tag){ return new FakeEl(tag); },
    createElementNS: function(ns, tag){ return new FakeEl(tag); },
    createTextNode: function(t){ var e = new FakeEl("#text"); e.textContent = t; return e; },
    getElementById: function(id){ return byId[id] || null; },
    querySelector: function(sel){ return queryOne(body, sel); },
    querySelectorAll: function(sel){ return queryAll(body, sel); },
    addEventListener: function(){},
    removeEventListener: function(){},
    get activeElement(){ return null; },
    readyState: "complete",
    head: html,
    createEvent: function(){ return {}; }
  };
  return doc;
}

/* ---------- tiny HTML parser for innerHTML ----------
   Handles the limited markup p1.html generates: nested <div>/<span>/<button>/<input>
   with attributes, plus text nodes. Void elements are self-closing. */
var VOID_TAGS = { input:1, br:1, img:1, hr:1, meta:1, link:1 };

function parseHTML(html, doc){
  var root = new FakeEl("div");
  root.innerHTMLRaw = html;
  var stack = [root];
  var re = /<\/?([a-zA-Z][\w-]*)((?:\s+[^<>]*?)?)\/?>|([^<]+)/g;
  var m;
  while((m = re.exec(html))){
    if(m[3] != null){                        // text
      var txt = m[3];
      if(txt.trim() !== ""){
        var t = new FakeEl("#text");
        t.textContent = txt;
        t.tagName = "#TEXT";
        stack[stack.length-1].appendChild(t);
      }
      continue;
    }
    var whole = m[0], tag = m[1].toLowerCase(), attrs = m[2] || "";
    if(whole.charAt(1) === "/"){             // closing tag
      if(stack.length > 1) stack.pop();
      continue;
    }
    var el = new FakeEl(tag);
    var ar = /([\w:-]+)(?:\s*=\s*"([^"]*)"|\s*=\s*'([^']*)')?/g, am;
    while((am = ar.exec(attrs))){
      var name = am[1];
      var val = am[2] != null ? am[2] : (am[3] != null ? am[3] : "");
      el.setAttribute(name, val);
      if(name === "class"){ val.split(/\s+/).filter(Boolean).forEach(function(c){ el.classList.add(c); }); }
      if(name === "value") el.value = val;
      if(name === "title") el.title = val;
      if(name === "disabled") el.disabled = true;
      if(name === "hidden") el.hidden = true;
    }
    stack[stack.length-1].appendChild(el);
    if(!VOID_TAGS[tag] && !/\/$/.test(whole)) stack.push(el);
  }
  return root;
}

Object.defineProperty(FakeEl.prototype, "innerHTML", {
  get: function(){ return this._innerHTML || ""; },
  set: function(v){
    this._innerHTML = String(v);
    this.children.length = 0;
    if(v == null || v === "") return;
    var parsed = parseHTML(String(v), null);
    var self = this;
    parsed.children.forEach(function(c){ self.appendChild(c); });
  }
});

module.exports = { makeDocument: makeDocument, FakeEl: FakeEl, queryAll: queryAll, parseHTML: parseHTML };
