import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import {
  isThemeGoalUnlinked,
  type Goal,
  type OrgStrategy,
  type OrgTheme,
  type PolicyEntry,
} from "@emther/core/types";
import styles from "../../styles/page.module.css";
import { OrgEmptyGuidance, type OrgEmptyKind } from "./OrgEmptyGuidance";
import { treeTitle } from "./treeTitle";

type Props = {
  strategy: OrgStrategy;
  strategyLoaded: boolean;
  goals: Goal[];
  goalsLoaded: boolean;
  policies: PolicyEntry[];
  policiesLoaded: boolean;
  themes: OrgTheme[];
  themesLoaded: boolean;
  onPlaceDraft: (kind: OrgEmptyKind) => void;
  onOpenThemes: () => void;
};

const HORIZON_LABEL: Record<string, string> = {
  long: "遠い",
  mid: "中間",
  near: "近い",
};

const SCAN_SCALE_MIN = 0.5;
const SCAN_SCALE_MAX = 1.75;
const SCAN_SCALE_STEP = 0.15;

function splitValues(strategy: { values: string; valueItems?: { statement: string; elaboration?: string }[] }): {
  statement: string;
  elaboration?: string;
}[] {
  if (strategy.valueItems && strategy.valueItems.length > 0) {
    return strategy.valueItems;
  }
  return strategy.values
    .split(/[\n,、]/)
    .map((v) => v.trim())
    .filter(Boolean)
    .map((statement) => ({ statement }));
}

