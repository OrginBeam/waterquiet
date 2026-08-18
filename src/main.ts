// 入口：组装场景、世界、玩家、输入，三态状态机（主菜单 / 游玩 / 暂停）。

import * as THREE from 'three';
import { World } from './world';
import { Player } from './player';
import { Input } from './input';
import { raycastVoxel, RaycastHit } from './raycast';
import { BlockType, BLOCK_NAMES, BLOCK_COLORS, RENDER_DISTANCE, BLOCK_HARDNESS } from './core/constants';
import { findSpawn } from './core/terrain';
import { initTouch } from './touch';
import { SaveData, GameMode, SAVE_VERSION, isIndexedDBAvailable, saveGame, loadGame, listGames } from './save';
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

// 游戏模式与库存：自由模式无限方块；探索模式挖掘获得、放置消耗。
let gameMode: GameMode = 'free';
let inventory: number[] = Array.from({ length: 16 }, () => 0);

const hotbarEl = document.getElementById('hotbar')!;
const slotEls: HTMLElement[] = hotbar.map((type, i) => {
  const slot = document.createElement('div');
  slot.className = 'slot';
  const hex = BLOCK_COLORS[type].toString(16).padStart(6, '0');
  slot.innerHTML =
    `<span class="key">${i + 1}</span>` +
    `<span class="block" style="background:#${hex}"></span>` +
    `<span class="label">${BLOCK_NAMES[type]}</span>` +
    `<span class="count"></span>`;
  slot.addEventListener('click', () => selectSlot(i));
  hotbarEl.appendChild(slot);
  return slot;
});

function selectSlot(i: number): void {
  selectedBlock = hotbar[i];
  slotEls.forEach((s, j) => s.classList.toggle('active', j === i));
}
selectSlot(0);

// —— 库存数量徽标：探索模式显示，自由模式隐藏 ——
const toastEl = document.getElementById('toast')!;
let toastTimer: number | undefined;
function showToast(msg: string): void {
  if (toastTimer !== undefined) window.clearTimeout(toastTimer);
  toastEl.textContent = msg;
  toastEl.classList.add('visible');
  toastTimer = window.setTimeout(() => toastEl.classList.remove('visible'), 1500);
}

function renderInventory(): void {
  slotEls.forEach((s, i) => {
    const c = s.querySelector('.count');
    if (c) c.textContent = String(inventory[hotbar[i]] ?? 0);
  });
}

// —— 状态机 ——
type GameState = 'menu' | 'playing' | 'paused';
let state: GameState = 'menu';

// —— 存档槽位状态 ——
// 当前世界绑定的槽位；null = 尚未开档（主菜单初始态）。
let activeSlot: number | null = null;
// 每槽位最近一次保存时的种子与时间。自动存抑制判断（重新生成世界后保护旧档）全靠它。
// 槽位不限数量，随「新建世界」动态扩展（下一个槽位号 = 当前最大 + 1）。
const slotMeta = new Map<number, { seed: number; savedAt: number | null; mode: GameMode }>();

const menuEl = document.getElementById('main-menu')!;
const pauseMenu = document.getElementById('pause-menu')!;

function setState(s: GameState): void {
  state = s;
  menuEl.classList.toggle('visible', s === 'menu');
  pauseMenu.classList.toggle('visible', s === 'paused');
  // 暂停/返回主菜单时自动存档（重新生成世界后 seed 已变，autosave 会被抑制以保护旧档）
  if (s === 'paused') void autosave();
  if (s === 'menu' && activeSlot !== null) void autosave();
}

// —— 挖 / 放 ——
// 挖掘是「按住蓄力」：主循环每帧推进，达到硬度时间才挖掉（见 loop）。
let digTarget: { x: number; y: number; z: number } | null = null;
let digProgress = 0;

function raycast(): RaycastHit | null {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  return raycastVoxel(camera.position, dir, 8, (x, y, z) => world.isSolid(x, y, z));
}

function place(): void {
  const hit = raycast();
  if (!hit) return;
  const px = hit.x + hit.nx;
  const py = hit.y + hit.ny;
  const pz = hit.z + hit.nz;
  // 探索模式：库存不足禁止放置
  if (gameMode === 'explore' && (inventory[selectedBlock] ?? 0) <= 0) {
    showToast('没有该方块');
    return;
  }
  if (!player.intersectsBlock(px, py, pz)) {
    world.setBlock(px, py, pz, selectedBlock);
    if (gameMode === 'explore') {
      inventory[selectedBlock]--;
      renderInventory();
    }
  }
}

function resetWorld(newSeed: number): void {
  seed = newSeed;
  world.reset(newSeed);
  const spawn = findSpawn(newSeed);
  player.position.set(spawn.x, spawn.height + 1, spawn.z);
  player.velocity.set(0, 0, 0);
  world.update(player.position.x, player.position.z);
}

