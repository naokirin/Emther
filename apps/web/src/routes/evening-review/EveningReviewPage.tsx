import { useState } from "react";
import { useNavigate } from "react-router";
import styles from "../../styles/page.module.css";
import { DailyReflectionForm } from "../../components/DailyReflectionForm";
import { EmCheckinForm, useEmCheckinController } from "../../components/EmCheckinWidget";
import { ReflectionNoteForm, useReflectionNoteController } from "../../components/growth/ReflectionNoteForm";
import { PageTitleRow } from "../../components/HelpLink";

// web/src/app/evening-review/page.tsx（Next.js版）からの移植（フェーズ3.5 tier1
// evening-reviewバッチ）。`next/navigation`の`useRouter().push`→react-routerの
// `useNavigate()`に置き換えた以外は構造・状態遷移を変更していない。
type FlowStep = "journal" | "checkin" | "kpt" | "done";

const STEP_ORDER: FlowStep[] = ["journal", "checkin", "kpt", "done"];

const STEP_LABEL: Record<FlowStep, string> = {
  journal: "1日を振り返る",
  checkin: "バイタルを記録する",
  kpt: "KPTを記録する",
  done: "完了",
};

function nextStep(step: FlowStep): FlowStep {
  const index = STEP_ORDER.indexOf(step);
  return STEP_ORDER[Math.min(index + 1, STEP_ORDER.length - 1)];
}

// ユーザー指摘「1日の終わりにAI対話での振り返り→バイタル→KPT入力、という流れが
// 画面ごとに途切れているのはUXとして不自然」対応。Journal Entry / EmCheckin /
// EmReflectionNoteというドメインの分離はそのままに、その日を締めくくる体験だけを
// 1本道でつなぐ。各ステップの入力・保存先は既存の各画面と完全に同じもの（DailyReflectionForm /
// EmCheckinForm / ReflectionNoteForm）を再利用し、保存完了時のコールバックで次へ進める。
export function EveningReviewPage() {
  const navigate = useNavigate();
  const [step, setStep] = useState<FlowStep>("journal");
  const checkinController = useEmCheckinController(() => setStep("kpt"));
  const noteController = useReflectionNoteController(() => setStep("done"));

  return (
    <div className={styles.screen}>
      <PageTitleRow title="1日の締めくくり" helpAnchor="reflection" />

      <div className={styles.panel}>
        <p className={styles.subtitle} style={{ margin: 0 }}>
          ステップ {Math.min(STEP_ORDER.indexOf(step) + 1, 3)}/3: {STEP_LABEL[step]}
        </p>
      </div>

      <div className={styles.panel}>
        {step === "journal" && <DailyReflectionForm onCreated={() => setStep("checkin")} />}
        {step === "checkin" && <EmCheckinForm controller={checkinController} />}
        {step === "kpt" && <ReflectionNoteForm controller={noteController} />}
        {step === "done" && (
          <>
            <p>お疲れさまでした。今日の締めくくりが完了しました。</p>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 8 }}>
              <button className={styles.primaryBtn} style={{ width: "auto" }} onClick={() => navigate("/checkin")}>
                自己チェックインを確認する
              </button>
              <button className={styles.btnOutline} onClick={() => navigate("/growth")}>
                週次振り返りへ
              </button>
              <button className={styles.btnOutline} onClick={() => navigate("/")}>
                ダッシュボードへ戻る
              </button>
            </div>
          </>
        )}
      </div>

      {step !== "done" && (
        <button className={styles.btnOutline} onClick={() => setStep(nextStep(step))}>
          この工程をスキップ
        </button>
      )}
    </div>
  );
}
