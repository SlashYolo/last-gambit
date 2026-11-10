import * as THREE from 'three';
import { STR, LANG, t, L, plural, setLanguage } from './i18n.js';
import { BASE, GLY, valOf, hits, attacked, kingSq, applyMove, opp, legal, hasLegal, inCheck, evalB, aiChoose, sqName, parsePuzzle, setPromoRank, withDeadline, bLoses, searchMate, attackersOf, kingRing, mateTheme } from './engine.js';
import { TNAME, MVNAME, UPS, RELICS, CONS, BOSSES, ARMY_START, ICON_CANVAS, ICON, img } from './content.js';
import BANK from '../data/puzzles.json';
import { profile, saveProfile, isDesktop } from './storage.js';
import { track } from './achievements.js';
import { initMeta, showMenu, showSplash } from './meta.js';
import { generatePuzzle, genSpec } from './generator.js';
import GenWorker from './gen.worker.js?worker&inline';

/* ============================== utils ============================== */
const rint = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
const pick = a => a[Math.floor(Math.random() * a.length)];
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const wait = ms => new Promise(r => setTimeout(r, ms));
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

/* Piece colours: cream for your side, red for the opponent; the badges above the pieces show the type. */
const SIDE_COL = { w: '#efe2c4', b: '#a3283c' };
const pieceHex = (tp, s) => SIDE_COL[s];
const gl = (tp, s, cls = '') => `<span class="g ${s} ${cls}" style="color:${pieceHex(tp, s)}">${GLY[tp]}︎</span>`;
/* ============================== audio ============================== */
let AC = null, muted = false, VOLUME = 0.8;
function tone(freq, dur, type = 'square', vol = 0.06, slide = 0, delay = 0) {
  if (muted) return;
  try {
    if (!AC) AC = new (window.AudioContext || window.webkitAudioContext)();
    const tt = AC.currentTime + delay, o = AC.createOscillator(), g = AC.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, tt);
    if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), tt + dur);
    g.gain.setValueAtTime(Math.max(0.0001, vol * VOLUME), tt); g.gain.exponentialRampToValueAtTime(0.0001, tt + dur);
    o.connect(g); g.connect(AC.destination); o.start(tt); o.stop(tt + dur + 0.02);
  } catch (e) { /* audio unavailable */ }
}
const SFX = {
  select: () => tone(660, .06, 'triangle', .07),
  move: () => { tone(320, .07, 'square', .05, -120); tone(180, .05, 'triangle', .05, 0, .06); },
  capture: () => { tone(220, .22, 'sawtooth', .07, -170); tone(90, .25, 'square', .05, -40, .03); },
  bounce: () => { tone(500, .08, 'square', .06, 200); tone(300, .1, 'square', .05, -100, .07); },
  coin: () => { tone(988, .07, 'square', .05); tone(1319, .12, 'square', .05, 0, .07); },
  check: () => { tone(740, .1, 'square', .06); tone(740, .1, 'square', .06, 0, .14); },
  win: () => [523, 659, 784, 1047].forEach((f, i) => tone(f, .18, 'square', .06, 0, i * .1)),
  lose: () => [392, 330, 262, 196].forEach((f, i) => tone(f, .25, 'triangle', .08, 0, i * .16)),
  buy: () => { tone(880, .06, 'square', .05); tone(660, .08, 'square', .05, 0, .06); tone(1175, .12, 'square', .05, 0, .13); },
  magic: () => [784, 988, 1175, 1568].forEach((f, i) => tone(f, .12, 'triangle', .05, 0, i * .05))
};

/* ============================== renderer ============================== */
const canvas = $('#gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.BasicShadowMap;
renderer.setClearColor(0x000000, 0);
const scene = new THREE.Scene();
const FOV = 34;
const camera = new THREE.PerspectiveCamera(FOV, 1, 2, 80);
const camTarget = new THREE.Vector3(0, 0, 0.3), camBase = new THREE.Vector3();
/* Orbit camera: hold the middle mouse button and drag. Angles in degrees; *T are the targets the view eases toward. */
const CAM_DEFAULT = { yaw: 0, pitch: 45 };
let camYaw = 0, camPitch = 45, camYawT = 0, camPitchT = 45, camDist = 12, camDrag = null, lastMiddleUp = 0;
function resetCamera() { camYawT = CAM_DEFAULT.yaw; camPitchT = CAM_DEFAULT.pitch; }
const rt = new THREE.WebGLRenderTarget(4, 4, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, format: THREE.RGBAFormat });

const POST_FRAG = `
uniform float crt; uniform sampler2D tScene; uniform vec2 lowRes; uniform float time; uniform vec2 shake; uniform float flash; uniform float danger; uniform vec3 flashCol;
varying vec2 vUv;
vec2 curve(vec2 uv){ uv = uv*2.0-1.0; vec2 off = abs(uv.yx)/vec2(7.0,5.5); uv = uv + uv*off*off; return uv*0.5+0.5; }
float A(vec2 u){ return texture2D(tScene,u).a; }
vec3 swirl(vec2 uv){
  vec2 px = floor(uv*lowRes*0.5)/(lowRes*0.5);
  vec2 p = (px-0.5)*vec2(lowRes.x/lowRes.y,1.0)*3.2;
  float t = time*0.16;
  float r = length(p); float a = atan(p.y,p.x) + t + 1.4/(r+0.7);
  vec2 q = vec2(cos(a),sin(a))*r;
  for(int i=0;i<4;i++){ q += 0.55*vec2(sin(q.y*1.6+t*2.1), cos(q.x*1.4-t*1.8)); }
  float f = 0.5+0.5*sin(q.x*1.15+q.y*0.95);
  float g = 0.5+0.5*sin(length(q)*1.7 - t*3.0);
  vec3 c1 = vec3(0.06,0.15,0.26), c2 = vec3(0.34,0.07,0.12), c3 = vec3(0.03,0.04,0.07);
  vec3 col = mix(c1,c2,smoothstep(0.32,0.68,f));
  col = mix(col,c3,smoothstep(0.5,0.95,g)*0.75);
  col += vec3(0.05,0.03,0.0)*smoothstep(0.92,1.0,f);
  return floor(col*14.0+0.5)/14.0;
}
void main(){
  vec2 uv = mix(vUv, curve(vUv), crt);
  if(uv.x<0.0||uv.x>1.0||uv.y<0.0||uv.y>1.0){ gl_FragColor = vec4(0.0,0.0,0.0,1.0); return; }
  vec2 su = uv + shake;
  vec4 s = texture2D(tScene, su);
  vec2 px = 1.0/lowRes;
  float rr = texture2D(tScene, su + vec2(px.x*0.6*crt,0.0)).r;
  float bb = texture2D(tScene, su - vec2(px.x*0.6*crt,0.0)).b;
  vec3 sc = vec3(mix(s.r,rr,0.5), s.g, mix(s.b,bb,0.5));
  vec3 bg = swirl(uv);
  vec3 col = mix(bg, sc, step(0.5,s.a));
  if(s.a < 0.5){
    float n = max(max(A(su+vec2(px.x,0.0)),A(su-vec2(px.x,0.0))),max(A(su+vec2(0.0,px.y)),A(su-vec2(0.0,px.y))));
    if(n > 0.5) col = vec3(0.025,0.02,0.04);
    else { float sh = A(su+vec2(-3.0*px.x, 4.0*px.y)); col = mix(col, col*0.4, step(0.5,sh)); }
  }
  vec2 d = uv-0.5; float r2 = dot(d,d);
  col *= 1.0 - r2*0.9;
  col += vec3(0.85,0.08,0.08)*danger*r2*1.8;
  col *= mix(1.0, 0.93 + 0.07*sin(gl_FragCoord.y*1.5708), crt);
  col += flashCol*flash;
  gl_FragColor = vec4(col,1.0);
}`;
const postMat = new THREE.ShaderMaterial({
  uniforms: { crt: { value: 1 }, tScene: { value: rt.texture }, lowRes: { value: new THREE.Vector2(1, 1) }, time: { value: 0 }, shake: { value: new THREE.Vector2() }, flash: { value: 0 }, flashCol: { value: new THREE.Color(1, 1, 1) }, danger: { value: 0 } },
  vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy,0.0,1.0); }',
  fragmentShader: POST_FRAG, depthTest: false, depthWrite: false
});
const postScene = new THREE.Scene(), postCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
postScene.add(new THREE.Mesh(new THREE.PlaneGeometry(2, 2), postMat));

let CRT_ON = true;
function curveJS(u, v) {
  if (!CRT_ON) return [u, v];
  let x = u * 2 - 1, y = v * 2 - 1; const ox = Math.abs(y) / 7, oy = Math.abs(x) / 5.5;
  x += x * ox * ox; y += y * oy * oy; return [x * .5 + .5, y * .5 + .5];
}
function invCurve(u, v) { let a = u, b = v; for (let i = 0; i < 4; i++) { const c = curveJS(a, b); a -= c[0] - u; b -= c[1] - v; } return [a, b]; }

let W = 1, H = 1, MOBILE = false;
function resize() {
  W = innerWidth; H = innerHeight; MOBILE = W < 820;
  renderer.setSize(W, H, false);
  const pix = MOBILE ? 2 : 3;
  const lw = Math.max(1, Math.ceil(W / pix)), lh = Math.max(1, Math.ceil(H / pix));
  rt.setSize(lw, lh); postMat.uniforms.lowRes.value.set(lw, lh);
  camera.aspect = W / H;
  const availW = MOBILE ? W - 16 : Math.max(320, W - 2 * (16 + 252 + 20));
  const availH = MOBILE ? H * 0.46 : H - 96;
  const needH = Math.max(11.2 * W / availW / camera.aspect, 8.8 * H / availH);
  const d = needH / (2 * Math.tan(FOV * Math.PI / 360));
  camDist = d;
  if (MOBILE) camera.setViewOffset(W, H, 0, -H * 0.05, W, H); else camera.clearViewOffset();
  camera.updateProjectionMatrix();
}
addEventListener('resize', resize);

/* ---------- lights ---------- */
scene.add(new THREE.HemisphereLight(0xc6dcff, 0x3a1f2e, 0.62));
const sun = new THREE.DirectionalLight(0xfff0d8, 0.95);
sun.position.set(-4.5, 11, 5.5); sun.castShadow = true;
sun.shadow.mapSize.set(1024, 1024);
Object.assign(sun.shadow.camera, { left: -7, right: 7, top: 7, bottom: -7, near: 1, far: 30 });
sun.shadow.bias = -0.004; sun.shadow.normalBias = 0.03;
scene.add(sun);
const rim = new THREE.DirectionalLight(0x6fa8ff, 0.4); rim.position.set(5, 5, -8); scene.add(rim);
const selLight = new THREE.PointLight(0x7cf0a0, 0, 3.2, 2); scene.add(selLight);

const GRAD = new THREE.DataTexture(new Uint8Array([80, 80, 80, 255, 165, 165, 165, 255, 255, 255, 255, 255]), 3, 1, THREE.RGBAFormat);
GRAD.minFilter = GRAD.magFilter = THREE.NearestFilter; GRAD.needsUpdate = true;
const toon = c => new THREE.MeshToonMaterial({ color: c, gradientMap: GRAD });
const outlineMat = new THREE.ShaderMaterial({
  uniforms: { th: { value: 0.032 }, col: { value: new THREE.Color(0x120a10) } },
  vertexShader: 'uniform float th; void main(){ vec3 p = position + normal*th; gl_Position = projectionMatrix*modelViewMatrix*vec4(p,1.0); }',
  fragmentShader: 'uniform vec3 col; void main(){ gl_FragColor = vec4(col,1.0); }',
  side: THREE.BackSide
});
const canvasTex = c => { const tx = new THREE.CanvasTexture(c); tx.minFilter = tx.magFilter = THREE.NearestFilter; tx.generateMipmaps = false; return tx; };

/* ---------- board ---------- */
const sqPos = i => new THREE.Vector3((i & 7) - 3.5, 0, 3.5 - (i >> 3));
const tileMeshes = [];
(function buildBoard() {
  const tg = new THREE.BoxGeometry(0.98, 0.36, 0.98);
  for (let i = 0; i < 64; i++) {
    const x = i & 7, y = i >> 3, dark = (x + y) % 2 === 0;
    const c = new THREE.Color(dark ? 0x5a4a3c : 0x9c8664); c.offsetHSL(0, 0, (Math.random() - .5) * 0.035);
    const m = new THREE.Mesh(tg, toon(c)); const p = sqPos(i); m.position.set(p.x, -0.18, p.z);
    m.receiveShadow = true; m.userData.sq = i; scene.add(m); tileMeshes.push(m);
  }
  const ped = new THREE.Mesh(new THREE.BoxGeometry(9.9, 0.5, 9.9), toon(0x22171a)); ped.position.y = -0.7; ped.receiveShadow = true; scene.add(ped);
  const c = document.createElement('canvas'); c.width = c.height = 186; const x = c.getContext('2d');
  x.fillStyle = '#3b2a22'; x.fillRect(0, 0, 186, 186);
  x.fillStyle = '#4c362b'; for (let i = 0; i < 186; i += 6) x.fillRect(0, i, 186, 2);
  x.fillStyle = '#d9c49a'; x.font = 'bold 9px monospace'; x.textAlign = 'center'; x.textBaseline = 'middle';
  for (let i = 0; i < 8; i++) {
    const u = (0.65 + i + 0.5) / 9.3 * 186;
    x.fillText('abcdefgh'[i], u, 186 - 6.5);
    x.fillText(String(i + 1), 6.5, 186 - u);
  }
  const wood = toon(0x3b2a22), top = new THREE.MeshToonMaterial({ map: canvasTex(c), gradientMap: GRAD });
  const frame = new THREE.Mesh(new THREE.BoxGeometry(9.3, 0.45, 9.3), [wood, wood, top, wood, wood, wood]);
  frame.position.y = -0.3; frame.receiveShadow = true; scene.add(frame);
})();