// —— 存档 ——
const slotsEl = document.getElementById('slots')!;

function renderSlots(): void {
  slotsEl.innerHTML = '';
  // 已存槽位卡片（按槽位号排序）
  for (const [slot, m] of [...slotMeta.entries()].sort((a, b) => a[0] - b[0])) {
    if (m.savedAt === null) continue;
    const card = document.createElement('button');
    card.className = 'slot-card';
    card.innerHTML =
      `<span class="slot-num">存档 ${slot + 1} · ${m.mode === 'explore' ? '探索' : '自由'}</span>` +
      `<span class="slot-info">${new Date(m.savedAt).toLocaleString('zh-CN')}</span>` +
      `<span class="slot-info sub">种子 ${m.seed} · 点击载入</span>`;
    card.addEventListener('click', () => void loadSlot(slot));
    slotsEl.appendChild(card);
  }
  // 新建世界卡片：始终在最后，槽位自动分配
  const create = document.createElement('button');
  create.className = 'slot-card create';
  create.innerHTML = `<span class="slot-num">＋ 新建世界</span><span class="slot-info">选择一个模式开始新的探索</span>`;
  create.addEventListener('click', openModePicker);
  slotsEl.appendChild(create);
}

// 下一个可用槽位号：当前最大槽位 + 1（无存档从 0 开始）。
function nextSlotNumber(): number {
  let max = -1;
  for (const s of slotMeta.keys()) if (s > max) max = s;
  return max + 1;
}

// 打包并写入某槽位。手动保存直接调用；自动保存在通过抑制检查后调用。
async function saveSlot(slot: number): Promise<void> {
  const data: SaveData = {
    slot,
    version: SAVE_VERSION,
    seed: world.seed,
    savedAt: Date.now(),
    player: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
      yaw: player.yaw,
      pitch: player.pitch,
    },
    chunks: world.exportDirtyChunks(),
    mode: gameMode,
    inventory: inventory.slice(),
  };
  try {
    await saveGame(slot, data);
    slotMeta.set(slot, { seed: world.seed, savedAt: data.savedAt, mode: gameMode });
    renderSlots(); // 刷新主菜单卡片时间戳
  } catch (e) {
    console.warn('保存失败', e); // 存档失败绝不抛出影响主循环
  }
}

// 自动存：未开档 → 抑制；槽位已有存档且世界 seed 已变（重新生成后）→ 抑制保护旧档。
// 槽位无记录（全新世界首次存）→ 放行，保存后建立元数据。
async function autosave(): Promise<void> {
  if (activeSlot === null) return;
  const m = slotMeta.get(activeSlot);
  if (m && m.seed !== world.seed) return;
  await saveSlot(activeSlot);
}

// 载入槽位。不走 resetWorld（它会把玩家丢到 findSpawn），而是 world.reset + 手工恢复玩家。
async function loadSlot(slot: number): Promise<void> {
  try {
    const data = await loadGame(slot);
    if (!data) return;
    if (data.version !== SAVE_VERSION) {
      console.warn(`存档 ${slot + 1} 版本不兼容（${data.version}），未载入`);
      return;
    }

    seed = data.seed;
    world.reset(seed); // 清空旧世界网格/区块/脏标记，换种子
    world.importChunks(data.chunks);
    player.position.set(data.player.x, data.player.y, data.player.z);
    player.velocity.set(0, 0, 0); // 速度清零，避免载入瞬间冲刺
    player.onGround = false; // 由物理碰撞下一帧重算
    player.yaw = data.player.yaw;
    player.pitch = data.player.pitch; // setter 内同步相机

    // 恢复模式与库存（旧档无这些字段 → 默认自由 + 全 0）
    gameMode = data.mode ?? 'free';
    inventory = (data.inventory ?? Array.from({ length: 16 }, () => 0)).slice();
    renderInventory();
    document.body.classList.toggle('explore', gameMode === 'explore');

    world.rebuildArea(player.position.x, player.position.z); // 立即呈现加载区

    activeSlot = slot;
    resume(); // 桌面请求指针锁 / 移动端直接进 playing
  } catch (e) {
    console.warn('载入失败', e);
  }
}

// 新建世界：自动分配新槽位号，沿用现有随机种子逻辑，绑定所选模式。
function startWorld(mode: GameMode): void {
  const slot = nextSlotNumber();
  resetWorld(Math.floor(Math.random() * 1000000));
  gameMode = mode;
  inventory.fill(0);
  renderInventory();
  document.body.classList.toggle('explore', mode === 'explore');
  activeSlot = slot;
  renderSlots();
  resume();
}

