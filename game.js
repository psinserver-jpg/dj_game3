import * as THREE from 'three';

// ─────────────────────────────────────────────────────────────
// 설정
// ─────────────────────────────────────────────────────────────
const S = window.SPRITES;               // tools/slice.py 가 만든 프레임 메타데이터
const WORLD = 70;                        // 월드 반경(정사각형 half-size)
const DAY_LEN = 180;                     // 하루 길이(초)
const CFG = {
  playerSpeed: 5.2, playerHP: 100, hungerRate: 0.45, coldDmg: 0.9, starveDmg: 2,
  zombieHP: 4, zombieSpeed: 1.9, zombieDmg: 9, boarHP: 3,
  treeHP: 3, rockHP: 4, fireFuel: 60, fireMaxFuel: 150, fireRadius: 5,
};
const ITEMS = {
  wood:   { icon: 'icon_wood',   name: '나무' },
  stone:  { icon: 'icon_stone',  name: '돌' },
  berry:  { icon: 'icon_berry',  name: '열매' },
  meat:   { icon: 'icon_meat',   name: '생고기' },
  cooked: { icon: 'icon_cooked', name: '구운 고기' },
};

// ─────────────────────────────────────────────────────────────
// 렌더러 / 씬
// ─────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.prepend(renderer.domElement);

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0x9fc6e0, 30, 60);
const camera = new THREE.PerspectiveCamera(38, innerWidth / innerHeight, 0.1, 200);
const CAM_OFFSET = new THREE.Vector3(0, 11.5, 13);

const hemi = new THREE.HemisphereLight(0xdfefff, 0x4a6a2a, 1.4);
const sun = new THREE.DirectionalLight(0xfff2d6, 1.4);
sun.position.set(10, 20, 8);
scene.add(hemi, sun);

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// ─────────────────────────────────────────────────────────────
// 텍스처 로딩
// ─────────────────────────────────────────────────────────────
const manager = new THREE.LoadingManager();
const loader = new THREE.TextureLoader(manager);
const TEX = {};
for (const name of [...Object.keys(S), 'grass']) {
  const t = loader.load(`assets/sprites/${name}.png`);
  t.colorSpace = THREE.SRGBColorSpace;
  if (name !== 'grass') { t.magFilter = THREE.NearestFilter; t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  TEX[name] = t;
}
const loaded = new Promise(res => { manager.onLoad = res; });

// ─────────────────────────────────────────────────────────────
// 프레임 애니메이션 스프라이트
// ─────────────────────────────────────────────────────────────
const shadowTex = (() => {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d'), grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(0,0,0,.55)'); grd.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
})();
const shadowGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
const shadowMat = new THREE.MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false });

const HIT_COLOR = new THREE.Color(1, 0.25, 0.2), WHITE = new THREE.Color(1, 1, 1);

