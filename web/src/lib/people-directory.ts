// docs/memo.md の設計に対応:
// 「個人名は人間に見せるときは実名で表示したいが、外部LLMに渡すときにはマスクしたい。
//   ID:名前の対応表はローカルのみが読める場所に持ち、外部送信前にIDへ置換、
//   表示時にはプログラムでID→名前に戻す」
//
// この対応表はプロセス内メモリにのみ存在し、外部LLM（claude -p 等）には絶対に渡さない。
// 名前の登録元は現状 journal-store.ts（ローカルモデルによる人物抽出）と
// agent-runtime.ts（クラウドに送る直前のローカルNERによる検出）の2箇所。

const nameToId = new Map<string, string>();
const idToName = new Map<string, string>();
let counter = 0;

export type PersonRecord = { id: string; name: string };

export function registerName(name: string): string {
  const trimmed = name.trim();
  const existing = nameToId.get(trimmed);
  if (existing) return existing;

  counter += 1;
  const id = `PERSON_${counter}`;
  nameToId.set(trimmed, id);
  idToName.set(id, trimmed);
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

export function unmaskNames(text: string): string {
  if (idToName.size === 0) return text;
  let unmasked = text;
  for (const [id, name] of idToName) {
    unmasked = unmasked.split(id).join(name);
  }
  return unmasked;
}

export function listPeople(): PersonRecord[] {
  return [...nameToId.entries()].map(([name, id]) => ({ id, name }));
}
