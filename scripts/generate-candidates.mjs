// 毎朝の候補生成: 1日 N 件（既定6件）の投稿候補を作る。
// 各候補 = X要約(承認時にnote URLを付ける前提) + note全文(Markdown) + 画像(JPEG)。
// 出力: candidates/<YYYY-MM-DD>.json と candidates/<YYYY-MM-DD>/cN.jpg（画像は raw URL でメール/ダッシュボードのプレビューに使う）。
// 承認・投稿はしない（ダッシュボードで承認 → queue.json → queue-post.mjs が投稿）。
//
// 使い方:
//   node scripts/generate-candidates.mjs           本番（要 ANTHROPIC_API_KEY / 画像は GEMINI_API_KEY）
//   node scripts/generate-candidates.mjs --dry      API を叩かずダミー候補で動作確認（画像はグラデにフォールバック）
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderImage } from './lib/render-image.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

const DRY = process.argv.includes('--dry') || process.env.DRY === '1';
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey && !DRY) {
  console.error('ANTHROPIC_API_KEY が設定されていません（--dry でダミー生成できます）');
  process.exit(1);
}

const REPO = process.env.QUEUE_REPO || 'kitano-svg/sns-autopost';
const N = Number(config.candidatesPerDay || 6);
const RETAIN_DAYS = Number(process.env.CANDIDATES_RETAIN_DAYS || 14);

const now = new Date();
const jstDate = now.toLocaleDateString('ja-JP', {
  timeZone: 'Asia/Tokyo', year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
});
const ymd = new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); // JSTのYYYY-MM-DD（生成日）
const dayOfYear = Math.floor((now - new Date(now.getFullYear(), 0, 0)) / 86400000);
// 投稿対象日 = 生成日 + postDayOffset（昼に生成→翌日分、が既定）。承認ページの投稿日の初期値に使う。
const offset = Number(config.postDayOffset ?? 1);
const targetDate = new Date(now.getTime() + 9 * 3600000 + offset * 86400000).toISOString().slice(0, 10);

// 学習ストア（無ければ空）
let learnings = {};
try { learnings = JSON.parse(fs.readFileSync(path.join(root, 'learnings.json'), 'utf8')); } catch { /* 初回は無し */ }

// 今日の N テーマを選ぶ：最近使ったテーマは避ける（LRU）。未使用/古い順を優先し、日替わりで回す。
const themes = config.themes;
const recentThemes = learnings.recentThemes || {};
const rotate = dayOfYear % themes.length;
const lastUsedIdx = (topic) => {
  const d = recentThemes[topic];
  if (!d) return -Infinity;
  const t = new Date(d + 'T00:00:00Z').getTime();
  return Number.isNaN(t) ? -Infinity : Math.floor(t / 86400000);
};
const ranked = themes
  .map((t, i) => ({ t, used: lastUsedIdx(typeof t === 'string' ? t : t.topic), tie: (i + rotate) % themes.length }))
  .sort((a, b) => a.used - b.used || a.tie - b.tie);
const todays = ranked.slice(0, Math.min(N, themes.length)).map((r) => r.t);