// 弹模式选择（新建世界入口）；确认后分配槽位
const modePicker = document.getElementById('mode-picker')!;
function openModePicker(): void {
  modePicker.classList.add('visible');
}
function closeModePicker(): void {
  modePicker.classList.remove('visible');
}
document.getElementById('mode-pick-free')!.addEventListener('click', () => {
  closeModePicker();
  startWorld('free');
});
document.getElementById('mode-pick-explore')!.addEventListener('click', () => {
  closeModePicker();
  startWorld('explore');
});
document.getElementById('mode-pick-cancel')!.addEventListener('click', closeModePicker);

// 启动时读取已存档槽位，填充主菜单卡片
if (isIndexedDBAvailable()) {
  listGames()
    .then((list) => {
      for (const s of list) slotMeta.set(s.slot, { seed: s.seed, savedAt: s.savedAt, mode: s.mode ?? 'free' });
      renderSlots();
    })
    .catch((e) => console.warn('读取存档失败', e));
} else {
  console.warn('当前环境不支持 IndexedDB，存档功能不可用');
  renderSlots();
}

// —— 按钮 ——
function resume(): void {
  if (input.isTouch) setState('playing');
  else renderer.domElement.requestPointerLock();
}

document.getElementById('resume-btn')!.addEventListener('click', resume);
document.getElementById('menu-btn')!.addEventListener('click', () => {
  setState('menu');
  if (document.pointerLockElement) document.exitPointerLock();
});
document.getElementById('reset-btn')!.addEventListener('click', () => {
  resetWorld(Math.floor(Math.random() * 1000000));
  // 重新生成世界：新世界从零开始（模式不变），旧档已被自动存抑制逻辑保护
  inventory.fill(0);
  renderInventory();
});
// 手动保存：无条件覆盖当前槽位
document.getElementById('save-btn')!.addEventListener('click', () => {
  if (activeSlot !== null) void saveSlot(activeSlot);
});

// 自动存兜底：切出页面/销毁时尝试落盘（fire-and-forget，复用已建连接）。
// 不 preventDefault/returnValue，避免浏览器弹确认框。
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') void autosave();
});
window.addEventListener('pagehide', () => void autosave());
window.addEventListener('beforeunload', () => void autosave());

// 桌面：pointer lock 状态驱动 游玩/暂停
document.addEventListener('pointerlockchange', () => {
  if (input.isTouch) return;
  const locked = document.pointerLockElement === renderer.domElement;
  if (locked) setState('playing');
  else if (state === 'playing') setState('paused');
});

// 桌面：挖/放。左键按住状态由 input 跟踪、主循环驱动持续挖掘；右键瞬时放置。
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.button === 2) e.preventDefault();
  if (state !== 'playing') return;
  if (e.button === 2) place();
});

// 暂停（桌面端退出指针锁，移动端直接进入暂停）
function pauseGame(): void {
  if (document.pointerLockElement) document.exitPointerLock();
  else setState('paused');
}

// 移动端触控
const setTouchMode = initTouch(input, {
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
const digBar = document.getElementById('dig-bar')!;
const digFill = document.getElementById('dig-fill')!;
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

  // 挖掘：按住左键/挖按钮持续蓄力，达到方块硬度时间才挖掉；松开/暂停重置
  if (state === 'playing' && input.digging && hit) {
    if (!digTarget || digTarget.x !== hit.x || digTarget.y !== hit.y || digTarget.z !== hit.z) {
      digTarget = { x: hit.x, y: hit.y, z: hit.z };
      digProgress = 0; // 目标改变 → 重新蓄力
    }
    const hardness = BLOCK_HARDNESS[world.getBlock(hit.x, hit.y, hit.z)] ?? 1;
    digProgress += dt / hardness;
    if (digProgress >= 1) {
      // 探索模式：挖掘获得方块（水/空气不可挖，双保险过滤）
      if (gameMode === 'explore') {
        const mined = world.getBlock(hit.x, hit.y, hit.z);
        if (mined !== BlockType.Air && mined !== BlockType.Water) {
          inventory[mined]++;
          renderInventory();
        }
      }
      world.setBlock(hit.x, hit.y, hit.z, BlockType.Air);
      digTarget = null;
      digProgress = 0;
    }
  } else {
    digTarget = null;
    digProgress = 0; // 松开 / 暂停 / 无目标 → 重置
  }
  // 进度条
  const digP = state === 'playing' && digTarget ? Math.min(digProgress, 1) : 0;
  digFill.style.width = `${(digP * 100).toFixed(1)}%`;
  digBar.style.opacity = digP > 0 ? '1' : '0';

  updateInfo();
  renderer.render(scene, camera);
  requestAnimationFrame(loop);
}

// 初始化：显示主菜单，预加载出生点周围区块作为背景
setState('menu');
world.update(player.position.x, player.position.z);
loop();
