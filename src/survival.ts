// 探索模式生存规则：工具等级、方块掉落（含保底概率）、矿石伤害、合成配方、熔炼/过滤。
// 纯客户端规则（联机存档/防刷同步留待后续）。所有概率规则严格按设定实现。

import { BlockType } from './core/constants';
import { InventorySlot, countOf } from './core/inventory';

// —— 工具等级 ——
// 0 徒手 / 1 石子 / 2 石镐。只认快捷栏「当前选中格」（手持才算工具）。
export function toolLevelOf(inv: InventorySlot[], selectedSlot: number): number {
  if (selectedSlot < 0 || selectedSlot >= 9) return 0;
  const t = inv[selectedSlot].type;
  if (t === BlockType.StonePickaxe) return 2;
  if (t === BlockType.StoneShard) return 1;
  return 0;
}

// 快捷栏「当前选中格」的工具物品（石镐 > 石子 > 木棍）。
// 用于判定特殊掉落（如手持木棍挖原木→火种）。必须「当前手持」才算，
// 快捷栏里放着但没选中不算——徒手挖原木应掉木块。
export function heldTool(inv: InventorySlot[], selectedSlot: number): BlockType | null {
  if (selectedSlot < 0 || selectedSlot >= 9) return null;
  return inv[selectedSlot].type ?? null;
}

// 方块需要的工具等级；null = 无需工具（徒手可挖）。
export function toolRequirement(block: BlockType): number | null {
  if (block === BlockType.CopperOre) return 1; // 铜矿：石子及以上
  return null;
}

export function canMine(block: BlockType, toolLevel: number): boolean {
  const need = toolRequirement(block);
  return need === null || toolLevel >= need;
}

// —— 掉落 ——
export interface DropEntry {
  type: BlockType;
  count: number;
}

// 正面概率的配置概率（掉落率）。
const DROP_CHANCE_BASE: Partial<Record<BlockType, number>> = {
  [BlockType.Grass]: 0.7, // 挖掘草 → 草纤维 70%
  [BlockType.Leaves]: 0.7, // 挖掘树叶 → 木棍 70%
  [BlockType.Wood]: 0.7, // 木棍挖原木 → 便捷火种 70%
};

// 保底概率缓存（每种方块独立）：失败 → 概率 + 配置概率*25%；成功 → 复位。
// 负面效果（矿石伤害）不保底，是绝对概率，见 rollMineDamage。
const pityChance = new Map<number, number>();

function rollChance(block: BlockType): boolean {
  const base = DROP_CHANCE_BASE[block] ?? 1;
  const cur = pityChance.get(block) ?? base;
  if (Math.random() < cur) {
    pityChance.set(block, base); // 成功 → 概率回到配置概率
    return true;
  }
  pityChance.set(block, cur + base * 0.25); // 失败 → 概率 += 配置概率*25%
  return false;
}

// 挖掘某方块得到的掉落。徒手/工具不同见各分支。
export function getDrops(block: BlockType, toolLevel: number, tool: BlockType | null = null): DropEntry[] {
  switch (block) {
    case BlockType.Grass:
      // 挖「草方块」→ 泥土 + 70% 草纤维（保底；草纤维是沙筛的原料，链不能断）
      return [
        { type: BlockType.Dirt, count: 1 },
        ...(rollChance(block) ? [{ type: BlockType.PlantFiber, count: 1 }] : []),
      ];
    case BlockType.Leaves:
      return rollChance(block) ? [{ type: BlockType.Stick, count: 1 }] : [];
    case BlockType.Wood:
      // 手持木棍挖原木 → 便捷火种 70%；否则（徒手/石子/石镐）→ 木块
      if (tool === BlockType.Stick) {
        return rollChance(block) ? [{ type: BlockType.Tinder, count: 1 }] : [];
      }
      return [{ type: BlockType.Wood, count: 1 }];
    case BlockType.Stone:
      // 徒手挖石块 → 石子×3；石子及以上挖石块 → 石块
      if (toolLevel === 0) return [{ type: BlockType.StoneShard, count: 3 }];
      return [{ type: BlockType.Stone, count: 1 }];
    case BlockType.CopperOre:
      if (toolLevel < 1) return [];
      return [{ type: BlockType.CopperOre, count: 1 }];
    default:
      return [{ type: block, count: 1 }];
  }
}

