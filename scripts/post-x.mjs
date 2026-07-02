// X (Twitter) へ画像付きポスト
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TwitterApi } from 'twitter-api-v2';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const research = JSON.parse(fs.readFileSync(path.join(root, 'out', 'research.json'), 'utf8'));

const { X_API_KEY, X_API_SECRET, X_ACCESS_TOKEN, X_ACCESS_SECRET } = process.env;
if (!X_API_KEY || !X_API_SECRET || !X_ACCESS_TOKEN || !X_ACCESS_SECRET) {
  console.error('Xの認証情報 (X_API_KEY / X_API_SECRET / X_ACCESS_TOKEN / X_ACCESS_SECRET) が不足しています');
  process.exit(1);
}

const client = new TwitterApi({
  appKey: X_API_KEY,
  appSecret: X_API_SECRET,
  accessToken: X_ACCESS_TOKEN,
  accessSecret: X_ACCESS_SECRET,
});

try {
  const mediaId = await client.v1.uploadMedia(path.join(root, 'out', 'post.png'));
  const tweet = await client.v2.tweet({
    text: research.caption_x,
    media: { media_ids: [mediaId] },
  });
  console.log('Xへ投稿完了: https://x.com/i/status/' + tweet.data.id);
} catch (e) {
  console.error('X投稿に失敗:', e.message || e);
  process.exit(1);
}
