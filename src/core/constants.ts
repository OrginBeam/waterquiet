// 世界与区块的基础常量

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Y = 64;
export const CHUNK_SIZE_Z = 16;

// 海平面（世界坐标 Y，低于此高度的空洞会被水填满）
export const WATER_LEVEL = 20;

// 区块渲染半径（以玩家所在区块为中心）
export const RENDER_DISTANCE = 4;

// 方块/物品类型。前 16 个是方块（旧值保持不动，保证存档字节兼容），
// 末尾追加的物品是工具/合成材料（不可放置），以及新方块。
export enum BlockType {
  Air = 0,
  Grass = 1,
  Dirt = 2,
  Stone = 3,
  Water = 4,
  Sand = 5,
  Wood = 6,
  Leaves = 7,
  Snow = 8,
  Ice = 9,
  Gravel = 10,
  Clay = 11,
  RedSand = 12,
  Granite = 13,
  Diorite = 14,
  Andesite = 15,
  // —— 物品 / 工具 ——
  Stick = 16, // 木棍
  PlantFiber = 17, // 草纤维
  Tinder = 18, // 便捷火种
  StoneShard = 19, // 石子（工具，1 级）
  StonePickaxe = 20, // 石镐（工具，2 级）
  QuartzSand = 21, // 石英砂
  GlassBottle = 22, // 玻璃瓶
  WaterBottle = 23, // 盛水的玻璃瓶
  // —— 新方块 ——
  Glass = 24, // 玻璃
  CopperOre = 25, // 铜矿
  Kiln = 26, // 土窑（熔炉装置）
  SandSieve = 27, // 沙筛（过滤装置）
  IncompleteCraftTable = 28, // 不完整的木制融合台
  CraftTable = 29, // 木制融合台
}

// 物品（不可放置、不可挖掘的合成材料/工具）。新方块不在此列。
export const ITEM_TYPES: number[] = [
  BlockType.Stick,
  BlockType.PlantFiber,
  BlockType.Tinder,
  BlockType.StoneShard,
  BlockType.StonePickaxe,
  BlockType.QuartzSand,
  BlockType.GlassBottle,
  BlockType.WaterBottle,
];

// 是否是可放置的方块（物品不能放置；水不由玩家手动放置）
export function isBlockType(t: BlockType): boolean {
  return t !== BlockType.Air && t !== BlockType.Water && !ITEM_TYPES.includes(t);
}

// 每种方块的基础颜色（十六进制 RGB）。Grass 会在网格构建时被群系配色覆盖。
export const BLOCK_COLORS: Record<number, number> = {
  [BlockType.Grass]: 0x6db53e,
  [BlockType.Dirt]: 0x8a5a2b,
  [BlockType.Stone]: 0x8c8c8c,
  [BlockType.Water]: 0x3a6ea5,
  [BlockType.Sand]: 0xd9c58a,
  [BlockType.Wood]: 0x6b4a2b,
  [BlockType.Leaves]: 0x4e8a2a,
  [BlockType.Snow]: 0xf2f5f7,
  [BlockType.Ice]: 0x9cc8e8,
  [BlockType.Gravel]: 0x8a8a86,
  [BlockType.Clay]: 0x9aa0a8,
  [BlockType.RedSand]: 0xc77b3f,
  [BlockType.Granite]: 0x9a6a5a,
  [BlockType.Diorite]: 0xc0c0c0,
  [BlockType.Andesite]: 0x9c9c98,
  // —— 物品 / 新方块 ——
  [BlockType.Stick]: 0x9a6b3f,
  [BlockType.PlantFiber]: 0x4f9a3a,
  [BlockType.Tinder]: 0xc98a3d,
  [BlockType.StoneShard]: 0xa8a8a0,
  [BlockType.StonePickaxe]: 0x8a8a84,
  [BlockType.QuartzSand]: 0xe8e0d0,
  [BlockType.GlassBottle]: 0xbfe8e8,
  [BlockType.WaterBottle]: 0x6fb8d8,
  [BlockType.Glass]: 0xcfeef0,
  [BlockType.CopperOre]: 0x5b8c6b,
  [BlockType.Kiln]: 0x8a5a3b,
  [BlockType.SandSieve]: 0xb8a272,
  [BlockType.IncompleteCraftTable]: 0x9a7a4a,
  [BlockType.CraftTable]: 0xc08a4a,
};

// 用于 HUD / 物品栏展示的可读名称
export const BLOCK_NAMES: Record<number, string> = {
  [BlockType.Air]: '空气',
  [BlockType.Grass]: '草方块',
  [BlockType.Dirt]: '泥土',
  [BlockType.Stone]: '石头',
  [BlockType.Water]: '水',
  [BlockType.Sand]: '沙子',
  [BlockType.Wood]: '原木',
  [BlockType.Leaves]: '树叶',
  [BlockType.Snow]: '雪块',
  [BlockType.Ice]: '冰',
  [BlockType.Gravel]: '砂砾',
  [BlockType.Clay]: '粘土',
  [BlockType.RedSand]: '红沙',
  [BlockType.Granite]: '花岗岩',
  [BlockType.Diorite]: '闪长岩',
  [BlockType.Andesite]: '安山岩',
  [BlockType.Stick]: '木棍',
  [BlockType.PlantFiber]: '草纤维',
  [BlockType.Tinder]: '便捷火种',
  [BlockType.StoneShard]: '石子',
  [BlockType.StonePickaxe]: '石镐',
  [BlockType.QuartzSand]: '石英砂',
  [BlockType.GlassBottle]: '玻璃瓶',
  [BlockType.WaterBottle]: '盛水的玻璃瓶',
  [BlockType.Glass]: '玻璃',
  [BlockType.CopperOre]: '铜矿',
  [BlockType.Kiln]: '土窑',
  [BlockType.SandSieve]: '沙筛',
  [BlockType.IncompleteCraftTable]: '不完整的木制融合台',
  [BlockType.CraftTable]: '木制融合台',
};

// 挖掘硬度（秒）：按住挖掘需要持续的时间。空气/水不可挖（不会被射线命中）。
// 2026-08：全部 ×1.5 调慢（探索节奏更慢，工具价值更突出）。
export const BLOCK_HARDNESS: Record<number, number> = {
  [BlockType.Air]: 0.001,
  [BlockType.Grass]: 0.9,
  [BlockType.Dirt]: 0.8,
  [BlockType.Stone]: 3.0,
  [BlockType.Water]: 0.001,
  [BlockType.Sand]: 0.8,
  [BlockType.Wood]: 1.8,
  [BlockType.Leaves]: 0.5,
  [BlockType.Snow]: 0.5,
  [BlockType.Ice]: 1.4,
  [BlockType.Gravel]: 0.9,
  [BlockType.Clay]: 0.9,
  [BlockType.RedSand]: 0.8,
  [BlockType.Granite]: 4.0,
  [BlockType.Diorite]: 3.6,
  [BlockType.Andesite]: 3.3,
  [BlockType.Glass]: 0.6,
  [BlockType.CopperOre]: 4.5,
  [BlockType.Kiln]: 1.5,
  [BlockType.SandSieve]: 1.4,
  [BlockType.IncompleteCraftTable]: 1.4,
  [BlockType.CraftTable]: 1.7,
};

// 装置方块：可交互（右键打开面板）。
export const DEVICE_BLOCKS: number[] = [
  BlockType.Kiln,
  BlockType.SandSieve,
  BlockType.CraftTable,
  BlockType.IncompleteCraftTable,
];

export function isDeviceBlock(t: BlockType): boolean {
  return DEVICE_BLOCKS.includes(t);
}
