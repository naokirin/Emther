"use client";

import Link from "next/link";
import styles from "@/app/page.module.css";
import { usePeople } from "@/lib/hooks";

// docs/memo.md「J. Peopleを第一級ハブに」対応。新規の永続化エンティティは持たず、
// 既存のJournal fact・解釈・チーム所属・関連Issueを人物軸で束ねて見せるだけの一覧画面。
// 人物の「登録」自体はこの画面からは行わない（Journal記録・チームメンバー登録・長期プロファイル
// 記録の副産物としてpeople-directoryへ自動登録される既存の仕組みをそのまま使う）。
export default function PeoplePage() {
  const { people } = usePeople();
  const sorted = [...people].sort((a, b) => b.factCount - a.factCount || a.name.localeCompare(b.name, "ja"));

  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <h2>People</h2>
        <p className={styles.subtitle}>
          Quick Journal・チームメンバー登録・長期プロファイルを通じて認識された人物の一覧です。クリックすると、その人物に関するJournal・長期プロファイル・関連Issueを横断して確認できます。
        </p>
        {sorted.length === 0 ? (
          <p className={styles.subtitle}>まだ誰も登録されていません。Quick Journalに記録するかチームにメンバーを追加すると、ここに表示されます。</p>
        ) : (
          <div className={styles.runList} style={{ maxHeight: "none" }}>
            {sorted.map((p) => (
              <Link key={p.id} href={`/people/${p.id}`} className={styles.runItem} style={{ display: "block" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
                  <strong>{p.name}</strong>
                  <span className={styles.subtitle}>
                    {p.trend.positive > 0 && `🙂${p.trend.positive} `}
                    {p.trend.negative > 0 && `🙁${p.trend.negative} `}
                    Journal {p.factCount}件
                  </span>
                </div>
                <div className={styles.subtitle}>{p.teamNames.length > 0 ? p.teamNames.join(", ") : "未所属"}</div>
              </Link>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