class FrameSprite {
  /** @param anims {key: spriteName}  @param height 기준 애니메이션의 월드 높이 */
  constructor(anims, height, baseKey, shadowSize = 1) {
    this.anims = anims;
    this.unit = height / S[anims[baseKey]].h;   // 픽셀 → 월드 단위 (모든 모션에 동일 적용)
    this.mat = new THREE.SpriteMaterial({ alphaTest: 0.5, fog: true });
    this.sprite = new THREE.Sprite(this.mat);
    this.sprite.center.set(0.5, 0.02);
    this.group = new THREE.Group();
    this.shadow = new THREE.Mesh(shadowGeo, shadowMat);
    this.shadow.scale.set(shadowSize * 1.4, 1, shadowSize * 0.7);
    this.shadow.position.y = 0.02;
    this.group.add(this.shadow, this.sprite);
    this.tex = {};
    for (const [k, n] of Object.entries(anims)) {
      const t = TEX[n].clone(); t.needsUpdate = true; this.tex[k] = t;
    }
    this.flip = false; this.flash = 0; this.shake = 0; this.tint = new THREE.Color(1, 1, 1);
    this.play(baseKey);
    scene.add(this.group);
  }
  play(key, { loop = true, fps = 8, onEnd = null, onFrame = null } = {}) {
    if (this.key === key && loop && this.loop) return;
    this.key = key; this.loop = loop; this.fps = fps; this.onEnd = onEnd; this.onFrame = onFrame;
    this.t = 0; this.frame = -1; this.done = false;
    const m = S[this.anims[key]];
    this.mat.map = this.tex[key]; this.mat.needsUpdate = true;
    this.sprite.scale.set(m.w * this.unit, m.h * this.unit, 1);
    this.setFrame(0);
  }
  setFrame(f) {
    const changed = f !== this.frame;
    this.frame = f;
    const n = S[this.anims[this.key]].frames, t = this.mat.map;
    t.repeat.set((this.flip ? -1 : 1) / n, 1);
    t.offset.x = this.flip ? (f + 1) / n : f / n;
    if (changed) this.onFrame?.(f);
  }
  update(dt, light) {
    const n = S[this.anims[this.key]].frames;
    this.t += dt;
    let f = Math.floor(this.t * this.fps);
    if (this.loop) f %= n;
    else if (f >= n) { f = n - 1; if (!this.done) { this.done = true; this.onEnd?.(); } }
    this.setFrame(f);
    // 조명/피격 색상
    this.flash = Math.max(0, this.flash - dt * 4);
    this.mat.color.copy(this.tint).multiply(light).lerp(HIT_COLOR, this.flash);
    this.shake = Math.max(0, this.shake - dt * 3);
    this.sprite.position.x = Math.sin(this.t * 60) * this.shake * 0.15;
  }
  get pos() { return this.group.position; }
  dispose() { scene.remove(this.group); Object.values(this.tex).forEach(t => t.dispose()); this.mat.dispose(); }
}

// ─────────────────────────────────────────────────────────────
// 지형
// ─────────────────────────────────────────────────────────────
function buildGround() {
  const t = TEX.grass; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(WORLD / 5, WORLD / 5);
  t.anisotropy = 8;
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(WORLD * 2 + 40, WORLD * 2 + 40).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ map: t, color: 0xa8c48f }));
  scene.add(ground);
}

// ─────────────────────────────────────────────────────────────
// 게임 상태
// ─────────────────────────────────────────────────────────────
const state = {
  running: false, over: false, time: DAY_LEN * 0.05, day: 1,
  hp: CFG.playerHP, hunger: 100,
  inv: { wood: 0, stone: 0, berry: 0, meat: 0, cooked: 0 },
};
let player, nodes = [], zombies = [], boars = [], fires = [], pickups = [];
const keys = new Set();
const rand = (a, b) => a + Math.random() * (b - a);
const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;

function lightLevel() {
  const t = (state.time % DAY_LEN) / DAY_LEN;
  if (t < 0.55) return 1;
  if (t < 0.65) return THREE.MathUtils.lerp(1, 0.12, (t - 0.55) / 0.1);
  if (t < 0.92) return 0.12;
  return THREE.MathUtils.lerp(0.12, 1, (t - 0.92) / 0.08);
}
const isNight = () => { const t = (state.time % DAY_LEN) / DAY_LEN; return t > 0.6 && t < 0.95; };

// 월드 한 지점의 밝기(달빛 + 모닥불)
const _c = new THREE.Color();
function lightAt(p, base) {
  _c.setRGB(base * 0.9 + 0.1 * (1 - base) * 0.4, base * 0.9 + 0.1 * (1 - base) * 0.5, base + 0.15 * (1 - base));
  for (const f of fires) {
    const d = Math.sqrt(dist2(p, f.fs.pos));
    const k = Math.max(0, 1 - d / (CFG.fireRadius + 3)) * f.strength;
    _c.r += k * 1.1; _c.g += k * 0.75; _c.b += k * 0.4;
  }
  _c.r = Math.min(_c.r, 1.15); _c.g = Math.min(_c.g, 1.1); _c.b = Math.min(_c.b, 1.1);
  return _c;
}

