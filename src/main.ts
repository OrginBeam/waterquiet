// 入口：组装场景、世界、玩家、输入，三态状态机（主菜单 / 游玩 / 暂停）。

import * as THREE from 'three';
import { World } from './world';
import { Player } from './player';
import { Input } from './input';
import { raycastVoxel, RaycastHit } from './raycast';
import { BlockType, BLOCK_NAMES, BLOCK_COLORS, RENDER_DISTANCE, BLOCK_HARDNESS } from './core/constants';
import { findSpawn } from './core/terrain';
import { initTouch } from './touch';
import { SaveData, GameMode, SAVE_VERSION, isIndexedDBAvailable, saveGame, loadGame, listGames, upgradeSave } from './save';
import {
  InventorySlot,
  emptyInventory,
  addItem,
  consumeFrom,
  HOTBAR_SLOTS,
  BACKPACK_SLOTS,
  INVENTORY_SIZE,
} from './core/inventory';
import { getBlockIconDataUrl } from './core/itemIcon';
import { NetworkClient, RemotePlayerState } from './net/client';
import { RemotePlayer } from './net/remotePlayer';
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
scene.add(player.mesh); // 玩家模型加入场景（第一人称隐藏，第三人称可见）
const input = new Input(renderer.domElement);

// —— 视角切换（第一/第三人称）——
// 第三人称仅观看：不能移动/挖掘/放置，只能转视角看自己。F5 或暂停菜单按钮切换。
function toggleView(): void {
  const next = !player.thirdPerson;
  player.setThirdPerson(next);
  showToast(next ? '第三人称（仅观看）' : '第一人称');
}
function resetView(): void {
  if (player.thirdPerson) player.setThirdPerson(false);
}

// —— 快捷栏与背包 ——
// 库存为 45 格 InventorySlot[]：索引 0-8 是快捷栏（挖掘所得优先落入），9-44 是背包区。
// 自由模式：无限方块，快捷栏预置常用方块、放置不消耗；探索模式：挖掘获得、放置消耗。
let gameMode: GameMode = 'free';
let inventory: InventorySlot[] = emptyInventory();
let selectedSlot = 0; // 快捷栏选中索引（0-8）

