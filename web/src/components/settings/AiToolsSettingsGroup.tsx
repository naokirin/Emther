import styles from "@/app/page.module.css";
import { AGENT_OPTIONS, CLI_LABELS, CLI_OPTIONS, MODEL_TIER_OPTIONS, type CliName, type ModelTier, type RulesAndConstraints } from "@/lib/types";
import {
  LOCAL_CHAT_MODEL_PRESET_IDS,
  LOCAL_CHAT_MODEL_PRESETS,
  type LocalChatModelPresetId,
} from "@/lib/local-chat-presets";

type Props = {
  draft: RulesAndConstraints;
  onChange: (patch: Partial<RulesAndConstraints>) => void;
};

export function AiToolsSettingsGroup({ draft, onChange }: Props) {
  // ユーザー指摘「AIツールの優先度設定が増えたことでフォールバック設定との競合が
  // 発生している」「エージェントごとに設定できる必要はない、全体で1つで大丈夫」対応。
  // 以前のcliPriorityOrder（全エージェント共通の並び順）+ agyFallbackAgents/
  // cursorFallbackAgents（エージェント種別ごとのON/OFF）という別々の2設定を、
  // 全エージェント共通の単一のCLI優先順位リストへ統合した。

  // チェックONで末尾（最も優先度低い）に追加、チェックOFFで除外する。claudeは
  // 無効化トグルが無い（常に含まれる）ため、ここへは渡さない。
  function toggleCli(cli: CliName, checked: boolean) {
    const current = draft.cliOrder;
    // 候補ゼロを防ぐ最後の砦（UI側のdisabledと二重）。最後の1つは外せない。
    if (!checked && current.length === 1) return;
    const next = checked ? (current.includes(cli) ? current : [...current, cli]) : current.filter((c) => c !== cli);
    onChange({ cliOrder: next });
  }

  function moveCli(from: number, to: number) {
    const next = [...draft.cliOrder];
    [next[from], next[to]] = [next[to], next[from]];
    onChange({ cliOrder: next });
  }

  function setAgentModelTier(agentName: string, value: ModelTier | "") {
    const next = { ...draft.agentModelTiers };
    if (value) {
      next[agentName] = value;
    } else {
      delete next[agentName];
    }
    onChange({ agentModelTiers: next });
  }

  function setAgentAgyModel(agentName: string, value: string) {
    const next = { ...draft.agentAgyModels };
    if (value.trim()) {
      next[agentName] = value;
    } else {
      delete next[agentName];
    }
    onChange({ agentAgyModels: next });
  }

  function setAgentCursorModel(agentName: string, value: string) {
    const next = { ...draft.agentCursorModels };
    if (value.trim()) {
      next[agentName] = value;
    } else {
      delete next[agentName];
    }
    onChange({ agentCursorModels: next });
  }

  return (
    <>
      <h3 style={{ fontSize: "0.875rem", marginTop: 0, marginBottom: 4 }}>ローカルAI（ジャーナル抽出）</h3>
      <div className={styles.field} style={{ maxWidth: 420 }}>
        <label className={styles.axisTooltip} data-tooltip="機微情報を外部送信しないローカル推論。埋め込みモデルは対象外">
          チャットモデルのサイズ
          <select
            value={draft.localChatModelPreset ?? "350m"}
            onChange={(e) =>
              onChange({
                localChatModelPreset: e.target.value as LocalChatModelPresetId,
              })
            }
          >
            {LOCAL_CHAT_MODEL_PRESET_IDS.map((id) => (
              <option key={id} value={id}>
                {LOCAL_CHAT_MODEL_PRESETS[id].label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p style={{ fontSize: "0.75rem", marginTop: 0, marginBottom: 16, maxWidth: 420, color: "var(--text-muted)" }}>
        {LOCAL_CHAT_MODEL_PRESETS[draft.localChatModelPreset ?? "350m"].hint}
        {" "}
        保存後、未取得ならダウンロードが始まります。大きいモデルはメモリ不足でプロセスが落ちることがあります。
      </p>

      <h3 style={{ fontSize: "0.875rem", marginTop: 0, marginBottom: 4 }}>利用するAIツールの優先順位・除外</h3>
      {(() => {
        const order = draft.cliOrder;
        const excluded = CLI_OPTIONS.filter((c) => !order.includes(c));
        return (
          <ol style={{ listStyle: "none", margin: 0, padding: 0, maxWidth: 340, marginBottom: 12 }}>
            {order.map((cli, index) => (
              <li key={cli} style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: "0.875rem" }}>
                <span style={{ width: 16, color: "var(--text-muted)" }}>{index + 1}.</span>
                <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  <input
                    type="checkbox"
                    checked
                    disabled={order.length === 1}
                    onChange={(e) => toggleCli(cli, e.target.checked)}
                  />
                  {CLI_LABELS[cli]}
                </label>
                <button
                  type="button"
                  className={styles.btnOutline}
                  onClick={() => moveCli(index, index - 1)}
                  disabled={index === 0}
                  aria-label={`${CLI_LABELS[cli]}を上へ`}
                >
                  ↑
                </button>
                <button
                  type="button"
                  className={styles.btnOutline}
                  onClick={() => moveCli(index, index + 1)}
                  disabled={index === order.length - 1}
                  aria-label={`${CLI_LABELS[cli]}を下へ`}
                >
                  ↓
                </button>
              </li>
            ))}
            {excluded.map((cli) => (
              <li
                key={cli}
                style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6, fontSize: "0.875rem", color: "var(--text-muted)" }}
              >
                <span style={{ width: 16 }} />
                <label style={{ display: "flex", alignItems: "center", gap: 6, flex: 1 }}>
                  <input type="checkbox" checked={false} onChange={(e) => toggleCli(cli, e.target.checked)} />
                  {CLI_LABELS[cli]}（除外）
                </label>
              </li>
            ))}
          </ol>
        );
      })()}

      <h3 style={{ fontSize: "0.875rem", marginTop: 20, marginBottom: 4 }}>エージェント種別ごとのモデル</h3>
      <p style={{ fontSize: "0.75rem", marginTop: 0, marginBottom: 8, maxWidth: 520, color: "var(--text-muted)" }}>
        上で有効なAIツールだけが表示されます（除外中の列は隠れますが、設定値は保持されます）。空欄は各CLIの既定モデルのままです。
      </p>
      {(() => {
        // 優先順位リストと同じ並び・同じ除外状態で列を出す（案1マトリクス＋案5連動）。
        const visibleClis = draft.cliOrder;
        const matrixStyle = {
          ["--agent-model-cols" as string]: String(visibleClis.length),
        };
        return (
          <div className={styles.agentModelMatrix} style={matrixStyle}>
            <div className={styles.agentModelMatrixHead} aria-hidden="true">
              <span>エージェント</span>
              {visibleClis.map((cli) => (
                <span key={cli}>{CLI_LABELS[cli]}</span>
              ))}
            </div>
            {AGENT_OPTIONS.map((name) => (
              <div key={name} className={styles.agentModelMatrixRow}>
                <div className={styles.agentModelMatrixAgent}>{name}</div>
                {visibleClis.map((cli) => {
                  if (cli === "claude") {
                    return (
                      <div key={cli} className={styles.field}>
                        <label>
                          <span className={styles.agentModelMatrixCliLabel}>{CLI_LABELS.claude}</span>
                          <select
                            aria-label={`${name} / ${CLI_LABELS.claude}`}
                            value={draft.agentModelTiers[name] ?? ""}
                            onChange={(e) => setAgentModelTier(name, e.target.value as ModelTier | "")}
                          >
                            <option value="">（CLIの既定のまま）</option>
                            {MODEL_TIER_OPTIONS.map((tier) => (
                              <option key={tier} value={tier}>
                                {tier}
                              </option>
                            ))}
                          </select>
                        </label>
                      </div>
                    );
                  }
                  if (cli === "agy") {
                    return (
                      <div key={cli} className={styles.field}>
                        <label>
                          <span className={styles.agentModelMatrixCliLabel}>{CLI_LABELS.agy}</span>
                          <input
                            type="text"
                            aria-label={`${name} / ${CLI_LABELS.agy}`}
                            value={draft.agentAgyModels[name] ?? ""}
                            placeholder="例: gemini-3.6-flash-medium（空欄＝既定）"
                            onChange={(e) => setAgentAgyModel(name, e.target.value)}
                          />
                        </label>
                      </div>
                    );
                  }
                  return (
                    <div key={cli} className={styles.field}>
                      <label>
                        <span className={styles.agentModelMatrixCliLabel}>{CLI_LABELS.cursor}</span>
                        <input
                          type="text"
                          aria-label={`${name} / ${CLI_LABELS.cursor}`}
                          value={draft.agentCursorModels[name] ?? ""}
                          placeholder="例: gpt-5.2（空欄＝既定）"
                          onChange={(e) => setAgentCursorModel(name, e.target.value)}
                        />
                      </label>
                    </div>
                  );
                })}
              </div>
            ))}
          </div>
        );
      })()}
    </>
  );
}
