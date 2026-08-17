// 移动端触控 UI：虚拟摇杆、触控视角、跳跃/挖掘/放置/暂停按钮。
// 使用 Pointer Events 统一处理触摸与鼠标（手机接鼠标也能操作）。

import { Input } from './input';

interface TouchActions {
  dig: () => void;
  place: () => void;
  pause: () => void;
}

const LOOK_SCALE = 2.0; // 触控视角灵敏度倍率

export function initTouch(input: Input, actions: TouchActions): (touch: boolean) => void {
  // —— 虚拟摇杆 ——
  const joystick = document.getElementById('joystick')!;
  const knob = document.getElementById('joystick-knob')!;
  const joyRadius = 40;
  let joyId: number | null = null;
  let joyCX = 0;
  let joyCY = 0;

  function updateJoystick(cx: number, cy: number): void {
    let dx = cx - joyCX;
    let dy = cy - joyCY;
    const len = Math.hypot(dx, dy);
    if (len > joyRadius) {
      dx = (dx / len) * joyRadius;
      dy = (dy / len) * joyRadius;
    }
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    input.setJoystick(dx / joyRadius, dy / joyRadius);
  }

  function endJoystick(): void {
    joyId = null;
    input.setJoystick(0, 0);
    knob.style.transform = 'translate(-50%, -50%)';
  }

  joystick.addEventListener('pointerdown', (e) => {
    if (joyId !== null) return;
    joyId = e.pointerId;
    const rect = joystick.getBoundingClientRect();
    joyCX = rect.left + rect.width / 2;
    joyCY = rect.top + rect.height / 2;
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

  document.getElementById('btn-dig')!.addEventListener('pointerdown', (e) => {
    actions.dig();
    e.preventDefault();
  });
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
