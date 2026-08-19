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

  // 玩家模型：随机颜色的简单竖条（第一人称隐藏，第三人称跟随身体）。
  readonly mesh: THREE.Group;
  // 第三人称：仅观看模式（不能移动/挖掘），相机绕玩家旋转。
  thirdPerson = false;

  private _yaw = 0;
  private _pitch = 0;

  // 视角可读写（存档/载入需要）。setter 内同步相机。
  get yaw(): number {
    return this._yaw;
  }
  set yaw(v: number) {
    this._yaw = v;
    this.applyCamera();
  }
  get pitch(): number {
    return this._pitch;
  }
  set pitch(v: number) {
    const limit = Math.PI / 2 - 0.01;
    this._pitch = Math.max(-limit, Math.min(limit, v));
    this.applyCamera();
  }

  constructor(
    private camera: THREE.PerspectiveCamera,
    private world: World,
  ) {
    // 自动找最近的陆地出生（避免出生在海里）
    const spawn = findSpawn(world.seed);
    this.position.set(spawn.x, spawn.height + 1, spawn.z);
    this.mesh = this.createModel();
    this.mesh.visible = false; // 第一人称默认隐藏身体
    this.mesh.position.copy(this.position);
    this.applyCamera();
  }

  // 切换第一/第三人称。第三人称显示身体、相机拉远；第一人称隐藏身体。
  setThirdPerson(v: boolean): void {
    this.thirdPerson = v;
    this.mesh.visible = v;
    this.applyCamera();
  }

  // 简单建模：随机颜色的竖条（身体 + 头部 + 正面小标记，让人看得清朝向）。
  private createModel(): THREE.Group {
    const group = new THREE.Group();

    // 随机鲜艳颜色（HSL 随机色相，保证可见且不灰暗）
    const hue = Math.random();
    const bodyColor = new THREE.Color().setHSL(hue, 0.6, 0.5);
    const headColor = bodyColor.clone().offsetHSL(0, 0, 0.16);

    const body = new THREE.Mesh(
      new THREE.BoxGeometry(0.5, 1.2, 0.32),
      new THREE.MeshLambertMaterial({ color: bodyColor }),
    );
    body.position.y = 0.72;

    const head = new THREE.Mesh(
      new THREE.BoxGeometry(0.42, 0.42, 0.42),
      new THREE.MeshLambertMaterial({ color: headColor }),
    );
    head.position.y = 1.56;

    // 正面小标记（深色小块），朝向 -Z 方向，随 yaw 旋转后指向玩家看向的方向
    const face = new THREE.Mesh(
      new THREE.BoxGeometry(0.08, 0.08, 0.05),
      new THREE.MeshLambertMaterial({ color: 0x111111 }),
    );
    face.position.set(0, 1.56, -0.24);

    group.add(body, head, face);
    return group;
  }

  update(dt: number, input: Input): void {
    // 视角（原地写私有字段，避免 setter 每帧额外 applyCamera）
    const { dx, dy } = input.consumeLook();
    this._yaw -= dx * MOUSE_SENSITIVITY;
    this._pitch -= dy * MOUSE_SENSITIVITY;
    const limit = Math.PI / 2 - 0.01;
    this._pitch = Math.max(-limit, Math.min(limit, this._pitch));

    if (this.thirdPerson) {
      // 第三人称：不能移动/跳跃，仅保留重力落回地面站稳（站在原地，可转视角）
      this.velocity.x = 0;
      this.velocity.z = 0;
      this.velocity.y += GRAVITY * dt;
      this.moveAxis(this.velocity.y * dt, 1);
    } else {
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
    }

    // 模型跟随玩家（朝向 = 视角 yaw）
    this.mesh.position.set(this.position.x, this.position.y, this.position.z);
    this.mesh.rotation.y = this.yaw;

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
    if (this.thirdPerson) {
      // 第三人称：相机移到玩家后上方，随视角绕玩家旋转（只能看自己）
      // 注意：setFromEuler 是旋转向量本身，必须从默认朝向 (0,0,-1) 开始，不能从零向量
      const dist = 4.2;
      const dir = new THREE.Vector3(0, 0, -1).applyEuler(new THREE.Euler(this._pitch, this._yaw, 0, 'YXZ'));
      this.camera.position
        .set(this.position.x, this.position.y + this.eyeHeight + 0.6, this.position.z)
        .addScaledVector(dir, -dist);
    } else {
      // 第一人称：眼睛位置（看不到身体）
      this.camera.position.set(this.position.x, this.position.y + this.eyeHeight, this.position.z);
    }
    this.camera.rotation.order = 'YXZ';
    this.camera.rotation.set(this._pitch, this._yaw, 0);
  }
}
