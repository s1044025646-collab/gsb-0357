// SQLite 持久层：投球序列 + 局版本号，原子写入，审计事件可查询。
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { analyze, validateAppend, Analysis, ScoringError } from './scoring';

export class StoreError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export interface GameRow {
  id: number;
  version: number;
  created_at: string;
  updated_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ':memory:') {
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    }
    this.db = new DatabaseSync(dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS throws (
        game_id INTEGER NOT NULL REFERENCES games(id),
        seq INTEGER NOT NULL,
        pins INTEGER NOT NULL,
        PRIMARY KEY (game_id, seq)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL,
        version INTEGER NOT NULL,
        type TEXT NOT NULL,
        detail TEXT NOT NULL,
        at TEXT NOT NULL
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  private now(): string {
    return new Date().toISOString();
  }

  createGame(): GameRow {
    const at = this.now();
    const r = this.db
      .prepare('INSERT INTO games (version, created_at, updated_at) VALUES (0, ?, ?)')
      .run(at, at);
    const id = Number(r.lastInsertRowid);
    this.logEvent(id, 0, 'create', {});
    return this.getGameRow(id);
  }

  getGameRow(id: number): GameRow {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as
      | GameRow
      | undefined;
    if (!row) throw new StoreError('GAME_NOT_FOUND', `局 ${id} 不存在`, 404);
    return row;
  }

  getThrows(id: number): number[] {
    this.getGameRow(id);
    const rows = this.db
      .prepare('SELECT pins FROM throws WHERE game_id = ? ORDER BY seq')
      .all(id) as { pins: number }[];
    return rows.map((r) => r.pins);
  }

  getEvents(id: number): unknown[] {
    this.getGameRow(id);
    return this.db
      .prepare('SELECT id, version, type, detail, at FROM events WHERE game_id = ? ORDER BY id')
      .all(id)
      .map((row) => {
        const r = row as { detail: string };
        return { ...r, detail: JSON.parse(r.detail) };
      });
  }

  private logEvent(gameId: number, version: number, type: string, detail: unknown): void {
    this.db
      .prepare('INSERT INTO events (game_id, version, type, detail, at) VALUES (?, ?, ?, ?, ?)')
      .run(gameId, version, type, JSON.stringify(detail), this.now());
  }

  private checkVersion(id: number, expectedVersion: number | undefined): GameRow {
    const row = this.getGameRow(id);
    if (expectedVersion !== undefined && expectedVersion !== row.version) {
      throw new StoreError(
        'VERSION_CONFLICT',
        `版本冲突: 期望 ${expectedVersion}，当前 ${row.version}，请重新查询后重试`,
        409
      );
    }
    return row;
  }

  // 原子追加一批投球；任一不合法则整批回滚。
  appendThrows(id: number, pinsList: number[], expectedVersion?: number): Analysis {
    const row = this.checkVersion(id, expectedVersion);
    const current = this.getThrows(id);
    // 先在内存中对完整新序列逐球校验，再落库
    const next = [...current];
    for (const pins of pinsList) {
      validateAppend(next, pins);
      next.push(pins);
    }
    const version = row.version + 1;
    this.db.exec('BEGIN');
    try {
      let seq = current.length;
      const stmt = this.db.prepare('INSERT INTO throws (game_id, seq, pins) VALUES (?, ?, ?)');
      for (const pins of pinsList) {
        stmt.run(id, ++seq, pins);
      }
      this.db
        .prepare('UPDATE games SET version = ?, updated_at = ? WHERE id = ?')
        .run(version, this.now(), id);
      this.logEvent(id, version, 'append', { pins: pinsList });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return analyze(next);
  }

  undoLast(id: number, expectedVersion?: number): Analysis {
    const row = this.checkVersion(id, expectedVersion);
    const current = this.getThrows(id);
    if (current.length === 0) {
      throw new StoreError('NOTHING_TO_UNDO', '没有可撤销的投球', 400);
    }
    const removed = current[current.length - 1];
    const version = row.version + 1;
    this.db.exec('BEGIN');
    try {
      this.db
        .prepare('DELETE FROM throws WHERE game_id = ? AND seq = ?')
        .run(id, current.length);
      this.db
        .prepare('UPDATE games SET version = ?, updated_at = ? WHERE id = ?')
        .run(version, this.now(), id);
      this.logEvent(id, version, 'undo', { removed });
      this.db.exec('COMMIT');
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
    return analyze(current.slice(0, -1));
  }

  // 导入完整投球序列，创建新局。
  importThrows(pinsList: number[]): { game: GameRow; analysis: Analysis } {
    const seq: number[] = [];
    for (const pins of pinsList) {
      validateAppend(seq, pins);
      seq.push(pins);
    }
    const game = this.createGame();
    const analysis = this.appendThrows(game.id, pinsList, 0);
    return { game: this.getGameRow(game.id), analysis };
  }

  scorecard(id: number): { game: GameRow; throws: number[]; analysis: Analysis } {
    const game = this.getGameRow(id);
    const throws = this.getThrows(id);
    return { game, throws, analysis: analyze(throws) };
  }
}

export function defaultDbPath(): string {
  const dir = process.env.BOWLING_DATA_DIR || path.join(process.cwd(), 'data');
  return path.join(dir, 'bowling.db');
}

export { ScoringError };