// ─────────────────────────────────────────────────────────────
// 월드 오브젝트
// ─────────────────────────────────────────────────────────────
function freeSpot(minFromPlayer = 6) {
  for (let i = 0; i < 50; i++) {
    const p = { x: rand(-WORLD, WORLD), z: rand(-WORLD, WORLD) };
    if (player && Math.sqrt(dist2(p, player.pos)) < minFromPlayer) continue;
    if (!player && Math.hypot(p.x, p.z) < minFromPlayer) continue;
    if (nodes.some(n => dist2(n.fs.pos, p) < 4)) continue;
    return p;
  }
  return { x: rand(-WORLD, WORLD), z: rand(-WORLD, WORLD) };
}

function spawnNode(type, p = freeSpot()) {
  const def = {
    oak:  { sprite: 'tree_oak', h: 4.2, hp: CFG.treeHP, r: 0.55, drop: ['wood', 3], sh: 1.6 },
    pine: { sprite: 'tree_pine', h: 4.6, hp: CFG.treeHP, r: 0.5, drop: ['wood', 3], sh: 1.4 },
    rock: { sprite: 'rock', h: 1.3, hp: CFG.rockHP, r: 0.7, drop: ['stone', 2], sh: 1.3 },
    bush: { sprite: 'bush', h: 1.2, hp: 0, r: 0.45, drop: null, sh: 1.1 },
  }[type];
  const fs = new FrameSprite({ still: def.sprite }, def.h, 'still', def.sh);
  fs.pos.set(p.x, 0, p.z);
  fs.flip = Math.random() < 0.5; fs.setFrame(0);
  const n = { type, fs, hp: def.hp, r: def.r, drop: def.drop, berries: true, regrow: 0 };
  nodes.push(n);
  return n;
}

function spawnPickup(item, x, z) {
  const fs = new FrameSprite({ still: ITEMS[item].icon }, 0.55, 'still', 0.4);
  fs.pos.set(x + rand(-0.6, 0.6), 0, z + rand(-0.6, 0.6));
  pickups.push({ item, fs, t: rand(0, 6), delay: 0.4 });
}

function spawnBoar(p = freeSpot(12)) {
  const fs = new FrameSprite({ walk: 'boar_walk', die: 'boar_die' }, 1.05, 'walk', 1.3);
  fs.pos.set(p.x, 0, p.z);
  boars.push({ fs, hp: CFG.boarHP, dir: rand(0, Math.PI * 2), turn: rand(1, 4), flee: 0, dead: false, idle: 0 });
}

function spawnZombie() {
  const a = rand(0, Math.PI * 2), d = rand(20, 26);
  const x = THREE.MathUtils.clamp(player.pos.x + Math.cos(a) * d, -WORLD, WORLD);
  const z = THREE.MathUtils.clamp(player.pos.z + Math.sin(a) * d, -WORLD, WORLD);
  const fs = new FrameSprite({ walk: 'zombie_walk', attack: 'zombie_attack', die: 'zombie_die' }, 1.85, 'walk', 1);
  fs.pos.set(x, 0, z);
  zombies.push({ fs, hp: CFG.zombieHP + Math.floor(state.day / 3), cd: 0, attacking: false, dead: false });
}

function buildFire(x, z) {
  const fs = new FrameSprite({ burn: 'campfire' }, 1.4, 'burn', 1.2);
  fs.pos.set(x, 0, z);
  fs.play('burn', { fps: 9 });
  fs.unlit = true;
  const light = new THREE.PointLight(0xff9a3c, 0, CFG.fireRadius * 3.2, 1.6);
  light.position.set(x, 1.4, z);
  scene.add(light);
  const f = { fs, light, fuel: CFG.fireFuel, strength: 1, r: 0.6 };
  fires.push(f);
  return f;
}

// ─────────────────────────────────────────────────────────────
// 플레이어
// ─────────────────────────────────────────────────────────────
function createPlayer() {
  const fs = new FrameSprite({ idle: 'player_idle', walk: 'player_walk', attack: 'player_attack', die: 'player_die' }, 1.9, 'idle', 1);
  fs.play('idle', { fps: 5 });
  return { fs, get pos() { return fs.pos; }, attacking: false, facing: 1, hurtCd: 0 };
}

