// 世界管理：区块加载/卸载、方块读写、网格重建。
// 已修改区块存内存（落盘见 save.ts），未修改区块由种子即时重建。

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
import { ChunkRecord } from './save';

// 单个区块的渲染产物：solid 为不透明实体块，water 为半透明水体。
interface ChunkMeshes {
  solid?: THREE.Mesh;
  water?: THREE.Mesh;
}

export class World {
  seed: number;
  readonly group = new THREE.Group();

  private chunks = new Map<string, Uint8Array>();
  private meshes = new Map<string, ChunkMeshes>();
  // 与程序化地形不一致的区块：需存盘且会话期内永不下内存。
  private dirtyChunks = new Set<string>();
  private material = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
  });
  // 水：半透明、不写深度，让水面下的地形透出来。
  private waterMaterial = new THREE.MeshBasicMaterial({
    vertexColors: true,
    side: THREE.DoubleSide,
    transparent: true,
    opacity: 0.55,
    depthWrite: false,
  });

  constructor(seed: number) {
    this.seed = seed;
  }

  // 重置世界：清空所有区块与网格，换新种子。
  reset(seed: number): void {
    this.seed = seed;
    for (const m of this.meshes.values()) this.disposeChunkMeshes(m);
    this.meshes.clear();
    this.chunks.clear();
    this.dirtyChunks.clear();
  }

  private disposeChunkMeshes(m: ChunkMeshes): void {
    if (m.solid) {
      this.group.remove(m.solid);
      m.solid.geometry.dispose();
    }
    if (m.water) {
      this.group.remove(m.water);
      m.water.geometry.dispose();
    }
  }

  // 导出全部 dirty 区块快照。data 用 slice() 拷贝：
  // 异步写盘期间玩家可能继续 setBlock，快照与实时内存互不干扰。
  exportDirtyChunks(): ChunkRecord[] {
    const out: ChunkRecord[] = [];
    for (const k of this.dirtyChunks) {
      const data = this.chunks.get(k);
      if (data) out.push({ key: k, data: data.slice() });
    }
    return out;
  }

  // 载入存档：把区块塞回 chunks Map 并重新标记 dirty（永驻内存，与生成不再一致）。
  importChunks(records: ChunkRecord[]): void {
    const size = CHUNK_SIZE_X * CHUNK_SIZE_Y * CHUNK_SIZE_Z;
    for (const r of records) {
      // 防御性校验：尺寸不符的记录丢弃（正常流程不会出现）。
      if (r.data.length !== size) continue;
      this.chunks.set(r.key, r.data.slice());
      this.dirtyChunks.add(r.key);
    }
  }

  // 同步重建玩家周围 (2·RENDER_DISTANCE+1)² 区块的网格。
  // update() 分帧渐进（每帧 2 块）太慢，载入存档瞬间需要一次补全。
  rebuildArea(px: number, pz: number): void {
    const pcx = Math.floor(px / CHUNK_SIZE_X);
    const pcz = Math.floor(pz / CHUNK_SIZE_Z);
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        this.ensureChunk(cx, cz);
        this.rebuild(cx, cz);
      }
    }
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
    this.dirtyChunks.add(this.key(cx, cz));

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
      this.disposeChunkMeshes(old);
      this.meshes.delete(k);
    }

    if (!this.chunks.has(k)) return;

    const geo = buildChunkGeometry(cx, cz, (x, y, z) => this.getBlock(x, y, z), this.seed);
    const entry: ChunkMeshes = {};

    if (geo.solid) {
      const mesh = new THREE.Mesh(geo.solid, this.material);
      mesh.position.set(cx * CHUNK_SIZE_X, 0, cz * CHUNK_SIZE_Z);
      this.group.add(mesh);
      entry.solid = mesh;
    }
    if (geo.water) {
      const mesh = new THREE.Mesh(geo.water, this.waterMaterial);
      mesh.position.set(cx * CHUNK_SIZE_X, 0, cz * CHUNK_SIZE_Z);
      this.group.add(mesh);
      entry.water = mesh;
    }

    if (entry.solid || entry.water) this.meshes.set(k, entry);
  }

  // 每帧根据玩家位置加载周边区块、卸载远处区块。
  update(px: number, pz: number): void {
    const pcx = Math.floor(px / CHUNK_SIZE_X);
    const pcz = Math.floor(pz / CHUNK_SIZE_Z);

    // 收集缺失区块，按与玩家距离排序（近的优先加载）。
    // 两层判断：从未加载的区块需生成；dirty 区块永驻内存但 mesh 可能尚未构建
    // （如从存档载入、离玩家较远时），走近后需补 mesh。干净的空区块（无几何）不重复构建。
    const needed: [number, number][] = [];
    for (let dx = -RENDER_DISTANCE; dx <= RENDER_DISTANCE; dx++) {
      for (let dz = -RENDER_DISTANCE; dz <= RENDER_DISTANCE; dz++) {
        const cx = pcx + dx;
        const cz = pcz + dz;
        const k = this.key(cx, cz);
        if (!this.chunks.has(k) || (this.dirtyChunks.has(k) && !this.meshes.has(k))) {
          needed.push([cx, cz]);
        }
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
      // dirty 区块不能卸载：数据与网格都保留，否则修改会随卸载丢失。
      if (this.dirtyChunks.has(k)) continue;
      if (Math.abs(cx - pcx) > unloadDist || Math.abs(cz - pcz) > unloadDist) {
        const old = this.meshes.get(k);
        if (old) {
          this.disposeChunkMeshes(old);
          this.meshes.delete(k);
        }
        this.chunks.delete(k);
      }
    }
  }
}
