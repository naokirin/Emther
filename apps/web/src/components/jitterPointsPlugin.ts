import type { Plugin } from "chart.js";

// 実データ・目盛りは変えず、描画済みの点（＝そこに繋がる線の端点も）をdatasetIndexに
// 応じてピクセル単位でわずかに左右へずらすだけの見た目上の対応（ホバー時の数値・
// interaction(index)の対象特定はscale上のindexで行われるため影響しない）
// afterDatasetsUpdate（chart.update()時に1回だけ発火）からbeforeDatasetsDraw（draw()の
// 直前・毎フレーム発火）に変更したが、`point.x += offset`という相対加算のままだと
// 「マウスオーバーのたびにどんどん離れていく」別の不具合が出た。ホバーによる
// ツールチップ再描画はdraw()は呼ぶがcontroller.update()（x/yをscaleから再計算する処理）
// は経由しないため、point.xは前回描画済みの「既にジッター適用済みの値」のまま渡ってくる
// そこへさらに+=offsetすると、ホバーする（＝再描画される）たびにオフセットが積み上がって
// しまう。相対加算ではなくscale（x軸のCategoryScale）からindexごとの本来のpixel位置を
// 毎回算出し、そこへoffsetを足した絶対値で上書きすることで、何回描画が呼ばれても
// （アニメーション中・ホバー再描画のどちらでも）常に同じ結果になるようにする
const POINT_JITTER_PX = 3;

export const jitterPointsPlugin: Plugin<"line"> = {
  id: "jitterPoints",
  beforeDatasetsDraw(chart) {
    const xScale = chart.scales.x;
    if (!xScale) return;
    const count = chart.data.datasets.length;
    chart.data.datasets.forEach((_dataset, datasetIndex) => {
      const offset = (datasetIndex - (count - 1) / 2) * POINT_JITTER_PX;
      const meta = chart.getDatasetMeta(datasetIndex).data;
      meta.forEach((point, index) => {
        point.x = xScale.getPixelForValue(index) + offset;
      });
    });
  },
};