/* ---------- markers ---------- */
function markCanvas(kind) {
  const c = document.createElement('canvas'); c.width = c.height = 16; const x = c.getContext('2d'); x.fillStyle = '#fff';
  if (kind === 'fill') { x.fillRect(1, 1, 14, 14); }
  else if (kind === 'dot') { x.fillStyle = '#000'; x.fillRect(5, 5, 6, 6); x.fillStyle = '#fff'; x.fillRect(6, 6, 4, 4); }
  else if (kind === 'frame') { [[1, 1], [10, 1], [1, 10], [10, 10]].forEach(([a, b]) => { x.fillRect(a, b, 5, 2); x.fillRect(a + (a > 5 ? 3 : 0), b, 2, 5); }); for (const [a, b] of [[1, 10], [10, 10]]) x.fillRect(a, b + 3, 5, 2); }
  else if (kind === 'edge') { x.fillRect(0, 0, 16, 2); x.fillRect(0, 14, 16, 2); x.fillRect(0, 0, 2, 16); x.fillRect(14, 0, 2, 16); }
  return canvasTex(c);
}
const MTEX = { fill: markCanvas('fill'), dot: markCanvas('dot'), frame: markCanvas('frame'), edge: markCanvas('edge') };
const markGroup = new THREE.Group(); scene.add(markGroup);
const markGeo = new THREE.PlaneGeometry(0.96, 0.96); markGeo.rotateX(-Math.PI / 2);
const markMats = {}, pulseMats = [];
function markMat(tex, color, op, pulse) {
  const k = tex + color + op; if (markMats[k]) return markMats[k];
  const m = new THREE.MeshBasicMaterial({ map: MTEX[tex], color, transparent: true, opacity: op, depthWrite: false });
  m.userData.base = op; if (pulse) pulseMats.push(m); return (markMats[k] = m);
}
function mark(i, tex, color, op = 1, pulse = false, y = 0.012) {
  const m = new THREE.Mesh(markGeo, markMat(tex, color, op, pulse)); const p = sqPos(i); m.position.set(p.x, y, p.z); m.renderOrder = 2; markGroup.add(m);
}

/* ---------- piece meshes ---------- */
const V2 = a => a.map(([r, h]) => new THREE.Vector2(r, h));
const lathe = pts => new THREE.LatheGeometry(V2(pts), 10);
const cyl = (r, h) => new THREE.CylinderGeometry(r, r, h, 10);
const GEO = {
  P: lathe([[0, 0], [.33, 0], [.33, .07], [.26, .11], [.26, .15], [.15, .22], [.11, .44], [0, .46]]),
  Phead: new THREE.SphereGeometry(.16, 8, 6), Pcol: cyl(.2, .06),
  R: lathe([[0, 0], [.36, 0], [.36, .08], [.28, .12], [.28, .16], [.22, .22], [.2, .6], [.29, .64], [.29, .8], [0, .8]]),
  merlon: new THREE.BoxGeometry(.13, .13, .13), Rcol: cyl(.27, .05),
  B: lathe([[0, 0], [.35, 0], [.35, .07], [.27, .12], [.27, .16], [.17, .23], [.11, .66], [0, .67]]),
  Bhead: lathe([[0, 0], [.13, .02], [.2, .14], [.2, .24], [.13, .38], [.04, .48], [0, .49]]), slit: new THREE.BoxGeometry(.26, .05, .06),
  Bcol: cyl(.21, .06), ball: new THREE.SphereGeometry(.06, 6, 4), ballL: new THREE.SphereGeometry(.085, 6, 4), spike: new THREE.SphereGeometry(.05, 5, 4),
  Q: lathe([[0, 0], [.37, 0], [.37, .08], [.29, .13], [.29, .17], [.17, .25], [.12, .7], [0, .71]]),
  Qcrown: lathe([[0, 0], [.13, 0], [.24, .22], [.26, .3], [.18, .26], [0, .28]]), Qcol: cyl(.23, .06),
  K: lathe([[0, 0], [.38, 0], [.38, .08], [.3, .13], [.3, .17], [.18, .26], [.13, .82], [0, .83]]),
  Khead: lathe([[0, 0], [.14, 0], [.24, .18], [.22, .26], [0, .27]]), Kcol: cyl(.25, .06),
  crossV: new THREE.BoxGeometry(.09, .32, .09), crossH: new THREE.BoxGeometry(.26, .09, .09),
  NB: lathe([[0, 0], [.35, 0], [.35, .07], [.27, .12], [.27, .16], [.22, .22], [0, .23]]),
  neck: new THREE.BoxGeometry(.3, .42, .34), head: new THREE.BoxGeometry(.26, .22, .46), ear: new THREE.BoxGeometry(.07, .13, .07),
  mane: new THREE.BoxGeometry(.08, .46, .1), eye: new THREE.BoxGeometry(.03, .05, .05),
  aura: (() => { const g = new THREE.RingGeometry(.38, .45, 16); g.rotateX(-Math.PI / 2); return g; })()
};
const TOP = { P: .78, N: .93, B: 1.29, R: .93, Q: 1.18, K: 1.45 };
const PSCALE = { P: .86, N: 1.04, B: 1.04, R: 1.04, Q: 1.06, K: 1.08 };
const topOf = tp => TOP[tp] * PSCALE[tp];
/* type badges: pixel glyph on a dark plate, always facing camera */
const BADGE_ROWS = {
  P: ['........', '...xx...', '..xxxx..', '...xx...', '..xxxx..', '..xxxx..', '.xxxxxx.', '........'],
  N: ['...x....', '..xxxx..', '.xxxxxx.', 'xx.xxxx.', '...xxxx.', '..xxxxx.', '.xxxxxx.', '........'],
  B: ['...xx...', '..xx.x..', '..x.xx..', '..xxxx..', '...xx...', '..xxxx..', '.xxxxxx.', '........'],
  R: ['.x.xx.x.', '.xxxxxx.', '..xxxx..', '..xxxx..', '..xxxx..', '.xxxxxx.', '.xxxxxx.', '........'],
  Q: ['x..xx..x', 'xx.xx.xx', '.xxxxxx.', '..xxxx..', '..xxxx..', '.xxxxxx.', 'xxxxxxxx', '........'],
  K: ['...xx...', '..xxxx..', '...xx...', '.xxxxxx.', '..xxxx..', '..xxxx..', '.xxxxxx.', '........']
};
const badgeMats = {};
function badgeMat(tp, side) {
  const key = tp + side; if (badgeMats[key]) return badgeMats[key];
  const c = document.createElement('canvas'); c.width = c.height = 14; const x = c.getContext('2d');
  x.fillStyle = '#06080b'; x.fillRect(1, 0, 12, 14); x.fillRect(0, 1, 14, 12);
  x.fillStyle = side === 'w' ? '#2a3a4c' : '#3a1420'; x.fillRect(2, 1, 10, 12); x.fillRect(1, 2, 12, 10);
  x.fillStyle = side === 'w' ? '#fff3d6' : '#ff5a4a';
  BADGE_ROWS[tp].forEach((r, yy) => [...r].forEach((ch, xx) => { if (ch === 'x') x.fillRect(xx + 3, yy + 3, 1, 1); }));
  const m = new THREE.SpriteMaterial({ map: canvasTex(c), alphaTest: .5, depthTest: false });
  return (badgeMats[key] = m);
}
let SHOW_BADGES = true;
const DIGITS = { 2: ['111', '001', '111', '100', '111'], 3: ['111', '001', '111', '001', '111'], 4: ['101', '101', '111', '001', '001'], 5: ['111', '100', '111', '001', '111'] };
const LIFE_HEART = ['.yy.yy.', 'ywyyyyy', 'yyyyyyy', '.yyyyy.', '..yyy..', '...y...'];
const lifeMats = {};
/* Lives badge: a cream plate with a gold heart and the number of lives, readable on any piece colour. */
function lifeMat(n) {
  n = Math.min(5, n); if (lifeMats[n]) return lifeMats[n];
  const c = document.createElement('canvas'); c.width = 16; c.height = 10; const x = c.getContext('2d');
  x.fillStyle = '#06080b'; x.fillRect(1, 0, 14, 10); x.fillRect(0, 1, 16, 8);
  x.fillStyle = '#fff3d6'; x.fillRect(2, 1, 12, 8); x.fillRect(1, 2, 14, 6);
  const col = { y: '#e0a020', w: '#ffffff' };
  LIFE_HEART.forEach((r, yy) => [...r].forEach((ch, xx) => { if (col[ch]) { x.fillStyle = col[ch]; x.fillRect(2 + xx, 2 + yy, 1, 1); } }));
  x.fillStyle = '#06080b';
  DIGITS[n].forEach((r, yy) => [...r].forEach((ch, xx) => { if (ch === '1') x.fillRect(10 + xx, 2 + yy, 1, 1); }));
  return (lifeMats[n] = new THREE.SpriteMaterial({ map: canvasTex(c), alphaTest: 0.5, depthTest: false }));
}
const SNOW_MAT = new THREE.SpriteMaterial({ map: canvasTex(ICON_CANVAS.snow), alphaTest: 0.5 });
const LOCK_MAT = new THREE.SpriteMaterial({ map: canvasTex(ICON_CANVAS.lock), alphaTest: 0.5 });
const EYE_MAT = new THREE.MeshBasicMaterial({ color: 0x120a10 });
const AURA_MAT = new THREE.MeshBasicMaterial({ color: 0xf3b53c, transparent: true, opacity: .85, depthWrite: false });
const meshes = new Map(); const auras = [];
function part(geo, mat) {
  const m = new THREE.Mesh(geo, mat); m.castShadow = true; m.receiveShadow = true;
  if (mat !== EYE_MAT) m.add(new THREE.Mesh(geo, outlineMat));
  return m;
}
function buildPiece(p) {
  const white = p.s === 'w';
  const baseColor = new THREE.Color(pieceHex(p.t, p.s)).getHex();
  const body = toon(baseColor), acc = toon(white ? 0xe0a83a : (p.mhp > 1 ? 0x55606e : 0x2a1424));
  const g = new THREE.Group(), inner = new THREE.Group(); g.add(inner);
  const add = (geo, mat, x = 0, y = 0, z = 0, rx = 0) => { const m = part(geo, mat); m.position.set(x, y, z); m.rotation.x = rx; inner.add(m); return m; };
  switch (p.t) {
    case 'P': add(GEO.P, body); add(GEO.Pcol, acc, 0, .45); add(GEO.Phead, body, 0, .61); break;
    case 'R': add(GEO.R, body); add(GEO.Rcol, acc, 0, .62); for (let k = 0; k < 4; k++) { const a = k * Math.PI / 2 + Math.PI / 4; add(GEO.merlon, body, Math.cos(a) * .2, .86, Math.sin(a) * .2).rotation.y = -a; } break;
    case 'B': add(GEO.B, body); add(GEO.Bcol, acc, 0, .68); add(GEO.Bhead, body, 0, .7); add(GEO.ball, acc, 0, 1.23); { const sl = add(GEO.slit, EYE_MAT, .02, .98, -.17); sl.rotation.z = .7; } break;
    case 'Q': add(GEO.Q, body); add(GEO.Qcol, acc, 0, .72); add(GEO.Qcrown, body, 0, .74); for (let k = 0; k < 7; k++) { const a = k / 7 * Math.PI * 2; add(GEO.spike, acc, Math.cos(a) * .24, 1.05, Math.sin(a) * .24); } add(GEO.ballL, acc, 0, 1.1); break;
    case 'K': add(GEO.K, body); add(GEO.Kcol, acc, 0, .84); add(GEO.Khead, body, 0, .86); add(GEO.crossV, acc, 0, 1.28); add(GEO.crossH, acc, 0, 1.3); break;
    case 'N':
      add(GEO.NB, body); add(GEO.neck, body, 0, .42, .02, -.15); add(GEO.head, body, 0, .7, -.1); add(GEO.mane, acc, 0, .52, .18, -.15);
      add(GEO.ear, body, -.08, .86, .07); add(GEO.ear, body, .08, .86, .07);
      add(GEO.eye, EYE_MAT, -.135, .74, -.16); add(GEO.eye, EYE_MAT, .135, .74, -.16); break;
  }
  if (!white) inner.rotation.y = Math.PI;
  inner.scale.setScalar(PSCALE[p.t]);
  const badge = new THREE.Sprite(badgeMat(p.t, p.s)); badge.scale.set(.6, .6, 1); badge.position.y = topOf(p.t) + .42; badge.renderOrder = 10; badge.visible = SHOW_BADGES; g.add(badge);
  const a = p.id ? armyById(p.id) : null;
  if (a && (a.ups.length || a.mhp > 1 || a.th || a.gr)) { const r = new THREE.Mesh(GEO.aura, AURA_MAT); r.position.y = 0.015; g.add(r); auras.push(r); g.userData.aura = r; }
  g.userData = Object.assign(g.userData, { k: p.k, t: p.t, s: p.s, body, baseColor, inner, deco: null, decoKey: '', badge });
  return g;
}
function updateDecor(m, p) {
  const ud = m.userData, key = p.hp + '/' + (p.fz > 0 ? 1 : 0) + '/' + (p.ch ? 1 : 0);
  if (ud.decoKey === key) return; ud.decoKey = key;
  if (ud.deco) m.remove(ud.deco);
  const d = new THREE.Group(), top = topOf(p.t) + .82;
  if (p.hp > 1) { const s = new THREE.Sprite(lifeMat(p.hp)); s.scale.set(.5, .31, 1); s.position.set(0, top, 0); s.renderOrder = 11; d.add(s); }
  const extra = p.fz > 0 ? SNOW_MAT : p.ch ? LOCK_MAT : null;
  if (extra) { const s = new THREE.Sprite(extra); s.scale.set(.34, .34, 1); s.position.set(0, top + (p.hp > 1 ? .26 : 0), 0); d.add(s); }
  ud.body.color.set(p.fz > 0 ? 0xdff6ff : ud.baseColor);
  m.add(d); ud.deco = d;
}
function removeMesh(k) { const m = meshes.get(k); if (!m) return; scene.remove(m); if (m.userData.aura) auras.splice(auras.indexOf(m.userData.aura), 1); meshes.delete(k); }
function clearMeshes() { for (const k of [...meshes.keys()]) removeMesh(k); }
function syncMeshes(board) {
  const seen = new Set();
  board.forEach((p, i) => {
    if (!p) return; seen.add(p.k);
    let m = meshes.get(p.k);
    if (m && m.userData.t !== p.t) { removeMesh(p.k); m = null; }
    if (!m) { m = buildPiece(p); meshes.set(p.k, m); scene.add(m); const v = sqPos(i); m.position.copy(v); }
    if (!m.userData.anim) { const v = sqPos(i); m.position.x = v.x; m.position.z = v.z; m.position.y = 0; }
    updateDecor(m, p);
  });
  for (const k of [...meshes.keys()]) if (!seen.has(k)) removeMesh(k);
}

