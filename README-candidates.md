# X投稿：承認制フロー＋最適化ループ（2026-07 路線変更）

副業者向けに「①ロジック投稿 ②Claude最新ニュース（公式引用）③マネタイズ/二次利用/コストの解説」を、
**Xは要約＋noteリンク／noteに全文** で発信する。完全自動をやめ、**メール確認→承認**の半自動。
さらに **リサーチ→最適化→投稿** をループさせて、内容を少しずつ改善していく。

## 全体フロー（ループ）

```
毎日12:00 JST  ── GitHub Actions (daily-candidates.yml)
                 └ optimize.mjs         : 直近の投稿/候補を自己レビュー → learnings.json 更新（最適化）
                 └ generate-candidates  : 6候補を生成（X要約＋note全文＋画像）※learningsを反映（リサーチ）
                    → candidates/<date>.json と candidates/<date>/cN.jpg をコミット/push
                 └ email-candidates     : Resendで候補一覧をメール（承認ページのリンク付き）

あなた         ── メールを見る → 出す候補を選ぶ
                 → noteに全文を公開（承認ページの「note全文をコピー」を使う）
                 → 承認ページで note URL を貼り、投稿時間(8:00/12:30/19:00)を選ぶ → 「承認して予約」（投稿）

15分ごと       ── queue-post.yml : queue.json を見て予約時刻の投稿を画像つきでXへ

翌日12:00     ── optimize がまた直近を見て learnings 更新 …（ループ）
```

- 昼12時のメールは既定で**翌日分の候補**（`postDayOffset: 1`）。当日夜だけにしたいなら `0` に。
- 承認ページ: `<dashboardUrl>/approve.html?date=<生成日>`（メールのボタンから開く。投稿日は自動で翌日）
- noteは公式APIが無いため**手動公開**。承認時にURLを貼る（空ならX単体で予約も可）。

## 「設計」の変え方（config.json）

- `voice` … **口調・ペルソナ**（人称/です・ます/絵文字量/NGワード/決め台詞）。ここを書き換えると全投稿の語り口が変わる。
- `themes` … テーマのプール（`{ "type": "news"|"logic", "topic": "..." }`）。最近使ったものは自動で避ける（LRU）。
- `postTimes` / `postDayOffset` / `candidatesPerDay` … 投稿時間・対象日オフセット・1日の候補数。
- 生成時間そのものは `.github/workflows/daily-post.yml` の cron（`0 3 * * *`=12:00 JST）。

## 最適化（learnings.json）

ループの学習ストア。`optimize.mjs` が更新するが、**人が手で方向づけもできる**。
- `directives` … 全体方針（例: コスト系を厚めに）
- `manualNotes` … あなたの手動メモ（「◯◯が伸びた」等）。ここに書くと次の生成に効く
- `autoNotes` / `focusThemes` / `avoidPatterns` … optimizeが自己レビューで自動更新
- `recentThemes` … テーマの最終使用日（重複回避に使用）

※現在は **データ無しモード**（X APIを使わない自己レビュー＋手動メモ）。
X読み取りAPI（従量課金）を有効化すれば、投稿済みツイートのKPIでテーマ別に勝ち判定する**データ駆動の閉ループ**に昇格できる（queue項目に theme/postType を保存済み＝土台は完成）。

## 必要な GitHub Secrets（sns-autopost）

| Secret | 用途 | 状態 |
|---|---|---|
| `ANTHROPIC_API_KEY` | 候補・note全文・最適化 | 既存 |
| `GEMINI_API_KEY` | 画像のAI背景 | 既存 |
| `X_API_KEY/SECRET`, `X_ACCESS_TOKEN/SECRET` | X投稿（queue-post） | 既存 |
| `RESEND_API_KEY` | 候補メール送信 | **★要追加** |
| `RESEND_FROM` / `REVIEWER_EMAIL` / `DASHBOARD_URL` | 送信元/宛先/リンク（省略時 config値） | 任意 |

ダッシュボード(Vercel)側は既存の `GH_TOKEN`（sns-autopost contents:write）で承認→予約が動く。

## ローカル確認

```
npm run test:local     # APIなしで optimize→generate→email を通す（ダミー）
npm run optimize -- --dry
npm run candidates -- --dry
npm run email:candidates -- --dry   # out/email-preview.html を確認
```

## 本番テスト（キー登録後）

GitHub → Actions → daily-candidates → Run workflow（`dry_run=true`でメール送信なし）で生成のみ確認。
問題なければ翌日の定時、または `dry_run=false` で候補メールが届く。