function shortText(text: string, max = 48): string {
  const t = text.trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function goalLabel(index: number): string {
  return `G${index + 1}`;
}

function clampScanScale(n: number): number {
  return Math.min(SCAN_SCALE_MAX, Math.max(SCAN_SCALE_MIN, Math.round(n * 100) / 100));
}

/** Goal→Theme / MVV→Goal の縦辺（スキャン・フォーカス共通） */
function EdgeArrow({ tone = "green" }: { tone?: "green" | "blue" }) {
  return (
    <div
      className={`${styles.orgScanEdge} ${tone === "blue" ? styles.orgScanEdgeBlue : ""}`}
      aria-hidden="true"
    >
      <svg className={styles.orgScanEdgeSvg} viewBox="0 0 20 26" width="20" height="26">
        <line
          x1="10"
          y1="1"
          x2="10"
          y2="15"
          stroke="currentColor"
          strokeWidth="2.25"
          strokeLinecap="round"
        />
        <path d="M5 13 L10 24 L15 13 Z" fill="currentColor" />
      </svg>
    </div>
  );
}

const EDGE_COLORS = {
  green: "#22c55e",
  blue: "#7fb0ff",
} as const;

/** 上中央から N 列へ枝分かれする辺（MVV→Goals / Goal→Themes） */
function FanEdges({ count, tone }: { count: number; tone: "green" | "blue" }) {
  const color = EDGE_COLORS[tone];
  if (count <= 0) return null;
  if (count === 1) {
    return <EdgeArrow tone={tone} />;
  }

  const w = Math.max(count * 120, 240);
  const h = 36;
  const midX = w / 2;
  const stemY = 12;
  const targets = Array.from({ length: count }, (_, i) => ((i + 0.5) / count) * w);

  return (
    <svg
      className={styles.orgFocusBranchSvg}
      viewBox={`0 0 ${w} ${h}`}
      width="100%"
      height={h}
      aria-hidden="true"
    >
      <line
        x1={midX}
        y1={0}
        x2={midX}
        y2={stemY}
        stroke={color}
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      <line
        x1={targets[0]}
        y1={stemY}
        x2={targets[targets.length - 1]}
        y2={stemY}
        stroke={color}
        strokeWidth="2.25"
        strokeLinecap="round"
      />
      {targets.map((tx) => (
        <g key={tx}>
          <line
            x1={tx}
            y1={stemY}
            x2={tx}
            y2={h - 10}
            stroke={color}
            strokeWidth="2.25"
            strokeLinecap="round"
          />
          <path d={`M${tx - 5} ${h - 11} L${tx} ${h - 1} L${tx + 5} ${h - 11} Z`} fill={color} />
        </g>
      ))}
    </svg>
  );
}

/** Goal から Themes へ枝分かれする辺 */
function BranchEdges({ count }: { count: number }) {
  if (count <= 0) {
    return (
      <div className={styles.orgFocusBranchEmpty}>
        <EdgeArrow tone="green" />
        <p className={styles.orgFocusEmptyThemes}>紐づく Theme はまだない</p>
      </div>
    );
  }
  return <FanEdges count={count} tone="green" />;
}

function ScanZoomBar({
  scale,
  onZoomOut,
  onZoomIn,
  onFit,
}: {
  scale: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  onFit: () => void;
}) {
  return (
    <div className={styles.orgScanZoomBar} role="group" aria-label="スキャン表示">
      <button
        type="button"
        className={styles.orgScanZoomBtn}
        onClick={onZoomOut}
        disabled={scale <= SCAN_SCALE_MIN}
        aria-label="縮小"
      >
        −
      </button>
      <span className={styles.orgScanZoomLevel}>スキャン</span>
      <button
        type="button"
        className={styles.orgScanZoomBtn}
        onClick={onZoomIn}
        disabled={scale >= SCAN_SCALE_MAX}
        aria-label="拡大"
      >
        ＋
      </button>
      <button type="button" className={styles.orgScanFitBtn} onClick={onFit}>
        フィット
      </button>
    </div>
  );
}

export function OrgOverviewPanel({
  strategy,
  strategyLoaded,
  goals,
  goalsLoaded,
  policies,
  policiesLoaded,
  themes,
  themesLoaded,
  onPlaceDraft,
  onOpenThemes,
}: Props) {
  const [focusGoalId, setFocusGoalId] = useState<string | null>(null);
  const [scanScale, setScanScale] = useState(1);
  const scanViewportRef = useRef<HTMLDivElement>(null);
  const scanContentRef = useRef<HTMLDivElement>(null);

  const activeGoals = useMemo(
    () => goals.filter((g) => g.status === "active").sort((a, b) => b.updatedAt - a.updatedAt),
    [goals],
  );
  const activePolicies = useMemo(() => policies.filter((p) => !p.archivedAt), [policies]);
  const adoptedThemes = useMemo(() => themes.filter((t) => t.status === "adopted"), [themes]);

  const themesByGoal = useMemo(() => {
    const map = new Map<string, OrgTheme[]>();
    for (const g of activeGoals) map.set(g.id, []);
    for (const t of adoptedThemes) {
      for (const gid of t.goalIds ?? []) {
        const list = map.get(gid);
        if (list) list.push(t);
      }
    }
    return map;
  }, [activeGoals, adoptedThemes]);

  const orphanThemes = useMemo(
    () => adoptedThemes.filter((t) => isThemeGoalUnlinked(t)),
    [adoptedThemes],
  );

  const hasMvv = !!(strategy.mission || strategy.vision || strategy.values);
  const loaded = strategyLoaded && goalsLoaded && policiesLoaded && themesLoaded;

  const emptyKinds: OrgEmptyKind[] = [];
  if (loaded) {
    if (!hasMvv) emptyKinds.push("mvv");
    if (activeGoals.length === 0) emptyKinds.push("goals");
    if (activePolicies.length === 0) emptyKinds.push("policies");
    if (adoptedThemes.length === 0) emptyKinds.push("themes");
  }

  const fitScan = () => {
    // フィット = 自然サイズ（scale 1）。幅はレイアウトで viewport に収める。
    // 一律 zoom で縮小すると文字・余白の指定が打ち消されるため使わない。
    setScanScale(1);
    scanViewportRef.current?.scrollTo({ top: 0, left: 0 });
  };

  useEffect(() => {
    if (focusGoalId) return;
    setScanScale(1);
  }, [focusGoalId, activeGoals.length, adoptedThemes.length, hasMvv, loaded]);

  const focusIndex = focusGoalId ? activeGoals.findIndex((g) => g.id === focusGoalId) : -1;
  const focusGoal = focusIndex >= 0 ? activeGoals[focusIndex] : null;
  const focusThemes = focusGoal ? (themesByGoal.get(focusGoal.id) ?? []) : [];
  const siblingGoals = focusGoal
    ? activeGoals.map((g, i) => ({ g, i })).filter(({ g }) => g.id !== focusGoal.id)
    : [];
  const prevGoal = focusIndex > 0 ? activeGoals[focusIndex - 1] : null;
  const nextGoal =
    focusIndex >= 0 && focusIndex < activeGoals.length - 1 ? activeGoals[focusIndex + 1] : null;
  const mvvStatement = strategy.mission || strategy.vision || "";

  if (focusGoal) {
    const gLabel = goalLabel(focusIndex);
    const horizon = focusGoal.horizon
      ? `${HORIZON_LABEL[focusGoal.horizon] ?? focusGoal.horizon}Goal`
      : null;

    return (
      <div className={styles.orgOverview}>
        <div className={styles.orgFocusHead}>
          <div className={styles.orgFocusHeadTitles}>
            <h2 className={styles.orgOverviewTitle}>いまのレンズ</h2>
          </div>
          <div className={styles.orgFocusHeadTools}>
            <button
              type="button"
              className={`${styles.btnOutline} ${styles.orgFocusBack}`}
              onClick={() => setFocusGoalId(null)}
            >
              ← スキャンへ
            </button>
            <span className={styles.orgFocusBadge}>{gLabel} フォーカス</span>
          </div>
        </div>

        {siblingGoals.length > 0 ? (
          <div className={styles.orgFocusSiblings}>
            <span className={styles.orgFocusSiblingsLabel}>他の Goal</span>
            {siblingGoals.map(({ g, i }) => (
              <button
                key={g.id}
                type="button"
                className={styles.orgFocusSiblingChip}
                onClick={() => setFocusGoalId(g.id)}
                title={g.title}
              >
                {goalLabel(i)} {shortText(treeTitle(g.title), 10)}
              </button>
            ))}
          </div>
        ) : null}

        <div className={styles.orgFocusCanvas}>
          {prevGoal ? (
            <button
              type="button"
              className={`${styles.orgFocusGhost} ${styles.orgFocusGhostL}`}
              onClick={() => setFocusGoalId(prevGoal.id)}
              aria-label={`前の Goal ${goalLabel(focusIndex - 1)}`}
            >
              {goalLabel(focusIndex - 1)}
            </button>
          ) : (
            <span className={styles.orgFocusGhostSpacer} aria-hidden="true" />
          )}

          <div className={styles.orgFocusMap}>
            {mvvStatement ? (
              <div className={styles.orgFocusMvv}>
                <span className={styles.orgFocusMvvKind}>MVV · 錨</span>
                <p className={styles.orgFocusMvvStmt}>{shortText(mvvStatement, 64)}</p>
              </div>
            ) : null}

            {mvvStatement ? <EdgeArrow tone="blue" /> : null}

            <div className={styles.orgFocusGoalCard}>
              <div className={styles.orgFocusGoalMeta}>
                <span className={styles.orgFocusGoalId}>{gLabel} · フォーカス中</span>
                {horizon ? <span className={styles.orgFocusGoalHorizon}>{horizon}</span> : null}
              </div>
              <p className={styles.orgFocusGoalStmt}>{focusGoal.title}</p>
              {focusGoal.elaboration ? (
                <p className={styles.orgFocusGoalElab}>{focusGoal.elaboration}</p>
              ) : null}
            </div>

            <BranchEdges count={focusThemes.length} />

            {focusThemes.length > 0 ? (
              <div
                className={styles.orgFocusThemeRow}
                style={
                  {
                    ["--org-focus-theme-cols" as string]: focusThemes.length,
                  } as CSSProperties
                }
              >
                {focusThemes.map((t) => (
                  <div key={t.id} className={styles.orgFocusThemeNode}>
                    <span className={styles.orgFocusThemeKind}>Theme · EMの焦点</span>
                    <p className={styles.orgFocusThemeStmt}>{t.title}</p>
                    {t.summary ? (
                      <p className={styles.orgFocusThemeElab}>{shortText(t.summary, 48)}</p>
                    ) : null}
                  </div>
                ))}
              </div>
            ) : null}

            <div className={styles.orgFocusPolicyRail}>
              <span className={styles.orgFocusPolicyLabel}>
                Policy 横断（全体共通・フォーカス外でも参照可）
                {activePolicies.length > 0 ? ` · ${activePolicies.length}` : ""}
              </span>
              {activePolicies.length > 0 ? (
                <div className={styles.orgFocusPolicyItems}>
                  {activePolicies.slice(0, 4).map((p) => (
                    <span key={p.id} title={p.elaboration}>
                      {shortText(p.text, 36)}
                    </span>
                  ))}
                </div>
              ) : null}
            </div>
          </div>

          {nextGoal ? (
            <button
              type="button"
              className={`${styles.orgFocusGhost} ${styles.orgFocusGhostR}`}
              onClick={() => setFocusGoalId(nextGoal.id)}
              aria-label={`次の Goal ${goalLabel(focusIndex + 1)}`}
            >
              {goalLabel(focusIndex + 1)}
            </button>
          ) : (
            <span className={styles.orgFocusGhostSpacer} aria-hidden="true" />
          )}
        </div>

        <div className={styles.orgEmptyGuideActions}>
          <button type="button" className={styles.btnOutline} onClick={onOpenThemes}>
            Themes 一覧で編集
          </button>
        </div>
      </div>
    );
  }

  const valueChips = splitValues(strategy);
  const hasScanBody = hasMvv || activeGoals.length > 0 || orphanThemes.length > 0 || activePolicies.length > 0;

  return (
    <div className={styles.orgOverview}>
      <div className={styles.orgScanHead}>
        <h2 className={styles.orgOverviewTitle}>いまのレンズ</h2>
        <ScanZoomBar
          scale={scanScale}
          onZoomOut={() => setScanScale((s) => clampScanScale(s - SCAN_SCALE_STEP))}
          onZoomIn={() => setScanScale((s) => clampScanScale(s + SCAN_SCALE_STEP))}
          onFit={fitScan}
        />
      </div>

      {!loaded ? <p className={styles.orgOverviewSub}>読み込み中…</p> : null}

      {emptyKinds.length > 0 ? (
        <OrgEmptyGuidance
          kinds={emptyKinds}
          onPlaceDraft={(kind) => {
            if (kind === "themes") onOpenThemes();
            else onPlaceDraft(kind);
          }}
        />
      ) : null}

      {hasScanBody ? (
        <div className={styles.orgScanViewport} ref={scanViewportRef}>
          <div
            className={styles.orgScanCanvas}
            ref={scanContentRef}
            style={{ ["--scan-scale" as string]: scanScale } as CSSProperties}
          >
            {hasMvv ? (
              <div className={styles.orgScanMvv}>
                <span className={styles.orgScanMvvLabel}>錨 · MVV</span>
                <div className={styles.orgScanMvvRow}>
                  {strategy.mission ? (
                    <div className={styles.orgScanMvvCard}>
                      <span className={styles.orgScanKind}>Mission</span>
                      <p className={styles.orgScanStmt}>{strategy.mission}</p>
                      {strategy.missionElaboration ? (
                        <p className={styles.orgOverviewSub}>{strategy.missionElaboration}</p>
                      ) : null}
                    </div>
                  ) : null}
                  {strategy.vision ? (
                    <div className={styles.orgScanMvvCard}>
                      <span className={styles.orgScanKind}>Vision</span>
                      <p className={styles.orgScanStmt}>{strategy.vision}</p>
                      {strategy.visionElaboration ? (
                        <p className={styles.orgOverviewSub}>{strategy.visionElaboration}</p>
                      ) : null}
                    </div>
                  ) : null}
                </div>
                {valueChips.length > 0 ? (
                  <div className={styles.orgScanValues}>
                    {valueChips.map((v) => (
                      <span key={v.statement} className={styles.orgScanChip} title={v.elaboration}>
                        {v.statement}
                      </span>
                    ))}
                  </div>
                ) : null}
              </div>
            ) : null}

            {hasMvv && activeGoals.length > 0 ? (
              <div className={styles.orgScanMvvGoalEdges}>
                <FanEdges count={activeGoals.length} tone="blue" />
              </div>
            ) : null}

            {activeGoals.length > 0 ? (
              <div
                className={`${styles.orgScanGoals} ${
                  activeGoals.length <= 6 ? styles.orgScanGoalsSpread : ""
                }`}
                style={
                  activeGoals.length <= 6
                    ? ({ ["--org-goal-cols" as string]: activeGoals.length } as CSSProperties)
                    : undefined
                }
              >
                {activeGoals.map((g, index) => {
                  const linked = themesByGoal.get(g.id) ?? [];
                  return (
                    <div key={g.id} className={styles.orgScanGoalCol}>
                      <button
                        type="button"
                        className={styles.orgScanGoalNode}
                        onClick={() => setFocusGoalId(g.id)}
                      >
                        <span className={styles.orgScanGoalId}>
                          {goalLabel(index)}
                          {g.horizon ? ` · ${HORIZON_LABEL[g.horizon] ?? g.horizon}` : ""}
                        </span>
                        <span className={styles.orgScanStmt}>{treeTitle(g.title)}</span>
                        {g.elaboration ? (
                          <span className={styles.orgOverviewSub}>{shortText(g.elaboration, 40)}</span>
                        ) : null}
                      </button>
                      <EdgeArrow tone="green" />
                      <div
                        className={`${styles.orgScanThemeCluster} ${
                          linked.length === 0 ? styles.orgScanThemeClusterEmpty : ""
                        }`}
                      >
                        <span className={styles.orgScanThemeClusterHead}>
                          Themes · {linked.length}
                          {linked.length === 0 ? " · なし" : ""}
                        </span>
                        {linked.map((t) => (
                          <button
                            key={t.id}
                            type="button"
                            className={styles.orgScanThemeChip}
                            onClick={() => setFocusGoalId(g.id)}
                          >
                            {treeTitle(t.title)}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}

            {orphanThemes.length > 0 ? (
              <div className={styles.orgScanOrphan}>
                <span className={styles.orgScanOrphanTitle}>未リンク Theme（辺なし）</span>
                <span className={styles.orgScanThemeClusterHead}>Themes · {orphanThemes.length}</span>
                {orphanThemes.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={styles.orgScanThemeChip}
                    style={{ borderColor: "var(--yellow-fg)" }}
                    onClick={onOpenThemes}
                  >
                    {treeTitle(t.title)}
                  </button>
                ))}
              </div>
            ) : null}

            {orphanThemes.length > 0 ? (
              <div className={styles.orgCareBox}>
                <p className={styles.orgCareTitle}>手入れの起点</p>
                <p className={styles.orgCareBody}>
                  未リンクの Theme が {orphanThemes.length}{" "}
                  件ある。どの到達状態に効かせるか、Themes 一覧で Goal と結ぶ。
                </p>
                <button type="button" className={styles.btnOutline} onClick={onOpenThemes}>
                  Themes でリンクする
                </button>
              </div>
            ) : null}

            {activePolicies.length > 0 ? (
              <div className={styles.orgScanPolicyRail}>
                <span className={styles.orgScanPolicyLabel}>Policy 横断 · {activePolicies.length}</span>
                {activePolicies.map((p) => (
                  <span key={p.id} title={p.elaboration}>
                    {shortText(p.text, 40)}
                  </span>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}