/* ---------- tweens, particles, fx ---------- */
const tweens = [];
const anim = (dur, fn, delay = 0) => new Promise(res => tweens.push({ t: -delay, dur, fn, res }));
const ease = k => k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
const particles = []; const pGeo = new THREE.BoxGeometry(.09, .09, .09); const pMats = {};
const pMat = c => pMats[c] || (pMats[c] = new THREE.MeshBasicMaterial({ color: c }));
function burst(pos, colors, n = 26, sp = 3.2, up = 3.5) {
  for (let i = 0; i < n; i++) {
    const m = new THREE.Mesh(pGeo, pMat(pick(colors))); m.position.copy(pos);
    const a = Math.random() * Math.PI * 2, s = sp * (.4 + Math.random() * .8);
    m.userData.v = new THREE.Vector3(Math.cos(a) * s, up * (.5 + Math.random()), Math.sin(a) * s);
    m.userData.life = .7 + Math.random() * .6; m.userData.max = m.userData.life;
    m.scale.setScalar(.6 + Math.random() * 1.1); scene.add(m); particles.push(m);
  }
}
let shakeT = 0, shakeAmp = 0;
const shake = (amp, tt) => { shakeAmp = Math.max(shakeAmp, amp); shakeT = Math.max(shakeT, tt); };
const flashFx = (a, col = 0xffffff) => { postMat.uniforms.flash.value = a; postMat.uniforms.flashCol.value.set(col); };
function floatText(i, text, color = '#f3b53c') {
  const v = sqPos(i); v.y = 1.4; v.project(camera);
  const s = invCurve((v.x + 1) / 2, (v.y + 1) / 2);
  const el = document.createElement('div'); el.className = 'float'; el.textContent = text; el.style.color = color;
  el.style.left = (s[0] * W) + 'px'; el.style.top = ((1 - s[1]) * H) + 'px';
  document.body.appendChild(el); setTimeout(() => el.remove(), 1250);
}
async function hop(mesh, from, to, knight) {
  const a = sqPos(from), b = sqPos(to), h = (knight ? .9 : .32) + a.distanceTo(b) * .06;
  mesh.userData.anim = true;
  await anim(.3, k => {
    const e = ease(k); mesh.position.lerpVectors(a, b, e); mesh.position.y = Math.sin(Math.PI * k) * h;
    const s = 1 + .18 * Math.sin(Math.PI * k); mesh.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s));
  });
  mesh.userData.anim = false; mesh.position.y = 0;
  anim(.16, k => { const s = 1 - .16 * Math.sin(Math.PI * k); mesh.scale.set(1 / Math.sqrt(s), s, 1 / Math.sqrt(s)); }).then(() => mesh.scale.set(1, 1, 1));
}
async function bounceAnim(mesh, from, to) {
  const a = sqPos(from), b = sqPos(to); mesh.userData.anim = true;
  await anim(.34, k => { const e = Math.sin(Math.PI * k) * .55; mesh.position.lerpVectors(a, b, e); mesh.position.y = Math.sin(Math.PI * k) * .35; });
  mesh.userData.anim = false; mesh.position.copy(a);
}
async function dropIn() {
  const list = [...meshes.values()]; const ps = [];
  list.forEach((m, n) => {
    const tx = m.position.x, tz = m.position.z; m.userData.anim = true; m.position.y = 6;
    ps.push(anim(.42, k => { const e = k * k; m.position.set(tx, 6 * (1 - e), tz); }, n * 0.03 + Math.random() * .05).then(() => {
      m.position.y = 0; m.userData.anim = false; burst(new THREE.Vector3(tx, .05, tz), [0x8a7a66, 0x5c5048], 5, 1.2, 1.2);
    }));
  });
  await Promise.all(ps); shake(.004, .15);
}
function topple(mesh) { if (!mesh) return; anim(.7, k => { mesh.userData.inner.rotation.z = ease(k) * 1.45; mesh.position.y = Math.sin(k * Math.PI) * .2; }); }

/* ============================== game state ============================== */
let uid = 1;
const G = {
  mode: 'title', army: [], gold: 4, relics: [], cons: [], encIndex: 0, anteEncs: [], enc: null, board: null,
  limit: 0, used: 0, moves: [], sel: -1, hover: -1, busy: false, history: [], lastMove: null, targeting: null,
  checksBonus: 0, coffeeUsed: false, token: 0, training: false, lineIx: -1, forced: true, hint: null, hintBusy: false, coach: [], wins: 0, shop: null, skipped: [], usedPz: new Set(),
  st: null, rerender: null
};
const has = id => G.relics.includes(id);
const consSlots = () => 2 + (has('prism') ? 1 : 0);
const armyById = id => G.army.find(a => a.id === id);
const nameOf = a => L(a.names);
const mvOf = a => [...BASE[a.t], ...a.ups.filter(c => !BASE[a.t].includes(c))];
const power = a => a.ups.length * 2 + (a.mhp - 1) * 2 + (a.th ? 1 : 0) + (a.gr ? 1 : 0);
function mkArmy(tp, names) { return { id: uid++, t: tp, names, ups: [], mhp: 1, th: false, gr: false }; }
function pieceFromArmy(a, k, u) { const mv = mvOf(a); return { s: 'w', t: a.t, mv, hp: a.mhp, mhp: a.mhp, fz: 0, u, id: a.id, th: a.th, gr: a.gr, v: valOf(mv), k }; }


/* ---------- encounters ---------- */
function pickPuzzle(kind, ante) {
  const list = BANK[kind], n = list.length;
  const f = Math.min(1, (ante - 1) / 5);
  const lo = Math.floor(f * n * 0.7), hi = Math.min(n, lo + Math.ceil(n * 0.3));
  for (let tries = 0; tries < 60; tries++) {
    const rec = list[rint(lo, hi - 1)]; const id = rec.slice(0, rec.indexOf('|'));
    if (!G.usedPz.has(id) || tries === 59) { G.usedPz.add(id); return Object.assign(parsePuzzle(rec), { rec }); }
  }
  const rec = pick(list); return Object.assign(parsePuzzle(rec), { rec });
}
/* ---------- generated positions: from ante 5 the Lichess bank gives way to random positions with a proven forced mate ---------- */
const GEN_FROM = 5;
let genWorker = null, genSeq = 0;
const genWaiters = new Map(), genCache = new Map();
function workerGen(ante, kind) {
  return new Promise(res => {
    try {
      if (!genWorker) {
        genWorker = new GenWorker();
        genWorker.onmessage = e => { const w = genWaiters.get(e.data.id); genWaiters.delete(e.data.id); if (w) w(e.data.rec); };
        genWorker.onerror = () => { genWorker = null; for (const w of genWaiters.values()) w(null); genWaiters.clear(); };
      }
      const id = ++genSeq; genWaiters.set(id, res); genWorker.postMessage({ id, ante, kind });
    } catch (e) { res(null); }
  });
}
/* Fallback when workers are unavailable: a short search on the main thread, then the hardest bank puzzles. */
function mainThreadGen(ante, kind) {
  const r = generatePuzzle({ ...genSpec(ante, kind), minN: 2, maxN: 2, lives: 0 }, 1500);
  return r ? r.rec : pickPuzzle(2, 99).rec;
}
function generated(ante, kind) {
  const key = ante + ':' + kind;
  if (!genCache.has(key)) genCache.set(key, workerGen(ante, kind).then(rec => rec || mainThreadGen(ante, kind)));
  return genCache.get(key);
}
function prefetchAnte(ante) { if (ante >= GEN_FROM) for (const k of [0, 1, 2]) generated(ante, k); }
function setEncPuzzle(enc, rec, saved) {
  const P = rec ? Object.assign(parsePuzzle(rec), { rec }) : pickPuzzle(enc.kind, enc.ante);
  P.gen = P.id.startsWith('gen');
  let slack = Math.max(enc.kind === 2 ? 0 : 1, [3, 2, 2][enc.kind] - Math.floor((enc.ante - 1) / 2));
  if (enc.boss && enc.boss.id === 'haste') slack = 0;
  if (enc.boss && enc.boss.id === 'chains') slack += 1;
  enc.chains = saved ? saved.chains : (enc.boss && enc.boss.id === 'chains'
    ? shuffle(P.board.map((p, i) => p && p.s === 'w' && p.t !== 'K' && !P.movers.has(i) ? i : -1).filter(i => i >= 0)).slice(0, 2) : []);
  enc.limit = saved ? saved.limit : P.n + slack;
  enc.P = P;
}
function awaitGenerated(enc) {
  enc.ready = generated(enc.ante, enc.kind).then(rec => {
    genCache.delete(enc.ante + ':' + enc.kind);
    setEncPuzzle(enc, rec);
    if (G.anteEncs.includes(enc) && G.mode === 'select' && !ov.hidden) showSelect();
    return enc;
  });
}
function genEnc(ante, kind) {
  const boss = kind === 2 ? pick(BOSSES) : null;
  const enc = { ante, kind, boss, P: null, chains: [], limit: 0, reward: [3, 4, 6][kind] + ante - 1 };
  if (ante >= GEN_FROM) awaitGenerated(enc); else setEncPuzzle(enc, null);
  return enc;
}
const encName = e => e.boss ? L(e.boss.name) : t('tier_name')[e.kind];
/* Places army members on the puzzle's white pieces of the same type: pieces that move in the solution get the strongest members first. */
function buildBoard(enc) {
  const P = enc.P; const b = P.board.map(p => p ? { ...p, mv: p.mv.slice() } : null);
  const taken = new Set();
  for (const tp of ['K', 'Q', 'R', 'B', 'N', 'P']) {
    const sqs = b.map((p, i) => p && p.s === 'w' && p.t === tp ? i : -1).filter(i => i >= 0)
      .sort((x, y) => (P.movers.has(y) ? 1 : 0) - (P.movers.has(x) ? 1 : 0) || x - y);
    const mem = G.army.filter(a => a.t === tp && !taken.has(a.id)).sort((x, y) => power(y) - power(x) || x.id - y.id);
    sqs.forEach((i, n) => { const a = mem[n]; if (!a) return; taken.add(a.id); b[i] = pieceFromArmy(a, b[i].k, b[i].u); });
  }
  if (has('aegis')) b.forEach((p, i) => { if (p && p.s === 'w' && p.t === 'P') b[i] = { ...p, hp: p.hp + 1, mhp: p.mhp + 1 }; });
  for (const i of enc.chains) if (b[i] && b[i].s === 'w') b[i] = { ...b[i], ch: true };
  return b;
}
function newAnte() { const ante = Math.floor(G.encIndex / 3) + 1; G.anteEncs = [0, 1, 2].map(k => genEnc(ante, k)); prefetchAnte(ante + 1); }
function moveLabel(b, m) { const p = b[m.f]; return `${GLY[p.t]}︎ ${sqName(m.f)}→${sqName(m.t)}`; }

/* ============================== UI helpers ============================== */
const hudL = $('#hudL'), hudR = $('#hudR'), statusEl = $('#status'), ov = $('#ov'), scr = $('#scr'), tip = $('#tip'), toastEl = $('#toast');
let toastTimer = 0;
function toast(text, ms = 1800) { toastEl.textContent = text; toastEl.hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => toastEl.hidden = true, ms); }
function setStatus(k, v, cls = '') { G.st = k ? { k, v, cls } : null; paintStatus(); }
function paintStatus() { const s = G.st; statusEl.textContent = s ? t(s.k, s.v) : ''; statusEl.className = s ? s.cls : ''; statusEl.hidden = !s; }
function showOverlay(html) { scr.innerHTML = html; ov.hidden = false; tip.hidden = true; }
function hideOverlay() { ov.hidden = true; }
function heartsHTML(hp) { return hp > 0 ? `<div class="hearts"><span class="lives">♥ ${hp}</span></div>` : ''; }
const relicTip = id => `${L(RELICS[id].name)}|${L(RELICS[id].desc)}`;
const consTip = id => `${L(CONS[id].name)}|${L(CONS[id].desc)}`;
const tname = tp => L(TNAME[tp]);

