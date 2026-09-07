"use client";

import { use } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";
import { usePersonProfile } from "@/lib/hooks";
import { URGENCY_LABEL, charterFilledCount } from "@/lib/types";

// docs/memo.md「J. Peopleを第一級ハブに」対応。人物軸でJournal fact・長期プロファイル
// （解釈）・チーム所属・関連Issueを横断して見せる詳細画面。新規の永続化エンティティは
// 持たず、既存ストアを@/lib/people-hub.tsで集約しているだけ（このページ自体はEMの
// 「介入」を行う場所ではなく、辿るための入口——実際の記録・起票は既存の各画面で行う）。
export default function PersonDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { person } = usePersonProfile(id);

  if (!person) {
    return (
      <div className={styles.screen}>
        <div className={styles.panel}>
          <p className={styles.subtitle}>読み込み中、または該当する人物が見つかりませんでした。</p>
          <Link href="/people">← Peopleに戻る</Link>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <Link href="/people" className={styles.subtitle}>
          ← People一覧に戻る
        </Link>
        <h2 style={{ marginTop: 8 }}>{person.name}</h2>
        <p className={styles.subtitle}>
          {person.teamNames.length > 0 ? `所属: ${person.teamNames.join(", ")}` : "所属チームなし"} ／ 直近Journal {person.factCount}件
          {person.trend.positive > 0 && ` ／ 🙂${person.trend.positive}`}
          {person.trend.negative > 0 && ` ／ 🙁${person.trend.negative}`}
        </p>

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

        <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>直近のJournal（一時的な状況、有効期限内のもののみ）</h3>
        {person.facts.length === 0 ? (
          <p className={styles.subtitle}>関連するJournalはありません。</p>
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
                    <td>{f.text}</td>
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

        <h3 style={{ marginTop: 20, marginBottom: 4, fontSize: "0.8125rem" }}>関連Issue</h3>
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
                      <Link href={`/issues/${issue.id}`} className={styles.tableRowLink}>
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
      </div>
    </div>
  );
}
