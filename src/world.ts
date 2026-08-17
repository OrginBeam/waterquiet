// 世界管理：区块加载/卸载、方块读写、网格重建。
// 已修改区块存内存（后续阶段落 IndexedDB），未修改区块由种子即时重建。

import * as THREE from 'three';
import {
  CHUNK_SIZE_X,
  CHUNK_SIZE_Y,
  CHUNK_SIZE_Z,
  BlockType,
  RENDER_DISTANCE,
} from './core/constants';
import { getBlock as terrainBlock, getColumn, blockAtColumn } from './core/terrain';
import { buildChunkGeometry } from './core/chunk';
import { placeTrees } from './core/tree';

export class World {
  seed: number;
  readonly group = new THREE.Group();

  private chunks = new Map<string, Uint8Array>();
  private meshes = new Map<string, THREE.Mesh>();
  private material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });

  constructor(seed: number) {
    this.seed = seed;
  }

  // 重置世界：清空所有区块与网格，换新种子。
  reset(seed: number): void {
    this.seed = seed;
    for (const mesh of this.meshes.values()) {
      this.group.remove(mesh);
      mesh.geometry.dispose();
    }
    this.meshes.clear();
    this.chunks.clear();
  }

  private key(cx: number, cz: number): string {
    return `${cx},${cz}`;
  }

  // 读取方块：优先读已加载（可能被修改）区块，否则即时按种子生成。
  getBlock(x: number, y: number, z: number): BlockType {
    if (y < 0 || y >= CHUNK_SIZE_Y) return BlockType.Air;
    const cx = Math.floor(x / CHUNK_SIZE_X);
    const cz = Math.floor(z / CHUNK_SIZE_Z);
    const data = this.chunks.get(this.key(cx, cz));
    if (!data) return terrainBlock(x, y, z, this.seed);

    const lx = x - cx * CHUNK_SIZE_X;
    const lz = z - cz * CHUNK_SIZE_Z;
    return data[y * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx];
  }

  // 是否实体（可碰撞、不可穿透）。水暂视为非实体。
  isSolid(x: number, y: number, z: number): boolean {
    const b = this.getBlock(x, y, z);
    return b !== BlockType.Air && b !== BlockType.Water;
  }

  setBlock(x: number, y: number, z: number, type: BlockType): void {
    if (y < 0 || y >= CHUNK_SIZE_Y) return;
    const cx = Math.floor(x / CHUNK_SIZE_X);
    const cz = Math.floor(z / CHUNK_SIZE_Z);

    this.ensureChunk(cx, cz);
    const data = this.chunks.get(this.key(cx, cz))!;
    const lx = x - cx * CHUNK_SIZE_X;
    const lz = z - cz * CHUNK_SIZE_Z;
    data[y * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx] = type;

    this.rebuild(cx, cz);
    // 边界改动会影响相邻区块的面剔除，需一并重建
    if (lx === 0) this.rebuild(cx - 1, cz);
    if (lx === CHUNK_SIZE_X - 1) this.rebuild(cx + 1, cz);
    if (lz === 0) this.rebuild(cx, cz - 1);
    if (lz === CHUNK_SIZE_Z - 1) this.rebuild(cx, cz + 1);
  }

  private ensureChunk(cx: number, cz: number): void {
    const k = this.key(cx, cz);
    if (this.chunks.has(k)) return;

    const data = new Uint8Array(CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z);
    const originX = cx * CHUNK_SIZE_X;
    const originZ = cz * CHUNK_SIZE_Z;
    for (let lz = 0; lz < CHUNK_SIZE_Z; lz++) {
      for (let lx = 0; lx < CHUNK_SIZE_X; lx++) {
        const wx = originX + lx;
        const wz = originZ + lz;
        const col = getColumn(wx, wz, this.seed); // 每列只算一次高度/群系
        for (let ly = 0; ly < CHUNK_SIZE_Y; ly++) {
          const idx = ly * CHUNK_SIZE_X * CHUNK_SIZE_Z + lz * CHUNK_SIZE_X + lx;
          data[idx] = blockAtColumn(col, wx, ly, wz, this.seed);
        }
      }
    }
    placeTrees(data, cx, cz, this.seed);
    this.chunks.set(k, data);
  }

  private rebuild(cx: number, cz: number): void {
    const k = this.key(cx, cz);

    const old = this.meshes.get(k);
    if (old) {
      this.group.remove(old);
      old.geometry.dispose();
      this.meshes.delete(k);
    }

    if (!this.chunks.has(k)) return;

    const geometry = buildChunkGeometry(cx, cz, (x, y, z) => this.getBlock(x, y, z), this.seed);
    if (!geometry) return;

    const mesh = new THREE.Mesh(geometry, this.material);
    mesh.position.set(cx * CHUNK_SIZE_X, 0, cz * CHUNK_SIZE_Z);
    this.group.add(mesh);
    this.meshes.set(k, mesh);
  }

  // 每帧根据玩家位置加载周边区块、卸载远处区块。
  update(px: number, pz: number): void {
    const pcx = Math.floor(px / CHUNK_SIZE_X);
    const pcz = Math.floor(pz / CHUNK_SIZE_Z);

    // 收集缺失区块，按与玩家距离排序（近的优先加载）
    const needed: [number, number][] = [];
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        if (!this.chunks.has(this.key(cx, cz))) needed.push([cx, cz]);
      }
    }
    needed.sort((a, b) => {
      const da = (a[0] - pcx) ** 2 + (a[1] - pcz) ** 2;
      const db = (b[0] - pcx) ** 2 + (b[1] - pcz) ** 2;
      return da - db;
    });

    // 分帧加载，避免单帧生成多个区块导致卡顿
    const LOAD_PER_FRAME = 2;
    for (let i = 0; i < Math.min(LOAD_PER_FRAME, needed.length); i++) {
      const [cx, cz] = needed[i];
      this.ensureChunk(cx, cz);
      this.rebuild(cx, cz);
    }

    const unloadDist = RENDER_DISTANCE + 1;
    for (const k of [...this.chunks.keys()]) {
      const [cx, cz] = k.split(',').map(Number);
      if (Math.abs(cx - pcx) > unloadDist || Math.abs(cz - pcz) > unloadDist) {
        const old = this.meshes.get(k);
        if (old) {
          this.group.remove(old);
          old.geometry.dispose();
          this.meshes.delete(k);
        }
        this.chunks.delete(k);
      }
    }
  }
}