function pieceInfoHTML(p) {
  if (!p) return `<div class="lbl">${t('piece')}</div><p class="muted">${t('piece_hint')}</p>`;
  const a = p.id ? armyById(p.id) : null;
  const ups = a ? a.ups : [];
  const lines = p.mv.map(c => `<li class="${ups.includes(c) && !BASE[p.t].includes(c) ? 'up' : ''}">${esc(L(MVNAME[c]))}</li>`);
  if (p.mhp > 1 || p.hp > 1) lines.push(`<li class="perk">${t('li_lives')}</li>`);
  if (p.th) lines.push(`<li class="perk">${t('li_thirst')}</li>`);
  if (p.gr) lines.push(`<li class="perk">${t('li_greed')}</li>`);
  if (p.fz > 0) lines.push(`<li class="bad">${t('li_frozen', { n: p.fz })}</li>`);
  if (p.ch) lines.push(`<li class="bad">${t('li_chained')}</li>`);
  if (p.s === 'w' && !a) lines.push(`<li class="bad">${t('li_militia')}</li>`);
  const nm = a ? nameOf(a) : (p.s === 'b' ? t('enemy') : t('militia'));
  return `<div class="pc-head">${gl(p.t, p.s)}<div><div class="pc-name">${esc(nm)}</div><div class="pc-type">${tname(p.t)}${p.s === 'b' ? t('enemy_tag') : ''}</div>${p.hp > 1 || p.mhp > 1 ? heartsHTML(p.hp) : ''}</div></div><ul class="mvlist">${lines.join('')}</ul>`;
}
function armyEntryCard(a) {
  const mv = mvOf(a);
  const lines = mv.map(c => `<li class="${a.ups.includes(c) && !BASE[a.t].includes(c) ? 'up' : ''}">${esc(L(MVNAME[c]))}</li>`);
  if (a.mhp > 1) lines.push(`<li class="perk">${t('li_lives_n', { n: a.mhp })}</li>`);
  if (a.th) lines.push(`<li class="perk">${t('li_thirst')}</li>`);
  if (a.gr) lines.push(`<li class="perk">${t('li_greed')}</li>`);
  return `<div class="pc-head">${gl(a.t, 'w')}<div><div class="pc-name">${esc(nameOf(a))}</div><div class="pc-type">${tname(a.t)}</div>${a.mhp > 1 ? heartsHTML(a.mhp) : ''}</div></div><ul class="mvlist">${lines.join('')}</ul>`;
}
function renderPieceCard() {
  const el = $('#pieceCard');
  if (G.mode === 'play' && G.board) {
    const i = G.hover >= 0 && G.board[G.hover] ? G.hover : G.sel;
    el.innerHTML = pieceInfoHTML(i >= 0 ? G.board[i] : null);
  } else el.innerHTML = G.army.length ? `<div class="lbl">${t('your_army')}</div><p class="muted">${t('army_hint')}</p>` : '';
}
function renderStatic() {
  document.title = t('doc_title');
  $('#hGoal').innerHTML = t('goal');
  $('#hMovesLbl').textContent = t('moves'); $('#hRewLbl').textContent = t('reward'); $('#hRewSub').textContent = t('plus_spare');
  $('#hGoldLbl').textContent = t('gold'); $('#hConsLbl').textContent = t('consumables');
  $('#hMovesBox').dataset.tip = t('tip_moves'); $('#hRewBox').dataset.tip = t('tip_reward');
  $('#bPause').textContent = t('hud_pause');
  $('#bBadges').textContent = SHOW_BADGES ? t('badges_on') : t('badges_off'); $('#bBadges').dataset.tip = t('tip_badges');
  $('#peekBack').textContent = t('back');
}
function renderHUD() {
  renderStatic();
  const e = G.enc;
  if (e) {
    $('#hTitle').innerHTML = `<div class="eyebrow">${(G.training ? t('training') + ' · ' : '') + t('eyebrow_hud', { a: e.ante, k: e.kind + 1 })}</div><div class="hname">${esc(encName(e))}</div><div class="hmate">${e.P ? t(e.P.gen ? 'gen_line' : 'level_line', { n: e.P.n, r: e.P.rating }) : t('gen_pending')}</div>${e.boss ? `<div class="hmod">${esc(L(e.boss.desc))}</div>` : ''}`;
    const left = Math.max(0, G.limit - G.used);
    $('#hMoves').textContent = left; $('#hMovesOf').textContent = t('of', { n: G.limit });
    $('#hMovesBox').classList.toggle('low', G.mode === 'play' && left <= 2);
    $('#hRew').textContent = '$' + e.reward;
  }
  $('#hGold').textContent = '$' + G.gold;
  if (G.gold >= 30) track('gold', { gold: G.gold, training: G.training });
  $('#hRelLbl').textContent = t('relics_n', { n: G.relics.length });
  $('#hRelics').innerHTML = G.relics.map(id => `<div class="slot" data-tip="${esc(relicTip(id))}">${img(id, '')}</div>`).join('') + '<div class="slot empty"></div>'.repeat(Math.max(0, 5 - G.relics.length));
  $('#hCons').innerHTML = G.cons.map((id, ix) => `<button type="button" class="slot${G.targeting && G.targeting.ix === ix ? ' armed' : ''}" data-cons="${ix}" data-tip="${esc(consTip(id) + t('tip_cons_use'))}">${img(id, '')}</button>`).join('') + '<div class="slot empty"></div>'.repeat(Math.max(0, consSlots() - G.cons.length));
  const alive = new Set(G.board ? G.board.filter(p => p && p.id).map(p => p.id) : []);
  $('#armyLbl').textContent = t('army_n', { n: G.army.length });
  $('#armyList').innerHTML = G.army.map(a => {
    const tags = [];
    if (a.ups.length) tags.push(`<span class="tag">+${a.ups.length}</span>`);
    if (a.mhp > 1) tags.push(`<span class="tag hp">♥${a.mhp}</span>`);
    if (a.th || a.gr) tags.push(`<span class="tag pk">${a.th ? '+1' : ''}${a.gr ? '$' : ''}</span>`);
    return `<button type="button" class="arm${alive.has(a.id) ? '' : ' dead'}" data-arm="${a.id}">${gl(a.t, 'w')}<span class="an">${esc(nameOf(a))}</span><span class="tags">${tags.join('')}</span></button>`;
  }).join('');
  renderCoach();
  renderPieceCard();
}
function refreshMarks() {
  while (markGroup.children.length) markGroup.remove(markGroup.children[0]);
  if (!G.board) return;
  if (G.lastMove) { mark(G.lastMove.f, 'fill', 0xf3d35c, .32); mark(G.lastMove.t, 'fill', 0xf3d35c, .45); }
  if (G.mode === 'play') {
    const wk = kingSq(G.board, 'w'); if (wk >= 0 && inCheck(G.board, 'w')) mark(wk, 'fill', 0xe8483b, .7, true);
    const bk = kingSq(G.board, 'b'); if (bk >= 0 && inCheck(G.board, 'b')) mark(bk, 'edge', 0xf3b53c, .9, true);
    const blind = G.enc && G.enc.boss && G.enc.boss.id === 'blind';
    if (G.targeting) {
      targetSquares(G.targeting.id).forEach(i => mark(i, 'frame', 0xb48cff, 1, true, .014));
    } else if (G.sel >= 0) {
      mark(G.sel, 'edge', 0x7cf0a0, 1, false, .014);
      if (!blind) for (const m of G.moves) if (m.f === G.sel) {
        const q = G.board[m.t];
        if (q) mark(m.t, 'frame', q.hp > 1 ? 0xff9a3c : 0xff4a3c, 1, true, .014);
        else mark(m.t, 'dot', 0x7cf0a0, .95, true, .014);
      }
    }
    if (G.hint && G.hint.board === G.board) { mark(G.hint.m.f, 'edge', 0x5fe0ff, 1, true, .016); if (G.hint.lvl > 1) mark(G.hint.m.t, 'frame', 0x5fe0ff, 1, true, .016); }
    if (G.hover >= 0 && G.hover !== G.sel) mark(G.hover, 'fill', 0xffffff, .14);
  }
}

/* ---------- tooltips ---------- */
document.addEventListener('pointerover', e => {
  const tg = e.target.closest('[data-tip]');
  if (tg) { const [h, b] = tg.dataset.tip.split('|'); tip.innerHTML = `<b>${esc(h)}</b>${esc(b || '')}`; tip.hidden = false; }
  const arm = e.target.closest('[data-arm]');
  if (arm) { const a = armyById(+arm.dataset.arm); if (a) $('#pieceCard').innerHTML = armyEntryCard(a); }
});
document.addEventListener('pointerout', e => {
  if (e.target.closest('[data-tip]')) tip.hidden = true;
  if (e.target.closest('[data-arm]')) renderPieceCard();
});
document.addEventListener('pointermove', e => {
  if (tip.hidden) return;
  const x = Math.min(e.clientX + 14, W - tip.offsetWidth - 8), y = Math.min(e.clientY + 14, H - tip.offsetHeight - 8);
  tip.style.left = x + 'px'; tip.style.top = y + 'px';
});

