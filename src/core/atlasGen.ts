// 方块纹理图集生成：每个瓦片 32×32，共 16 个（4×4 图集 128×128）。
// 优先使用用户放在 textures/ 下的同名 PNG（有图用图），缺失的瓦片用程序化噪声生成（无图噪声）。
// 噪声为「周期 value noise」——采样坐标对瓦片尺寸取模，保证左右/上下无缝平铺。

import * as THREE from 'three';
import { BlockType, BLOCK_COLORS } from './constants';
import { hash2D } from './noise';

export const ATLAS_TILE = 32; // 瓦片边长（像素）
export const ATLAS_COLS = 4; // 图集 4×4
const TILE_COUNT = ATLAS_COLS * ATLAS_COLS; // 16

// 每个瓦片对应的纹理文件名。放同名 PNG 到 textures/ 即可覆盖噪声。
export const TILE_FILE_NAMES: string[] = [
  'grass_top.png', // 0 草方块顶
  'grass_side.png', // 1 草方块侧
  'dirt.png', // 2 泥土（草方块底复用）
  'stone.png', // 3 石头
  'sand.png', // 4 沙子
  'wood_side.png', // 5 原木侧
  'wood_top.png', // 6 原木顶
  'leaves.png', // 7 树叶
  'snow.png', // 8 雪块
  'ice.png', // 9 冰
  'gravel.png', // 10 砂砾
  'clay.png', // 11 粘土
  'redsand.png', // 12 红沙
  'granite.png', // 13 花岗岩
  'diorite.png', // 14 闪长岩
  'andesite.png', // 15 安山岩
];

const PI2 = Math.PI * 2;

// 平滑插值
function smooth(t: number): number {
  return t * t * (3 - 2 * t);
}

// 周期 value noise：采样坐标对 period 取模，f(0) === f(period)，可无缝平铺。
function periodicNoise(x: number, z: number, seed: number, period: number): number {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const sx = smooth(fx);
  const sz = smooth(fz);

  const at = (i: number): number => ((i % period) + period) % period;
  const a = hash2D(at(ix), at(iz), seed);
  const b = hash2D(at(ix + 1), at(iz), seed);
  const c = hash2D(at(ix), at(iz + 1), seed);
  const d = hash2D(at(ix + 1), at(iz + 1), seed);

  return a + (b - a) * sx + (c - a) * sz + (a - b - c + d) * sx * sz;
}

// 分形叠加周期噪声。coords 为 [0,1]，period 为循环周期（瓦片内单位），octaves 各倍频也需是周期整数倍。
function periodicFbm(x: number, z: number, seed: number, octaves: number, period: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += periodicNoise(x * period * Math.pow(2, i), z * period * Math.pow(2, i), seed + i * 101, period * Math.pow(2, i)) * amp;
    norm += amp;
    amp *= 0.5;
  }
  return sum / norm;
}

// 低频块状颗粒：每 BLOCK×BLOCK 像素一块取哈希。块边界与方块边缘对齐（4 整除 32），
// 天然无跨方块接缝；远景随 mipmap 平滑，不产生 1px 白噪导致的摩尔纹。
function blockGrain(x: number, y: number, seed: number, block = 4): number {
  return hash2D(Math.floor(x / block), Math.floor(y / block), seed);
}

// 用周期噪声做基础明暗，配合低频块状颗粒，输出 [0,1]。
function noiseTile(x: number, z: number, seed: number, octaves = 2, period = 2): number {
  const base = periodicFbm(x, z, seed, octaves, period);
  const grain = blockGrain(x * ATLAS_TILE, z * ATLAS_TILE, seed + 7777);
  return 0.88 * base + 0.12 * grain;
}

// —— 各瓦片生成：返回 32×32 RGBA 像素（0..255），占位色由 baseColor 决定 ——

function baseRGB(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// 通用：单色 + 周期噪声明暗 + 高频颗粒。返回 32×32 像素数组。
function noisePixels(hex: number, seed: number, contrast = 0.18, baseJitter = 0): [number, number, number][] {
  const [r, g, b] = baseRGB(hex);
  const out: [number, number, number][] = [];
  for (let y = 0; y < ATLAS_TILE; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      const u = x / ATLAS_TILE;
      const v = y / ATLAS_TILE;
      const n = noiseTile(u, v, seed);
      const k = 1 - contrast + n * 2 * contrast;
      out.push([
        Math.max(0, Math.min(255, r * k)),
        Math.max(0, Math.min(255, g * k)),
        Math.max(0, Math.min(255, b * k + baseJitter)),
      ]);
    }
  }
  return out;
}

