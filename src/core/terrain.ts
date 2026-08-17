// 程序化地形生成：基于 seed 的高度图 + 生物群系 + 大陆/海洋划分，纯函数、确定性。
// 世界未修改区块由这里即时重建，不存盘。
// 性能：按「列」计算（每列高度/群系只算一次），并缓存，避免网格构建时重复算噪声。

import { BlockType, WATER_LEVEL } from './constants';
import { fbm, hash3D } from './noise';
import { getBiome, BiomeType } from './biome';

// 大陆度阈值：低于此为海洋，之上为陆地
const OCEAN_LEVEL = 0.42;

export interface Column {
  height: number;
  biome: BiomeType;
  continentality: number;
}

// 大陆度：低 = 海洋，高 = 内陆。低频噪声，形成大片大陆与海域。
export function getContinentality(x: number, z: number, seed: number): number {
  return fbm(x * 0.0008, z * 0.0008, seed + 6000, 4);
}

// 返回指定世界坐标 (x, z) 的地表高度。
export function getHeight(
  x: number,
  z: number,
  seed: number,
  opts?: { biome?: BiomeType; continentality?: number },
): number {
  const biome = opts?.biome ?? getBiome(x, z, seed);
  const cont = opts?.continentality ?? getContinentality(x, z, seed);

  // 海洋：大片水域，深度随大陆度递减（浅海 → 深海）
  if (cont < OCEAN_LEVEL) {
    const depth = 1 - cont / OCEAN_LEVEL;
    return Math.floor(WATER_LEVEL - 2 - depth * 12);
  }

  // 陆地：越深入内陆越高
  const landFactor = (cont - OCEAN_LEVEL) / (1 - OCEAN_LEVEL);
  const mountains = fbm(x * 0.003, z * 0.003, seed + 1000, 4);
  const detail = fbm(x * 0.015, z * 0.015, seed + 2000, 3);

  const base = WATER_LEVEL + 2 + landFactor * 8 + detail * 4;

  switch (biome) {
    case BiomeType.Mountains: {
      const m = mountains * mountains * mountains;
      return Math.floor(base + m * 55);
    }
    case BiomeType.Desert:
      return Math.floor(WATER_LEVEL + 2 + detail * 3 + mountains * 5);
    case BiomeType.Snowy:
      return Math.floor(WATER_LEVEL + 8 + landFactor * 10 + mountains * 10 + detail * 3);
    case BiomeType.Swamp:
      return Math.floor(WATER_LEVEL - 1 + detail * 2);
    case BiomeType.Forest:
    case BiomeType.Plains:
    default:
      return Math.floor(base + mountains * 14 + detail * 5);
  }
}

// 列缓存：避免网格构建的边界邻居查询重复计算噪声
const columnCache = new Map<string, Column>();
const COLUMN_CACHE_MAX = 50000;

export function getColumn(x: number, z: number, seed: number): Column {
  const key = `${x},${z},${seed}`;
  const cached = columnCache.get(key);
  if (cached) return cached;

  const continentality = getContinentality(x, z, seed);
  const biome = getBiome(x, z, seed);
  const col: Column = {
    height: getHeight(x, z, seed, { biome, continentality }),
    biome,
    continentality,
  };

  if (columnCache.size >= COLUMN_CACHE_MAX) columnCache.clear();
  columnCache.set(key, col);
  return col;
}

// 基于列信息填充单个方块（复用列的高度/群系，避免重复算噪声）。
export function blockAtColumn(
  col: Column,
  x: number,
  y: number,
  z: number,
  seed: number,
): BlockType {
  const h = col.height;
  const biome = col.biome;
  const cont = col.continentality;
  const ocean = cont < OCEAN_LEVEL;

  if (y > h) {
    if (y <= WATER_LEVEL) {
      return biome === BiomeType.Snowy ? BlockType.Ice : BlockType.Water;
    }
    return BlockType.Air;
  }

  if (y === h) {
    if (ocean) {
      // 海床：深海砂砾，浅海沙
      return h <= WATER_LEVEL - 6 ? BlockType.Gravel : BlockType.Sand;
    }
    // 海滩：近海窄带 / 低洼临水
    if (cont < OCEAN_LEVEL + 0.04 || h <= WATER_LEVEL + 1) {
      return biome === BiomeType.Desert ? pickRedSand(x, z, seed) : BlockType.Sand;
    }
    switch (biome) {
      case BiomeType.Desert: return pickRedSand(x, z, seed);
      case BiomeType.Snowy: return BlockType.Snow;
      case BiomeType.Mountains: return BlockType.Stone;
      default: return BlockType.Grass;
    }
  }

  // 地下
  if (ocean) {
    if (y >= h - 3) return h <= WATER_LEVEL - 6 ? BlockType.Gravel : BlockType.Sand;
    return BlockType.Stone;
  }
  if (biome === BiomeType.Desert) {
    return BlockType.Sand;
  }
  if (y >= h - 4) {
    if (biome === BiomeType.Swamp && y <= WATER_LEVEL) return BlockType.Clay;
    return hash3D(x, y, z, seed + 500) < 0.06 ? BlockType.Gravel : BlockType.Dirt;
  }
  return pickStone(x, y, z, seed);
}

export function getBlock(x: number, y: number, z: number, seed: number): BlockType {
  return blockAtColumn(getColumn(x, z, seed), x, y, z, seed);
}

// 找出生点：从原点螺旋搜索最近的陆地（地表高于海平面），避免出生在海里。
export function findSpawn(seed: number): { x: number; z: number; height: number } {
  for (let r = 0; r < 256; r++) {
    for (let dx = -r; dx <= r; dx++) {
      for (let dz = -r; dz <= r; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        const h = getHeight(dx, dz, seed);
        if (h > WATER_LEVEL + 1) {
          return { x: dx + 0.5, z: dz + 0.5, height: h };
        }
      }
    }
  }
  return { x: 0.5, z: 0.5, height: getHeight(0, 0, seed) };
}

function pickStone(x: number, y: number, z: number, seed: number): BlockType {
  const r = hash3D(x, y, z, seed + 900);
  if (r < 0.03) return BlockType.Granite;
  if (r < 0.06) return BlockType.Diorite;
  if (r < 0.09) return BlockType.Andesite;
  return BlockType.Stone;
}

function pickRedSand(x: number, z: number, seed: number): BlockType {
  return hash3D(x, 0, z, seed + 1200) < 0.35 ? BlockType.RedSand : BlockType.Sand;
}