/* ============================== flow ============================== */
/* Main menu backdrop: the demo board behind the menu screens. */
function enterMenu() {
  flushPlaytime(); G.token++; saveProfile(true); closePause(); camDrag = null;
  if (G.mode !== 'menu') { G.board = demoBoard(); G.lastMove = null; clearMeshes(); syncMeshes(G.board); refreshMarks(); }
  G.mode = 'menu'; G.enc = null; G.busy = false; hudL.hidden = hudR.hidden = true; setStatus(null); $('#peekBack').hidden = true;
  document.title = t('doc_title');
}
/* Serialises the run between puzzles so it can be continued from the main menu. */
/* Mid-puzzle snapshot: board, moves used, history for undo, coach state. pendingEnemy means it is the opponent's turn. */
function playSnapshot(pendingEnemy) {
  return {
    board: G.board, used: G.used, limit: G.limit, lastMove: G.lastMove, history: G.history, checks: G.checksBonus, coffee: G.coffeeUsed,
    lineIx: G.lineIx, forced: G.forced, hintsUsed: G.hintsUsed || 0, coach: G.coach, pendingEnemy
  };
}
const savePlay = pendingEnemy => saveRun('play', playSnapshot(pendingEnemy));
function saveRun(screen, play = null) {
  profile.run = {
    play,
    screen, training: G.training, uid, army: G.army, gold: G.gold, relics: G.relics, cons: G.cons, encIndex: G.encIndex,
    wins: G.wins, skipped: G.skipped, usedPz: [...G.usedPz], upgrades: G.upgrades || 0, shop: screen === 'shop' ? G.shop : null,
    encs: G.anteEncs.map(e => ({ ante: e.ante, kind: e.kind, boss: e.boss ? e.boss.id : null, rec: e.P ? e.P.rec : null, chains: e.chains, limit: e.limit, reward: e.reward }))
  };
  saveProfile();
}
function continueRun() {
  const r = profile.run; if (!r) return;
  uid = r.uid; G.training = r.training; G.army = r.army; G.gold = r.gold; G.relics = r.relics; G.cons = r.cons; G.encIndex = r.encIndex;
  G.wins = r.wins; G.skipped = r.skipped; G.usedPz = new Set(r.usedPz); G.upgrades = r.upgrades; setPromoRank(7);
  G.anteEncs = r.encs.map(e => {
    const enc = { ante: e.ante, kind: e.kind, boss: BOSSES.find(b => b.id === e.boss) || null, P: null, chains: e.chains, limit: e.limit, reward: e.reward };
    if (e.rec) setEncPuzzle(enc, e.rec, e); else awaitGenerated(enc);
    return enc;
  });
  prefetchAnte(G.anteEncs[0].ante + 1);
  G.mode = 'select'; hudL.hidden = hudR.hidden = false;
  if (r.screen === 'shop' && r.shop) { G.enc = G.anteEncs[Math.max(0, G.encIndex - 1) % 3]; G.shop = r.shop; G.mode = 'shop'; G.rerender = renderShop; renderShop(); }
  else if (r.screen === 'won') { G.enc = G.anteEncs[Math.max(0, G.encIndex - 1) % 3]; showShop(); }
  else if (r.screen === 'play' && r.play && G.anteEncs[G.encIndex % 3].P) { G.enc = G.anteEncs[G.encIndex % 3]; resumeLevel(r.play); }
  else showSelect();
}
const langBtn = () => `<button class="btn ghost small" data-act="title" type="button">${t('m_menu')}</button>`;
function demoBoard() {
  const b = new Array(64).fill(null); let k = 900;
  const put = (i, tp, s) => { const mv = BASE[tp].slice(); b[i] = { s, t: tp, mv, hp: 1, mhp: 1, fz: 0, u: true, v: valOf(mv), k: k++ }; };
  put(4, 'K', 'w'); put(0, 'R', 'w'); put(2, 'B', 'w'); put(6, 'N', 'w'); [9, 11, 12, 22].forEach(i => put(i, 'P', 'w'));
  put(60, 'K', 'b'); put(57, 'N', 'b'); [50, 52, 53, 45].forEach(i => put(i, 'P', 'b')); put(27, 'Q', 'w');
  return b;
}
function newRun(training = false) {
  uid = 1; G.training = training; track('runStart', { training });
  G.army = ARMY_START.map(([tp, nm]) => mkArmy(tp, nm));
  G.gold = 4; G.relics = []; G.cons = ['sand']; G.encIndex = 0; G.wins = 0; G.enc = null; G.skipped = []; G.usedPz = new Set(); G.upgrades = 0; setPromoRank(7);
  newAnte(); track('ante', { ante: 1, training }); hudL.hidden = hudR.hidden = false; showSelect();
}
function showSelect() {
  G.mode = 'select'; setStatus(null); G.sel = -1; G.targeting = null; G.lastMove = null; G.hover = -1;
  const enc = G.anteEncs[G.encIndex % 3]; G.enc = enc;
  if (!enc.P) {
    hudL.hidden = hudR.hidden = false; renderHUD();
    G.rerender = renderGenWait; renderGenWait();
    return;
  }
  G.board = buildBoard(enc); G.limit = enc.limit + (has('hourglass') ? 2 : 0); G.used = 0;
  clearMeshes(); syncMeshes(G.board); refreshMarks(); dropIn();
  renderHUD();
  G.rerender = renderSelect; renderSelect();
  saveRun('select');
}
function renderSelect() {
  const cur = G.encIndex % 3, enc = G.enc;
  const cards = G.anteEncs.map((e, ix) => {
    const state = ix < cur ? 'done' : ix === cur ? 'cur' : 'next';
    const lim = e.limit + (has('hourglass') ? 2 : 0);
    let body = !e.P ? `<div class="kv"><span>${t('reward')}</span><b class="gold">$${e.reward}</b></div><p class="muted">${t('gen_pending')}</p>`
      : `<div class="kv"><span>${t('mate_in', { n: '' }).trim()}</span><b class="gold">${e.P.n}</b></div><div class="kv"><span>${t('limit')}</span><b>${lim}</b></div><div class="kv"><span>${t('reward')}</span><b class="gold">$${e.reward}</b></div><div class="kv"><span>${t(e.P.gen ? 'rating_gen' : 'rating')}</span><b>${e.P.gen ? '~' : ''}${e.P.rating}</b></div>`;
    if (e.P && e.P.gen) body += `<div class="gen-tag">${t('gen_tag')}</div>`;
    if (e.boss) body += `<div class="boss-mod">${esc(L(e.boss.desc))}</div>`;
    if (state === 'cur') {
      body += miniBoard(e);
      body += `<div class="row-btns"><button class="btn red" data-act="play" type="button">${t('play')}</button>${e.kind < 2 ? `<button class="btn ghost small" data-act="skip" type="button" data-tip="${esc(t('tip_skip'))}">${t('skip')}</button>` : ''}</div><button class="btn ghost small" data-act="peek" type="button">${t('peek')}</button>`;
    } else if (state === 'done') body += `<div class="kv"><span>${t('result')}</span><b>${G.skipped.includes(ix) ? t('skipped') : t('solved')}</b></div>`;
    return `<div class="card blind k${e.kind} ${state}"><div class="band">${t('tier')[e.kind]}</div><h3>${esc(encName(e))}</h3>${body}</div>`;
  }).join('');
  showOverlay(`<div class="scr-head"><div class="eyebrow">${(G.training ? t('training') + ' · ' : '') + t('eyebrow_sel', { a: enc.ante, w: G.wins, g: G.gold })}</div><h2>${t('choose')}</h2>${langBtn()}</div><div class="cards">${cards}</div>`);
}
function renderGenWait() {
  showOverlay(`<div class="scr-head"><div class="eyebrow">${t('eyebrow_hud', { a: G.enc.ante, k: G.enc.kind + 1 })}</div><h2>${t('gen_wait_title')}</h2></div>
    <div class="gen-wait" aria-hidden="true">${['K', 'Q', 'R', 'B', 'N', 'P'].map((tp, i) => `<span style="animation-delay:${i * .12}s">${gl(tp, i % 2 ? 'b' : 'w')}</span>`).join('')}</div>
    <p class="sub">${t('gen_wait_sub')}</p>
    <div class="row-btns">${langBtn()}</div>`);
}
function miniBoard(enc) {
  const b0 = buildBoard(enc); const b = applyMove(b0, enc.P.init); const lm = enc.P.init;
  let h = '<div class="mini" aria-hidden="true">';
  for (let y = 7; y >= 0; y--) for (let x = 0; x < 8; x++) {
    const i = y * 8 + x, p = b[i];
    h += `<i class="${(x + y) % 2 === 0 ? 'd' : 'l'}${p && (p.hp > 1 || p.ch) ? ' hp2' : ''}${i === lm.f || i === lm.t ? ' lm' : ''}">${p ? gl(p.t, p.s) : ''}</i>`;
  }
  return h + '</div>';
}
/* Pause (Esc): resume, sound, camera reset, give up, quit to the main menu. */
const pauseEl = document.createElement('div'); pauseEl.id = 'pause'; pauseEl.hidden = true; document.body.appendChild(pauseEl);
let pauseOpen = false, pauseGiveUpArmed = 0;
function renderPause() {
  const st = profile.settings, inPlay = G.mode === 'play';
  const armed = Date.now() - pauseGiveUpArmed < 3000;
  pauseEl.innerHTML = `<div class="pause-box" role="dialog" aria-modal="true" aria-labelledby="pauseTitle">
    <h2 id="pauseTitle">${t('pause_title')}</h2>
    <button class="btn gold" data-pause="resume" type="button">${t('pause_resume')}</button>
    <div class="set-row"><span>${t('set_sound')}</span><div class="seg" role="group"><button type="button" class="seg-b${st.sound ? ' on' : ''}" data-pause="sound-on" aria-pressed="${st.sound}">${t('on')}</button><button type="button" class="seg-b${st.sound ? '' : ' on'}" data-pause="sound-off" aria-pressed="${!st.sound}">${t('off')}</button></div></div>
    <div class="set-row"><label for="pauseVol">${t('set_volume')}</label><input id="pauseVol" type="range" min="0" max="100" step="5" value="${Math.round(st.volume * 100)}"></div>
    <button class="btn ghost" data-pause="camera" type="button">${t('pause_camera')}</button>
    ${inPlay ? `<button class="btn red" data-pause="giveup" type="button">${armed ? t('sure') : t('give_up')}</button>` : ''}
    <button class="btn ghost" data-pause="menu" type="button">${t('pause_menu')}</button>
    <p class="muted">${t('pause_hint')}</p>
  </div>`;
  const vol = pauseEl.querySelector('#pauseVol');
  vol.addEventListener('input', () => { st.volume = vol.value / 100; applySettings('volume'); saveProfile(); });
  vol.addEventListener('change', () => SFX.coin());
}
function openPause() {
  if (!['play', 'select', 'shop', 'result', 'over'].includes(G.mode)) return;
  pauseOpen = true; pauseGiveUpArmed = 0; tip.hidden = true; renderPause(); pauseEl.hidden = false;
  const b = pauseEl.querySelector('[data-pause=resume]'); if (b) b.focus();
}
function closePause() { pauseOpen = false; pauseEl.hidden = true; }
pauseEl.addEventListener('click', e => {
  const b = e.target.closest('[data-pause]');
  if (!b) { if (e.target === pauseEl) closePause(); return; }
  const st = profile.settings;
  switch (b.dataset.pause) {
    case 'resume': closePause(); break;
    case 'sound-on': case 'sound-off': st.sound = b.dataset.pause === 'sound-on'; saveProfile(); applySettings('sound'); renderPause(); SFX.select(); break;
    case 'camera': resetCamera(); closePause(); break;
    case 'giveup':
      if (Date.now() - pauseGiveUpArmed < 3000) { closePause(); if (G.mode === 'play') loseLevel('lose_giveup'); }
      else { pauseGiveUpArmed = Date.now(); renderPause(); setTimeout(() => { if (pauseOpen) renderPause(); }, 3050); }
      break;
    case 'menu': closePause(); showMenu(); break;
  }
});
function resumeLevel(snap) {
  G.token++; const tok = G.token;
  setPromoRank(has('crown') ? 6 : 7);
  Object.assign(G, {
    board: snap.board, used: snap.used, limit: snap.limit, lastMove: snap.lastMove, history: snap.history || [], checksBonus: snap.checks,
    coffeeUsed: snap.coffee, lineIx: snap.lineIx, forced: snap.forced, hintsUsed: snap.hintsUsed, coach: snap.coach || [],
    sel: -1, hover: -1, targeting: null, hint: null, mode: 'play', rerender: null
  });
  hideOverlay(); $('#peekBack').hidden = true; hudL.hidden = hudR.hidden = false;
  clearMeshes(); syncMeshes(G.board);
  G.moves = legal(G.board, 'w');
  renderHUD(); refreshMarks();
  if (snap.pendingEnemy) { G.busy = true; enemyTurn(tok); }
  else { G.busy = false; renderCoach(); setStatus('st_your', { n: G.limit - G.used }, inCheck(G.board, 'w') ? 'check' : ''); }
}
async function startLevel() {
  const enc = G.enc; G.token++; const tok = G.token;
  setPromoRank(has('crown') ? 6 : 7);
  G.board = buildBoard(enc);
  G.limit = enc.limit + (has('hourglass') ? 2 : 0); G.used = 0; G.history = []; G.checksBonus = 0; G.coffeeUsed = false;
  G.lastMove = null; G.sel = -1; G.hover = -1; G.targeting = null; G.busy = true; G.mode = 'play'; G.rerender = null;
  G.lineIx = -1; G.forced = true; G.hint = null; G.coach = []; G.hintsUsed = 0;
  hideOverlay(); $('#peekBack').hidden = true;
  clearMeshes(); syncMeshes(G.board); renderHUD(); refreshMarks();
  setStatus('st_opp_first', null, 'think');
  await dropIn(); if (tok !== G.token) return;
  await wait(350); if (tok !== G.token) return;
  const init = enc.P.init; const label = moveLabel(G.board, init);
  const ev = await executeMove(init, 'b'); if (!ev || tok !== G.token) return;
  if (has('frost')) {
    const en = G.board.map((p, i) => p && p.s === 'b' && p.t !== 'K' ? i : -1).filter(i => i >= 0);
    if (en.length) { const i = pick(en); G.board[i] = { ...G.board[i], fz: 3 }; syncMeshes(G.board); floatText(i, t('fl_frozen'), '#9fdcff'); }
  }
  G.moves = legal(G.board, 'w'); G.busy = false; G.lineIx = 0;
  if (G.training) coachSay([['coach_start', { mv: label, n: enc.P.n, w: () => plural(enc.P.n) }]]);
  renderHUD(); refreshMarks();
  if (!G.moves.length) return loseLevel(inCheck(G.board, 'w') ? 'lose_mate' : 'lose_stale');
  savePlay(false);
  setStatus('st_opp_moved', { mv: label }, inCheck(G.board, 'w') ? 'check' : '');
}
function skipEnc() {
  G.skipped.push(G.encIndex % 3);
  if (G.cons.length < consSlots()) { const id = pick(Object.keys(CONS)); G.cons.push(id); toast(t('toast_got_cons', { name: L(CONS[id].name) })); }
  else { G.gold += 3; toast(t('toast_slots_full')); }
  SFX.coin(); advanceEnc(); showSelect();
}
function advanceEnc() { G.encIndex++; if (G.encIndex % 3 === 0) { G.skipped = []; newAnte(); track('ante', { ante: G.anteEncs[0].ante, training: G.training }); } }

