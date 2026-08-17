// 入口：组装场景、世界、玩家、输入，三态状态机（主菜单 / 游玩 / 暂停）。

import * as THREE from 'three';
import { World } from './world';
import { Player } from './player';
import { Input } from './input';
import { raycastVoxel, RaycastHit } from './raycast';
import { BlockType, BLOCK_NAMES, BLOCK_COLORS, RENDER_DISTANCE } from './core/constants';
import { findSpawn } from './core/terrain';
import { initTouch } from './touch';
import './style.css';

let seed = 1337;

// 渲染器
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
document.body.appendChild(renderer.domElement);

// 场景
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0);
scene.fog = new THREE.Fog(0x87b5e0, RENDER_DISTANCE * 8, RENDER_DISTANCE * 16);

// 相机
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 300);
camera.rotation.order = 'YXZ';

// 世界 + 玩家 + 输入
const world = new World(seed);
scene.add(world.group);
const player = new Player(camera, world);
const input = new Input(renderer.domElement);

// —— 快捷栏 ——
const hotbar: BlockType[] = [
  BlockType.Grass,
  BlockType.Dirt,
  BlockType.Stone,
  BlockType.Sand,
  BlockType.Wood,
  BlockType.Leaves,
  BlockType.Snow,
  BlockType.Gravel,
  BlockType.RedSand,
];
let selectedBlock = hotbar[0];

const hotbarEl = document.getElementById('hotbar')!;
const slotEls: HTMLElement[] = hotbar.map((type, i) => {
  const slot = document.createElement('div');
  slot.className = 'slot';
  const hex = BLOCK_COLORS[type].toString(16).padStart(6, '0');
  slot.innerHTML =
    `<span class="key">${i + 1}</span>` +
    `<span class="block" style="background:#${hex}"></span>` +
    `<span class="label">${BLOCK_NAMES[type]}</span>`;
  slot.addEventListener('click', () => selectSlot(i));
  hotbarEl.appendChild(slot);
  return slot;
});

function selectSlot(i: number): void {
  selectedBlock = hotbar[i];
  slotEls.forEach((s, j) => s.classList.toggle('active', j === i));
}
selectSlot(0);

// —— 状态机 ——
type GameState = 'menu' | 'playing' | 'paused';
let state: GameState = 'menu';

const menuEl = document.getElementById('main-menu')!;
const pauseMenu = document.getElementById('pause-menu')!;

function setState(s: GameState): void {
  state = s;
  menuEl.classList.toggle('visible', s === 'menu');
  pauseMenu.classList.toggle('visible', s === 'paused');
}

// —— 挖 / 放 ——
function raycast(): RaycastHit | null {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  return raycastVoxel(camera.position, dir, 8, (x, y, z) => world.isSolid(x, y, z));
}

function dig(): void {
  const hit = raycast();
  if (hit) world.setBlock(hit.x, hit.y, hit.z, BlockType.Air);
}

function place(): void {
  const hit = raycast();
  if (!hit) return;
  const px = hit.x + hit.nx;
  const py = hit.y + hit.ny;
  const pz = hit.z + hit.nz;
  if (!player.intersectsBlock(px, py, pz)) world.setBlock(px, py, pz, selectedBlock);
}

function resetWorld(newSeed: number): void {
  seed = newSeed;
  world.reset(newSeed);
  const spawn = findSpawn(newSeed);
  player.position.set(spawn.x, spawn.height + 1, spawn.z);
  player.velocity.set(0, 0, 0);
  world.update(player.position.x, player.position.z);
}

// —— 按钮 ——
function resume(): void {
  if (input.isTouch) setState('playing');
  else renderer.domElement.requestPointerLock();
}

document.getElementById('start-btn')!.addEventListener('click', resume);
document.getElementById('resume-btn')!.addEventListener('click', resume);
document.getElementById('menu-btn')!.addEventListener('click', () => {
  setState('menu');
  if (document.pointerLockElement) document.exitPointerLock();
});
document.getElementById('reset-btn')!.addEventListener('click', () => {
  resetWorld(Math.floor(Math.random() * 1000000));
});

