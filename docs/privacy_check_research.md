# 個人・機密情報チェック：一般解の調査メモ

作成日: 2026-09-13  
性質: **調査メモ**（実装決定の正本ではない）  
関連: `docs/privacy_check.md`、`web/src/lib/mask-check-lexicon.ts`（CORE / TUNING）

---

## 0. なぜ調べるか

ローカル完結の PII／機密検知は一般的な課題だが、現状の Emther 実装は検証テキスト由来の TUNING（長い言い回し・除外語の積み上げ）が効いている。  
結論を急がず、健全で具体的な既存解を押さえてからアーキテクチャを見直す。

---

## 1. 業界定石（層の分離）

| 層 | 対象 | 定番 | Emther 現状 |
|---|---|---|---|
| A. 構造化実値 | メール・電話・鍵文字列 | regex＋checksum／エントロピー | `LITERAL_PATTERNS`（健全） |
| B. 秘密実体 | APIキー本体 | Gitleaks 系 | `api_key_like`（言及と混ぜない方がよい） |
| C. 人名など | 氏名 | NER（spaCy / GiNZA）＋後処理 | 敬称／話者／カタカナ規則＋SLM フィルタ |
| D. 機微「話題」 | 「漏洩の話」など | 短い核キーワード or 分類／LLM | CORE＋TUNING フレーズ（TUNING が過適合寄り） |

共通メッセージ:

- 自動化に完全保証はない（Presidio も明記）
- **1手法に寄せない**（Recognizer／層の合成）
- deny-list / allow-list / コンテキストでスコア調整が本番ではほぼ必須
- LLM は補助。本線を LLM＋長いルール羅列にしない

---

## 2. 参照すべき具体物

### Microsoft Presidio

- ローカル PII 検知＋匿名化。Recognizer 差し替え（regex / NER / deny-list / ローカル LLM）
- 設計の型として最有力（「フレーズを足す」より「Recognizer 単位」）
- 日本語は spaCy/GiNZA ＋言語別 Recognizer 追加が前提  
  - https://github.com/Microsoft/presidio  
  - https://microsoft.github.io/presidio/analyzer/languages/

### GiNZA（日本語 NER）

- ローカル。`Person` 等
- 実務事例はほぼ **NER（氏名）＋ regex（電話・郵便・メール）**
- 素精度は不足しがち → 追加学習・負例・deny-list がよく出る  
  - https://megagonlabs.github.io/ginza/

### 秘密スキャン（Gitleaks 等）

- 鍵**実体**向け。PII／「機微な話題」とは別問題

---

## 3. Emther への当てはめ（未決定）

制約: Node/Next、ローカル、軽量、既存 `people-directory`。

候補:

1. **現状維持＋TUNING 縮小**（核フレーズだけ残す）
2. **Python サイドカーで Presidio/GiNZA**（精度は上がりやすいが運用が重い）
3. **TS に薄い A＋C（NER は既存 SLM／将来 GiNZA 相当）**、D は短い核のみ

次の検証ステップ（実装の前）:

1. 同じ議事録サンプルを GiNZA（または Presidio＋ja）で一度流し、人名の取りこぼし／誤検知を測る
2. TUNING フレーズを「CORE 核に吸収できるか」棚卸しする
3. Emther 制約下で 2 / 3 のどちらが現実的か決める

---

## 4. いま言えること

- 課題設定は一般的で正しい
- 解の組み立てはまだ自前ヒューリスティック寄り（特に TUNING）
- 次はルール増殖より **層の再整理と一般解との差分測定**
