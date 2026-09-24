import type { ReactNode } from "react";
import { Link } from "react-router";
import styles from "../../styles/page.module.css";

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "overview",
    title: "画面の使い分け",
    body: (
      <>
        <p>
          <strong>今日</strong>は「今決めること」の起点。<strong>提案</strong>は AI が観測・解釈した結果の確認とメモ・壁打ち。
          <strong>ジャーナル</strong>は事実の記録・検索。<strong>相談</strong>はまだ提案として残さない壁打ち。
          <strong>チーム・メンバー</strong>は体制と人物。<strong>方針・目標</strong>は MVV / OKR / テーマの前提。
          <strong>振り返り</strong>は日次のコンディション・1日を締めくくる流れ・週次の学び・レポートです。
        </p>
        <p>日々の操作画面には仕組みの説明を置かず、必要なときだけこのヘルプを参照してください。</p>
      </>
    ),
  },
  {
    id: "issues",
    title: "提案",
    body: (
      <>
        <p>
          提案は管理対象のタスクではなく、AIが観測・解釈した結果として現れる<strong>判断材料</strong>です。
          確認状態（未確認／確認保留／確認済み＝もう追わない）と確認優先度（今すぐ／通常／後で）で切り分け、
          メモを残し、紐づく Agent と壁打ちして理解を深めます。アクションの完了管理は Emther の対象外です。
        </p>
        <p>
          チーム／テーマ／KR への紐付けは任意です。相談チャットからは「提案として残す／様子見／却下」を選べます。
        </p>
      </>
    ),
  },
  {
    id: "people",
    title: "メンバー・人名マスク",
    body: (
      <>
        <p>
          クラウド AI へ送る前にマスクする人名は、ヘッダーの「＋人を追加」・チーム名簿・メンバー画面・Journal 校正で
          <strong>事前登録</strong>してください（ローカル NER による自動登録はしません）。
        </p>
        <p>
          カードの円は Journal 傾向・関連する提案（停滞・確認待ち）から算出した「気にかけるべき度合い」の簡易バイタルです（点数ではありません）。
          🟢安定　🟡やや注意　🔴要注意　⚪️評価不能（件数不足）。
        </p>
        <p>
          <strong>自分</strong>は部下一覧・1on1 Coverage の集計対象外。<strong>部下</strong>は管理チームのメンバー。
          <strong>その他</strong>は管理チーム外で言及された人物です。
        </p>
      </>
    ),
  },
  {
    id: "teams",
    title: "チーム",
    body: (
      <>
        <p>
          チーム構成は Agent Runtime へ前提として注入され、Team Vitals の算出にも使われます。
          チーム名に「/」を入れると組織階層を表現できます（例: Engineering / Team A）。
        </p>
        <p>
          Mission・制約は、そのチームに紐付いた提案の Agent Run にだけ注入されます。
          「自分が管理するチーム」を OFF にすると、メンバーは People で「その他」になり 1on1 Coverage からも外れます。
          別名は相談・起動時のチーム推定に使われます。
        </p>
      </>
    ),
  },
  {
    id: "org",
    title: "方針・目標",
    body: (
      <>
        <p>
          Strategy（MVV）、Standing Background（長期の背景事実）、Policy（判断原則）、Goal（到達したい状態）、
          Themes（今期の焦点）は、EM が不動の前提として Agent Runtime へ注入する情報です。
          未入力の項目は注入されません。
        </p>
        <p>
          Standing Background は事実と含意を分けて書きます。注入範囲が always ならほぼ全 Run に、
          tagged ならタグ／本文の手がかりがあるときだけ渡します（常時効くものは 5〜20 件程度を目安）。
        </p>
        <p>
          Policy は「大切にすること・優先すること・やらないこと・判断に迷ったときの原則」などを 1 件ずつ書き残す場所です。
          固定の入力欄はなく、思いついた原則から自由記述で書き足していけます（カテゴリは任意のヒントで、未設定でも構いません）。
        </p>
        <p>
          Goal は EM として見据えている「到達したい状態」です。SMART である必要はなく、曖昧なままでも登録できます。
          Goal からは「このGoalの重点テーマ候補を出す」でテーマ候補を先に置くことができ、テーマへのGoal紐づけは AI 提案でも探せます。
        </p>
        <p>チームの追加・編集は「チーム・メンバー」タブで行います。</p>
      </>
    ),
  },
  {
    id: "journal",
    title: "ジャーナル・観測取り込み",
    body: (
      <>
        <p>
          今日タブには直近のメモだけが出ます。この画面では全件の検索・絞り込みができます。
          分割を考えず書いてよく、構造化や提案としての切り出しは後からで構いません。
        </p>
        <p>
          <strong>観測を取り込む</strong>では長いログを貼り付け、必要なら「列を確認する」で列→意味を指定してから取り込みます。
          採用分だけ Journal になり、クラウドへはマスク後のみ送ります。
        </p>
      </>
    ),
  },
  {
    id: "chat",
    title: "相談と提案",
    body: (
      <>
        <p>
          まだ提案として残さないモヤモヤ・仮説検証は「何でも相談」へ。特定の提案に紐付けず、収集済み Journal・組織情報を踏まえて Lead に聞けます。
          残しておきたいと判断したら「提案として残す」。相談履歴には残るので、分割して追加の提案を残したり、提案に紐づかない続きの壁打ちも同じスレッドで続けられます。
          提案そのものの内容確認は提案詳細（サイドピーク）からも行えます。
        </p>
        <p>
          AI の自動分析の出口は<strong>提案候補</strong>です。残す・様子見・却下を EM が選ぶまでドラフトとして残ります。
        </p>
      </>
    ),
  },
  {
    id: "privacy-check",
    title: "個人・機密情報チェック",
    body: (
      <>
        <p>
          投入や外部送信の前に、登録済み人名のマスク結果と、個人情報・機密情報っぽい箇所をローカルだけで確認する検証画面です。
          保存・送信・データ投入は行いません。検出は目安であり、漏れや誤検知があり得ます。
        </p>
        <p>
          人名は敬称の有無どちらも候補化します（話者ラベル・カタカナ名など。誤検知もあり得ます）。
          原文上で問題箇所を色分けハイライトし、続けてローカル AI で候補を追加します。
          人名以外は自動除去しません。確認後は必要ならマスク後テキストをコピーし、元の投入画面へ戻ってください。
        </p>
      </>
    ),
  },
  {
    id: "reflection",
    title: "振り返り（自己チェックイン・週次・レポート・1日を締めくくる）",
    body: (
      <>
        <p>
          <strong>自己チェックイン</strong>は日次のコンディション（気分・エネルギー・ストレス・心の余裕）だけを残します。
          位置で選び、数値は表に出しません。
        </p>
        <p>
          <strong>EM週次振り返り</strong>は学びの提案・改善方針・KPTです。気づきメモはスキマにひとことずつで、週ごとにまとまります。
          <strong>レポート</strong>は Journal・提案・組織イベントの週次／月次スナップショットとAIレビューです。毎日見る必要はありません。
        </p>
        <p>
          <strong>1日を締めくくる</strong>は、AI対話での振り返り→バイタル→KPTをまとめて進める一連の流れです。
          今日タブの未記録案内からも入れます。
        </p>
      </>
    ),
  },
  {
    id: "settings",
    title: "設定",
    body: (
      <>
        <p>
          ここはアプリの動作（閾値・並列数・自動起動など）の調整です。組織の MVV や体制（方針・目標／チーム）とは別物です。
        </p>
        <p>
          <strong>同時実行数</strong>: 超過分はキューイングされます。
          <strong>1ターン予算</strong>: Claude CLI の <code>--max-budget-usd</code> のみ（agy / Cursor には非適用）。
          <strong>チーム先行並列</strong>: 提案分析時に specialist を先に起動します（コスト増）。
          <strong>Journal ファクト TTL</strong>: 古い一時ファクトは注入対象外になります（削除はされません）。
        </p>
        <p>
          人名マスクは事前登録名のみ。CLI・モデル側の学習利用 OFF は Emther では強制できないため、利用側で確認してください。
          自動起動はコストが発生するため既定 OFF です。ON にするとドラフト提案が「今日」の次の一手に溜まります。
        </p>
        <p>データのバックアップ／復元／リセットは「データ」グループ。形式は CLI の <code>emther backup</code> / <code>emther restore</code> と同じ tar.gz です。</p>
      </>
    ),
  },
];

