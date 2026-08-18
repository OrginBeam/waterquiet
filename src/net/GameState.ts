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
  @type({ map: PlayerState }) players = new MapSchema<PlayerState>();
}
