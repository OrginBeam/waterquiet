// 客户端联机网络层：基于 Colyseus SDK 连接服务端房间。
// 职责：
//  - 连接/加入房间，接收 world-init（seed + 脏区块 + 出生点）
//  - 发送玩家移动（move）、方块变更请求（set-block）
//  - 接收方块变更广播（block-update）回调给渲染层
//  - 维护其他玩家列表（players），供渲染层绘制

import { Client, Room } from '@colyseus/sdk';
import { GameState, PlayerState } from './GameState';

// 服务端下发的初始世界数据
export interface WorldInit {
  seed: number;
  mode: string;
  chunks: { key: string; data: number[] }[];
  spawn: { x: number; y: number; z: number };
}

export interface RemotePlayerState {
  sessionId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  name: string;
}

export class NetworkClient {
  room: Room<GameState> | null = null;

  // 事件回调（由 main.ts 注入）
  onWorldInit: ((init: WorldInit) => void) | null = null;
  onBlockUpdate: ((msg: { x: number; y: number; z: number; blockType: number }) => void) | null = null;
  onPlayersChanged: ((players: Map<string, RemotePlayerState>) => void) | null = null;
  onModeChange: ((mode: string) => void) | null = null;
  onChat: ((text: string) => void) | null = null;
  onLeave: ((code: number) => void) | null = null;

  // 其他玩家（sessionId → 最新状态），由 onStateChange 增量维护
  private players = new Map<string, RemotePlayerState>();

  // 连接服务器并加入 game 房间
  async connect(url: string, name?: string): Promise<void> {
    // Colyseus SDK 的 joinOrCreate('game') 会自动在 base URL 后拼接房间名 /game。
    // 如果用户填的地址已经带了 /game（如 ws://localhost:2567/game），
    // 直接传进去会变成 …/game/game 匹配不到房间。这里剥掉多余后缀。
    let base = url.replace(/\/+$/, ''); // 去掉结尾斜杠（兼容 ws://host:port/）
    if (base.endsWith('/game')) base = base.slice(0, -'/game'.length);
    const client = new Client(base);
    const room = await client.joinOrCreate<GameState>('game', { name }, GameState);
    this.room = room;

    // world-init：服务器发来 seed + 脏区块 + 出生点
    room.onMessage('world-init', (init: WorldInit) => {
      this.onWorldInit?.(init);
    });

    // block-update：任何玩家改方块，广播给所有人
    room.onMessage('block-update', (msg: { x: number; y: number; z: number; blockType: number }) => {
      this.onBlockUpdate?.(msg);
    });

    // chat：服务器广播的聊天/系统消息（say 指令、被踢提示等）
    room.onMessage('chat', (msg: { text: string }) => {
      this.onChat?.(msg.text);
    });

    // mode-change：服务器通过 setmode 指令切换游戏模式
    room.onMessage('mode-change', (msg: { mode: string }) => {
      this.onModeChange?.(msg.mode);
    });

    // 房间状态首次同步 + 每次变化：重建/增量玩家列表
    room.onStateChange((state) => {
      const map = new Map<string, RemotePlayerState>();
      for (const [sid, ps] of state.players) {
        map.set(sid, {
          sessionId: sid,
          x: ps.x,
          y: ps.y,
          z: ps.z,
          yaw: ps.yaw,
          pitch: ps.pitch,
          name: ps.name,
        });
      }
      this.players = map;
      this.onPlayersChanged?.(map);
    });

    // 离开/断开
    room.onLeave((code: number) => {
      this.room = null;
      this.onLeave?.(code);
    });
  }

  // 上报自身位置/朝向（服务端写入 state，自动广播给他人）
  sendMove(x: number, y: number, z: number, yaw: number, pitch: number): void {
    this.room?.send('move', { x, y, z, yaw, pitch });
  }

  // 请求修改方块（挖掘→Air，放置→选中方块）
  setBlock(x: number, y: number, z: number, blockType: number): void {
    this.room?.send('set-block', { x, y, z, blockType });
  }

  // 其他玩家最新状态
  getPlayers(): Map<string, RemotePlayerState> {
    return this.players;
  }

  // 断开连接
  async leave(): Promise<void> {
    if (this.room) {
      await this.room.leave(true);
      this.room = null;
    }
  }
}
