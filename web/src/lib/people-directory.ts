// docs/memo.md の設計に対応:
// 「個人名は人間に見せるときは実名で表示したいが、外部LLMに渡すときにはマスクしたい。
//   ID:名前の対応表はローカルのみが読める場所に持ち、外部送信前にIDへ置換、
//   表示時にはプログラムでID→名前に戻す」
//
// この対応表は`~/.local/state/emther/secure/people-directory.json`（所有者のみ
// 読み書き可能、0700/0600）にのみ存在し、外部LLM（claude -p 等）には絶対に渡さない。
// 個人情報の分離（ユーザー指摘対応）: 当初はプロジェクト配下の`.data/`、次いで
// `~/.local/state/em-ai-team-secure/`、その後 `em-ai-team/secure` に置いていたが、
// 配布方針（docs/packaging.md）に合わせ業務データと同根の `emther/secure` へ移した
// （旧配置からは自動移行）。
// virtiofs 上では Unix パーミッションが実効的でないこと、cursor-agent の
// `--workspace` が絶対パス読み取りを防げないことは実機検証済みのため、
// プロジェクト外・権限が効く場所に置く方針は維持する。
// 名前の登録元は、チームメンバー追加・Journal校正でEMが明示した人物・People画面／
// ヘッダーのクイック追加・人名候補ダイアログでの「人名として登録」に限定する。
// 人名候補検出の結果では自動登録しない（誤登録が assertNoRealNamesLeaked を誤発火
// させ Agent 送信を止めるため）。
// 方針: 名簿の事前登録が正。未登録語句で処理を止めない（既定では確認ゲートを走らせない）。
// 候補検出は allowUnmaskedCandidates / registerNameCandidates の明示オプトイン時だけ使う
// （実装は name-candidate-detect＝mask-check と同系統）。

import { loadSecureJSON, peekSecureJSON, saveSecureJSON } from "@/lib/persistence";
import { UnconfirmedNameCandidatesError, type MaskOptions } from "@/lib/name-candidate-confirmation";
import { PERSON_HONORIFICS, stripPersonHonorific } from "@/lib/person-honorific";
import { detectNameCandidatesAsync, registerNameCandidateFilters } from "@/lib/name-candidate-detect";

export { stripPersonHonorific };

type PersistedState = {
  entries: [string, string][]; // [name, id][]
  // 正式名（idToName、1id=1名）。ユーザー指摘「勝手にメンバーのプライマリの名前が変わる」
  // 対応。以前はここを持たず、読み込み時に entries の並び順から正式名を推測していたが、
  // entries は「新しい表記ほど末尾に足される」Map（nameToId）由来のため、renamePerson
  // （明示改名）の後にaddAliasで別名を1件足しただけでも並び順が変わり、次回読み込み時に
  // 正式名がEMの意図と無関係に入れ替わってしまっていた。正式名はEMの明示操作
  // （renamePerson/registerNameでの新規登録）の結果のみを唯一の真実として別フィールドで
  // 永続化し、読み込み時は常にこちらを優先する。
  canonical?: [string, string][]; // [id, name][]
  counter: number;
  // EMが「人名として登録せず未マスクのまま進めてよい」と確認した語句。
  // 再確認を避けつつ、people（PERSON_n）にも載せないための許可リスト。
  acknowledgedUnmasked?: string[];
};

const PEOPLE_DIRECTORY_FILE = "people-directory.json";

/**
 * 正式名（idToName）をPersistedStateから復元する。canonicalフィールドを最優先し、
 * それが無い旧形式のデータ（canonical未導入時に保存されたファイル）に対してのみ、
 * 従来どおり entries の最初の出現を正式名とみなすフォールバックを行う。
 */
function deriveIdToName(state: PersistedState): Map<string, string> {
  const out = new Map<string, string>();
  for (const [id, name] of state.canonical ?? []) {
    if (name && id) out.set(id, name);
  }
  for (const [name, id] of state.entries ?? []) {
    if (!name || !id) continue;
    if (!out.has(id)) out.set(id, name);
  }
  return out;
}

