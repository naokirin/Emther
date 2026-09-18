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

export interface ReflectionTurn {
  role: "assistant" | "user";
  content: string;
}

/**
 * 1日の振り返り対話で、EMの回答や本日のJournalメモをもとに次の問いかけを生成する。
 * 無理に1点を深掘りするのではなく、EMが1日の多様な側面（全体感、メンバーや1on1の兆候、
 * EM自身の意思決定やタスク進捗、ふとした違和感や気づき）を幅広く思い返せるようにする。
 */
export async function generateNextReflectionQuestionLocally(
  dialogHistory: ReflectionTurn[],
  todayJournalTexts: string[] = [],
): Promise<string> {
  const todayJournalBlock =
    todayJournalTexts.length > 0
      ? `\n【本日すでに記録されたJournalメモ】\n${todayJournalTexts.slice(0, 3).map((t) => `- ${t.slice(0, 80)}`).join("\n")}\n`
      : "";

  const systemPrompt = `あなたはエンジニアリングマネージャー（EM）の1日の終わりの内省・振り返りを導くAIパートナーです。
目的: EMが無理なく今日1日を広く振り返り、やったこと・決めたこと・気づき・メンバーの兆候を思い起こせるようにすること。
${todayJournalBlock}
【重要指示】
- 無理に特定の1つの話題だけを深掘り・追及しないでください。
- EMの直前の発言に温かく簡潔に相槌・共感を打った上で、まだ触れられていない業務の異なる側面（チームメンバーや1on1の様子、EM自身の意思決定やタスク、ふとした違和感や心残りなど）へと広く目を向けられるような問いかけを1つ投げかけてください。
- 1〜2文の短く気軽に応答できる質問にしてください。`;

  try {
    const chatMessages = [
      { role: "system", content: systemPrompt },
      ...dialogHistory.map((t) => ({ role: t.role, content: t.content })),
    ];
    const reply = await runLocalChat(chatMessages, 250);
    if (reply && reply.trim().length > 0) {
      return reply.trim();
    }
  } catch {
    // fallback
  }

  return fallbackNextReflectionQuestion(dialogHistory, todayJournalTexts);
}

function fallbackNextReflectionQuestion(
  dialogHistory: ReflectionTurn[],
  todayJournalTexts: string[] = [],
): string {
  const userTurns = dialogHistory.filter((t) => t.role === "user");
  const count = userTurns.length;

  if (count === 0) {
    const extra =
      todayJournalTexts.length > 0
        ? `\n（今日のメモ: 「${todayJournalTexts[0].slice(0, 30)}…」なども含め振り返っていただけます）`
        : "";
    return `お疲れ様でした！今日も一日お疲れ様でした。今日はどんな一日でしたか？（印象に残っている出来事や、全体の雰囲気など、ざっくりとした一言でも構いません）${extra}`;
  }

  if (count === 1) {
    const extra =
      todayJournalTexts.length > 1
        ? `また、今日メモにあった「${todayJournalTexts[1].slice(0, 25)}…」の件も含めて、`
        : "";
    return `なるほど、そのようなことがあったのですね。お疲れ様でした。${extra}チームメンバーの様子や1on1での会話、体調・モチベーションなどで気になった兆候や変化はありましたか？`;
  }

  if (count === 2) {
    return `ありがとうございます。メンバーや組織とのやり取りも大切ですね。ちなみに、EMご自身として今日決断したことや、新しく前に進められた課題・タスクなどはありましたか？`;
  }

  return `一日を通して様々なことが前に進みましたね。今日を振り返って、心残りや、ふと引っかかった違和感、明日以降に意識したいモヤモヤ・気づきなどはありますか？特になければ、このまま本日の振り返りとしてまとめますね。`;
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
