import { NextResponse } from "next/server";
import { addCheckin, listCheckins, toCheckinView } from "@/lib/em-self-store";
import { dateStringToNoonTimestamp } from "@/lib/journal-date-parser";

export async function GET() {
  return NextResponse.json({ checkins: listCheckins().map(toCheckinView) });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const mood = Number(body?.mood);
  const energy = Number(body?.energy);
  const stress = Number(body?.stress);
  if (!Number.isFinite(mood) || !Number.isFinite(energy) || !Number.isFinite(stress)) {
    return NextResponse.json({ error: "mood/energy/stressは数値である必要があります" }, { status: 400 });
  }
  const note = typeof body?.note === "string" ? body.note : "";

  // 改修依頼「前日分を入れ忘れたときに入れるなどできるように日付指定」対応。
  // createdAtDateは"YYYY-MM-DD"（日付レベルのみ）。省略時は Date.now()。
  let createdAt: number | undefined;
  if (typeof body?.createdAtDate === "string" && body.createdAtDate) {
    createdAt = dateStringToNoonTimestamp(body.createdAtDate);
    if (createdAt === undefined) {
      return NextResponse.json({ error: "createdAtDateの形式が不正です（YYYY-MM-DD）" }, { status: 400 });
    }
  }

  const checkin = await addCheckin({ mood, energy, stress, note, createdAt });
  return NextResponse.json({ checkin: toCheckinView(checkin) }, { status: 201 });
}
