# EM Support System — MVP

`docs/first_implession/em_v5.md` で定義したアーキテクチャのうち、以下の垂直スライスを実装したもの。

- **3.4 CLIサブプロセス実行エンジン** と **3.6 Yield（一時停止）設計**（Agent Runtime）
- **3.2 ハイブリッド・データ収集**（Quick Journal — 軽量モデルによる自動タグ付け）

## できること

### Agent Runtime

- 画面からタスク（自然文）とエージェント種別（Lead/People/Process/Tech）を指定してエージェントを起動する。
- 起動すると `claude` CLI を非対話（`-p --output-format stream-json`）でサブプロセス実行し、出力をリアルタイムにActivity Streamへ表示する。
- エージェントが「複数の妥当な選択肢がある」「判断に必須の前提情報が不足している」と判断した場合、応答の末尾に構造化された`yield`ブロックを出力する規約になっており、これを検出すると実行を **Yield（🟡）** 状態にして停止する。
- EMがOptionを選択する、または自由記述でチャットすると、`claude --resume <session-id>` で同一セッションを再開し、そのまま思考を継続する。
- 完了すると **Idle（⚪️・完了）**、エラー時は **Error（🔴）** になる。

### Quick Journal

- 雑多な一言メモを入力してSubmitすると、軽量モデル（`claude-haiku-4-5`）が `claude -p --output-format json --json-schema <schema>` で構造化抽出（タグ／登場人物／緊急度／感情／要約）を行い、その場でカード表示する。
- Agent Runtimeの主要エージェントとは別モデル・別プロンプトで動かし、コストを抑えた「軽量モデルによるIngestion」（docs 3.2）に対応させている。

## 実行方法

```bash
npm install
npm run dev
```

`http://localhost:3000` を開く。ローカルの `claude` CLI（サブスクリプション認証済みのもの）を利用するため、追加のAPIキー設定は不要。

## 課金に関する注記

`claude -p`（非対話モード）を使っている。「サブスクリプション範囲内か、別課金か」は一度認識が入れ替わった経緯があるため、コスト最適化を本格的に詰める前に現状の課金条件を再確認すること。`--bg`（バックグラウンドセッション）への切り替えも試したが、このセッションが動く検証環境固有と思われるグローバルフック起因で`state: "blocked"`のまま進まなくなる不具合が複数パターンで再現し、断念した経緯がある。

## 既知のスコープ外（今後の拡張ポイント）

- 実行状態はプロセス内メモリのみで保持（再起動で消える）。永続化はCore Context DB/Daily Logs DBの実装時に対応。
- 現在はポーリング（1.5秒間隔）でActivity Streamを更新している。SSE/WebSocketへの置き換えは今後の課題。
- エージェントはツール利用を無効化（`--tools ""`）した「テキスト推論のみ」の存在として動作する。実データ（Journal/Organization Context）を読み込ませる接続は未実装。
- Team Vitals（ダッシュボードの三値バイタル表示）はまだこのアプリに統合されておらず、`docs/first_implession/em_ui_wireframe_v5.html` のワイヤーフレーム止まり。Quick Journalが実データを持つようになったので、次はこれを集計してVitalsに反映する接続が候補。
- Quick Journalのサニタイズ（秘匿化、docs 3.2）は未実装。生のメモがそのまま軽量モデルに渡り、画面にも表示される。
