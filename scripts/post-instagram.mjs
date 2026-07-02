// Instagram へ画像付き投稿 (Graph API)
// 必要env: IG_USER_ID, IG_ACCESS_TOKEN, IMAGE_URL (公開URL)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const research = JSON.parse(fs.readFileSync(path.join(root, 'out', 'research.json'), 'utf8'));

const { IG_USER_ID, IG_ACCESS_TOKEN, IMAGE_URL } = process.env;
if (!IG_USER_ID || !IG_ACCESS_TOKEN || !IMAGE_URL) {
  console.error('IG_USER_ID / IG_ACCESS_TOKEN / IMAGE_URL のいずれかが不足しています');
  process.exit(1);
}

const GRAPH = 'https://graph.facebook.com/v21.0';

async function graphPost(url, params) {
  const res = await fetch(url, { method: 'POST', body: new URLSearchParams(params) });
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Graph API error: ${JSON.stringify(data.error || data)}`);
  }
  return data;
}

async function graphGet(url, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(`Graph API error: ${JSON.stringify(data.error || data)}`);
  }
  return data;
}

try {
  // 1. メディアコンテナ作成
  const container = await graphPost(`${GRAPH}/${IG_USER_ID}/media`, {
    image_url: IMAGE_URL,
    caption: research.caption_instagram,
    access_token: IG_ACCESS_TOKEN,
  });
  console.log('コンテナ作成:', container.id);

  // 2. 処理完了を待つ（最大60秒）
  let status = '';
  for (let i = 0; i < 12; i++) {
    const info = await graphGet(`${GRAPH}/${container.id}`, {
      fields: 'status_code',
      access_token: IG_ACCESS_TOKEN,
    });
    status = info.status_code;
    if (status === 'FINISHED') break;
    if (status === 'ERROR') throw new Error('メディア処理がERRORになりました');
    await new Promise((r) => setTimeout(r, 5000));
  }
  if (status !== 'FINISHED') throw new Error(`メディア処理がタイムアウト (status=${status})`);

  // 3. 公開
  const publish = await graphPost(`${GRAPH}/${IG_USER_ID}/media_publish`, {
    creation_id: container.id,
    access_token: IG_ACCESS_TOKEN,
  });
  console.log('Instagramへ投稿完了: media_id =', publish.id);
} catch (e) {
  console.error('Instagram投稿に失敗:', e.message || e);
  process.exit(1);
}
