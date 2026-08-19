// 昼夜系统：纯视觉的时间光照时钟。
// 时间单位统一为「游戏分钟」：1 现实秒 = 1 游戏分钟，一天 = 1440 游戏分钟 = 24 现实分钟。
// 联机时服务器权威广播累计游戏分钟 time，客户端每帧本地推进、差异过大时用服务器值校准。

import * as THREE from 'three';

// 一天的游戏分钟数（1 现实秒 = 1 游戏分钟 → 24 分钟 = 一天）
export const DAY_MINUTES = 1440;
// 默认起始时间：第 1 天 08:00（新建世界/旧档无 time 字段时从早晨开始）
export const DAY_START_MINUTES = 480;

// 天空/雾色关键帧（游戏分钟 → 颜色），分段线性插值。
// 0 为午夜，360 为 06:00，720 为 12:00，1080 为 18:00。
const SKY_KEYFRAMES: { t: number; color: number }[] = [
  { t: 0, color: 0x0a1326 }, // 00:00 午夜
  { t: 300, color: 0x0a1326 }, // 05:00 深夜
  { t: 360, color: 0x2c4166 }, // 06:00 黎明
  { t: 420, color: 0x7fa3cc }, // 07:00 清晨
  { t: 480, color: 0x87b5e0 }, // 08:00 白昼
  { t: 960, color: 0x87b5e0 }, // 16:00 白昼
  { t: 1020, color: 0xcc8a55 }, // 17:00 黄昏
  { t: 1080, color: 0x3d3550 }, // 18:00 日落
  { t: 1140, color: 0x0a1326 }, // 19:00 入夜
  { t: 1440, color: 0x0a1326 }, // 24:00 回到午夜
];
// 预生成 Color 对象，避免每帧 new（插值时只读）
const KEY_COLORS: THREE.Color[] = SKY_KEYFRAMES.map((k) => new THREE.Color(k.color));
// 太阳光颜色插值端点（暖白 → 地平线暖橙）
const SUN_COLOR_HIGH = new THREE.Color(0xfff3e0);
const SUN_COLOR_LOW = new THREE.Color(0xffa060);

// 光照强度参数
const AMBIENT_NIGHT = 0.07; // 夜晚环境光（保留微光）
const AMBIENT_DAY = 0.5; // 白天环境光
const SUN_INTENSITY = 1.0; // 正午太阳光强
const MOON_INTENSITY = 0.28; // 满月月光光强（偏弱，仅夜晚生效）

// 平滑阶跃：t ∈ [0,1]，起点/终点两端缓入缓出。
function smoothstep(edge0: number, edge1: number, x: number): number {
  const t = Math.min(1, Math.max(0, (x - edge0) / (edge1 - edge0)));
  return t * t * (3 - 2 * t);
}

export class DayNight {
  // 累计游戏分钟（第 1 天 08:00 起），只增不减。
  private total = DAY_START_MINUTES;
  // 共享临时对象：方向/颜色方法返回它们，调用方须立即 copy（main.ts 均 copy 到灯光/背景）。
  private sunScratch = new THREE.Vector3();
  private moonScratch = new THREE.Vector3();
  private colorScratch = new THREE.Color();

  // 推进时间：dt 为现实秒，1 现实秒 = 1 游戏分钟。
  advance(dt: number): void {
    this.total += dt;
  }

  // 校准（联机用服务器权威值覆盖）。
  setTotal(v: number): void {
    this.total = Math.max(0, v);
  }

  getTotal(): number {
    return this.total;
  }

  // 当日游戏分钟（0..1439）
  getTimeOfDay(): number {
    return this.total % DAY_MINUTES;
  }

  // 第几天（1 起）
  getDay(): number {
    return Math.floor(this.total / DAY_MINUTES) + 1;
  }

  // 格式化显示：「第N天 HH:MM」（一天 1440 分钟映射 24 小时，即 1 游戏分钟 = 1 游戏小时）
  formatClock(): string {
    const tod = Math.floor(this.getTimeOfDay());
    const hh = Math.floor(tod / 60);
    const mm = tod % 60;
    const pad = (n: number) => (n < 10 ? `0${n}` : String(n));
    return `第${this.getDay()}天 ${pad(hh)}:${pad(mm)}`;
  }

  // —— 光照推导 ——
  // 太阳方位角：正午（720）头顶最高，6 点东升、18 点西落。
  // angle = tod / 1440 * 2π；sunDir = (sin a, -cos a, 0.35)（z 略偏，营造斜光方向感）。
  sunDirection(): THREE.Vector3 {
    const a = (this.getTimeOfDay() / DAY_MINUTES) * Math.PI * 2;
    return this.sunScratch.set(Math.sin(a), -Math.cos(a), 0.35).normalize();
  }

  // 月亮方向：与太阳水平方向相反（夜晚升到天空）。
  moonDirection(): THREE.Vector3 {
    const a = (this.getTimeOfDay() / DAY_MINUTES) * Math.PI * 2;
    return this.moonScratch.set(-Math.sin(a), Math.cos(a), -0.35).normalize();
  }

  // 太阳光强：太阳露出地平线后从 0 升到满（0..0.22 过渡区对应日出/日落）。
  sunIntensity(): number {
    const y = this.sunDirection().y;
    return smoothstep(0, 0.22, y) * SUN_INTENSITY;
  }

  // 月光强：夜晚月亮升到头顶时最亮。
  moonIntensity(): number {
    const y = this.moonDirection().y;
    return smoothstep(0, 0.12, y) * MOON_INTENSITY;
  }

  // 环境光强：白天亮、夜晚保留微光。
  ambientIntensity(): number {
    const y = this.sunDirection().y;
    const f = smoothstep(0, 0.2, y);
    return AMBIENT_NIGHT + (AMBIENT_DAY - AMBIENT_NIGHT) * f;
  }

  // 太阳光颜色：正午暖白，靠近地平线偏暖橙（黄昏氛围）。
  sunColor(): THREE.Color {
    const y = this.sunDirection().y;
    const warm = 1 - smoothstep(0, 0.35, y);
    return this.colorScratch.copy(SUN_COLOR_HIGH).lerp(SUN_COLOR_LOW, warm);
  }

  // 天空色（也用作场景背景与雾色，保证天际线融合）。
  skyColor(out: THREE.Color): THREE.Color {
    const tod = this.getTimeOfDay();
    if (tod <= SKY_KEYFRAMES[0].t) return out.copy(KEY_COLORS[0]);
    for (let i = 1; i < SKY_KEYFRAMES.length; i++) {
      if (tod <= SKY_KEYFRAMES[i].t) {
        const k0 = SKY_KEYFRAMES[i - 1];
        const k1 = SKY_KEYFRAMES[i];
        const f = (tod - k0.t) / (k1.t - k0.t);
        return out.lerpColors(KEY_COLORS[i - 1], KEY_COLORS[i], f);
      }
    }
    return out.copy(KEY_COLORS[KEY_COLORS.length - 1]);
  }
}