function playerAttack() {
  if (player.attacking || state.over) return;
  player.attacking = true;
  player.fs.play('attack', {
    loop: false, fps: 13,
    onFrame: f => { if (f === 2) resolveHit(); },
    onEnd: () => { player.attacking = false; player.fs.play('idle', { fps: 5 }); },
  });
}

function resolveHit() {
  const p = player.pos, face = player.facing;
  const targets = [];
  for (const z of zombies) if (!z.dead) targets.push({ o: z, kind: 'zombie', r: 1.9 });
  for (const b of boars) if (!b.dead) targets.push({ o: b, kind: 'boar', r: 2.0 });
  for (const n of nodes) if (n.type !== 'bush') targets.push({ o: n, kind: 'node', r: 1.6 + n.r });
  let best = null, bd = Infinity;
  for (const t of targets) {
    const q = t.o.fs.pos, dx = q.x - p.x, d = Math.sqrt(dist2(p, q));
    if (d > t.r || dx * face < -0.4) continue;
    if (d < bd) { bd = d; best = t; }
  }
  if (!best) return;
  const o = best.o;
  o.fs.flash = 1; o.fs.shake = 1;
  if (best.kind === 'zombie') {
    o.hp--; knock(o.fs.pos, p, 0.9);
    floater('-1', o.fs.pos, '#ff8a7a');
    if (o.hp <= 0) killZombie(o);
  } else if (best.kind === 'boar') {
    o.hp--; o.flee = 3.5; knock(o.fs.pos, p, 0.6);
    floater('-1', o.fs.pos, '#ff8a7a');
    if (o.hp <= 0) killBoar(o);
  } else {
    o.hp--;
    if (o.hp <= 0) {
      for (let i = 0; i < o.drop[1]; i++) spawnPickup(o.drop[0], o.fs.pos.x, o.fs.pos.z);
      o.fs.dispose(); nodes.splice(nodes.indexOf(o), 1);
      const type = o.type;
      setTimeout(() => state.running && spawnNode(type, freeSpot(15)), 45000);
    }
  }
}

function knock(q, from, amt) {
  const dx = q.x - from.x, dz = q.z - from.z, l = Math.hypot(dx, dz) || 1;
  q.x += dx / l * amt; q.z += dz / l * amt;
}

function killZombie(z) {
  z.dead = true;
  z.fs.play('die', { loop: false, fps: 7, onEnd: () => setTimeout(() => { z.fs.dispose(); zombies.splice(zombies.indexOf(z), 1); }, 1500) });
}
function killBoar(b) {
  b.dead = true;
  b.fs.play('die', { loop: false, fps: 7, onEnd: () => {
    for (let i = 0; i < 2; i++) spawnPickup('meat', b.fs.pos.x, b.fs.pos.z);
    setTimeout(() => { b.fs.dispose(); boars.splice(boars.indexOf(b), 1); }, 1200);
  } });
}

function hurtPlayer(dmg) {
  if (state.over) return;
  state.hp -= dmg;
  player.fs.flash = 1;
  floater(`-${dmg}`, player.pos, '#ff5a4a');
  vignette.style.opacity = 1; setTimeout(() => (vignette.style.opacity = 0), 250);
}

// ─────────────────────────────────────────────────────────────
// 상호작용
// ─────────────────────────────────────────────────────────────
function nearestFire(r = 2.6) {
  return fires.find(f => Math.sqrt(dist2(f.fs.pos, player.pos)) < r);
}

function interact() {
  const f = nearestFire();
  if (f) {
    if (state.inv.wood > 0) {
      state.inv.wood--; f.fuel = Math.min(CFG.fireMaxFuel, f.fuel + 25);
      floater('불 +25초', f.fs.pos, '#ffc26a');
    } else toast('나무가 없습니다');
    return;
  }
  const b = nodes.find(n => n.type === 'bush' && n.berries && Math.sqrt(dist2(n.fs.pos, player.pos)) < 1.9);
  if (b) {
    b.berries = false; b.regrow = 40; b.fs.tint.setRGB(0.55, 0.7, 0.5);
    b.fs.shake = 0.6;
    for (let i = 0; i < 2; i++) spawnPickup('berry', b.fs.pos.x, b.fs.pos.z);
    return;
  }
  toast('주변에 상호작용할 것이 없습니다');
}

