import { NextResponse } from "next/server";
import { addJournalEntryWithProfileCandidate, listJournalEntries, toJournalEntryView, toJournalEntryViews } from "@core/journal-store";
import { buildSourceConsultIndex } from "@/lib/journal-consult-index";
import { resolveJournalOccurredAtFromDateInput } from "@core/journal-date-parser";
import { jsonFromUnknownError, maskOptionsFromBodyStrict } from "@/app/api/name-candidate-response";

export async function GET() {
  return NextResponse.json({ entries: toJournalEntryViews(listJournalEntries(), await buildSourceConsultIndex()) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text.trim() : "";

  if (!text) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }

  // docs/em_human_story_and_ux.md 改修依頼「通常投入でも日付レベルの訂正を検討」対応。
  // occurredAtDateは"YYYY-MM-DD"（日付レベルのみ・時刻は求めない）。省略時はこれまで通り
  // Date.now()（＝今日）を使う。
  let occurredAt: number | undefined;
  if (typeof body?.occurredAtDate === "string" && body.occurredAtDate) {
    occurredAt = resolveJournalOccurredAtFromDateInput(body.occurredAtDate, Date.now());
    if (occurredAt === undefined) {
      return NextResponse.json({ error: "occurredAtDateの形式が不正です（YYYY-MM-DD）" }, { status: 400 });
    }
  }

  // 人物詳細など「このメンバーに紐づけて書く」導線向け。EMが明示した人物名は
  // NER抽出に頼らず作成時から people に入れる（未指定時は従来どおり抽出のみ）。
  const people = Array.isArray(body?.people)
    ? body.people.filter((p: unknown): p is string => typeof p === "string" && p.trim().length > 0)
    : undefined;
  const teams = Array.isArray(body?.teams)
    ? body.teams.filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
    : undefined;
  const teamIds = Array.isArray(body?.teamIds)
    ? body.teamIds.filter((t: unknown): t is string => typeof t === "string" && t.trim().length > 0)
    : undefined;

  const opts = {
    ...maskOptionsFromBodyStrict(body),
    ...(people && people.length > 0 ? { people } : {}),
    ...(teams && teams.length > 0 ? { teams } : {}),
    ...(teamIds && teamIds.length > 0 ? { teamIds } : {}),
  };

  try {
    // 既登録の人物名は本文の名簿照合で addJournalEntry 内の people へ紐付ける。
    // 未登録の人名候補（形態素／ルール＋ローカル抽出の和集合）は保存前に
    // maskOptionsFromBodyStrict 経由で1回の確認ダイアログに出す。保存後の
    // nameCandidates ヒントは出さない（常に空・API互換のためフィールドは残す）。
    const { entry, profileCandidate, nameCandidates } =
      occurredAt !== undefined
        ? await addJournalEntryWithProfileCandidate(text, occurredAt, opts)
        : await addJournalEntryWithProfileCandidate(text, Date.now(), opts);
    // docs/memo.md「JournalのAIでの分析結果として、メンバーの長期プロファイルに入れる」対応。
    // profileCandidateは投稿直後だけの一度きりのヒント（永続化しない）。
    return NextResponse.json(
      { entry: toJournalEntryView(entry, new Map()), nameCandidates, profileCandidate },
      { status: 201 },
    );
  } catch (err) {
    return jsonFromUnknownError(err);
  }
}
