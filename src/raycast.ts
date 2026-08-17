// 体素 DDA 射线检测（Amanatides & Woo），返回首个命中的实体方块及其面法线。

export interface RaycastHit {
  x: number;
  y: number;
  z: number;
  nx: number;
  ny: number;
  nz: number;
}

export function raycastVoxel(
  origin: { x: number; y: number; z: number },
  dir: { x: number; y: number; z: number },
  maxDist: number,
  isSolid: (x: number, y: number, z: number) => boolean,
): RaycastHit | null {
  let x = Math.floor(origin.x);
  let y = Math.floor(origin.y);
  let z = Math.floor(origin.z);

  const stepX = dir.x > 0 ? 1 : -1;
  const stepY = dir.y > 0 ? 1 : -1;
  const stepZ = dir.z > 0 ? 1 : -1;

  const tDeltaX = Math.abs(1 / (dir.x || 1e-10));
  const tDeltaY = Math.abs(1 / (dir.y || 1e-10));
  const tDeltaZ = Math.abs(1 / (dir.z || 1e-10));

  let tMaxX = dir.x === 0 ? Infinity : (dir.x > 0 ? (x + 1 - origin.x) : (origin.x - x)) * tDeltaX;
  let tMaxY = dir.y === 0 ? Infinity : (dir.y > 0 ? (y + 1 - origin.y) : (origin.y - y)) * tDeltaY;
  let tMaxZ = dir.z === 0 ? Infinity : (dir.z > 0 ? (z + 1 - origin.z) : (origin.z - z)) * tDeltaZ;

  let nx = 0;
  let ny = 0;
  let nz = 0;
  let t = 0;

  while (t <= maxDist) {
    if (isSolid(x, y, z)) {
      return { x, y, z, nx, ny, nz };
    }

    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX;
      ny = 0;
      nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0;
      ny = -stepY;
      nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0;
      ny = 0;
      nz = -stepZ;
    }
  }

  return null;
}
