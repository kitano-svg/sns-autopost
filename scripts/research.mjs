// 毎日のリサーチ: Claude API (web search付き) で本日の投稿ネタを収集し out/research.json に保存
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
// 日替わりでテーマをローテーション
const dayOfYear = Math.floor(
  (now - new Date(now.getFullYear(), 0, 0)) / 86400000
);
const theme = config.themes[dayOfYear % config.themes.length];

const prompt = `あなたは日本のSNS運用のプロです。今日は ${jstDate} です。
本日のテーマ:「${theme}」

Web検索を使って、このテーマに関する「今日投稿する価値のある」最新情報・ニュース・実践Tipsをリサーチしてください。
古い情報や一般論ではなく、フォロワーが「知らなかった！」「役に立つ！」と感じる具体的な内容を選ぶこと。

リサーチ結果をもとに、以下のJSON形式のみで出力してください（JSON以外のテキストは書かない）:

{
  "headline": "画像用の見出し。最大22文字。数字や具体語を入れてキャッチーに",
  "sub": "見出しの補足。最大40文字",
  "points": ["要点1(最大28文字)", "要点2(最大28文字)", "要点3(最大28文字)"],
  "image_prompt": "English prompt for an abstract AI-generated background image matching the topic mood. No text, no letters, no people. e.g. 'futuristic abstract tech background, flowing purple and teal gradients, digital particles'",
  "caption_instagram": "Instagram用キャプション。300〜500文字。冒頭1行で惹きつけ→本文は改行を使って読みやすく→絵文字を適度に→最後に必ずこのハッシュタグを付ける: ${config.hashtagsInstagram}",
  "caption_x": "X用ポスト。全体で120文字以内(ハッシュタグ込み)。最後に ${config.hashtagsX} を付ける"
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

for (const key of ['headline', 'sub', 'points', 'image_prompt', 'caption_instagram', 'caption_x']) {
  if (!research[key]) {
    console.error(`researchデータに ${key} がありません`);
    process.exit(1);
  }
}

research.theme = theme;
research.date = jstDate;

fs.mkdirSync(path.join(root, 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'out', 'research.json'), JSON.stringify(research, null, 2));
console.log('リサーチ完了:', research.headline);
