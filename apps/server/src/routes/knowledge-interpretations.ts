import { Hono } from "hono";
import { listEvents, listInterpretationsForPerson, recordEvent, toEventView } from "@emther/core/knowledge-store";
import { embedText } from "@emther/core/embeddings";
import { getPersonId, maskForStorage, registerName } from "@emther/core/people-directory";

// docs/2nd_architecture/plan.md フェーズ2.5（高リスク バッチ7）: web/src/app/api/knowledge/interpretations/route.ts の移植。
// docs/memo.md「H: 永続化データモデルの設計」対応。「Aさんはリーダー志向がある」のような
// 長期的な解釈（プロファイル）を記録する口。Quick Journal（一時的な出来事＝fact）とは
// 意図的に分離しており、TTLを持たない（訂正されるまで有効）。
export const knowledgeInterpretationsRoute = new Hono()
  .get("/", (c) => {
    const person = c.req.query("person");
    // 未登録の名前でも新規登録しない（GETは副作用を持たない）。未登録なら該当0件を返す。
    const events = person ? (getPersonId(person) ? listInterpretationsForPerson(getPersonId(person)!) : []) : listEvents({ kind: "interpretation" });
    return c.json({ interpretations: events.map(toEventView) });
  })
  .post("/", async (c) => {
    const body = await c.req.json().catch(() => null);
    const person = typeof body?.person === "string" ? body.person.trim() : "";
    const text = typeof body?.text === "string" ? body.text.trim() : "";
    const tags = Array.isArray(body?.tags) ? body.tags.filter((t: unknown): t is string => typeof t === "string") : [];

    if (!person || !text) {
      return c.json({ error: "personとtextは必須です" }, 400);
    }

    // 個人情報の分離（ユーザー指摘対応）: peopleにはPERSON_n IDを、textはmaskForStorageで
    // マスクした状態を保存する。埋め込みはローカル生成・ローカル利用のみなので生のtextで計算する。
    const personId = registerName(person);
    let embedding: number[] | undefined;
    try {
      embedding = await embedText(text);
    } catch {
      embedding = undefined;
    }
    const maskedText = await maskForStorage(text);
    const event = recordEvent({
      kind: "interpretation",
      context: "profile",
      entityType: "person",
      people: [personId],
      text: maskedText,
      tags,
      occurredAt: Date.now(),
      embedding,
    });
    return c.json({ interpretation: toEventView(event) }, 201);
  });
