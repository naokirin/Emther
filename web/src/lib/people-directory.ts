// docs/memo.md の設計に対応:
// 「個人名は人間に見せるときは実名で表示したいが、外部LLMに渡すときにはマスクしたい。
//   ID:名前の対応表はローカルのみが読める場所に持ち、外部送信前にIDへ置換、
//   表示時にはプログラムでID→名前に戻す」
//
// この対応表は`~/.local/state/em-ai-team-secure/people-directory.json`（所有者のみ
// 読み書き可能、0700/0600）にのみ存在し、外部LLM（claude -p 等）には絶対に渡さない。
// 個人情報の分離（ユーザー指摘対応）: 当初は`.data/people-directory.json`（プロジェクト
// ディレクトリ配下）に置いていたが、このリポジトリがvirtiofs（Lima VM共有フォルダ）上に
// あり、そこではUnixパーミッションが実効的に機能しないことを実機検証で確認した。また
// cursor-agentの`--workspace`サンドボックスは絶対パス指定のファイル読み取りを防げない
// （こちらも実機検証済み）ため、「プロジェクトディレクトリの外・非virtiofsな場所」へ
// 物理的に移設した。これにより、(1) cursor-agentのworkspace探索・相対パス推測から
// 完全に切り離され、(2) 将来的にOSユーザー分離を追加する場合に実際にパーミッションが
// 機能する場所になっている。
// 名前の登録元は現状 journal-store.ts（ローカルモデルによる人物抽出）と
// agent-runtime.ts（クラウドに送る直前のローカルNERによる検出）の2箇所。

import { loadSecureJSON, saveSecureJSON } from "@/lib/persistence";
import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";

type PersistedState = {
  entries: [string, string][]; // [name, id][]
  counter: number;
};

const initial = loadSecureJSON<PersistedState>("people-directory.json", { entries: [], counter: 0 });

const nameToId = new Map<string, string>(initial.entries);
const idToName = new Map<string, string>(initial.entries.map(([name, id]) => [id, name]));
let counter = initial.counter;

function persist(): void {
  saveSecureJSON("people-directory.json", { entries: Array.from(nameToId.entries()), counter });
}

export type PersonRecord = { id: string; name: string };

