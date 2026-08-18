// 移动端触控 UI：虚拟摇杆、触控视角、跳跃/挖掘/放置/暂停按钮。
// 使用 Pointer Events 统一处理触摸与鼠标（手机接鼠标也能操作）。

import { Input } from './input';

interface TouchActions {
  place: () => void;
  pause: () => void;
}

const LOOK_SCALE = 2.0; // 触控视角灵敏度倍率

export function initTouch(input: Input, actions: TouchActions): (touch: boolean) => void {
  // —— 浮动虚拟摇杆 ——
  // 命中区是左下半屏，手指按下位置即成为摇杆圆心，拖动产生方向。
  const joystick = document.getElementById('joystick')!;
  const joystickBase = document.getElementById('joystick-base')!;
  const knob = document.getElementById('joystick-knob')!;
  const joyRadius = 40; // 最大位移（像素），也用作归一化基准
  const deadZone = 12; // 死区：位移小于此值视为不动，避免手指微抖误触发
  let joyId: number | null = null;
  let joyCX = 0;
  let joyCY = 0;
  let smoothX = 0;
  let smoothY = 0;

  function updateJoystick(cx: number, cy: number): void {
    let dx = cx - joyCX;
    let dy = cy - joyCY;
    const len = Math.hypot(dx, dy);
    if (len > joyRadius) {
      dx = (dx / len) * joyRadius;
      dy = (dy / len) * joyRadius;
    }

    // 死区 + 平滑（避免方向抖动、突变）
    let nx = 0;
    let ny = 0;
    if (len > deadZone) {
      nx = dx / joyRadius;
      ny = dy / joyRadius;
    }
    smoothX += (nx - smoothX) * 0.5;
    smoothY += (ny - smoothY) * 0.5;

    knob.style.transform = `translate(calc(-50% + ${smoothX * joyRadius}px), calc(-50% + ${smoothY * joyRadius}px))`;
    input.setJoystick(smoothX, smoothY);
  }

  function endJoystick(): void {
    joyId = null;
    smoothX = 0;
    smoothY = 0;
    input.setJoystick(0, 0);
    joystickBase.style.display = 'none';
    knob.style.transform = 'translate(-50%, -50%)';
  }

  joystick.addEventListener('pointerdown', (e) => {
    if (joyId !== null) return;
    joyId = e.pointerId;
    joyCX = e.clientX;
    joyCY = e.clientY;
    // 把摇杆底座移动到手指按下位置
    joystickBase.style.left = `${e.clientX}px`;
    joystickBase.style.top = `${e.clientY}px`;
    joystickBase.style.display = 'block';
    joystick.setPointerCapture(e.pointerId);
    updateJoystick(e.clientX, e.clientY);
    e.preventDefault();
  });
  joystick.addEventListener('pointermove', (e) => {
    if (e.pointerId === joyId) updateJoystick(e.clientX, e.clientY);
    e.preventDefault();
  });
  joystick.addEventListener('pointerup', (e) => {
    if (e.pointerId === joyId) endJoystick();
  });
  joystick.addEventListener('pointercancel', (e) => {
    if (e.pointerId === joyId) endJoystick();
  });

  // —— 触控视角（右半屏拖动）——
  const look = document.getElementById('touch-look')!;
  let lookId: number | null = null;
  let lastX = 0;
  let lastY = 0;

  look.addEventListener('pointerdown', (e) => {
    if (lookId !== null) return;
    lookId = e.pointerId;
    lastX = e.clientX;
    lastY = e.clientY;
    look.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  look.addEventListener('pointermove', (e) => {
    if (e.pointerId === lookId) {
      input.addTouchLook((e.clientX - lastX) * LOOK_SCALE, (e.clientY - lastY) * LOOK_SCALE);
      lastX = e.clientX;
      lastY = e.clientY;
    }
    e.preventDefault();
  });
  look.addEventListener('pointerup', (e) => {
    if (e.pointerId === lookId) lookId = null;
  });
  look.addEventListener('pointercancel', (e) => {
    if (e.pointerId === lookId) lookId = null;
  });

  // —— 按钮 ——
  const jumpBtn = document.getElementById('btn-jump')!;
  jumpBtn.addEventListener('pointerdown', (e) => {
    input.setTouchJump(true);
    jumpBtn.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  jumpBtn.addEventListener('pointerup', () => input.setTouchJump(false));
  jumpBtn.addEventListener('pointercancel', () => input.setTouchJump(false));

  // 挖掘：按住持续挖（与跳跃同款的按住检测，进度由 main 主循环推进）
  const digBtn = document.getElementById('btn-dig')!;
  digBtn.addEventListener('pointerdown', (e) => {
    input.setTouchDigHeld(true);
    digBtn.setPointerCapture(e.pointerId); // 手指滑出按钮仍能收到抬起事件
    e.preventDefault();
  });
  digBtn.addEventListener('pointerup', () => input.setTouchDigHeld(false));
  digBtn.addEventListener('pointercancel', () => input.setTouchDigHeld(false));

  document.getElementById('btn-place')!.addEventListener('pointerdown', (e) => {
    actions.place();
    e.preventDefault();
  });
  document.getElementById('btn-pause')!.addEventListener('pointerdown', (e) => {
    actions.pause();
    e.preventDefault();
  });

  // 返回端模式切换函数
  return (touch: boolean): void => {
    input.isTouch = touch;
    document.body.classList.toggle('touch', touch);
  };
}
