import { runLocalChat } from "@/lib/local-model";
import { buildGlossaryContextBlock } from "@/lib/glossary-store";
import { listPeople } from "@/lib/people-directory";

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

    if (summary && summary.trim().length > 0 && summary.includes("【")) {
      return summary.trim();
    }
  } catch {
    // ローカルLLMが利用できない環境ではフォールバック
  }

  return fallbackSummarize(trimmed);
}

/**
 * 1日の終わりにEMが入力した振り返りメモ（または対話ログ）から、
 * 「事実・出来事」「EMの判断・対応」「気づき・シグナル」に整理・構造化する。
 */
export async function structureDailyReflectionLocally(reflectionText: string): Promise<string> {
  const trimmed = reflectionText.trim();
  if (!trimmed) return "";

  return structureFromReflectionText(trimmed);
}

export interface ReflectionTurn {
  role: "assistant" | "user";
  content: string;
}

/**
 * 1日の振り返り対話で、1on1のようにEMの発言を受容・傾聴しながら次の問いかけを行う。
 * 無理に1点を深掘り・詰問（なぜスキップしたか等）するのではなく、
 * EMが1日を多面的（全体感 → チーム・メンバー → EM自身の判断・行動 → 違和感・モヤモヤ）
 * に思い返せるように優しく促す。
 */
export async function generateNextReflectionQuestionLocally(
  dialogHistory: ReflectionTurn[],
  todayJournalTexts: string[] = [],
): Promise<string> {
  return generate1on1ReflectionQuestion(dialogHistory, todayJournalTexts);
}

function findPersonInText(text: string): string | null {
  try {
    const people = listPeople();
    for (const p of people) {
      if (p.name && text.includes(p.name)) {
        return p.name;
      }
      for (const alias of p.aliases ?? []) {
        if (alias && text.includes(alias)) {
          return p.name;
        }
      }
    }
  } catch {
    // fallback if directory cannot be loaded
  }

  const match = text.match(
    /(?:^|[はがのとにもへをで、。 \t\n]|から)([\p{Script=Han}]{1,4}|[\p{Script=Katakana}]{2,8}|[A-Za-z]{2,12})(さん|くん|君|氏)/u,
  );
  return match ? match[1] + match[2] : null;
}

function extractTopicPhrase(text: string): string {
  const t = text.trim();
  if (/1on1|面談/i.test(t) && /スキップ|キャンセル|リスケ/i.test(t)) {
    return "1on1のスキップ";
  }
  if (/QA/i.test(t) && /残業|詰まり|負荷|遅れ/i.test(t)) {
    return "QAの残業や詰まり";
  }
  if (/ロードマップ/i.test(t) && /優先度|スコープ|縮小|削る/i.test(t)) {
    return "ロードマップの優先度見直しやスコープの調整";
  }
  if (/会議|ミーティング|MTG/i.test(t) && /続き|多く|疲れ|ヘトヘト/i.test(t)) {
    return "会議続きでの調整";
  }
  if (/障害|トラブル|バグ/i.test(t)) {
    return "障害やトラブル対応";
  }

  const firstSentence = t.split(/[。！？\n]/)[0] || t;
  const cleaned = firstSentence
    .trim()
    .replace(/^本日は|^今日は|^きょうは/, "")
    .replace(/ことに気づきました[。.]?$|ことに気づいた[。.]?$/, "こと")
    .replace(/合意を取りました[。.]?$|合意をとった[。.]?$/, "合意")
    .replace(/見直しました[。.]?$|見直した[。.]?$/, "見直し")
    .replace(/決定しました[。.]?$|決めました[。.]?$/, "決定")
    .replace(/気になりました[。.]?$|気になった[。.]?$/, "こと")
    .replace(/増えています[。.]?$|増えている[。.]?$/, "増加")
    .replace(/ありました[。.]?$|あった[。.]?$/, "こと")
    .replace(/でした[。.]?$/, "")
    .replace(/です[。.]?$/, "")
    .replace(/ました[。.]?$/, "")
    .trim();
  return cleaned.length > 25 ? cleaned.slice(0, 25) + "…" : cleaned;
}