const initial = loadSecureJSON<PersistedState>(PEOPLE_DIRECTORY_FILE, { entries: [], counter: 0 });

const nameToId = new Map<string, string>(initial.entries);
const idToName = deriveIdToName(initial);
let counter = initial.counter;
const acknowledgedUnmasked = new Set<string>((initial.acknowledgedUnmasked ?? []).map((s) => s.trim()).filter(Boolean));

/** deletePerson で最後の1人を消すなど、意図的に空へ落とすときだけ true。 */
let allowEmptyPersist = false;

function hydrateFromPersisted(state: PersistedState): void {
  nameToId.clear();
  idToName.clear();
  for (const [name, id] of state.entries ?? []) {
    if (!name || !id) continue;
    nameToId.set(name, id);
  }
  for (const [id, name] of deriveIdToName(state)) {
    idToName.set(id, name);
  }
  counter = typeof state.counter === "number" && state.counter >= 0 ? state.counter : idToName.size;
  acknowledgedUnmasked.clear();
  for (const raw of state.acknowledgedUnmasked ?? []) {
    const trimmed = raw.trim();
    if (trimmed) acknowledgedUnmasked.add(trimmed);
  }
}

function persist(): void {
  // ロード失敗→空 fallback のまま ack 等で persist すると名簿が消える。
  // ディスク／.bak にエントリがあるのにメモリが空なら拒否してディスクから戻す。
  if (nameToId.size === 0 && !allowEmptyPersist) {
    const onDisk = peekSecureJSON<PersistedState>(PEOPLE_DIRECTORY_FILE);
    const diskEntries = onDisk?.entries ?? [];
    if (diskEntries.length > 0) {
      console.error(
        "[people-directory] refused to persist empty directory over non-empty on-disk state; reloading from disk/bak",
      );
      hydrateFromPersisted(onDisk!);
      return;
    }
  }
  saveSecureJSON(PEOPLE_DIRECTORY_FILE, {
    entries: Array.from(nameToId.entries()),
    canonical: Array.from(idToName.entries()),
    counter,
    acknowledgedUnmasked: Array.from(acknowledgedUnmasked),
  });
}

// ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。nameToIdは元々
// 「名前→ID」のMapであり、複数の名前文字列が同じIDを指すこと自体は構造上すでに可能
// だった（1つのIDに複数の別名がぶら下がる形）。idToName（表示用の正式名、1id=1名）と
// 組み合わせ、「正式名以外でこのIDを指しているnameToIdのキー」を別名（aliases）として
// 扱う。
export type PersonRecord = { id: string; name: string; aliases: string[] };

/** マスク用に bare 形を載せる最小文字数（1文字は誤マスクが多すぎる） */
const MIN_BARE_NAME_LENGTH_FOR_MASK = 2;

function findIdByAnyForm(name: string): string | undefined {
  const trimmed = name.trim();
  if (!trimmed) return undefined;
  const exact = nameToId.get(trimmed);
  if (exact) return exact;
  const bare = stripPersonHonorific(trimmed);
  if (!bare) return undefined;
  for (const [n, id] of nameToId.entries()) {
    if (stripPersonHonorific(n) === bare) return id;
  }
  return undefined;
}

/** 登録済み表記に加え、敬称付き／なしの揺れも同一IDへマップする（永続化はしない）。 */
function buildMaskMapping(): Map<string, string> {
  const mapping = new Map(nameToId);
  const bareToId = new Map<string, string>();
  for (const [n, id] of nameToId.entries()) {
    const bare = stripPersonHonorific(n);
    if (!bare) continue;
    if (!bareToId.has(bare)) bareToId.set(bare, id);
  }
  for (const [bare, id] of bareToId.entries()) {
    // bare 単体は2文字以上のみ（1文字は誤マスクが多い）。敬称付きは常に載せる。
    if (bare.length >= MIN_BARE_NAME_LENGTH_FOR_MASK && !mapping.has(bare)) {
      mapping.set(bare, id);
    }
    for (const h of PERSON_HONORIFICS) {
      const form = `${bare}${h}`;
      if (!mapping.has(form)) mapping.set(form, id);
    }
  }
  return mapping;
}

