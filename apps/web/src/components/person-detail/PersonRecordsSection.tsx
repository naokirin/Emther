import { useState } from "react";
import { Link } from "react-router";
import styles from "../../styles/page.module.css";
import { api, rpcInit } from "../../lib/api-client";
import { PersonJournalComposer } from "./PersonJournalComposer";
import { PersonProfileComposer } from "./PersonProfileComposer";
import { SuggestionLink } from "../SuggestionLink";
import { URGENCY_LABEL, type PersonFact, type PersonProfile, type PersonRelatedSuggestion } from "@emther/core/types";

// sentiment自体は観測値のまま書き換えず、EMが確認済み・対応不要と判断した場合だけ
// 赤い#ネガティブの強調を弱める（Dashboard/Journal一覧のJournalEntryCardと同じ考え方・
// 同じAPI: POST/DELETE /api/journal/[id]/no-action-needed）
// ステータス表示（このコンポーネント）と
// 操作ボタン（FactSentimentAction）を分離し、呼び出し側でUrgencyより後ろ（行末）に
// アクションを配置する
function FactSentimentTag({ fact }: { fact: PersonFact }) {
  if (fact.sentiment !== "negative") {
    return (
      <span className={`${styles.tag} ${fact.sentiment === "positive" ? styles.tagPos : styles.tagNeg}`}>
        #{fact.sentiment === "positive" ? "ポジティブ" : "ネガティブ"}
      </span>
    );
  }

  if (fact.noActionNeededAt) {
    return (
      <span
        className={`${styles.tag} ${styles.tagPerson} ${styles.axisTooltip}`}
        data-tooltip={fact.noActionNeededNote ? `確認済み（対応不要と判断）: ${fact.noActionNeededNote}` : "確認済み（対応不要と判断）"}
        tabIndex={0}
      >
        ✓ ネガティブ（確認済み）
      </span>
    );
  }

  return <span className={`${styles.tag} ${styles.tagNeg}`}>#ネガティブ</span>;
}