function generate1on1ReflectionQuestion(
  dialogHistory: ReflectionTurn[],
  todayJournalTexts: string[] = [],
): string {
  const userTurns = dialogHistory.filter((t) => t.role === "user");
  const count = userTurns.length;
  const latestText = userTurns[count - 1]?.content ?? "";
  const person = findPersonInText(latestText);

  // Turn 0: オープニングの問いかけ
  if (count === 0) {
    const extra =
      todayJournalTexts.length > 0
        ? `\n（今日のメモ: 「${todayJournalTexts[0].slice(0, 30)}…」なども含め振り返っていただけます）`
        : "";
    return `お疲れ様でした！今日も一日お疲れ様でした。今日はどんな一日でしたか？（印象に残っている出来事や全体の雰囲気など、ざっくりとした一言でも構いません）${extra}`;
  }

  // Turn 1: EMが今日の全体感や出来事を共有。次はチーム・メンバーの動向へ広げる。
  if (count === 1) {
    let empathy = "";
    let nextPrompt = "";

    if (person && /1on1|面談|メンター|スキップ|キャンセル|リスケ|振替/i.test(latestText)) {
      empathy = `${person}との1on1がスキップになっていたのですね。日々の調整や急なタスクもある中で、メンバーとの接点は気にかかる出来事でしたね。`;
      nextPrompt = `${person}のフォローはまた後ほど整理するとして、その${person}以外のメンバーやチーム全体の様子はどうでしたか？何か変化や気になったサインはありましたか？`;
    } else if (person) {
      empathy = `${person}の様子を気にかけていらっしゃったのですね。日頃からメンバーをよく見ていらっしゃいますね。`;
      nextPrompt = `${person}のことだけでなく、他のメンバーやチーム全体の様子・コミュニケーションはいかがでしたか？何か気になった変化はありましたか？`;
    } else if (/疲れ|へとへと|ヘトヘト|大変|忙し|残業|逼迫|バタバタ|体調|負荷/i.test(latestText)) {
      empathy = `様々な調整や対応に追われて、エネルギーを使われた一日でしたね。本当にお疲れ様でした。`;
      nextPrompt = `そうした慌ただしい業務や調整の中で、チームメンバーの様子や会話（1on1や雑談、Slackなど）で、気になったことや変化の兆候などはありましたか？`;
    } else if (/会議|ミーティング|議論|合意|すり合わせ|打ち合わせ|MTG/i.test(latestText)) {
      empathy = `ミーティングや議論が続き、頭をフル回転させた一日でしたね。お疲れ様でした。`;
      nextPrompt = `そうした会議や議論の中で、メンバーや周囲の受け止め・反応で気になった変化などはありましたか？`;
    } else if (/障害|バグ|トラブル|QA|遅延|炎上|手戻り|揉め|ブロック/i.test(latestText)) {
      empathy = `トラブルや現場の急な動きへの対応、緊張感の続く一日でしたね。お疲れ様でした。`;
      nextPrompt = `そうした現場のトラブルや急な動きに向き合われる中で、チームメンバーの様子や会話で、特に気になったサインやフォローが必要そうな点はありましたか？`;
    } else if (/リリース|デプロイ|マージ|完了|実装|機能|設計|前進/i.test(latestText)) {
      empathy = `リリースや開発が着実に前に進んだのですね。お疲れ様でした。`;
      nextPrompt = `そうした前進の中で、チームメンバーの様子や日々のやり取り（1on1や雑談など）で、ふと気になった兆候や変化はありましたか？`;
    } else if (/順調|良かった|解決|安心|落ち着|感謝|自律|いい感じ/i.test(latestText)) {
      empathy = `落ち着いて物事が進んだようで何よりです。一日お疲れ様でした。`;
      nextPrompt = `そうした順調な進捗の中で、チームメンバーの様子や会話で、新しく見えてきた変化や兆候などはありましたか？`;
    } else {
      const topic = extractTopicPhrase(latestText);
      empathy = `「${topic}」について共有していただきありがとうございます。慌ただしい中でも様々なことが動いていた一日でしたね。`;
      const extraContext =
        todayJournalTexts.length > 0
          ? `（今日のメモ「${todayJournalTexts[0].slice(0, 25)}…」の件も含め、）`
          : "";
      nextPrompt = `そうした動きの中で、${extraContext}チームメンバーの様子や会話（1on1や雑談、Slackなど）で、気になったことや変化の兆候などはありましたか？`;
    }

    return `${empathy}\n\n${nextPrompt}`;
  }

  // Turn 2: EMがチームやメンバーの様子を共有。次はEM自身の意思決定・アクションへ視点を移す。
  if (count === 2) {
    let empathy = "";
    let nextPrompt = "";

    if (person && /苦戦|課題|悩み|フォロー|相談|様子/i.test(latestText)) {
      empathy = `${person}の状況を察知して、しっかり寄り添っていらっしゃるのですね。細やかな目配りが素晴らしいと思います。`;
      nextPrompt = `${person}のサポートやチームの状況に心を配られる中で、今日一日、EMご自身として『判断・決定したこと』や、新しく前に進められたタスクなどはどんなことがありましたか？`;
    } else if (/QA|テスト|残業|詰まり|遅れ|遅延|負荷|逼迫|疲/i.test(latestText)) {
      const focus = /QA/i.test(latestText) ? "QAの状況や残業" : "現場の負荷やメンバーの状況";
      empathy = `${focus}をしっかりキャッチされていますね。現場のリアルな負荷を見逃さない姿勢はさすがです。`;
      nextPrompt = `そうした${focus}に向き合い、チームを支えられる中で、今日一日、EMご自身として『判断・決定したこと』や、新しく前に進められたタスクなどはどんなことがありましたか？`;
    } else if (/特に(ない|なし|ありません)|大丈夫|順調|問題(ない|なし|ありません)|落ち着|自律/i.test(latestText)) {
      empathy = `チームが落ち着いて自律的に動けているのは安心ですね。日頃の土台作りや信頼関係が効いているのだと思います。`;
      nextPrompt = `そうしたチームが自律して動いている環境の中で、今日一日、EMご自身として集中して『判断・決定したこと』や、新しく前に進められたタスクなどはどんなことがありましたか？`;
    } else {
      const topic = extractTopicPhrase(latestText);
      empathy = `「${topic}」というチームの様子を教えていただきありがとうございます。メンバーの動きをよく見守られていますね。`;
      nextPrompt = `そうしたチームの状況を踏まえつつ、EMご自身について振り返ってみましょう。今日一日の中で、ご自身で『判断・決定したこと』や、新しく前に進められたタスクなどはどんなことがありましたか？`;
    }

    return `${empathy}\n\n${nextPrompt}`;
  }

  // Turn 3: EMが自身の行動や判断を共有。次は違和感・モヤモヤ・明日への引き継ぎへ。
  if (count === 3) {
    let empathy = "";
    let nextPrompt = "";

    if (/ロードマップ|優先度|スコープ/i.test(latestText)) {
      empathy = `ロードマップの優先度やスコープの調整という、難しいながらもチームの現実を見据えた重要な意思決定を前に進められたのですね。素晴らしい決断だと思います。`;
      nextPrompt = `そのロードマップの優先度調整や合意を進められた上で、ふと頭の片隅に引っかかっている違和感や、明日以降に意識しておきたいモヤモヤ・課題などはありますか？特になければ、『📝 この内容で振り返りをまとめる』を押して本日の振り返りとしてまとめられます。`;
    } else if (/決めた|判断|決定|合意|縮小|見直し|承認|舵を切/i.test(latestText)) {
      const topic = extractTopicPhrase(latestText);
      empathy = `「${topic}」という重要な意思決定を前に進められたのですね。チームの方向性を定める大きな一歩だと思います。`;
      nextPrompt = `その判断や決定をやりきった今、ふと頭の片隅に引っかかっている違和感や、明日以降に意識しておきたいモヤモヤ・課題などはありますか？特になければ、『📝 この内容で振り返りをまとめる』を押して本日の振り返りとしてまとめられます。`;
    } else if (/特に(ない|なし|ありません)|できなかった|進まなかった|追われ|雑務|会議|トラブル/i.test(latestText)) {
      empathy = `突発対応やチームの交通整理に奔走された一日だったのですね。自分が手を動かすこと以上に、チームのブロッカーを取り除き前進を守るという、EMとして最も大切な役割を果たされたと思います。`;
      nextPrompt = `そうした激動の調整やサポートをこなされた一日を振り返って、ふと頭の片隅に引っかかっている違和感や、明日以降に意識しておきたいモヤモヤ・心残りなどはありますか？特になければ、『📝 この内容で振り返りをまとめる』を押して本日の振り返りとしてまとめられます。`;
    } else {
      const topic = extractTopicPhrase(latestText);
      empathy = `「${topic}」を着実に前に進められたのですね。EMとして一つひとつ判断を積み重ねられた一日でしたね。`;
      nextPrompt = `そうしたタスクや判断を前に進められた上で、ふと頭の片隅に引っかかっている違和感や、明日以降に意識しておきたいモヤモヤ・課題などはありますか？特になければ、『📝 この内容で振り返りをまとめる』を押して本日の振り返りとしてまとめられます。`;
    }

    return `${empathy}\n\n${nextPrompt}`;
  }

  // Turn 4+: モヤモヤの受容とまとめへの誘導
  let empathy = "";
  let nextPrompt = "";

  if (/特になし|特にありません|大丈夫|ない|問題ない/i.test(latestText)) {
    empathy = `気になる点を整理した上で、すっきりと一日を終えられそうですね。充実した一日でした、本当にお疲れ様でした！`;
    nextPrompt = `今日一日の出来事や判断、チームの様子をしっかり言語化できましたね。よろしければ『📝 この内容で振り返りをまとめる』を押して、本日の振り返りをジャーナルとして保存しましょう。`;
  } else {
    const topic = extractTopicPhrase(latestText);
    empathy = `「${topic}」について、率直なモヤモヤや気づきを言語化していただき、ありがとうございます。そうした小さな違和感に気づけること自体が、EMとして大切なシグナルですね。`;
    nextPrompt = `今日一日、チームのことやご自身の判断、そして気になる違和感までしっかり振り返ることができましたね。よろしければ『📝 この内容で振り返りをまとめる』を押して、本日の振り返りをジャーナルとして保存しましょう。`;
  }

  return `${empathy}\n\n${nextPrompt}`;
}

