import { DatabaseSync } from "node:sqlite";
import { dataFilePath } from "@/lib/persistence";

// docs/memo.md「H: 永続化データモデルの設計」対応。半年〜1年単位で単調に増え続ける
// データ（Journal/KnowledgeEvent、Agent Runの実行ログ）を、書き込みのたびにファイル全体を
// 書き直すJSON配列（loadJSON/saveJSON）で持ち続けるのは長期的に破綻するため、SQLiteへ移す。
// Node 22+に組み込まれている`node:sqlite`（DatabaseSync）を使うため、追加npm依存は無い。
// 単一ローカルユーザー・単一プロセス前提であり、分散DBやサーバープロセスは不要と判断している
// （数百万レコード規模に達するには何年もかかる想定のため、過剰な設計は避ける）。

let db: DatabaseSync | undefined;

export function getDb(): DatabaseSync {
  if (db) return db;
  db = new DatabaseSync(dataFilePath("app.db"));
  // `next build`のページデータ収集は（動的ルートであっても）モジュール評価のためにこのファイルを
  // importし、開発サーバーが同じ.data/app.dbを開いたままの状態と鉢合わせすることがある。
  // busy_timeoutを設定し、一時的なロック競合では即座にエラーにせず数秒リトライさせる。
  db.exec("PRAGMA busy_timeout = 5000;");
  db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}

// `next build`はページデータ収集を複数ワーカー（別プロセス）で並行実行し、それぞれが
// このファイルを独立にimportして`getDb()`を呼ぶため、複数プロセスがほぼ同時に
// 同じ`.data/app.db`へマイグレーションを試みることがある。事前にcolumnExists()で
// 存在確認しても、確認後・ALTER実行前に別プロセスが追加してしまうTOCTOUの余地が残るため、
// ALTER TABLE自体をtry/catchし「既に存在する」エラーは無視することで冪等にする。
function addColumnIfMissing(database: DatabaseSync, table: string, column: string, type: string): void {
  try {
    database.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${type};`);
  } catch (err) {
    const message = (err as Error).message ?? "";
    if (!message.includes("duplicate column name")) throw err;
  }
}

function migrate(database: DatabaseSync): void {
  // kind: 'fact'（起きた出来事そのもの） | 'interpretation'（そこから導いた長期的な解釈）
  // context: 'official' | 'observation' | 'casual' | 'complaint' | 'profile'
  // occurred_at: 実世界でその内容が真だった時点（valid time）
  // recorded_at: システムがこれを記録した時点（transaction time）— バイテンポラルのもう一方の軸
  // ttl_days: 現在の判断にどれだけの期間重みを持たせるか。NULL=長期有効（解釈・公式方針など）
  //           イベント自体は消さない。TTLは「重み」の話であり「削除」の話ではない。
  database.exec(`
    CREATE TABLE IF NOT EXISTS knowledge_events (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      context TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      people_json TEXT NOT NULL,
      text TEXT NOT NULL,
      tags_json TEXT NOT NULL,
      urgency TEXT,
      sentiment TEXT,
      summary TEXT,
      occurred_at INTEGER NOT NULL,
      recorded_at INTEGER NOT NULL,
      ttl_days INTEGER,
      supersedes TEXT,
      source_journal_id TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_knowledge_events_occurred_at ON knowledge_events(occurred_at);
    CREATE INDEX IF NOT EXISTS idx_knowledge_events_entity_type ON knowledge_events(entity_type);
    CREATE INDEX IF NOT EXISTS idx_knowledge_events_kind ON knowledge_events(kind);
  `);

  // docs/memo.md「H: Phase 2」対応。人物についてのイベント（peopleで名前を持つ）だけでなく、
  // Issue/Teamの変更履歴（entityType: "issue"|"team"）も同じテーブルで管理するため、
  // 対象を一意に指すentity_idを追加する。CREATE TABLE IF NOT EXISTSは既存テーブルには
  // 列を足さないため、既存DBに対しては明示的にALTER TABLEする（無ければ追加、あれば何もしない）。
  addColumnIfMissing(database, "knowledge_events", "entity_id", "TEXT");
  database.exec("CREATE INDEX IF NOT EXISTS idx_knowledge_events_entity_id ON knowledge_events(entity_id);");

  // docs/memo.md「H: Phase 3」対応。意味的な類似度検索用の埋め込みベクトル（JSON配列として
  // 保存）。この規模（単一ローカルユーザー）ではブルートフォースのコサイン類似度計算で
  // 十分高速なため、専用のベクトルインデックス拡張は導入しない。埋め込みが無いイベント
  // （Issue/Teamの変更履歴等）はNULLのままでよい。
  addColumnIfMissing(database, "knowledge_events", "embedding_json", "TEXT");

  // Agent Runは「run単位のメタデータ（低頻度更新）」と「ログ行（高頻度追記）」を分けることで、
  // 従来のように標準出力1行ごとに全run・全ログを含むJSONファイル全体を書き直す必要をなくす。
  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_runs (
      id TEXT PRIMARY KEY,
      agent_name TEXT NOT NULL,
      task TEXT NOT NULL,
      status TEXT NOT NULL,
      session_id TEXT,
      yield_request_json TEXT,
      proposal_json TEXT,
      total_cost_usd REAL NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      consulted_by TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_agent_runs_updated_at ON agent_runs(updated_at);

    CREATE TABLE IF NOT EXISTS agent_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      channel TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_logs_run_id ON agent_run_logs(run_id);
  `);
}
