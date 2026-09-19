import type { MaskOptions } from "./name-candidate-confirmation";

// docs/2nd_architecture/plan.md フェーズ2.5: 旧 web/src/app/api/name-candidate-response.ts の
// うちフレームワーク非依存な部分（API bodyからMaskOptionsを組み立てるロジック）をここへ移設した。
// HTTPフレームワーク固有のエラーレスポンス整形（NextResponse/Hono Response）は各ホスト側に残す。

export function parseAllowUnmaskedCandidates(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as Record<string, unknown>).allowUnmaskedNameCandidates === true;
}

export function parseRegisterNameCandidates(body: unknown): boolean {
  if (!body || typeof body !== "object") return false;
  return (body as Record<string, unknown>).registerNameCandidates === true;
}

/** API body から MaskOptions を組み立てる。フラグ未指定時は空（NERゲートなし＝事前登録が正）。 */
export function maskOptionsFromBody(body: unknown): MaskOptions {
  if (parseRegisterNameCandidates(body)) {
    return { registerNameCandidates: true };
  }
  if (parseAllowUnmaskedCandidates(body)) {
    return { allowUnmaskedCandidates: true };
  }
  return {};
}

// docs/memo.md「メンバーに登録がない名前をJournalで入力して分析にかけましたが、とくに
// 引っかからずにAIに渡されてしまいました」対応。maskOptionsFromBody（フラグ未指定時は
// 検出ゲート自体を起動しない）は、AI送信の間際ではなく「EMが実名を含みうる生テキストを
// 直接入力する画面」（Journal新規登録／編集／まとめ入力／ダンプ取り込み、何でも相談の
// task・壁打ち追加メッセージ）には弱すぎる。この入力点でだけ、フラグ未指定時の既定を
// 「検出オン・未許可ならUnconfirmedNameCandidatesError」に強めたのがこちら。
// EM側は既存のfetchWithNameConfirm（409 + NAME_CANDIDATE_CONFIRMATION_REQUIRED）が
// そのまま同じ確認ダイアログを出す——このプロトコル自体は既存のまま、既定値だけを変える。
export function maskOptionsFromBodyStrict(body: unknown): MaskOptions {
  if (parseRegisterNameCandidates(body)) {
    return { registerNameCandidates: true };
  }
  if (parseAllowUnmaskedCandidates(body)) {
    return { allowUnmaskedCandidates: true };
  }
  return { allowUnmaskedCandidates: false };
}