function FactSentimentAction({ fact, onChanged }: { fact: PersonFact; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);

  async function toggle(ack: boolean) {
    setBusy(true);
    try {
      if (ack) {
        await api.api.journal[":id"]["no-action-needed"].$post({ param: { id: fact.id } });
      } else {
        await api.api.journal[":id"]["no-action-needed"].$delete({ param: { id: fact.id } });
      }
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (fact.sentiment !== "negative") return null;

  if (fact.noActionNeededAt) {
    return (
      <button className={styles.btnOutline} style={{ padding: "2px 10px", fontSize: "0.75rem" }} disabled={busy} onClick={() => toggle(false)}>
        確認を取り消す
      </button>
    );
  }

  return (
    <button
      className={`${styles.btnOutline} ${styles.axisTooltip}`}
      style={{ padding: "2px 10px", fontSize: "0.75rem" }}
      disabled={busy}
      onClick={() => toggle(true)}
      data-tooltip="確認したが対応は不要だった場合に押してください（出来事の記録自体は変わりません）"
    >
      確認済み/対応不要とする
    </button>
  );
}

// 提案自体の状態は書き換えず
// 「この人物にとって対応不要と確認済み」を人物×提案単位で記録する
// （PATCH /api/people/[id]/concern-acks/[suggestionId]）
function SuggestionConcernTag({
  personId,
  suggestion,
  onChanged,
}: {
  personId: string;
  suggestion: PersonRelatedSuggestion;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle(acknowledged: boolean) {
    setBusy(true);
    try {
      await api.api.people[":id"]["concern-acks"][":suggestionId"].$patch(rpcInit({
        param: { id: personId, suggestionId: suggestion.id },
        json: { acknowledged },
      }));
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!suggestion.concerning) return null;

  if (suggestion.concernAcknowledgedAt) {
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
        <span
          className={`${styles.tableMuted} ${styles.axisTooltip}`}
          data-tooltip={suggestion.concernAcknowledgedNote ? `確認済み（対応不要と判断）: ${suggestion.concernAcknowledgedNote}` : "確認済み（対応不要と判断）"}
          tabIndex={0}
        >
          ✓ 停滞・確認保留（確認済み）
        </span>
        <button className={styles.detailToggle} disabled={busy} onClick={() => toggle(false)}>
          確認を取り消す
        </button>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
      <span style={{ color: "var(--warning, #b45309)" }}>⚠️ 停滞・確認保留あり</span>
      <button
        className={`${styles.detailToggle} ${styles.axisTooltip}`}
        disabled={busy}
        onClick={() => toggle(true)}
        data-tooltip="確認したが対応は不要だった場合に押してください（提案自体の状態は変わりません）"
      >
        確認済み/対応不要とする
      </button>
    </div>
  );
}

export function PersonRecordsSection({
  person,
  onJournalCreated,
  onProfileCreated,
  onRecordChanged,
}: {
  person: PersonProfile;
  onJournalCreated: () => Promise<void> | void;
  onProfileCreated: () => Promise<void> | void;
  onRecordChanged: () => Promise<void> | void;
}) {
  return (
    <>
      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}>長期プロファイル（解釈、TTLなし）</h3>
      <PersonProfileComposer personName={person.name} onCreated={onProfileCreated} />
      {person.interpretations.length === 0 ? (
        <p className={styles.subtitle}>まだ記録がありません。上のフォームから記録できます。</p>
      ) : (
        <div className={styles.tableWrap} style={{ marginBottom: 10 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>内容</th>
                <th>記録日時</th>
              </tr>
            </thead>
            <tbody>
              {person.interpretations.map((i) => (
                <tr key={i.id}>
                  <td>{i.text}</td>
                  <td className={styles.tableMuted}>{new Date(i.occurredAt).toLocaleString("ja-JP")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}>直近のJournal</h3>
      <PersonJournalComposer personName={person.name} onCreated={onJournalCreated} />
      {person.facts.length === 0 ? (
        <p className={styles.subtitle}>関連するJournalはまだありません。上のフォームから記録できます。</p>
      ) : (
        <div className={styles.tableWrap} style={{ marginBottom: 10 }}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>内容</th>
                <th>タグ / 緊急度</th>
                <th>発生日時</th>
                {/* 同じ列に置くとタグの続きに見えてしまうため、操作は独立した列に分ける。 */}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {person.facts.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link to={`/journal?focus=${f.id}`} className={styles.tableRowLink}>
                      {f.text}
                    </Link>
                  </td>
                  <td>
                    <div className={styles.tagRow}>
                      {f.tags.map((t) => (
                        <span key={t} className={`${styles.tag} ${styles.tagTopic}`}>
                          #{t}
                        </span>
                      ))}
                      {f.sentiment && f.sentiment !== "neutral" && <FactSentimentTag fact={f} />}
                      {f.urgency && (
                        <span className={`${styles.urgencyLabel} ${styles[`urgency${f.urgency}`]}`}>{URGENCY_LABEL[f.urgency]}</span>
                      )}
                    </div>
                  </td>
                  <td className={styles.tableMuted}>{new Date(f.occurredAt).toLocaleString("ja-JP")}</td>
                  <td>{f.sentiment === "negative" && <FactSentimentAction fact={f} onChanged={() => void onRecordChanged()} />}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className={styles.subtitle} style={{ marginTop: 4, marginBottom: 10 }}>
        <Link to={`/journal?person=${encodeURIComponent(person.name)}`} className={styles.tableRowLink}>
          {person.name}のJournalをすべて見る →
        </Link>
      </p>

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.875rem" }}>関連提案（EMの確認対象。貢献評価の主経路ではない）</h3>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        提案は AI の判断材料です。メンバー貢献の主材料にはしません（上の評価ログを正とします）。
      </p>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        名前がタイトル・メモに含まれる提案を表示しています（厳密な紐付けではなく名前の一致による簡易抽出です）。
      </p>
      {person.relatedSuggestions.length === 0 ? (
        <p className={styles.subtitle}>関連する提案は見つかりませんでした。</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>タイトル</th>
                <th>概要</th>
              </tr>
            </thead>
            <tbody>
              {person.relatedSuggestions.map((suggestion) => (
                <tr key={suggestion.id}>
                  <td>
                    <SuggestionLink id={suggestion.id} className={styles.tableRowLink}>
                      {suggestion.title}
                    </SuggestionLink>
                    {suggestion.archived && <div className={styles.tableMuted}>🗄 アーカイブ済み</div>}
                    <SuggestionConcernTag personId={person.id} suggestion={suggestion} onChanged={() => void onRecordChanged()} />
                  </td>
                  <td className={styles.tableMuted}>{suggestion.overview}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
