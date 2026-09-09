# EM Support System

個人のエンジニアリングマネージャー（EM）向けのローカル実行ツールです。  
組織の Journal / Issue / Agent 支援などを **自分のマシン上** で動かします。npm 公開はしません。

機微データ（実名対応表・Journal 等）はリポジトリ外の XDG パスに置きます。詳細は [`docs/packaging.md`](docs/packaging.md)。

## 必要環境

- Node.js **24+**
- Agent Run を使う場合: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI（`claude`）
- 任意フォールバック: `agy` / `cursor-agent`（Settings で有効化した場合のみ）

## インストールと起動

### A. ソースから（いつでも使える主経路）

```bash
git clone <このリポジトリの URL>
cd em_ai_team
./scripts/em-ai-team install
em-ai-team start
```

### B. GitHub Release の tarball から（タグ `v*` の CI 成果物）

OS/CPU に合った資産を GitHub の Releases から取得します（onnx 等はプラットフォーム固有です）。

```bash
tar -xzf em-ai-team-vX.Y.Z-<platform>.tar.gz
./em-ai-team/install.sh
# または: em-ai-team install-release em-ai-team-vX.Y.Z-<platform>.tar.gz
em-ai-team doctor
em-ai-team start
```

ブラウザで http://127.0.0.1:3000 を開きます（既定は localhost のみ）。

```bash
em-ai-team doctor    # 環境チェック
em-ai-team status
em-ai-team stop
em-ai-team backup    # data + secure を tar.gz に（個人情報を含む）
em-ai-team restore ~/.local/state/em-ai-team/backups/em-ai-team-state-YYYYMMDD-HHMMSS.tar.gz
```

`~/.local/bin` が PATH に無い場合は、シェル設定に追加するか `./scripts/em-ai-team …` を直接使ってください。

## データの場所

| 内容 | パス |
| --- | --- |
| 業務データ（SQLite / JSON） | `~/.local/state/em-ai-team/data` |
| 実名対応表 | `~/.local/state/em-ai-team/secure`（0700） |
| アプリ本体 | `~/.local/share/em-ai-team/app` |
| バックアップ | `~/.local/state/em-ai-team/backups` |

## Docker（隔離実行）

ホストに CLI を置かずコンテナで完結させたい場合は [`docs/docker.md`](docs/docker.md)。

## 開発者向け

アプリ本体は `web/`（Next.js）です。開発サーバーや実装メモは [`web/README.md`](web/README.md)。

## 注意

- インターネット上への本番公開は想定していません（認証なしの単一ユーザー向け）。
- `backup` のアーカイブには実名などの個人情報が含まれます。共有・保管に注意してください。
