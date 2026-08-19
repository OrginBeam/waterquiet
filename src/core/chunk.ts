// 区块网格构建：隐藏面剔除 + 单区块单 Mesh 合并 + 手绘面明暗 + 颜色抖动 + 纹理图集。
// 顶点色 = 贴图色 × 顶点色（MeshBasicMaterial 相乘）：非草方块顶点色为白（贴图提供颜色），
// 草方块保留群系染色；面明暗/颜色抖动仍走顶点色。
// 水拆成独立几何体，配合世界侧半透明材质实现水体透明。
// 阶段①不引入贪婪网格（留作后续优化项）。

import * as THREE from 'three';
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, BlockType, BLOCK_COLORS } from './constants';
import { getGrassColor } from './biome';
import { hash3D } from './noise';
import { ATLAS_TILE, ATLAS_COLS, ATLAS_ROWS, createAtlasTexture } from './atlasGen';

// world.ts 等从本模块取 createAtlasTexture，保持既有 import 路径不变
export { createAtlasTexture } from './atlasGen';

interface Face {
  dir: [number, number, number];
  corners: [number, number, number][];
  brightness: number;
}

// 六个面（局部坐标 0..1），顶点按逆时针顺序保证面朝外，brightness 为手绘明暗系数。
const FACES: Face[] = [
  { dir: [0, 1, 0], corners: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], brightness: 1.0 }, // 顶
  { dir: [0, -1, 0], corners: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], brightness: 0.5 }, // 底
  { dir: [1, 0, 0], corners: [[1, 0, 1], [1, 1, 1], [1, 1, 0], [1, 0, 0]], brightness: 0.8 }, // +X
  { dir: [-1, 0, 0], corners: [[0, 0, 0], [0, 1, 0], [0, 1, 1], [0, 0, 1]], brightness: 0.8 }, // -X
  { dir: [0, 0, 1], corners: [[0, 0, 1], [0, 1, 1], [1, 1, 1], [1, 0, 1]], brightness: 0.6 }, // +Z
  { dir: [0, 0, -1], corners: [[1, 0, 0], [1, 1, 0], [0, 1, 0], [0, 0, 0]], brightness: 0.6 }, // -Z
];

// —— 纹理图集 ——
// 图集 256×128（8×4 瓦片，每片 32×32），布局见 atlasGen.ts。瓦片索引 = row*8+col：
// 0 草顶 / 1 草侧 / 2 泥土(草底复用) / 3 石头 / 4 沙子 / 5 原木侧 / 6 原木顶 / 7 树叶 /
// 8 雪 / 9 冰 / 10 砂砾 / 11 粘土 / 12 红沙 / 13 花岗岩 / 14 闪长岩 / 15 安山岩 /
// 16 玻璃 / 17 铜矿 / 18 土窑 / 19 沙筛 / 20 木制融合台 / 21 不完整的木制融合台

// 方块 → 默认瓦片（单面体；草/原木为多面体特殊处理）
const TILE_BY_BLOCK: Record<number, number> = {
  [BlockType.Dirt]: 2,
  [BlockType.Stone]: 3,
  [BlockType.Sand]: 4,
  [BlockType.Leaves]: 7,
  [BlockType.Snow]: 8,
  [BlockType.Ice]: 9,
  [BlockType.Gravel]: 10,
  [BlockType.Clay]: 11,
  [BlockType.RedSand]: 12,
  [BlockType.Granite]: 13,
  [BlockType.Diorite]: 14,
  [BlockType.Andesite]: 15,
  [BlockType.Glass]: 16,
  [BlockType.CopperOre]: 17,
  [BlockType.Kiln]: 18,
  [BlockType.SandSieve]: 19,
  [BlockType.CraftTable]: 20,
  [BlockType.IncompleteCraftTable]: 21,
};

// 每个面取哪张瓦片。faceIndex 对应 FACES 顺序：0顶 1底 2+X 3-X 4+Z 5-Z。
function tileIndexFor(block: BlockType, faceIndex: number): number {
  if (block === BlockType.Grass) return faceIndex === 0 ? 0 : faceIndex === 1 ? 2 : 1;
  if (block === BlockType.Wood) return faceIndex === 0 || faceIndex === 1 ? 6 : 5;
  return TILE_BY_BLOCK[block] ?? 0;
}

// 每个面 corner 坐标到瓦片内 UV(0..1) 的轴映射。
// v 轴：侧面用 y，且方块顶(y=1)对应贴图顶（草皮在上）→ 统一翻转；顶/底面用 z 不翻转。
// u 轴：-X/-Z 翻转防止背面纹理镜像（纹理始终朝外）。
const UV_MAP: { u: number; v: number; flipU: boolean; flipV: boolean }[] = [
  { u: 0, v: 2, flipU: false, flipV: false }, // 顶：u=x, v=z
  { u: 0, v: 2, flipU: false, flipV: true }, // 底
  { u: 2, v: 1, flipU: false, flipV: true }, // +X：u=z, v=y
  { u: 2, v: 1, flipU: true, flipV: true }, // -X：u 翻转防镜像
  { u: 0, v: 1, flipU: false, flipV: true }, // +Z：u=x, v=y
  { u: 0, v: 1, flipU: true, flipV: true }, // -Z
];

