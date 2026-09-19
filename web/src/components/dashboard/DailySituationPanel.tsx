"use client";

import styles from "@/app/page.module.css";
import type { DailySituation, SituationItem } from "@/lib/daily-situation";
import type { VitalStatus } from "@core/types";

// docs/2nd_pivot_version.md Phase 1対応。
// docs/2nd_pivot_version/pivot_policy.md「目指すUX」の6項目
// （昨日から変わったこと／気になる兆候／良い状態／評価できないこと／過去との比較／
// 判断する価値がありそうなこと）を見せる。「AIが答えを決める」のではなく
// 「判断材料を並べる」ことに徹するため、各項目は事実の要約だけを置き、
// 対応要否の判定はEMに委ねる。
//
// デザイン見直し（ユーザー指摘「テキスト・バイタル・ステータスが同じレイアウトの
// カードに入っている」）対応。気になる兆候／良い状態／評価できないことの3つは
// 実体としては同じ「Team/PersonのVitalsステータス」であり、文章カードに並べると
// 同じ見た目の箱が量産されて情報の種類が埋もれていた。TeamStatePanelのvitalCardと
// 同じ🟢🟡🔴⚪の色分けを使ったチップ1本にまとめ、文章（昨日から変わったこと／
// 過去との比較）とは別の見た目にする。判断する価値がありそうなことは
// TodayActionsPanelと内容が重複するため、ここでは先頭1件だけのティーザーに留める。
//
// ユーザー指摘「Journalもチップ化されている／リンク先とチップのテキストが違う」対応。
// 緊急ネガティブJournal（concernsに混ざっていた個別の出来事）はTeam/Personの
// ような継続的な状態ではないため、チップから外し「気になる兆候（出来事）」という
// 文章カードへ分離した。
//
// ユーザー指摘「過去との比較は常に1行しかない／昨日から変わったこと・気になる兆候
// （出来事）は2段組みで幅を使いたい」対応。過去との比較は他と同じカードにせず、
// カード化しない全幅の1本（.situationCompareRow）にする。昨日から変わったこと／
// 気になる兆候（出来事）は、小さいカードが並ぶグリッドではなく既存の.dashColumns
// （固定2カラム）でウィンドウ幅いっぱいを使い、長文でも読みやすくする。

const STATUS_ICON: Record<VitalStatus, string> = { good: "🟢", warn: "🟡", bad: "🔴", unknown: "⚪️" };
const STATUS_ORDER: Record<VitalStatus, number> = { bad: 0, warn: 1, unknown: 2, good: 3 };

// ユーザー指摘「ツールチップを全体的にカスタムのものにしてほしい」対応。ネイティブ
// title（表示が遅い・改行やスタイルを制御できない）ではなく、IssueStatus.tsxの
// AxisTooltipと同じ.axisTooltip（data-tooltip属性を読むCSSカスタムツールチップ）に揃える。
function StatusChip({ item }: { item: SituationItem }) {
  const status = item.status ?? "unknown";
  const className = `${styles.situationChip} ${styles[`situationChip-${status}`]} ${styles.axisTooltip}`;
  const tooltip = item.detail ?? item.text;
  const body = (
    <>
      <span aria-hidden>{STATUS_ICON[status]}</span>
      <span className={styles.situationChipText}>{item.text}</span>
    </>
  );
  if (!item.onSelect) {
    return (
      <span className={className} data-tooltip={tooltip} tabIndex={0}>
        {body}
      </span>
    );
  }
  return (
    <button type="button" className={className} data-tooltip={tooltip} onClick={item.onSelect}>
      {body}
    </button>
  );
}

function NarrativeList({ items, emptyText }: { items: SituationItem[]; emptyText: string }) {
  if (items.length === 0) return <p className={styles.situationEmpty}>{emptyText}</p>;
  return (
    <ul className={styles.situationList}>
      {items.map((item) => (
        <li key={item.id} className={styles.situationItem}>
          {item.onSelect ? (
            <button type="button" className={styles.situationItemBtn} onClick={item.onSelect}>
              {item.text}
            </button>
          ) : (
            item.text
          )}
        </li>
      ))}
    </ul>
  );
}

type Props = {
  situation: DailySituation;
  loaded: boolean;
  onSeeAllDecisions: () => void;
};

