// SQLite 持久层：投球逐条追加保存，局版本号用于乐观并发控制。
import { DatabaseSync } from 'node:sqlite';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { scorecard, Scorecard, ScoringError, validateRolls } from './scoring';

export class StoreError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
  }
}

export interface GameRow {
  id: number;
  version: number;
  finished: number;
  final_score: number | null;
  created_at: string;
}

export class Store {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const file = dbPath ?? path.join(dataDir(), 'bowling.db');
    fs.mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS games (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        version INTEGER NOT NULL DEFAULT 0,
        finished INTEGER NOT NULL DEFAULT 0,
        final_score INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE IF NOT EXISTS rolls (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        game_id INTEGER NOT NULL REFERENCES games(id),
        seq INTEGER NOT NULL,
        pins INTEGER NOT NULL,
        UNIQUE(game_id, seq)
      );
    `);
  }

  close(): void {
    this.db.close();
  }

  createGame(): GameRow {
    this.db.prepare('INSERT INTO games DEFAULT VALUES').run();
    const row = this.db.prepare('SELECT * FROM games ORDER BY id DESC LIMIT 1').get() as unknown as GameRow;
    return row;
  }

  getGame(id: number): GameRow {
    const row = this.db.prepare('SELECT * FROM games WHERE id = ?').get(id) as unknown as GameRow | undefined;
    if (!row) throw new StoreError('NOT_FOUND', `局 ${id} 不存在`, 404);
    return row;
  }

  getRolls(gameId: number): number[] {
    const rows = this.db
      .prepare('SELECT pins FROM rolls WHERE game_id = ? ORDER BY seq')
      .all(gameId) as unknown as { pins: number }[];
    return rows.map(r => r.pins);
  }

  // 原子追加一批投球；expectedVersion 提供时做乐观锁校验。失败整批回滚。
  appendRolls(gameId: number, pinsList: number[], expectedVersion?: number): Scorecard {
    this.getGame(gameId);
    const existing = this.getRolls(gameId);
    const combined = [...existing, ...pinsList];
    try {
      validateRolls(combined); // 先整体校验，保证不会留下半批
    } catch (e) {
      if (e instanceof ScoringError) throw new StoreError(e.code, e.message, 422);
      throw e;
    }
    const card = scorecard(combined);

    this.db.exec('BEGIN IMMEDIATE');
    try {
      let changes: number;
      if (expectedVersion !== undefined) {
        const r = this.db
          .prepare('UPDATE games SET version = version + 1 WHERE id = ? AND version = ?')
          .run(gameId, expectedVersion);
        changes = Number(r.changes);
        if (changes === 0) {
          throw new StoreError(
            'VERSION_CONFLICT',
            `版本冲突：期望 version=${expectedVersion}，请重新查询后再追加`,
            409,
          );
        }
      } else {
        this.db.prepare('UPDATE games SET version = version + 1 WHERE id = ?').run(gameId);
      }
      const insert = this.db.prepare('INSERT INTO rolls (game_id, seq, pins) VALUES (?, ?, ?)');
      pinsList.forEach((pins, k) => insert.run(gameId, existing.length + k + 1, pins));
      if (card.complete) {
        this.db.prepare('UPDATE games SET finished = 1, final_score = ? WHERE id = ?')
          .run(card.totalScore, gameId);
      }
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return card;
  }

  // 撤销最后一球（仅末尾撤销，不做任意插入）。
  undoLast(gameId: number): Scorecard {
    this.getGame(gameId);
    const rolls = this.getRolls(gameId);
    if (rolls.length === 0) throw new StoreError('EMPTY_GAME', '本局还没有投球，无法撤销', 422);
    this.db.exec('BEGIN IMMEDIATE');
    try {
      this.db.prepare('DELETE FROM rolls WHERE game_id = ? AND seq = ?').run(gameId, rolls.length);
      this.db.prepare('UPDATE games SET version = version + 1, finished = 0, final_score = NULL WHERE id = ?')
        .run(gameId);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    return scorecard(rolls.slice(0, -1));
  }

  // 从投球序列导入为新局（整体校验后一次性写入）。
  importGame(rolls: number[]): { game: GameRow; card: Scorecard } {
    try {
      validateRolls(rolls);
    } catch (e) {
      if (e instanceof ScoringError) throw new StoreError(e.code, e.message, 422);
      throw e;
    }
    const game = this.createGame();
    const card = this.appendRolls(game.id, rolls);
    return { game: this.getGame(game.id), card };
  }

  scorecard(gameId: number): Scorecard {
    this.getGame(gameId);
    return scorecard(this.getRolls(gameId));
  }

  version(gameId: number): number {
    return this.getGame(gameId).version;
  }
}

export function dataDir(): string {
  return process.env.BOWLING_DATA_DIR ?? path.join(process.cwd(), 'data');
}