// 原木侧：竖向条纹（树皮）。用「x 方向变化快、y 方向慢」的噪声。
function woodSidePixels(): [number, number, number][] {
  const [r, g, b] = baseRGB(BLOCK_COLORS[BlockType.Wood]);
  const out: [number, number, number][] = [];
  for (let y = 0; y < ATLAS_TILE; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      const u = x / ATLAS_TILE;
      const v = y / ATLAS_TILE;
      // x 方向高频（条纹）、y 方向低频（顺滑）
      const stripe = periodicNoise(u * 4, v * 0.8, 100, 4);
      const grain = blockGrain(x, y, 200);
      const k = 0.8 + stripe * 0.4 + grain * 0.1;
      out.push([Math.max(0, Math.min(255, r * k)), Math.max(0, Math.min(255, g * k)), Math.max(0, Math.min(255, b * k))]);
    }
  }
  return out;
}

// 原木顶：同心年轮。
function woodTopPixels(): [number, number, number][] {
  const [r, g, b] = baseRGB(BLOCK_COLORS[BlockType.Wood]);
  const out: [number, number, number][] = [];
  const cx = ATLAS_TILE / 2;
  for (let y = 0; y < ATLAS_TILE; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      const dx = x + 0.5 - cx;
      const dy = y + 0.5 - cx;
      const dist = Math.sqrt(dx * dx + dy * dy);
      // 年轮 = 距离的周期函数 + 扰动
      const ring = Math.sin(dist * PI2 / 4.0 + periodicNoise(x * 0.2, y * 0.2, 300, 8) * 1.5);
      const k = 0.72 + ring * 0.22 + blockGrain(x, y, 400) * 0.1;
      out.push([Math.max(0, Math.min(255, r * k)), Math.max(0, Math.min(255, g * k)), Math.max(0, Math.min(255, b * k))]);
    }
  }
  return out;
}

// 草方块侧：上部草皮、下部泥土，交界参差过渡。
function grassSidePixels(): [number, number, number][] {
  const [gr, gg, gb] = baseRGB(BLOCK_COLORS[BlockType.Grass]);
  const [dr, dg, db] = baseRGB(BLOCK_COLORS[BlockType.Dirt]);
  const out: [number, number, number][] = [];
  for (let y = 0; y < ATLAS_TILE; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      const u = x / ATLAS_TILE;
      const v = y / ATLAS_TILE;
      // 草皮厚度约 40%，交界用噪声起伏
      const border = 0.38 + (periodicNoise(x * 0.3, y * 0.3, 500, 8) - 0.5) * 0.16;
      const t = smooth(Math.max(0, Math.min(1, (border - v) * 6)));
      const grain = blockGrain(x, y, 600);
      const k = 0.92 + grain * 0.16;
      out.push([
        Math.max(0, Math.min(255, lerp(dr, gr, t) * k)),
        Math.max(0, Math.min(255, lerp(dg, gg, t) * k)),
        Math.max(0, Math.min(255, lerp(db, gb, t) * k)),
      ]);
    }
  }
  return out;
}

// 树叶：绿色底 + 高密度亮暗点。
function leavesPixels(): [number, number, number][] {
  const [r, g, b] = baseRGB(BLOCK_COLORS[BlockType.Leaves]);
  const out: [number, number, number][] = [];
  for (let y = 0; y < ATLAS_TILE; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      // 树叶颗粒稍密：2×2 块
      const n = blockGrain(x, y, 700, 2);
      const k = n < 0.5 ? 0.82 + n * 0.18 : 1.0 + n * 0.16;
      out.push([Math.max(0, Math.min(255, r * k)), Math.max(0, Math.min(255, g * k)), Math.max(0, Math.min(255, b * k))]);
    }
  }
  return out;
}