export function registerName(name: string): string {
  const trimmed = name.trim();
  const existing = findIdByAnyForm(trimmed);
  if (existing) {
    // 敬称違いの新表記は別名として残し、以後その表記でもマスクできるようにする
    if (trimmed && !nameToId.has(trimmed)) {
      nameToId.set(trimmed, existing);
      persist();
    }
    return existing;
  }

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

// 自由記述への埋め込みは {{PERSON_n}} にする。裸の PERSON_1 の直後に数字が続くと
// （例: 「田中さん7回忌」→ PERSON_17回忌）、PERSON_17 が別人物として登録されている場合に
// unmask が誤って長い ID へ解決してしまうため。構造化フィールド（people 配列等）の
// 正規 ID は従来どおり PERSON_n のまま。

/** 自由記述用の区切り付きトークン。正規 ID（PERSON_n）とは別。 */
export function formatPersonToken(id: string): string {
  return `{{${id}}}`;
}

function buildTokenMaskMapping(): Map<string, string> {
  const out = new Map<string, string>();
  for (const [name, id] of buildMaskMapping()) {
    out.set(name, formatPersonToken(id));
  }
  return out;
}

// 名前を区切り付きトークンに置換する。同じ長さ・重なり合う候補がある場合は長い名前を優先する
// （例: "Aさん"と"A"を両方登録していても、"Aさん"が先に一致する）。
// 敬称の有無・違い（さん／くん等）は buildMaskMapping で吸収する。
export function maskNames(text: string): string {
  return replaceAllAtOnce(text, buildTokenMaskMapping());
}

/**
 * 検索用。新規保存は {{PERSON_n}}、既存データは裸の PERSON_n のため、
 * LIKE / includes では両方を試す呼び出し側向けに返す。
 */
export function maskNamesSearchForms(text: string): string[] {
  const tokenized = maskNames(text);
  const bare = replaceAllAtOnce(text, buildMaskMapping());
  return tokenized === bare ? [tokenized] : [tokenized, bare];
}

/** 登録済み人名のマスク結果と置換一覧（個人・機密情報チェック用。副作用なし）。 */
export type NameMaskReplacement = { from: string; to: string; count: number };

export function previewNameMask(text: string): {
  maskedText: string;
  replacements: NameMaskReplacement[];
} {
  const mapping = buildTokenMaskMapping();
  const keys = [...mapping.keys()].filter(Boolean).sort((a, b) => b.length - a.length);
  if (keys.length === 0) return { maskedText: text, replacements: [] };

  const counts = new Map<string, NameMaskReplacement>();
  const pattern = new RegExp(keys.map(escapeRegExp).join("|"), "g");
  const maskedText = text.replace(pattern, (match) => {
    const to = mapping.get(match) ?? match;
    const key = `${match}\0${to}`;
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { from: match, to, count: 1 });
    return to;
  });
  return { maskedText, replacements: [...counts.values()] };
}

/**
 * 本文に出現する登録済み人物IDを返す。照合は maskNames / previewNameMask と同じ名簿
 * （正式名・別名・敬称揺れ）。新規登録はしない。未登録名は対象外。
 * Journal の関係者自動紐付け（チームの findMentionedTeamIds に相当）用。
 */
export function findMentionedPersonIds(text: string): string[] {
  if (!text.trim()) return [];
  const ids: string[] = [];
  for (const { to } of previewNameMask(text).replacements) {
    const token = to.startsWith("{{") && to.endsWith("}}") ? to.slice(2, -2) : to;
    if (idToName.has(token) && !ids.includes(token)) ids.push(token);
  }
  return ids;
}