export interface ChunkGeometry {
  solid: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
}

function makeGeometry(
  positions: number[],
  colors: number[],
  indices: number[],
  uvs: number[] | null,
  normals: number[],
): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  if (uvs) geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  return geometry;
}

// 构建某个区块的合并几何体。getBlock(wx, wy, wz) 返回世界坐标方块类型。
// 空区块的对应几何返回 null。
export function buildChunkGeometry(
  cx: number,
  cz: number,
  getBlock: (wx: number, wy: number, wz: number) => BlockType,
  seed: number,
): ChunkGeometry {
  const solidPos: number[] = [];
  const solidColors: number[] = [];
  const solidIndices: number[] = [];
  const solidUvs: number[] = [];
  const solidNormals: number[] = [];
  const waterPos: number[] = [];
  const waterColors: number[] = [];
  const waterIndices: number[] = [];
  const waterNormals: number[] = [];
  let solidVertexCount = 0;
  let waterVertexCount = 0;

  const originX = cx * CHUNK_SIZE_X;
  const originZ = cz * CHUNK_SIZE_Z;

  for (let ly = 0; ly < CHUNK_SIZE_Y; ly++) {
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const wx = originX + lx;
        const wz = originZ + lz;
        const type = getBlock(wx, ly, wz);
        if (type === BlockType.Air) continue;
        const isWater = type === BlockType.Water;

        // 顶点色：贴图提供方块主色，实体方块为白×抖动（颜色由贴图给）；
        // 水无贴图，需保留其基础色；草仅顶面染群系色（见面循环内），侧面/底面由贴图自带草皮与泥土色。
        const jitter = isWater ? 1 : 0.94 + hash3D(wx, ly, wz, seed + 1234) * 0.12;
        let cr = 1;
        let cg = 1;
        let cb = 1;
        if (isWater) {
          cr = ((BLOCK_COLORS[BlockType.Water] >> 16) & 255) / 255;
          cg = ((BLOCK_COLORS[BlockType.Water] >> 8) & 255) / 255;
          cb = (BLOCK_COLORS[BlockType.Water] & 255) / 255;
        }
        const r = cr * jitter;
        const g = cg * jitter;
        const b = cb * jitter;

        for (let fi = 0; fi < FACES.length; fi++) {
          const face = FACES[fi];
          const nx = lx + face.dir[0];
          const ny = ly + face.dir[1];
          const nz = lz + face.dir[2];
          const neighbor = getBlock(originX + nx, ny, originZ + nz);

          // 面是否可见：水块只在水面（接触空气）显示；实体块在接触空气或水时显示
          const visible = isWater
            ? neighbor === BlockType.Air
            : neighbor === BlockType.Air || neighbor === BlockType.Water;

          if (!visible) continue;

          // 该面颜色：默认取方块色；草仅顶面染群系色（侧面/底面由贴图自带草皮与泥土色）
          const bright = face.brightness;
          let fr = r;
          let fg = g;
          let fb = b;
          if (type === BlockType.Grass && fi === 0) {
            const hex = getGrassColor(wx, wz, seed);
            fr = (((hex >> 16) & 255) / 255) * jitter;
            fg = (((hex >> 8) & 255) / 255) * jitter;
            fb = ((hex & 255) / 255) * jitter;
          }

          if (isWater) {
            const base = waterVertexCount;
            for (const corner of face.corners) {
              waterPos.push(lx + corner[0], ly + corner[1], lz + corner[2]);
              waterColors.push(fr * bright, fg * bright, fb * bright);
              waterNormals.push(face.dir[0], face.dir[1], face.dir[2]);
              waterVertexCount++;
            }
            waterIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          } else {
            // 瓦片内 UV（半像素内缩，防图集接缝串色）
            const tile = tileIndexFor(type, fi);
            const tx = tile % ATLAS_COLS;
            const ty = Math.floor(tile / ATLAS_COLS);
            const map = UV_MAP[fi];
            const base = solidVertexCount;
            for (const corner of face.corners) {
              const u01 = map.flipU ? 1 - corner[map.u] : corner[map.u];
              const v01 = map.flipV ? 1 - corner[map.v] : corner[map.v];
              const u = (tx * ATLAS_TILE + 0.5 + u01 * (ATLAS_TILE - 1)) / (ATLAS_COLS * ATLAS_TILE);
              // v 轴分母必须是图集行数（8 列 × 4 行 → 高度 4×ATLAS_TILE），用列数会导致错位
              const v =
                1 - (ty * ATLAS_TILE + 0.5 + v01 * (ATLAS_TILE - 1)) / (ATLAS_ROWS * ATLAS_TILE);
              solidPos.push(lx + corner[0], ly + corner[1], lz + corner[2]);
              solidColors.push(fr * bright, fg * bright, fb * bright);
              solidNormals.push(face.dir[0], face.dir[1], face.dir[2]);
              solidUvs.push(u, v);
              solidVertexCount++;
            }
            solidIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
    }
  }

  return {
    solid: solidPos.length > 0
      ? makeGeometry(solidPos, solidColors, solidIndices, solidUvs, solidNormals)
      : null,
    water: waterPos.length > 0
      ? makeGeometry(waterPos, waterColors, waterIndices, null, waterNormals)
      : null,
  };
}
