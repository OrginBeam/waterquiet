// 输入管理：统一桌面（键盘 + 指针锁定）与移动端（触控）输入。

export class Input {
  isTouch: boolean;
  locked = false;

  private keys = new Set<string>();
  private mouseDX = 0;
  private mouseDY = 0;

  // 触摸注入（由 touch UI 写入）
  private joyX = 0;
  private joyY = 0;
  private touchDX = 0;
  private touchDY = 0;
  private touchJumpHeld = false;
  // 挖掘按住状态：桌面左键 / 移动端挖按钮
  private leftHeld = false;
  private touchDigHeld = false;

  constructor(private dom: HTMLElement) {
    // 窄屏 + 触摸硬件才判定为移动端，避免桌面触摸屏/虚拟触摸设备误判
    this.isTouch = navigator.maxTouchPoints > 0 && window.innerWidth <= 820;

    document.addEventListener('keydown', (e) => this.keys.add(e.code));
    document.addEventListener('keyup', (e) => this.keys.delete(e.code));

    document.addEventListener('mousemove', (e) => {
      if (this.locked) {
        this.mouseDX += e.movementX;
        this.mouseDY += e.movementY;
      }
    });

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.dom;
      // 失锁视为松开左键，防止退出指针锁后挖掘状态卡住
      if (!this.locked) this.leftHeld = false;
    });

    // 左键按住状态（供持续挖掘）。
    // 用 Pointer Events + pointerType 过滤：移动端点击触发的兼容 mouse 事件
    // （如点物品栏）不会误置左键，避免准心对着的方块被误挖掘；真实鼠标始终触发 pointer 事件。
    document.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.leftHeld = true;
    });
    document.addEventListener('pointerup', (e) => {
      if (e.pointerType === 'mouse' && e.button === 0) this.leftHeld = false;
    });
    window.addEventListener('blur', () => {
      this.leftHeld = false;
    });

    dom.addEventListener('mousedown', () => {
      if (!this.isTouch && !this.locked) dom.requestPointerLock();
    });
  }

  // —— 触摸注入（由 touch UI 调用）——
  setJoystick(x: number, y: number): void {
    this.joyX = x;
    this.joyY = y;
  }

  addTouchLook(dx: number, dy: number): void {
    this.touchDX += dx;
    this.touchDY += dy;
  }

  setTouchJump(held: boolean): void {
    this.touchJumpHeld = held;
  }

  setTouchDigHeld(held: boolean): void {
    this.touchDigHeld = held;
  }

  // 是否正在挖掘（桌面按住左键 或 移动端按住挖按钮）。
  // 移动端模式下忽略鼠标左键：触屏布局，鼠标点击屏幕不应触发挖掘（挖掘只认「挖」按钮）。
  get digging(): boolean {
    return (!this.isTouch && this.leftHeld) || this.touchDigHeld;
  }

  // —— 读取（player 每帧使用）——
  get forward(): number {
    if (this.keys.has('KeyW')) return 1;
    if (this.keys.has('KeyS')) return -1;
    return -this.joyY;
  }

  get strafe(): number {
    if (this.keys.has('KeyD')) return 1;
    if (this.keys.has('KeyA')) return -1;
    return this.joyX;
  }

  get jump(): boolean {
    return this.keys.has('Space') || this.touchJumpHeld;
  }

  consumeLook(): { dx: number; dy: number } {
    const dx = this.mouseDX + this.touchDX;
    const dy = this.mouseDY + this.touchDY;
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.touchDX = 0;
    this.touchDY = 0;
    return { dx, dy };
  }
}