// IDを実名に戻す。区切り付き {{PERSON_n}} を先に処理し、続けてレガシーな裸 ID
// （people 配列・移行前データ）を戻す。
// ユーザー指摘「PERSON_10がPERSON_1(登録済み)の時点で置き換えられ『◯◯さん0』になる」対応。
// 裸IDは登録済みIDの集合から作ったパターンで置換していたため、カウンタのリセットや
// deletePersonで対応表から消えたIDが本文に残っていると（例: 本文は"PERSON_20"だが
// idToNameにはPERSON_1〜PERSON_17しか無い）、"PERSON_20"の先頭8文字が短い登録済みID
// "PERSON_2"に部分一致し、末尾の"0"だけが取り残されて別人（PERSON_2）の名前に化けて
// しまっていた。/PERSON_\d+/は数字列を必ず最後まで貪欲に消費してから1つのトークンとして
// 引くため、この部分一致は起こらない。該当IDが対応表に無ければ、別人へ誤帰属させるより
// 未解決のまま残す方が安全なので置換しない。
export function unmaskNames(text: string): string {
  const fromTokens = text.replace(/\{\{(PERSON_\d+)\}\}/g, (full, id: string) => idToName.get(id) ?? full);
  return fromTokens.replace(/PERSON_\d+/g, (full) => idToName.get(full) ?? full);
}

// idToName（正式名、1id=1名）を主軸に列挙する。nameToIdを主軸にすると、別名を
// 持つ人物が別名の数だけ重複したPersonRecordとして現れてしまう（統合・別名機能の
// 目的そのものを損なう）ため、必ずidToName側から辿ること。
export function listPeople(): PersonRecord[] {
  const aliasesById = new Map<string, string[]>();
  for (const [name, id] of nameToId.entries()) {
    if (idToName.get(id) === name) continue; // 正式名はaliasesに含めない
    if (!aliasesById.has(id)) aliasesById.set(id, []);
    aliasesById.get(id)!.push(name);
  }
  return [...idToName.entries()].map(([id, name]) => ({ id, name, aliases: aliasesById.get(id) ?? [] }));
}

// docs/em_human_story_and_ux.md P2-12 / docs/memo.md TODO「ローカルNER誤検出対策」対応。
// フィルタでは防ぎきれない誤登録が必ず残る前提の「最後の安全弁」として、EMが
// People画面から誤登録エントリを直接削除できるようにする。関連するJournal fact等
// （knowledge-store側にPERSON_n ID付きで残る）はここでは削除しない——誤登録エントリは
// 実際のJournal記録を伴わないケースがほとんどであり、対応表からの削除だけで
// 「以後そのIDは実名に戻らない・以後NERで再度この名前が出れば新しいIDが振られる」
// という実用上十分な復旧になる。正式名だけでなく、登録済みの別名もすべて一緒に消す
// （別名だけが対応表に残ると、以後その別名を含む文が誰にも解決できないIDへマスクされ
// 続けてしまうため）。
export function deletePerson(id: string): boolean {
  const name = idToName.get(id);
  if (name === undefined) return false;
  idToName.delete(id);
  for (const [n, i] of nameToId.entries()) {
    if (i === id) nameToId.delete(n);
  }
  allowEmptyPersist = nameToId.size === 0;
  try {
    persist();
  } finally {
    allowEmptyPersist = false;
  }
  return true;
}

// ユーザー要望「メンバーの表記揺れに対応できる仕組みが欲しい」対応。既存の人物に
// 別名を追加登録する（新規IDは発行しない）。以後、この別名がJournal等の自由記述に
// 現れた場合もこのIDへマスクされる。
export function addAlias(id: string, aliasName: string): { ok: true } | { ok: false; error: string } {
  const trimmed = aliasName.trim();
  if (!trimmed) return { ok: false, error: "別名を入力してください" };
  const canonical = idToName.get(id);
  if (canonical === undefined) return { ok: false, error: "対象の人物が見つかりません" };
  if (canonical === trimmed) return { ok: false, error: "正式名と同じです" };
  const existingOwner = findIdByAnyForm(trimmed);
  if (existingOwner === id) {
    if (!nameToId.has(trimmed)) {
      nameToId.set(trimmed, id);
      persist();
      return { ok: true };
    }
    return { ok: false, error: "既にこの人物の別名として登録済みです" };
  }
  if (existingOwner !== undefined) {
    return { ok: false, error: "この名前は既に別の人物として登録されています。「重複を統合」を使ってください。" };
  }
  nameToId.set(trimmed, id);
  persist();
  return { ok: true };
}