// 桌面：pointer lock 状态驱动 游玩/暂停
document.addEventListener('pointerlockchange', () => {
  if (input.isTouch) return;
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) setState('playing');
  else if (state === 'playing') setState('paused');
});

// 桌面：挖/放
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.button === 2) e.preventDefault();
  if (state !== 'playing') return;
  if (e.button === 0) dig();
  else if (e.button === 2) place();
});

// 暂停（桌面端退出指针锁，移动端直接进入暂停）
function pauseGame(): void {
  if (document.pointerLockElement) document.exitPointerLock();
  else setState('paused');
}

// 移动端触控
const setTouchMode = initTouch(input, {
  dig,
  place,
  pause: pauseGame,
});

// 端模式：默认自动检测，手动切换后记住选择
const savedMode = localStorage.getItem('wq-mode');
const initTouchMode = savedMode ? savedMode === 'touch' : input.isTouch;
setTouchMode(initTouchMode);

const modeBtn = document.getElementById('mode-btn')!;
const modeBtn2 = document.getElementById('mode-btn2')!;

function updateModeBtn(): void {
  const label = input.isTouch ? '切换到桌面端' : '切换到移动端';
  modeBtn.textContent = label;
  modeBtn2.textContent = label;
}

function toggleMode(): void {
  const next = !input.isTouch;
  setTouchMode(next);
  localStorage.setItem('wq-mode', next ? 'touch' : 'desktop');
  updateModeBtn();
}

modeBtn.addEventListener('click', toggleMode);
modeBtn2.addEventListener('click', toggleMode);
updateModeBtn();

// 屏蔽浏览器默认手势
document.addEventListener('contextmenu', (e) => e.preventDefault());
document.addEventListener('auxclick', (e) => e.preventDefault());
document.addEventListener('dragstart', (e) => e.preventDefault());
document.addEventListener('selectstart', (e) => e.preventDefault());

// 数字键选方块
document.addEventListener('keydown', (e) => {
  const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];
  const n = digits.indexOf(e.code);
  if (n >= 0 && n < hotbar.length) selectSlot(n);
});

// 滚轮切换（桌面）
document.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (state !== 'playing') return;
    const idx = hotbar.indexOf(selectedBlock);
    const next = (idx + (e.deltaY > 0 ? 1 : -1) + hotbar.length) % hotbar.length;
    selectSlot(next);
  },
  { passive: false },
);

window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// —— 选中框 ——
const highlight = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(1.001, 1.001, 1.001)),
  new THREE.LineBasicMaterial({ color: 0x000000 }),
);
highlight.visible = false;
scene.add(highlight);

// —— HUD ——
const infoEl = document.getElementById('info')!;
const fpsFrames: number[] = [];

function updateInfo(): void {
  const now = performance.now();
  fpsFrames.push(now);
  while (fpsFrames.length > 0 && now - fpsFrames[0] > 1000) fpsFrames.shift();
  const fps = fpsFrames.length;
  const hit = raycast();
  infoEl.textContent =
    `FPS ${fps}\n` +
    `坐标 ${player.position.x.toFixed(1)}, ${player.position.y.toFixed(1)}, ${player.position.z.toFixed(1)}\n` +
    `朝向 ${hit ? BLOCK_NAMES[world.getBlock(hit.x, hit.y, hit.z)] : '—'}`;
}

// —— 主循环 ——
let last = performance.now();
function loop(): void {
  const now = performance.now();
  const dt = Math.min((now - last) / 1000, 0.05);
  last = now;

  if (state === 'playing') {
    player.update(dt, input);
  }
  // 区块始终按玩家位置加载（菜单/暂停时也补齐背景，分帧渐进）
  world.update(player.position.x, player.position.z);

  const hit = raycast();
  if (hit && state === 'playing') {
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    highlight.visible = true;
  } else {
    highlight.visible = false;
  }

  updateInfo();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// 初始化：显示主菜单，预加载出生点周围区块作为背景
setState('menu');
world.update(player.position.x, player.position.z);
loop();
