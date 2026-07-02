// Instagram の IG_USER_ID と長期アクセストークンを自動で取得するヘルパー。
//
// 【使い方】Meta for Developers でアプリを作ったあと、以下3つを用意して実行するだけ:
//   1. アプリID           (アプリ設定 > 基本 に表示)
//   2. app secret         (同上「app secret」)
//   3. 短期ユーザートークン (グラフAPIエクスプローラーで
//                          instagram_basic / instagram_content_publish / pages_show_list
//                          の権限を付けて "Generate Access Token" したもの)
//
//   node scripts/setup-instagram.mjs <アプリID> <app secret> <短期トークン>
//   （または .env の FB_APP_ID / FB_APP_SECRET / FB_SHORT_TOKEN を使って引数なしで実行）
//
// 実行すると、GitHub Secrets にそのまま貼れる IG_USER_ID と IG_ACCESS_TOKEN を出力します。
import './env.mjs';

const GRAPH = 'https://graph.facebook.com/v21.0';

const appId = process.argv[2] || process.env.FB_APP_ID;
const appSecret = process.argv[3] || process.env.FB_APP_SECRET;
const shortToken = process.argv[4] || process.env.FB_SHORT_TOKEN;

if (!appId || !appSecret || !shortToken) {
  console.error(`使い方:
  node scripts/setup-instagram.mjs <アプリID> <app secret> <短期トークン>

または .env に FB_APP_ID / FB_APP_SECRET / FB_SHORT_TOKEN を書いて引数なしで実行してください。`);
  process.exit(1);
}

async function get(url, params) {
  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`);
  const data = await res.json();
  if (!res.ok || data.error) {
    throw new Error(JSON.stringify(data.error || data, null, 2));
  }
  return data;
}

try {
  // 1) 短期トークン → 長期トークン（約60日）に交換
  console.log('▶ 長期トークンに交換中...');
  const longRes = await get(`${GRAPH}/oauth/access_token`, {
    grant_type: 'fb_exchange_token',
    client_id: appId,
    client_secret: appSecret,
    fb_exchange_token: shortToken,
  });
  const longToken = longRes.access_token;
  console.log('  ✓ 長期トークン取得OK');

  // 2) 連携しているFacebookページとそのIGビジネスアカウントを取得
  console.log('▶ Facebookページ / Instagramアカウントを検索中...');
  const pages = await get(`${GRAPH}/me/accounts`, {
    fields: 'name,instagram_business_account',
    access_token: longToken,
  });

  const withIg = (pages.data || []).filter((p) => p.instagram_business_account);
  if (withIg.length === 0) {
    console.error(`  ✗ Instagramビジネスアカウントに紐づくFacebookページが見つかりませんでした。
  次を確認してください:
   - Instagramが「プロアカウント」になっているか
   - そのInstagramがFacebookページと連携されているか
   - トークン生成時に pages_show_list / instagram_basic の権限を付けたか`);
    process.exit(1);
  }

  console.log(`  ✓ ${withIg.length}件見つかりました\n`);

  // 3) 結果を分かりやすく出力
  const chosen = withIg[0];
  console.log('==================================================');
  console.log('  GitHub Secrets に登録する値（下の2つ）');
  console.log('==================================================');
  console.log(`\nIG_USER_ID`);
  console.log(chosen.instagram_business_account.id);
  console.log(`\nIG_ACCESS_TOKEN`);
  console.log(longToken);
  console.log('\n==================================================');
  console.log(`使用ページ: 「${chosen.name}」`);
  if (withIg.length > 1) {
    console.log('\n（複数のページが見つかりました。別のページを使う場合は下記から選んでください）');
    withIg.forEach((p, i) => {
      console.log(`  [${i}] ${p.name} → IG_USER_ID=${p.instagram_business_account.id}`);
    });
  }
  console.log('\n※ 長期トークンは約60日で失効します。失効したらこのスクリプトを再実行して更新してください。');
} catch (e) {
  console.error('エラーが発生しました:\n', e.message);
  process.exit(1);
}
