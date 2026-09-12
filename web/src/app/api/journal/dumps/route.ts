import { NextResponse } from "next/server";
import { jsonFromUnknownError, maskOptionsFromBody } from "@/app/api/name-candidate-response";
import { runParseOnDump } from "@/lib/observation-dump-actions";
import { parseImportMappingConfig } from "@/lib/observation-dump-mapping-types";
import {
  createObservationDump,
  isObservationSourceType,
  listObservationDumps,
  toObservationDumpView,
} from "@/lib/observation-dump-store";

// docs/observation_dump_journal.md: Dump 一覧・作成。作成後は既定で分割まで実行する。

export async function GET() {
  const dumps = listObservationDumps().map(toObservationDumpView);
  return NextResponse.json({ dumps });
}

export async function POST(request: Request) {
  const body = await request.json().catch(() => null);
  const text = typeof body?.text === "string" ? body.text : "";
  const sourceType = body?.sourceType;
  const title = typeof body?.title === "string" ? body.title : undefined;
  const parse = body?.parse !== false;
  const mapping = parseImportMappingConfig(body?.mapping);
  const occurredRangeHint =
    body?.occurredRangeHint && typeof body.occurredRangeHint === "object"
      ? {
          start:
            typeof body.occurredRangeHint.start === "string"
              ? body.occurredRangeHint.start
              : undefined,
          end:
            typeof body.occurredRangeHint.end === "string" ? body.occurredRangeHint.end : undefined,
        }
      : undefined;

  if (!text.trim()) {
    return NextResponse.json({ error: "textは必須です" }, { status: 400 });
  }
  if (!isObservationSourceType(sourceType)) {
    return NextResponse.json(
      { error: "sourceTypeは chat_log / meeting_log / other_log のいずれかです" },
      { status: 400 },
    );
  }

  try {
    let dump = await createObservationDump(
      { sourceType, text, title, occurredRangeHint, mapping },
      maskOptionsFromBody(body),
    );
    if (parse) {
      dump = await runParseOnDump(dump.id);
    }
    return NextResponse.json({ dump: toObservationDumpView(dump) }, { status: 201 });
  } catch (err) {
    const message = (err as Error).message;
    if (message.includes("本文(text)")) {
      return NextResponse.json({ error: message }, { status: 400 });
    }
    return jsonFromUnknownError(err);
  }
}
