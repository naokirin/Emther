// 進め方のアドバイスの半構造化（AI投入）と、EMの非構造オーバーライドのヘルパー。
// UI・エクスポート・検索は effectiveAdviceText / 構造表示の優先規則に従う。

export type AdviceFollowUp = {
  /** チップに出す短い文言 */
  label: string;
  /** 壁打ちに送る本文 */
  message: string;
};

export type AdviceGroup = {
  /** Markdown 見出し用。複数グループ時にセクション名として使う */
  title?: string;
  /** この塊の文脈・意図（自由文） */
  summary?: string;
  nextActions?: string[];
  watchOuts?: string[];
  verify?: string[];
};

export type AdviceStructured = {
  /** 全体の前置き（任意・自由文） */
  overview?: string;
  groups: AdviceGroup[];
  followUps?: AdviceFollowUp[];
};

/** 提案詳細のアドバイス関連フィールド（表示・編集の優先規則用）。 */
export type AdviceFields = {
  /** @deprecated 旧フリーテキスト。adviceOverride / adviceStructured が無いときのフォールバック */
  advice?: string;
  adviceStructured?: AdviceStructured;
  /** EMが編集した非構造テキスト。あれば表示は常にこちらを優先 */
  adviceOverride?: string;
};

function trimList(items: unknown): string[] {
  if (!Array.isArray(items)) return [];
  return items
    .filter((x): x is string => typeof x === "string" && x.trim().length > 0)
    .map((x) => x.trim());
}

function normalizeFollowUp(raw: unknown): AdviceFollowUp | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as { label?: unknown; message?: unknown };
  const label = typeof o.label === "string" ? o.label.trim() : "";
  const message = typeof o.message === "string" ? o.message.trim() : "";
  if (!label || !message) return undefined;
  return { label, message };
}

function normalizeGroup(raw: unknown): AdviceGroup | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const o = raw as {
    title?: unknown;
    summary?: unknown;
    nextActions?: unknown;
    watchOuts?: unknown;
    verify?: unknown;
  };
  const title = typeof o.title === "string" && o.title.trim() ? o.title.trim() : undefined;
  const summary = typeof o.summary === "string" && o.summary.trim() ? o.summary.trim() : undefined;
  const nextActions = trimList(o.nextActions);
  const watchOuts = trimList(o.watchOuts);
  const verify = trimList(o.verify);
  if (!title && !summary && nextActions.length === 0 && watchOuts.length === 0 && verify.length === 0) {
    return undefined;
  }
  return {
    ...(title ? { title } : {}),
    ...(summary ? { summary } : {}),
    ...(nextActions.length ? { nextActions } : {}),
    ...(watchOuts.length ? { watchOuts } : {}),
    ...(verify.length ? { verify } : {}),
  };
}

/** AI JSON / 永続化から AdviceStructured を正規化。不正・空なら undefined。 */
export function normalizeAdviceStructured(raw: unknown): AdviceStructured | undefined {
  if (raw == null) return undefined;
  if (typeof raw === "string") {
    const t = raw.trim();
    if (!t) return undefined;
    // 旧 string advice を構造化に昇格（overview のみ）
    return { overview: t, groups: [] };
  }
  if (typeof raw !== "object") return undefined;
  const o = raw as {
    overview?: unknown;
    groups?: unknown;
    followUps?: unknown;
    // 単一グループ相当のフラット形式も許容
    title?: unknown;
    summary?: unknown;
    nextActions?: unknown;
    watchOuts?: unknown;
    verify?: unknown;
  };
  const overview = typeof o.overview === "string" && o.overview.trim() ? o.overview.trim() : undefined;
  let groups: AdviceGroup[] = [];
  if (Array.isArray(o.groups)) {
    groups = o.groups.map(normalizeGroup).filter((g): g is AdviceGroup => Boolean(g));
  } else {
    // groups 無しで nextActions 等が直下にある場合は1グループとして扱う
    const flat = normalizeGroup({
      title: o.title,
      summary: o.summary,
      nextActions: o.nextActions,
      watchOuts: o.watchOuts,
      verify: o.verify,
    });
    if (flat) groups = [flat];
  }
  const followUps = Array.isArray(o.followUps)
    ? o.followUps.map(normalizeFollowUp).filter((f): f is AdviceFollowUp => Boolean(f)).slice(0, 4)
    : [];
  if (!overview && groups.length === 0 && followUps.length === 0) return undefined;
  return {
    ...(overview ? { overview } : {}),
    groups,
    ...(followUps.length ? { followUps } : {}),
  };
}

function formatGroupMarkdown(g: AdviceGroup, headingLevel: number): string[] {
  const lines: string[] = [];
  const hashes = "#".repeat(Math.min(Math.max(headingLevel, 1), 6));
  if (g.title) lines.push(`${hashes} ${g.title}`, "");
  if (g.summary) lines.push(g.summary, "");
  if (g.nextActions?.length) {
    lines.push("**やること**", ...g.nextActions.map((a) => `- ${a}`), "");
  }
  if (g.watchOuts?.length) {
    lines.push("**注意点**", ...g.watchOuts.map((a) => `- ${a}`), "");
  }
  if (g.verify?.length) {
    lines.push("**確認・検証**", ...g.verify.map((a) => `- ${a}`), "");
  }
  return lines;
}