export function registerName(name: string): string {
  const trimmed = name.trim();
  const existing = nameToId.get(trimmed);
  if (existing) return existing;

  counter += 1;
  const id = `PERSON_${counter}`;
  nameToId.set(trimmed, id);
  idToName.set(id, trimmed);
  persist();
  return id;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// 複数の置換対象を「元のテキストに対する1回のスキャン」で同時に置換するための
// ヘルパー。逐次split/joinで置換していく方式だと、後段の置換対象が直前までに
// 挿入済みの置換後文字列（例: "PERSON_1"）の内部に部分一致してしまい、自己破壊的に
// 壊れることがある——実際に、1文字だけの誤登録名（ローカルモデルの抽出ミスによる
// "P" 等）が既に挿入済みの"PERSON_10"のような文字列の内部の"P"に一致し、
// 二重に置換されて文字列が破損する不具合が実機で発生した。String.replace()の
// コールバックは元の文字列上の一致箇所に対してのみ呼ばれ、置換後の文字列を
// 再スキャンしないため、この自己破壊が起きない。
function replaceAllAtOnce(text: string, mapping: Map<string, string>): string {
  const keys = [...mapping.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return text;
  const pattern = new RegExp(keys.map(escapeRegExp).join("|"), "g");
  return text.replace(pattern, (match) => mapping.get(match) ?? match);
}

// 名前をIDに置換する。同じ長さ・重なり合う候補がある場合は長い名前を優先する
// （例: "Aさん"と"A"を両方登録していても、"Aさん"が先に一致する）。
export function maskNames(text: string): string {
  return replaceAllAtOnce(text, nameToId);
}

// IDを実名に戻す。IDは"PERSON_1", "PERSON_10", "PERSON_11"のように採番されるため、
// 短いID文字列は長いIDの文字列としてのprefixになりうるが、1回のスキャンで
// 最長一致を優先するため、この衝突も発生しない。
export function unmaskNames(text: string): string {
  return replaceAllAtOnce(text, idToName);
}

export function listPeople(): PersonRecord[] {
  return [...nameToId.entries()].map(([name, id]) => ({ id, name }));
}

// registerNameと違い、未登録の名前に対して新規IDを発行しない（副作用のない参照専用）。
// 読み取り専用API（例: 人物名でのフィルタ検索）が、未知の名前を渡されただけで
// people-directoryに新規登録してしまう事故を防ぐ。
export function getPersonId(name: string): string | undefined {
  return nameToId.get(name.trim());
}

// 個人情報の分離の「保証する仕組み」（ユーザー指摘対応）。ここまでの対応（保存前マスク・
// クラウド応答の非アンマスク化）はすべて「呼び出し側が正しく実装している」という規律に
// 依存しており、技術的に強制する仕組みではなかった——実際、このセッション中に発見した
// maskNames/unmaskNamesの自己破壊バグや、Journalのtagsへの人物名混入は、まさに
// 「規律だけに頼った安全性」が破れた実例である。
// この関数は、外部（claude/agy/cursor-agent）へ実際に送信する直前のテキストに対して
// 呼び出す「最後の砦」のチェックで、登録済みの実名が1件でも部分文字列として
// 残っていたら例外を投げて送信そのものを止める。マスク処理のどこかに将来バグが
// 入っても、この関数さえ送信直前に必ず呼ばれていれば、実名が外部へ出ることは無い
// （「マスクし忘れない」ではなく「実名が残っていたら物理的に送れない」という保証）。
// 登録人数は数百人規模までしか想定していない（単一ローカルEM利用のスケール）ため、
// 毎ターンの線形スキャンで性能上の問題にはならない。
export function assertNoRealNamesLeaked(text: string): void {
  for (const name of nameToId.keys()) {
    if (name && text.includes(name)) {
      throw new Error("実名が外部送信直前のテキストに含まれていたため送信を中止しました（詳細はログに残しません）。");
    }
  }
}

// 重要な設計変更: 「保存する前にマスクする」ための唯一の入口。個人名（実名）に触れて
// よいのはこのファイル（people-directory.ts、`.data/people-directory.json`はローカル
// ディスクにのみ存在し外部LLMには絶対に渡さない）と、ダッシュボード表示のためのAPI応答
// 組み立て層だけ、という原則をコード上で強制する。ローカルNERで新規の名前を検出・登録し、
// 既知の名前をすべてIDへ置換したテキストを返す。呼び出し側（journal-store.ts,
// issue-store.ts, org-context-store.ts, agent-runtime.ts）は、この関数が返した
// マスク済みテキストだけをSQLite/`.data/*.json`へ保存する（生の実名を保存してはならない）。
const NAME_EXTRACTION_SYSTEM_PROMPT = [
  "入力テキストに含まれる人物名だけをJSON形式で出力してください。説明や前置きは一切書かず、JSONオブジェクト1つだけを出力すること。",
  'フォーマット: {"people": string[]}',
  "敬称はそのまま残すこと（例: Aさん）。人物が見当たらなければ空配列にすること。",
].join("\n");

async function detectAndRegisterNames(text: string): Promise<void> {
  try {
    const content = await runLocalChat(
      [
        { role: "system", content: NAME_EXTRACTION_SYSTEM_PROMPT },
        { role: "user", content: "経営会議。Q3のリリース日が前倒しになった。" },
        { role: "assistant", content: JSON.stringify({ people: [] }) },
        { role: "user", content: "CさんのPRレビューが速い。" },
        { role: "assistant", content: JSON.stringify({ people: ["Cさん"] }) },
        { role: "user", content: text },
      ],
      100,
    );
    const jsonText = extractFirstJsonObject(content);
    if (!jsonText) return;
    const parsed = JSON.parse(jsonText);
    if (Array.isArray(parsed.people)) {
      for (const p of parsed.people) {
        if (typeof p === "string" && p.trim()) registerName(p);
      }
    }
  } catch {
    // ローカルNERの失敗は握りつぶす。既知の名前のマスクは引き続き有効なので、
    // 「新規の名前だけ検出できない」という劣化に留まる。
  }
}

export async function maskForStorage(text: string): Promise<string> {
  await detectAndRegisterNames(text);
  return maskNames(text);
}
