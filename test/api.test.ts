import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { AddressInfo } from 'node:net';
import { Store } from '../src/store';
import { createServer } from '../src/server';

let base: string;
let store: Store;
let server: ReturnType<typeof createServer>;
let dir: string;

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bowling-api-'));
  store = new Store(path.join(dir, 'api.db'));
  server = createServer(store);
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(() => {
  server.close();
  store.close();
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, p: string, body?: unknown): Promise<{ status: number; json: any }> {
  const res = await fetch(base + p, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}

test('API 全流程：创建、逐球、批量、查询、撤销、导出、导入', async () => {
  let r = await call('POST', '/games');
  assert.equal(r.status, 201);
  const id = r.json.gameId;

  r = await call('POST', `/games/${id}/rolls`, { pins: 10, version: 0 });
  assert.equal(r.status, 200);
  assert.equal(r.json.scorecard.frames[0].pending, true); // 奖励待定

  r = await call('POST', `/games/${id}/rolls`, { pins: [7, 3] });
  assert.equal(r.json.scorecard.frames[0].total, 20);

  r = await call('POST', `/games/${id}/undo`);
  assert.equal(r.status, 200);
  r = await call('POST', `/games/${id}/rolls`, { pins: 3 });
  assert.equal(r.json.scorecard.frames[0].total, 20); // 10 + 7 + 3

  r = await call('GET', `/games/${id}/export`);
  assert.deepEqual(r.json.rolls, [10, 7, 3]);

  r = await call('POST', '/games/import', { rolls: Array(12).fill(10) });
  assert.equal(r.status, 201);
  assert.equal(r.json.scorecard.totalScore, 300);
});

test('API 错误码：非法瓶数、超剩余瓶、版本冲突、局不存在、结束后投球', async () => {
  let r = await call('POST', '/games');
  const id = r.json.gameId;

  r = await call('POST', `/games/${id}/rolls`, { pins: 11 });
  assert.equal(r.status, 422);
  assert.equal(r.json.error.code, 'INVALID_PINS');

  r = await call('POST', `/games/${id}/rolls`, { pins: [7, 4] });
  assert.equal(r.json.error.code, 'EXCEEDS_REMAINING');

  r = await call('POST', `/games/${id}/rolls`, { pins: 1, version: 99 });
  assert.equal(r.status, 409);
  assert.equal(r.json.error.code, 'VERSION_CONFLICT');

  r = await call('GET', '/games/99999');
  assert.equal(r.status, 404);

  r = await call('POST', '/games/import', { rolls: Array(12).fill(10) });
  const doneId = r.json.gameId;
  r = await call('POST', `/games/${doneId}/rolls`, { pins: 1 });
  assert.equal(r.status, 422);
  assert.equal(r.json.error.code, 'GAME_OVER');
});
