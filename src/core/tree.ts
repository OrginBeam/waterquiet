// 树木程序化生成：按群系密度确定性种树，树冠限制在单区块内（留边避免跨区块）。

import {
  BlockType,
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  WATER_LEVEL,
} from './constants';
import { getBiome, BiomeType } from './biome';
import { getHeight } from './terrain';
import { hash2D, hash3D } from './noise';

function treeDensity(biome: BiomeType): number {
  switch (biome) {
    case BiomeType.Forest: return 0.14;
    case BiomeType.Swamp: return 0.06;
    case BiomeType.Snowy: return 0.04;
    case BiomeType.Plains: return 0.025;
    case BiomeType.Mountains: return 0.008;
    case BiomeType.Desert: return 0;
  }
}

// 在已填充基础地形的区块数据上种树。
export function placeTrees(data: Uint8Array, cx: number, cz: number, seed: number): void {
  const originX = cx * CHUNK_SIZE_X;
  const originZ = cz * CHUNK_SIZE_Z;
  const idx = (lx: number, ly: number, lz: number) =>
    ly * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;

  // 留 3 格边，树冠半径 1~2 不会越界
  for (let lx = 3; lx <= CHUNK_SIZE_X - 4; lx++) {
    for (let lz = 3; lz <= CHUNK_SIZE_Z - 4; lz++) {
      const wx = originX + lx;
      const wz = originZ + lz;

      const density = treeDensity(getBiome(wx, wz, seed));
      if (density === 0 || hash2D(wx, wz, seed + 777) >= density) continue;

      const surface = getHeight(wx, wz, seed);
      if (surface <= WATER_LEVEL) continue;

      const trunkH = 4 + Math.floor(hash3D(wx, surface, wz, seed + 888) * 3); // 4-6
      const baseY = surface + 1;
      const crownY = baseY + trunkH - 2;

      // 树干
      for (let dy = 0; dy < trunkH - 1; dy++) {
        const y = baseY + dy;
        if (y >= CHUNK_SIZE_Y) break;
        data[idx(lx, y, lz)] = BlockType.Wood;
      }

      // 树冠第一层：3x3
      if (crownY < CHUNK_SIZE_Y) {
        for (let dx = -1; dx <= 1; dx++) {
          for (let dz = -1; dz <= 1; dz++) {
            data[idx(lx + dx, crownY, lz + dz)] = BlockType.Leaves;
          }
        }
      }
      // 树冠第二层：十字
      const crownTop = crownY + 1;
      if (crownTop < CHUNK_SIZE_Y) {
        data[idx(lx, crownTop, lz)] = BlockType.Leaves;
        data[idx(lx + 1, crownTop, lz)] = BlockType.Leaves;
        data[idx(lx - 1, crownTop, lz)] = BlockType.Leaves;
        data[idx(lx, crownTop, lz + 1)] = BlockType.Leaves;
        data[idx(lx, crownTop, lz - 1)] = BlockType.Leaves;
      }
      // 树冠顶部：中心
      const tip = crownY + 2;
      if (tip < CHUNK_SIZE_Y) {
        data[idx(lx, tip, lz)] = BlockType.Leaves;
      }
    }
  }
}
