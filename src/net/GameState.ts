// 客户端联机状态 Schema：字段必须与服务端 Server/src/rooms/GameState.ts 完全一致。
// 客户端显式声明以便类型安全地读取同步状态。

import { Schema, MapSchema, type } from '@colyseus/schema';

export class PlayerState extends Schema {
  @type('float64') x = 0;
  @type('float64') y = 0;
  @type('float64') z = 0;
  @type('float64') yaw = 0;
  @type('float64') pitch = 0;
  @type('string') name = '';
}

export class GameState extends Schema {
  @type('int32') seed = 0;
  @type('string') mode = 'free';
  // 昼夜累计时间（服务器权威，客户端用于校准本地时钟，字段须与服务端一致；初始 480 = 第 1 天 08:00）
  @type('float64') time = 480;
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
