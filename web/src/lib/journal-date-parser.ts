// ユーザー依頼「忙しくて後からまとめて記録するパターンに、1個ずつの入力は辛い」への対応。
// まとめ入力のテキストから、行ごとの「出来事の発生日」を解決するための純粋関数群。
//
// 設計方針:
// - 固定フォーマットの入力は求めない。EMは自由に書いた行を並べるだけでよい。
// - 「その行だけで日付を表す行（例: 3/5 / 月曜 / 昨日）」だけを日付マーカーとして扱い、
//   それ以降の行はマーカーが更新されるまで同じ日付を引き継ぐ。日付を一切書かなければ
//   全行が「今日」のまま扱われる（＝これまでの単発投稿と同じ挙動に自然に収束する）。
// - 時刻までは求めない（危険なわりに得るものが小さい）。日付レベルの粒度に固定し、
//   常に「その日の正午」のタイムスタンプへ丸める（日またぎでのズレを避けるため）。
// - 誤ってマーカーとして解釈されるリスクを抑えるため、行「全体」が既知のパターンに
//   一致した場合だけマーカーとみなす（文中の日付らしき文字列には反応しない）。

const WEEKDAY_JA: Record<string, number> = { 日: 0, 月: 1, 火: 2, 水: 3, 木: 4, 金: 5, 土: 6 };

function startOfDay(ts: number): Date {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d;
}

function atNoon(d: Date): number {
  const c = new Date(d);
  c.setHours(12, 0, 0, 0);
  return c.getTime();
}

const DAY_MS = 24 * 60 * 60 * 1000;

// 行全体が日付マーカーとして解釈できる場合、その日の正午のタイムスタンプを返す。
// 解釈できなければundefined（＝マーカー行ではなく通常の内容行として扱う）。
export function parseDateMarkerLine(line: string, now: number): number | undefined {
  const s = line.trim();
  if (!s) return undefined;

  if (s === "今日") return atNoon(startOfDay(now));
  if (s === "昨日") return atNoon(startOfDay(now - DAY_MS));
  if (s === "一昨日" || s === "おととい") return atNoon(startOfDay(now - 2 * DAY_MS));

  // 曜日（例: 月 / 月曜 / 月曜日）。直近の過去（今日を含む）のその曜日を指す。
  const weekdayMatch = s.match(/^([日月火水木金土])(曜日|曜)?$/);
  if (weekdayMatch) {
    const target = WEEKDAY_JA[weekdayMatch[1]];
    const today = startOfDay(now);
    const diff = (today.getDay() - target + 7) % 7;
    return atNoon(new Date(today.getTime() - diff * DAY_MS));
  }

  // YYYY-MM-DD / YYYY/MM/DD
  const isoMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (isoMatch) {
    const [, y, mo, da] = isoMatch;
    const d = new Date(Number(y), Number(mo) - 1, Number(da), 12, 0, 0, 0);
    return d.getMonth() === Number(mo) - 1 ? d.getTime() : undefined; // 2/30等の桁あふれは無効扱い
  }

  // M/D（年省略＝今年扱い。それが未来日になる場合だけ去年にフォールバックする）
  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})$/);
  // M月D日（「日」は省略可）
  const kanjiMatch = s.match(/^(\d{1,2})月(\d{1,2})日?$/);
  const md = slashMatch ?? kanjiMatch;
  if (md) {
    const [, mo, da] = md;
    const year = new Date(now).getFullYear();
    let d = new Date(year, Number(mo) - 1, Number(da), 12, 0, 0, 0);
    if (d.getMonth() !== Number(mo) - 1) return undefined;
    if (d.getTime() > now + DAY_MS) {
      d = new Date(year - 1, Number(mo) - 1, Number(da), 12, 0, 0, 0);
    }
    return d.getTime();
  }

  return undefined;
}

// タイムスタンプを<input type="date">の値（"YYYY-MM-DD"・ローカル時刻基準）に変換する。
// クライアント側（校正フォームの初期値表示）でも使うため、Node専用APIには依存しない。
export function timestampToDateInputValue(ts: number): string {
  const d = new Date(ts);
  const y = d.getFullYear();
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${y}-${mo}-${da}`;
}

// <input type="date">が返す"YYYY-MM-DD"を、その日の正午のタイムスタンプへ変換する。
// APIルート側で単発投稿・校正の両方から共通で使う（日付レベルの粒度を一貫させるため）。
export function dateStringToNoonTimestamp(dateStr: string): number | undefined {
  const m = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return undefined;
  const [, y, mo, da] = m;
  const d = new Date(Number(y), Number(mo) - 1, Number(da), 12, 0, 0, 0);
  return d.getMonth() === Number(mo) - 1 ? d.getTime() : undefined;
}

export type BulkParsedLine = { text: string; occurredAt: number };

// テキスト全体を「1行＝1つの出来事」として分解し、各行に発生日（正午タイムスタンプ）を
// 割り当てる。maxLinesを超える行は無視する（ローカルモデルへの逐次投げ込みが
// 現実的な時間で終わるようにするための安全弁）。
export function parseBulkJournalText(rawText: string, now: number, maxLines = 40): BulkParsedLine[] {
  const lines = rawText
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  let currentDate = atNoon(startOfDay(now));
  const result: BulkParsedLine[] = [];
  for (const line of lines) {
    const marker = parseDateMarkerLine(line, now);
    if (marker !== undefined) {
      currentDate = marker;
      continue;
    }
    result.push({ text: line, occurredAt: currentDate });
    if (result.length >= maxLines) break;
  }
  return result;
}
