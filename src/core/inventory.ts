// 背包数据模型：45 格物品（0-8 快捷栏 / 9-44 背包区）+ 物品增删工具函数。
// 与存档格式绑定：SaveData.inventory 即 InventorySlot[]，旧版 number[] 格式在 save.ts 迁移。

import { BlockType } from './constants';

// 单个物品格。type 为 null 表示空；堆叠无上限（暂不引入 64 上限）。
export interface InventorySlot {
  type: BlockType | null;
  count: number;
}

export const HOTBAR_SLOTS = 9;
export const BACKPACK_SLOTS = 36;
export const INVENTORY_SIZE = HOTBAR_SLOTS + BACKPACK_SLOTS; // 45

// 新建空背包
export function emptyInventory(): InventorySlot[] {
  return Array.from({ length: INVENTORY_SIZE }, () => ({ type: null, count: 0 }));
}

// 尝试放入物品：优先合并已有同类型，其次填空位（从索引 0 起，即挖掘所得先进快捷栏）。
// 返回未能放入的数量（当前无限堆叠不会发生，预留接口供未来堆叠上限使用）。
export function addItem(inv: InventorySlot[], type: BlockType, count: number): number {
  if (count <= 0 || type === BlockType.Air || type === BlockType.Water) return count;
  for (const s of inv) {
    if (s.type === type) {
      s.count += count;
      return 0;
    }
  }
  for (const s of inv) {
    if (s.type === null) {
      s.type = type;
      s.count = count;
      return 0;
    }
  }
  return count;
}

// 从指定格扣除数量，不足返回 false（不扣）。
export function consumeFrom(inv: InventorySlot[], index: number, count: number): boolean {
  const s = inv[index];
  if (!s || s.type === null || s.count < count) return false;
  s.count -= count;
  if (s.count === 0) s.type = null;
  return true;
}

// 某类型的总库存数
export function countOf(inv: InventorySlot[], type: BlockType): number {
  let n = 0;
  for (const s of inv) if (s.type === type) n += s.count;
  return n;
}

// 迁移旧存档：number[16]（按 BlockType 索引的数量）→ InventorySlot[]。
// 旧格式每类只占一个计数，转入新格子后同类合并在首格。
export function migrateInventory(old: number[] | undefined): InventorySlot[] {
  const inv = emptyInventory();
  if (old) {
    for (let t = 1; t < old.length; t++) {
      if (old[t] > 0) addItem(inv, t as BlockType, old[t]);
    }
  }
  return inv;
}