function eat() {
  const inv = state.inv;
  const opts = [['cooked', 40, 12], ['berry', 12, 0], ['meat', 18, -6]];
  for (const [k, h, hp] of opts) {
    if (inv[k] > 0) {
      inv[k]--; state.hunger = Math.min(100, state.hunger + h); state.hp = Math.min(CFG.playerHP, state.hp + hp);
      floater(`${ITEMS[k].name} 냠!`, player.pos, '#ffe08a');
      if (hp < 0) toast('생고기는 배탈이 날 수 있어요. 모닥불에 구워 드세요 (R)');
      return;
    }
  }
  toast('먹을 것이 없습니다');
}

function cook() {
  if (!nearestFire()) return toast('모닥불 근처에서 요리할 수 있습니다');
  if (state.inv.meat <= 0) return toast('생고기가 없습니다');
  state.inv.meat--; state.inv.cooked++;
  floater('고기 구이 +1', player.pos, '#ffc26a');
}

function craftFire() {
  if (state.inv.wood < 5 || state.inv.stone < 3) return toast('모닥불: 나무 5 + 돌 3 필요');
  state.inv.wood -= 5; state.inv.stone -= 3;
  buildFire(player.pos.x + player.facing * 1.4, player.pos.z + 0.3);
  toast('모닥불을 피웠습니다! E로 나무를 넣어 불을 유지하세요');
}

// ─────────────────────────────────────────────────────────────
// HUD
// ─────────────────────────────────────────────────────────────
const $ = s => document.querySelector(s);
const vignette = $('#vignette'), hud = $('#hud');
const invEl = $('#inv');
for (const [k, v] of Object.entries(ITEMS)) {
  invEl.insertAdjacentHTML('beforeend',
    `<div class="slot" id="slot-${k}" title="${v.name}"><img src="assets/sprites/${v.icon}.png"><span>0</span></div>`);
}
let toastTimer;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.style.opacity = 1;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.style.opacity = 0), 2200);
}
const floaters = [];
function floater(text, pos, color) {
  const el = document.createElement('div');
  el.className = 'floater'; el.textContent = text; el.style.color = color;
  hud.appendChild(el);
  floaters.push({ el, p: new THREE.Vector3(pos.x, 2.2, pos.z), t: 0 });
}
const _v = new THREE.Vector3();
function updateHUD(dt) {
  $('#hp .fill').style.transform = `scaleX(${Math.max(0, state.hp) / CFG.playerHP})`;
  $('#hunger .fill').style.transform = `scaleX(${state.hunger / 100})`;
  $('#day').textContent = `${state.day}일차`;
  const t = (state.time % DAY_LEN) / DAY_LEN;
  $('#phase').textContent = isNight() ? '🌙 밤 — 불 곁에 머무세요' : t > 0.5 ? '🌇 해가 지고 있습니다' : '☀️ 낮';
  for (const k in ITEMS) {
    const s = $(`#slot-${k}`); s.querySelector('span').textContent = state.inv[k];
    s.classList.toggle('empty', state.inv[k] === 0);
  }
  for (let i = floaters.length - 1; i >= 0; i--) {
    const f = floaters[i]; f.t += dt; f.p.y += dt * 1.2;
    _v.copy(f.p).project(camera);
    f.el.style.left = `${(_v.x + 1) / 2 * innerWidth}px`;
    f.el.style.top = `${(1 - _v.y) / 2 * innerHeight}px`;
    f.el.style.opacity = 1 - f.t;
    if (f.t > 1) { f.el.remove(); floaters.splice(i, 1); }
  }
}

