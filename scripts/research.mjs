// 毎日のリサーチ: Claude API (web search付き) で本日の投稿ネタを収集し out/research.json に保存
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY が設定されていません');
  process.exit(1);
}

const now = new Date();
const jstDate = now.toLocaleDateString('ja-JP', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
});
// 日替わりでテーマをローテーション（{ type, topic } の配列）
const dayOfYear = Math.floor(
  (now - new Date(now.getFullYear(), 0, 0)) / 86400000
);
const themeEntry = config.themes[dayOfYear % config.themes.length];
const topic = typeof themeEntry === 'string' ? themeEntry : themeEntry.topic;
const postType = typeof themeEntry === 'string' ? 'logic' : (themeEntry.type || 'logic');
const isNews = postType === 'news';

const audience = config.audience || 'AIやClaudeを使って副業・個人で稼ぎたい人';

const typeBlock = isNews
  ? `# 今回は「ニュース投稿」
${config.postTypes?.news || 'Claude/Anthropicの最新情報を公式の一次情報を引用して要点解説する。'}
- Web検索で「Claude / Anthropic」に関する【最新かつ事実】の情報を集めること。優先ソース＝ anthropic.com / docs.anthropic.com / 公式ブログ / 公式リリースノート / 公式X(@AnthropicAI) などの一次情報（公式）。
- 憶測・リーク・未確認情報・古い情報は使わない。日付・数値・機能名は正確に。断定できないことは書かない。
- 必ず出典（公式）を1つ特定し、"source_name"（例: Anthropic公式ブログ）と "source_url"（その公式URL）に入れる。
- caption_x と caption_instagram の末尾に必ず「出典: {source_name}」を明記し、source_url も載せる（Xにも載せる）。`
  : `# 今回は「ロジック投稿」
${config.postTypes?.logic || '主張→理由→具体→結論の論理構造で、副業者向けの判断基準・思考フレーム・手順を示す。'}
- 精神論・煽り・一般論は禁止。「主張 → なぜそう言えるか(理由) → 具体例や数字 → だから何をすべきか(結論)」の論理構造で書く。
- 数字・比較・手順など"根拠"を入れる。事実確認が必要な数値はWeb検索で裏取りし、使った場合のみ source_name / source_url に出典を入れる（なければ空文字 "" にする）。`;

const prompt = `あなたは日本のSNS運用のプロで、ターゲットは「${audience}」です。今日は ${jstDate} です。
本日のテーマ:「${topic}」

# 誰に向けて
読者は副業でAI・Claudeを使って稼ぎたい層（会社員の副業〜駆け出しフリーランス）。彼らが「自分ごとだ」「今日から使える」「なるほど、そういうことか」と感じる粒度・具体度で書くこと。

${typeBlock}

# 全体ルール
- 宣伝・CTA・リンク誘導・プロフィール誘導は入れない（このアカウントはCTAなし方針）。ハッシュタグと（ニュース時の）出典URLだけは可。
- 誇張しない。読者を子ども扱いしない。中身のない当たり前は書かない。

以下のJSON形式のみで出力してください（JSON以外のテキストは一切書かない）:

{
  "post_type": "${postType}",
  "headline": "画像用の見出し。最大22文字。数字や具体語を入れて言い切る",
  "sub": "見出しの補足。最大40文字",
  "points": ["要点1(最大28文字)", "要点2(最大28文字)", "要点3(最大28文字)"],
  "image_prompt": "English prompt for an abstract AI-generated background image matching the topic's mood. No text, no letters, no people. e.g. 'futuristic abstract tech background, flowing purple and teal gradients, digital particles'",
  "source_name": "${isNews ? '出典（公式）の名称。例: Anthropic公式ブログ' : '（数字の出典があれば名称、なければ空文字）'}",
  "source_url": "${isNews ? '出典（公式）のURL' : '（数字の出典があればURL、なければ空文字）'}",
  "caption_instagram": "Instagram用キャプション。300〜500文字。冒頭1行で結論orフックを言い切る→本文は改行を使い論理的に→絵文字は控えめ→${isNews ? '末尾に「出典: {source_name}」とsource_urlを明記→' : ''}最後にこのハッシュタグを付ける: ${config.hashtagsInstagram}",
  "caption_x": "X用ポスト。ハッシュタグ${isNews ? 'と出典URL' : ''}込みで全体240文字以内。1行目で結論/フックを言い切る。${isNews ? '本文末に「出典: {source_name}」と source_url を入れる。' : ''}末尾に ${config.hashtagsX} を付ける"
}`;

const res = await fetch('https://api.anthropic.com/v1/messages', {
  method: 'POST',
  headers: {
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
    'content-type': 'application/json',
  },
  body: JSON.stringify({
    model: config.model || 'claude-sonnet-5',
    max_tokens: 4000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
    messages: [{ role: 'user', content: prompt }],
  }),
});

if (!res.ok) {
  console.error('Anthropic API error:', res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
const text = (data.content || [])
  .filter((b) => b.type === 'text')
  .map((b) => b.text)
  .join('\n');

const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  console.error('レスポンスからJSONを抽出できませんでした:\n', text);
  process.exit(1);
}

let research;
try {
  research = JSON.parse(jsonMatch[0]);
} catch (e) {
  console.error('JSONパース失敗:', e.message, '\n', jsonMatch[0]);
  process.exit(1);
}

// web_search由来の <cite index=...> などのタグ混入を除去
const stripTags = (s) =>
  String(s)
    .replace(/<cite\b[^>]*>/gi, '')
    .replace(/<\/cite>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();

for (const key of ['headline', 'sub', 'image_prompt', 'caption_instagram', 'caption_x', 'source_name', 'source_url']) {
  if (typeof research[key] === 'string') research[key] = stripTags(research[key]);
}
if (Array.isArray(research.points)) research.points = research.points.map(stripTags);

for (const key of ['headline', 'sub', 'points', 'image_prompt', 'caption_instagram', 'caption_x']) {
  if (!research[key]) {
    console.error(`researchデータに ${key} がありません`);
    process.exit(1);
  }
}

research.theme = topic;
research.post_type = postType;
research.source_name = research.source_name || '';
research.source_url = research.source_url || '';
research.date = jstDate;

fs.mkdirSync(path.join(root, 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'out', 'research.json'), JSON.stringify(research, null, 2));
console.log(`リサーチ完了 [${postType}]:`, research.headline);
