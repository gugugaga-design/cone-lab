#!/usr/bin/env node
/**
 * Headless test harness for src/index.html  (single-file Three.js app)
 * ======================================================================
 *
 * 为什么要有这个文件：本机沙箱里起不了 headless 浏览器（Chromium 被拦），
 * 但 p1.html 的逻辑几乎全在一个 inline <script> 里，只依赖一个很窄的 DOM 面。
 * 于是我们用 Node 的 vm 造一个够用的假 DOM + 假 WebGLRenderer + 假 OrbitControls，
 * 把 three.min.js 和那段 inline 脚本按浏览器里的顺序跑起来，然后把脚本 IIFE
 * 内部的顶层变量/函数用 getter 暴露到 globalThis.__APP，供 probe 脚本检查。
 *
 * 设计要点（都是踩过的坑）：
 *  1. p1.html 每次 boot 都重新读盘 —— 另一个 agent 正在同时改这个文件。
 *  2. p1.html 的脚本是 `(function(){ "use strict"; ... })()` 包起来的，
 *     顶层 var/function 是**函数局部**，不是全局。所以抓取用的 trailer 必须
 *     注入到 IIFE 的**函数体末尾**（闭合 `}` 之前），而不是文件末尾。
 *  3. trailer 用 getter（`Object.defineProperty` + `try{return x}catch{}`）而不是
 *     一次性快照：app 里 `parts = ...` 这种重新赋值很常见（applySnapshot/undo），
 *     快照会立刻过期。
 *  4. 顶层声明名是**自动扫描**出来的（带字符串/注释/模板/regex 掩码 + 花括号深度），
 *     所以 p1.html 新增变量也会自动被捕获，不用改 harness。
 *  5. DOM 是"宽容"的：getElementById 找不到 id 就造一个假元素并记录下来
 *     （autoCreatedIds），保证 app 改了 id 也不会因为 null.addEventListener 崩掉；
 *     同时把自动创建过的 id 报出来，方便发现真实的名字写错。
 *  6. innerHTML 会被真正解析成子元素 —— renderPartList() 里
 *     `head.innerHTML = '...<button class="x">✕</button>'` 紧接着
 *     `head.querySelector(".x").addEventListener(...)`，不解析就必崩。
 *
 * 用法：
 *   node test/harness.js              # 自检，成功打印 HARNESS OK
 *   node test/harness.js --keys       # 额外打印全部 __APP key
 *   node test/harness.js --verbose    # 打印 app/three 的 console 输出
 *
 * probe 里：
 *   const { boot } = require('./harness');
 *   const app = boot();               // app.addPart / app.parts / app.THREE ...
 *
 * 本文件只读 assets/，不修改任何东西。
 */

'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const DEFAULT_HTML = path.join(ROOT, 'assets', 'web', 'p1.html');

/* =====================================================================
 * 1. 极简 DOM
 * ===================================================================== */

const VOID_TAGS = new Set(
  'area base br col embed hr img input link meta param source track wbr'.split(' ')
);
const RAW_TEXT_TAGS = new Set(['script', 'style', 'textarea', 'title']);

function normalizeSpace(s) {
  return String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
}

function camelize(name) {
  return String(name).replace(/-([a-z])/g, function (m, c) { return c.toUpperCase(); });
}

/* ---- style ---- */
function makeStyleObj() {
  const style = {};
  Object.defineProperty(style, 'setProperty', {
    enumerable: false, configurable: true, writable: true,
    value: function (name, value) { style[camelize(name)] = String(value); }
  });
  Object.defineProperty(style, 'getPropertyValue', {
    enumerable: false, configurable: true, writable: true,
    value: function (name) {
      const v = style[camelize(name)];
      return v == null ? '' : String(v);
    }
  });
  Object.defineProperty(style, 'removeProperty', {
    enumerable: false, configurable: true, writable: true,
    value: function (name) {
      const k = camelize(name), v = style[k];
      delete style[k];
      return v == null ? '' : String(v);
    }
  });
  Object.defineProperty(style, 'cssText', {
    enumerable: false, configurable: true,
    get: function () {
      return Object.keys(style).map(function (k) { return k + ':' + style[k]; }).join('; ');
    },
    set: function (v) {
      Object.keys(style).forEach(function (k) { delete style[k]; });
      parseStyleText(style, v);
    }
  });
  return style;
}

function parseStyleText(style, text) {
  String(text == null ? '' : text).split(';').forEach(function (decl) {
    const i = decl.indexOf(':');
    if (i < 0) return;
    const k = decl.slice(0, i).trim();
    const v = decl.slice(i + 1).trim();
    if (!k) return;
    style[camelize(k)] = v;
  });
}

/* ---- classList ---- */
class FakeClassList {
  constructor(el) { this.__el = el; }
  get __list() {
    return String(this.__el.className || '').split(/\s+/).filter(Boolean);
  }
  __set(list) {
    this.__el.className = list.join(' ');
    this.__el.attributes['class'] = this.__el.className;
  }
  add() {
    const list = this.__list;
    for (let i = 0; i < arguments.length; i++) {
      const c = String(arguments[i]);
      if (c && list.indexOf(c) < 0) list.push(c);
    }
    this.__set(list);
  }
  remove() {
    const drop = Array.prototype.map.call(arguments, String);
    this.__set(this.__list.filter(function (c) { return drop.indexOf(c) < 0; }));
  }
  contains(c) { return this.__list.indexOf(String(c)) >= 0; }
  toggle(c, force) {
    const has = this.contains(c);
    const on = force === undefined ? !has : !!force;
    if (on && !has) this.add(c);
    else if (!on && has) this.remove(c);
    return on;
  }
  replace(a, b) {
    const list = this.__list.map(function (c) { return c === String(a) ? String(b) : c; });
    this.__set(list);
    return true;
  }
  item(i) { return this.__list[i] || null; }
  get length() { return this.__list.length; }
  toString() { return this.__el.className; }
  forEach(fn, thisArg) { this.__list.forEach(fn, thisArg); }
  [Symbol.iterator]() { return this.__list[Symbol.iterator](); }
}

/* ---- element ---- */
class FakeElement {
  constructor(doc, tagName) {
    this.ownerDocument = doc || null;
    this.nodeType = 1;
    this.__tag = String(tagName || 'div').toLowerCase();
    this.tagName = this.__tag.toUpperCase();
    this.nodeName = this.tagName;
    this.childNodes = [];
    this.parentNode = null;
    this.attributes = Object.create(null);
    this.style = makeStyleObj();
    this._text = '';
    this._value = undefined;
    this._checked = false;
    this._listeners = Object.create(null);
    this._classList = null;
    this.hidden = false;
    this.disabled = false;
    this.title = '';
    this.id = '';
    this.className = '';
    this.type = this.__tag === 'input' ? 'text' : '';
    this.name = '';
    this.scrollTop = 0;
    this.scrollLeft = 0;
    this.clientWidth = 0;
    this.clientHeight = 0;
    this.offsetWidth = 0;
    this.offsetHeight = 0;
    this.width = this.__tag === 'canvas' ? 300 : 0;
    this.height = this.__tag === 'canvas' ? 150 : 0;
    this.__ctx2d = null;
    this.__ctxgl = null;
  }

