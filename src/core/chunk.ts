// 区块网格构建：隐藏面剔除 + 单区块单 Mesh 合并 + 手绘面明暗 + 颜色抖动。
// 水拆成独立几何体，配合世界侧半透明材质实现水体透明。
// 阶段①不引入贪婪网格（留作后续优化项）。

import * as THREE from 'three';
import { CHUNK_SIZE_X, CHUNK_SIZE_Y, CHUNK_SIZE_Z, BlockType, BLOCK_COLORS } from './constants';
import { getGrassColor } from './biome';
import { hash3D } from './noise';

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

export interface ChunkGeometry {
  solid: THREE.BufferGeometry | null;
  water: THREE.BufferGeometry | null;
}

function makeGeometry(positions: number[], colors: number[], indices: number[]): THREE.BufferGeometry {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
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
  const waterPos: number[] = [];
  const waterColors: number[] = [];
  const waterIndices: number[] = [];
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

        // 基础色：草随群系配色，其余用固定色
        const baseColor =
          type === BlockType.Grass ? getGrassColor(wx, wz, seed) : BLOCK_COLORS[type] ?? 0xffffff;

        // 颜色抖动：每块轻微明暗差异，模拟纹理（水保持均匀）
        const jitter = isWater ? 1 : 0.94 + hash3D(wx, ly, wz, seed + 1234) * 0.12;

        const r = ((baseColor >> 16) & 255) * jitter;
        const g = ((baseColor >> 8) & 255) * jitter;
        const b = (baseColor & 255) * jitter;

        for (const face of FACES) {
          const nx = lx + face.dir[0];
          const ny = ly + face.dir[1];
          const nz = lz + face.dir[2];
          const neighbor = getBlock(originX + nx, ny, originZ + nz);

          // 面是否可见：水块只在水面（接触空气）显示；实体块在接触空气或水时显示
          const visible = isWater
            ? neighbor === BlockType.Air
            : neighbor === BlockType.Air || neighbor === BlockType.Water;

          if (!visible) continue;

          const bright = face.brightness;
          if (isWater) {
            const base = waterVertexCount;
            for (const corner of face.corners) {
              waterPos.push(lx + corner[0], ly + corner[1], lz + corner[2]);
              waterColors.push((r * bright) / 255, (g * bright) / 255, (b * bright) / 255);
              waterVertexCount++;
            }
            waterIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          } else {
            const base = solidVertexCount;
            for (const corner of face.corners) {
              solidPos.push(lx + corner[0], ly + corner[1], lz + corner[2]);
              solidColors.push((r * bright) / 255, (g * bright) / 255, (b * bright) / 255);
              solidVertexCount++;
            }
            solidIndices.push(base, base + 1, base + 2, base, base + 2, base + 3);
          }
        }
      }
    }
  }

  return {
    solid: solidPos.length > 0 ? makeGeometry(solidPos, solidColors, solidIndices) : null,
    water: waterPos.length > 0 ? makeGeometry(waterPos, waterColors, waterIndices) : null,
  };
}