export function DailySituationPanel({ situation, loaded, onSeeAllDecisions }: Props) {
  if (!loaded) {
    return (
      <div className={styles.panel}>
        <h2>今日の状況</h2>
        <p className={styles.subtitle}>読み込み中…</p>
      </div>
    );
  }

  // ユーザー指摘「Journalもチップ化されている／リンク先とチップのテキストが違う」対応。
  // Team/PersonのVitals（継続的な状態）だけをチップにする。concernsには緊急ネガティブ
  // Journal（個別の出来事、statusを持たない）も混ざっているため、statusの有無で分ける。
  const allStatusItems = [...situation.concerns, ...situation.unevaluable, ...situation.good].filter(
    (item): item is SituationItem & { status: NonNullable<SituationItem["status"]> } => item.status !== undefined,
  );
  // ユーザー指摘「チーム・メンバーが混合で並んでいる」対応。entityKindで段落を分ける。
  const byStatus = (a: SituationItem, b: SituationItem) => STATUS_ORDER[a.status!] - STATUS_ORDER[b.status!];
  const isCoverageChip = (item: SituationItem) => item.id === "good-coverage" || item.id === "unevaluable-coverage";
  // ユーザー指摘「1on1 Coverageチップをチームの並びの先頭にしてほしい」対応。組織全体の
  // 指標であり特定チームのstatusには依らないため、status順ソートとは別にチーム内で
  // 常に先頭へ固定する。
  const teamChipsSorted = allStatusItems.filter((item) => item.entityKind === "team" && !isCoverageChip(item)).sort(byStatus);
  const coverageChip = allStatusItems.find((item) => item.entityKind === "team" && isCoverageChip(item));
  const teamChips = coverageChip ? [coverageChip, ...teamChipsSorted] : teamChipsSorted;
  const personChips = allStatusItems.filter((item) => item.entityKind === "person").sort(byStatus);
  const concerningEvents = situation.concerns.filter((item) => item.status === undefined);
  const worthDecidingRest = situation.worthDeciding.length - 1 + situation.worthDecidingOverflow;

  return (
    <div className={styles.panel}>
      <h2>今日の状況</h2>
      <p className={styles.subtitle}>AIが観測・解釈した材料です。判断はEM自身が行ってください。</p>

      {/* 表示順見直し対応。「今日やるべき3つ」のすぐ下で目に入るよう、判断する価値が
          ありそうなことを今日の状況の先頭に置く（独立パネルには切り出さず、既存の
          今日の状況カード内に収めて色付きパネルの増加を避ける）。 */}
      <div className={styles.situationDecisionTeaser}>
        <span className={styles.situationCardTitle}>判断する価値がありそうなこと</span>
        {situation.worthDeciding.length === 0 ? (
          <p className={styles.situationEmpty}>今すぐ判断が必要な項目はありません</p>
        ) : (
          <>
            <button type="button" className={styles.situationItemBtn} onClick={situation.worthDeciding[0].onSelect}>
              {situation.worthDeciding[0].text}
            </button>
            {worthDecidingRest > 0 && (
              <button type="button" className={styles.situationMore} onClick={onSeeAllDecisions}>
                ほか{worthDecidingRest}件 → 今日やるべきことへ
              </button>
            )}
          </>
        )}
      </div>

      <div className={styles.situationStatusBlock}>
        <span className={styles.situationCardHint}>チーム・メンバーの状態（気になる・良い・評価できない）</span>
        {teamChips.length === 0 && personChips.length === 0 ? (
          <p className={styles.situationEmpty}>状態を判断できる材料がまだありません</p>
        ) : (
          <>
            <div className={styles.situationChipGroup}>
              <span className={styles.situationChipGroupLabel}>チーム</span>
              {teamChips.length === 0 ? (
                <span className={styles.situationChipGroupEmpty}>—</span>
              ) : (
                <div className={styles.situationChipRow}>
                  {teamChips.map((item) => (
                    <StatusChip key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
            <div className={styles.situationChipGroup}>
              <span className={styles.situationChipGroupLabel}>メンバー</span>
              {personChips.length === 0 ? (
                <span className={styles.situationChipGroupEmpty}>—</span>
              ) : (
                <div className={styles.situationChipRow}>
                  {personChips.map((item) => (
                    <StatusChip key={item.id} item={item} />
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      <div className={styles.situationCompareRow}>
        <span className={styles.situationCardTitle}>過去との比較</span>
        <NarrativeList items={situation.comparisons} emptyText="比較できる過去データがまだありません" />
      </div>

      <div className={styles.dashColumns}>
        <div className={styles.situationCard}>
          <div className={styles.situationCardHead}>
            <span className={styles.situationCardTitle}>昨日から変わったこと</span>
            <span className={styles.situationCardHint}>直近24時間の記録</span>
          </div>
          <NarrativeList items={situation.changes} emptyText="直近24時間の新しい記録はありません" />
        </div>

        <div className={styles.situationCard}>
          <div className={styles.situationCardHead}>
            <span className={styles.situationCardTitle}>気になる兆候（出来事）</span>
            <span className={styles.situationCardHint}>緊急度high・未対応のJournal</span>
          </div>
          <NarrativeList items={concerningEvents} emptyText="気になる出来事の記録はありません" />
        </div>
      </div>
    </div>
  );
}
