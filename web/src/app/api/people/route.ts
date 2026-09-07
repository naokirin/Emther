import { NextResponse } from "next/server";
import { listPersonSummaries } from "@/lib/people-hub";

// docs/memo.md「J. Peopleを第一級ハブに」対応。
export async function GET() {
  return NextResponse.json({ people: listPersonSummaries() });
}
