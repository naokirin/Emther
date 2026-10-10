import { useState } from "react";
import styles from "../../styles/page.module.css";
import { PageTitleRow } from "../../components/HelpLink";
import { api, rpcInit } from "../../lib/api-client";
import { usePeople, useTeams, useWorldModel, useWorldModelUpdates } from "../../lib/queries";
import type { WorldModelElement, WorldModelUpdate } from "@emther/api-contract";

const KIND_LABELS: Record<WorldModelElement["kind"], string> = {
  structure: "構造",
  flow: "仕事・判断の流れ",
  dependency: "依存・ボトルネック",
  dynamic: "繰り返す力学",
  condition: "状態",
  external: "外部要因",
  risk: "リスク",
  relationship: "関係性",
  gap: "意図とのギャップ",
};

const STATUS_LABELS: Record<WorldModelElement["status"], string> = {
  candidate: "候補",
  adopted: "採用",
  pinned: "固定",
  dismissed: "却下",
  stale: "要再確認",
};

const ACTION_LABELS: Record<WorldModelUpdate["action"], string> = {
  confirm: "裏付け",
  contradict: "食い違い",
  refine: "精緻化の提案",
  stale: "古い可能性",
};

const STANCES = {
  work: [
    ["collaboration", "協働の質"],
    ["handoff", "引き継ぎ・境界"],
    ["decision_rights", "決定権の所在"],
    ["information_flow", "情報の流れ"],
  ],
  psychological: [
    ["trust", "信頼"],
    ["tension", "緊張・摩擦"],
    ["psychological_safety", "意見の言いやすさ"],
    ["alignment", "認識・目的の一致"],
  ],
} as const;

const KIND_ORDER = Object.keys(KIND_LABELS) as WorldModelElement["kind"][];

function formatDate(ms: number): string {
  return new Date(ms).toLocaleDateString("ja-JP");
}

function evidenceCount(e: WorldModelElement): number {
  const ev = e.evidence;
  return ev.eventIds.length + ev.journalIds.length + ev.suggestionIds.length + ev.themeIds.length;
}

