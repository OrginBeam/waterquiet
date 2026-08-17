// 世界与区块的基础常量

export const CHUNK_SIZE_X = 16;
export const CHUNK_SIZE_Y = 64;
export const CHUNK_SIZE_Z = 16;

// 海平面（世界坐标 Y，低于此高度的空洞会被水填满）
export const WATER_LEVEL = 20;

// 区块渲染半径（以玩家所在区块为中心）
export const RENDER_DISTANCE = 4;

// 方块类型。后续「水」系统会继续扩展。
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
};