export function HelpPage() {
  return (
    <div className={styles.screen}>
      <h2 style={{ margin: 0 }}>ヘルプ</h2>
      <div className={styles.panel}>
        <p className={styles.subtitle} style={{ marginBottom: 16 }}>
          画面に常設しない仕組み・用語の説明です。各画面の「ヘルプ」リンクから該当節へ飛べます。
        </p>
        <nav aria-label="ヘルプ目次" style={{ marginBottom: 24 }}>
          <ul style={{ margin: 0, paddingLeft: 18, fontSize: "0.875rem", lineHeight: 1.8 }}>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.title}</a>
              </li>
            ))}
          </ul>
        </nav>
        {SECTIONS.map((s) => (
          <section key={s.id} id={s.id} style={{ marginBottom: 28, scrollMarginTop: 16 }}>
            <h3 style={{ fontSize: "1rem", margin: "0 0 8px" }}>{s.title}</h3>
            <div className={styles.helpSectionBody}>{s.body}</div>
            <p style={{ margin: "10px 0 0" }}>
              <a href="#overview" className={styles.helpLink}>
                目次へ
              </a>
            </p>
          </section>
        ))}
        <p style={{ marginTop: 8 }}>
          <Link to="/" className={styles.helpLink}>
            ← 今日へ戻る
          </Link>
        </p>
      </div>
    </div>
  );
}
