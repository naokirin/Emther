# 配布・パッケージ化方針

個人の EM サポートツールとして、**GitHub 公開リポジトリから入手でき、利用者のマシン上にだけ機微データが残る**ことを目標にする。npm レジストリへの公開はしない。

関連実装: `web/src/lib/persistence.ts`（データパス）、`docs/docker.md`（隔離プロファイル）。

## 製品像

| レイヤ | 置き場所 | 備考 |
| --- | --- | --- |
| ソース | GitHub（公開） | clone / Release から取得 |
| アプリ本体（将来） | `~/.local/share/em-ai-team/app` | standalone ビルド＋ランチャー |
| 起動コマンド（将来） | `~/.local/bin/em-ai-team` | `start` / `stop` / `doctor` / `backup` 等 |
| 業務データ | `~/.local/state/em-ai-team/data` | SQLite・JSON。リポジトリ外必須 |
| 実名対応表 | `~/.local/state/em-ai-team/secure` | 0700 / 0600。data と兄弟だが権限分離 |
| モデルキャッシュ | `~/.cache/huggingface` 等（将来は `~/.cache/em-ai-team` も検討） | アプリ本体に同梱しない |
| Agent CLI | 利用者ホスト（必須: `claude`） | `agy` / `cursor-agent` は任意 |
| 隔離実行 | Docker Compose（任意） | 認証・依存ごとコンテナに閉じたい人向け |

**同梱しないもの:** API キー、people-directory、モデル重み。認証と初回ダウンロードは利用者各自。

## 入手チャネル

1. **主経路（予定）:** 公開リポジトリの README → install スクリプト、または `git clone` + ビルド手順
2. **GitHub Releases:** 将来、standalone 成果物と checksum を添付
3. **npm 公開:** しない（`npx` も主経路にしない）
4. **Docker:** セカンドクラス。手順は `docs/docker.md`

## データパス規約（Phase 0・現行）

デフォルト（環境変数未設定時）:

```text
~/.local/state/em-ai-team/data/     # EM_DATA_DIR で上書き可
~/.local/state/em-ai-team/secure/   # EM_SECURE_DATA_DIR で上書き可
```

- 開発・テスト・Docker は従来どおり環境変数で差し替える。
- リポジトリ配下の `web/.data` には**新規書き込みしない**（公開 clone 作業ツリーと機微データの混在を防ぐ）。
- 旧配置からの一度きりの移行（存在する場合のみ、宛先が未作成のとき）:
  - `./.data`（起動時 cwd 基準の旧デフォルト）→ `.../em-ai-team/data`
  - `~/.local/state/em-ai-team-secure` → `.../em-ai-team/secure`

## ロードマップ

| Phase | 内容 | 状態 |
| --- | --- | --- |
| 0 | デフォルトデータパスの XDG 化＋旧配置からの移行 | 実装済み（本ドキュメントと同時） |
| 1 | Next.js `output: "standalone"` ＋ `em-ai-team` ランチャー | 未着手 |
| 2 | `doctor` / `backup` / install スクリプト＋短い配布 README | 未着手 |
| 3 | CI から GitHub Release 成果物を作成 | 未着手 |

## 明示的にやらないこと

- npm 公開・単一バイナリ化・Electron/Tauri（必要性が出てから再検討）
- ホスト配布での Agent CLI 完全同梱の必須化（認証が個人単位のため。同梱は Docker 側の強み）

## セキュリティ上の注意（公開リポジトリ）

- `.env`・認証ディレクトリ・state 配下はコミットしない（既存の ignore を維持）。
- バックアップ対象は主に `~/.local/state/em-ai-team/`（secure を含む）。取り扱いに注意。
- 本番インターネット公開は想定しない（認証なしの単一ユーザー向け）。
