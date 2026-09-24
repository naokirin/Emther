import styles from "../../styles/page.module.css";
import { EmCheckinForm, EmCheckinHistory } from "../../components/EmCheckinWidget";
import { useEmCheckinController } from "../../components/useEmCheckinController";
import { CheckinTrendChart, PeriodNavigator } from "../../components/DailyTrendChart";
import { usePeriodNavigator } from "../../components/usePeriodNavigator";
import { PageTitleRow } from "../../components/HelpLink";
import { buildCheckinDailyTrend } from "@emther/core/daily-trends";

// 日次の自己チェックイン画面（/growth から分離）。
export function CheckinPage() {
  const checkin = useEmCheckinController();
  const checkinNav = usePeriodNavigator("week");
  const checkinTrend = buildCheckinDailyTrend(checkin.checkins, checkinNav.window);

  return (
    <div className={styles.screen}>
      <PageTitleRow title="自己チェックイン" helpAnchor="reflection" />
      <p className={styles.subtitle} style={{ marginTop: 8, marginBottom: 16 }}>
        日次のバイタル。週次の学びやレポートとは分けて、コンディションだけを残す。
      </p>

      <div className={styles.panel}>
        <h2>今日のコンディション</h2>
        <EmCheckinForm controller={checkin} />
      </div>

      <div className={styles.panel}>
        <h2>チェックインの推移</h2>
        <p className={styles.subtitle} style={{ marginTop: 0, marginBottom: 10 }}>
          縦軸は数値なし（上＝良い / 下＝悪い）。ストレスだけ入力（左＝弱い）と向きが逆なので、グラフでは反転して重ねる。
        </p>
        <div style={{ marginBottom: 10 }}>
          <PeriodNavigator state={checkinNav} />
        </div>
        <CheckinTrendChart points={checkinTrend} />
      </div>

      <div className={styles.panel}>
        <h2>記録履歴</h2>
        <EmCheckinHistory controller={checkin} />
      </div>
    </div>
  );
}