// docs/usage_issues U7。正式名を差し替え、旧表記は別名として残す（過去のJournalが
// マスクされ続けるようにする）。
export function renamePerson(id: string, newName: string): { ok: true } | { ok: false; error: string } {
  const trimmed = newName.trim();
  if (!trimmed) return { ok: false, error: "名前を入力してください" };
  const current = idToName.get(id);
  if (current === undefined) return { ok: false, error: "対象の人物が見つかりません" };
  if (current === trimmed) return { ok: true };
  const existingOwner = findIdByAnyForm(trimmed);
  if (existingOwner !== undefined && existingOwner !== id) {
    return { ok: false, error: "この名前は既に別の人物として登録されています。「重複を統合」を使ってください。" };
  }
  idToName.set(id, trimmed);
  nameToId.set(trimmed, id);
  if (!nameToId.has(current)) nameToId.set(current, id);
  persist();
  return { ok: true };
}

// 誤って登録した別名を取り消す（正式名自体はdeletePersonでのみ削除できる——ここでは
// 「対応表から人物を消す」ことと「別名を1件取り消す」ことを明確に分ける）。
export function removeAlias(id: string, aliasName: string): boolean {
  const trimmed = aliasName.trim();
  if (idToName.get(id) === trimmed) return false;
  if (nameToId.get(trimmed) !== id) return false;
  nameToId.delete(trimmed);
  persist();
  return true;
}

// ユーザー要望「誤って複数登録されてしまったメンバーを統合する機能が欲しい」対応。
// fromId（重複・統合されて消える側）の正式名・別名をすべてtoId（統合先・残る側）の
// 別名として付け替え、fromIdの正式名エントリを削除する。これにより、以後fromIdの
// 名前がJournal等に現れてもtoIdへマスクされる（統合＝表記揺れ登録の特殊形）。
// Journal/Issue/チーム所属側のPERSON_n ID付け替えは呼び出し側（people-hub.ts）の責務
// （このファイルは対応表のみを扱う、既存の関心の分離を保つ）。
export function mergePersons(fromId: string, toId: string): { ok: true } | { ok: false; error: string } {
  if (fromId === toId) return { ok: false, error: "同じ人物です" };
  if (!idToName.has(fromId)) return { ok: false, error: "統合元の人物が見つかりません" };
  if (!idToName.has(toId)) return { ok: false, error: "統合先の人物が見つかりません" };
  for (const [name, id] of nameToId.entries()) {
    if (id === fromId) nameToId.set(name, toId);
  }
  idToName.delete(fromId);
  persist();
  return { ok: true };
}

// registerNameと違い、未登録の名前に対して新規IDを発行しない（副作用のない参照専用）。
// 読み取り専用API（例: 人物名でのフィルタ検索）が、未知の名前を渡されただけで
// people-directoryに新規登録してしまう事故を防ぐ。
export function getPersonId(name: string): string | undefined {
  return findIdByAnyForm(name);
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
  if (detectLeakedNames(text).length > 0) {
    throw new Error("実名が外部送信直前のテキストに含まれていたため送信を中止しました（詳細はログに残しません）。");
  }
}

// ユーザー指摘「実名リークが1件検知されると、類似検索経由で無関係な他の分析にまで
// 繰り返し混入して連鎖的に送信停止になり、しかもどのデータが原因か探し回る必要がある」
// 対応。assertNoRealNamesLeakedと同じ検査だが、例外を投げる代わりにヒットした登録名を
// 返す——呼び出し側（agent-runtime）はこれを使って原因と見られるナレッジイベントを
// knowledge-store.ts側で特定・自動アーカイブする。ヒットした名前自体はログに出さない。
export function detectLeakedNames(text: string): string[] {
  const hits: string[] = [];
  // maskNames と同じ拡大集合で検査し、敬称違いの漏れも止める
  for (const name of buildMaskMapping().keys()) {
    if (name && text.includes(name)) hits.push(name);
  }
  return hits;
}

