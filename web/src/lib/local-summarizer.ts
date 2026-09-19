import { runLocalChat } from "@core/local-model";
import { buildGlossaryContextBlock } from "@/lib/glossary-store";
import { listPeople } from "@core/people-directory";

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
 * 外部に一切送信せず、ローカルLLM（Few-Shot付与）で構造化を試み、不可時はルールベースへフォールバックする。
 */
export async function structureDailyReflectionLocally(reflectionText: string): Promise<string> {
  const trimmed = reflectionText.trim();
  if (!trimmed) return "";

  try {
    const aiStructured = await structureDailyReflectionViaLocalAI(trimmed);
    if (aiStructured && aiStructured.trim().length > 0) {
      return aiStructured.trim();
    }
  } catch {
    // フォールバック
  }

  return structureFromReflectionText(trimmed);
}

export interface ReflectionTurn {
  role: "assistant" | "user";
  content: string;
}

/**
 * 1日の振り返り対話で、1on1のようにEMの発言を受容・傾聴しながら次の問いかけを行う。
 * 外部APIへの送信は行わず、端末内のローカルLLM（Few-Shot学習）を活用して
 * EMの具体的な発言に応じた血の通った深掘りと内省促進を行う。
 * オフライン時やモデル未ロード時は、ルールベースの1on1対話生成へフォールバックする。
 */
export async function generateNextReflectionQuestionLocally(
  dialogHistory: ReflectionTurn[],
  todayJournalTexts: string[] = [],
): Promise<string> {
  const userTurns = dialogHistory.filter((t) => t.role === "user");

  // Turn 0: オープニングの問いかけは定型で温かく開始
  if (userTurns.length === 0) {
    const extra =
      todayJournalTexts.length > 0
        ? `\n（今日のメモ: 「${todayJournalTexts[0].slice(0, 30)}…」なども含め振り返っていただけます）`
        : "";
    return `お疲れ様でした！今日も一日お疲れ様でした。今日はどんな一日でしたか？（印象に残っている出来事や全体の雰囲気など、ざっくりとした一言でも構いません）${extra}`;
  }

  // Turn 1以降: ローカルLLMによる文脈を捉えた深い1on1問いかけを試みる
  try {
    const aiQuestion = await generateReflectionQuestionViaLocalAI(dialogHistory, todayJournalTexts);
    if (aiQuestion && aiQuestion.trim().length > 0) {
      return aiQuestion.trim();
    }
  } catch {
    // ローカルLLMが利用できない環境ではルールベースへフォールバック
  }

  return generate1on1ReflectionQuestion(dialogHistory, todayJournalTexts);
}

const REFLECTION_COACH_FEW_SHOT: { user: string; assistant: string }[] = [
  {
    user: "本日はメンバーとの面談が急遽リスケになりました。最近少し疲れ気味に見えていたので気になっています。",
    assistant: "普段と違うリスケや疲れの様子があると、何か無理をしていないか心配になりますね。\n最近の業務負荷や関わっているタスクで、負担になっていそうな要因として思い当たることはありますか？",
  },
  {
    user: "QAの残業が増えていて、テスト工程がボトルネックになっています。",
    assistant: "テスト工程での詰まりやメンバーの残業は、全体のリリースにも影響するため気がかりですね。\n仕様の手戻りやリソースの偏りなど、ボトルネックになっていそうな要因として何が一番大きそうでしょうか？",
  },
  {
    user: "直前の仕様変更が重なり、開発メンバーから反発が出てしまって対応に苦慮しました。",
    assistant: "直前の仕様変更に対する現場の反発と調整、精神的にも大きなエネルギーを使う対応でしたね。本当にお疲れ様でした。\nメンバーの納得感を得たりチームの負荷を減らすために、今日ご自身で判断したことやすり合わせた内容はありましたか？",
  },
  {
    user: "明日朝イチで優先度の棚卸しを一緒にやろうと思います。",
    assistant: "朝イチですぐに棚卸しに伴走するという次の一手が明確になりましたね。メンバーも安心すると思います。\n今日一日を振り返ってみて、他に頭の片隅に引っかかっている違和感や心残りはありますか？",
  },
];