// —— 矿石挖掘伤害（负面效果：绝对概率 20%，-5 生命，不保底）——
// 挖掘石块/铜矿，20% 概率 -5 生命。石镐（2 级）无惩罚：高级工具更安全。
export function rollMineDamage(block: BlockType, toolLevel: number): boolean {
  if (block !== BlockType.Stone && block !== BlockType.CopperOre) return false;
  if (toolLevel >= 2) return false; // 石镐无惩罚
  return Math.random() < 0.2;
}

// —— 合成配方 ——
// 等级：0 背包 / 1 不完整的木制融合台 / 2 木制融合台。配方在［融合台 X 及以上］合成。
export interface Recipe {
  result: BlockType;
  resultCount: number;
  level: number;
  ingredients: { type: BlockType; count: number }[];
}

export const RECIPES: Recipe[] = [
  // 背包级（无需装置）
  { result: BlockType.Kiln, resultCount: 1, level: 0, ingredients: [{ type: BlockType.Dirt, count: 8 }] },
  { result: BlockType.SandSieve, resultCount: 1, level: 0, ingredients: [{ type: BlockType.Stick, count: 4 }, { type: BlockType.PlantFiber, count: 4 }] },
  { result: BlockType.GlassBottle, resultCount: 1, level: 0, ingredients: [{ type: BlockType.Glass, count: 1 }] },
  { result: BlockType.IncompleteCraftTable, resultCount: 1, level: 0, ingredients: [{ type: BlockType.Stick, count: 4 }, { type: BlockType.Wood, count: 4 }] },
  { result: BlockType.CraftTable, resultCount: 1, level: 0, ingredients: [{ type: BlockType.IncompleteCraftTable, count: 1 }, { type: BlockType.WaterBottle, count: 1 }] },
  // 不完整台级
  { result: BlockType.StonePickaxe, resultCount: 1, level: 1, ingredients: [{ type: BlockType.Stick, count: 2 }, { type: BlockType.Stone, count: 3 }] },
];

// 合成台等级：背包任意格有融合台即解锁对应等级（0 背包 / 1 不完整 / 2 完整）。
// 看整个库存而非仅快捷栏：玩家通常把融合台放地上/背包里，而不是特意拿手上。
export function craftLevelOf(inv: InventorySlot[]): number {
  let lv = 0;
  for (const s of inv) {
    if (s.type === BlockType.CraftTable) return 2;
    if (s.type === BlockType.IncompleteCraftTable) lv = Math.max(lv, 1);
  }
  return lv;
}

export function hasIngredients(inv: InventorySlot[], ings: { type: BlockType; count: number }[]): boolean {
  return ings.every((ig) => countOf(inv, ig.type) >= ig.count);
}

// 扣材料：跨格扣除，不足返回 false（不扣）。
export function consumeIngredients(inv: InventorySlot[], ings: { type: BlockType; count: number }[]): boolean {
  if (!hasIngredients(inv, ings)) return false;
  for (const ig of ings) {
    let need = ig.count;
    for (const s of inv) {
      if (need <= 0) break;
      if (s.type !== ig.type) continue;
      const take = Math.min(s.count, need);
      s.count -= take;
      need -= take;
      if (s.count === 0) s.type = null;
    }
  }
  return true;
}

// —— 装置配方 ——
// 土窑熔炼：石英砂 + 便捷火种（燃料）→ 玻璃
export const SMELT_INPUT = BlockType.QuartzSand;
export const SMELT_FUEL = BlockType.Tinder;
export const SMELT_OUTPUT = BlockType.Glass;
export const SMELT_INGREDIENTS: { type: BlockType; count: number }[] = [
  { type: SMELT_INPUT, count: 1 },
  { type: SMELT_FUEL, count: 1 },
];
// 沙筛过滤：沙子 → 石英砂
export const FILTER_INPUT = BlockType.Sand;
export const FILTER_OUTPUT = BlockType.QuartzSand;
export const FILTER_INGREDIENTS: { type: BlockType; count: number }[] = [
  { type: FILTER_INPUT, count: 1 },
];
