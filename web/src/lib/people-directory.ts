// docs/memo.md の設計に対応:
// 「個人名は人間に見せるときは実名で表示したいが、外部LLMに渡すときにはマスクしたい。
//   ID:名前の対応表はローカルのみが読める場所に持ち、外部送信前にIDへ置換、
//   表示時にはプログラムでID→名前に戻す」
//
// この対応表は`.data/people-directory.json`（ローカルファイル）にのみ存在し、
// 外部LLM（claude -p 等）には絶対に渡さない。ファイルに書き出してもローカルディスクに
// 保存されるだけなので、memo.mdが要求する「ローカルのみが読める場所」という条件は保ったまま、
// プロセス再起動をまたいで対応関係が失われないようにしている。
// 名前の登録元は現状 journal-store.ts（ローカルモデルによる人物抽出）と
// agent-runtime.ts（クラウドに送る直前のローカルNERによる検出）の2箇所。

import { loadJSON, saveJSON } from "@/lib/persistence";

type PersistedState = {
  entries: [string, string][]; // [name, id][]
  counter: number;
};

const initial = loadJSON<PersistedState>("people-directory.json", { entries: [], counter: 0 });

const nameToId = new Map<string, string>(initial.entries);
const idToName = new Map<string, string>(initial.entries.map(([name, id]) => [id, name]));
let counter = initial.counter;

function persist(): void {
  saveJSON("people-directory.json", { entries: Array.from(nameToId.entries()), counter });
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