async function generateReflectionQuestionViaLocalAI(
  dialogHistory: ReflectionTurn[],
  todayJournalTexts: string[] = [],
): Promise<string | null> {
  const userTurns = dialogHistory.filter((t) => t.role === "user");
  const latestUser = userTurns[userTurns.length - 1]?.content ?? "";
  if (!latestUser.trim()) return null;

  const previousUser = userTurns.length > 1 ? userTurns[userTurns.length - 2]?.content : null;
  const contextNote = previousUser ? `（直前の文脈: ${previousUser.slice(0, 40)}…）\n` : "";
  const journalNote =
    todayJournalTexts.length > 0
      ? `（今日のメモ参考: ${todayJournalTexts[0].slice(0, 30)}…）\n`
      : "";

  const systemPrompt = `あなたはエンジニアリングマネージャー（EM）のための親身な1on1振り返りパートナーです。
EMの発言を温かく受け止めて共感し、背景や兆候、打ち手を掘り下げる「問いかけ」を投げかけてください。
前置きや見出し・解説（「共感：」「問いかけ：」などのラベル）は書かず、EMへの返答文のみ（共感と問いかけ）を直接出力してください。推測で無関係な人名を補わないでください。`;

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...REFLECTION_COACH_FEW_SHOT.flatMap((ex) => [
      { role: "user" as const, content: ex.user },
      { role: "assistant" as const, content: ex.assistant },
    ]),
    { role: "user", content: `${journalNote}${contextNote}${latestUser}` },
  ];

  try {
    const raw = await runLocalChat(messages, 1000);
    if (!raw || !raw.trim()) return null;

    let cleaned = raw
      .trim()
      .replace(/^(?:AI|あなた|アシスタント|振り返りパートナー)[:：]\s*/i, "")
      .replace(/^(?:共感|受け止め)[:：]\s*/i, "")
      .replace(/\n(?:問いかけ|質問)[:：]\s*/i, "\n")
      .split(/\n(?:ユーザー|EM|User)[:：]/i)[0]
      .trim();

    if (cleaned.length >= 15 && /[?？]|でしょうか|ですか|ありますか|でしたか|ですかね/.test(cleaned)) {
      return cleaned;
    }
  } catch {
    // ローカルモデル未準備・エラー時はnullを返しフォールバック
  }

  return null;
}