  /* --- tree --- */
  get children() {
    return this.childNodes.filter(function (n) { return n && n.nodeType === 1; });
  }
  get childElementCount() { return this.children.length; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get firstElementChild() { return this.children[0] || null; }
  get lastElementChild() {
    const c = this.children;
    return c[c.length - 1] || null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.childNodes;
    const i = sibs.indexOf(this);
    return i < 0 ? null : (sibs[i + 1] || null);
  }
  get previousSibling() {
    if (!this.parentNode) return null;
    const sibs = this.parentNode.childNodes;
    const i = sibs.indexOf(this);
    return i <= 0 ? null : (sibs[i - 1] || null);
  }
  get isConnected() {
    let n = this;
    while (n && n.parentNode) n = n.parentNode;
    return !!(n && n.nodeType === 1 && n.__tag === 'html');
  }

  appendChild(node) {
    if (!node) return node;
    if (node.__fragment) {
      const kids = node.childNodes.slice();
      node.childNodes.length = 0;
      kids.forEach((k) => this.appendChild(k));
      return node;
    }
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore(node, ref) {
    if (!node) return node;
    if (!ref) return this.appendChild(node);
    const i = this.childNodes.indexOf(ref);
    if (i < 0) return this.appendChild(node);
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.splice(i, 0, node);
    return node;
  }
  removeChild(node) {
    const i = this.childNodes.indexOf(node);
    if (i >= 0) {
      this.childNodes.splice(i, 1);
      node.parentNode = null;
    }
    return node;
  }
  remove() {
    if (this.parentNode) this.parentNode.removeChild(this);
  }
  replaceChildren() {
    this.childNodes.forEach(function (n) { n.parentNode = null; });
    this.childNodes.length = 0;
    for (let i = 0; i < arguments.length; i++) this.appendChild(arguments[i]);
  }
  cloneNode() {
    const el = new FakeElement(this.ownerDocument, this.__tag);
    el.className = this.className;
    el.id = this.id;
    el.hidden = this.hidden;
    el._text = this._text;
    Object.keys(this.attributes).forEach((k) => { el.attributes[k] = this.attributes[k]; });
    return el;
  }

  /* --- text / html --- */
  get textContent() {
    let s = this._text || '';
    for (let i = 0; i < this.childNodes.length; i++) {
      const c = this.childNodes[i];
      if (c && c.nodeType === 1) s += c.textContent;
      else if (c && c.nodeType === 3) s += c.data;
    }
    return s;
  }
  set textContent(v) {
    this._text = String(v == null ? '' : v);
    this.childNodes.forEach(function (n) { n.parentNode = null; });
    this.childNodes.length = 0;
  }
  get innerText() { return this.textContent; }
  set innerText(v) { this.textContent = v; }
  get innerHTML() { return serializeNode(this); }
  set innerHTML(v) {
    this._text = '';
    this.childNodes.forEach(function (n) { n.parentNode = null; });
    this.childNodes.length = 0;
    const html = String(v == null ? '' : v);
    if (!html.trim()) return;
    parseHTMLInto(this.ownerDocument, this, html);
  }
  get outerHTML() { return serializeNode(this); }

  /* --- attributes --- */
  getAttribute(name) {
    const v = this.attributes[String(name)];
    return v === undefined ? null : v;
  }
  setAttribute(name, value) {
    name = String(name);
    value = value == null ? '' : String(value);
    this.attributes[name] = value;
    const n = name.toLowerCase();
    if (n === 'id') {
      this.id = value;
      if (this.ownerDocument && this.ownerDocument.__ids) this.ownerDocument.__ids[value] = this;
    } else if (n === 'class') {
      this.className = value;
    } else if (n === 'hidden') {
      this.hidden = true;
    } else if (n === 'disabled') {
      this.disabled = true;
    } else if (n === 'checked') {
      this._checked = true;
    } else if (n === 'selected') {
      this._selected = true;
    } else if (n === 'title') {
      this.title = value;
    } else if (n === 'value') {
      this._value = value;
    } else if (n === 'type') {
      this.type = value;
    } else if (n === 'style') {
      parseStyleText(this.style, value);
    } else if (n === 'width' && this.__tag === 'canvas') {
      this.width = Number(value) || 0;
    } else if (n === 'height' && this.__tag === 'canvas') {
      this.height = Number(value) || 0;
    }
  }
  hasAttribute(name) { return this.attributes[String(name)] !== undefined; }
  removeAttribute(name) {
    name = String(name);
    delete this.attributes[name];
    if (name === 'hidden') this.hidden = false;
    if (name === 'disabled') this.disabled = false;
  }
  getAttributeNames() { return Object.keys(this.attributes); }

  /* --- value / checked --- */
  get value() {
    if (this._value !== undefined) return this._value;
    if (this.__tag === 'select') {
      const opts = [];
      walk(this, function (el) { if (el.__tag === 'option') opts.push(el); });
      const sel = opts.filter(function (o) { return o._selected; })[0] || opts[0];
      if (!sel) return '';
      const v = sel.getAttribute('value');
      return v === null ? sel.textContent : v;
    }
    if (this.__tag === 'textarea') return this._text;
    const v = this.attributes['value'];
    return v === undefined ? '' : v;
  }
  set value(v) { this._value = String(v == null ? '' : v); }

  get checked() { return !!this._checked; }
  set checked(v) { this._checked = !!v; }

  /* --- class / dataset --- */
  get classList() {
    if (!this._classList) this._classList = new FakeClassList(this);
    return this._classList;
  }
  get dataset() {
    const el = this;
    function keyOf(k) {
      return 'data-' + String(k).replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
    }
    return new Proxy({}, {
      get: function (t, k) {
        if (typeof k !== 'string') return undefined;
        const v = el.attributes[keyOf(k)];
        return v === undefined ? undefined : v;
      },
      set: function (t, k, v) { el.setAttribute(keyOf(k), v); return true; },
      has: function (t, k) { return typeof k === 'string' && el.attributes[keyOf(k)] !== undefined; },
      deleteProperty: function (t, k) { delete el.attributes[keyOf(k)]; return true; },
      ownKeys: function () {
        return Object.keys(el.attributes)
          .filter(function (k) { return k.indexOf('data-') === 0; })
          .map(function (k) { return k.slice(5); });
      },
      getOwnPropertyDescriptor: function (t, k) {
        const v = el.attributes[keyOf(k)];
        if (v === undefined) return undefined;
        return { enumerable: true, configurable: true, value: v };
      }
    });
  }

  /* --- events --- */
  addEventListener(type, fn) {
    if (typeof fn !== 'function') return this;
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
    return this;
  }
  removeEventListener(type, fn) {
    const a = this._listeners[type];
    if (a) {
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    }
    return this;
  }
  dispatchEvent(ev) {
    if (!ev || typeof ev !== 'object') return true;
    if (!ev.target) ev.target = this;
    if (!ev.currentTarget) ev.currentTarget = this;
    if (typeof ev.preventDefault !== 'function') {
      ev.defaultPrevented = false;
      ev.preventDefault = function () { ev.defaultPrevented = true; };
    }
    if (typeof ev.stopPropagation !== 'function') ev.stopPropagation = function () {};
    const list = (this._listeners[ev.type] || []).slice();
    for (let i = 0; i < list.length; i++) list[i].call(this, ev);
    const inline = this['on' + ev.type];
    if (typeof inline === 'function') inline.call(this, ev);
    return !ev.defaultPrevented;
  }
  click() { return this.dispatchEvent({ type: 'click' }); }
  focus() {}
  blur() {}
  scrollIntoView() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() { return false; }
  getBoundingClientRect() {
    const w = this.__tag === 'canvas' ? (this.width || this.clientWidth || 0) : (this.clientWidth || 0);
    const h = this.__tag === 'canvas' ? (this.height || this.clientHeight || 0) : (this.clientHeight || 0);
    return {
      x: 0, y: 0, left: 0, top: 0, width: w, height: h,
      right: w, bottom: h, toJSON: function () { return { width: w, height: h }; }
    };
  }
  getClientRects() { return [this.getBoundingClientRect()]; }

  /* --- canvas --- */
  getContext(type) {
    if (String(type) === '2d') {
      if (!this.__ctx2d) this.__ctx2d = make2DContext(this);
      return this.__ctx2d;
    }
    if (!this.__ctxgl) this.__ctxgl = makeGLContext();
    return this.__ctxgl;
  }
  toDataURL() { return 'data:image/png;base64,'; }

  /* --- queries --- */
  querySelector(sel) {
    const r = querySelectorAll(this, sel);
    return r.length ? r[0] : null;
  }
  querySelectorAll(sel) { return querySelectorAll(this, sel); }
  getElementsByTagName(tag) {
    const t = String(tag).toLowerCase();
    return querySelectorAll(this, t === '*' ? '*' : t);
  }
  getElementsByClassName(cls) {
    return querySelectorAll(this, '.' + String(cls).trim().split(/\s+/).join('.'));
  }
  matches(sel) { return matchesSelector(this, sel); }
  closest(sel) {
    let n = this;
    while (n && n.nodeType === 1) {
      if (matchesSelector(n, sel)) return n;
      n = n.parentNode;
    }
    return null;
  }
}

/* ---- text node (只有极少数 API 需要) ---- */
class FakeTextNode {
  constructor(text) {
    this.nodeType = 3;
    this.data = String(text == null ? '' : text);
    this.parentNode = null;
  }
  get textContent() { return this.data; }
  get nodeValue() { return this.data; }
  get length() { return this.data.length; }
}

/* ---- serialization ---- */
function serializeNode(el) {
  if (!el || el.nodeType !== 1) return '';
  const attrs = Object.keys(el.attributes)
    .map(function (k) { return ' ' + k + '="' + String(el.attributes[k]).replace(/"/g, '&quot;') + '"'; })
    .join('');
  const kids = el.childNodes.map(serializeNode).join('');
  return '<' + el.__tag + attrs + '>' + (el._text || '') + kids + '</' + el.__tag + '>';
}

/* ---- selector engine (tag / #id / .class / [attr] / [attr="v"], 逗号 + 后代组合) ---- */
const __compoundCache = Object.create(null);

function parseCompound(sel) {
  if (__compoundCache[sel]) return __compoundCache[sel];
  const parts = { tag: null, id: null, classes: [], attrs: [] };
  let i = 0;
  const tagM = /^([a-zA-Z][\w-]*|\*)/.exec(sel);
  if (tagM) {
    parts.tag = tagM[1] === '*' ? null : tagM[1].toLowerCase();
    i = tagM[1].length;
  }
  while (i < sel.length) {
    const c = sel[i];
    if (c === '#') {
      const m = /^#([\w-]+)/.exec(sel.slice(i));
      if (!m) break;
      parts.id = m[1];
      i += m[0].length;
      continue;
    }
    if (c === '.') {
      const m = /^\.([\w-]+)/.exec(sel.slice(i));
      if (!m) break;
      parts.classes.push(m[1]);
      i += m[0].length;
      continue;
    }
    if (c === '[') {
      const m = /^\[([^\]]+)\]/.exec(sel.slice(i));
      if (!m) break;
      parts.attrs.push(m[1]);
      i += m[0].length;
      continue;
    }
    i++;
  }
  __compoundCache[sel] = parts;
  return parts;
}

function matchesCompound(el, sel) {
  if (!el || el.nodeType !== 1) return false;
  const p = parseCompound(sel);
  if (p.tag && el.__tag !== p.tag) return false;
  if (p.id && el.id !== p.id) return false;
  for (let i = 0; i < p.classes.length; i++) {
    if (!el.classList.contains(p.classes[i])) return false;
  }
  for (let i = 0; i < p.attrs.length; i++) {
    const a = p.attrs[i];
    const eq = a.indexOf('=');
    if (eq < 0) {
      if (!el.hasAttribute(a.trim())) return false;
    } else {
      const name = a.slice(0, eq).trim();
      let val = a.slice(eq + 1).trim();
      if ((val[0] === '"' && val[val.length - 1] === '"') ||
          (val[0] === "'" && val[val.length - 1] === "'")) {
        val = val.slice(1, -1);
      }
      if (String(el.getAttribute(name)) !== val) return false;
    }
  }
  return true;
}

function matchesGroup(el, group) {
  const parts = group.split(/\s+/).filter(Boolean);
  if (!parts.length) return false;
  let idx = parts.length - 1;
  if (!matchesCompound(el, parts[idx])) return false;
  idx--;
  let cur = el.parentNode;
  while (idx >= 0 && cur && cur.nodeType === 1) {
    if (matchesCompound(cur, parts[idx])) idx--;
    cur = cur.parentNode;
  }
  return idx < 0;
}

function matchesSelector(el, selector) {
  if (!selector || typeof selector !== 'string') return false;
  const groups = selector.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  for (let i = 0; i < groups.length; i++) {
    if (matchesGroup(el, groups[i])) return true;
  }
  return false;
}

function walk(root, fn) {
  const kids = root.childNodes || [];
  for (let i = 0; i < kids.length; i++) {
    const el = kids[i];
    if (el && el.nodeType === 1) {
      fn(el);
      walk(el, fn);
    }
  }
}

function querySelectorAll(root, selector) {
  const out = [];
  if (!selector || typeof selector !== 'string') return out;
  const groups = selector.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  if (!groups.length) return out;
  walk(root, function (el) {
    for (let i = 0; i < groups.length; i++) {
      if (matchesGroup(el, groups[i])) {
        out.push(el);
        return;
      }
    }
  });
  return out;
}

/* ---- canvas 2d / gl 假上下文 ---- */
function make2DContext(canvas) {
  const ctx = {
    canvas: canvas,
    font: '10px sans-serif',
    fillStyle: '#000',
    strokeStyle: '#000',
    lineWidth: 1,
    textBaseline: 'alphabetic',
    textAlign: 'start',
    globalAlpha: 1,
    measureText: function (text) {
      const fs = parseInt(String(ctx.font).replace(/[^\d.]/g, ''), 10) || 10;
      return { width: String(text == null ? '' : text).length * fs * 0.58 };
    },
    fillText: function () {}, strokeText: function () {},
    beginPath: function () {}, closePath: function () {},
    rect: function () {}, roundRect: function () {},
    moveTo: function () {}, lineTo: function () {},
    arc: function () {}, arcTo: function () {},
    quadraticCurveTo: function () {}, bezierCurveTo: function () {},
    fill: function () {}, stroke: function () {}, clip: function () {},
    clearRect: function () {}, fillRect: function () {}, strokeRect: function () {},
    save: function () {}, restore: function () {},
    translate: function () {}, scale: function () {}, rotate: function () {},
    setTransform: function () {}, resetTransform: function () {},
    drawImage: function () {},
    createLinearGradient: function () { return { addColorStop: function () {} }; },
    createRadialGradient: function () { return { addColorStop: function () {} }; },
    createPattern: function () { return {}; },
    getImageData: function (x, y, w, h) {
      return { data: new Uint8ClampedArray(Math.max(1, (w | 0) * (h | 0) * 4)), width: w | 0, height: h | 0 };
    },
    putImageData: function () {},
    setLineDash: function () {}, getLineDash: function () { return []; }
  };
  return ctx;
}

function makeGLContext() {
  const constants = {
    VERSION: 0x1F02, SHADING_LANGUAGE_VERSION: 0x8B8C,
    MAX_TEXTURE_IMAGE_UNITS: 0x8872, MAX_VERTEX_TEXTURE_IMAGE_UNITS: 0x8B4C,
    MAX_TEXTURE_SIZE: 0x0D33, MAX_CUBE_MAP_TEXTURE_SIZE: 0x851C,
    MAX_VERTEX_ATTRIBS: 0x8869, MAX_VARYING_VECTORS: 0x8DFC,
    MAX_VERTEX_UNIFORM_VECTORS: 0x8DFB, MAX_FRAGMENT_UNIFORM_VECTORS: 0x8DFD,
    MAX_SAMPLES: 0x8D57, MAX_RENDERBUFFER_SIZE: 0x84E8,
    FRAGMENT_SHADER: 0x8B30, VERTEX_SHADER: 0x8B31,
    HIGH_FLOAT: 0x8DF2, MEDIUM_FLOAT: 0x8DF1, LOW_FLOAT: 0x8DF0
  };
  const gl = Object.assign({
    canvas: null,
    drawingBufferWidth: 800,
    drawingBufferHeight: 600,
    getParameter: function (p) {
      switch (p) {
        case constants.VERSION: return 'WebGL 2.0 (harness)';
        case constants.SHADING_LANGUAGE_VERSION: return 'WebGL GLSL ES 3.00 (harness)';
        case constants.MAX_TEXTURE_IMAGE_UNITS: return 16;
        case constants.MAX_VERTEX_TEXTURE_IMAGE_UNITS: return 16;
        case constants.MAX_TEXTURE_SIZE: return 4096;
        case constants.MAX_CUBE_MAP_TEXTURE_SIZE: return 4096;
        case constants.MAX_VERTEX_ATTRIBS: return 16;
        case constants.MAX_VARYING_VECTORS: return 15;
        case constants.MAX_VERTEX_UNIFORM_VECTORS: return 1024;
        case constants.MAX_FRAGMENT_UNIFORM_VECTORS: return 1024;
        case constants.MAX_SAMPLES: return 4;
        case constants.MAX_RENDERBUFFER_SIZE: return 4096;
        default: return 4096;
      }
    },
    getExtension: function (name) {
      const n = String(name || '');
      if (n === 'WEBGL_debug_renderer_info') {
        return { UNMASKED_VENDOR_WEBGL: 0x9245, UNMASKED_RENDERER_WEBGL: 0x9246 };
      }
      if (n === 'EXT_texture_filter_anisotropic') {
        return { TEXTURE_MAX_ANISOTROPY_EXT: 0x84FE, MAX_TEXTURE_MAX_ANISOTROPY_EXT: 0x84FF };
      }
      return null;
    },
    getSupportedExtensions: function () { return []; },
    getShaderPrecisionFormat: function () {
      return { precision: 23, rangeMin: 127, rangeMax: 127 };
    },
    getContextAttributes: function () {
      return { alpha: true, antialias: true, depth: true, stencil: false, premultipliedAlpha: true };
    },
    isContextLost: function () { return false; },
    getProgramParameter: function () { return true; },
    getShaderParameter: function () { return true; },
    getProgramInfoLog: function () { return ''; },
    getShaderInfoLog: function () { return ''; },
    getAttribLocation: function () { return 0; },
    getUniformLocation: function () { return {}; },
    createTexture: function () { return {}; },
    createBuffer: function () { return {}; },
    createFramebuffer: function () { return {}; },
    createRenderbuffer: function () { return {}; },
    createProgram: function () { return {}; },
    createShader: function () { return {}; },
    createVertexArray: function () { return {}; },
    createQuery: function () { return {}; },
    checkFramebufferStatus: function () { return 0x8CD5; }
  }, constants);
  return gl;
}

/* =====================================================================
 * 2. 文档 / HTML 解析
 * ===================================================================== */

class FakeDocument {
  constructor() {
    this.__errors = [];
    this.__ids = Object.create(null);
    this.__autoIds = [];
    this.__all = [];
    this.readyState = 'complete';
    this.documentURI = 'file:///p1.html';
    this.defaultView = null;
    this._listeners = Object.create(null);

    this.documentElement = this.createElement('html');
    this.documentElement.clientWidth = 800;
    this.documentElement.clientHeight = 600;
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.body.clientWidth = 800;
    this.body.clientHeight = 600;
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
  }

  createElement(tag) {
    const el = new FakeElement(this, tag);
    this.__all.push(el);
    return el;
  }
  createElementNS(ns, tag) { return this.createElement(tag); }
  createTextNode(text) { return new FakeTextNode(text); }
  createDocumentFragment() {
    const f = this.createElement('#fragment');
    f.__fragment = true;
    f.nodeType = 11;
    return f;
  }
  createComment() { return new FakeTextNode(''); }

  getElementById(id) {
    id = String(id);
    const found = this.__ids[id];
    if (found) return found;
    /* 宽容：找不到就造一个，避免 app 因为改了 id 而 null.addEventListener 崩掉。
       造出来的 id 会记在 __autoIds 里，自检时打印，便于发现真的写错名字。 */
    const el = this.createElement('div');
    el.clientWidth = 100;
    el.clientHeight = 20;
    el.setAttribute('id', id);
    this.body.appendChild(el);
    this.__autoIds.push(id);
    return el;
  }

  querySelector(sel) {
    const r = querySelectorAll(this.documentElement, sel);
    return r.length ? r[0] : null;
  }
  querySelectorAll(sel) { return querySelectorAll(this.documentElement, sel); }
  getElementsByTagName(tag) {
    const t = String(tag).toLowerCase();
    return querySelectorAll(this.documentElement, t === '*' ? '*' : t);
  }
  getElementsByClassName(cls) {
    return querySelectorAll(this.documentElement, '.' + String(cls).trim().split(/\s+/).join('.'));
  }

  addEventListener(type, fn) {
    if (typeof fn !== 'function') return this;
    (this._listeners[type] || (this._listeners[type] = [])).push(fn);
    return this;
  }
  removeEventListener(type, fn) {
    const a = this._listeners[type];
    if (a) {
      const i = a.indexOf(fn);
      if (i >= 0) a.splice(i, 1);
    }
    return this;
  }
  dispatchEvent(ev) {
    if (!ev || typeof ev !== 'object') return true;
    if (!ev.target) ev.target = this;
    const list = (this._listeners[ev.type] || []).slice();
    for (let i = 0; i < list.length; i++) list[i].call(this, ev);
    return true;
  }
  hasFocus() { return true; }
  elementFromPoint() { return null; }
  loadHTML(html) {
    this.__all.length = 0;
    this.__all.push(this.documentElement, this.head, this.body);
    this.documentElement.childNodes.length = 0;
    this.documentElement.appendChild(this.head);
    this.documentElement.appendChild(this.body);
    this.head.childNodes.length = 0;
    this.body.childNodes.length = 0;
    parseHTMLInto(this, this.documentElement, String(html || ''));
  }
}

function applyAttributes(el, text) {
  const re = /([:\w-]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m;
  while ((m = re.exec(text || ''))) {
    const name = m[1];
    if (!name) continue;
    const value = m[2] !== undefined ? m[2]
      : m[3] !== undefined ? m[3]
        : m[4] !== undefined ? m[4] : '';
    el.setAttribute(name, value);
  }
}

function parseHTMLInto(doc, rootEl, html) {
  if (!doc || !rootEl) return;
  const stack = [rootEl];
  const re = /<(\/?)([a-zA-Z][\w:.-]*)((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;
  let idx = 0;
  let m;
  while ((m = re.exec(html))) {
    const text = html.slice(idx, m.index);
    if (text) appendText(stack[stack.length - 1], text);
    idx = re.lastIndex;

    const closing = m[1] === '/';
    const tag = m[2].toLowerCase();
    const attrs = m[3] || '';
    const selfClose = m[4] === '/';

    if (closing) {
      for (let k = stack.length - 1; k > 0; k--) {
        if (stack[k].__tag === tag) {
          stack.length = k;
          break;
        }
      }
      continue;
    }

    if (RAW_TEXT_TAGS.has(tag)) {
      const closeRe = new RegExp('</' + tag + '\\s*>', 'i');
      const rest = html.slice(idx);
      const cm = closeRe.exec(rest);
      const content = cm ? rest.slice(0, cm.index) : rest;
      idx = cm ? idx + cm.index + cm[0].length : html.length;
      re.lastIndex = idx;
      const el = makeTag(doc, tag);
      applyAttributes(el, attrs);
      attach(stack[stack.length - 1], el);
      el._text = content;
      continue;
    }

    const el = makeTag(doc, tag);
    applyAttributes(el, attrs);
    attach(stack[stack.length - 1], el);
    if (!selfClose && !VOID_TAGS.has(tag)) stack.push(el);
  }
  const tail = html.slice(idx);
  if (tail) appendText(stack[stack.length - 1], tail);
}

function makeTag(doc, tag) {
  if (tag === 'html') return doc.documentElement;
  if (tag === 'head') return doc.head;
  if (tag === 'body') return doc.body;
  return doc.createElement(tag);
}

function attach(parent, el) {
  if (!parent || !el) return;
  if (el === parent) return;
  if (el.parentNode === parent) return;
  if (el.__tag === 'html' || el.__tag === 'head' || el.__tag === 'body') {
    if (!el.parentNode) parent.appendChild(el);
    return;
  }
  parent.appendChild(el);
}

function appendText(el, text) {
  if (!el) return;
  if (!/\S/.test(text)) return;
  el._text = (el._text || '') + text;
}

/* =====================================================================
 * 3. 脚本抽取 / 注入点 / 顶层声明扫描
 * ===================================================================== */

function extractScripts(html) {
  const out = [];
  const re = /<script\b([^>]*)>([\s\S]*?)<\/script\s*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const attrs = m[1] || '';
    const srcM = /\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i.exec(attrs);
    out.push({
      src: srcM ? (srcM[1] !== undefined ? srcM[1] : srcM[2] !== undefined ? srcM[2] : srcM[3]) : null,
      body: m[2],
      index: out.length,
      start: m.index
    });
  }
  return out;
}

/** 取"没有 src 的那段 inline script"；有多段时取最长的一段（最稳）。 */
function extractInlineScript(html) {
  const scripts = extractScripts(html);
  const inline = scripts.filter(function (s) { return !s.src; });
  if (!inline.length) throw new Error('p1.html 里没有 inline <script>（没有 src 属性的那种）');
  let best = inline[0];
  for (let i = 1; i < inline.length; i++) {
    if (inline[i].body.length > best.body.length) best = inline[i];
  }
  return { body: best.body, scripts: scripts, inlineCount: inline.length, picked: best };
}

/**
 * 把源码里的注释 / 字符串 / 模板 / regex 全部替换成空格（保留换行与长度）。
 * 这样后续按字符扫花括号和关键字就不会被字符串里的 `{` `}` 干扰。
 */
function maskCode(src) {
  const n = src.length;
  const out = src.split('');
  function blank(a, b) {
    for (let k = a; k < b && k < n; k++) {
      if (out[k] !== '\n' && out[k] !== '\r') out[k] = ' ';
    }
  }
  let i = 0;
  let prevSig = '';
  while (i < n) {
    const c = src[i];
    const c2 = src[i + 1];

    if (c === '/' && c2 === '/') {
      const e = src.indexOf('\n', i);
      const end = e < 0 ? n : e;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '/' && c2 === '*') {
      const e = src.indexOf('*/', i + 2);
      const end = e < 0 ? n : e + 2;
      blank(i, end);
      i = end;
      continue;
    }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n) {
        if (src[j] === '\\') { j += 2; continue; }
        if (src[j] === c) { j++; break; }
        if (src[j] === '\n') break;
        j++;
      }
      blank(i, j);
      i = j;
      prevSig = c;
      continue;
    }
    if (c === '`') {
      let j = i + 1;
      let depth = 0;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '`' && depth === 0) { j++; break; }
        if (d === '$' && src[j + 1] === '{') { depth++; j += 2; continue; }
        if (d === '}' && depth > 0) { depth--; j++; continue; }
        j++;
      }
      blank(i, j);
      i = j;
      prevSig = '`';
      continue;
    }
    if (c === '/' && regexAllowed(prevSig)) {
      let j = i + 1;
      let inClass = false;
      while (j < n) {
        const d = src[j];
        if (d === '\\') { j += 2; continue; }
        if (d === '\n') break;
        if (d === '[') inClass = true;
        else if (d === ']') inClass = false;
        else if (d === '/' && !inClass) { j++; break; }
        j++;
      }
      while (j < n && /[a-z]/i.test(src[j])) j++;
      blank(i, j);
      i = j;
      prevSig = '/';
      continue;
    }
    if (!/\s/.test(c)) prevSig = c;
    i++;
  }
  return out.join('');
}

function regexAllowed(prevSig) {
  if (!prevSig) return true;
  return '([{,;:=!&|?+-*%^~<>'.indexOf(prevSig) >= 0;
}

function computeBraceDepth(masked) {
  const depth = new Int32Array(masked.length + 1);
  let d = 0;
  for (let i = 0; i < masked.length; i++) {
    depth[i] = d;
    const c = masked[i];
    if (c === '{') d++;
    else if (c === '}') d--;
  }
  depth[masked.length] = d;
  return depth;
}

function readIdent(src, i) {
  const m = /^[A-Za-z_$][\w$]*/.exec(src.slice(i));
  return m ? m[0] : '';
}

/** 从 src[open]（`[` `(` `{`）跳到配对的闭括号，返回其下标；失败返回 -1。 */
function skipBalanced(src, open, limit) {
  const pairs = { '[': ']', '(': ')', '{': '}' };
  const o = src[open];
  const c = pairs[o];
  if (!c) return -1;
  let d = 0;
  for (let i = open; i < limit; i++) {
    const ch = src[i];
    if (ch === o) d++;
    else if (ch === c) {
      d--;
      if (d === 0) return i;
    }
  }
  return -1;
}

/**
 * 找到最外层 IIFE 的函数体范围。返回 {openBrace, closeBrace}（在原始文本里的下标）。
 * 找不到就返回 null（调用方退化成"注入到脚本末尾"）。
 */
function findIifeBody(masked) {
  const head = /^\s*(?:\(\s*function\b|!\s*function\b|\(\s*\(\s*\)\s*=>)/.exec(masked);
  if (!head) return null;
  const fnIdx = masked.indexOf('function', head.index);
  let i;
  if (fnIdx >= 0) {
    i = masked.indexOf('{', fnIdx);
  } else {
    i = masked.indexOf('{');
  }
  if (i < 0) return null;
  let d = 0;
  for (let k = i; k < masked.length; k++) {
    const c = masked[k];
    if (c === '{') d++;
    else if (c === '}') {
      d--;
      if (d === 0) return { openBrace: i, closeBrace: k };
    }
  }
  return null;
}

/**
 * 扫描 [from, to) 区间内、位于 bodyDepth 深度上的 var/let/const/function/class 声明名。
 */
function findTopLevelNames(masked, depth, from, to, bodyDepth) {
  const names = [];
  const seen = Object.create(null);
  function push(n) {
    if (!n || seen[n]) return;
    seen[n] = true;
    names.push(n);
  }

  const re = /(?:^|[;{}\n)])\s*(var|let|const|function|class)\s+([A-Za-z_$][\w$]*)/gd;
  const src = masked;
  let m;
  while ((m = re.exec(src))) {
    const kwIdx = m.indices[1][0];
    const nameIdx = m.indices[2][0];
    if (kwIdx < from || kwIdx >= to) continue;
    if (depth[kwIdx] !== bodyDepth) continue;

    const kw = m[1];
    const first = m[2];

    if (kw === 'function' || kw === 'class') {
      push(first);
      continue;
    }

    push(first);
    /* var a = 1, b = 2;  —— 在 depth===bodyDepth 上按逗号切。
       注意：初始化表达式里的 `[` `(` `{` 必须整段跳过 —— 否则
       `var X = [ "a", "b" ].join("\n");` 里数组字面量的逗号会把 expectName 置真，
       然后把 `.join` 的 join 当成声明名（真实踩过的误报）。 */
    let i = nameIdx + first.length;
    let expectName = false;
    while (i < to) {
      const c = src[i];
      if (depth[i] < bodyDepth) break;
      if (depth[i] > bodyDepth) { i++; continue; }
      if (c === '[' || c === '(' || c === '{') {
        const close = skipBalanced(src, i, to);
        if (close < 0) break;
        i = close + 1;
        continue;
      }
      if (c === ';') break;
      if (c === ',') { expectName = true; i++; continue; }
      if (c === '\n') {
        /* ASI 兜底：行尾是操作符/逗号才继续，否则视为语句结束 */
        let k = i - 1;
        while (k >= from && /\s/.test(src[k])) k--;
        const last = k >= from ? src[k] : '';
        if (!last || ',=([{+-*/%&|?:<>!'.indexOf(last) < 0) break;
        i++;
        continue;
      }
      if (expectName && /[A-Za-z_$]/.test(c)) {
        const id = readIdent(src, i);
        push(id);
        expectName = false;
        i += id.length;
        continue;
      }
      i++;
    }
  }
  return names;
}

/* =====================================================================
 * 4. THREE 桩：WebGLRenderer / OrbitControls / ResizeObserver
 * ===================================================================== */

function makeWebGLRendererClass(THREE, getDocument, instances) {
  return class WebGLRendererStub {
    constructor(params) {
      params = params || {};
      const doc = getDocument();
      const canvas = params.canvas || doc.createElement('canvas');
      this.domElement = canvas;
      this.parameters = params;
      this.__kind = 'WebGLRendererStub';
      this.__frames = 0;
      this.__renders = [];
      this.__size = { width: 0, height: 0 };
      this.__pixelRatio = 1;
      this.__animationLoop = null;
      this.__disposed = false;
      this.__clearColor = null;
      this.__context = makeGLContext();
      this.__context.canvas = canvas;

      this.shadowMap = {
        enabled: false, autoUpdate: true, needsUpdate: false, type: 0,
        render: function () {}
      };
      this.info = {
        render: { frame: 0, calls: 0, triangles: 0, points: 0, lines: 0 },
        memory: { geometries: 0, textures: 0 },
        programs: [],
        autoReset: true,
        reset: function () {}
      };
      this.capabilities = {
        isWebGL2: true,
        precision: 'highp',
        maxTextures: 16,
        maxVertexTextures: 16,
        maxTextureSize: 4096,
        maxCubemapSize: 4096,
        maxAttributes: 16,
        maxVertexUniforms: 1024,
        maxVaryings: 15,
        maxFragmentUniforms: 1024,
        vertexTextures: true,
        floatFragmentTextures: true,
        floatVertexTextures: true,
        maxSamples: 4,
        getMaxAnisotropy: function () { return 1; },
        getMaxPrecision: function () { return 'highp'; }
      };
      this.properties = { get: function () { return {}; }, remove: function () {} };
      this.outputColorSpace = 'srgb';
      this.outputEncoding = 3001;
      this.toneMapping = 0;
      this.toneMappingExposure = 1;
      this.localClippingEnabled = false;
      this.clippingPlanes = [];
      this.autoClear = true;
      this.autoClearColor = true;
      this.autoClearDepth = true;
      this.autoClearStencil = true;
      this.sortObjects = true;
      this.debug = { checkShaderErrors: false };
      this.xr = {
        enabled: false,
        isPresenting: false,
        addEventListener: function () {},
        removeEventListener: function () {},
        setAnimationLoop: function () {},
        getSession: function () { return null; }
      };

      if (instances) instances.push(this);
    }

    getContext() { return this.__context; }
    getContextAttributes() { return this.__context.getContextAttributes(); }
    getPixelRatio() { return this.__pixelRatio; }
    setPixelRatio(v) { this.__pixelRatio = Number(v) || 1; return this; }
    getSize(target) {
      const size = { width: this.__size.width, height: this.__size.height };
      if (target && typeof target.set === 'function') target.set(size.width, size.height);
      return size;
    }
    setSize(w, h, updateStyle) {
      this.__size.width = Number(w) || 0;
      this.__size.height = Number(h) || 0;
      this.domElement.width = this.__size.width;
      this.domElement.height = this.__size.height;
      this.__context.drawingBufferWidth = this.__size.width;
      this.__context.drawingBufferHeight = this.__size.height;
      if (updateStyle !== false) {
        this.domElement.style.width = this.__size.width + 'px';
        this.domElement.style.height = this.__size.height + 'px';
      }
      return this;
    }
    getDrawingBufferSize(target) {
      const size = {
        width: Math.floor(this.__size.width * this.__pixelRatio),
        height: Math.floor(this.__size.height * this.__pixelRatio)
      };
      if (target && typeof target.set === 'function') target.set(size.width, size.height);
      return size;
    }
    render(scene, camera) {
      this.__frames++;
      this.info.render.frame = this.__frames;
      this.info.render.calls++;
      this.__renders.push({ scene: scene, camera: camera, frame: this.__frames });
      try {
        if (scene && typeof scene.updateMatrixWorld === 'function') scene.updateMatrixWorld(true);
        if (camera && typeof camera.updateMatrixWorld === 'function') camera.updateMatrixWorld(true);
      } catch (e) { /* 假渲染器不该因为场景坏了而炸 */ }
      return this;
    }
    setAnimationLoop(cb) { this.__animationLoop = cb; return this; }
    setClearColor(color, alpha) {
      this.__clearColor = { color: color, alpha: alpha === undefined ? 1 : alpha };
      return this;
    }
    getClearColor(target) {
      if (target && typeof target.set === 'function' && this.__clearColor) {
        target.set(this.__clearColor.color);
      }
      return target;
    }
    setClearAlpha(a) { if (this.__clearColor) this.__clearColor.alpha = a; return this; }
    getClearAlpha() { return this.__clearColor ? this.__clearColor.alpha : 1; }
    clear() { return this; }
    clearColor() { return this; }
    clearDepth() { return this; }
    clearStencil() { return this; }
    setViewport() { return this; }
    getViewport(target) { return target; }
    setScissor() { return this; }
    setScissorTest() { return this; }
    setRenderTarget() { return this; }
    getRenderTarget() { return null; }
    compile() { return this; }
    resetState() { return this; }
    initTexture() { return this; }
    copyFramebufferToTexture() { return this; }
    setOpaqueSort() { return this; }
    setTransparentSort() { return this; }
    forceContextLoss() { this.__contextLost = true; }
    forceContextRestore() { this.__contextLost = false; }
    dispose() { this.__disposed = true; }
  };
}

function makeOrbitControlsClass(THREE) {
  return class OrbitControlsStub {
    constructor(object, domElement) {
      this.__kind = 'OrbitControlsStub';
      this.object = object;
      this.domElement = domElement;
      this.enabled = true;
      this.target = new THREE.Vector3();
      this.enableDamping = false;
      this.dampingFactor = 0.05;
      this.minDistance = 0;
      this.maxDistance = Infinity;
      this.minZoom = 0;
      this.maxZoom = Infinity;
      this.minPolarAngle = 0;
      this.maxPolarAngle = Math.PI;
      this.minAzimuthAngle = -Infinity;
      this.maxAzimuthAngle = Infinity;
      this.enableZoom = true;
      this.enableRotate = true;
      this.enablePan = true;
      this.zoomSpeed = 1;
      this.rotateSpeed = 1;
      this.panSpeed = 1;
      this.autoRotate = false;
      this.autoRotateSpeed = 2;
      this.screenSpacePanning = true;
      this.keyPanSpeed = 7;
      this.cursor = null;
      this.__updateCount = 0;
      this.__listeners = Object.create(null);
      this.__disposed = false;
    }
    update() {
      this.__updateCount++;
      return false;
    }
    addEventListener(type, fn) {
      if (typeof fn !== 'function') return;
      (this.__listeners[type] || (this.__listeners[type] = [])).push(fn);
    }
    removeEventListener(type, fn) {
      const a = this.__listeners[type];
      if (a) {
        const i = a.indexOf(fn);
        if (i >= 0) a.splice(i, 1);
      }
    }
    dispatchEvent(ev) {
      const list = (this.__listeners[ev && ev.type] || []).slice();
      for (let i = 0; i < list.length; i++) list[i].call(this, ev);
    }
    getDistance() {
      if (this.object && this.object.position && this.target) {
        return this.object.position.distanceTo(this.target);
      }
      return 0;
    }
    getPolarAngle() { return 0; }
    getAzimuthalAngle() { return 0; }
    saveState() {}
    reset() {}
    listenToKeyEvents() {}
    stopListenToKeyEvents() {}
    dispose() { this.__disposed = true; }
  };
}

function makeObserverClass(kind) {
  return class ObserverStub {
    constructor(cb) {
      this.__kind = kind + 'Stub';
      this.callback = cb;
      this.targets = [];
    }
    observe(target) { this.targets.push(target); }
    unobserve(target) {
      const i = this.targets.indexOf(target);
      if (i >= 0) this.targets.splice(i, 1);
    }
    disconnect() { this.targets.length = 0; }
    takeRecords() { return []; }
  };
}

/* =====================================================================
 * 5. boot()
 * ===================================================================== */

const REQUIRED_NAMES = [
  /* 任务里点名的（有些是历史版本的名字，不存在也没关系，会记成 present:false） */
  'parts', 'partTint', 'partMaterials', 'buildParts', 'partGroup', 'mode', 'cells',
  'cellGroup', 'tapPick', 'applyLockState', 'lockState', 'buildPartCurves',
  'insidePartWorld', 'partSurfZeroChains', 'partPairCurves', 'partCylCurves',
  'partSolidCurves', 'cyls', 'addPart', 'buildCylVis', 'refresh', 'shape', 'SHAPES',
  'setShapeGeom', 'applyShape', 'showCurves', 'curveLabels', 'partGeoOf', 'partMatrix',
  'partSurfPatches', 'scene', 'THREE', 'solidRadiusLocal', 'insideSolidWorld',
  'pickHiddenCount', 'renderPartList', 'pickAllBtn', 'commitUndo', 'undoStack'
];

const EXTRA_NAMES = [
  'TYPES', 'COLORS', 'PARTS', 'PARTS_MAX', 'CYL_MAX', 'renderer', 'camera', 'orthoCam',
  'activeCam', 'controls', 'faces', 'flipped', 'pickSel', 'showXlines', 'bodyTint',
  'geo', 'coneGroup', 'coneF', 'coneB', 'matFront', 'matBack', 'raycaster', 'dragLocked',
  'frozen', 'undoStep', 'addCyl', 'clearParts', 'resetView', 'setView', 'showDemo', 'DEMOS',
  'updateHint', 'renderList', 'renderCylList', 'buildXlines', 'applyClipping',
  'rebuildCells', 'buildCellVis', 'showHome', 'isPoly', 'makeSolidGeo', 'partRot',
  'partGeo', 'partDefaults', 'slotGeom', 'worldPlane', 'faceNormalV', 'rawNormal',
  'classifyCurve', 'penetrationCurves', 'cellCaps', 'activeCyls', 'cylSpecOf',
  'partGhostMaterials', 'insidePartLocal', 'snapTipText', 'nextId', 'interCapGroup',
  'faceVis', 'showQuads', 'xlineGroup', 'cylVis', 'cutShape', 'cutHole', 'DEG', 'R', 'H',
  'OrbitControls'
];

function buildTrailer(names) {
  const lines = [];
  lines.push('');
  lines.push('/* ===== dsh headless harness trailer (injected inside the IIFE) ===== */');
  lines.push(';(function(){');
  lines.push('  var __g = globalThis;');
  lines.push('  var __A = __g.__APP = {};');
  lines.push('  var __P = __g.__APP_PRESENT = {};');
  lines.push('  var __W = __g.__APP_WRITABLE = {};');
  lines.push('  var __def = function(n, getter, setter){');
  lines.push('    var d = { get: getter, enumerable: true, configurable: true };');
  lines.push('    if (setter) d.set = setter;');
  lines.push('    try { Object.defineProperty(__A, n, d); } catch (e) {}');
  lines.push('  };');
  for (let i = 0; i < names.length; i++) {
    const n = names[i];
    lines.push('  __P[' + JSON.stringify(n) + '] = (typeof ' + n + ' !== "undefined");');
    /* 每个名字都配一个 setter：probe 需要 `app.showCurves = false` 这类赋值，
       而 app 的变量是 IIFE 局部量，只能靠闭包写回去。函数声明也允许覆盖（不常见但无害）。 */
    lines.push('  __W[' + JSON.stringify(n) + '] = (typeof ' + n + ' !== "undefined");');
    lines.push('  __def(' + JSON.stringify(n) +
      ', function(){ try { return ' + n + '; } catch (e) { return undefined; } }' +
      ', function(v){ try { ' + n + ' = v; } catch (e) {} });');
  }
  lines.push('  try {');
  lines.push('    Object.defineProperty(__A, "__names", { value: ' + JSON.stringify(names) + ', enumerable: false });');
  lines.push('    Object.defineProperty(__A, "__present", { get: function(){ return __P; }, enumerable: false });');
  lines.push('    Object.defineProperty(__A, "__writable", { get: function(){ return __W; }, enumerable: false });');
  lines.push('  } catch (e) {}');
  lines.push('  __g.__APP_READY = true;');
  lines.push('})();');
  lines.push('/* ===== end harness trailer ===== */');
  return lines.join('\n');
}

function makeEvent(type, props) {
  const ev = {
    type: type,
    target: null,
    currentTarget: null,
    defaultPrevented: false,
    preventDefault: function () { ev.defaultPrevented = true; },
    stopPropagation: function () {},
    stopImmediatePropagation: function () {}
  };
  if (props) Object.keys(props).forEach(function (k) { ev[k] = props[k]; });
  if (ev.isPrimary === undefined) ev.isPrimary = true;
  if (ev.pointerId === undefined) ev.pointerId = 1;
  if (ev.pointerType === undefined) ev.pointerType = 'mouse';
  if (ev.button === undefined) ev.button = 0;
  if (ev.buttons === undefined) ev.buttons = 1;
  return ev;
}

/**
 * 启动 p1.html。
 * @param {object} [opts]
 * @param {string} [opts.htmlPath]  默认 src/index.html（每次都重新读盘）
 * @param {'stub'|'real'} [opts.orbit='stub']  OrbitControls 用桩还是真实 lib/OrbitControls.js
 * @param {boolean} [opts.realTimers=false]    false = 虚拟定时器（tick 手动推进）
 * @param {boolean} [opts.verbose=false]       把 app/three 的 console 打到 stdout
 * @param {boolean} [opts.injectTrailer=true]  关掉可以只跑脚本、不抓 __APP
 * @param {number}  [opts.stageWidth=800]
 * @param {number}  [opts.stageHeight=600]
 * @returns {object} 同时带 __APP 的全部 key（getter，永远读最新值）+ fakes + 工具函数
 */
function boot(opts) {
  opts = opts || {};
  const htmlPath = opts.htmlPath || DEFAULT_HTML;
  const orbitMode = opts.orbit || 'stub';
  const verbose = !!opts.verbose;
  const realTimers = !!opts.realTimers;
  const injectTrailer = opts.injectTrailer !== false;
  const stageWidth = opts.stageWidth || 800;
  const stageHeight = opts.stageHeight || 600;

  /* ---- 0. 每次都重新读盘 ---- */
  const htmlBuf = fs.readFileSync(htmlPath);
  const html = htmlBuf.toString('utf8');
  const htmlStat = fs.statSync(htmlPath);

  /* ---- 1. 抽 inline script ---- */
  const inline = extractInlineScript(html);
  let appCode = inline.body;

  /* ---- 2. DOM ---- */
  const doc = new FakeDocument();
  doc.loadHTML(html);
  // 关键元素给个可用尺寸，resize() 才会真的 setSize
  const stageEl = doc.getElementById('stage');
  stageEl.clientWidth = stageWidth;
  stageEl.clientHeight = stageHeight;
  const glEl = doc.getElementById('gl');
  glEl.width = stageWidth;
  glEl.height = stageHeight;
  glEl.clientWidth = stageWidth;
  glEl.clientHeight = stageHeight;

  /* ---- 3. 沙箱全局 ---- */
  const errors = [];
  const logs = [];
  const rendererInstances = [];
  const winListeners = Object.create(null);

  let clock = Date.now();
  const clockOrigin = clock;
  let timerSeq = 0;
  const timers = [];
  let rafSeq = 0;
  let rafQueue = [];

  function logPush(level, args) {
    const rec = {
      level: level,
      text: args.map(function (a) {
        if (typeof a === 'string') return a;
        try { return require('util').inspect(a, { depth: 2, breakLength: 140 }); }
        catch (e) { return String(a); }
      }).join(' ')
    };
    logs.push(rec);
    if (verbose) console.log('[app:' + level + '] ' + rec.text);
  }

  const sandbox = {
    console: {
      log: function () { logPush('log', Array.prototype.slice.call(arguments)); },
      info: function () { logPush('info', Array.prototype.slice.call(arguments)); },
      warn: function () { logPush('warn', Array.prototype.slice.call(arguments)); },
      error: function () { logPush('error', Array.prototype.slice.call(arguments)); },
      debug: function () { logPush('debug', Array.prototype.slice.call(arguments)); },
      trace: function () { logPush('trace', Array.prototype.slice.call(arguments)); },
      group: function () {}, groupEnd: function () {}, groupCollapsed: function () {},
      table: function () {}, time: function () {}, timeEnd: function () {},
      assert: function () {}, count: function () {}, dir: function () {}
    },
    document: doc,
    navigator: {
      userAgent: 'dsh-headless-harness/1.0 (node ' + process.version + ')',
      platform: 'node',
      language: 'zh-CN',
      languages: ['zh-CN', 'en'],
      onLine: true,
      vibrate: function () { return true; },
      maxTouchPoints: 0,
      clipboard: { writeText: function () { return Promise.resolve(); } }
    },
    location: {
      href: 'file://' + htmlPath.replace(/\\/g, '/'),
      protocol: 'file:',
      host: '',
      hostname: '',
      port: '',
      pathname: '/src/index.html',
      search: '',
      hash: '',
      origin: 'file://'
    },
    performance: { now: function () { return clock - clockOrigin; } },
    devicePixelRatio: 1,
    innerWidth: stageWidth,
    innerHeight: stageHeight,
    outerWidth: stageWidth,
    outerHeight: stageHeight,
    scrollX: 0,
    scrollY: 0,
    screen: { width: stageWidth, height: stageHeight, availWidth: stageWidth, availHeight: stageHeight },
    isSecureContext: true,
    __HNOW: function () { return clock; },
    __HCLOCK: function () { return clock; },
    __HLOGS: logs,
    __HERRORS: errors,
    __HRENDERERS: rendererInstances,
    alert: function (m) { logPush('alert', [m]); },
    confirm: function () { return true; },
    prompt: function () { return null; },
    getComputedStyle: function (el) { return (el && el.style) || makeStyleObj(); },
    matchMedia: function (q) {
      return {
        matches: false, media: String(q), onchange: null,
        addEventListener: function () {}, removeEventListener: function () {},
        addListener: function () {}, removeListener: function () {}, dispatchEvent: function () { return false; }
      };
    },
    queueMicrotask: function (fn) { Promise.resolve().then(fn); },
    structuredClone: function (v) { return JSON.parse(JSON.stringify(v)); },
    requestAnimationFrame: function (cb) {
      const id = ++rafSeq;
      rafQueue.push({ id: id, cb: cb });
      return id;
    },
    cancelAnimationFrame: function (id) {
      rafQueue = rafQueue.filter(function (r) { return r.id !== id; });
    },
    setTimeout: function (fn, ms) {
      const id = ++timerSeq;
      if (realTimers) {
        const t = setTimeout(function () { fn.apply(null, Array.prototype.slice.call(arguments, 2)); }, ms || 0);
        if (t && typeof t.unref === 'function') t.unref();
        return id;
      }
      timers.push({
        id: id,
        at: clock + (Number(ms) || 0),
        fn: fn,
        args: Array.prototype.slice.call(arguments, 2)
      });
      return id;
    },
    clearTimeout: function (id) {
      const i = timers.findIndex(function (t) { return t.id === id; });
      if (i >= 0) timers.splice(i, 1);
      if (realTimers) clearTimeout(id);
    },
    setInterval: function (fn, ms) {
      const id = ++timerSeq;
      timers.push({
        id: id, at: clock + (Number(ms) || 0), fn: fn,
        args: Array.prototype.slice.call(arguments, 2),
        every: Math.max(16, Number(ms) || 16)
      });
      return id;
    },
    clearInterval: function (id) {
      const i = timers.findIndex(function (t) { return t.id === id; });
      if (i >= 0) timers.splice(i, 1);
    },
    addEventListener: function (type, fn) {
      if (typeof fn !== 'function') return;
      (winListeners[type] || (winListeners[type] = [])).push(fn);
    },
    removeEventListener: function (type, fn) {
      const a = winListeners[type];
      if (a) {
        const i = a.indexOf(fn);
        if (i >= 0) a.splice(i, 1);
      }
    },
    dispatchEvent: function (ev) {
      const list = (winListeners[ev && ev.type] || []).slice();
      for (let i = 0; i < list.length; i++) list[i].call(sandbox, ev);
      return true;
    }
  };

  /* window === globalThis，这样 app 里 window.x / 裸 x 是同一份 */
  sandbox.window = sandbox;
  sandbox.self = sandbox;
  sandbox.global = sandbox;

  const context = vm.createContext(sandbox, {
    name: 'p1-harness',
    codeGeneration: { strings: true, wasm: false }
  });

  vm.runInContext('globalThis.window = globalThis; globalThis.self = globalThis;', context, {
    filename: 'harness-prelude.js'
  });
  vm.runInContext('Date.now = function(){ return __HNOW(); };', context, {
    filename: 'harness-clock.js'
  });

  /* ---- 4. 按 HTML 里的顺序加载 <script src> ---- */
  /* libBase 默认是 html 所在目录（浏览器语义）；但 probe 经常把 HTML 复制到 test/ 下做变体，
     这时相对路径 lib/three.min.js 会失效 —— 用 opts.libBase 指回 assets/web。 */
  const htmlDir = path.dirname(htmlPath);
  const libDir = opts.libBase ? path.resolve(opts.libBase) : htmlDir;
  const loadedLibs = [];
  inline.scripts.forEach(function (s) {
    if (!s.src) return;
    let file = path.resolve(htmlDir, s.src);
    if (!fs.existsSync(file)) {
      const alt = path.resolve(libDir, s.src);
      if (fs.existsSync(alt)) file = alt;
    }
    if (!fs.existsSync(file)) {
      throw new Error('p1.html 引用的脚本不存在: ' + s.src +
        ' -> ' + path.resolve(htmlDir, s.src) +
        (libDir !== htmlDir ? ' (libBase: ' + path.resolve(libDir, s.src) + ')' : ''));
    }
    const code = fs.readFileSync(file, 'utf8');
    try {
      vm.runInContext(code, context, { filename: file, displayErrors: true });
    } catch (e) {
      const err = new Error('加载 ' + s.src + ' 失败: ' + (e && e.message));
      err.stack = err.message + '\n' + (e && e.stack);
      throw err;
    }
    loadedLibs.push(s.src);
  });

  const THREE = sandbox.THREE;
  if (!THREE) throw new Error('three.min.js 加载后 THREE 不存在');

  /* ---- 5. 替换 WebGLRenderer / OrbitControls ---- */
  const RendererStub = makeWebGLRendererClass(THREE, function () { return doc; }, rendererInstances);
  THREE.WebGLRenderer = RendererStub;
  sandbox.WebGLRenderer = RendererStub;

  const OrbitStub = makeOrbitControlsClass(THREE);
  let orbitImpl = 'stub';
  if (orbitMode === 'real' && typeof THREE.OrbitControls === 'function') {
    orbitImpl = 'real';
  } else {
    THREE.OrbitControls = OrbitStub;
    sandbox.OrbitControls = OrbitStub;
  }

  sandbox.ResizeObserver = makeObserverClass('ResizeObserver');
  sandbox.MutationObserver = makeObserverClass('MutationObserver');
  sandbox.IntersectionObserver = makeObserverClass('IntersectionObserver');
  sandbox.PerformanceObserver = makeObserverClass('PerformanceObserver');

  /* ---- 6. 注入 trailer 并跑 app 脚本 ---- */
  const masked = maskCode(appCode);
  const depth = computeBraceDepth(masked);
  const iife = findIifeBody(masked);
  const bodyFrom = iife ? iife.openBrace + 1 : 0;
  const bodyTo = iife ? iife.closeBrace : appCode.length;
  const bodyDepth = iife ? depth[iife.openBrace + 1] : 0;

  const discovered = findTopLevelNames(masked, depth, bodyFrom, bodyTo, bodyDepth);
  const nameSet = Object.create(null);
  const names = [];
  function addName(n) {
    if (!n || nameSet[n]) return;
    nameSet[n] = true;
    names.push(n);
  }
  discovered.forEach(addName);
  REQUIRED_NAMES.forEach(addName);
  EXTRA_NAMES.forEach(addName);

  let finalCode = appCode;
  let trailerInjected = false;
  if (injectTrailer) {
    const trailer = buildTrailer(names);
    if (iife) {
      finalCode = appCode.slice(0, iife.closeBrace) + '\n' + trailer + '\n' + appCode.slice(iife.closeBrace);
      trailerInjected = true;
    } else {
      finalCode = appCode + '\n' + trailer;
      trailerInjected = true;
    }
  }

  const appFilename = htmlPath + '#inline-script';
  try {
    vm.runInContext(finalCode, context, { filename: appFilename, displayErrors: true });
  } catch (e) {
    const err = new Error('p1.html 的 inline 脚本在启动时抛异常: ' + (e && e.message));
    err.appError = e;
    err.appStack = e && e.stack;
    err.cause = e;
    err.__harnessStage = 'app-script';
    throw err;
  }

  const APP = sandbox.__APP || null;
  const PRESENT = sandbox.__APP_PRESENT || {};

  /* ---- 7. 组装返回对象 ---- */
  const api = {};

  /* 7a. 把 __APP 的每个 key 以 getter/setter 形式搬到 api 上（永远读写同一份 IIFE 局部量） */
  if (APP) {
    Object.keys(APP).forEach(function (n) {
      try {
        Object.defineProperty(api, n, {
          get: function () { return APP[n]; },
          set: function (v) {
            try { APP[n] = v; } catch (e) { /* 只读 key 忽略 */ }
          },
          enumerable: true,
          configurable: true
        });
      } catch (e) { /* 忽略非法 key */ }
    });
  }

  /* 7b. 工具与 fakes */
  const apiExtras = {
    __APP: APP,
    __present: PRESENT,
    __names: names.slice(),
    __missing: names.filter(function (n) { return !PRESENT[n]; }),
    window: sandbox,
    global: sandbox,
    context: context,
    document: doc,
    THREE: THREE,
    sandbox: sandbox,
    errors: errors,
    logs: logs,
    htmlPath: htmlPath,
    htmlBytes: htmlBuf.length,
    htmlMtime: htmlStat.mtime,
    scriptInfo: {
      inlineChars: inline.body.length,
      inlineCount: inline.inlineCount,
      scriptCount: inline.scripts.length,
      libs: loadedLibs,
      trailerInjected: trailerInjected,
      iife: !!iife,
      bodyFrom: bodyFrom,
      bodyTo: bodyTo
    },
    orbitImpl: orbitImpl,
    rendererInstances: rendererInstances,
    get renderer() {
      return rendererInstances.length ? rendererInstances[rendererInstances.length - 1] : undefined;
    },
    /** 取一个 __APP 上的值（不存在返回 undefined） */
    get: function (name) { return APP ? APP[name] : undefined; },
    has: function (name) { return !!(APP && Object.prototype.hasOwnProperty.call(APP, name)); },
    present: function (name) { return !!PRESENT[name]; },
    /** 在沙箱里 eval 一段代码（能直接摸到 app 的局部变量？不能——只有全局） */
    run: function (code, filename) {
      return vm.runInContext(String(code), context, { filename: filename || 'probe-eval.js' });
    },
    /** 造一个合成事件 */
    event: makeEvent,
    /** 往元素（或 window）上派发事件 */
    fire: function (target, type, props) {
      const ev = makeEvent(type, props);
      const t = target || sandbox;
      if (typeof t.dispatchEvent === 'function') return t.dispatchEvent(ev);
      return false;
    },
    /** 派发 pointerdown/move/up 三连（用于模拟拖动） */
    pointerDrag: function (target, path, opts2) {
      opts2 = opts2 || {};
      const el = target || sandbox;
      if (!path || !path.length) return;
      const mk = function (type, pt) {
        return makeEvent(type, {
          clientX: pt[0], clientY: pt[1], pageX: pt[0], pageY: pt[1],
          screenX: pt[0], screenY: pt[1],
          isPrimary: true, pointerId: 1, pointerType: opts2.pointerType || 'mouse',
          button: 0, buttons: type === 'pointerup' ? 0 : 1
        });
      };
      el.dispatchEvent(mk('pointerdown', path[0]));
      for (let i = 1; i < path.length; i++) {
        if (typeof sandbox.dispatchEvent === 'function') sandbox.dispatchEvent(mk('pointermove', path[i]));
      }
      if (typeof sandbox.dispatchEvent === 'function') sandbox.dispatchEvent(mk('pointerup', path[path.length - 1]));
    },
    /** 跑 n 帧 requestAnimationFrame（app 的渲染循环每帧自己重排下一帧） */
    frame: function (n) {
      const count = Math.max(0, n === undefined ? 1 : n | 0);
      for (let k = 0; k < count; k++) {
        const batch = rafQueue;
        rafQueue = [];
        clock += 16;
        for (let i = 0; i < batch.length; i++) {
          try {
            batch[i].cb(clock - clockOrigin);
          } catch (e) {
            errors.push(e);
            throw e;
          }
        }
        if (!rafQueue.length && !batch.length) break;
      }
      return rafQueue.length;
    },
    /** 虚拟时钟推进 ms 毫秒，按时间顺序触发到期的定时器 */
    tick: function (ms) {
      if (realTimers) return 0;
      const target = clock + Math.max(0, Number(ms) || 0);
      let fired = 0;
      let guard = 0;
      for (;;) {
        let best = -1;
        for (let i = 0; i < timers.length; i++) {
          if (timers[i].at <= target && (best < 0 || timers[i].at < timers[best].at)) best = i;
        }
        if (best < 0) break;
        const t = timers[best];
        clock = Math.max(clock, t.at);
        if (t.every) t.at = clock + t.every;
        else timers.splice(best, 1);
        try {
          t.fn.apply(null, t.args || []);
          fired++;
        } catch (e) {
          errors.push(e);
          throw e;
        }
        if (++guard > 20000) break;
      }
      clock = target;
      return fired;
    },
    /** 立刻清掉所有定时器（避免 probe 结束后残留） */
    clearTimers: function () { timers.length = 0; },
    pendingTimers: function () { return timers.length; },
    pendingFrames: function () { return rafQueue.length; },
    now: function () { return clock - clockOrigin; },
    /** 把虚拟时钟调快，但**不**触发定时器 */
    skew: function (ms) { clock += Number(ms) || 0; },
    /** 触发一次 resize 回调链（app 自己注册的） */
    resize: function (w, h) {
      if (w) { stageEl.clientWidth = w; sandbox.innerWidth = w; }
      if (h) { stageEl.clientHeight = h; sandbox.innerHeight = h; }
      sandbox.dispatchEvent(makeEvent('resize'));
      return { width: stageEl.clientWidth, height: stageEl.clientHeight };
    },
    /** 元素点击快捷方式 */
    click: function (el) { return el && typeof el.click === 'function' ? el.click() : false; },
    /** 简要状态快照，方便 probe 打印 */
    snapshot: function () {
      const s = { shape: APP && APP.shape, mode: APP && APP.mode };
      try { s.parts = (APP && APP.parts ? APP.parts.length : null); } catch (e) { s.parts = 'ERR'; }
      try { s.faces = (APP && APP.faces ? APP.faces.length : null); } catch (e) { s.faces = 'ERR'; }
      try { s.cyls = (APP && APP.cyls ? APP.cyls.length : null); } catch (e) { s.cyls = 'ERR'; }
      try { s.cells = (APP && APP.cells ? APP.cells.length : null); } catch (e) { s.cells = 'ERR'; }
      try {
        s.partGroupChildren = (APP && APP.partGroup && APP.partGroup.children)
          ? APP.partGroup.children.length : 0;
      } catch (e) { s.partGroupChildren = 'ERR'; }
      try { s.sceneChildren = (APP && APP.scene && APP.scene.children) ? APP.scene.children.length : 0; }
      catch (e) { s.sceneChildren = 'ERR'; }
      s.renders = rendererInstances.length ? rendererInstances[rendererInstances.length - 1].__frames : 0;
      s.autoCreatedIds = doc.__autoIds.slice();
      s.logCount = logs.length;
      s.errorCount = errors.length;
      return s;
    },
    dispose: function () {
      timers.length = 0;
      rafQueue = [];
      winListeners = Object.create(null);
    }
  };

  Object.keys(apiExtras).forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(api, k) && k !== 'renderer') {
      /* app 自己也有同名（极罕见）——保留 app 的，但 renderer 用我们的实例 */
      if (k === '__APP' || k === 'document' || k === 'THREE') {
        Object.defineProperty(api, k, {
          get: function () { return apiExtras[k]; },
          enumerable: true, configurable: true
        });
      }
      return;
    }
    Object.defineProperty(api, k, {
      get: function () { return apiExtras[k]; },
      enumerable: true,
      configurable: true
    });
  });

