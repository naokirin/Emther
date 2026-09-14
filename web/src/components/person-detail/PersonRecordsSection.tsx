"use client";

import Link from "next/link";
import styles from "@/app/page.module.css";
import { PersonJournalComposer } from "@/components/person-detail/PersonJournalComposer";
import { URGENCY_LABEL, charterFilledCount, issueOverviewText, type PersonProfile } from "@/lib/types";

export function PersonRecordsSection({
  person,
  onJournalCreated,
}: {
  person: PersonProfile;
  onJournalCreated: () => Promise<void> | void;
}) {
  return (
    <>
      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>長期プロファイル（解釈、TTLなし）</h3>
      {person.interpretations.length === 0 ? (
        <p className={styles.subtitle}>まだ記録がありません。Dashboardの長期プロファイルから記録できます。</p>
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

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>直近のJournal</h3>
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
                      {f.sentiment && f.sentiment !== "neutral" && (
                        <span className={`${styles.tag} ${f.sentiment === "positive" ? styles.tagPos : styles.tagNeg}`}>
                          #{f.sentiment === "positive" ? "ポジティブ" : "ネガティブ"}
                        </span>
                      )}
                      {f.urgency && (
                        <span className={`${styles.urgencyLabel} ${styles[`urgency${f.urgency}`]}`}>{URGENCY_LABEL[f.urgency]}</span>
                      )}
                    </div>
                  </td>
                  <td className={styles.tableMuted}>{new Date(f.occurredAt).toLocaleString("ja-JP")}</td>
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

      <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>関連Issue（EM介入。貢献評価の主経路ではない）</h3>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        Issue は EM の介入単位です。メンバー貢献の主材料にはしません（上の評価ログを正とします）。
      </p>
      <p className={styles.subtitle} style={{ marginBottom: 8 }}>
        名前がタイトル・Why/What/Howに含まれるIssueを表示しています（厳密な紐付けではなく名前の一致による簡易抽出です）。
      </p>
      {person.relatedIssues.length === 0 ? (
        <p className={styles.subtitle}>関連するIssueは見つかりませんでした。</p>
      ) : (
        <div className={styles.tableWrap}>
          <table className={styles.table}>
            <thead>
              <tr>
                <th>タイトル</th>
                <th>Why/What/How</th>
              </tr>
            </thead>
            <tbody>
              {person.relatedIssues.map((issue) => (
                <tr key={issue.id}>
                  <td>
                    <Link
                      href={`/issues/${issue.id}`}
                      className={`${styles.tableRowLink} ${styles.axisTooltip}`}
                      data-tooltip={issueOverviewText(issue.charter)}
                    >
                      {issue.title}
                    </Link>
                    {issue.archived && <div className={styles.tableMuted}>🗄 アーカイブ済み</div>}
                  </td>
                  <td>
                    <span className={charterFilledCount(issue.charter) === 3 ? styles.charterBadgeReady : styles.charterBadgeWarn}>
                      {charterFilledCount(issue.charter)}/3
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