// ─────────────────────────────────────────────────────────────
// 입력
// ─────────────────────────────────────────────────────────────
addEventListener('keydown', e => {
  const k = e.key.toLowerCase();
  keys.add(k);
  if (!state.running || state.over) return;
  if (k === ' ') { e.preventDefault(); playerAttack(); }
  if (k === 'e') interact();
  if (k === 'f') eat();
  if (k === 'r') cook();
  if (k === 'c') craftFire();
});
addEventListener('keyup', e => keys.delete(e.key.toLowerCase()));
renderer.domElement.addEventListener('mousedown', () => state.running && playerAttack());
addEventListener('blur', () => keys.clear());

// ─────────────────────────────────────────────────────────────
// 업데이트
// ─────────────────────────────────────────────────────────────
function collide(pos, r) {
  for (const n of nodes) {
    const q = n.fs.pos, dx = pos.x - q.x, dz = pos.z - q.z, d = Math.hypot(dx, dz), m = r + n.r;
    if (d < m && d > 0.0001) { pos.x = q.x + dx / d * m; pos.z = q.z + dz / d * m; }
  }
  pos.x = THREE.MathUtils.clamp(pos.x, -WORLD, WORLD);
  pos.z = THREE.MathUtils.clamp(pos.z, -WORLD, WORLD);
}

function updatePlayer(dt) {
  if (state.over) return;
  let dx = 0, dz = 0;
  if (keys.has('w') || keys.has('arrowup')) dz -= 1;
  if (keys.has('s') || keys.has('arrowdown')) dz += 1;
  if (keys.has('a') || keys.has('arrowleft')) dx -= 1;
  if (keys.has('d') || keys.has('arrowright')) dx += 1;
  const moving = dx || dz;
  if (dx) { player.facing = Math.sign(dx); player.fs.flip = dx < 0; }
  if (moving) {
    const l = Math.hypot(dx, dz), sp = CFG.playerSpeed * (player.attacking ? 0.35 : 1);
    player.pos.x += dx / l * sp * dt; player.pos.z += dz / l * sp * dt;
    collide(player.pos, 0.35);
  }
  if (!player.attacking) player.fs.play(moving ? 'walk' : 'idle', { fps: moving ? 9 : 5 });
}

function updateZombies(dt, night) {
  for (const z of zombies) {
    if (z.dead) continue;
    const p = z.fs.pos, pp = player.pos;
    const d = Math.sqrt(dist2(p, pp));
    // 해가 뜨면 소멸
    if (!night && Math.random() < dt * 0.5) { killZombie(z); continue; }
    z.cd -= dt;
    if (z.attacking) continue;
    // 불을 두려워함
    const fire = fires.find(f => Math.sqrt(dist2(f.fs.pos, p)) < CFG.fireRadius - 1.5);
    let tx = pp.x - p.x, tz = pp.z - p.z;
    if (fire) { tx = p.x - fire.fs.pos.x; tz = p.z - fire.fs.pos.z; }
    if (d < 1.35 && z.cd <= 0 && !fire && !state.over) {
      z.attacking = true; z.fs.flip = tx < 0;
      z.fs.play('attack', {
        loop: false, fps: 8,
        onFrame: f => { if (f === 2 && !z.dead && Math.sqrt(dist2(z.fs.pos, player.pos)) < 1.8) hurtPlayer(CFG.zombieDmg); },
        onEnd: () => { z.attacking = false; z.cd = 1.2; if (!z.dead) z.fs.play('walk', { fps: 6 }); },
      });
      continue;
    }
    if (d > 1.1 || fire) {
      const l = Math.hypot(tx, tz) || 1, sp = CFG.zombieSpeed * (fire ? 1.4 : 1) * (1 + state.day * 0.04);
      p.x += tx / l * sp * dt; p.z += tz / l * sp * dt;
      if (Math.abs(tx) > 0.1) z.fs.flip = tx < 0;
    }
    // 좀비끼리 겹침 방지
    for (const o of zombies) if (o !== z && !o.dead) {
      const ddx = p.x - o.fs.pos.x, ddz = p.z - o.fs.pos.z, dd = Math.hypot(ddx, ddz);
      if (dd < 0.8 && dd > 0.001) { p.x += ddx / dd * (0.8 - dd) * 0.5; p.z += ddz / dd * (0.8 - dd) * 0.5; }
    }
    collide(p, 0.35);
    z.fs.play('walk', { fps: 6 });
  }
}

