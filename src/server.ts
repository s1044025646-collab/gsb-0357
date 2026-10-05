// HTTP API 服务（node:http，无外部依赖）。
import * as http from 'node:http';
import { AddressInfo } from 'node:net';
import { Store, StoreError, defaultDbPath } from './store';
import { ScoringError } from './scoring';

function send(res: http.ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body, null, 2);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(json);
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
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
      const url = new URL(req.url || '/', 'http://localhost');
      const parts = url.pathname.split('/').filter(Boolean);
      const body = (await readBody(req)) as Record<string, unknown>;

      if (req.method === 'POST' && url.pathname === '/games') {
        const game = store.createGame();
        return send(res, 201, { game });
      }
      if (req.method === 'POST' && url.pathname === '/games/import') {
        const pins = body.throws;
        if (!Array.isArray(pins)) throw new StoreError('BAD_REQUEST', '需要 throws 数组', 400);
        const { game, analysis } = store.importThrows(pins as number[]);
        return send(res, 201, { game, analysis });
      }
      if (parts[0] === 'games' && parts.length >= 2) {
        const id = Number(parts[1]);
        if (!Number.isInteger(id)) throw new StoreError('BAD_REQUEST', '局 id 非法', 400);
        if (req.method === 'GET' && parts.length === 2) {
          return send(res, 200, store.scorecard(id));
        }
        if (req.method === 'GET' && parts[2] === 'export') {
          const { game, throws } = store.scorecard(id);
          return send(res, 200, { gameId: game.id, version: game.version, throws });
        }
        if (req.method === 'GET' && parts[2] === 'events') {
          return send(res, 200, { events: store.getEvents(id) });
        }
        if (req.method === 'POST' && parts[2] === 'throws') {
          const expected = body.expectedVersion as number | undefined;
          if (body.pins !== undefined) {
            const analysis = store.appendThrows(id, [body.pins as number], expected);
            return send(res, 200, { analysis });
          }
          if (Array.isArray(body.throws)) {
            const analysis = store.appendThrows(id, body.throws as number[], expected);
            return send(res, 200, { analysis });
          }
          throw new StoreError('BAD_REQUEST', '需要 pins 或 throws 字段', 400);
        }
        if (req.method === 'POST' && parts[2] === 'undo') {
          const analysis = store.undoLast(id, body.expectedVersion as number | undefined);
          return send(res, 200, { analysis });
        }
      }
      throw new StoreError('NOT_FOUND', `${req.method} ${url.pathname} 不存在`, 404);
    } catch (err) {
      if (err instanceof StoreError) {
        return send(res, err.status, { error: { code: err.code, message: err.message } });
      }
      if (err instanceof ScoringError) {
        return send(res, 422, { error: { code: err.code, message: err.message } });
      }
      send(res, 500, { error: { code: 'INTERNAL', message: String(err) } });
    }
  });
}

if (require.main === module) {
  const portArg = process.argv.indexOf('--port');
  const port =
    portArg >= 0
      ? Number(process.argv[portArg + 1])
      : Number(process.env.PORT || 0); // 默认 0 = 随机空闲端口
  const store = new Store(defaultDbPath());
  const server = createServer(store);
  server.listen(port, () => {
    const addr = server.address() as AddressInfo;
    console.log(`保龄球计分服务已启动: http://127.0.0.1:${addr.port}`);
  });
}