// 重要な設計変更: 「保存する前にマスクする」ための唯一の入口。個人名（実名）に触れて
// よいのはこのファイル（people-directory.ts、secure配下のpeople-directory.jsonはローカル
// ディスクにのみ存在し外部LLMには絶対に渡さない）と、ダッシュボード表示のためのAPI応答
// 組み立て層だけ、という原則をコード上で強制する。
// 人名候補は自動登録しない。未登録かつフィルタを通った候補は
// ensureNameCandidatesAllowed 経由でEM確認（未マスク許可）を求める。
// 呼び出し側は既知の名前だけがPERSON_nに置換されたテキストを保存する。

// docs/em_human_story_and_ux.md P2-12 / docs/memo.md TODO「ローカルNER誤検出対策」対応。
// 実機で確認された誤登録事例を踏まえた抽出後フィルタ。完全な言語判定はしない。
// （候補検出本体は name-candidate-detect。ここは追加の妥当性チェック用）
const MIN_NAME_LENGTH = 2;
const MAX_NAME_LENGTH = 20; // 「壁打ちメッセージまるごと」のような文全体の誤検出を弾く上限

const RESERVED_TERMS = new Set(
  [
    // agent-runtime.tsのシステムプロンプトに常時登場するテンプレート語（実機確認済みの衝突）
    "issue",
    "issues",
    "option",
    "option a",
    "option b",
    "team",
    "teams",
    "objective",
    "objectives",
    "key result",
    "key results",
    "action item",
    "action items",
    // 自由記述（Journal・KPT等）で人物名と誤認識された一般語（実機確認済み）
    "nps",
    "1on1",
    "kpt",
    "keep",
    "problem",
    "try",
    "pr",
    "割り込み",
  ].map((s) => s.toLowerCase()),
);

function isAsciiOnly(s: string): boolean {
  return /^[\x00-\x7F]*$/.test(s);
}

// org-context-store⇄people-directoryの循環参照を避けるため、people-directory自身は
// org-context-storeをimportしない。チーム名との衝突チェック（実装＝listTeams）は
// org-context-store側がこの関数を使って自らを登録する（依存性逆転）。未登録の間
// （起動直後・単体テスト等）は「衝突なし」として安全側に倒す——元々このチェックは
// 追加の安全網の一つであり、無くても候補検出全体は成立する。
let teamNameCollisionChecker: ((candidate: string) => boolean) | null = null;

/** org-context-store.ts が自身のlistTeamsを登録するためのフック。他から呼ばないこと。 */
export function registerTeamNameCollisionChecker(checker: (candidate: string) => boolean): void {
  teamNameCollisionChecker = checker;
}

function collidesWithExistingTeamName(candidate: string): boolean {
  if (!teamNameCollisionChecker) return false;
  try {
    return teamNameCollisionChecker(candidate);
  } catch {
    // チーム名衝突チェックはあくまで追加の安全網の一つ。ここで例外を投げて候補検出
    // 全体を止めるのは本末転倒なので、「衝突なし」として扱う。
    return false;
  }
}

// NER抽出候補が「明らかに人物名ではない」場合にfalseを返す。
export function isPlausiblePersonName(candidate: string): boolean {
  const trimmed = candidate.trim();
  if (trimmed.length < MIN_NAME_LENGTH || trimmed.length > MAX_NAME_LENGTH) return false;
  if (RESERVED_TERMS.has(trimmed.toLowerCase())) return false;
  if (isAsciiOnly(trimmed)) return false; // 記号・英数字のみの候補（NPS, 1on1等）を除外
  if (collidesWithExistingTeamName(trimmed)) return false;
  return true;
}

export function acknowledgeUnmaskedCandidates(candidates: string[]): void {
  let changed = false;
  for (const raw of candidates) {
    const trimmed = raw.trim();
    if (!trimmed || acknowledgedUnmasked.has(trimmed)) continue;
    acknowledgedUnmasked.add(trimmed);
    changed = true;
  }
  if (changed) persist();
}

