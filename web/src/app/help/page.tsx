import type { ReactNode } from "react";
import Link from "next/link";
import styles from "@/app/page.module.css";

const SECTIONS: { id: string; title: string; body: ReactNode }[] = [
  {
    id: "overview",
    title: "画面の使い分け",
    body: (
      <>
        <p>
          <strong>今日</strong>は「今決めること」の起点。<strong>課題</strong>は進行中の介入の一覧と詳細。
          <strong>現場メモ</strong>は事実の記録・検索。<strong>相談</strong>はまだ Issue にしない壁打ち。
          <strong>チーム・メンバー</strong>は体制と人物。<strong>方針・目標</strong>は MVV / OKR / テーマの前提。
          <strong>振り返り</strong>は週次で見る成長・履歴・レポートです。
        </p>
        <p>日々の操作画面には仕組みの説明を置かず、必要なときだけこのヘルプを参照してください。</p>
      </>
    ),
  },
  {
    id: "issues",
    title: "課題（介入）",
    body: (
      <>
        <p>
          Issue は実装タスク箱ではなく、型・関連チーム・今期の KR に紐づく<strong>介入</strong>です。
          優先度（フォーカス／通常／保留）とフォーカス順で、今週〜今月の見通しと今日の順を揃えます。
        </p>
        <p>
          <strong>評価を一括更新</strong>は、内容が変わった親 Issue だけを再採点し優先度へ反映します（フォーカスは上位5件）。
          <strong>戦略リンク提案</strong>はテーマ / KR 未接続への紐付け案で、採用するまで反映しません。
        </p>
        <p>
          <strong>スコア差</strong>ビューは順位の確定ではなく取り方の目安です。バブルの大きさは影響半径、色の濃さは確信度。
          右上ほど放置リスクが高く介入が軽い（コスパがよい）象限です。
        </p>
        <p>
          <strong>Why / What / How</strong>は着手前に揃える3要素。<strong>Action Item</strong>はこの介入の次の一手、
          <strong>子 Issue</strong>は独自の Why/What/How を持つ別の介入です（親子は1階層まで）。
          <strong>経過ログ</strong>は考えたこと・アクション・結果の自由記述です。
        </p>
        <p>
          <strong>介入の効果</strong>は、関連チームの Journal 傾向を介入前後で機械比較した暫定値です（手動スコア入力はありません）。
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
          カードの円は Journal 傾向・関連 Issue（停滞・ブロッカー）から算出した「気にかけるべき度合い」の簡易バイタルです（点数ではありません）。
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
          Mission・制約は、そのチームに紐付いた Issue の Agent Run にだけ注入されます。
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
          Strategy（MVV）、Standing Background（長期の背景事実）、Objectives（OKR）、Themes（今期の焦点）は、
          EM が不動の前提として Agent Runtime へ注入する情報です。未入力の項目は注入されません。
        </p>
        <p>
          Standing Background は事実と含意を分けて書きます。注入範囲が always ならほぼ全 Run に、
          tagged ならタグ／本文の手がかりがあるときだけ渡します（常時効くものは 5〜20 件程度を目安）。
        </p>
        <p>チームの追加・編集は「チーム・メンバー」タブで行います。</p>
      </>
    ),
  },
  {
    id: "journal",
    title: "現場メモ・観測取り込み",
    body: (
      <>
        <p>
          今日タブには直近のメモだけが出ます。この画面では全件の検索・絞り込みができます。
          分割を考えず書いてよく、構造化・Issue 化は後からで構いません。
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
    title: "相談と Issue 化",
    body: (
      <>
        <p>
          まだ Issue にしないモヤモヤ・仮説検証は「何でも相談」へ。特定 Issue に紐付けず、収集済み Journal・組織情報を踏まえて Lead に聞けます。
          追跡・計画が必要になったら「Issueにする」で昇格。実行中の介入の壁打ちは Issue 詳細側で行います。
        </p>
        <p>
          AI の自動分析の出口は<strong>ドラフト Issue（起票待ち）</strong>です。追跡するなら Issue にする、様子を見るなら様子見、不要なら却下。
          EM が選ぶまで残り続けます。
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
    title: "振り返り（成長・タイムライン・レポート）",
    body: (
      <>
        <p>
          チェックインやレポートは<strong>週次の儀式で十分</strong>です。毎日見る必要はありません。
          気づきメモ（Keep / Problem / Try）はスキマにひとことずつで、週ごとにまとまります。
        </p>
        <p>
          タイムラインは Issue・Team・Objective の変更履歴の横断です。
          レポートは Journal・Issue・組織イベントの週次／月次スナップショットです。
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
          <strong>チーム先行並列</strong>: Issue 分析時に specialist を先に起動します（コスト増）。
          <strong>Journal ファクト TTL</strong>: 古い一時ファクトは注入対象外になります（削除はされません）。
        </p>
        <p>
          人名マスクは事前登録名のみ。CLI・モデル側の学習利用 OFF は Emther では強制できないため、利用側で確認してください。
          自動起動はコストが発生するため既定 OFF です。ON にするとドラフト Issue が「今日」の次の一手に溜まります。
        </p>
        <p>データのバックアップ／復元／リセットは「データ」グループ。形式は CLI の <code>emther backup</code> / <code>emther restore</code> と同じ tar.gz です。</p>
      </>
    ),
  },
];

export default function HelpPage() {
  return (
    <div className={styles.screen}>
      <div className={styles.panel}>
        <h2 style={{ marginTop: 0 }}>ヘルプ</h2>
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
          <Link href="/" className={styles.helpLink}>
            ← 今日へ戻る
          </Link>
        </p>
      </div>
    </div>
  );
}