function updateBoars(dt) {
  for (const b of boars) {
    if (b.dead) continue;
    const p = b.fs.pos;
    b.turn -= dt; b.flee -= dt;
    let sp = 1.2;
    if (b.flee > 0) {
      b.dir = Math.atan2(p.z - player.pos.z, p.x - player.pos.x) + rand(-0.3, 0.3); sp = 4.2;
    } else if (b.turn <= 0) {
      b.turn = rand(2, 5); b.dir = rand(0, Math.PI * 2); b.idle = Math.random() < 0.35 ? rand(1, 3) : 0;
    }
    b.idle -= dt;
    if (b.idle > 0 && b.flee <= 0) { b.fs.fps = 0; continue; }
    const vx = Math.cos(b.dir), vz = Math.sin(b.dir);
    p.x += vx * sp * dt; p.z += vz * sp * dt;
    if (Math.abs(vx) > 0.15) b.fs.flip = vx < 0;
    collide(p, 0.5);
    b.fs.fps = b.flee > 0 ? 12 : 6;
  }
  if (boars.filter(b => !b.dead).length < 10 && Math.random() < dt * 0.05) spawnBoar();
}

function updateFires(dt, base) {
  for (let i = fires.length - 1; i >= 0; i--) {
    const f = fires[i];
    f.fuel -= dt;
    f.strength = THREE.MathUtils.clamp(f.fuel / 15, 0, 1) * (0.9 + Math.sin(state.time * 13 + i) * 0.06 + Math.sin(state.time * 7.3) * 0.04);
    f.light.intensity = f.strength * (3 + (1 - base) * 25);
    if (f.fuel <= 0) {
      f.fs.dispose(); scene.remove(f.light); fires.splice(i, 1);
      toast('모닥불이 꺼졌습니다');
    }
  }
}

function updatePickups(dt) {
  for (let i = pickups.length - 1; i >= 0; i--) {
    const pk = pickups[i], p = pk.fs.pos;
    pk.t += dt; pk.delay -= dt;
    pk.fs.sprite.position.y = 0.15 + Math.abs(Math.sin(pk.t * 3)) * 0.2;
    const d = Math.sqrt(dist2(p, player.pos));
    if (pk.delay <= 0 && d < 2.2 && !state.over) {
      p.x += (player.pos.x - p.x) * dt * 8; p.z += (player.pos.z - p.z) * dt * 8;
      if (d < 0.5) {
        state.inv[pk.item]++;
        floater(`+1 ${ITEMS[pk.item].name}`, player.pos, '#bff58a');
        pk.fs.dispose(); pickups.splice(i, 1);
      }
    }
  }
}

let spawnTimer = 0, wasNight = false;
function updateWorld(dt) {
  const prevDay = Math.floor(state.time / DAY_LEN);
  state.time += dt;
  if (Math.floor(state.time / DAY_LEN) > prevDay) { state.day++; toast(`☀️ ${state.day}일차 아침이 밝았습니다!`); }
  const night = isNight();
  if (night && !wasNight) toast('🌙 밤이 되었습니다. 좀비가 몰려옵니다!');
  wasNight = night;

  // 생존 수치
  state.hunger = Math.max(0, state.hunger - CFG.hungerRate * dt);
  if (state.hunger <= 0) state.hp -= CFG.starveDmg * dt;
  const warm = fires.some(f => f.strength > 0.2 && Math.sqrt(dist2(f.fs.pos, player.pos)) < CFG.fireRadius);
  if (night && !warm) state.hp -= CFG.coldDmg * dt;
  if (warm && state.hunger > 30) state.hp = Math.min(CFG.playerHP, state.hp + 1.2 * dt);
  else if (!night && state.hunger > 60) state.hp = Math.min(CFG.playerHP, state.hp + 0.25 * dt);

  // 좀비 스폰
  if (night) {
    spawnTimer -= dt;
    const cap = 2 + state.day * 2;
    if (spawnTimer <= 0 && zombies.filter(z => !z.dead).length < cap) { spawnZombie(); spawnTimer = Math.max(1.2, 5 - state.day * 0.5); }
  }
  // 열매 재생
  for (const n of nodes) if (n.type === 'bush' && !n.berries) {
    n.regrow -= dt;
    if (n.regrow <= 0) { n.berries = true; n.fs.tint.setRGB(1, 1, 1); }
  }
  if (state.hp <= 0 && !state.over) gameOver();
}

