import { NextResponse } from "next/server";
import { computeOrgVitals } from "@/lib/vitals";

export async function GET() {
  return NextResponse.json(computeOrgVitals());
}
