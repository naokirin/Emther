# Emther

**EM Support System** — 個人のエンジニアリングマネージャー（EM）向けのローカル実行ツールです。  
組織の Journal / Issue / Agent 支援などを **自分のマシン上** で動かします。npm 公開はしません。

機微データ（実名対応表・Journal 等）はリポジトリ外の XDG パスに置きます。詳細は [`docs/packaging.md`](docs/packaging.md)。

## 必要環境

- Node.js **24+**
- Agent Run を使う場合: [Claude Code](https://docs.anthropic.com/en/docs/claude-code) CLI（`claude`）
- 任意フォールバック: `agy` / `cursor-agent`（Settings で有効化した場合のみ）

## インストールと起動

### A. ソースから（いつでも使える主経路）

```bash
git clone https://github.com/naokirin/Emther.git
cd Emther
./scripts/emther install
emther start
```

### B. GitHub Release の tarball から（タグ `v*` の CI 成果物）

OS/CPU に合った資産を GitHub の Releases から取得します（onnx 等はプラットフォーム固有です）。

```bash
tar -xzf emther-vX.Y.Z-<platform>.tar.gz
./emther/install.sh
# または: emther install-release emther-vX.Y.Z-<platform>.tar.gz
emther doctor
emther start
```

ブラウザで http://127.0.0.1:3000 を開きます（既定は localhost のみ）。

```bash
emther doctor    # 環境チェック
emther status
emther stop
emther restart   # stop → start
emther backup    # data + secure を tar.gz に（個人情報を含む）
emther restore ~/.local/state/emther/backups/emther-state-YYYYMMDD-HHMMSS.tar.gz
```

バインド先は環境変数または起動オプションで変更できます（CLI フラグが優先）。

```bash
EM_PORT=3001 emther start
emther start --port 3001
emther restart --host 127.0.0.1 --port 3001
```

同じバックアップは UI の **設定 → データ** からもダウンロード／復元／全削除できます（復元・リセット後はサーバーが停止するので `emther start` または `emther restart` で再起動してください）。CLI が端末移行の正本で、UI は同形式の補助経路です。
`~/.local/bin` が PATH に無い場合は、シェル設定に追加するか `./scripts/emther …` を直接使ってください。  
（旧コマンド名 `em-ai-team` は互換ラッパーが残りますが、今後は `emther` を使ってください。）

## データの場所

| 内容 | パス |
| --- | --- |
| 業務データ（SQLite / JSON） | `~/.local/state/emther/data` |
| 実名対応表 | `~/.local/state/emther/secure`（0700） |
| アプリ本体 | `~/.local/share/emther/app` |
| バックアップ | `~/.local/state/emther/backups` |

旧配置（`~/.local/state/em-ai-team/` 等）からは、宛先が空のとき一度だけ自動移行します。

## Docker（隔離実行）

ホストに CLI を置かずコンテナで完結させたい場合は [`docs/docker.md`](docs/docker.md)。

## 開発者向け

アプリ本体は `web/`（Next.js）です。開発サーバーや実装メモは [`web/README.md`](web/README.md)。

## 注意

- インターネット上への本番公開は想定していません（認証なしの単一ユーザー向け）。
- `backup` のアーカイブには実名などの個人情報が含まれます。共有・保管に注意してください。
