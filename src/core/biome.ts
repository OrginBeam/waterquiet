// 生物群系：用温度/湿度/山脉三路噪声划分群系，驱动地形与地表方块。

import { fbm } from './noise';

export enum BiomeType {
  Plains,
  Forest,
  Desert,
  Mountains,
  Snowy,
  Swamp,
}

export function getBiome(x: number, z: number, seed: number): BiomeType {
  const temp = fbm(x * 0.0007, z * 0.0007, seed + 3000, 4);
  const hum = fbm(x * 0.0009, z * 0.0009, seed + 4000, 4);
  const mountain = fbm(x * 0.0018, z * 0.0018, seed + 5000, 4);

  if (mountain > 0.6) return BiomeType.Mountains;
  if (temp > 0.6 && hum < 0.42) return BiomeType.Desert;
  if (temp < 0.36) return BiomeType.Snowy;
  if (hum > 0.6) return BiomeType.Swamp;
  if (hum > 0.45) return BiomeType.Forest;
  return BiomeType.Plains;
}

// 草的配色随群系变化，让地表色彩丰富起来。
export function getGrassColor(x: number, z: number, seed: number): number {
  switch (getBiome(x, z, seed)) {
    case BiomeType.Forest: return 0x4e8a2a;
    case BiomeType.Swamp: return 0x4a5d3a;
    case BiomeType.Mountains: return 0x7a8f55;
    case BiomeType.Snowy: return 0x9ab87a;
    case BiomeType.Desert: return 0x9cae4a;
    case BiomeType.Plains: return 0x6db53e;
  }
}