/** 構造化アドバイスを読みやすい連結テキストにする（編集ドラフト・エクスポート用）。 */
export function flattenAdviceStructured(structured: AdviceStructured, opts?: { headingLevel?: number }): string {
  const headingLevel = opts?.headingLevel ?? 3;
  const lines: string[] = [];
  if (structured.overview) {
    lines.push(structured.overview, "");
  }
  const multi = structured.groups.length > 1;
  for (const g of structured.groups) {
    lines.push(...formatGroupMarkdown(g, multi ? headingLevel : headingLevel));
  }
  return lines.join("\n").trim();
}

/** 表示・エクスポート・検索用の実効テキスト。override → 旧 advice → 構造化平坦化。 */
export function effectiveAdviceText(fields: AdviceFields | null | undefined): string {
  if (!fields) return "";
  const override = fields.adviceOverride?.trim();
  if (override) return override;
  const legacy = fields.advice?.trim();
  if (legacy) return legacy;
  if (fields.adviceStructured) return flattenAdviceStructured(fields.adviceStructured);
  return "";
}

/** コンパクト目次・リーダー用のグループ見出し文言。 */
export function adviceGroupOutlineLabel(
  group: AdviceGroup,
  index: number,
): string {
  if (group.title?.trim()) return group.title.trim();
  if (group.summary?.trim()) {
    const s = group.summary.trim();
    return s.length > 48 ? `${s.slice(0, 48)}…` : s;
  }
  if (group.nextActions?.[0]?.trim()) {
    const s = group.nextActions[0].trim();
    return s.length > 48 ? `${s.slice(0, 48)}…` : s;
  }
  return `進め方 ${index + 1}`;
}

/** groups に overview 以外の読みどころがあるか（詳細ダイアログを出す判定用）。 */
export function adviceStructuredHasDetails(structured: AdviceStructured | null | undefined): boolean {
  if (!structured?.groups.length) return false;
  return structured.groups.some(
    (g) =>
      Boolean(g.title?.trim()) ||
      Boolean(g.summary?.trim()) ||
      (g.nextActions?.length ?? 0) > 0 ||
      (g.watchOuts?.length ?? 0) > 0 ||
      (g.verify?.length ?? 0) > 0,
  );
}

/** 構造化UIを出すべきか（override / 旧 plain が無いとき）。 */
export function shouldShowStructuredAdvice(fields: AdviceFields | null | undefined): boolean {
  if (!fields) return false;
  if (fields.adviceOverride?.trim()) return false;
  if (fields.advice?.trim()) return false;
  return Boolean(fields.adviceStructured && (fields.adviceStructured.overview || fields.adviceStructured.groups.length > 0));
}

/** マスク／アンマスク用に構造化内の全文字列を列挙。 */
export function adviceStructuredStringFields(structured: AdviceStructured): string[] {
  const out: string[] = [];
  if (structured.overview) out.push(structured.overview);
  for (const g of structured.groups) {
    if (g.title) out.push(g.title);
    if (g.summary) out.push(g.summary);
    if (g.nextActions) out.push(...g.nextActions);
    if (g.watchOuts) out.push(...g.watchOuts);
    if (g.verify) out.push(...g.verify);
  }
  for (const f of structured.followUps ?? []) {
    out.push(f.label, f.message);
  }
  return out;
}

/** 各文字列フィールドに mapFn を適用したコピーを返す。 */
export function mapAdviceStructuredStrings(
  structured: AdviceStructured,
  mapFn: (s: string) => string,
): AdviceStructured {
  return {
    ...(structured.overview ? { overview: mapFn(structured.overview) } : {}),
    groups: structured.groups.map((g) => ({
      ...(g.title ? { title: mapFn(g.title) } : {}),
      ...(g.summary ? { summary: mapFn(g.summary) } : {}),
      ...(g.nextActions?.length ? { nextActions: g.nextActions.map(mapFn) } : {}),
      ...(g.watchOuts?.length ? { watchOuts: g.watchOuts.map(mapFn) } : {}),
      ...(g.verify?.length ? { verify: g.verify.map(mapFn) } : {}),
    })),
    ...(structured.followUps?.length
      ? {
          followUps: structured.followUps.map((f) => ({
            label: mapFn(f.label),
            message: mapFn(f.message),
          })),
        }
      : {}),
  };
}

/** followUps が無い／少ないときに足す定型（表示用。永続化はしない想定でも可）。 */
export const DEFAULT_ADVICE_FOLLOW_UPS: AdviceFollowUp[] = [
  {
    label: "今週の具体タスクに分解して",
    message:
      "この提案の「進め方のアドバイス」を深掘りしたい。次の一手を今週やる具体タスクに分解し、各タスクの注意点も短く付けて。箇条書きで答えて。",
  },
  {
    label: "誰に・いつ・何を話すか具体化して",
    message:
      "この提案の「進め方のアドバイス」を深掘りしたい。誰に・いつ・何を話すか（または確認するか）まで具体化して。箇条書きで答えて。",
  },
  {
    label: "うまくいっているかの見極めを出して",
    message:
      "この提案の「進め方のアドバイス」を深掘りしたい。うまくいっているかの見極め指標を最大3つと、うまくいかないときの早期兆候を出して。箇条書きで答えて。",
  },
];

/** AI followUps と定型をマージ（label 重複は AI 優先、最大4）。 */
export function mergeAdviceFollowUps(ai: AdviceFollowUp[] | undefined, max = 4): AdviceFollowUp[] {
  const seen = new Set<string>();
  const out: AdviceFollowUp[] = [];
  for (const f of [...(ai ?? []), ...DEFAULT_ADVICE_FOLLOW_UPS]) {
    const key = f.label.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(f);
    if (out.length >= max) break;
  }
  return out;
}
