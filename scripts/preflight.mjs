// 全ての鍵が正しく設定されているかを「投稿せずに」チェックする事前確認スクリプト。
// ローカルで `.env` を用意して `npm run check` で実行。
// 各サービスに軽いAPIを叩いて、認証が通るかだけを確認します（投稿はしません）。
import './env.mjs';
import { TwitterApi } from 'twitter-api-v2';

const results = [];
function ok(name, detail) { results.push({ name, status: 'OK', detail }); }
function ng(name, detail) { results.push({ name, status: 'NG', detail }); }

// --- Anthropic ---
async function checkAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) return ng('ANTHROPIC_API_KEY', '未設定');
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'claude-sonnet-5', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
    });
    if (res.ok) return ok('ANTHROPIC_API_KEY', 'リサーチAPI 認証OK');
    return ng('ANTHROPIC_API_KEY', `HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  } catch (e) { return ng('ANTHROPIC_API_KEY', e.message); }
}

// --- Gemini ---
async function checkGemini() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return ng('GEMINI_API_KEY', '未設定（未設定でもグラデ背景で投稿は動きます）');
  try {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${key}`);
    if (res.ok) return ok('GEMINI_API_KEY', 'AI背景API 認証OK');
    return ng('GEMINI_API_KEY', `HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
  } catch (e) { return ng('GEMINI_API_KEY', e.message); }
}

// --- X ---
async function checkX() {
  const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET } = process.env;
  if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) {
    return ng('X (4 keys)', '4つのうちどれかが未設定');
  }
  try {
    const client = new TwitterApi({
      appKey: X_API_KEY, appSecret: X_API_SECRET,
      accessToken: X_ACCESS_TOKEN, accessSecret: X_ACCESS_SECRET,
    });
    const me = await client.v2.me();
    return ok('X (4 keys)', `@${me.data.username} として認証OK`);
  } catch (e) {
    return ng('X (4 keys)', `${e.message}（App権限がRead and writeか / トークン再生成したか確認）`);
  }
}

// --- Instagram ---
async function checkInstagram() {
  const { IG_USER_ID, IG_ACCESS_TOKEN } = process.env;
  if (!IG_USER_ID || !IG_ACCESS_TOKEN) return ng('Instagram', 'IG_USER_ID か IG_ACCESS_TOKEN が未設定');
  try {
    const qs = new URLSearchParams({ fields: 'username', access_token: IG_ACCESS_TOKEN }).toString();
    const res = await fetch(`https://graph.facebook.com/v21.0/${IG_USER_ID}?${qs}`);
    const data = await res.json();
    if (res.ok && data.username) return ok('Instagram', `@${data.username} として認証OK`);
    return ng('Instagram', JSON.stringify(data.error || data).slice(0, 160));
  } catch (e) { return ng('Instagram', e.message); }
}

await Promise.all([checkAnthropic(), checkGemini(), checkX(), checkInstagram()]);

console.log('\n===== 事前チェック結果 =====');
for (const r of results) {
  const mark = r.status === 'OK' ? '✅' : '❌';
  console.log(`${mark} ${r.name.padEnd(18)} ${r.detail}`);
}
const failed = results.filter((r) => r.status === 'NG');
console.log('============================');
if (failed.length === 0) {
  console.log('全てOK。本番実行の準備ができています🎉');
} else {
  console.log(`${failed.length}件に問題があります。上の❌を修正してください。`);
  process.exitCode = 1;
}