// 自由模式预置的常用方块；探索模式快捷栏随挖掘/背包整理变化。
const FREE_STARTER: BlockType[] = [
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
// 自由模式确保快捷栏有常用方块可放（只填空位，不覆盖已有物品）。
function prestockFree(): void {
  FREE_STARTER.forEach((t, i) => {
    if (inventory[i].type === null) inventory[i] = { type: t, count: 1 };
  });
}

const hotbarEl = document.getElementById('hotbar')!;
const slotEls: HTMLElement[] = Array.from({ length: HOTBAR_SLOTS }, (_, i) => {
  const slot = document.createElement('div');
  slot.className = 'slot';
  slot.innerHTML =
    `<span class="block"></span>` +
    `<span class="label"></span>` +
    `<span class="count"></span>`;
  slot.addEventListener('click', () => selectSlot(i));
  hotbarEl.appendChild(slot);
  return slot;
});

function selectSlot(i: number): void {
  selectedSlot = i;
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

// 渲染 HUD 快捷栏：每格显示 3D 方块图标、名称与数量（空槽置灰）。
function renderInventory(): void {
  slotEls.forEach((s, i) => {
    const slot = inventory[i];
    const block = s.querySelector('.block') as HTMLElement;
    const label = s.querySelector('.label') as HTMLElement;
    const c = s.querySelector('.count') as HTMLElement;
    if (slot.type === null) {
      block.style.backgroundImage = 'none';
      block.style.background = 'rgba(0,0,0,0.2)';
      label.textContent = '';
      c.textContent = '';
    } else {
      const iconUrl = getBlockIconDataUrl(slot.type);
      block.style.backgroundImage = `url(${iconUrl})`;
      block.style.backgroundSize = 'contain';
      block.style.backgroundRepeat = 'no-repeat';
      block.style.backgroundPosition = 'center';
      label.textContent = BLOCK_NAMES[slot.type];
      c.textContent = gameMode === 'explore' ? String(slot.count) : '';
    }
  });
}

// —— 背包面板 ——
// 打开时用鼠标/触屏整理物品：左键拿起/放下（同类合并、异类交换），右键拆半。
// 关闭面板时手持物品自动归还库存。
let backpackOpen = false;
// 手持物品：从格子拿起、悬在鼠标下的那格物品；null = 手上空。
let held: InventorySlot | null = null;

const backpackEl = document.getElementById('backpack')!;
const bpGridEl = document.getElementById('bp-grid')!;
const bpHotbarEl = document.getElementById('bp-hotbar')!;
const bpHeldEl = document.getElementById('bp-held')!;

// 面板两行区域分别对应：背包区 9-44（36 格）、快捷栏 0-8（9 格）
const BP_GRID_INDICES = Array.from({ length: BACKPACK_SLOTS }, (_, i) => i + HOTBAR_SLOTS);
const BP_HOTBAR_INDICES = Array.from({ length: HOTBAR_SLOTS }, (_, i) => i);

function renderBackpack(): void {
  renderBpRow(bpGridEl, BP_GRID_INDICES);
  renderBpRow(bpHotbarEl, BP_HOTBAR_INDICES);
  if (held) {
    const iconUrl = getBlockIconDataUrl(held.type!);
    const countStr = gameMode === 'explore' ? ` ×${held.count}` : '';
    bpHeldEl.innerHTML = `<img src="${iconUrl}" class="held-icon" /> <span>手持：${BLOCK_NAMES[held.type!]}${countStr}</span>`;
  } else {
    bpHeldEl.innerHTML = '';
  }
}

function renderBpRow(container: HTMLElement, indices: number[]): void {
  container.innerHTML = '';
  for (const idx of indices) {
    const slot = inventory[idx];
    const el = document.createElement('div');
    el.className = 'bp-slot';
    const block = document.createElement('span');
    block.className = 'bp-block';
    const count = document.createElement('span');
    count.className = 'bp-count';
    el.append(block, count);
    if (slot.type !== null) {
      const iconUrl = getBlockIconDataUrl(slot.type);
      block.style.backgroundImage = `url(${iconUrl})`;
      block.style.backgroundSize = 'contain';
      block.style.backgroundRepeat = 'no-repeat';
      block.style.backgroundPosition = 'center';
      if (gameMode === 'explore') {
        count.textContent = String(slot.count);
      }
    }
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault(); // 阻止点格子时触发 canvas 挖掘/放置
      onBpClick(idx, e.button === 2);
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    container.appendChild(el);
  }
}

// 背包格点击：左键拿起/合并/交换，右键拆半/放入一个。
function onBpClick(idx: number, right: boolean): void {
  const slot = inventory[idx];
  if (right) {
    if (!held) {
      // 右键、手上空：取半堆（至少 1）
      if (slot.type !== null && slot.count > 0) {
        const take = Math.max(1, Math.ceil(slot.count / 2));
        held = { type: slot.type, count: take };
        slot.count -= take;
        if (slot.count === 0) slot.type = null;
      }
    } else if (slot.type === null || slot.type === held.type) {
      // 右键、手上有：放入一个（目标为空或同类）
      slot.type = held.type;
      slot.count += 1;
      held.count -= 1;
      if (held.count === 0) held = null;
    }
  } else if (!held) {
    // 左键、手上空：拿起整格
    if (slot.type !== null && slot.count > 0) {
      held = { type: slot.type, count: slot.count };
      slot.type = null;
      slot.count = 0;
    }
  } else if (slot.type === null || slot.type === held.type) {
    // 左键、手上有：合并（空位放入 / 同类累加）
    slot.type = held.type;
    slot.count += held.count;
    held = null;
  } else {
    // 左键、异类：交换
    const t = { type: slot.type, count: slot.count };
    slot.type = held.type;
    slot.count = held.count;
    held = t;
  }
  renderBackpack();
  renderInventory();
}

function openBackpack(): void {
  if (backpackOpen || state !== 'playing') return;
  backpackOpen = true;
  renderBackpack();
  backpackEl.classList.add('visible');
  // 桌面端需退出指针锁，鼠标才能操作面板
  if (!input.isTouch && document.pointerLockElement) document.exitPointerLock();
}

function closeBackpack(): void {
  if (!backpackOpen) return;
  backpackOpen = false;
  backpackEl.classList.remove('visible');
  // 手持物品归还库存；放不下则丢弃（当前无限堆叠不会发生）
  if (held) {
    const leftover = addItem(inventory, held.type!, held.count);
    held = null;
    if (leftover > 0) showToast('背包已满，物品丢失');
    renderInventory();
  }
  // 桌面端重新锁定鼠标回到游玩
  if (!input.isTouch && state === 'playing') renderer.domElement.requestPointerLock();
}

function toggleBackpack(): void {
  if (backpackOpen) closeBackpack();
  else openBackpack();
}

// 丢弃手持物品
document.getElementById('bp-discard')!.addEventListener('click', () => {
  held = null;
  renderBackpack();
});

// 点击面板遮罩（卡片外区域）关闭
backpackEl.addEventListener('pointerdown', (e) => {
  if (e.target === backpackEl) closeBackpack();
});

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
  // 离开游玩态（暂停/回菜单）时收起背包，避免面板残留在非游玩界面
  if (s !== 'playing' && backpackOpen) closeBackpack();
  menuEl.classList.toggle('visible', s === 'menu');
  pauseMenu.classList.toggle('visible', s === 'paused');
  // 暂停/返回主菜单时自动存档（重新生成世界后 seed 已变，autosave 会被抑制以保护旧档）
  if (s === 'paused' && activeSlot !== null) void autosave();
  if (s === 'menu' && activeSlot !== null) void autosave();
}

// —— 联机 ——
// 联机模式：连服务端权威世界。挖/放走 set-block 请求；移动上报；渲染其他玩家。
// 联机时不用本地存档（activeSlot 保持 null，autosave 被抑制）。
const net = new NetworkClient();
// 其他玩家（sessionId → RemotePlayer）
const remotePlayers = new Map<string, RemotePlayer>();
let online = false;
// 联机时玩家名（由连接面板填写）
let onlineName = '玩家';
// 移动上报节流累加器（~10次/秒）
let moveAccum = 0;

// 暂停菜单「重新生成世界」按钮：联机时禁用（世界由服务器权威管理）
const resetBtn = document.getElementById('reset-btn') as HTMLButtonElement;
function updateOnlineUI(): void {
  resetBtn.disabled = online;
  resetBtn.style.opacity = online ? '0.4' : '1';
  resetBtn.style.cursor = online ? 'not-allowed' : 'pointer';
}

function joinOnline(url: string): void {
  net.onWorldInit = (init) => {
    // 用服务端世界重建本地世界（seed + 脏区块）
    seed = init.seed;
    world.reset(seed);
    world.importChunks(init.chunks.map((c) => ({ key: c.key, data: Uint8Array.from(c.data) })));
    // 放出生点
    player.position.set(init.spawn.x, init.spawn.y, init.spawn.z);
    player.velocity.set(0, 0, 0);
    player.onGround = false;
    resetView();
    world.rebuildArea(player.position.x, player.position.z);
    // 游戏模式以服务器为准（探索=挖掘收集方块；自由=无限方块）
    gameMode = init.mode === 'explore' ? 'explore' : 'free';
    document.body.classList.toggle('explore', gameMode === 'explore');
    inventory = emptyInventory();
    held = null;
    if (gameMode === 'free') prestockFree(); // 自由模式预置快捷栏常用方块（否则没方块可放）
    selectedSlot = 0;
    selectSlot(0);
    renderInventory();

    online = true;
    updateOnlineUI(); // 联机：禁用「重新生成世界」
    hideOnlineDialog();
    showToast('已连接服务器');
    closeMenu();
    resume();
  };

  net.onBlockUpdate = ({ x, y, z, blockType }) => {
    // 服务端广播的方块变更，应用到本地世界（含自己的回显，幂等）
    world.setBlock(x, y, z, blockType);
  };

  net.onModeChange = (mode) => {
    const next = mode === 'explore' ? 'explore' : 'free';
    gameMode = next;
    document.body.classList.toggle('explore', next === 'explore');
    if (next === 'free') {
      prestockFree(); // 切回自由：预置快捷栏常用方块
    } else {
      // 切到探索：清空物品栏和背包，从零开始挖矿收集
      inventory = emptyInventory();
      held = null;
    }
    selectedSlot = 0;
    selectSlot(0);
    renderInventory();
    showToast(next === 'explore' ? '模式已切换：探索（背包已清空，挖掘获得方块）' : '模式已切换：自由（无限方块）');
  };

  net.onPlayersChanged = (players) => {
    // 增量管理远程玩家：出现 → 创建；消失 → 移除；存在 → 更新目标位置
    for (const [sid, rp] of [...remotePlayers]) {
      if (!players.has(sid)) {
        scene.remove(rp.group);
        remotePlayers.delete(sid);
      }
    }
    for (const [sid, st] of players) {
      // 自己（sessionId 由 world-init 后的 room 提供；这里用 room 判断）
      if (net.room && sid === net.room.sessionId) continue;
      let rp = remotePlayers.get(sid);
      if (!rp) {
        rp = new RemotePlayer(st);
        scene.add(rp.group);
        remotePlayers.set(sid, rp);
      }
      rp.sync(st);
    }
  };

  net.onChat = (text) => {
    // 服务器广播消息（say 指令/被踢提示）用 toast 显示
    showToast(text);
  };

  net.onLeave = (code) => {
    online = false;
    updateOnlineUI(); // 恢复「重新生成世界」
    for (const rp of remotePlayers.values()) scene.remove(rp.group);
    remotePlayers.clear();
    setState('menu');
    showToast(code === 0 ? '已断开连接' : `连接断开（code ${code}）`);
  };

  // 异步连接：开始时提示，成功由 world-init 回调提示「已连接服务器」
  showToast('正在连接服务器…');
  net.connect(url, onlineName)
    .catch((e) => {
      console.warn('联机连接失败', e);
      showToast('无法连接服务器');
      hideOnlineDialog();
    });
}

function closeMenu(): void {
  setState('playing');
}

// —— 挖 / 放 ——
// 挖掘是「按住蓄力」：主循环每帧推进，达到硬度时间才挖掉（见 loop）。
let digTarget: { x: number; y: number; z: number } | null = null;
let digProgress = 0;
// 自由模式秒挖的节流：两次挖掘之间的最小间隔，避免按住横扫瞬挖一排。
const DIG_COOLDOWN = 0.3; // 秒
let digCooldown = 0;

function raycast(): RaycastHit | null {
  const dir = new THREE.Vector3();
  camera.getWorldDirection(dir);
  return raycastVoxel(camera.position, dir, 8, (x, y, z) => world.isSolid(x, y, z));
}

function place(): void {
  if (player.thirdPerson) return; // 第三人称仅观看，不能放置
  const hit = raycast();
  if (!hit) return;
  const slot = inventory[selectedSlot];
  if (slot.type === null) return; // 选中格为空（探索模式可能没东西）
  const px = hit.x + hit.nx;
  const py = hit.y + hit.ny;
  const pz = hit.z + hit.nz;
  // 探索模式：库存不足禁止放置
  if (gameMode === 'explore' && slot.count <= 0) {
    showToast('没有该方块');
    return;
  }
  if (!player.intersectsBlock(px, py, pz)) {
    // 联机：乐观本地应用 + 发请求（服务端广播回来幂等覆盖）
    world.setBlock(px, py, pz, slot.type);
    if (online) net.setBlock(px, py, pz, slot.type);
    if (gameMode === 'explore') {
      consumeFrom(inventory, selectedSlot, 1);
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
  resetView(); // 新世界从第一人称开始
  world.update(player.position.x, player.position.z);
}

// —— 存档 ——
const slotsEl = document.getElementById('slots')!;

function renderSlots(): void {
  slotsEl.innerHTML = '';
  // 已存槽位卡片（按槽位号排序）；「新建世界」卡是静态元素，固定在滚动区外
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
}

// 下一个可用槽位号：当前最大槽位 + 1（无存档从 0 开始）。
function nextSlotNumber(): number {
  let max = -1;
  for (const s of slotMeta.keys()) if (s > max) max = s;
  return max + 1;
}

// 打包并写入某槽位。手动保存直接调用；自动保存在通过抑制检查后调用。
async function saveSlot(slot: number): Promise<void> {
  // 深拷贝库存快照：异步写盘期间玩家可能继续挖掘/移动物品，快照与实时数据互不干扰
  const inv = inventory.map((s) => ({ type: s.type, count: s.count }));
  // 背包打开时切后台会触发 autosave，把手持物品一并写入防止丢失
  if (held) addItem(inv, held.type!, held.count);
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
    inventory: inv,
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
    const raw = await loadGame(slot);
    if (!raw) return;
    if (raw.version > SAVE_VERSION) {
      console.warn(`存档 ${slot + 1} 版本过新（${raw.version}），未载入`);
      return;
    }
    // 低版本存档原地升级（v1 库存 number[16] → v2 格子背包）
    const data = upgradeSave(raw);

    seed = data.seed;
    world.reset(seed); // 清空旧世界网格/区块/脏标记，换种子
    world.importChunks(data.chunks);
    player.position.set(data.player.x, data.player.y, data.player.z);
    player.velocity.set(0, 0, 0); // 速度清零，避免载入瞬间冲刺
    player.onGround = false; // 由物理碰撞下一帧重算
    player.yaw = data.player.yaw;
    player.pitch = data.player.pitch; // setter 内同步相机
    resetView(); // 载入存档从第一人称开始

    // 恢复模式与库存（旧档无这些字段 → 默认自由 + 空背包）
    gameMode = data.mode ?? 'free';
    inventory =
      Array.isArray(data.inventory) && data.inventory.length === INVENTORY_SIZE
        ? data.inventory.map((s) => ({ type: s.type, count: s.count }))
        : emptyInventory();
    held = null; // 新世界清空手持状态（关闭背包时已归还，双保险）
    if (gameMode === 'free') prestockFree(); // 自由模式保证快捷栏有方块可放
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
  inventory = emptyInventory();
  held = null;
  if (mode === 'free') prestockFree(); // 自由模式预置快捷栏常用方块
  selectedSlot = 0;
  selectSlot(0);
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
document.getElementById('slot-create')!.addEventListener('click', openModePicker);
document.getElementById('mode-pick-free')!.addEventListener('click', () => {
  closeModePicker();
  startWorld('free');
});
document.getElementById('mode-pick-explore')!.addEventListener('click', () => {
  closeModePicker();
  startWorld('explore');
});
document.getElementById('mode-pick-cancel')!.addEventListener('click', closeModePicker);

// —— 联机连接面板 ——
const onlineDialog = document.getElementById('online-dialog')!;
const onlineAddrInput = document.getElementById('online-addr') as HTMLInputElement;
const onlineNameInput = document.getElementById('online-name') as HTMLInputElement;

function openOnlineDialog(): void {
  // 填入上次使用的地址/名字（localStorage 记忆）
  onlineAddrInput.value = localStorage.getItem('wq-net-addr') ?? 'ws://localhost:2567';
  onlineNameInput.value = localStorage.getItem('wq-net-name') ?? '';
  onlineDialog.classList.add('visible');
}
function hideOnlineDialog(): void {
  onlineDialog.classList.remove('visible');
}
document.getElementById('slot-online')!.addEventListener('click', openOnlineDialog);
document.getElementById('online-connect')!.addEventListener('click', () => {
  const addr = onlineAddrInput.value.trim();
  const name = onlineNameInput.value.trim() || `玩家${Math.floor(Math.random() * 1000)}`;
  if (!addr) return;
  localStorage.setItem('wq-net-addr', addr);
  localStorage.setItem('wq-net-name', name);
  onlineName = name;
  hideOnlineDialog();
  joinOnline(addr);
});
document.getElementById('online-cancel')!.addEventListener('click', hideOnlineDialog);

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
// 暂停菜单：切换第一/第三人称，切换后继续游戏（桌面端 resume 会重新锁定鼠标）
document.getElementById('view-btn')!.addEventListener('click', () => {
  toggleView();
  resume();
});
// 右上角背包按钮：移动端直接切换；桌面端指针锁定中点击会先退出锁，此处仅移动端生效（桌面用 E 键）
document.getElementById('btn-bag')!.addEventListener('click', () => {
  if (state === 'playing') toggleBackpack();
});
document.getElementById('menu-btn')!.addEventListener('click', () => {
  // 联机返回主菜单：断开连接（onLeave 里会清理远程玩家并回菜单）
  if (online) {
    online = false;
    updateOnlineUI(); // 恢复「重新生成世界」
    void net.leave();
    for (const rp of remotePlayers.values()) scene.remove(rp.group);
    remotePlayers.clear();
  }
  setState('menu');
  if (document.pointerLockElement) document.exitPointerLock();
});
document.getElementById('reset-btn')!.addEventListener('click', () => {
  // 联机世界由服务器权威管理，禁止本地重新生成（否则与服务器世界不同步）
  if (online) {
    showToast('联机中不能重新生成世界');
    return;
  }
  resetWorld(Math.floor(Math.random() * 1000000));
  // 重新生成世界：新世界从零开始（模式不变），旧档已被自动存抑制逻辑保护
  inventory = emptyInventory();
  if (gameMode === 'free') prestockFree();
  selectedSlot = 0;
  selectSlot(0);
  renderInventory();
});
// 手动保存：无条件覆盖当前槽位（联机世界由服务器存档，本地不保存）
document.getElementById('save-btn')!.addEventListener('click', () => {
  if (online) {
    showToast('联机世界由服务器自动保存');
    return;
  }
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
  // 背包打开时退出指针锁（为了操作面板），不视为暂停
  else if (state === 'playing' && !backpackOpen) setState('paused');
});

// 桌面：挖/放。左键按住状态由 input 跟踪、主循环驱动持续挖掘；右键瞬时放置。
renderer.domElement.addEventListener('mousedown', (e) => {
  if (e.button === 1 || e.button === 2) e.preventDefault();
  if (state !== 'playing') return;
  if (backpackOpen) {
    // 背包打开时点画面外（左键）关闭
    if (e.button === 0) closeBackpack();
    return;
  }
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

// 数字键选方块（第三人称仅观看，不响应）
document.addEventListener('keydown', (e) => {
  if (backpackOpen || player.thirdPerson) return;
  const digits = ['Digit1', 'Digit2', 'Digit3', 'Digit4', 'Digit5', 'Digit6', 'Digit7', 'Digit8', 'Digit9'];
  const n = digits.indexOf(e.code);
  if (n >= 0 && n < HOTBAR_SLOTS) selectSlot(n);
});

// 背包开关：E 打开/关闭，B 打开，Esc 关闭（关闭时归还/丢弃手持物品）
document.addEventListener('keydown', (e) => {
  if (e.code === 'KeyE') {
    toggleBackpack();
  } else if (e.code === 'KeyB') {
    if (!backpackOpen) openBackpack();
  } else if (e.code === 'Escape' && backpackOpen) {
    closeBackpack();
  }
});

// F5 切换第一/第三人称（阻止浏览器默认刷新）
document.addEventListener('keydown', (e) => {
  if (e.code === 'F5' && state === 'playing') {
    e.preventDefault();
    toggleView();
  }
});

// 滚轮切换物品栏（桌面，仅游玩中拦截滚轮；菜单/暂停放行让原生滚动生效，例如滚动存档列表）
document.addEventListener(
  'wheel',
  (e) => {
    if (state !== 'playing' || backpackOpen || player.thirdPerson) return;
    e.preventDefault();
    const next = (selectedSlot + (e.deltaY > 0 ? 1 : -1) + HOTBAR_SLOTS) % HOTBAR_SLOTS;
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

  if (state === 'playing' && !backpackOpen) {
    player.update(dt, input);
  }
  // 联机：节流上报自身位置（~10次/秒）；插值更新远程玩家
  if (online && state === 'playing') {
    moveAccum += dt;
    if (moveAccum >= 0.1) {
      moveAccum = 0;
      net.sendMove(player.position.x, player.position.y, player.position.z, player.yaw, player.pitch);
    }
  }
  for (const rp of remotePlayers.values()) rp.update(dt);
  // 区块始终按玩家位置加载（菜单/暂停时也补齐背景，分帧渐进）
  world.update(player.position.x, player.position.z);

  const hit = raycast();
  // 第三人称只观看：不显示方块选中框、不能挖掘
  if (hit && state === 'playing' && !player.thirdPerson) {
    highlight.position.set(hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    highlight.visible = true;
  } else {
    highlight.visible = false;
  }

  // 挖掘：自由模式秒挖但有节流（两次之间留间隔）；探索模式按住蓄力达到硬度时间才挖掉；松开/暂停重置
  if (digCooldown > 0) digCooldown -= dt;
  if (state === 'playing' && !backpackOpen && !player.thirdPerson && input.digging && hit) {
    if (gameMode === 'free') {
      // 自由模式：无限方块，无需蓄力，命中即挖（不入库），受冷却节流
      if (digCooldown <= 0) {
        world.setBlock(hit.x, hit.y, hit.z, BlockType.Air);
        if (online) net.setBlock(hit.x, hit.y, hit.z, BlockType.Air);
        digCooldown = DIG_COOLDOWN;
      }
    } else if (!digTarget || digTarget.x !== hit.x || digTarget.y !== hit.y || digTarget.z !== hit.z) {
      digTarget = { x: hit.x, y: hit.y, z: hit.z };
      digProgress = 0; // 目标改变 → 重新蓄力
    } else {
      const hardness = BLOCK_HARDNESS[world.getBlock(hit.x, hit.y, hit.z)] ?? 1;
      digProgress += dt / hardness;
      if (digProgress >= 1) {
        // 探索模式：挖掘获得方块入库（水/空气不可挖，双保险过滤）
        if (gameMode === 'explore') {
          const mined = world.getBlock(hit.x, hit.y, hit.z);
          if (mined !== BlockType.Air && mined !== BlockType.Water) {
            addItem(inventory, mined, 1); // 优先并入已有同类型，其次填首个空位
            renderInventory();
          }
        }
        world.setBlock(hit.x, hit.y, hit.z, BlockType.Air);
        if (online) net.setBlock(hit.x, hit.y, hit.z, BlockType.Air);
        digTarget = null;
        digProgress = 0;
      }
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