/* ---------- moves ---------- */
async function executeMove(m, side) {
  const tok = G.token;
  const mover = G.board[m.f], ev = {};
  if (!mover || mover.s !== side) return null;
  const nb = applyMove(G.board, m, ev);
  const mesh = meshes.get(mover.k);
  if (ev.bounce) {
    if (mesh) await bounceAnim(mesh, m.f, m.t);
    if (tok !== G.token) return null;
    SFX.bounce(); shake(.006, .18); flashFx(.18, 0xff8060);
    burst(sqPos(m.t).setY(.8), [0xe8483b, 0xffffff], 10, 1.6, 2);
    floatText(m.t, '−1 ♥', '#fff3d6');
  } else {
    if (mesh) await hop(mesh, m.f, m.t, mover.t === 'N');
    if (tok !== G.token) return null;
    if (ev.cap) {
      SFX.capture(); shake(.011, .26); flashFx(.22);
      const cols = ev.cap.s === 'w' ? [0xefe2c4, 0xe0a83a, 0xffffff] : [0xa3283c, 0x2a1424, 0xff6a5c];
      burst(sqPos(m.t).setY(.5), cols, 30);
    } else SFX.move();
  }
  G.board = nb; G.lastMove = m;
  if (side === 'w') {
    const actor = ev.bounce ? m.f : m.t; const p = G.board[actor];
    if (ev.cap || ev.bounce) {
      if (p.gr) { G.gold += 1; floatText(actor, '+$1'); SFX.coin(); }
      if (p.th) { G.limit += 1; floatText(actor, t('fl_move'), '#7cf0a0'); }
      if (has('grail') && p.hp < p.mhp) { G.board[actor] = { ...p, hp: p.hp + 1 }; floatText(actor, '+1 ♥', '#ff8a9a'); }
      if (ev.cap && ev.cap.t !== 'P' && has('butcher')) { G.gold += 2; floatText(m.t, '+$2'); SFX.coin(); }
    }
    if (ev.promo && p.id) {
      const a = armyById(p.id); a.t = 'Q'; a.ups = a.ups.filter(c => c[0] !== 'P' && !BASE.Q.includes(c));
      track('promo', { training: G.training });
      toast(t('toast_promo_own', { name: nameOf(a) })); SFX.magic(); burst(sqPos(m.t).setY(.6), [0xf3b53c, 0xfff3c0], 36, 2.4, 5);
    }
  } else if (ev.promo) { toast(t('toast_promo_enemy')); SFX.magic(); }
  G.board = G.board.map(p => p && p.s === side && p.fz > 0 ? { ...p, fz: p.fz - 1 } : p);
  syncMeshes(G.board);
  return ev;
}
async function playerMove(m) {
  G.busy = true; const tok = G.token;
  G.history.push({ board: G.board, used: G.used, limit: G.limit, lastMove: G.lastMove, gold: G.gold, checks: G.checksBonus, coffee: G.coffeeUsed, lineIx: G.lineIx, forced: G.forced });
  const sl = G.lineIx >= 0 ? G.enc.P.sol[G.lineIx] : null, onLine = !!sl && sl.f === m.f && sl.t === m.t;
  G.lineIx = onLine ? G.lineIx + 1 : -1; G.hint = null;
  G.sel = -1; refreshMarks(); selLight.intensity = 0;
  const ev = await executeMove(m, 'w'); if (!ev || tok !== G.token) return;
  if (has('coffee') && !G.coffeeUsed) { G.coffeeUsed = true; floatText(m.t, t('fl_coffee'), '#e9c98a'); } else G.used++;
  const check = inCheck(G.board, 'b');
  if (check) { SFX.check(); if (has('gambit') && G.checksBonus < 3) { G.checksBonus++; G.limit++; floatText(kingSq(G.board, 'b'), t('fl_gambit'), '#7cf0a0'); } }
  renderHUD(); refreshMarks();
  if (!hasLegal(G.board, 'b')) { await wait(250); if (tok !== G.token) return; return winLevel(check ? 'mate' : 'stalemate'); }
  if (G.used >= G.limit) { await wait(300); if (tok !== G.token) return; return loseLevel('lose_limit'); }
  if (check) setStatus('st_check', null, 'check');
  if (G.training) {
    if (onLine) coachSay([['coach_good']], 'good');
    else if (G.forced) {
      const left = G.limit - G.used;
      if (left <= 4) { const ok = withDeadline(900, () => bLoses(G.board, left)); if (ok === false) { G.forced = false; coachSay([['coach_missed']], 'warn'); } }
    }
    renderHUD();
  }
  savePlay(true);
  await enemyTurn(tok);
}
async function enemyTurn(tok) {
  setStatus('st_think', null, 'think'); await wait(320); if (tok !== G.token) return;
  const m = aiChoose(G.board, G.enc, G.limit - G.used);
  if (!m) return winLevel('stalemate');
  await wait(60); if (tok !== G.token) return;
  const why = enemyWhy(G.board, m), lbl = moveLabel(G.board, m), wasOn = G.lineIx >= 0;
  if (wasOn) { const sb = G.enc.P.sol[G.lineIx]; G.lineIx = sb && sb.f === m.f && sb.t === m.t ? G.lineIx + 1 : -1; }
  const ev = await executeMove(m, 'b'); if (!ev || tok !== G.token) return;
  if (G.training) coachSay([['coach_enemy', { mv: lbl, why: () => t(why) }], ...(wasOn && G.lineIx < 0 ? [['coach_deviate']] : [])]);
  G.moves = legal(G.board, 'w');
  const check = inCheck(G.board, 'w');
  renderHUD(); refreshMarks();
  if (!G.moves.length) { await wait(300); if (tok !== G.token) return; return loseLevel(check ? 'lose_mate' : 'lose_stale'); }
  G.busy = false; renderCoach(); savePlay(false);
  if (check) { SFX.check(); setStatus('st_in_check', null, 'check'); } else setStatus('st_your', { n: G.limit - G.used });
}
async function winLevel(kind) {
  G.busy = true; G.mode = 'result'; const tok = ++G.token;
  const bk = kingSq(G.board, 'b'); topple(meshes.get(G.board[bk] && G.board[bk].k));
  SFX.win(); flashFx(.5, 0xfff0b0); shake(.014, .4);
  burst(sqPos(bk).setY(.8), [0xf3b53c, 0xfff3c0, 0xe8483b, 0x2f8fe0], 60, 3.5, 6);
  setStatus(kind === 'mate' ? 'st_mate' : 'st_stale');
  const e = G.enc, unused = Math.max(0, G.limit - G.used);
  const interest = has('piggy') ? unused : Math.floor(unused / 2);
  const exact = G.used <= e.P.n ? 2 : 0;
  const total = e.reward + interest + exact;
  G.gold += total; G.wins++;
  { const lm = G.lastMove, mater = lm && G.board[lm.t] ? G.board[lm.t].t : null;
    track('win', { training: G.training, result: kind, kind: e.kind, boss: e.boss ? e.boss.id : null, exact: !!exact, gold: total, wins: G.wins,
      mater, theme: kind === 'mate' && lm ? mateTheme(G.board, lm) : null, lastMove: G.used >= G.limit, hintsUsed: G.hintsUsed, generated: !!e.P.gen }); }
  advanceEnc(); saveRun('won'); saveProfile(true);
  renderHUD();
  await wait(1100); if (tok !== G.token) return;
  const data = { kind, used: G.used, limit: G.limit, unused, interest, exact, total, name: encName(e), reward: e.reward };
  G.rerender = () => renderWin(data, false); renderWin(data, true);
  setTimeout(SFX.coin, 200); setTimeout(SFX.coin, 450); setTimeout(SFX.coin, 700);
}
function renderWin(d, animate) {
  const st = n => animate ? ` style="animation-delay:${n}s"` : ' style="animation:none;opacity:1"';
  showOverlay(`
    <h2 class="big gold">${d.kind === 'mate' ? t('st_mate') : t('st_stale')}</h2>
    <p class="sub">${t(d.kind === 'mate' ? 'win_mate' : 'win_stale', { u: d.used, w: plural(d.used), l: d.limit })}</p>
    <div class="tally">
      <div${st(.1)}><span>${esc(encName(G.enc))}</span><b>$${d.reward}</b></div>
      <div${st(.3)}><span>${t('spare', { n: d.unused })}${has('piggy') ? t('piggy') : ''}</span><b>$${d.interest}</b></div>
      ${d.exact ? `<div${st(.5)}><span>${t('exact')}</span><b>$${d.exact}</b></div>` : ''}
      <div class="tot"${st(.7)}><span>${t('total')}</span><b>$${d.total}</b></div>
    </div>
    <div class="row-btns"><button class="btn gold" data-act="toShop" type="button">${t('to_shop')}</button>${langBtn()}</div>`);
}
async function loseLevel(reasonKey) {
  G.busy = true; const tok = ++G.token;
  const wk = kingSq(G.board, 'w'); if (wk >= 0) topple(meshes.get(G.board[wk].k));
  SFX.lose(); flashFx(.4, 0xff3020); shake(.012, .35); setStatus(reasonKey, null, 'check');
  if (has('phoenix') && reasonKey !== 'lose_giveup' && !G.training) {
    G.relics.splice(G.relics.indexOf('phoenix'), 1); track('phoenix', { training: G.training });
    saveRun('select'); saveProfile(true);
    await wait(900); if (tok !== G.token) return; toast(t('toast_phoenix'), 2400); SFX.magic();
    flashFx(.6, 0xffa040); startLevel(); return;
  }
  G.mode = 'over';
  if (!G.training) profile.run = null; else saveRun('select');
  saveProfile(true);
  await wait(1000); if (tok !== G.token) return;
  const data = { reasonKey, ante: G.enc.ante, wins: G.wins, army: G.army.length };
  G.rerender = () => renderLose(data, false); renderLose(data, true);
}
function renderLose(d, animate) {
  const st = n => animate ? ` style="animation-delay:${n}s"` : ' style="animation:none;opacity:1"';
  if (G.training) {
    showOverlay(`
    <h2 class="big red">${t('defeat')}</h2>
    <p class="sub">${esc(t(d.reasonKey))}. ${t('train_lose_note')}</p>
    <div class="row-btns"><button class="btn red" data-act="retry" type="button">${t('retry')}</button><button class="btn violet" data-act="nextPz" type="button">${t('next_puzzle')}</button><button class="btn ghost" data-act="title" type="button">${t('to_menu')}</button>${langBtn()}</div>`);
    return;
  }
  showOverlay(`
    <h2 class="big red">${t('defeat')}</h2>
    <p class="sub">${esc(t(d.reasonKey))}.</p>
    <div class="tally">
      <div${st(.1)}><span>${t('reached')}</span><b>${d.ante}</b></div>
      <div${st(.3)}><span>${t('wins_run')}</span><b>${d.wins}</b></div>
      <div class="tot"${st(.5)}><span>${t('record')}</span><b>${t('record_v', { a: profile.stats.bestAnte, w: profile.stats.bestWins })}</b></div>
    </div>
    <div class="row-btns"><button class="btn red" data-act="start" type="button">${t('new_run')}</button><button class="btn ghost" data-act="title" type="button">${t('to_menu')}</button>${langBtn()}</div>`);
}

/* ---------- consumables ---------- */
function targetSquares(id) {
  const tg = CONS[id].target, out = [];
  G.board.forEach((p, i) => {
    if (!p) return;
    if (tg === 'enemy' && p.s === 'b' && p.t !== 'K') out.push(i);
    if (tg === 'enemyPawn' && p.s === 'b' && p.t === 'P') out.push(i);
    if (tg === 'own' && p.s === 'w' && p.t !== 'K') out.push(i);
  });
  return out;
}
function useCons(ix) {
  if (G.mode !== 'play' || G.busy) { toast(t('toast_cons_turn')); return; }
  const id = G.cons[ix]; if (!id) return;
  if (G.targeting && G.targeting.ix === ix) { G.targeting = null; renderHUD(); refreshMarks(); setStatus('st_your', { n: G.limit - G.used }); return; }
  const c = CONS[id];
  if (c.target) {
    if (!targetSquares(id).length) { toast(t('toast_no_target')); return; }
    G.targeting = { ix, id }; G.sel = -1; renderHUD(); refreshMarks();
    setStatus('st_target', { name: L(c.name) }, 'target'); SFX.select(); return;
  }
  if (id === 'sand') { G.limit += 3; toast(t('toast_sand')); }
  if (id === 'rewind') {
    const h = G.history.pop(); if (!h) { toast(t('toast_nothing_undo')); return; }
    Object.assign(G, { board: h.board, used: h.used, limit: h.limit, lastMove: h.lastMove, gold: h.gold, checksBonus: h.checks, coffeeUsed: h.coffee, lineIx: h.lineIx, forced: h.forced, hint: null });
    syncMeshes(G.board); G.moves = legal(G.board, 'w'); toast(t('toast_rewind'));
  }
  G.cons.splice(ix, 1); SFX.magic(); flashFx(.25, 0xb48cff); renderHUD(); refreshMarks(); afterConsumable();
}
function applyTarget(i) {
  const { ix, id } = G.targeting;
  if (!targetSquares(id).includes(i)) { toast(t('toast_bad_target')); return; }
  const p = G.board[i]; const b = G.board.slice();
  if (id === 'ice') { b[i] = { ...p, fz: 3 }; floatText(i, t('fl_frozen'), '#9fdcff'); burst(sqPos(i).setY(.6), [0x9fdcff, 0xffffff], 20, 1.8, 3); }
  if (id === 'hammer') { b[i] = null; shake(.014, .3); burst(sqPos(i).setY(.4), [0xa3283c, 0x2a1424, 0xb9c6cf], 34); SFX.capture(); }
  if (id === 'bless') { b[i] = { ...p, hp: p.hp + 1, mhp: p.mhp + 1 }; floatText(i, '+1 ♥', '#ff8a9a'); burst(sqPos(i).setY(.8), [0xfff3c0, 0xff8a9a], 18, 1.4, 3); }
  G.board = b; G.cons.splice(ix, 1); G.targeting = null; SFX.magic();
  syncMeshes(G.board); G.moves = legal(G.board, 'w'); renderHUD(); refreshMarks(); afterConsumable();
}
function afterConsumable() {
  if (G.mode === 'play') savePlay(false);
  if (!hasLegal(G.board, 'b')) { winLevel(inCheck(G.board, 'b') ? 'mate' : 'stalemate'); return; }
  setStatus('st_your', { n: G.limit - G.used });
}