const stripTags = (s) =>
  String(s ?? '')
    .replace(/<cite\b[^>]*>/gi, '')
    .replace(/<\/cite>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();

function voiceBlock() {
  const v = config.voice;
  if (!v) return '';
  const lines = [];
  if (v.persona) lines.push(`- 立ち位置: ${v.persona}`);
  if (v.firstPerson) lines.push(`- 一人称: 「${v.firstPerson}」`);
  if (v.tone) lines.push(`- トーン: ${v.tone}`);
  if (v.sentenceStyle) lines.push(`- 文のリズム: ${v.sentenceStyle}`);
  if (v.emoji) lines.push(`- 絵文字: ${v.emoji}`);
  if (v.hookBias) lines.push(`- フックの傾向: ${v.hookBias}`);
  if (Array.isArray(v.avoid) && v.avoid.length) lines.push(`- 使わない: ${v.avoid.join(' / ')}`);
  if (Array.isArray(v.signaturePhrases) && v.signaturePhrases.length) lines.push(`- 世界観の言い回し（そのまま使わなくてよいが雰囲気の参考に）: ${v.signaturePhrases.join(' / ')}`);
  return `\n# 口調・ペルソナ（X要約・note全文の両方に一貫して反映）\n${lines.join('\n')}\n`;
}

function learningsBlock() {
  const L = learnings || {};
  const parts = [];
  if (L.directives) parts.push(`- 運用方針: ${L.directives}`);
  if (Array.isArray(L.manualNotes) && L.manualNotes.length) parts.push(`- 手動メモ（人の指示）: ${L.manualNotes.join(' / ')}`);
  if (Array.isArray(L.autoNotes) && L.autoNotes.length) parts.push(`- 直近の気づき: ${L.autoNotes.join(' / ')}`);
  if (Array.isArray(L.focusThemes) && L.focusThemes.length) parts.push(`- 今は厚くしたい切り口: ${L.focusThemes.join(' / ')}`);
  if (Array.isArray(L.avoidPatterns) && L.avoidPatterns.length) parts.push(`- 避けたい型・言い回し: ${L.avoidPatterns.join(' / ')}`);
  if (!parts.length) return '';
  return `\n# これまでの学び・方針（できるだけ反映。同じ話の焼き直しは避け、切り口・数字・具体例を変える）\n${parts.join('\n')}\n`;
}

function buildPrompt(topic, postType) {
  const isNews = postType === 'news';
  const audience = config.audience || 'AIやClaudeを使って副業・個人で稼ぎたい人';
  const typeBlock = isNews
    ? `# これは「ニュース投稿」
${config.postTypes?.news || 'Claude/Anthropicの最新情報を公式の一次情報を引用して要点解説する。'}
- Web検索で「Claude / Anthropic」の【最新かつ事実】の情報を集める。優先ソース＝ anthropic.com / docs.anthropic.com / 公式ブログ / 公式リリースノート / 公式X(@AnthropicAI) などの一次情報（公式）。
- 憶測・リーク・未確認・古い情報は使わない。日付・数値・機能名は正確に。断定できないことは書かない。
- 出典（公式）を1つ特定し source_name（例: Anthropic公式ブログ）と source_url（公式URL）に入れる。note本文の末尾に「出典: {source_name}」とURLを明記する。`
    : `# これは「ロジック投稿」
${config.postTypes?.logic || '主張→理由→具体→結論の論理構造で、副業者向けの判断基準・思考フレーム・手順を示す。'}
- 精神論・煽り・一般論は禁止。「主張 → なぜそう言えるか(理由) → 具体例や数字 → だから何をすべきか(結論)」の論理構造で書く。
- コスト・金額・比較など"数字"を具体的に扱うテーマなら、現実的なレンジで根拠を示す（Web検索で相場を裏取り。使った出典は source_name/source_url に入れる。なければ空文字 ""）。`;

  return `あなたは「${config.brand}」として発信する、日本の副業・AI活用の専門家です。今日は ${jstDate}。
本日の題材:「${topic}」

# 読者（ターゲット）
${audience}
ツールは触れるが「作れても稼ぎ方が分からない」「商材がない」「作ったものを二次利用できていない」層。彼らが自分ごととして刺さる粒度で書く。

${typeBlock}
${voiceBlock()}${learningsBlock()}
# 成果物
この題材で、(A) X用の要約ポスト と (B) noteに載せる全文記事、を1セット作る。両者は同じ主張で、AはBの"要点だけ"にする（Bの方が具体的で深い）。
- CTAや宣伝の押し売りはしない。noteへの自然な誘導（「詳しくはnoteに」等）はA末尾に入れてよい（※URLは入れない。後で人が付ける）。
- Aの本文にnote URLは書かない（承認時に別途付与するため）。

以下のJSON形式のみで出力（JSON以外は一切書かない）:

{
  "post_type": "${postType}",
  "headline": "画像用の見出し。最大22文字。数字や具体語で言い切る",
  "sub": "見出しの補足。最大40文字",
  "points": ["要点1(最大28文字)", "要点2(最大28文字)", "要点3(最大28文字)"],
  "image_prompt": "English prompt for an abstract AI-generated background image matching the topic's mood. No text, no letters, no people.",
  "x_summary": "X用ポスト本文。日本語なので短く。ハッシュタグ込みで全体110文字以内（note URLは承認時に付けるので含めない）。1行目で結論/フックを言い切る。末尾に ${config.hashtagsX} を付ける",
  "note_title": "noteのタイトル。32文字以内。具体的でクリックしたくなる。数字や結果を入れる",
  "note_excerpt": "noteの要約。80文字以内",
  "note_tags": ["タグ1", "タグ2", "タグ3", "タグ4", "タグ5"],
  "note_body_markdown": "noteの全文をMarkdownで。1200〜2000字。## 見出しを2〜4個。導入(問題提起)→具体(数字・手順・具体例)→結論、の順。読みやすく改行する${isNews ? '。末尾に「## 出典」節を設け source_name とURLを明記' : ''}",
  "source_name": "${isNews ? '出典（公式）の名称' : '（数字の出典があれば名称、なければ空文字）'}",
  "source_url": "${isNews ? '出典（公式）のURL' : '（数字の出典があればURL、なければ空文字）'}"
}`;
}

async function researchOne(topic, postType) {
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
      tools: [{ type: 'web_search_20250305', name: 'web_search', max_uses: 5 }],
      messages: [{ role: 'user', content: buildPrompt(topic, postType) }],
    }),
  });
  if (!res.ok) throw new Error(`Anthropic API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('JSONを抽出できませんでした:\n' + text.slice(0, 500));
  return JSON.parse(m[0]);
}

function dummyOne(topic, postType, i) {
  return {
    post_type: postType,
    headline: `${postType === 'news' ? 'Claude最新' : '副業のリアル'}${i + 1}`,
    sub: `ダミー: ${topic}`.slice(0, 40),
    points: ['要点その1（ダミー）', '要点その2（ダミー）', '要点その3（ダミー）'],
    image_prompt: 'futuristic abstract tech background, flowing purple and teal gradients, digital particles',
    x_summary: `【ダミー候補${i + 1}】${topic} の要点をここに。詳しくはnoteに。 ${config.hashtagsX}`,
    note_title: `【ダミー】${topic}`.slice(0, 32),
    note_excerpt: `これはローカル検証用のダミー要約です（${topic}）`.slice(0, 80),
    note_tags: ['AI副業', '副業', 'Claude', 'AI活用', 'マネタイズ'],
    note_body_markdown: `## はじめに\n\nこれは \`--dry\` で生成したダミー本文です。題材: ${topic}\n\n## 中身\n\n- ダミー1\n- ダミー2\n\n## 結論\n\nダミーの結論。`,
    source_name: '',
    source_url: '',
  };
}

