// 3D 方块图标生成器：在 Canvas 上渲染类似 MC 风格的 Isometric 3D 立体方块图标
import { BlockType, BLOCK_COLORS } from './constants';

const iconCache = new Map<BlockType, string>();

function hexToRgb(hex: number): [number, number, number] {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function adjustColor(rgb: [number, number, number], factor: number): string {
  const r = Math.max(0, Math.min(255, Math.round(rgb[0] * factor)));
  const g = Math.max(0, Math.min(255, Math.round(rgb[1] * factor)));
  const b = Math.max(0, Math.min(255, Math.round(rgb[2] * factor)));
  return `rgb(${r},${g},${b})`;
}

// 获取各面颜色（草方块和原木有特殊多面颜色）
function getFaceColors(block: BlockType): { top: string; left: string; right: string } {
  let baseColor = BLOCK_COLORS[block] ?? 0x888888;
  let topColor = baseColor;
  let sideColor = baseColor;

  if (block === BlockType.Grass) {
    topColor = 0x6db53e; // 草绿
    sideColor = 0x8a5a2b; // 泥土棕
  } else if (block === BlockType.Wood) {
    topColor = 0x8c6239; // 原木年轮
    sideColor = 0x54391e; // 原木树皮
  }

  const topRgb = hexToRgb(topColor);
  const sideRgb = hexToRgb(sideColor);

  return {
    top: adjustColor(topRgb, 1.15),   // 顶面亮
    left: adjustColor(sideRgb, 0.85),  // 左面中
    right: adjustColor(sideRgb, 0.65), // 右面暗
  };
}

// 绘制 3D 轴测方块图标（Size 64x64）
export function getBlockIconDataUrl(block: BlockType): string {
  if (block === BlockType.Air) return '';
  if (iconCache.has(block)) return iconCache.get(block)!;

  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  const colors = getFaceColors(block);

  const cx = size / 2;
  const topY = size * 0.14;
  const midY = size * 0.48;
  const botY = size * 0.88;
  const leftX = size * 0.12;
  const rightX = size * 0.88;

  // 1. 顶面 (Top Face - 菱形)
  ctx.fillStyle = colors.top;
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(rightX, topY + (midY - topY) / 2);
  ctx.lineTo(cx, midY);
  ctx.lineTo(leftX, topY + (midY - topY) / 2);
  ctx.closePath();
  ctx.fill();

  // 2. 左面 (Left Face)
  ctx.fillStyle = colors.left;
  ctx.beginPath();
  ctx.moveTo(leftX, topY + (midY - topY) / 2);
  ctx.lineTo(cx, midY);
  ctx.lineTo(cx, botY);
  ctx.lineTo(leftX, botY - (midY - topY) / 2);
  ctx.closePath();
  ctx.fill();

  // 3. 右面 (Right Face)
  ctx.fillStyle = colors.right;
  ctx.beginPath();
  ctx.moveTo(cx, midY);
  ctx.lineTo(rightX, topY + (midY - topY) / 2);
  ctx.lineTo(rightX, botY - (midY - topY) / 2);
  ctx.lineTo(cx, botY);
  ctx.closePath();
  ctx.fill();

  // 4. 边缘高光与描边（提升精致像素感）
  ctx.strokeStyle = 'rgba(0,0,0,0.35)';
  ctx.lineWidth = 2;
  ctx.stroke();

  // 内部交界线
  ctx.strokeStyle = 'rgba(255,255,255,0.15)';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx, topY);
  ctx.lineTo(cx, midY);
  ctx.lineTo(leftX, topY + (midY - topY) / 2);
  ctx.moveTo(cx, midY);
  ctx.lineTo(rightX, topY + (midY - topY) / 2);
  ctx.moveTo(cx, midY);
  ctx.lineTo(cx, botY);
  ctx.stroke();

  const dataUrl = canvas.toDataURL();
  iconCache.set(block, dataUrl);
  return dataUrl;
}
