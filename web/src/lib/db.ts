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

/** 復元／リセット前に呼ぶ。開いている SQLite 接続を閉じ、次の getDb() で再オープンできるようにする。 */
export function closeDb(): void {
  if (!db) return;
  const current = db;
  db = undefined;
  try {
    current.close();
  } catch {
    // 既に閉じている等は無視
  }
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

  // docs/em_human_story_and_ux.md 改修依頼「Journalをurgency:highのまま解決済みにできない
  // （Issueを立てても表示上ずっと未対応に見える）」対応。urgencyは「起きた出来事自体の
  // 深刻さ」を表す記録であり、後から書き換えるべきではないため、別軸として「この件は
  // 今どこで管理されているか」を持たせる。resolved_issue_idはIssue化した場合の紐付け、
  // resolution_noteはIssue化せずメモだけで解決とする場合の自由記述（他の自由記述と同じく
  // 保存前にmaskForStorageを通す）。他のJournal編集項目と同様、supersedesチェーンで
  // 引き継がれる。
  addColumnIfMissing(database, "knowledge_events", "resolved_issue_id", "TEXT");
  addColumnIfMissing(database, "knowledge_events", "resolution_note", "TEXT");

  // Journal→チームの明示紐付け（複数可）。people（人物）と同様に配列JSONで持つ。
  // 未マイグレーション行は NULL とし、読み出し時に [] へ正規化する。
  addColumnIfMissing(database, "knowledge_events", "team_ids_json", "TEXT");

  // docs/observation_dump_journal.md: Observation Dump 由来 Journal の弱いリンク。
  addColumnIfMissing(database, "knowledge_events", "source_dump_id", "TEXT");
  addColumnIfMissing(database, "knowledge_events", "source_chunk_id", "TEXT");

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
  `);

  // docs/memo.md「Claude Codeが使えない場合はagy経由でフォールバックする」対応。
  // agyの会話継続（--conversation <id>）はclaudeのsession_idとは別のID空間なので、
  // 同じrunでも「claudeのsessionId」と「agyの会話id」を別々のカラムで持つ。
  addColumnIfMissing(database, "agent_runs", "agy_conversation_id", "TEXT");

  // docs/memo.md「サポートするAIエージェントCLIにCursor CLIを追加する」対応。
  // cursor-agentの会話継続（--resume <session_id>）もclaudeのsessionId・agyの
  // conversation_idとは別のID空間なので、専用のカラムで持つ。
  addColumnIfMissing(database, "agent_runs", "cursor_session_id", "TEXT");

  // docs/first_implession 3.6「トリガー（起動条件）」対応。起動要因（人間駆動/イベント駆動/
  // バッチ駆動）と、AI主導のrunをEMがまだレビューしたかどうかを持つ。
  addColumnIfMissing(database, "agent_runs", "origin", "TEXT");
  addColumnIfMissing(database, "agent_runs", "reviewed", "INTEGER");

  // docs/first_implession 3.8「壁打ちによるState更新」対応。AIが提案するAction Itemsの下書き。
  addColumnIfMissing(database, "agent_runs", "suggested_action_items_json", "TEXT");

  // docs/memo.md「B. 何でも相談↔Issueの昇格物語」対応。reviewedは「EMが確認したか」の
  // 1bitしか持たず、「様子見」と「却下」を区別できなかったため、別カラムで判定を分ける。
  addColumnIfMissing(database, "agent_runs", "triage_status", "TEXT");

  // docs/em_human_story_and_ux.md P0-3「様子見にウォッチリスト＋期限／再浮上」対応。
  // 「様子見」に決めた時刻を持たせ、一定期間たっても放置されている項目を
  // 「次にすべきこと」へ再浮上させられるようにする。
  addColumnIfMissing(database, "agent_runs", "triage_at", "INTEGER");

  // docs/memo.md「K. ズームイン／ズームアウトの協働計画」対応。AIが提案する子Issue分解案の下書き。
  addColumnIfMissing(database, "agent_runs", "suggested_sub_issues_json", "TEXT");

  // ユーザー依頼「Journal等からIssueを生成する際、AIエージェントチームに内容を埋めさせる」
  // 対応。AIが提案するWhy/What/Howの下書き（未整理の項目のみ埋める提案。既存の
  // suggested_action_items_json/suggested_sub_issues_jsonと同じHuman-in-the-Loop設計）。
  addColumnIfMissing(database, "agent_runs", "suggested_charter_json", "TEXT");

  // AIが提案する介入優先度（focus/normal/parked）の下書き。採用までIssue本体へは反映しない。
  addColumnIfMissing(database, "agent_runs", "suggested_priority_json", "TEXT");

  // docs/knowledge_distillation.md。状況蒸留のテーマ解釈下書き。
  addColumnIfMissing(database, "agent_runs", "suggested_themes_json", "TEXT");

  // Journal自動分析・Journalからの手動相談で、生成元Journalへ戻れるようにする。
  // origin=auto-anomaly だけでは ID が残らず、相談画面で「なぜ生まれたか」が分からなかった。
  addColumnIfMissing(database, "agent_runs", "source_journal_id", "TEXT");

  database.exec(`
    CREATE TABLE IF NOT EXISTS agent_run_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT NOT NULL,
      ts INTEGER NOT NULL,
      channel TEXT NOT NULL,
      text TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_agent_run_logs_run_id ON agent_run_logs(run_id);
  `);

  // docs/memo.md TODO「Quick Journal、Issue進捗、各種イベントを週次・月次でレポーティングする
  // 機能を追加する。レポートを一過性とせず、蓄積して過去のものも参照できるようにする」対応。
  // 生成のたびにその場で再計算するだけの画面にはせず、生成結果（stats_json）自体を
  // スナップショットとして保存する。Issueのアーカイブ等、後から状態が変わるデータを
  // 元に算出しているため、「生成した時点でEMに何が見えていたか」を再計算せず保持することを
  // 優先している。noteはEMが後から追記できる所感欄（生成後に育つ唯一のフィールド）。
  database.exec(`
    CREATE TABLE IF NOT EXISTS reports (
      id TEXT PRIMARY KEY,
      period_type TEXT NOT NULL,
      period_start INTEGER NOT NULL,
      period_end INTEGER NOT NULL,
      generated_at INTEGER NOT NULL,
      stats_json TEXT NOT NULL,
      note TEXT NOT NULL DEFAULT ''
    );
    CREATE INDEX IF NOT EXISTS idx_reports_period_end ON reports(period_end);
  `);

  // docs/value_hierarchy_and_flow.md §5。Journal → 日常の評価ログ（A/B・仮置き）。
  database.exec(`
    CREATE TABLE IF NOT EXISTS person_evaluation_logs (
      id TEXT PRIMARY KEY,
      person_id TEXT NOT NULL,
      lens TEXT NOT NULL,
      status TEXT NOT NULL,
      polarity TEXT NOT NULL,
      source_journal_id TEXT NOT NULL,
      target_objective_id TEXT,
      target_key_result_id TEXT,
      value_snapshot TEXT,
      snapshot_text TEXT NOT NULL,
      rationale TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_person_eval_person ON person_evaluation_logs(person_id);
    CREATE INDEX IF NOT EXISTS idx_person_eval_journal ON person_evaluation_logs(source_journal_id);
  `);
}
