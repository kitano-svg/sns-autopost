// 毎日のnote記事下書きを生成: Claude API (web search付き) で本日のテーマの
// note記事下書き(タイトル＋本文Markdown)を作り drafts/YYYY-MM-DD.md と .json に保存する。
// 公開はしない（noteに公式APIが無いため）。人間が確認して手動で公開する半自動フロー。
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
const ymd = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); // JSTのYYYY-MM-DD
const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
const theme = config.themes[dayOfYear % config.themes.length];

const prompt = `あなたは「${config.brand}」というブランド名で発信する、日本のAI Web制作の専門家です。
今日は ${jstDate} です。本日のテーマ:「${theme}」

Web検索で最新の情報・事例・データを踏まえ、noteに公開する「読み応えのある記事の下書き」を1本書いてください。

# 読者
中小企業の経営者・個人事業主、これからWeb制作やAI活用を始めたい非エンジニアの人。

# ブランドの核となる思想
「AIで作る → 人間が整える」。速く安く作れるAIの力と、最後に人が"整える"価値の両輪。

# 執筆ルール
- 専門用語を避け、非エンジニアにやさしく。具体例・手順・数字を入れて実用的に。
- 一般論やAIっぽい薄い内容にしない。今日読む価値のある具体を選ぶ。
- 導入で「読者の悩み・損」を提示して惹きつける。
- 記事の最後は必ず、無料の「AI Web制作 ロードマップ」への誘導CTAで締める（プロフィールのリンクから受け取れる、という体で自然に）。

以下のJSON形式のみで出力してください（JSON以外のテキストは一切書かない）:

{
  "title": "noteのタイトル。32文字以内。具体的でクリックしたくなる。数字や結果を入れる",
  "excerpt": "記事の要約。80文字以内",
  "tags": ["タグ1", "タグ2", "タグ3", "タグ4", "タグ5"],
  "body_markdown": "本文をMarkdownで。1200〜2000字程度。## で見出しを2〜4個。導入(問題提起)→具体的な中身→手順やコツ(箇条書き活用)→最後にロードマップCTA、の構成。適度に改行して読みやすく"
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
    max_tokens: 8000,
    tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 6 }],
    messages: [{ role: 'user', content: prompt }],
  }),
});

if (!res.ok) {
  console.error('Anthropic API error:', res.status, await res.text());
  process.exit(1);
}

const data = await res.json();
const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');

const jsonMatch = text.match(/\{[\s\S]*\}/);
if (!jsonMatch) {
  console.error('レスポンスからJSONを抽出できませんでした:\n', text);
  process.exit(1);
}

let draft;
try {
  draft = JSON.parse(jsonMatch[0]);
} catch (e) {
  console.error('JSONパース失敗:', e.message, '\n', jsonMatch[0]);
  process.exit(1);
}

for (const key of ['title', 'excerpt', 'tags', 'body_markdown']) {
  if (!draft[key]) { console.error(`draftデータに ${key} がありません`); process.exit(1); }
}

// Web検索の引用タグ <cite ...>〜</cite> が本文に混ざることがあるので除去（中身のテキストは残す）
const stripCite = (s) => (typeof s === 'string' ? s.replace(/<\/?cite[^>]*>/g, '') : s);
draft.title = stripCite(draft.title);
draft.excerpt = stripCite(draft.excerpt);
draft.body_markdown = stripCite(draft.body_markdown);

const tags = Array.isArray(draft.tags) ? draft.tags : [];
const tagLine = tags.map((t) => '#' + String(t).replace(/^#/, '')).join(' ');

// 人が確認して note に貼り付けやすい Markdown
const md = `# ${draft.title}

> ${draft.excerpt}

${draft.body_markdown}

---

**ハッシュタグ:** ${tagLine}

<!-- テーマ: ${theme} ／ ${jstDate} ／ これはAIが生成した下書きです。内容を確認・微調整してから note に手動で公開してください。 -->
`;

const dir = path.join(root, 'drafts');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${ymd}.md`), md);
fs.writeFileSync(path.join(dir, `${ymd}.json`), JSON.stringify({
  date: ymd,
  dateLabel: jstDate,
  theme,
  title: draft.title,
  excerpt: draft.excerpt,
  tags,
}, null, 2));

console.log('note下書き生成完了:', draft.title);
