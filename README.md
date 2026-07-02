# SNS自動投稿システム（Instagram / X）

毎日指定時刻に **GitHub Actionsのクラウド上で** 自動実行されるため、**PCの電源が入っていなくても投稿されます**。

```
毎日 18:00 JST（変更可）
  ↓ ① リサーチ … Claude API + Web検索で本日のネタを収集・投稿文生成
  ↓ ② 画像生成 … Gemini(Nano Banana)でAI背景 + ブランドテンプレで文字入れ (1080x1350)
  ↓ ③ 投稿    … X (API v2) / Instagram (Graph API)
```

Gemini APIが失敗した日はグラデーション背景に自動フォールバックし、投稿は止まりません。

---

## セットアップ手順

### 1. GitHubリポジトリを作成してpush

**リポジトリはPublicにしてください**（Instagram投稿に画像の公開URLが必要なため。`posts/` の画像とキャプションJSONが公開されます。避けたい場合は後述のR2案に切り替え可能）。

```
cd C:\HP制作\sns-autopost
git init
git add -A
git commit -m "initial"
gh repo create sns-autopost --public --source=. --push
```

### 2. APIキーを取得

| キー | 取得先 | 備考 |
|---|---|---|
| `ANTHROPIC_API_KEY` | https://console.anthropic.com | リサーチ用。1回あたり数円〜十数円程度 |
| `GEMINI_API_KEY` | https://aistudio.google.com/apikey | AI背景画像用（無料枠あり） |
| `X_API_KEY` ほか4つ | https://developer.x.com | 下記参照 |
| `IG_USER_ID` / `IG_ACCESS_TOKEN` | Meta for Developers | 下記参照 |

#### X（無料プランでOK・月500投稿まで）
1. https://developer.x.com で開発者アカウント登録（投稿したいXアカウントでログイン）
2. アプリを作成 → **User authentication settings** で App permissions を **Read and write** に設定
3. Keys and tokens タブで以下の4つを取得:
   - API Key → `X_API_KEY`
   - API Key Secret → `X_API_SECRET`
   - Access Token → `X_ACCESS_TOKEN`（権限変更後に**再生成**すること）
   - Access Token Secret → `X_ACCESS_SECRET`

#### Instagram（プロアカウント必須）
1. Instagramを**プロアカウント**（ビジネス/クリエイター）に切り替え、**Facebookページと連携**
2. https://developers.facebook.com でアプリ作成（タイプ: ビジネス）
3. グラフAPIエクスプローラーで権限 `instagram_basic`, `instagram_content_publish`, `pages_show_list` を付けてユーザートークンを生成
4. トークンを**長期トークン（60日）**に交換:
   `GET /oauth/access_token?grant_type=fb_exchange_token&client_id={app-id}&client_secret={app-secret}&fb_exchange_token={短期トークン}`
5. `GET /me/accounts` でページID → `GET /{page-id}?fields=instagram_business_account` で **IGユーザーID** を取得 → `IG_USER_ID`
6. 長期トークン → `IG_ACCESS_TOKEN`

> ⚠️ **IGトークンは約60日で失効します。** 失効すると投稿が失敗しActionsがメール通知してくれるので、その際は再発行してSecretsを更新してください。

### 3. GitHub Secretsに登録

リポジトリの **Settings → Secrets and variables → Actions → New repository secret** で以下を登録:

```
ANTHROPIC_API_KEY
GEMINI_API_KEY
X_API_KEY
X_API_SECRET
X_ACCESS_TOKEN
X_ACCESS_SECRET
IG_USER_ID
IG_ACCESS_TOKEN
```

### 4. テスト実行

リポジトリの **Actions → daily-sns-post → Run workflow** で `dry_run = true` にして実行
→ 投稿はせず、リサーチ＋画像生成まで走り、Artifacts（post-output）から画像を確認できます。

問題なければ `dry_run = false`（デフォルト）で手動実行して本番投稿をテスト。

---

## カスタマイズ

### 投稿時刻の変更
[.github/workflows/daily-post.yml](.github/workflows/daily-post.yml) の cron を編集（**UTC指定** = JST − 9時間）:

| 投稿したい時刻 (JST) | cron |
|---|---|
| 07:30 | `30 22 * * *` |
| 12:00 | `0 3 * * *` |
| 18:00（現在の設定） | `0 9 * * *` |
| 20:00 | `0 11 * * *` |

> GitHub Actionsのscheduleは混雑時に数分〜十数分遅れることがあります。

### ブランド・テーマの変更
[config.json](config.json) を編集:
- `brand` / `handle` … 画像に入るブランド名とアカウント名（**要変更**）
- `accentColor` / `accentColor2` … ブランドカラー
- `themes` … 曜日ローテーションするリサーチテーマ（自由に追加・削除OK）
- `hashtagsInstagram` / `hashtagsX` … ハッシュタグ

---

## リポジトリをPrivateにしたい場合（オプション）

Instagram投稿には画像の公開URLが必要です。Privateにする場合は、画像をCloudflare R2（公開バケット）にアップロードする方式へ変更してください（`generate-image.mjs` の後にR2アップロードのステップを追加し、`IMAGE_URL` をR2のURLに差し替え）。Claude Codeに「sns-autopostのIG画像ホスティングをR2に切り替えて」と頼めば対応できます。

## トラブルシューティング

- **投稿が失敗した** … Actionsの実行ログを確認。失敗時はGitHubからメール通知が届きます
- **IG: `Invalid OAuth access token`** … 長期トークンの期限切れ → 再発行してSecrets更新
- **X: `403 Forbidden`** … App permissionsがRead and writeか、Access Tokenを権限変更後に再生成したか確認
- **画像の文字がズレる/はみ出す** … `config.json` のブランド名が長すぎる場合は短縮するか、`generate-image.mjs` のフォントサイズを調整
