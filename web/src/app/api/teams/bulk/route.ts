import { NextResponse } from "next/server";
import { addTeam } from "@/lib/org-context-store";
import { teamPathSegments } from "@/lib/types";

// docs/memo.md「初回に組織情報やMVV、目標等の情報を大量に投入する必要がある」への対応。
// MVV/OKRは既存のStrategyフォーム（自由記述テキスト）に丸ごと貼り付ければ足りるが、
// チームは1件ずつ作る既存フォームしか無く、初期投入時のボトルネックになっていたため、
// 1行1チームの簡易フォーマットで一括登録できるエンドポイントを追加する。
// フォーマット: `チーム名: メンバー1, メンバー2`（":"は全角も可、メンバー区切りは","/"、"も可）

type ParsedLine = { name: string; members: string[] };

function parseBulkText(text: string): { parsed: ParsedLine[]; skipped: string[] } {
  const parsed: ParsedLine[] = [];
  const skipped: string[] = [];
  for (const rawLine of text.split("\n")) {
    const line = rawLine.trim();
    if (!line) continue;
    const sepIndex = line.search(/[:：]/);
    if (sepIndex < 0) {
      skipped.push(line);
      continue;
    }
    const name = line.slice(0, sepIndex).trim();
    const membersPart = line.slice(sepIndex + 1).trim();
    if (teamPathSegments(name).length === 0) {
      skipped.push(line);
      continue;
    }
    const members = membersPart
      .split(/[,、]/)
      .map((m) => m.trim())
      .filter(Boolean);
    parsed.push({ name, members });
  }
  return { parsed, skipped };
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const { parsed, skipped } = parseBulkText(text);

  if (parsed.length === 0) {
    return NextResponse.json({ error: "有効な行がありません（`チーム名: メンバー1, メンバー2` の形式で1行ずつ入力してください）" }, { status: 400 });
  }

  const teams = parsed.map((p) => addTeam(p.name, p.members));
  return NextResponse.json({ teams, skipped }, { status: 201 });
}
