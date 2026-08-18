// 远程玩家渲染：为每个其他玩家显示一个彩色身体模型 + 名字标签。
// 复用单机玩家的建模思路（简单竖条），位置用 lerp 平滑追服务器数据。

import * as THREE from 'three';
import { RemotePlayerState } from './client';

// 名字标签：用 canvas 画一张贴图贴在 billboard 上，永远面向相机。
function makeNameLabel(name: string): THREE.Sprite {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 48;
  const ctx = canvas.getContext('2d')!;
  ctx.font = 'bold 28px "Microsoft YaHei", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  // 描边 + 填充，保证任何背景下可读
  ctx.strokeStyle = 'rgba(0,0,0,0.8)';
  ctx.lineWidth = 5;
  ctx.strokeText(name, 128, 24);
  ctx.fillStyle = '#fff';
  ctx.fillText(name, 128, 24);

  const tex = new THREE.CanvasTexture(canvas);
  tex.minFilter = THREE.LinearFilter;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite: false }));
  sprite.scale.set(2.2, 0.42, 1);
  // 名字显示在头顶上方（模型身高约 1.8，头顶约 2.0）
  sprite.position.y = 2.1;
  return sprite;
}

// 简单身体模型（与单机玩家一致：随机色竖条 + 头部 + 朝向标记）。
function makeBody(): THREE.Group {
  const group = new THREE.Group();
  const hue = Math.random();
  const bodyColor = new THREE.Color().setHSL(hue, 0.6, 0.5);
  const headColor = bodyColor.clone().offsetHSL(0, 0, 0.16);

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.2, 0.32),
    new THREE.MeshBasicMaterial({ color: bodyColor }),
  );
  body.position.y = 0.72;

  const head = new THREE.Mesh(
    new THREE.BoxGeometry(0.42, 0.42, 0.42),
    new THREE.MeshBasicMaterial({ color: headColor }),
  );
  head.position.y = 1.56;

  const face = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.08, 0.05),
    new THREE.MeshBasicMaterial({ color: 0x111111 }),
  );
  face.position.set(0, 1.56, -0.24);

  group.add(body, head, face);
  return group;
}

export class RemotePlayer {
  readonly group: THREE.Group;
  private body: THREE.Group;
  private nameLabel: THREE.Sprite;

  // 平滑位置/朝向（当前显示值与目标值的插值）
  private px = 0;
  private py = 0;
  private pz = 0;
  private pyaw = 0;
  private tx = 0;
  private ty = 0;
  private tz = 0;
  private tyaw = 0;

  constructor(state: RemotePlayerState) {
    this.body = makeBody();
    this.nameLabel = makeNameLabel(state.name);

    this.group = new THREE.Group();
    this.group.add(this.body, this.nameLabel);

    this.tx = this.px = state.x;
    this.ty = this.py = state.y;
    this.tz = this.pz = state.z;
    this.tyaw = this.pyaw = state.yaw;
  }

  // 更新目标位置（服务器新数据）
  sync(state: RemotePlayerState): void {
    this.tx = state.x;
    this.ty = state.y;
    this.tz = state.z;
    this.tyaw = state.yaw;
  }

  // 每帧向目标插值（dt 秒）。约 0.25 秒趋近目标。
  update(dt: number): void {
    const k = Math.min(1, dt * 8);
    this.px += (this.tx - this.px) * k;
    this.py += (this.ty - this.py) * k;
    this.pz += (this.tz - this.pz) * k;
    // 朝向取最短角差插值
    let dy = this.tyaw - this.pyaw;
    while (dy > Math.PI) dy -= Math.PI * 2;
    while (dy < -Math.PI) dy += Math.PI * 2;
    this.pyaw += dy * k;

    this.group.position.set(this.px, this.py, this.pz);
    this.group.rotation.y = this.pyaw;
  }

  dispose(): void {
    this.group.remove(this.body, this.nameLabel);
    (this.body as THREE.Object3D).removeFromParent?.();
  }
}