function PendingUpdate({ update, onChanged }: { update: WorldModelUpdate; onChanged: () => Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const route = api.api["world-model"].updates[":id"];

  async function run(call: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await call();
      if (!res.ok) throw new Error("操作に失敗しました");
      await onChanged();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div style={{ borderLeft: "3px solid var(--border, #ccc)", paddingLeft: 8, margin: "6px 0" }} data-testid="world-model-update">
      <p style={{ margin: 0 }}>
        <strong>{ACTION_LABELS[update.action]}</strong>：{update.reason}
      </p>
      {update.statement && <p className={styles.subtitle} style={{ margin: "2px 0" }}>置き換え案: {update.statement}</p>}
      <div style={{ display: "flex", gap: 6 }}>
        <button
          type="button"
          className={styles.btnOutline}
          disabled={busy}
          onClick={() => run(() => route.apply.$post(rpcInit({ param: { id: update.id } })))}
        >
          {update.action === "confirm" ? "反映（確認済みにする）" : update.statement ? "置き換え案を採用" : "要再確認にする"}
        </button>
        <button
          type="button"
          className={styles.btnOutline}
          disabled={busy}
          onClick={() => run(() => route.dismiss.$post(rpcInit({ param: { id: update.id } })))}
        >
          見送る
        </button>
      </div>
      {error && <p role="alert" className={styles.subtitle}>{error}</p>}
    </div>
  );
}

function ElementCard({
  element,
  updates = [],
  onChanged,
}: {
  element: WorldModelElement;
  updates?: WorldModelUpdate[];
  onChanged: () => Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [statement, setStatement] = useState(element.statement);
  const [note, setNote] = useState(element.userNote ?? "");
  const [noteOpen, setNoteOpen] = useState(false);

  async function run(call: () => Promise<Response>) {
    setBusy(true);
    setError(null);
    try {
      const res = await call();
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "操作に失敗しました");
      }
      await onChanged();
      setEditing(false);
      setNoteOpen(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const id = element.id;
  const route = api.api["world-model"][":id"];
  const isActive = element.status === "adopted" || element.status === "pinned" || element.status === "stale";

  return (
    <article className={styles.panel} style={{ marginBottom: 10 }} data-testid="world-model-element">
      <header style={{ display: "flex", gap: 8, alignItems: "baseline", flexWrap: "wrap" }}>
        <strong>{element.title}</strong>
        <span className={styles.subtitle}>
          {STATUS_LABELS[element.status]}・確度 {element.confidence}・根拠 {evidenceCount(element)} 件
        </span>
      </header>

      {element.relationship && (
        <p className={styles.subtitle} style={{ margin: "4px 0" }}>
          {element.relationship.aspect === "psychological" ? "心理的" : "業務的"}／{element.relationship.stance}：
          {element.relationship.parties.map((p) => p.id).join(" ↔ ")}
        </p>
      )}

      {editing ? (
        <textarea
          aria-label="見立ての訂正"
          value={statement}
          onChange={(e) => setStatement(e.target.value)}
          rows={3}
          style={{ width: "100%" }}
        />
      ) : (
        <p style={{ margin: "6px 0" }}>{element.statement}</p>
      )}

      {updates.map((u) => (
        <PendingUpdate key={u.id} update={u} onChanged={onChanged} />
      ))}

      {element.userNote && !noteOpen && (
        <p className={styles.subtitle} style={{ margin: "4px 0" }}>
          注釈: {element.userNote}
        </p>
      )}
      {noteOpen && (
        <textarea
          aria-label="注釈"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          style={{ width: "100%" }}
        />
      )}

      <p className={styles.subtitle} style={{ margin: "4px 0" }}>
        最終確認 {formatDate(element.lastConfirmedAt)}
        {element.origin === "user" ? "・手動追加" : ""}
      </p>

      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {element.status === "candidate" && (
          <>
            <button type="button" className={styles.btnOutline} disabled={busy} onClick={() => run(() => route.adopt.$post(rpcInit({ param: { id } })))}>
              採用
            </button>
            <button type="button" className={styles.btnOutline} disabled={busy} onClick={() => run(() => route.dismiss.$post(rpcInit({ param: { id } })))}>
              却下
            </button>
          </>
        )}
        {isActive && element.status !== "pinned" && (
          <button type="button" className={styles.btnOutline} disabled={busy} onClick={() => run(() => route.pin.$post(rpcInit({ param: { id } })))}>
            固定
          </button>
        )}
        {element.status === "pinned" && (
          <button type="button" className={styles.btnOutline} disabled={busy} onClick={() => run(() => route.unpin.$post(rpcInit({ param: { id } })))}>
            固定を解除
          </button>
        )}
        {element.status === "stale" && (
          <button type="button" className={styles.btnOutline} disabled={busy} onClick={() => run(() => route.confirm.$post(rpcInit({ param: { id } })))}>
            今も当てはまる
          </button>
        )}
        {element.status !== "dismissed" &&
          (editing ? (
            <button
              type="button"
              className={styles.btnOutline}
              disabled={busy || !statement.trim()}
              onClick={() => run(() => route.revise.$post(rpcInit({ param: { id }, json: { statement } })))}
            >
              訂正を保存
            </button>
          ) : (
            <button type="button" className={styles.btnOutline} disabled={busy} onClick={() => setEditing(true)}>
              訂正
            </button>
          ))}
        {noteOpen ? (
          <button
            type="button"
            className={styles.btnOutline}
            disabled={busy}
            onClick={() => run(() => route.note.$patch(rpcInit({ param: { id }, json: { note } })))}
          >
            注釈を保存
          </button>
        ) : (
          <button type="button" className={styles.btnOutline} disabled={busy} onClick={() => setNoteOpen(true)}>
            注釈
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className={styles.subtitle}>
          {error}
        </p>
      )}
    </article>
  );
}

function AddElementForm({ onCreated }: { onCreated: () => Promise<void> }) {
  const { teams } = useTeams();
  const { people } = usePeople();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<WorldModelElement["kind"]>("flow");
  const [title, setTitle] = useState("");
  const [statement, setStatement] = useState("");
  const [aspect, setAspect] = useState<"work" | "psychological">("work");
  const [stance, setStance] = useState<string>("collaboration");
  const [partyA, setPartyA] = useState("");
  const [partyB, setPartyB] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const partyOptions = [
    ...teams.filter((t) => !t.archived).map((t) => ({ value: `team:${t.id}`, label: `チーム: ${t.name}` })),
    ...people.filter((p) => !p.archived).map((p) => ({ value: `person:${p.id}`, label: `人: ${p.name}` })),
  ];

  function parseParty(v: string) {
    const [type, ...rest] = v.split(":");
    return { type: type as "team" | "person", id: rest.join(":") };
  }

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const json: Record<string, unknown> = { kind, title, statement };
      if (kind === "relationship") {
        json.relationship = { parties: [parseParty(partyA), parseParty(partyB)], aspect, stance };
      }
      const res = await api.api["world-model"].$post({ json } as never);
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? "追加に失敗しました");
      }
      setTitle("");
      setStatement("");
      setOpen(false);
      await onCreated();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <button type="button" className={styles.btnOutline} onClick={() => setOpen(true)}>
        見立てを追加
      </button>
    );
  }

  const canSubmit =
    title.trim() && statement.trim() && (kind !== "relationship" || (partyA && partyB && partyA !== partyB));

  return (
    <form
      className={styles.panel}
      style={{ marginBottom: 12 }}
      onSubmit={(e) => {
        e.preventDefault();
        if (canSubmit && !busy) void submit();
      }}
    >
      <label>
        種別{" "}
        <select value={kind} onChange={(e) => setKind(e.target.value as WorldModelElement["kind"])}>
          {KIND_ORDER.map((k) => (
            <option key={k} value={k}>
              {KIND_LABELS[k]}
            </option>
          ))}
        </select>
      </label>
      {kind === "relationship" && (
        <div style={{ display: "grid", gap: 6, margin: "8px 0" }}>
          <label>
            主体A{" "}
            <select value={partyA} onChange={(e) => setPartyA(e.target.value)}>
              <option value="">選択…</option>
              {partyOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            主体B{" "}
            <select value={partyB} onChange={(e) => setPartyB(e.target.value)}>
              <option value="">選択…</option>
              {partyOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            側面{" "}
            <select
              value={aspect}
              onChange={(e) => {
                const next = e.target.value as "work" | "psychological";
                setAspect(next);
                setStance(STANCES[next][0][0]);
              }}
            >
              <option value="work">業務的</option>
              <option value="psychological">心理的</option>
            </select>
          </label>
          <label>
            観点{" "}
            <select value={stance} onChange={(e) => setStance(e.target.value)}>
              {STANCES[aspect].map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <label style={{ display: "block", margin: "8px 0" }}>
        タイトル
        <input value={title} onChange={(e) => setTitle(e.target.value)} style={{ width: "100%" }} />
      </label>
      <label style={{ display: "block", margin: "8px 0" }}>
        見立て（描写に留め、個人の評価は書かない）
        <textarea value={statement} onChange={(e) => setStatement(e.target.value)} rows={3} style={{ width: "100%" }} />
      </label>
      <div style={{ display: "flex", gap: 6 }}>
        <button type="submit" className={styles.btnOutline} disabled={!canSubmit || busy}>
          追加
        </button>
        <button type="button" className={styles.btnOutline} onClick={() => setOpen(false)}>
          キャンセル
        </button>
      </div>
      {error && <p role="alert" className={styles.subtitle}>{error}</p>}
    </form>
  );
}

// 閲覧と判断のみ。タスク化・進捗管理の操作は持たない。
export function WorldModelPage() {
  const { elements, elementsLoaded, refreshElements: refreshList } = useWorldModel();
  const { updates, refreshUpdates } = useWorldModelUpdates();
  const [showDismissed, setShowDismissed] = useState(false);

  async function refreshElements() {
    await Promise.all([refreshList(), refreshUpdates()]);
  }
  const updatesFor = (id: string) => updates.filter((u) => u.targetId === id);

  const visible = elements.filter((e) => showDismissed || e.status !== "dismissed");
  const candidates = visible.filter((e) => e.status === "candidate");
  const accepted = visible.filter((e) => e.status !== "candidate");

  return (
    <div className={styles.screen}>
      <PageTitleRow title="組織モデル" helpAnchor="world-model" />
      <p className={styles.subtitle}>
        観測から見えている組織の実態の見立てです。採用・訂正・固定したものが、以降の分析と提案の前提になります。
      </p>
      <AddElementForm onCreated={refreshElements} />
      <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: "0.75rem", margin: "4px 0 12px" }}>
        <input type="checkbox" checked={showDismissed} onChange={(e) => setShowDismissed(e.target.checked)} />
        却下済みも表示する
      </label>

      {!elementsLoaded && <p className={styles.subtitle}>読み込み中…</p>}
      {elementsLoaded && visible.length === 0 && (
        <p className={styles.subtitle}>まだ組織モデルの要素がありません。</p>
      )}

      {candidates.length > 0 && (
        <section aria-label="確認待ちの候補">
          <h2 className={styles.title} style={{ fontSize: "1rem" }}>
            確認待ちの候補（{candidates.length}）
          </h2>
          {candidates.map((e) => (
            <ElementCard key={e.id} element={e} updates={updatesFor(e.id)} onChanged={refreshElements} />
          ))}
        </section>
      )}

      {KIND_ORDER.map((kind) => {
        const items = accepted.filter((e) => e.kind === kind);
        if (items.length === 0) return null;
        return (
          <section key={kind} aria-label={KIND_LABELS[kind]}>
            <h2 className={styles.title} style={{ fontSize: "1rem" }}>
              {KIND_LABELS[kind]}
            </h2>
            {items.map((e) => (
              <ElementCard key={e.id} element={e} updates={updatesFor(e.id)} onChanged={refreshElements} />
            ))}
          </section>
        );
      })}
    </div>
  );
}
