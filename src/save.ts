// 单机存档：IndexedDB 槽位读写。零依赖，手写包装。
// 存档只含被修改过的（dirty）区块，未修改区块由种子即时重建（见 terrain.ts）。
// typed array 直接走 structured clone 存盘，无需转 Blob。
//
// 版本历史：
//   1 —— inventory 为 number[16]（按 BlockType 索引的数量）
//   2 —— inventory 升级为 InventorySlot[45]（格子背包），旧档由 upgradeSave 迁移

import { InventorySlot, emptyInventory, migrateInventory } from './core/inventory';

export const SAVE_VERSION = 2;

// 游戏模式：自由（无限方块）/ 探索（挖掘获得、放置消耗）。
export type GameMode = 'free' | 'explore';

// 玩家状态。速度/着地状态不存：载入后速度清零，onGround 由物理碰撞下一帧重算。
export interface PlayerSaveData {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

// 单个区块记录：key 即 chunks Map 的键 "cx,cz"，data 为整块 16×64×16 字节。
export interface ChunkRecord {
  key: string;
  data: Uint8Array;
}

export interface SaveData {
  slot: number;
  version: number;
  seed: number;
  savedAt: number; // epoch ms，用于槽位卡片展示与覆盖判断
  player: PlayerSaveData;
  chunks: ChunkRecord[];
  // 模式与库存（可选：旧档没有这些字段，载入时走默认值）
  mode?: GameMode;
  inventory?: InventorySlot[]; // 格子背包，长 45（0-8 快捷栏 / 9-44 背包区）
}

const DB_NAME = 'waterquiet-save';
const STORE = 'saves';

let dbPromise: Promise<IDBDatabase> | null = null;

// 环境不支持 IndexedDB 时返回 false，调用方降级为「无存档」并 console.warn。
export function isIndexedDBAvailable(): boolean {
  return typeof window !== 'undefined' && 'indexedDB' in window;
}

function openDB(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: 'slot' });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('数据库被其他标签页占用'));
    });
    // 打开失败后允许下次重试
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
  });
}

// —— 公共 API（不在此捕获异常，由 main.ts 统一 try/catch + console.warn）——

// 写入/覆盖槽位（手动保存、自动保存共用）。data 自带 slot 字段作为主键。
export async function saveGame(slot: number, data: SaveData): Promise<void> {
  const db = await openDB();
  await req(db.transaction(STORE, 'readwrite').objectStore(STORE).put({ ...data }));
}

// 读取槽位；不存在返回 null。
export async function loadGame(slot: number): Promise<SaveData | null> {
  const db = await openDB();
  const v = await req(db.transaction(STORE, 'readonly').objectStore(STORE).get(slot));
  return (v as SaveData | undefined) ?? null;
}

export async function deleteGame(slot: number): Promise<void> {
  const db = await openDB();
  await req(db.transaction(STORE, 'readwrite').objectStore(STORE).delete(slot));
}

// 列举全部槽位（按 slot 排序），启动时刷新主菜单卡片。
export async function listGames(): Promise<SaveData[]> {
  const db = await openDB();
  const all = await req(db.transaction(STORE, 'readonly').objectStore(STORE).getAll());
  return (all as SaveData[]).sort((a, b) => a.slot - b.slot);
}

// 低版本存档原地升级（当前支持 v1 → v2 的库存迁移）。
// 版本只降不升：更高版本的存档视为未来格式，交由调用方拒绝载入。
export function upgradeSave(data: SaveData): SaveData {
  if (data.version >= SAVE_VERSION) return data;
  const inv = data.inventory;
  // v1 库存是 number[16]（按类型索引的数量）；v2 起为对象数组。
  const legacy = Array.isArray(inv) && inv.length > 0 && typeof (inv as unknown[])[0] === 'number';
  return {
    ...data,
    version: SAVE_VERSION,
    inventory: legacy ? migrateInventory(inv as unknown as number[]) : emptyInventory(),
  };
}