/* ============================== training coach ============================== */
function findHintMove() {
  const P = G.enc.P, left = G.limit - G.used;
  if (G.lineIx >= 0 && P.sol[G.lineIx]) {
    const s = P.sol[G.lineIx], m = G.moves.find(x => x.f === s.f && x.t === s.t);
    if (m) return { m, sure: true, n: Math.ceil((P.sol.length - G.lineIx) / 2) };
  }
  const found = searchMate(G.board, Math.min(left, 5), 2500);
  if (found) return { m: found.m, sure: true, n: found.n };
  let best = null, bs = -1e9;
  for (const m of G.moves) {
    const nb = applyMove(G.board, m); const chk = inCheck(nb, 'b');
    const sc = (chk ? 50 - legal(nb, 'b').length * 3 : 0) + (m.c ? G.board[m.t].v * 4 : 0) - evalB(nb);
    if (sc > bs) { bs = sc; best = m; }
  }
  return best ? { m: best, sure: false, n: 0 } : null;
}
const capFirst = s => s.charAt(0).toUpperCase() + s.slice(1);
function explainMove(b, m, sure, n) {
  const p = b[m.f], ev = {}, nb = applyMove(b, m, ev), tp = p.t;
  const head = [['ex_head', { piece: () => capFirst(tname(tp)), from: sqName(m.f), to: sqName(m.t) }]];
  const parts = [];
  if (ev.cap) { const vt = ev.cap.t; parts.push(['ex_capture', { victim: () => tname(vt).toLowerCase(), sq: sqName(m.t) }]); }
  if (ev.bounce) parts.push(['ex_bounce']);
  const bl = legal(nb, 'b'), chk = inCheck(nb, 'b');
  let idea = chk ? 'idea_check' : ev.cap ? 'idea_capture' : 'idea_quiet';
  if (!bl.length) {
    if (chk) { parts.push(['ex_mate']); const th = mateTheme(nb, m); if (th) parts.push([th]); } else parts.push(['ex_stale']);
  } else {
    if (chk) {
      if (attackersOf(nb, kingSq(nb, 'b'), 'w') >= 2) parts.push(['ex_double']);
      const list = bl.slice(0, 3).map(x => moveLabel(nb, x)).join(', ') + (bl.length > 3 ? '…' : '');
      parts.push([bl.length === 1 ? 'ex_check_1' : 'ex_check_n', { n: bl.length, list }]);
    } else {
      const thr = legal(nb, 'w').find(x => { const b2 = applyMove(nb, x); return inCheck(b2, 'b') && !hasLegal(b2, 'b'); });
      if (thr) parts.push(['ex_threat', { mv: moveLabel(nb, thr) }]);
      const k = kingSq(nb, 'b');
      const sqs = kingRing(nb, k).filter(i => !(nb[i] && nb[i].s === 'b') && attacked(nb, i, 'w') && !attacked(b, i, 'w')).map(sqName);
      if (sqs.length) parts.push(['ex_squares', { sq: sqs.join(', ') }]);
    }
    if (tp !== 'K' && !ev.bounce && attacked(nb, m.t, 'b') && (!ev.cap || ev.cap.v < p.v)) { parts.push(['ex_sac']); if (!chk) idea = 'idea_sac'; }
    parts.push(sure ? ['ex_forced', { n, w: () => plural(n) }] : ['ex_unsure']);
  }
  return { p1: [['hint1', { piece: () => tname(tp).toLowerCase(), from: sqName(m.f) }], [idea]], p2: [...head, ...parts] };
}
function enemyWhy(b, m) {
  if (inCheck(b, 'b')) {
    if (b[m.f].t === 'K') return 'why_escape';
    return b[m.t] ? 'why_capture' : 'why_block';
  }
  if (inCheck(applyMove(b, m), 'w')) return 'why_check';
  return b[m.t] ? 'why_take' : 'why_quiet';
}
function coachSay(parts, cls = '') { G.coach.push({ parts, cls }); if (G.coach.length > 6) G.coach.shift(); }
const partsHTML = parts => parts.map(([k, v]) => t(k, v)).join(' ');
function renderCoach() {
  const blk = $('#coachBlk'); const on = G.training && G.mode === 'play'; blk.hidden = !on; if (!on) return;
  $('#coachLbl').textContent = t('coach');
  const cur = G.hint && G.hint.board === G.board ? G.hint : null;
  let h = '';
  if (G.hintBusy) h += `<p class="hint">${t('coach_thinking')}</p>`;
  else if (cur) h += `<p class="hint">${partsHTML(cur.lvl > 1 ? cur.ex.p2 : cur.ex.p1)}</p>`;
  h += G.coach.slice(-3).reverse().map(c => `<p class="${c.cls}">${partsHTML(c.parts)}</p>`).join('');
  if (!h) h = `<p>${t('coach_idle')}</p>`;
  $('#coachText').innerHTML = h;
  const bh = $('#bHint'); bh.textContent = cur && cur.lvl === 1 ? t('hint_more') : t('hint_btn');
  bh.disabled = G.busy || G.hintBusy || !!(cur && cur.lvl > 1);
  const bp = $('#bHintPlay'); bp.textContent = t('hint_play'); bp.hidden = !(cur && cur.lvl > 1); bp.disabled = G.busy;
  const bu = $('#bUndo'); bu.textContent = t('undo_btn'); bu.disabled = G.busy || !G.history.length;
}
function askHint() {
  if (!G.training || G.mode !== 'play' || G.busy || G.hintBusy) return;
  const cur = G.hint && G.hint.board === G.board ? G.hint : null;
  if (cur) { cur.lvl = 2; G.sel = -1; SFX.select(); renderHUD(); refreshMarks(); return; }
  G.hintBusy = true; renderCoach();
  setTimeout(() => {
    const r = findHintMove(); G.hintBusy = false; G.hintsUsed++; track('hint');
    if (r) { G.hint = { board: G.board, m: r.m, lvl: 1, ex: explainMove(G.board, r.m, r.sure, r.n) }; SFX.magic(); }
    renderHUD(); refreshMarks();
  }, 40);
}
function playHint() {
  const cur = G.hint && G.hint.board === G.board ? G.hint : null;
  if (!cur || G.busy) return;
  const m = G.moves.find(x => x.f === cur.m.f && x.t === cur.m.t); if (m) playerMove(m);
}
function trainUndo() {
  if (!G.training || G.mode !== 'play' || G.busy) return;
  const h = G.history.pop(); if (!h) return;
  Object.assign(G, { board: h.board, used: h.used, limit: h.limit, lastMove: h.lastMove, gold: h.gold, checksBonus: h.checks, coffeeUsed: h.coffee, lineIx: h.lineIx, forced: h.forced, hint: null, sel: -1 });
  syncMeshes(G.board); G.moves = legal(G.board, 'w'); coachSay([['coach_undo']]); SFX.magic();
  renderHUD(); refreshMarks(); setStatus('st_your', { n: G.limit - G.used }); savePlay(false);
}

/* ============================== shop ============================== */
function offerUpgrade() {
  const c = []; for (const a of G.army) for (const u of (UPS[a.t] || [])) if (!a.ups.includes(u[0])) c.push([a, u]);
  if (!c.length) return null; const [a, u] = pick(c);
  return { kind: 'up', aid: a.id, code: u[0], title: u[1], desc: u[2], cost: rint(4, 6), t: a.t, key: 'up' + a.id + u[0] };
}
function offerLife() {
  const c = G.army.filter(a => a.t !== 'K' && a.mhp < 3); if (!c.length) return null; const a = pick(c);
  return { kind: 'life', aid: a.id, cost: 3 + a.mhp * 2, t: a.t, key: 'life' + a.id };
}
function offerPerk() {
  const c = []; for (const a of G.army) { if (!a.th) c.push([a, 'th']); if (!a.gr) c.push([a, 'gr']); }
  if (!c.length) return null; const [a, k] = pick(c);
  return { kind: 'perk', aid: a.id, perk: k, cost: k === 'th' ? 5 : 4, t: a.t, key: k + a.id };
}
function rollMain() {
  const out = [], keys = new Set(); let guard = 0;
  while (out.length < 3 && guard++ < 60) {
    const r = Math.random();
    const o = r < .5 ? offerUpgrade() : r < .75 ? offerLife() : offerPerk();
    if (o && !keys.has(o.key)) { keys.add(o.key); out.push(o); }
  }
  return out;
}
function showShop() {
  G.mode = 'shop'; setStatus(null);
  const relPool = shuffle(Object.keys(RELICS).filter(id => !has(id))).slice(0, 2).map(id => ({ kind: 'relic', id, cost: RELICS[id].cost }));
  const consPool = shuffle(Object.keys(CONS)).slice(0, 2).map(id => ({ kind: 'cons', id, cost: CONS[id].cost }));
  G.shop = { main: rollMain(), relics: relPool, cons: consPool, reroll: 2 };
  G.rerender = renderShop; renderShop();
  saveRun('shop');
}
function offerCard(o, row, ix) {
  let art, title, sub = '', desc, band;
  if (o.kind === 'relic') { art = img(o.id, ''); title = L(RELICS[o.id].name); desc = L(RELICS[o.id].desc); band = t('band_relic'); }
  else if (o.kind === 'cons') { art = img(o.id, ''); title = L(CONS[o.id].name); desc = L(CONS[o.id].desc); band = t('band_cons'); }
  else {
    art = gl(o.t, 'w');
    if (o.kind === 'up') { title = L(o.title); desc = L(o.desc); band = t('band_up'); }
    else if (o.kind === 'life') { title = t('life_title'); desc = t('life_desc'); band = t('band_life'); }
    else { title = t(o.perk === 'th' ? 'thirst' : 'greed'); desc = t(o.perk === 'th' ? 'thirst_desc' : 'greed_desc'); band = t('band_perk'); }
    const a = armyById(o.aid); sub = `<div class="for">${esc(t('for', { name: a ? nameOf(a) : '—', type: tname(a ? a.t : o.t).toLowerCase() }))}</div>`;
  }
  let blocked = '';
  if (o.kind === 'relic' && G.relics.length >= 5) blocked = t('no_room');
  if (o.kind === 'cons' && G.cons.length >= consSlots()) blocked = t('slots_full');
  const dis = o.sold || G.gold < o.cost || blocked;
  return `<div class="card k-${o.kind}${o.sold ? ' sold' : ''}"><div class="band">${band}</div><div class="art">${art}</div><h3>${esc(title)}</h3>${sub}<p>${esc(desc)}</p>
    <button class="btn gold small buy" type="button" data-buy="${row}:${ix}" ${dis ? 'disabled' : ''}>${o.sold ? t('bought') : blocked || t('buy', { n: o.cost })}</button></div>`;
}
function renderShop() {
  const s = G.shop; renderHUD();
  const chips = G.army.map(a => `<span class="chip" data-arm="${a.id}">${gl(a.t, 'w')}${esc(nameOf(a))}${a.ups.length ? ` <span class="tag">+${a.ups.length}</span>` : ''}${a.mhp > 1 ? ` <span class="tag hp">♥${a.mhp}</span>` : ''}</span>`).join('');
  showOverlay(`
    <div class="scr-head"><div class="eyebrow">${t('eyebrow_sel', { a: G.enc.ante, w: G.wins, g: G.gold })}</div><h2>${t('shop')}</h2><div class="goldbig">$${G.gold}</div>${langBtn()}</div>
    <div class="shop-col"><div class="lbl">${t('shop_army')}</div><div class="cards">${s.main.map((o, i) => offerCard(o, 'main', i)).join('') || `<p class="sub">${t('empty_reroll')}</p>`}</div></div>
    <div class="shop-cols">
      <div class="shop-col"><div class="lbl">${t('relics_h')}</div><div class="cards">${s.relics.map((o, i) => offerCard(o, 'relics', i)).join('') || `<p class="sub">${t('sold_out')}</p>`}</div></div>
      <div class="shop-col"><div class="lbl">${t('cons_h')}</div><div class="cards">${s.cons.map((o, i) => offerCard(o, 'cons', i)).join('')}</div></div>
    </div>
    ${G.relics.length ? `<div class="shop-col"><div class="lbl">${t('sell_title')}</div><div class="sell-list">${G.relics.map(id => `<div class="sell-row" data-tip="${esc(relicTip(id))}">${img(id, '')}<span>${esc(L(RELICS[id].name))}</span><button class="btn green small" type="button" data-sell="${id}">${t('sell_btn', { n: sellPrice(id) })}</button></div>`).join('')}</div></div>` : ''}
    <div class="shop-col"><div class="lbl">${t('army_hover')}</div><div class="chips">${chips}</div></div>
    <div class="row-btns"><button class="btn green" type="button" data-act="reroll" ${G.gold < s.reroll ? 'disabled' : ''}>${t('reroll', { n: s.reroll })}</button><button class="btn red" type="button" data-act="leaveShop">${t('next')}</button></div>`);
}
const sellPrice = id => Math.max(1, Math.floor(RELICS[id].cost / 2));
function sellRelic(id) {
  const ix = G.relics.indexOf(id); if (ix < 0) return;
  if (id === 'prism' && G.cons.length > 2) { toast(t('sell_prism_block')); return; }
  const price = sellPrice(id);
  G.relics.splice(ix, 1); G.gold += price;
  toast(t('toast_sold', { name: L(RELICS[id].name), n: price })); SFX.coin();
  track('sell', { training: G.training });
  renderShop(); saveRun('shop');
}
function buy(row, ix) {
  const o = G.shop[row][ix]; if (!o || o.sold || G.gold < o.cost) return;
  if (o.kind === 'relic' && G.relics.length >= 5) return;
  if (o.kind === 'cons' && G.cons.length >= consSlots()) return;
  G.gold -= o.cost; o.sold = true;
  const a = o.aid ? armyById(o.aid) : null;
  switch (o.kind) {
    case 'up': a.ups.push(o.code); G.upgrades = (G.upgrades || 0) + 1; track('upgrades', { count: G.upgrades, training: G.training }); toast(`${nameOf(a)}: ${L(o.title)}`); break;
    case 'life': a.mhp++; G.upgrades = (G.upgrades || 0) + 1; track('upgrades', { count: G.upgrades, training: G.training }); toast(t('toast_life', { name: nameOf(a), n: a.mhp })); break;
    case 'perk': a[o.perk] = true; G.upgrades = (G.upgrades || 0) + 1; track('upgrades', { count: G.upgrades, training: G.training }); toast(`${nameOf(a)}: ${t(o.perk === 'th' ? 'thirst' : 'greed')}`); break;
    case 'relic': G.relics.push(o.id); track('relics', { count: G.relics.length, training: G.training }); toast(t('toast_relic', { name: L(RELICS[o.id].name) })); break;
    case 'cons': G.cons.push(o.id); break;
  }
  SFX.buy(); flashFx(.15, 0xf3b53c); renderShop(); saveRun('shop');
}

