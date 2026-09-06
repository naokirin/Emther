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

// 既知の名前を出現順（長い名前から）でIDに置換する。
// 例: "Aさん" と "A" を両方登録していても、先に長い方を置換することで部分一致による
// 意図しない置換（"A"が別の単語の一部に一致する等）の影響を減らす。
export function maskNames(text: string): string {
  if (nameToId.size === 0) return text;
  const names = [...nameToId.keys()].sort((a, b) => b.length - a.length);
  let masked = text;
  for (const name of names) {
    if (!name) continue;
    masked = masked.split(name).join(nameToId.get(name)!);
  }
  return masked;
}

// IDは"PERSON_1", "PERSON_2", ..., "PERSON_10", "PERSON_11"のように採番されるため、
// 短いID（例: "PERSON_1"）は長いID（例: "PERSON_11"）の文字列としてのprefixになる。
// 登録順（Mapの挿入順）にそのまま置換すると、"PERSON_1"が先に処理された場合
// "PERSON_11"の一部が誤って"PERSON_1"扱いで置換されてしまう（maskNamesが名前の長さで
// ソートしているのと同じ理由）。ID文字列の長さ降順で処理し、この衝突を防ぐ。
export function unmaskNames(text: string): string {
  if (idToName.size === 0) return text;
  const ids = [...idToName.keys()].sort((a, b) => b.length - a.length);
  let unmasked = text;
  for (const id of ids) {
    unmasked = unmasked.split(id).join(idToName.get(id)!);
  }
  return unmasked;
}

export function listPeople(): PersonRecord[] {
  return [...nameToId.entries()].map(([name, id]) => ({ id, name }));
}
