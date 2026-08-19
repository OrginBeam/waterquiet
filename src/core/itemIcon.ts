// 图标生成器：方块渲染类似 MC 风格的 Isometric 3D 立体图标，物品渲染 2D 平面图标。
import { BlockType, BLOCK_COLORS, ITEM_TYPES } from './constants';

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

// —— 物品（非方块）2D 图标 ——
function drawItemIcon(ctx: CanvasRenderingContext2D, size: number, type: BlockType): void {
  switch (type) {
    case BlockType.Stick: {
      // 斜向木棍
      const grad = ctx.createLinearGradient(10, 46, 54, 18);
      grad.addColorStop(0, '#7a4f26');
      grad.addColorStop(1, '#b07c40');
      ctx.strokeStyle = grad;
      ctx.lineWidth = 7;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(16, 48);
      ctx.lineTo(48, 16);
      ctx.stroke();
      break;
    }
    case BlockType.PlantFiber: {
      // 草束：几根绿色弯草
      ctx.strokeStyle = '#3f7a2c';
      ctx.lineWidth = 4;
      ctx.lineCap = 'round';
      for (let i = 0; i < 5; i++) {
        const x = 18 + i * 7;
        const bend = i % 2 ? 5 : -5;
        ctx.beginPath();
        ctx.moveTo(x, 50);
        ctx.quadraticCurveTo(x + bend / 2, 32, x + bend, 14);
        ctx.stroke();
      }
      break;
    }
    case BlockType.Tinder: {
      // 便捷火种：橙色小堆
      ctx.fillStyle = '#b06a20';
      ctx.beginPath();
      ctx.ellipse(32, 42, 16, 9, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#d98a35';
      ctx.beginPath();
      ctx.arc(32, 36, 9, 0, Math.PI * 2);
      ctx.fill();
      break;
    }
    case BlockType.StoneShard: {
      // 石子：灰白碎石片
      ctx.fillStyle = '#a8a8a0';
      ctx.beginPath();
      ctx.moveTo(32, 10);
      ctx.lineTo(52, 46);
      ctx.lineTo(12, 40);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 2;
      ctx.stroke();
      break;
    }
    case BlockType.StonePickaxe: {
      // 石镐：斜柄 + 弧形镐头
      ctx.strokeStyle = '#7a5a30';
      ctx.lineWidth = 6;
      ctx.lineCap = 'round';
      ctx.beginPath();
      ctx.moveTo(16, 54);
      ctx.lineTo(40, 30);
      ctx.stroke();
      ctx.strokeStyle = '#6d6d6a';
      ctx.lineWidth = 7;
      ctx.lineCap = 'butt';
      ctx.beginPath();
      ctx.arc(41, 31, 12, Math.PI * 0.8, Math.PI * 1.9);
      ctx.stroke();
      break;
    }
    case BlockType.QuartzSand: {
      // 石英砂：浅色沙粒
      ctx.fillStyle = '#e8e0d0';
      for (let i = 0; i < 44; i++) {
        const x = 12 + (i % 9) * 4.6;
        const y = 12 + Math.floor(i / 9) * 5.2;
        ctx.beginPath();
        ctx.arc(x + (i % 3), y + (i % 4), 1.7, 0, Math.PI * 2);
        ctx.fill();
      }
      break;
    }
    case BlockType.GlassBottle:
    case BlockType.WaterBottle: {
      // 玻璃瓶（瓶身 + 瓶颈）；盛水版内部填蓝
      const fill = type === BlockType.GlassBottle ? 'rgba(190,235,235,0.85)' : 'rgba(190,235,235,0.85)';
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(28, 44);
      ctx.lineTo(28, 22);
      ctx.lineTo(36, 22);
      ctx.lineTo(36, 44);
      ctx.quadraticCurveTo(36, 52, 32, 52);
      ctx.quadraticCurveTo(28, 52, 28, 44);
      ctx.closePath();
      ctx.fill();
      if (type === BlockType.WaterBottle) {
        ctx.fillStyle = 'rgba(70,140,200,0.9)';
        ctx.beginPath();
        ctx.moveTo(29, 38);
        ctx.lineTo(35, 38);
        ctx.lineTo(35, 45);
        ctx.quadraticCurveTo(35, 51, 32, 51);
        ctx.quadraticCurveTo(29, 51, 29, 45);
        ctx.closePath();
        ctx.fill();
      }
      ctx.strokeStyle = 'rgba(90,160,170,0.9)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = 'rgba(200,240,240,0.95)';
      ctx.fillRect(30, 14, 4, 8);
      break;
    }
    default: {
      // 兜底：灰色色块（理论不可达）
      ctx.fillStyle = '#888';
      ctx.fillRect(10, 10, 44, 44);
    }
  }
}

// 图标入口：方块 → 3D 轴测；物品 → 2D 平面。尺寸 64×64。
export function getBlockIconDataUrl(block: BlockType): string {
  if (block === BlockType.Air) return '';
  if (iconCache.has(block)) return iconCache.get(block)!;

  const canvas = document.createElement('canvas');
  const size = 64;
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  // 物品走 2D 平面图标
  if (ITEM_TYPES.includes(block)) {
    drawItemIcon(ctx, size, block);
    const dataUrl = canvas.toDataURL();
    iconCache.set(block, dataUrl);
    return dataUrl;
  }

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