/* ============================== input ============================== */
const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
let mouseNX = 0, mouseNY = 0;
function pickSq(cx, cy) {
  const c = curveJS(cx / W, 1 - cy / H); ndc.set(c[0] * 2 - 1, c[1] * 2 - 1);
  ray.setFromCamera(ndc, camera);
  const hitsArr = ray.intersectObjects([...tileMeshes, ...meshes.values()], true);
  for (const h of hitsArr) {
    if (h.object.isSprite) continue;
    let o = h.object;
    while (o && o.userData.sq === undefined && o.userData.k === undefined) o = o.parent;
    if (!o) continue;
    if (o.userData.sq !== undefined) return o.userData.sq;
    const i = G.board ? G.board.findIndex(p => p && p.k === o.userData.k) : -1;
    if (i >= 0) return i;
  }
  return -1;
}
canvas.addEventListener('pointermove', e => {
  if (camDrag) {
    const dx = e.clientX - camDrag.x, dy = e.clientY - camDrag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) camDrag.moved = true;
    camYawT = camDrag.yaw - dx * 0.35;
    camPitchT = Math.max(18, Math.min(82, camDrag.pitch + dy * 0.25));
    return;
  }
  mouseNX = e.clientX / W * 2 - 1; mouseNY = e.clientY / H * 2 - 1;
  if (G.mode !== 'play') { canvas.style.cursor = 'default'; return; }
  const sq = pickSq(e.clientX, e.clientY);
  if (sq !== G.hover) { G.hover = sq; refreshMarks(); renderPieceCard(); }
  const p = sq >= 0 ? G.board[sq] : null;
  const actionable = G.targeting ? targetSquares(G.targeting.id).includes(sq) : (p && p.s === 'w') || (G.sel >= 0 && G.moves.some(m => m.f === G.sel && m.t === sq));
  canvas.style.cursor = actionable ? 'pointer' : 'default';
});
canvas.addEventListener('pointerleave', () => { if (G.hover !== -1) { G.hover = -1; refreshMarks(); renderPieceCard(); } });
canvas.addEventListener('pointerdown', e => {
  if (e.button === 1) {
    e.preventDefault();
    camDrag = { x: e.clientX, y: e.clientY, yaw: camYawT, pitch: camPitchT, moved: false };
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    canvas.style.cursor = 'grabbing';
    return;
  }
  if (e.button !== 0) return;
  if (G.mode !== 'play' || G.busy || pauseOpen) return;
  const sq = pickSq(e.clientX, e.clientY); if (sq < 0) { deselect(); return; }
  if (G.targeting) { applyTarget(sq); return; }
  if (G.sel >= 0) { const m = G.moves.find(mm => mm.f === G.sel && mm.t === sq); if (m) { playerMove(m); return; } }
  const p = G.board[sq];
  if (p && p.s === 'w') selectSq(sq); else deselect();
});
canvas.addEventListener('contextmenu', e => { e.preventDefault(); deselect(); });
canvas.addEventListener('pointerup', e => {
  if (e.button !== 1 || !camDrag) return;
  if (!camDrag.moved) { if (performance.now() - lastMiddleUp < 400) resetCamera(); lastMiddleUp = performance.now(); }
  camDrag = null; canvas.style.cursor = 'default';
});
/* Stops the browser's middle-click autoscroll on Windows and Linux. */
canvas.addEventListener('mousedown', e => { if (e.button === 1) e.preventDefault(); });
canvas.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
function selectSq(sq) {
  const p = G.board[sq]; if (G.sel === sq) { deselect(); return; }
  G.sel = sq; SFX.select();
  if (p.fz > 0 || p.ch) toast(t('toast_cant'));
  else if (!G.moves.some(m => m.f === sq)) toast(t('toast_no_moves'));
  refreshMarks(); renderPieceCard();
}
function deselect() { if (G.targeting) { G.targeting = null; renderHUD(); setStatus('st_your', { n: G.limit - G.used }); } G.sel = -1; refreshMarks(); renderPieceCard(); }

function setLang(l) {
  setLanguage(l); profile.settings.lang = l; saveProfile();
  renderStatic(); if (!hudL.hidden) renderHUD(); paintStatus();
  if (G.rerender && !ov.hidden) G.rerender();
}
function setBadges(v) {
  SHOW_BADGES = v; for (const m of meshes.values()) if (m.userData.badge) m.userData.badge.visible = v;
  $('#bBadges').textContent = v ? t('badges_on') : t('badges_off');
  profile.settings.badges = v; saveProfile();
}
addEventListener('keydown', e => {
  if (e.metaKey || e.ctrlKey || e.altKey) return;
  if (e.key === 'Escape') {
    if (pauseOpen) { closePause(); return; }
    if (document.getElementById('splash') || G.mode === 'menu') return;
    if (!$('#peekBack').hidden) { $('#peekBack').click(); return; }
    if (G.mode === 'play' && (G.sel >= 0 || G.targeting)) { deselect(); return; }
    openPause(); return;
  }
  if (pauseOpen) return;
  if (e.code === 'KeyH') askHint();
  if (e.code === 'KeyZ') trainUndo();
  if (e.code === 'KeyB') setBadges(!SHOW_BADGES);
});

document.addEventListener('click', e => {
  const a = e.target.closest('[data-act]');
  if (a) {
    const act = a.dataset.act;
    if (act === 'start') newRun(G.training);
    else if (act === 'retry') startLevel();
    else if (act === 'nextPz') { advanceEnc(); showSelect(); }
    else if (act === 'title') showMenu();
    else if (act === 'lang') setLang(LANG === 'ru' ? 'en' : 'ru');
    else if (act === 'play') startLevel();
    else if (act === 'skip') skipEnc();
    else if (act === 'peek') { hideOverlay(); $('#peekBack').hidden = false; setStatus('st_peek'); }
    else if (act === 'toShop') showShop();
    else if (act === 'reroll') { if (G.gold >= G.shop.reroll) { G.gold -= G.shop.reroll; G.shop.reroll++; G.shop.main = rollMain(); SFX.coin(); renderShop(); } }
    else if (act === 'leaveShop') showSelect();
    return;
  }
  const b = e.target.closest('[data-buy]'); if (b) { const [row, ix] = b.dataset.buy.split(':'); buy(row, +ix); return; }
  const sl = e.target.closest('[data-sell]'); if (sl) { sellRelic(sl.dataset.sell); return; }
  const c = e.target.closest('[data-cons]'); if (c) { useCons(+c.dataset.cons); return; }
  const arm = e.target.closest('[data-arm]');
  if (arm && G.mode === 'play' && !G.busy) { const i = G.board.findIndex(p => p && p.id === +arm.dataset.arm); if (i >= 0) selectSq(i); }
});
$('#peekBack').addEventListener('click', () => { $('#peekBack').hidden = true; ov.hidden = false; setStatus(null); });
$('#bPause').addEventListener('click', openPause);
$('#bBadges').addEventListener('click', () => setBadges(!SHOW_BADGES));
$('#bHint').addEventListener('click', askHint);
$('#bHintPlay').addEventListener('click', playHint);
$('#bUndo').addEventListener('click', trainUndo);

async function applyFullscreen(on) {
  try {
    if (isDesktop) { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().setFullscreen(on); }
    else if (on && !document.fullscreenElement) await document.documentElement.requestFullscreen();
    else if (!on && document.fullscreenElement) await document.exitFullscreen();
  } catch (e) { /* fullscreen not allowed here */ }
}
/* Applies profile.settings; key limits the work to one changed setting. */
function applySettings(key) {
  const st = profile.settings;
  if (!key || key === 'lang') { if (st.lang && st.lang !== LANG) setLang(st.lang); }
  if (!key || key === 'sound' || key === 'volume') { muted = !st.sound; VOLUME = st.volume; }
  if (!key || key === 'badges') setBadges(st.badges);
  if (!key || key === 'crt') { CRT_ON = !!st.crt; postMat.uniforms.crt.value = CRT_ON ? 1 : 0; }
  if (key === 'fullscreen' || (!key && st.fullscreen)) applyFullscreen(!!st.fullscreen);
  renderStatic();
}
async function quitApp() {
  await saveProfile(true);
  try { const { getCurrentWindow } = await import('@tauri-apps/api/window'); await getCurrentWindow().close(); } catch (e) { window.close(); }
}
let playAcc = 0;
function flushPlaytime() { if (playAcc >= 1) { track('playtime', { seconds: Math.floor(playAcc) }); playAcc -= Math.floor(playAcc); } }

/* ============================== loop ============================== */
let last = performance.now(), time = 0;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.05, (now - last) / 1000); last = now; time += dt;
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i]; tw.t += dt; if (tw.t < 0) continue;
    const k = Math.min(1, tw.t / tw.dur); tw.fn(k);
    if (k >= 1) { tweens.splice(i, 1); tw.res(); }
  }
  for (let i = particles.length - 1; i >= 0; i--) {
    const m = particles[i], u = m.userData; u.life -= dt;
    u.v.y -= 11 * dt; m.position.addScaledVector(u.v, dt);
    if (m.position.y < 0.05) { m.position.y = 0.05; u.v.y *= -0.35; u.v.x *= .7; u.v.z *= .7; }
    m.rotation.x += dt * 6; m.rotation.y += dt * 5;
    if (u.life <= 0) { scene.remove(m); particles.splice(i, 1); } else if (u.life < .3) m.scale.multiplyScalar(.9);
  }
  if (G.mode === 'play') { playAcc += dt; if (playAcc > 30) flushPlaytime(); }
  for (const r of auras) { r.rotation.y += dt * .8; }
  for (const m of pulseMats) m.opacity = m.userData.base * (.6 + .4 * Math.sin(time * 6));
  const selK = G.mode === 'play' && G.sel >= 0 && G.board && G.board[G.sel] ? G.board[G.sel].k : null;
  if (selK !== null) {
    const m = meshes.get(selK);
    if (m && !m.userData.anim) { m.position.y = .08 + Math.sin(time * 5) * .05; const v = sqPos(G.sel); selLight.position.set(v.x, 1.2, v.z); selLight.intensity = 1.4; }
  } else selLight.intensity = 0;
  for (const m of meshes.values()) if (!m.userData.anim && m.userData.k !== selK && m.position.y > 0 && m.position.y < .2) m.position.y = Math.max(0, m.position.y - dt);
  { const k = Math.min(1, dt * 10); camYaw += (camYawT - camYaw) * k; camPitch += (camPitchT - camPitch) * k;
    const yr = camYaw * Math.PI / 180, pr = camPitch * Math.PI / 180;
    camBase.set(Math.sin(yr) * Math.cos(pr), Math.sin(pr), Math.cos(yr) * Math.cos(pr)).multiplyScalar(camDist).add(camTarget); }
  camera.position.copy(camBase);
  const par = camDrag ? 0 : 1;
  camera.position.x += Math.sin(time * .3) * .12 + mouseNX * .35 * par;
  camera.position.y += Math.sin(time * .23) * .06 - mouseNY * .2 * par;
  camera.lookAt(camTarget);
  let sx = 0, sy = 0;
  if (shakeT > 0) { shakeT -= dt; sx = (Math.random() - .5) * shakeAmp; sy = (Math.random() - .5) * shakeAmp; } else shakeAmp = 0;
  const u = postMat.uniforms; u.time.value = time; u.shake.value.set(sx, sy); u.flash.value *= Math.pow(0.02, dt);
  const danger = G.mode === 'play' && G.board && inCheckCached() ? .55 + .45 * Math.sin(time * 5) : 0;
  u.danger.value += (danger - u.danger.value) * Math.min(1, dt * 8);
  renderer.setRenderTarget(rt); renderer.render(scene, camera);
  renderer.setRenderTarget(null); renderer.render(postScene, postCam);
}
let ccBoard = null, ccVal = false;
function inCheckCached() { if (ccBoard !== G.board) { ccBoard = G.board; ccVal = inCheck(G.board, 'w'); } return ccVal; }


/* ============================== boot ============================== */
export async function boot() {
  initMeta({
    gl, img, esc, toast, showOverlay, enterMenu, newRun, continueRun, applySettings,
    sfx: k => SFX[k] && SFX[k](), quit: quitApp,
    setRerender: fn => { G.rerender = fn; }, rerender: () => G.rerender && G.rerender(),
    isMenu: () => G.mode === 'menu' && G.rerender && !ov.hidden, isMenuScreen: () => G.mode === 'menu'
  });
  if (!profile.settings.lang) profile.settings.lang = LANG;
  applySettings();
  resize();
  G.board = demoBoard(); syncMeshes(G.board); G.mode = 'menu'; hideOverlay();
  requestAnimationFrame(loop);
  addEventListener('beforeunload', () => { flushPlaytime(); saveProfile(true); });
  await showSplash();
  showMenu();
}
window.__LG = { G, jumpToAnte: a => { G.encIndex = (a - 1) * 3; newAnte(); showSelect(); }, shop: () => { advanceEnc(); showShop(); }, play: m => playerMove(m), askHint, findHintMove, explainMove, legal, applyMove, aiChoose, parsePuzzle, BANK, setLang, inCheck, hasLegal, profile };