export function isAcknowledgedUnmasked(name: string): boolean {
  const trimmed = name.trim();
  if (acknowledgedUnmasked.has(trimmed)) return true;
  const bare = stripPersonHonorific(trimmed);
  if (!bare) return false;
  for (const a of acknowledgedUnmasked) {
    if (stripPersonHonorific(a) === bare) return true;
  }
  return false;
}

/**
 * 未登録・未許可の人名らしい語句を検出する（副作用なし・登録しない）。
 * 実装は name-candidate-detect（敬称・話者・形態素）。
 */
export async function detectUnregisteredNameCandidates(text: string): Promise<string[]> {
  if (!text.trim()) return [];
  try {
    // detectNameCandidatesAsync 側で登録済み／ack済み／妥当性フィルタ済み
    // （name-candidate-detect.tsへ登録したフィルタ経由。下のregisterNameCandidateFilters参照）。
    return await detectNameCandidatesAsync(text);
  } catch {
    // 辞書ロード失敗などは握りつぶす。既知の名前のマスクは引き続き有効。
    return [];
  }
}

// name-candidate-detect⇄people-directoryの循環参照を避けるため、name-candidate-detect
// 自身はpeople-directoryをimportしない。既知の名前／確認済みかどうかの判定と
// 妥当性チェック（isPlausiblePersonName）はpeople-directory側がこの登録フックで
// name-candidate-detectへ渡す（依存性逆転）。
registerNameCandidateFilters({
  isKnownOrAcknowledged: (name) => Boolean(getPersonId(name) || isAcknowledgedUnmasked(name)),
  isPlausiblePersonName,
});

/**
 * 複数テキストから未確認候補を集め、必要なら登録／確認エラーにする。
 *
 * 既定（opts未指定）: 候補検出を起動せず即return。登録済み人名だけが後続の maskForStorage で
 * マスクされる。事前登録が正の方針に合わせ、保存・Agent送信のホットパスから検出を外す。
 *
 * - registerNameCandidates: true → 候補を検出し人名登録する
 * - allowUnmaskedCandidates: false → 候補を検出し、未許可なら UnconfirmedNameCandidatesError
 * - allowUnmaskedCandidates: true → 候補を検出し acknowledge して進める
 */
export async function ensureNameCandidatesAllowed(texts: string[], opts: MaskOptions = {}): Promise<void> {
  const needsDetect =
    opts.registerNameCandidates === true ||
    opts.allowUnmaskedCandidates === false ||
    opts.allowUnmaskedCandidates === true;
  if (!needsDetect) return;

  // 空を除き、同一文面の重複検出を避ける。複数フィールド（Why/What/How等）は
  // 検出へ1回だけ渡す（フィールドごとの直列呼び出しを避ける）。
  const nonEmpty = [...new Set(texts.map((t) => t.trim()).filter(Boolean))];
  if (nonEmpty.length === 0) return;
  const candidates = await detectUnregisteredNameCandidates(nonEmpty.join("\n"));
  if (candidates.length === 0) return;
  // 登録してマスクする方が未マスク許可より安全なため、両方指定時は登録を優先する
  if (opts.registerNameCandidates) {
    for (const c of candidates) registerName(c);
    return;
  }
  if (opts.allowUnmaskedCandidates === false) {
    throw new UnconfirmedNameCandidatesError(candidates);
  }
  acknowledgeUnmaskedCandidates(candidates);
}

// 既に登録済みの名前だけを {{PERSON_n}} トークンへ置換する。候補検出による新規登録は行わない。
// Journal/Issue保存やAgent送信前は、呼び出し側で ensureNameCandidatesAllowed を先に呼ぶ。
// （optsは呼び出し側の一貫したシグネチャ用。マスク自体には使わない）
export async function maskForStorage(text: string, opts: MaskOptions = {}): Promise<string> {
  void opts; // 呼び出し側シグネチャ用。マスク自体には使わない
  return maskNames(text);
}
