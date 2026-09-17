import { loadJSON, saveJSON } from "@/lib/persistence";

// Journal集約解釈の「漏れ防止」用ウォーターマークと、日次スロットクレームの永続化。
// 材料窓は実行時 rolling 24h ではなく lastCoveredAt 以降（最大7日）にする。
// startRun は runClaudeTurn を非同期起動するため、ウォーターマークを先に進めても
// プロンプト組み立てが後になる。beginJournalBatchWindow() で「今回の窓」を
// メモリ＋JSONにフリーズし、buildJournalBatchContextBlock / decideRun 再注入でも使う。

export const JOURNAL_BATCH_MAX_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
export const JOURNAL_BATCH_FALLBACK_WINDOW_MS = 24 * 60 * 60 * 1000;
export const JOURNAL_BATCH_LIMIT = 60;

const ALL_HOURS = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23];

export type JournalBatchPersisted = {
  /** claimedHours が属するローカル暦日 YYYY-MM-DD */
  date: string | null;
  /** その日に既に消化した設定時刻スロット（0〜23） */
  claimedHours: number[];
  /** 前回の集約解釈がカバーした時刻。次回 begin 時の sinceExclusive になる */
  lastCoveredAt: number | null;
  /** 進行中（または直近）の集約解釈の固定窓。プロセス再起動後の decideRun 再注入用 */
  activeSinceExclusive: number | null;
  activeUntil: number | null;
};

type RawJournalBatchFile = {
  date?: string | null;
  claimedHours?: unknown;
  lastCoveredAt?: unknown;
  activeSinceExclusive?: unknown;
  activeUntil?: unknown;
};

type ActiveBatchWindow = {
  /** null なら初回フォールバック（until から24h） */
  sinceExclusive: number | null;
  until: number;
};

let activeWindow: ActiveBatchWindow | null = null;

function normalizeClaimedHours(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  const hours = value
    .filter((h): h is number => typeof h === "number" && Number.isFinite(h))
    .map((h) => Math.min(23, Math.max(0, Math.round(h))));
  return [...new Set(hours)].sort((a, b) => a - b);
}

function asFiniteNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function loadJournalBatchPersisted(): JournalBatchPersisted {
  const raw = loadJSON<RawJournalBatchFile>("auto-journal-batch.json", {});
  const date = typeof raw.date === "string" ? raw.date : null;
  // 旧形式は { date } のみ。date が入っていれば「その日はもう実行済み」だったので全日スロット消化扱いにする。
  const claimedHours = Array.isArray(raw.claimedHours)
    ? normalizeClaimedHours(raw.claimedHours)
    : date
      ? [...ALL_HOURS]
      : [];
  return {
    date,
    claimedHours,
    lastCoveredAt: asFiniteNumberOrNull(raw.lastCoveredAt),
    activeSinceExclusive: asFiniteNumberOrNull(raw.activeSinceExclusive),
    activeUntil: asFiniteNumberOrNull(raw.activeUntil),
  };
}

export function saveJournalBatchPersisted(state: JournalBatchPersisted): void {
  saveJSON("auto-journal-batch.json", {
    date: state.date,
    claimedHours: normalizeClaimedHours(state.claimedHours),
    lastCoveredAt: state.lastCoveredAt,
    activeSinceExclusive: state.activeSinceExclusive,
    activeUntil: state.activeUntil,
  });
}

function resolveActiveWindow(): ActiveBatchWindow | null {
  if (activeWindow) return activeWindow;
  const state = loadJournalBatchPersisted();
  if (state.activeUntil == null) return null;
  return { sinceExclusive: state.activeSinceExclusive, until: state.activeUntil };
}

/** 集約解釈 run を起こす直前に呼び、材料窓を固定しつつウォーターマークを進める。 */
export function beginJournalBatchWindow(now = Date.now()): ActiveBatchWindow {
  const state = loadJournalBatchPersisted();
  const window: ActiveBatchWindow = { sinceExclusive: state.lastCoveredAt, until: now };
  activeWindow = window;
  saveJournalBatchPersisted({
    ...state,
    lastCoveredAt: now,
    activeSinceExclusive: window.sinceExclusive,
    activeUntil: window.until,
  });
  return window;
}

/** テスト用: アクティブな材料窓と永続化をリセットする。 */
export function resetJournalBatchWindowForTest(): void {
  activeWindow = null;
  saveJournalBatchPersisted({
    date: null,
    claimedHours: [],
    lastCoveredAt: null,
    activeSinceExclusive: null,
    activeUntil: null,
  });
}

/**
 * Journal が今回の集約解釈の対象かどうか。
 * beginJournalBatchWindow 済み（またはその永続化）なら固定窓を使う。
 * 未開始は lastCoveredAt／初回24h フォールバック。
 */
export function isJournalInBatchWindow(createdAt: number, now = Date.now()): boolean {
  const floor = now - JOURNAL_BATCH_MAX_WINDOW_MS;
  if (createdAt < floor) return false;

  const window = resolveActiveWindow();
  if (window) {
    if (createdAt > window.until) return false;
    if (window.sinceExclusive != null) return createdAt > window.sinceExclusive;
    return createdAt >= window.until - JOURNAL_BATCH_FALLBACK_WINDOW_MS;
  }

  const { lastCoveredAt } = loadJournalBatchPersisted();
  if (lastCoveredAt != null) return createdAt > lastCoveredAt;
  return createdAt >= now - JOURNAL_BATCH_FALLBACK_WINDOW_MS;
}