// 古い候補フォルダ/JSONを削除してリポジトリ肥大を防ぐ
function pruneOld() {
  const dir = path.join(root, 'candidates');
  if (!fs.existsSync(dir)) return;
  const cutoff = Date.now() - RETAIN_DAYS * 86400000;
  for (const name of fs.readdirSync(dir)) {
    const mDir = name.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    const mJson = name.match(/^(\d{4})-(\d{2})-(\d{2})\.json$/);
    const m = mDir || mJson;
    if (!m) continue;
    const t = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`).getTime();
    if (t < cutoff) {
      fs.rmSync(path.join(dir, name), { recursive: true, force: true });
      console.log('古い候補を削除:', name);
    }
  }
}

const candidates = [];
for (let i = 0; i < todays.length; i++) {
  const theme = todays[i];
  const topic = typeof theme === 'string' ? theme : theme.topic;
  const postType = typeof theme === 'string' ? 'logic' : (theme.type || 'logic');
  const id = `c${i + 1}`;
  console.log(`[${i + 1}/${todays.length}] (${postType}) ${topic}`);

  let r;
  try {
    r = DRY ? dummyOne(topic, postType, i) : await researchOne(topic, postType);
  } catch (e) {
    console.error('候補生成に失敗、スキップ:', e.message);
    continue;
  }

  // サニタイズ
  for (const k of ['headline', 'sub', 'image_prompt', 'x_summary', 'note_title', 'note_excerpt', 'note_body_markdown', 'source_name', 'source_url']) {
    if (typeof r[k] === 'string') r[k] = stripTags(r[k]);
  }
  r.points = Array.isArray(r.points) ? r.points.map(stripTags) : [];
  r.note_tags = Array.isArray(r.note_tags) ? r.note_tags : [];

  if (!r.headline || !r.x_summary || !r.note_body_markdown) {
    console.error('必須フィールド不足、スキップ:', id);
    continue;
  }

  // 画像を描画
  const imgRel = `candidates/${ymd}/${id}.jpg`;
  const imgAbs = path.join(root, imgRel);
  try {
    await renderImage({ ...r, date: jstDate }, imgAbs, config);
  } catch (e) {
    console.error('画像生成に失敗:', e.message);
  }

  candidates.push({
    id,
    post_type: postType,
    theme: topic,
    headline: r.headline,
    sub: r.sub || '',
    points: r.points,
    x_summary: r.x_summary,
    note_title: r.note_title || '',
    note_excerpt: r.note_excerpt || '',
    note_tags: r.note_tags,
    note_body_markdown: r.note_body_markdown,
    source_name: r.source_name || '',
    source_url: r.source_url || '',
    image: imgRel,
    imageUrl: `https://raw.githubusercontent.com/${REPO}/main/${imgRel}`,
  });
}

if (!candidates.length) {
  console.error('候補が1件も生成できませんでした');
  process.exit(1);
}

pruneOld();

const out = {
  date: ymd,
  dateLabel: jstDate,
  targetDate,
  generatedAt: new Date().toISOString(),
  postTimes: config.postTimes || ['08:00', '12:30', '19:00'],
  count: candidates.length,
  candidates,
};

const dir = path.join(root, 'candidates');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, `${ymd}.json`), JSON.stringify(out, null, 2));
// メール送信ステップが参照できるよう out/ にも最新を置く
fs.mkdirSync(path.join(root, 'out'), { recursive: true });
fs.writeFileSync(path.join(root, 'out', 'candidates.json'), JSON.stringify(out, null, 2));

console.log(`\n候補生成完了: ${candidates.length}件 → candidates/${ymd}.json`);