// 冰：浅蓝底 + 亮斑（高光）。
function icePixels(): [number, number, number][] {
  const [r, g, b] = baseRGB(BLOCK_COLORS[BlockType.Ice]);
  const out: [number, number, number][] = [];
  for (let y = 0; y < ATLAS_TILE; y++) {
    for (let x = 0; x < ATLAS_TILE; x++) {
      const u = x / ATLAS_TILE;
      const v = y / ATLAS_TILE;
      const n = noiseTile(u, v, 800, 2, 2);
      const k = 0.9 + n * 0.2;
      out.push([Math.max(0, Math.min(255, r * k)), Math.max(0, Math.min(255, g * k)), Math.max(0, Math.min(255, b * k))]);
    }
  }
  return out;
}

// 各瓦片的生成函数（索引对应 TILE_FILE_NAMES）
type TileGen = () => [number, number, number][];
const TILE_GENS: TileGen[] = [
  () => noisePixels(BLOCK_COLORS[BlockType.Grass], 1, 0.2), // 0 草顶
  grassSidePixels, // 1 草侧
  () => noisePixels(BLOCK_COLORS[BlockType.Dirt], 11, 0.22), // 2 泥土
  () => noisePixels(BLOCK_COLORS[BlockType.Stone], 21, 0.2), // 3 石头
  () => noisePixels(BLOCK_COLORS[BlockType.Sand], 31, 0.16), // 4 沙子
  woodSidePixels, // 5 原木侧
  woodTopPixels, // 6 原木顶
  leavesPixels, // 7 树叶
  () => noisePixels(BLOCK_COLORS[BlockType.Snow], 51, 0.1), // 8 雪
  icePixels, // 9 冰
  () => noisePixels(BLOCK_COLORS[BlockType.Gravel], 71, 0.24), // 10 砂砾
  () => noisePixels(BLOCK_COLORS[BlockType.Clay], 81, 0.16), // 11 粘土
  () => noisePixels(BLOCK_COLORS[BlockType.RedSand], 91, 0.18), // 12 红沙
  () => noisePixels(BLOCK_COLORS[BlockType.Granite], 101, 0.2), // 13 花岗岩
  () => noisePixels(BLOCK_COLORS[BlockType.Diorite], 111, 0.16), // 14 闪长岩
  () => noisePixels(BLOCK_COLORS[BlockType.Andesite], 121, 0.2), // 15 安山岩
];

// 把像素数组画进图集 canvas 的对应瓦片格。
function drawTile(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D, idx: number, pixels: [number, number, number][]): void {
  const col = idx % ATLAS_COLS;
  const row = Math.floor(idx / ATLAS_COLS);
  const image = ctx.createImageData(ATLAS_TILE, ATLAS_TILE);
  for (let i = 0; i < pixels.length; i++) {
    image.data[i * 4] = pixels[i][0];
    image.data[i * 4 + 1] = pixels[i][1];
    image.data[i * 4 + 2] = pixels[i][2];
    image.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(image, col * ATLAS_TILE, row * ATLAS_TILE);
}

// 生成完整图集（128×128）：先噪声填满，再尝试加载用户 PNG 覆盖。
export function createAtlasTexture(): THREE.CanvasTexture {
  const size = ATLAS_COLS * ATLAS_TILE;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  // 开 mipmap + 最近邻下采样：远景取逐级缩小的纹理，消除移动时的高频闪烁，
  // 同时保持像素颗粒感（不模糊）。
  tex.minFilter = THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = true;
  tex.colorSpace = THREE.SRGBColorSpace;

  // 1) 噪声打底（全部瓦片）
  for (let i = 0; i < TILE_COUNT; i++) {
    drawTile(canvas, ctx, i, TILE_GENS[i]());
  }

  // 2) 用户 PNG 覆盖（有图用图，无图保持噪声）。加载完成需 needsUpdate 重新上传。
  for (let i = 0; i < TILE_COUNT; i++) {
    const img = new Image();
    img.onload = () => {
      const col = i % ATLAS_COLS;
      const row = Math.floor(i / ATLAS_COLS);
      ctx.drawImage(img, col * ATLAS_TILE, row * ATLAS_TILE, ATLAS_TILE, ATLAS_TILE);
      tex.needsUpdate = true;
    };
    img.onerror = () => {}; // 未提供该纹理 → 保留噪声
    img.src = `textures/${TILE_FILE_NAMES[i]}`;
  }

  return tex;
}
