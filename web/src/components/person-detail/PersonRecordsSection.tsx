"use client";

import { useState } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { PersonJournalComposer } from "@/components/person-detail/PersonJournalComposer";
import { PersonProfileComposer } from "@/components/person-detail/PersonProfileComposer";
import { SuggestionLink } from "@/components/SuggestionLink";
import { URGENCY_LABEL, type PersonFact, type PersonProfile, type PersonRelatedIssue } from "@/lib/types";

// ユーザー指摘「確認したが対応不要だった、を示せず#ネガティブの強調を減らせない」対応。
// sentiment自体は観測値のまま書き換えず、EMが確認済み・対応不要と判断した場合だけ、
// 赤い#ネガティブの強調を弱める（Dashboard/Journal一覧のJournalEntryCardと同じ考え方・
// 同じAPI: POST/DELETE /api/journal/[id]/no-action-needed）。
// ユーザー指摘「タグやステータスの情報のところにアクションを混ぜてしまっているのが問題。
// 行の右端のほうに分けて配置してほしい」対応。ステータス表示（このコンポーネント）と
// 操作ボタン（FactSentimentAction）を分離し、呼び出し側でUrgencyより後ろ（行末）に
// アクションを配置する。
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
        className={`${styles.tag} ${styles.tagPerson}`}
        title={fact.noActionNeededNote ? `確認済み（対応不要と判断）: ${fact.noActionNeededNote}` : "確認済み（対応不要と判断）"}
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
      await fetch(`/api/journal/${fact.id}/no-action-needed`, { method: ack ? "POST" : "DELETE" });
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
      className={styles.btnOutline}
      style={{ padding: "2px 10px", fontSize: "0.75rem" }}
      disabled={busy}
      onClick={() => toggle(true)}
      title="確認したが対応は不要だった場合に押してください（出来事の記録自体は変わりません）"
    >
      確認済み/対応不要とする
    </button>
  );
}

// ユーザー指摘「メンバーのアラート表示（関連Issueの停滞・ブロッカー）を確認したが
// 対応不要だった、を示せず強調を減らせない」対応。Issue自体の状態は書き換えず、
// 「この人物にとって対応不要と確認済み」を人物×Issue単位で記録する
// （PATCH /api/people/[id]/concern-acks/[issueId]）。
function IssueConcernTag({
  personId,
  issue,
  onChanged,
}: {
  personId: string;
  issue: PersonRelatedIssue;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);

  async function toggle(acknowledged: boolean) {
    setBusy(true);
    try {
      await fetch(`/api/people/${personId}/concern-acks/${issue.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ acknowledged }),
      });
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  if (!issue.concerning) return null;

  if (issue.concernAcknowledgedAt) {
    return (
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 4 }}>
        <span
          className={styles.tableMuted}
          title={issue.concernAcknowledgedNote ? `確認済み（対応不要と判断）: ${issue.concernAcknowledgedNote}` : "確認済み（対応不要と判断）"}
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
        className={styles.detailToggle}
        disabled={busy}
        onClick={() => toggle(true)}
        title="確認したが対応は不要だった場合に押してください（提案自体の状態は変わりません）"
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
                {/* ユーザー指摘「メンバー詳細のJournal一覧ではまだタグ等と混ざって表示されている」
                    対応。同じ列に置くと折り返し表示上は分かれていてもタグの続きに見えてしまう
                    ため、操作は独立した列に分ける（Journal一覧のJournalEntryCardと同じ、
                    情報とアクションを分離する考え方）。 */}
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {person.facts.map((f) => (
                <tr key={f.id}>
                  <td>
                    <Link href={`/journal?focus=${f.id}`} className={styles.tableRowLink}>
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
        <Link href={`/journal?person=${encodeURIComponent(person.name)}`} className={styles.tableRowLink}>
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
      {person.relatedIssues.length === 0 ? (
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
              {person.relatedIssues.map((issue) => (
                <tr key={issue.id}>
                  <td>
                    <SuggestionLink id={issue.id} className={styles.tableRowLink}>
                      {issue.title}
                    </SuggestionLink>
                    {issue.archived && <div className={styles.tableMuted}>🗄 アーカイブ済み</div>}
                    <IssueConcernTag personId={person.id} issue={issue} onChanged={() => void onRecordChanged()} />
                  </td>
                  <td className={styles.tableMuted}>{issue.overview}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
