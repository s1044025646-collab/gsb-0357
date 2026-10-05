// HTTP API：仅本机回环，无外部依赖。
import * as http from 'node:http';
import { Store, StoreError } from './store';

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', c => (data += c));
    req.on('end', () => {
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(new StoreError('BAD_JSON', '请求体不是合法 JSON', 400));
      }
    });
    req.on('error', reject);
  });
}

export function createServer(store: Store): http.Server {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const method = req.method ?? 'GET';
      const body = (method === 'POST' || method === 'PUT') ? (await readBody(req)) as Record<string, unknown> : {};

      // POST /games 创建一局
      if (method === 'POST' && parts.length === 1 && parts[0] === 'games') {
        const game = store.createGame();
        return send(res, 201, { gameId: game.id, version: game.version });
      }

      // POST /games/import 导入投球序列
      if (method === 'POST' && parts.length === 2 && parts[0] === 'games' && parts[1] === 'import') {
        const rolls = body.rolls;
        if (!Array.isArray(rolls)) throw new StoreError('BAD_REQUEST', '需要 { "rolls": number[] }', 400);
        const { game, card } = store.importGame(rolls.map(Number));
        return send(res, 201, { gameId: game.id, version: store.version(game.id), scorecard: card });
      }

      const gameId = parts[0] === 'games' && parts[1] ? Number(parts[1]) : NaN;
      if (!Number.isInteger(gameId)) throw new StoreError('NOT_FOUND', '路由不存在', 404);

      // GET /games/:id 完整记分卡
      if (method === 'GET' && parts.length === 2) {
        return send(res, 200, {
          gameId,
          version: store.version(gameId),
          scorecard: store.scorecard(gameId),
        });
      }

      // GET /games/:id/export 导出投球序列
      if (method === 'GET' && parts.length === 3 && parts[2] === 'export') {
        return send(res, 200, {
          gameId,
          version: store.version(gameId),
          rolls: store.getRolls(gameId),
        });
      }

      // POST /games/:id/rolls 单球或批量录入，body: { "pins": 7 } 或 { "pins": [7,2,10] }，可选 "version"
      if (method === 'POST' && parts.length === 3 && parts[2] === 'rolls') {
        const pins = body.pins;
        const list = Array.isArray(pins) ? pins : [pins];
        if (list.length === 0 || list.some(p => typeof p !== 'number')) {
          throw new StoreError('BAD_REQUEST', '需要 { "pins": number | number[] }', 400);
        }
        const expected = typeof body.version === 'number' ? body.version : undefined;
        const card = store.appendRolls(gameId, list, expected);
        return send(res, 200, { gameId, version: store.version(gameId), scorecard: card });
      }

      // POST /games/:id/undo 撤销最后一球
      if (method === 'POST' && parts.length === 3 && parts[2] === 'undo') {
        const card = store.undoLast(gameId);
        return send(res, 200, { gameId, version: store.version(gameId), scorecard: card });
      }

      throw new StoreError('NOT_FOUND', '路由不存在', 404);
    } catch (e) {
      if (e instanceof StoreError) {
        return send(res, e.status, { error: { code: e.code, message: e.message } });
      }
      send(res, 500, { error: { code: 'INTERNAL', message: String(e) } });
    }
  });
}

if (require.main === module) {
  const store = new Store();
  const server = createServer(store);
  // 默认端口 0 = 让系统分配空闲端口；可用 PORT 环境变量指定。
  const port = process.env.PORT ? Number(process.env.PORT) : 0;
  server.listen(port, '127.0.0.1', () => {
    const addr = server.address();
    const actual = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`保龄球计分 API 已启动: http://127.0.0.1:${actual}`);
  });
}