  return api;
}

/* =====================================================================
 * 6. 自检
 * ===================================================================== */

function main() {
  const argv = process.argv.slice(2);
  const verbose = argv.indexOf('--verbose') >= 0;
  const showKeys = argv.indexOf('--keys') >= 0;

  let app;
  const t0 = Date.now();
  try {
    app = boot({ verbose: verbose });
  } catch (e) {
    console.error('');
    console.error('HARNESS FAIL');
    console.error('  ' + (e && e.message));
    if (e && e.appStack) {
      console.error('  --- app stack ---');
      console.error(String(e.appStack).split('\n').map(function (l) { return '  ' + l; }).join('\n'));
    } else if (e && e.stack) {
      console.error(String(e.stack).split('\n').map(function (l) { return '  ' + l; }).join('\n'));
    }
    process.exitCode = 1;
    return;
  }
  const bootMs = Date.now() - t0;

  const fail = [];
  function check(label, ok, detail) {
    if (!ok) fail.push(label + (detail ? ' (' + detail + ')' : ''));
    return ok;
  }

  const THREE = app.THREE;
  const parts = app.parts;
  const partGroup = app.partGroup;
  const scene = app.scene;

  let mats = null;
  try { mats = app.partMaterials(); } catch (e) { mats = null; }

  const facts = {
    html: app.htmlPath,
    htmlBytes: app.htmlBytes,
    inlineChars: app.scriptInfo.inlineChars,
    iife: app.scriptInfo.iife,
    trailer: app.scriptInfo.trailerInjected,
    revision: THREE && THREE.REVISION,
    partsIsArray: Array.isArray(parts),
    partsLength: Array.isArray(parts) ? parts.length : -1,
    partMaterials: mats ? mats.length : -1,
    partGroupType: partGroup ? partGroup.type : null,
    partGroupChildren: partGroup && partGroup.children ? partGroup.children.length : -1,
    sceneType: scene ? scene.type : null,
    sceneChildren: scene && scene.children ? scene.children.length : -1,
    shape: app.shape,
    mode: app.mode,
    namesCaptured: Object.keys(app.__APP || {}).length,
    namesMissing: app.__missing,
    autoIds: app.document.__autoIds.slice(),
    renders: app.renderer ? app.renderer.__frames : -1,
    rendererSize: app.renderer ? app.renderer.__size : null,
    orbit: app.orbitImpl,
    logs: app.logs.length,
    bootMs: bootMs
  };

  check('parts 是数组', facts.partsIsArray, typeof parts);
  check('partMaterials() 返回 2 个材质', facts.partMaterials === 2, String(facts.partMaterials));
  check('partGroup 存在且是 Group', !!(partGroup && partGroup.type === 'Group'), String(facts.partGroupType));
  check('THREE.REVISION 可读', !!facts.revision, String(facts.revision));
  check('scene 存在', !!(scene && scene.type === 'Scene'), String(facts.sceneType));
  check('inline script 抓到', facts.inlineChars > 0, String(facts.inlineChars));
  check('trailer 注入成功', facts.trailer === true, String(facts.trailer));
  check('没有 boot 期异常', app.errors.length === 0, String(app.errors.length));

  console.log('');
  console.log('p1.html headless harness — boot report');
  console.log('  html             : ' + facts.html);
  console.log('  html size/mtime  : ' + facts.htmlBytes + ' bytes @ ' + app.htmlMtime.toISOString());
  console.log('  inline script    : ' + facts.inlineChars + ' chars, IIFE=' + facts.iife +
    ', trailer=' + facts.trailer);
  console.log('  libs loaded      : ' + app.scriptInfo.libs.join(', '));
  console.log('  THREE.REVISION   : ' + facts.revision);
  console.log('  shape / mode     : ' + facts.shape + ' / ' + facts.mode);
  console.log('  parts            : ' + (facts.partsIsArray ? 'Array(' + facts.partsLength + ')' : 'NOT ARRAY'));
  console.log('  partMaterials()  : ' + facts.partMaterials +
    (mats ? ' [' + mats.map(function (m) { return m && m.type; }).join(', ') + ']' : ''));
  console.log('  partGroup        : ' + facts.partGroupType + ' (children=' + facts.partGroupChildren + ')');
  console.log('  scene            : ' + facts.sceneType + ' (children=' + facts.sceneChildren + ')');
  console.log('  renderer         : ' + facts.orbit.replace('stub', 'renderer-stub') +
    ' size=' + (facts.rendererSize ? facts.rendererSize.width + 'x' + facts.rendererSize.height : '?') +
    ' renders=' + facts.renders);
  console.log('  OrbitControls    : ' + facts.orbit);
  console.log('  __APP keys       : ' + facts.namesCaptured +
    (facts.namesMissing.length ? ' (missing: ' + facts.namesMissing.join(', ') + ')' : ' (all present)'));
  console.log('  auto-created ids : ' + (facts.autoIds.length ? facts.autoIds.join(', ') : '(none)'));
  console.log('  app console logs : ' + facts.logs);
  console.log('  boot time        : ' + facts.bootMs + ' ms');

  if (showKeys) {
    console.log('');
    console.log('__APP keys (' + facts.namesCaptured + '):');
    const keys = Object.keys(app.__APP).sort();
    for (let i = 0; i < keys.length; i += 6) {
      console.log('  ' + keys.slice(i, i + 6).join(', '));
    }
  }

  console.log('');
  if (fail.length) {
    console.log('HARNESS FAIL');
    fail.forEach(function (f) { console.log('  - ' + f); });
    process.exitCode = 1;
    return;
  }
  console.log('HARNESS OK');
}

module.exports = {
  boot: boot,
  /* 供其它 probe 复用的小工具 */
  extractInlineScript: extractInlineScript,
  extractScripts: extractScripts,
  maskCode: maskCode,
  findTopLevelNames: findTopLevelNames,
  computeBraceDepth: computeBraceDepth,
  findIifeBody: findIifeBody,
  FakeDocument: FakeDocument,
  FakeElement: FakeElement,
  makeEvent: makeEvent,
  DEFAULT_HTML: DEFAULT_HTML,
  ROOT: ROOT
};

if (require.main === module) main();
