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
// 名前の登録元は、チームメンバー追加・Journal校正でEMが明示した人物・People画面の
// 手動登録・人名候補ダイアログでの「人名として登録」に限定する。ローカルNERの検出結果
// では自動登録しない（誤登録が assertNoRealNamesLeaked を誤発火させ Agent 送信を
// 止めるため）。NERは未登録候補の提示と確認にだけ使う。

import { loadSecureJSON, saveSecureJSON } from "@/lib/persistence";
import { extractFirstJsonObject, runLocalChat } from "@/lib/local-model";
import { listTeams } from "@/lib/org-context-store";
import { UnconfirmedNameCandidatesError, type MaskOptions } from "@/lib/name-candidate-confirmation";
import { teamPathSegments } from "@/lib/types";

type PersistedState = {
  entries: [string, string][]; // [name, id][]
  counter: number;
  // EMが「人名として登録せず未マスクのまま進めてよい」と確認した語句。
  // 再確認を避けつつ、people（PERSON_n）にも載せないための許可リスト。
  acknowledgedUnmasked?: string[];
};

const initial = loadSecureJSON<PersistedState>("people-directory.json", { entries: [], counter: 0 });

const nameToId = new Map<string, string>(initial.entries);
const idToName = new Map<string, string>(initial.entries.map(([name, id]) => [id, name]));
let counter = initial.counter;
const acknowledgedUnmasked = new Set<string>((initial.acknowledgedUnmasked ?? []).map((s) => s.trim()).filter(Boolean));

function persist(): void {
  saveSecureJSON("people-directory.json", {
    entries: Array.from(nameToId.entries()),
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

// 「田中さん」「田中くん」「田中」を同一人物として扱うための敬称正規化。
// 表示用の正式名は登録時の表記を保持し、照合・マスク時だけ敬称を吸収する。
const PERSON_HONORIFICS = ["さん", "くん", "ちゃん", "様", "氏", "君"] as const;
const HONORIFIC_SUFFIX_RE = /(?:さん|くん|ちゃん|様|氏|君)$/;
/** マスク用に bare 形を載せる最小文字数（1文字は誤マスクが多すぎる） */
const MIN_BARE_NAME_LENGTH_FOR_MASK = 2;

export function stripPersonHonorific(name: string): string {
  return name.trim().replace(HONORIFIC_SUFFIX_RE, "").trim();
}

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

// 名前をIDに置換する。同じ長さ・重なり合う候補がある場合は長い名前を優先する
// （例: "Aさん"と"A"を両方登録していても、"Aさん"が先に一致する）。
// 敬称の有無・違い（さん／くん等）は buildMaskMapping で吸収する。
export function maskNames(text: string): string {
  return replaceAllAtOnce(text, buildMaskMapping());
}

// IDを実名に戻す。IDは"PERSON_1", "PERSON_10", "PERSON_11"のように採番されるため、
// 短いID文字列は長いIDの文字列としてのprefixになりうるが、1回のスキャンで
// 最長一致を優先するため、この衝突も発生しない。
export function unmaskNames(text: string): string {
  return replaceAllAtOnce(text, idToName);
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
  persist();
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
  // maskNames と同じ拡大集合で検査し、敬称違いの漏れも止める
  for (const name of buildMaskMapping().keys()) {
    if (name && text.includes(name)) {
      throw new Error("実名が外部送信直前のテキストに含まれていたため送信を中止しました（詳細はログに残しません）。");
    }
  }
}

// 重要な設計変更: 「保存する前にマスクする」ための唯一の入口。個人名（実名）に触れて
// よいのはこのファイル（people-directory.ts、secure配下のpeople-directory.jsonはローカル
// ディスクにのみ存在し外部LLMには絶対に渡さない）と、ダッシュボード表示のためのAPI応答
// 組み立て層だけ、という原則をコード上で強制する。
// ローカルNERは自動登録しない。未登録かつフィルタを通った候補は
// ensureNameCandidatesAllowed 経由でEM確認（未マスク許可）を求める。
// 呼び出し側は既知の名前だけがPERSON_nに置換されたテキストを保存する。
const NAME_EXTRACTION_SYSTEM_PROMPT = [
  "入力テキストに含まれる人物名だけをJSON形式で出力してください。説明や前置きは一切書かず、JSONオブジェクト1つだけを出力すること。",
  'フォーマット: {"people": string[]}',
  "敬称はそのまま残すこと（例: Aさん）。人物が見当たらなければ空配列にすること。",
].join("\n");

// docs/em_human_story_and_ux.md P2-12 / docs/memo.md TODO「ローカルNER誤検出対策」対応。
// 実機で確認された誤登録事例を踏まえた抽出後フィルタ。完全な言語判定はしない。
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

function collidesWithExistingTeamName(candidate: string): boolean {
  try {
    return listTeams().some((t) => t.name === candidate || teamPathSegments(t.name).includes(candidate));
  } catch {
    // org-context-store側の読み込みに失敗しても、チーム名衝突チェックはあくまで
    // 追加の安全網の一つ。ここで例外を投げて候補検出全体を止めるのは本末転倒なので、
    // 「衝突なし」として扱う。
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

/** ローカルNERで未登録・未許可の人名らしい語句を検出する（副作用なし・登録しない）。 */
export async function detectUnregisteredNameCandidates(text: string): Promise<string[]> {
  if (!text.trim()) return [];
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
    if (!jsonText) return [];
    const parsed = JSON.parse(jsonText);
    if (!Array.isArray(parsed.people)) return [];
    const found = new Set<string>();
    for (const p of parsed.people) {
      if (typeof p !== "string") continue;
      const trimmed = p.trim();
      if (!isPlausiblePersonName(trimmed)) continue;
      if (findIdByAnyForm(trimmed)) continue;
      if (isAcknowledgedUnmasked(trimmed)) continue;
      found.add(trimmed);
    }
    return [...found];
  } catch {
    // ローカルNERの失敗は握りつぶす。既知の名前のマスクは引き続き有効。
    return [];
  }
}

/** 複数テキストから未確認候補を集め、未許可なら UnconfirmedNameCandidatesError を投げる。 */
export async function ensureNameCandidatesAllowed(texts: string[], opts: MaskOptions = {}): Promise<void> {
  const found = new Set<string>();
  for (const text of texts) {
    for (const c of await detectUnregisteredNameCandidates(text)) found.add(c);
  }
  const candidates = [...found];
  if (candidates.length === 0) return;
  // 登録してマスクする方が未マスク許可より安全なため、両方指定時は登録を優先する
  if (opts.registerNameCandidates) {
    for (const c of candidates) registerName(c);
    return;
  }
  if (!opts.allowUnmaskedCandidates) {
    throw new UnconfirmedNameCandidatesError(candidates);
  }
  acknowledgeUnmaskedCandidates(candidates);
}

// 既に登録済みの名前だけをPERSON_nへ置換する。NERによる新規登録は行わない。
// Journal/Issue保存やAgent送信前は、呼び出し側で ensureNameCandidatesAllowed を先に呼ぶ。
// （optsは呼び出し側の一貫したシグネチャ用。マスク自体には使わない）
export async function maskForStorage(text: string, _opts: MaskOptions = {}): Promise<string> {
  return maskNames(text);
}