function applyLighting(base) {
  hemi.intensity = 0.25 + base * 1.15;
  sun.intensity = base * 1.4;
  const day = new THREE.Color(0x9fc6e0), nightC = new THREE.Color(0x070b16);
  scene.fog.color.copy(nightC).lerp(day, base);
  renderer.setClearColor(scene.fog.color);
  scene.fog.near = 18 + base * 14; scene.fog.far = 34 + base * 26;
}

function gameOver() {
  state.over = true;
  player.fs.play('die', { loop: false, fps: 5 });
  setTimeout(() => {
    const ov = $('#overlay');
    ov.querySelector('h1').textContent = '당신은 쓰러졌습니다';
    ov.querySelector('p').innerHTML = `<b style="color:#ffd98a;font-size:20px">${state.day}일</b> 동안 생존했습니다.`;
    ov.querySelector('button').textContent = '다시 도전';
    ov.querySelector('button').onclick = () => location.reload();
    ov.style.display = 'grid';
  }, 2200);
}

// ─────────────────────────────────────────────────────────────
// 메인 루프
// ─────────────────────────────────────────────────────────────
const clock = new THREE.Clock();
const camTarget = new THREE.Vector3();
function tick() {
  requestAnimationFrame(tick);
  const dt = Math.min(clock.getDelta(), 0.05);
  const base = lightLevel();
  if (state.running) {
    if (!state.over) updateWorld(dt);
    updatePlayer(dt);
    updateZombies(dt, isNight());
    updateBoars(dt);
    updateFires(dt, base);
    updatePickups(dt);
  }
  applyLighting(base);
  // 모든 스프라이트 프레임 갱신 + 조명
  const all = [player.fs, ...zombies.map(z => z.fs), ...boars.map(b => b.fs), ...fires.map(f => f.fs), ...pickups.map(p => p.fs), ...nodes.map(n => n.fs)];
  for (const fs of all) {
    fs.update(dt, fs.unlit ? WHITE : lightAt(fs.pos, base));
  }
  camTarget.lerp(player.pos, 1 - Math.exp(-dt * 6));
  camera.position.copy(camTarget).add(CAM_OFFSET);
  camera.lookAt(camTarget.x, camTarget.y + 1, camTarget.z);
  updateHUD(dt);
  renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────
// 시작
// ─────────────────────────────────────────────────────────────
await loaded;
buildGround();
for (let i = 0; i < 70; i++) spawnNode('oak', freeSpot(5));
for (let i = 0; i < 70; i++) spawnNode('pine', freeSpot(5));
for (let i = 0; i < 45; i++) spawnNode('rock', freeSpot(5));
for (let i = 0; i < 40; i++) spawnNode('bush', freeSpot(4));
player = createPlayer();
for (let i = 0; i < 10; i++) spawnBoar(freeSpot(10));
// 초반 도움: 시작 지점 근처에 열매 덤불 하나
spawnNode('bush', { x: 2.5, z: -1.5 });
camTarget.copy(player.pos);
window.__game = { state, get player() { return player; }, nodes, zombies, boars, fires, spawnZombie, DAY_LEN };
tick();

$('#start').onclick = () => {
  $('#overlay').style.display = 'none';
  state.running = true;
  clock.getDelta();
  toast('해가 지기 전에 나무와 돌을 모아 모닥불(C)을 준비하세요!');
};