async function structureDailyReflectionViaLocalAI(text: string): Promise<string | null> {
  const systemPrompt = `あなたはエンジニアリングマネージャー（EM）の振り返りを整理するアシスタントです。
入力テキストから以下の3つの見出しに構造化してMarkdown箇条書きで出力してください。推測で嘘の情報を足さないでください。
- **【事実・出来事】**
- **【EMの判断・対応】**
- **【気づき・シグナル】**`;

  const FEW_SHOT = [
    {
      user: "本日は田中さんの1on1がスキップされたことに気づきました。新しい案件が重なっていて少し抱え込み気味だったようです。明日朝イチで田中さんに声かけして案件の棚卸しを一緒にやろうと思います。",
      assistant: `**【事実・出来事】**\n- 田中さんの1on1がスキップされた\n- 新しい案件が複数重なっている\n\n**【EMの判断・対応】**\n- 明日の朝イチで田中さんに声かけし、案件の棚卸しを一緒に実施する\n\n**【気づき・シグナル】**\n- 田中さんがタスクを抱え込み気味になっている兆候がある`,
    },
  ];

  const messages: { role: "system" | "user" | "assistant"; content: string }[] = [
    { role: "system", content: systemPrompt },
    ...FEW_SHOT.flatMap((ex) => [
      { role: "user" as const, content: ex.user },
      { role: "assistant" as const, content: ex.assistant },
    ]),
    { role: "user", content: text },
  ];

  try {
    const raw = await runLocalChat(messages, 1000);
    if (!raw || !raw.trim()) return null;

    const cleaned = raw.trim();
    if (
      cleaned.includes("【事実・出来事】") ||
      cleaned.includes("【EMの判断・対応】") ||
      cleaned.includes("【気づき・シグナル】")
    ) {
      return cleaned;
    }
  } catch {
    // ローカルモデル未準備・エラー時はnullを返しフォールバック
  }

  return null;
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
    .replace(/だったようです[。.]?$|だったよう[。.]?$|ようです[。.]?$|よう[。.]?$/, "")
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
  const prevText = userTurns[count - 2]?.content ?? "";
  const person = findPersonInText(latestText) || findPersonInText(prevText);

  // Turn 0: オープニングの問いかけ
  if (count === 0) {
    const extra =
      todayJournalTexts.length > 0
        ? `\n（今日のメモ: 「${todayJournalTexts[0].slice(0, 30)}…」なども含め振り返っていただけます）`
        : "";
    return `お疲れ様でした！今日も一日お疲れ様でした。今日はどんな一日でしたか？（印象に残っている出来事や全体の雰囲気など、ざっくりとした一言でも構いません）${extra}`;
  }

  // Turn 1: EMが最初の出来事・状況を共有。その出来事の背景・兆候・ボトルネックを1歩深掘りする。
  if (count === 1) {
    let empathy = "";
    let nextPrompt = "";

    if (person && /1on1|面談|メンター|スキップ|キャンセル|リスケ|振替/i.test(latestText)) {
      empathy = `${person}との1on1がスキップになっていたのですね。日々の調整や急なタスクもある中で、メンバーとの接点は気にかかる出来事でしたね。`;
      nextPrompt = `${person}について、最近の業務負荷や様子などで何か気になっているサインや、スキップに至った背景として思い当たることはありますか？`;
    } else if (person && /苦戦|悩み|困っ|体調|疲れ|モチベ|詰ま/i.test(latestText)) {
      empathy = `${person}の様子に気を配っていらっしゃるのですね。メンバーの変化をよく観察されていますね。`;
      nextPrompt = `${person}が直面している難しさや負荷について、具体的にどんな部分で詰まっていそうでしょうか？また、ご自身から見て何が一番のボトルネックだと感じますか？`;
    } else if (person) {
      empathy = `${person}の様子を気にかけていらっしゃったのですね。日頃からメンバーをよく見ていらっしゃいますね。`;
      nextPrompt = `${person}とのやり取りの中で、印象に残った発言や、日頃と少し違う変化・兆候などはありましたか？`;
    } else if (/QA|テスト|残業|詰まり|遅延|遅れ|バグ|障害|トラブル/i.test(latestText)) {
      const focus = /QA/i.test(latestText) ? "QAの現場の詰まりや残業" : "現場のトラブルや負荷";
      empathy = `${focus}への対応、緊張感の続く一日でしたね。現場に向き合われ本当にお疲れ様でした。`;
      nextPrompt = `その${focus}について、仕様の変更や手戻り、あるいはリソースの偏りなど、ボトルネックになっていそうな要因として何が一番大きそうでしょうか？`;
    } else if (/会議|ミーティング|議論|合意|すり合わせ|打ち合わせ|MTG/i.test(latestText)) {
      empathy = `ミーティングや議論が続き、頭をフル回転させた一日でしたね。お疲れ様でした。`;
      nextPrompt = `今日こなされた議論や打ち合わせの中で、特にエネルギーを使ったテーマや、一番論点・焦点になったポイントはどんなことでしたか？`;
    } else if (/ロードマップ|優先度|スコープ|決めた|判断|決定/i.test(latestText)) {
      empathy = `重要な意思決定や方針の見直しを前に進められたのですね。勇気ある判断だったと思います。`;
      nextPrompt = `その合意形成や判断に至る中で、関係者とのすり合わせで一番意識したことや、トレードオフとして悩まれた部分はどんなところでしたか？`;
    } else if (/疲れ|へとへと|ヘトヘト|大変|忙し|逼迫|バタバタ/i.test(latestText)) {
      empathy = `様々な調整や対応に追われて、エネルギーを使われた一日でしたね。本当にお疲れ様でした。`;
      nextPrompt = `今日一番ご自身の時間を取られたり、頭を悩ませた業務や出来事はどんなことでしたか？`;
    } else if (/順調|良かった|解決|安心|落ち着|感謝|自律|いい感じ/i.test(latestText)) {
      empathy = `落ち着いて物事が進んだようで何よりです。一日お疲れ様でした。`;
      nextPrompt = `そうした順調な進捗を支えている要因として、メンバーの動きやチーム内の連携で「うまく機能したな」と感じるポイントはありましたか？`;
    } else {
      const topic = extractTopicPhrase(latestText);
      empathy = `「${topic}」について共有していただきありがとうございます。慌ただしい中でも様々なことが動いていた一日でしたね。`;
      nextPrompt = `その出来事について、ご自身として特に気にかかっているポイントや、背景として感じていることはどんなところでしょうか？`;
    }

    return `${empathy}\n\n${nextPrompt}`;
  }

  // Turn 2: EMが背景・要因・状況を深掘りして回答。それを受け止め、EM自身のアクションやチーム全体への展開を促す。
  if (count === 2) {
    let empathy = "";
    let nextPrompt = "";

    if (person) {
      const topic = extractTopicPhrase(latestText);
      empathy = `なるほど、${person}に関して「${topic}」という背景やサインに気づかれたのですね。EMとしてそこに目を向けられたのは非常に大きな気づきですね。`;
      nextPrompt = `この件について、${person}へどんなフォローや声かけをしてみようと思いますか？また、他のメンバーやチーム全体でも同じような負荷や兆候は見られますか？`;
    } else if (/QA|テスト|手戻り|仕様|残業|ボトルネック|リソース/i.test(latestText)) {
      const topic = extractTopicPhrase(latestText);
      empathy = `「${topic}」が影響していたのですね。構造的なボトルネックを的確に捉えられていますね。`;
      nextPrompt = `そうした要因に対して、開発チームや関係者との調整など、今日EMご自身が判断したことや明日以降に打とうと考えている手はありますか？`;
    } else if (/トレードオフ|バランス|合意|納得|反発|優先/i.test(latestText)) {
      empathy = `チームの持続可能性や事業の優先度を熟慮して判断された様子がよく伝わってきます。素晴らしいリーダーシップですね。`;
      nextPrompt = `その決断を踏まえ、チームメンバーの受け止めや、明日以降の動き出しに向けて意識していることや気になっている点はありますか？`;
    } else {
      const topic = extractTopicPhrase(latestText);
      empathy = `「${topic}」という背景を教えていただきありがとうございます。状況の根っこにある要因が見えてきましたね。`;
      nextPrompt = `そうした状況を踏まえつつ、今日一日の中で、EMご自身として『判断・決定したこと』や、新しく前に進められたタスクなどはどんなことがありましたか？`;
    }

    return `${empathy}\n\n${nextPrompt}`;
  }

  // Turn 3: EMが取ったアクション・判断・チームの様子を回答。モヤモヤ・違和感・内省へ誘う。
  if (count === 3) {
    let empathy = "";
    let nextPrompt = "";

    const topic = extractTopicPhrase(latestText);
    if (/声かけ|フォロー|棚卸し|整理|相談|合意|決めた|判断|打診|見直し/i.test(latestText)) {
      empathy = `「${topic}」という次の一手や判断を明確に描けていらっしゃいますね。現場への確かな前進を感じます。`;
      nextPrompt = `状況の把握から背景の洞察、そして次の一手までしっかりと思考を深められましたね。今日を終えてみて、ふと頭の片隅に引っかかっている違和感や、明日以降に意識しておきたいモヤモヤ・課題などはありますか？特になければ、『📝 この内容で振り返りをまとめる』を押して本日の振り返りとしてまとめられます。`;
    } else if (/特に(ない|なし|ありません)|大丈夫|落ち着/i.test(latestText)) {
      empathy = `チームやメンバーが落ち着いて動けているのは安心ですね。日頃のコミュニケーションの積み重ねの賜物だと思います。`;
      nextPrompt = `今日一日を振り返ってみて、ふと頭の片隅に引っかかっている違和感や、明日以降に意識しておきたいモヤモヤ・課題などはありますか？特になければ、『📝 この内容で振り返りをまとめる』を押して本日の振り返りとしてまとめられます。`;
    } else {
      empathy = `EMとして一つひとつ判断と対応を積み重ね、前進された一日でしたね。`;
      nextPrompt = `一日を通して様々な判断や対応をこなされましたね。今日を振り返ってみて、ふと頭の片隅に引っかかっている違和感や、明日以降に意識しておきたいモヤモヤ・課題などはありますか？特になければ、『📝 この内容で振り返りをまとめる』を押して本日の振り返りとしてまとめられます。`;
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
    nextPrompt = `今日一日、チームのことやご自身の判断、そして気になる違和感までしっかり深く振り返ることができましたね。よろしければ『📝 この内容で振り返りをまとめる』を押して、本日の振り返りをジャーナルとして保存しましょう。`;
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
      /決めた|判断|見直し|合意|縮小|決定|指示|相談した|共有した|対応した|動いた|進めた|声かけ|フォロー|やろうと思う|やってみる|調整する|打診/i.test(u) ||
      (utterances.length >= 3 && i === 2)
    ) {
      actions.push(u);
    } else if (
      (i > 0 && /気にな|違和感|モヤモヤ|懸念|不安|課題|兆候|詰まり|リスク|学び|必要|抱え込|重なっ|要因|背景|苦戦|難し/i.test(u)) ||
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
