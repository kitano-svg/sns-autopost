// 予約キュー(queue.json)を処理して、投稿時刻が来たものをX投稿する。
// queue.json は GitHub Contents API で読み書き（ダッシュボードの書き込みと同じ仕組み・sha楽観ロックで競合回避）。
// GITHUB_TOKEN（Actions組み込み。permissions: contents: write）が必要。
import './env.mjs';
import { TwitterApi } from 'twitter-api-v2';

const REPO = process.env.QUEUE_REPO || 'kitano-svg/sns-autopost';
const FILE = 'queue.json';
const API = `https://api.github.com/repos/${REPO}/contents/${FILE}`;

const token = process.env.GITHUB_TOKEN;
if (!token) { console.error('GITHUB_TOKEN がありません'); process.exit(1); }

const ghHeaders = () => ({ Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'User-Agent': 'sns-autopost-queue' });

async function getQueue() {
  const res = await fetch(`${API}?ref=main`, { headers: ghHeaders() });
  if (res.status === 404) return { sha: null, data: { posts: [] } };
  if (!res.ok) throw new Error('queue取得失敗: ' + res.status);
  const j = await res.json();
  const content = Buffer.from(j.content, 'base64').toString('utf8');
  return { sha: j.sha, data: JSON.parse(content || '{"posts":[]}') };
}

async function putQueue(data, sha, message) {
  const body = { message, content: Buffer.from(JSON.stringify(data, null, 2)).toString('base64'), branch: 'main' };
  if (sha) body.sha = sha;
  return fetch(API, { method: 'PUT', headers: { ...ghHeaders(), 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET } = process.env;
const xConfigured = X_API_KEY && X_API_SECRET && X_ACCESS_TOKEN && X_ACCESS_SECRET;

function mimeFromUrl(url) {
  if (/\.png(\?|$)/i.test(url)) return 'image/png';
  if (/\.gif(\?|$)/i.test(url)) return 'image/gif';
  if (/\.webp(\?|$)/i.test(url)) return 'image/webp';
  return 'image/jpeg';
}

async function postToX(text, imageUrl) {
  const client = new TwitterApi({ appKey: X_API_KEY, appSecret: X_API_SECRET, accessToken: X_ACCESS_TOKEN, accessSecret: X_ACCESS_SECRET });
  let media;
  if (imageUrl) {
    try {
      const r = await fetch(imageUrl);
      if (!r.ok) throw new Error('画像取得 HTTP ' + r.status);
      const buf = Buffer.from(await r.arrayBuffer());
      const mediaId = await client.v1.uploadMedia(buf, { mimeType: mimeFromUrl(imageUrl) });
      media = { media_ids: [mediaId] };
    } catch (e) {
      console.warn('画像添付に失敗、テキストのみで投稿します:', String((e && e.message) || e));
    }
  }
  const tweet = await client.v2.tweet(media ? { text, media } : { text });
  return 'https://x.com/i/status/' + tweet.data.id;
}

async function run() {
  let { sha, data } = await getQueue();
  const now = Date.now();
  const posts = data.posts || [];
  const due = posts.filter((p) => p.status === 'scheduled' && p.scheduledAt && new Date(p.scheduledAt).getTime() <= now);
  if (!due.length) { console.log('処理対象なし（予約なし or 時刻前）'); return; }

  for (const p of due) {
    if (p.platform && p.platform !== 'x') continue; // 今はXのみ対応（Reddit等は今後）
    if (!xConfigured) { p.status = 'failed'; p.error = 'X認証情報が不足しています'; continue; }
    try {
      p.postedUrl = await postToX(p.text, p.imageUrl);
      p.status = 'posted';
      p.postedAt = new Date().toISOString();
      console.log('投稿完了:', p.postedUrl);
    } catch (e) {
      p.status = 'failed';
      p.error = String((e && e.message) || e);
      console.error('投稿失敗:', p.error);
    }
  }

  // sha楽観ロックで書き戻し。409（ダッシュボードが割り込み）なら最新を取り直して自分の結果だけ反映して再試行。
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await putQueue(data, sha, 'queue: process due posts');
    if (res.ok) { console.log('queue更新OK'); return; }
    if (res.status === 409) {
      const latest = await getQueue();
      const mine = new Map(due.map((p) => [p.id, p]));
      for (const lp of (latest.data.posts || [])) {
        const m = mine.get(lp.id);
        if (m && lp.status === 'scheduled') { lp.status = m.status; lp.postedUrl = m.postedUrl; lp.postedAt = m.postedAt; lp.error = m.error; }
      }
      data = latest.data; sha = latest.sha;
      continue;
    }
    throw new Error('queue書込失敗: ' + res.status + ' ' + await res.text());
  }
  throw new Error('queue書込に失敗しました（競合が続きました）');
}

run().catch((e) => { console.error(e); process.exit(1); });