function structureFromReflectionText(text: string): string {
  const lines = text.split("\n");
  const emUtterances: string[] = [];
  let currentEmContent: string[] = [];
  let inEm = false;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("EM:")) {
      if (inEm && currentEmContent.length > 0) {
        emUtterances.push(currentEmContent.join(" ").trim());
      }
      inEm = true;
      currentEmContent = [trimmed.replace(/^EM:\s*/, "")];
    } else if (trimmed.startsWith("AI:")) {
      if (inEm && currentEmContent.length > 0) {
        emUtterances.push(currentEmContent.join(" ").trim());
      }
      inEm = false;
      currentEmContent = [];
    } else if (inEm && trimmed.length > 0) {
      currentEmContent.push(trimmed);
    }
  }
  if (inEm && currentEmContent.length > 0) {
    emUtterances.push(currentEmContent.join(" ").trim());
  }

  const utterances =
    emUtterances.length > 0
      ? emUtterances
      : lines
          .map((l) => l.trim())
          .filter((l) => l.length > 0 && !l.startsWith("AI:"));

  if (utterances.length === 0) {
    return [
      "**【事実・出来事】**",
      "- （特記事項なし）",
      "",
      "**【EMの判断・対応】**",
      "- （対応検討中）",
      "",
      "**【気づき・シグナル】**",
      "- （特記事項なし）",
    ].join("\n");
  }

  const facts: string[] = [];
  const actions: string[] = [];
  const insights: string[] = [];

  for (let i = 0; i < utterances.length; i++) {
    const u = utterances[i];
    if (
      /決めた|判断|見直し|合意|縮小|決定|指示|相談した|共有した|対応した|動いた|進めた/i.test(u) ||
      (utterances.length >= 3 && i === 2)
    ) {
      actions.push(u);
    } else if (
      (i > 0 && /気にな|違和感|モヤモヤ|懸念|不安|課題|兆候|詰まり|リスク|学び|必要/i.test(u)) ||
      (utterances.length >= 4 && i === 3)
    ) {
      insights.push(u);
    } else {
      facts.push(u);
    }
  }

  return [
    "**【事実・出来事】**",
    facts.length > 0 ? facts.map((f) => `- ${f}`).join("\n") : "- （特記事項なし）",
    "",
    "**【EMの判断・対応】**",
    actions.length > 0 ? actions.map((a) => `- ${a}`).join("\n") : "- （対応検討中）",
    "",
    "**【気づき・シグナル】**",
    insights.length > 0 ? insights.map((ins) => `- ${ins}`).join("\n") : "- （特記事項なし）",
  ].join("\n");
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
