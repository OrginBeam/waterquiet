// 第一人称玩家控制器：指针视角 + 移动 + 跳跃 + 重力 + AABB 方块碰撞。

import * as THREE from 'three';
import { World } from './world';
import { Input } from './input';
import { findSpawn } from './core/terrain';

const GRAVITY = -25;
const JUMP_SPEED = 8;
const WALK_SPEED = 4.317; // 贴近 Minecraft 步行速度
const GROUND_ACCEL = 12; // 地面加速（越大启动越快）
const AIR_ACCEL = 3; // 空中加速（越小越迟钝）
const MOUSE_SENSITIVITY = 0.002;

export class Player {
  position = new THREE.Vector3();
  velocity = new THREE.Vector3();
  onGround = false;

  readonly width = 0.6;
  readonly height = 1.8;
  readonly eyeHeight = 1.62;

  private yaw = 0;
  private pitch = 0;

  constructor(
    private camera: THREE.PerspectiveCamera,
    private world: World,
  ) {
    // 自动找最近的陆地出生（避免出生在海里）
    const spawn = findSpawn(world.seed);
    this.position.set(spawn.x, spawn.height + 1, spawn.z);
    this.applyCamera();
  }

  update(dt: number, input: Input): void {
    // 视角
    const { dx, dy } = input.consumeLook();
    this.yaw -= dx * MOUSE_SENSITIVITY;
    this.pitch -= dy * MOUSE_SENSITIVITY;
    const limit = Math.PI / 2 - 0.01;
    this.pitch = Math.max(-limit, Math.min(limit, this.pitch));

    // 移动方向（基于 yaw 的水平朝向）
    const forward = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const right = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));

    const move = new THREE.Vector3();
    move.addScaledVector(forward, input.forward);
    move.addScaledVector(right, input.strafe);

    if (move.lengthSq() > 0) move.normalize().multiplyScalar(WALK_SPEED);

    // MC 式水平移动：向目标速度加速（地面快、空中慢），无输入时地面摩擦减速
    const accel = this.onGround ? GROUND_ACCEL : AIR_ACCEL;
    const t = Math.min(1, accel * dt);
    this.velocity.x += (move.x - this.velocity.x) * t;
    this.velocity.z += (move.z - this.velocity.z) * t;

    if (this.onGround && move.lengthSq() === 0) {
      const friction = Math.pow(0.6, dt * 60);
      this.velocity.x *= friction;
      this.velocity.z *= friction;
      if (Math.abs(this.velocity.x) < 0.001) this.velocity.x = 0;
      if (Math.abs(this.velocity.z) < 0.001) this.velocity.z = 0;
    }

    // 跳跃
    if (input.jump && this.onGround) {
      this.velocity.y = JUMP_SPEED;
      this.onGround = false;
    }

    // 重力
    this.velocity.y += GRAVITY * dt;

    // 逐轴移动并碰撞
    this.moveAxis(this.velocity.x * dt, 0);
    this.moveAxis(this.velocity.y * dt, 1);
    this.moveAxis(this.velocity.z * dt, 2);

    this.applyCamera();
  }

  private moveAxis(dist: number, axis: 0 | 1 | 2): void {
    this.position.setComponent(axis, this.position.getComponent(axis) + dist);
    this.resolveCollision(axis);
  }

  private resolveCollision(axis: 0 | 1 | 2): void {
    const w = this.width / 2;
    const h = this.height;

    const minX = Math.floor(this.position.x - w);
    const maxX = Math.floor(this.position.x + w - 1e-9);
    const minY = Math.floor(this.position.y);
    const maxY = Math.floor(this.position.y + h - 1e-9);
    const minZ = Math.floor(this.position.z - w);
    const maxZ = Math.floor(this.position.z + w - 1e-9);

    for (let x = minX; x <= maxX; x++) {
      for (let y = minY; y <= maxY; y++) {
        for (let z = minZ; z <= maxZ; z++) {
          if (!this.world.isSolid(x, y, z)) continue;

          if (axis === 0) {
            if (this.velocity.x > 0) this.position.x = x - w - 1e-9;
            else if (this.velocity.x < 0) this.position.x = x + 1 + w;
            this.velocity.x = 0;
          } else if (axis === 1) {
            if (this.velocity.y > 0) this.position.y = y - h - 1e-9;
            else if (this.velocity.y < 0) {
              this.position.y = y + 1;
              this.onGround = true;
            }
            this.velocity.y = 0;
          } else {
            if (this.velocity.z > 0) this.position.z = z - w - 1e-9;
            else if (this.velocity.z < 0) this.position.z = z + 1 + w;
            this.velocity.z = 0;
          }
        }
      }
    }
  }

  // 目标方块格是否与玩家 AABB 重叠（用于放置校验，避免把自己埋进去）。
  intersectsBlock(bx: number, by: number, bz: number): boolean {
    const w = this.width / 2;
    const h = this.height;
    return (
      this.position.x + w > bx &&
      this.position.x - w < bx + 1 &&
      this.position.y + h > by &&
      this.position.y < by + 1 &&
      this.position.z + w > bz &&
      this.position.z - w < bz + 1
    );
  }

  private applyCamera(): void {
    this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}
