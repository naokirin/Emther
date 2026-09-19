import { NextResponse } from "next/server";
import { listGrowSuggestions, toGrowSuggestionView } from "@core/em-growth-store";

export async function GET() {
  return NextResponse.json({ suggestions: listGrowSuggestions().map(toGrowSuggestionView) });
}
