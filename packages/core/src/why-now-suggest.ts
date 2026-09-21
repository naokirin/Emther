import { extractFirstJsonObject } from "./local-model";
import { runCloudChat } from "./cloud-chat";

// docs/design/dashboard/today-tab.pen 改善案A対応。「今日やるべき3つ」の「なぜ今」を
// AI（失敗時はヒューリスティック）で生成する。永続化はしない（都度生成）。
// link-suggest と同じ cloud + heuristic フォールバック構成。

export type WhyNowSource = "cloud" | "heuristic";

export type WhyNowActionInput = {
  id: string;
  text: string;
  lane: "decision" | "observation" | "maintenance";
  severity: "urgent" | "warn";
  kindLabel: string;
  /** 根拠発生からの経過日数（0=今日） */
  elapsedDays: number;
};

export type WhyNowItem = {
  actionId: string;
  whyNow: string;
};

export type WhyNowSuggestResult = {
  items: WhyNowItem[];
  source: WhyNowSource;
  fallbackReason?: string;
};

const SYSTEM_PROMPT = [
  "あなたはエンジニアリングマネージャー向けの朝のトリアージ補助です。",
  "各行動について「なぜ今向き合うべきか」を日本語1文で書いてください。",
  "説明・前置き・Markdownフェンスは書かず、JSONオブジェクト1つだけを出力してください。",
  'フォーマット: {"items":[{"actionId":string,"whyNow":string}]}',
  "whyNow は「なぜ今: 」を付けず本文だけ。入力に無い事実は捏造しない。経過日・レーン・緊急度を根拠にしてよい。",
  "1文は40〜80文字程度。",
].join("\n");

const LANE_HINT: Record<WhyNowActionInput["lane"], string> = {
  decision: "今決めれば組織が前に進む",
  observation: "決める前に事実が足りない",
  maintenance: "急ぎではないが整えておくとよい",
};

export function heuristicWhyNow(action: WhyNowActionInput): string {
  const elapsed =
    action.elapsedDays <= 0 ? "今日浮上した" : action.elapsedDays === 1 ? "昨日から続いている" : `${action.elapsedDays}日続いている`;
  if (action.lane === "observation") {
    return `${elapsed}。${LANE_HINT.observation}ため、先に材料を足す`;
  }
  if (action.severity === "urgent") {
    return `${elapsed}。放置すると影響が広がる可能性があるため、今決める`;
  }
  if (action.lane === "maintenance") {
    return `${elapsed}。${LANE_HINT.maintenance}`;
  }
  return `${elapsed}。${LANE_HINT.decision}`;
}

function parseCloudItems(raw: unknown, inputs: WhyNowActionInput[]): WhyNowItem[] {
  if (!raw || typeof raw !== "object") return [];
  const list = (raw as { items?: unknown }).items;
  if (!Array.isArray(list)) return [];
  const byId = new Map(inputs.map((a) => [a.id, a]));
  const out: WhyNowItem[] = [];
  for (const row of list) {
    if (!row || typeof row !== "object") continue;
    const actionId = typeof (row as { actionId?: unknown }).actionId === "string" ? (row as { actionId: string }).actionId : "";
    const whyNowRaw = typeof (row as { whyNow?: unknown }).whyNow === "string" ? (row as { whyNow: string }).whyNow.trim() : "";
    if (!actionId || !byId.has(actionId) || !whyNowRaw) continue;
    const whyNow = whyNowRaw.replace(/^なぜ今[:：]\s*/, "");
    out.push({ actionId, whyNow });
  }
  return out;
}

function fillMissing(items: WhyNowItem[], inputs: WhyNowActionInput[]): WhyNowItem[] {
  const covered = new Set(items.map((i) => i.actionId));
  const filled = [...items];
  for (const a of inputs) {
    if (!covered.has(a.id)) filled.push({ actionId: a.id, whyNow: heuristicWhyNow(a) });
  }
  return filled;
}

export async function suggestWhyNow(actions: WhyNowActionInput[]): Promise<WhyNowSuggestResult> {
  const targets = actions.filter((a) => typeof a.id === "string" && a.id && typeof a.text === "string").slice(0, 5);
  if (targets.length === 0) {
    return { items: [], source: "heuristic", fallbackReason: "no_actions" };
  }

  const heuristicItems = targets.map((a) => ({ actionId: a.id, whyNow: heuristicWhyNow(a) }));

  const userBlock = targets
    .map((a) =>
      [
        `- actionId=${a.id}`,
        `  text: ${a.text}`,
        `  lane: ${a.lane}（${LANE_HINT[a.lane]}）`,
        `  severity: ${a.severity}`,
        `  kind: ${a.kindLabel}`,
        `  elapsedDays: ${a.elapsedDays}`,
      ].join("\n"),
    )
    .join("\n");

  let fallbackReason: string | undefined;
  try {
    const content = await runCloudChat(SYSTEM_PROMPT, ["今日向き合う候補:", userBlock].join("\n"), {
      timeoutMs: 45_000,
    });
    const jsonText = extractFirstJsonObject(content);
    if (!jsonText) {
      fallbackReason = "cloud_response_had_no_json";
      console.warn(`[why-now-suggest] ${fallbackReason}`);
      return { items: heuristicItems, source: "heuristic", fallbackReason };
    }
    try {
      const cloud = parseCloudItems(JSON.parse(jsonText), targets);
      if (cloud.length === 0) {
        fallbackReason = "cloud_json_parsed_but_no_valid_items";
        console.warn(`[why-now-suggest] ${fallbackReason}`);
        return { items: heuristicItems, source: "heuristic", fallbackReason };
      }
      return { items: fillMissing(cloud, targets), source: "cloud" };
    } catch (err) {
      fallbackReason = `cloud_json_parse_error: ${(err as Error).message}`;
      console.warn(`[why-now-suggest] ${fallbackReason}`);
      return { items: heuristicItems, source: "heuristic", fallbackReason };
    }
  } catch (err) {
    fallbackReason = `cloud_error: ${(err as Error).message}`;
    console.warn(`[why-now-suggest] heuristic fallback — ${fallbackReason}`);
    return { items: heuristicItems, source: "heuristic", fallbackReason };
  }
}
