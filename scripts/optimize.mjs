// 最適化（学習）ステップ：ループ「リサーチ→最適化→投稿→…」の心臓部。
// データ無しモード（X APIを使わない）:
//   1) 直近の candidates/*.json と queue.json を走査して recentThemes（テーマの最終使用日）を更新
//   2) 直近の投稿/候補テキストを Claude に自己レビューさせ、改善メモ(autoNotes)・厚くすべき切り口・避ける型を生成
//   3) learnings.json を更新（人が編集する directives / manualNotes は保持）
// X の読み取りAPIを有効化したら、ここに「投稿済みツイートのKPI取得→テーマ別に勝ち判定」を足してデータ駆動へ昇格できる。
//
//   node scripts/optimize.mjs          本番（要 ANTHROPIC_API_KEY。無ければ走査のみ）
//   node scripts/optimize.mjs --dry     Claudeを呼ばず走査だけ
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const DRY = process.argv.includes('--dry') || process.env.DRY === '1';
const apiKey = process.env.ANTHROPIC_API_KEY;

const learnPath = path.join(root, 'learnings.json');
const defaults = { updatedAt: '', avoidRepeatDays: 5, directives: '', manualNotes: [], autoNotes: [], focusThemes: [], avoidPatterns: [], recentThemes: {} };
let learnings = defaults;
try { learnings = { ...defaults, ...JSON.parse(fs.readFileSync(learnPath, 'utf8')) }; } catch { /* 初回は既定 */ }

// --- 直近の候補ファイルを走査（テーマの最終使用日＋最近のX要約を集める）---
const recentThemes = { ...learnings.recentThemes };
const recentPosts = []; // { date, theme, type, text }
const candDir = path.join(root, 'candidates');
if (fs.existsSync(candDir)) {
  const files = fs.readdirSync(candDir).filter((f) => /^\d{4}-\d{2}-\d{2}\.json$/.test(f)).sort().slice(-14);
  for (const f of files) {
    let data;
    try { data = JSON.parse(fs.readFileSync(path.join(candDir, f), 'utf8')); } catch { continue; }
    const date = data.date || f.replace('.json', '');
    for (const c of data.candidates || []) {
      if (c.theme) recentThemes[c.theme] = date > (recentThemes[c.theme] || '') ? date : recentThemes[c.theme] || date;
      recentPosts.push({ date, theme: c.theme || '', type: c.post_type || '', text: c.x_summary || '' });
    }
  }
}

// --- queue.json の投稿済みを走査（実際に世に出たもの・meta.theme で紐づけ）---
const postedByTheme = {};
try {
  const q = JSON.parse(fs.readFileSync(path.join(root, 'queue.json'), 'utf8'));
  for (const p of q.posts || []) {
    if (p.status !== 'posted') continue;
    const th = p.meta?.theme || '';
    if (th) postedByTheme[th] = (postedByTheme[th] || 0) + 1;
  }
} catch { /* queueが無い/空はOK */ }

// 最近のテキスト（重複除去・最新12件）
const seen = new Set();
const sample = [];
for (const p of recentPosts.slice().reverse()) {
  const key = (p.text || '').slice(0, 40);
  if (!key || seen.has(key)) continue;
  seen.add(key);
  sample.push(p);
  if (sample.length >= 12) break;
}

async function selfReview() {
  if (!apiKey || DRY || sample.length === 0) return null;
  const v = config.voice || {};
  const prompt = `あなたは「${config.brand}」のSNS編集者です。ターゲットは「${config.audience}」。
狙う口調: ${v.tone || ''} ${Array.isArray(v.avoid) ? '（使わない: ' + v.avoid.join('・') + '）' : ''}
現在の運用方針(directives): ${learnings.directives || '（未設定）'}
人からの手動メモ: ${(learnings.manualNotes || []).join(' / ') || '（なし）'}

以下は直近に生成/投稿したX要約のサンプルです（新しい順）:
${sample.map((s, i) => `${i + 1}. [${s.type}] ${s.text}`).join('\n')}

これらを俯瞰して、次の候補生成をより良くするための示唆を出してください。KPI数値は無い前提で、内容の重複・切り口の偏り・フックの強さ・具体性(数字/手順)・口調の一貫性の観点で評価すること。

以下のJSON形式のみで出力（JSON以外は書かない）:
{
  "autoNotes": ["次に活かす改善メモを3つ。具体的・実行可能に（例: 『コスト系は"内訳の内数字"まで出すと具体性が増す』）"],
  "focusThemes": ["次に厚くすべき切り口を2〜3個（短く）"],
  "avoidPatterns": ["最近やりがちで避けたい型・言い回しを2〜3個（短く）"]
}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: config.model || 'claude-sonnet-5', max_tokens: 1500, messages: [{ role: 'user', content: prompt }] }),
    });
    if (!res.ok) { console.warn('self-review APIエラー:', res.status); return null; }
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch (e) {
    console.warn('self-review 失敗:', e.message);
    return null;
  }
}

const review = await selfReview();
const out = {
  ...learnings,
  recentThemes,
  updatedAt: new Date().toISOString(),
};
if (review) {
  if (Array.isArray(review.autoNotes)) out.autoNotes = review.autoNotes.slice(0, 5);
  if (Array.isArray(review.focusThemes)) out.focusThemes = review.focusThemes.slice(0, 4);
  if (Array.isArray(review.avoidPatterns)) out.avoidPatterns = review.avoidPatterns.slice(0, 4);
}

fs.writeFileSync(learnPath, JSON.stringify(out, null, 2));
console.log(`最適化完了: recentThemes ${Object.keys(recentThemes).length}件 / autoNotes ${(out.autoNotes || []).length}件 / posted集計 ${Object.keys(postedByTheme).length}テーマ${review ? '' : '（自己レビューはスキップ）'}`);
