import { runLocalChat } from "@/lib/local-model";
import { buildGlossaryContextBlock } from "@/lib/glossary-store";

/**
 * 議事録やチャットログ等の長い生テキストを、ローカルLLMを用いて外部に一切送信せずに要約する。
 * 機微な個人会話や生ログを削ぎ落とし、「決定事項」「状況変化・シグナル」「ネクストアクション」に圧縮する。
 */
export async function summarizeLogLocally(rawText: string): Promise<string> {
  const trimmed = rawText.trim();
  if (!trimmed) return "";

  const glossary = buildGlossaryContextBlock();
  const systemPrompt = `あなたはエンジニアリングマネージャー（EM）を支援するアシスタントです。
入力された議事録やチャットログから、機微な雑談や不要な詳細を削ぎ落とし、EMが判断・把握すべき最小限の重要シグナルを抽出してMarkdownで要約してください。
${glossary ? `\n${glossary}\n` : ""}
出力フォーマット:
- **【決定事項・合意】**: 会議やチャットで決まったこと
- **【状況変化・シグナル】**: メンバーや組織の兆候、体調やモチベーション、課題
- **【ネクストアクション】**: 今後の予定やタスク`;

  try {
    const summary = await runLocalChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `以下のテキストを要約・シグナル抽出してください:\n\n${trimmed}` },
      ],
      400,
    );

    if (summary && summary.trim().length > 0) {
      return summary.trim();
    }
  } catch {
    // ローカルLLMが利用できない環境ではフォールバック
  }

  return fallbackSummarize(trimmed);
}

/**
 * 1日の終わりにEMが入力した振り返りメモから、
 * 「事実・出来事」「EMがやったこと・判断」「気づき・シグナル」に整理・構造化する。
 */
export async function structureDailyReflectionLocally(reflectionText: string): Promise<string> {
  const trimmed = reflectionText.trim();
  if (!trimmed) return "";

  const systemPrompt = `あなたはEMの日々の内省（振り返り）を整理するアシスタントです。
EMが書いた自由記述の振り返りから、以下の3点に構造化してMarkdown箇条書きで整理してください。推測で嘘の情報を付け足さず、EMの記述に沿って簡潔にまとめてください。

- **【事実・出来事】**: 今日組織やチームであった客観的な出来事
- **【EMの判断・対応】**: EM自身が決めたこと、行動したこと
- **【気づき・シグナル】**: 気になったこと、違和感、今後の課題`;

  try {
    const structured = await runLocalChat(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: `以下のEMの振り返りを構造化してください:\n\n${trimmed}` },
      ],
      400,
    );

    if (structured && structured.trim().length > 0) {
      return structured.trim();
    }
  } catch {
    // ローカルLLMが利用できない環境ではフォールバック
  }

  return fallbackReflectionStructure(trimmed);
}

function fallbackSummarize(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  const bullets = lines.slice(0, 5).map((l) => (l.startsWith("-") || l.startsWith("*") ? l : `- ${l}`));

  return [
    "**【決定事項・合意】**",
    bullets.slice(0, 2).join("\n") || "- （要確認）",
    "",
    "**【状況変化・シグナル】**",
    bullets.slice(2, 4).join("\n") || "- （特記事項なし）",
    "",
    "**【ネクストアクション】**",
    bullets.slice(4).join("\n") || "- （後続対応なし）",
  ].join("\n");
}

function fallbackReflectionStructure(text: string): string {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length > 0);

  return [
    "**【事実・出来事】**",
    lines.length > 0 ? `- ${lines[0]}` : "- （記録なし）",
    "",
    "**【EMの判断・対応】**",
    lines.length > 1 ? `- ${lines[1]}` : "- （対応検討中）",
    "",
    "**【気づき・シグナル】**",
    lines.length > 2 ? lines.slice(2).map((l) => `- ${l}`).join("\n") : "- （特になし）",
  ].join("\n");
}
