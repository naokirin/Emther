import { NextResponse } from "next/server";
import { addCheckin, listCheckins, toCheckinView } from "@/lib/em-self-store";

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
  const checkin = await addCheckin({ mood, energy, stress, note });
  return NextResponse.json({ checkin: toCheckinView(checkin) }, { status: 201 });
}
