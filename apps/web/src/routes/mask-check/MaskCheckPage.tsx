import { useState } from "react";
import styles from "../../styles/page.module.css";
import { PageTitleRow } from "../../components/HelpLink";
import { PrivacyCheckForm } from "../../components/privacy-check/PrivacyCheckForm";
import { HighlightedTextSection } from "../../components/privacy-check/HighlightedTextSection";
import { MaskedTextSection } from "../../components/privacy-check/MaskedTextSection";
import { NameAndFindingsSections } from "../../components/privacy-check/NameAndFindingsSections";
import {
  mergeFindings,
  mergeHighlights,
  mergeNames,
  type AiPayload,
  type NameMaskReplacement,
  type QuickPayload,
  type SensitiveFinding,
  type TextHighlight,
} from "../../components/privacy-check/mask-check-display";
import { api } from "../../lib/api-client";

export function MaskCheckPage() {
  const [text, setText] = useState("");
  const [busyQuick, setBusyQuick] = useState(false);
  const [busyAi, setBusyAi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [disclaimer, setDisclaimer] = useState<string | null>(null);
  const [sourceText, setSourceText] = useState<string | null>(null);
  const [maskedText, setMaskedText] = useState<string | null>(null);
  const [replacements, setReplacements] = useState<NameMaskReplacement[]>([]);
  const [findings, setFindings] = useState<SensitiveFinding[]>([]);
  const [highlights, setHighlights] = useState<TextHighlight[]>([]);
  const [unregistered, setUnregistered] = useState<string[]>([]);
  const [aiScopeNote, setAiScopeNote] = useState<string | null>(null);
  const [truncatedNote, setTruncatedNote] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  async function runCheck(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = text.trim();
    if (!trimmed) return;

    setError(null);
    setBusyQuick(true);
    setBusyAi(false);
    setSourceText(null);
    setMaskedText(null);
    setReplacements([]);
    setFindings([]);
    setHighlights([]);
    setUnregistered([]);
    setAiScopeNote(null);
    setTruncatedNote(null);
    setCopied(false);

    try {
      const quickRes = await api.api["mask-check"].$post({
        json: { text: trimmed, phase: "quick" },
      });
      const quickData = (await quickRes.json().catch(() => null)) as QuickPayload | { error?: string } | null;
      if (!quickRes.ok || !quickData || !("maskedText" in quickData)) {
        setError((quickData && "error" in quickData && quickData.error) || "チェックに失敗しました");
        setBusyQuick(false);
        return;
      }

      setSourceText(quickData.sourceText);
      setMaskedText(quickData.maskedText);
      setReplacements(quickData.nameReplacements);
      setFindings(quickData.sensitiveFindings);
      setHighlights(quickData.highlights ?? []);
      setUnregistered(quickData.unregisteredNameCandidates ?? []);
      setDisclaimer(quickData.disclaimer);
      if (quickData.truncated) {
        setTruncatedNote(
          `入力が長いため先頭のみ処理しました（${quickData.inputCharCount.toLocaleString()} 文字）。`,
        );
      }
      setBusyQuick(false);

      setBusyAi(true);
      try {
        const aiRes = await api.api["mask-check"].$post({
          json: { text: trimmed, phase: "ai" },
        });
        const aiData = (await aiRes.json().catch(() => null)) as AiPayload | { error?: string } | null;
        if (aiRes.ok && aiData && "sensitiveFindings" in aiData) {
          setFindings((prev) => mergeFindings(prev, aiData.sensitiveFindings));
          setUnregistered((prev) => mergeNames(prev, aiData.unregisteredNameCandidates));
          setHighlights((prev) => mergeHighlights(prev, aiData.highlights ?? []));
          setAiScopeNote(aiData.aiScopeNote);
          setDisclaimer(aiData.disclaimer);
        }
      } finally {
        setBusyAi(false);
      }
    } catch {
      setError("チェックに失敗しました");
      setBusyQuick(false);
      setBusyAi(false);
    }
  }

  async function copyMasked() {
    if (!maskedText) return;
    try {
      await navigator.clipboard.writeText(maskedText);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  }

  const hasResult = maskedText !== null;

  return (
    <div className={styles.screen}>
      <PageTitleRow title="個人・機密情報チェック" helpAnchor="privacy-check" />
      <div className={styles.panel}>
        <p style={{ fontSize: "0.875rem", color: "var(--text-muted)", marginTop: 0 }}>
          投入や外部送信の前に、登録済み人名のマスク結果と、個人情報・機密情報っぽい箇所をローカルだけで確認できます。
          この画面からは保存・送信・データ投入は行いません。
        </p>

        <PrivacyCheckForm text={text} busyQuick={busyQuick} busyAi={busyAi} onChangeText={setText} onSubmit={runCheck} />

        {error && (
          <p className={styles.errorText} role="alert">
            {error}
          </p>
        )}

        {hasResult && (
          <div style={{ marginTop: 24, display: "grid", gap: 20 }}>
            {disclaimer && (
              <p
                style={{
                  fontSize: "0.875rem",
                  margin: 0,
                  padding: "10px 12px",
                  background: "var(--surface-2, rgba(0,0,0,0.04))",
                  borderRadius: 6,
                  lineHeight: 1.5,
                }}
              >
                {disclaimer}
              </p>
            )}
            {truncatedNote && (
              <p className={styles.errorText} style={{ margin: 0 }}>
                {truncatedNote}
              </p>
            )}
            {busyAi && (
              <p style={{ fontSize: "0.875rem", color: "var(--muted)", margin: 0 }}>
                ローカルAIで機微っぽい箇所を追加確認しています…
              </p>
            )}
            {aiScopeNote && !busyAi && (
              <p style={{ fontSize: "0.875rem", color: "var(--muted)", margin: 0 }}>{aiScopeNote}</p>
            )}

            <HighlightedTextSection sourceText={sourceText} highlights={highlights} />
            <MaskedTextSection maskedText={maskedText} copied={copied} onCopy={copyMasked} />
            <NameAndFindingsSections
              replacements={replacements}
              unregistered={unregistered}
              findings={findings}
              busyAi={busyAi}
            />
          </div>
        )}
      </div>
    </div>
  );
}
