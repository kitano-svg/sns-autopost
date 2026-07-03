// 当日の候補(out/candidates.json)をメールで送る（Resend API）。
// 本文 = 各候補の画像・種別・X要約・note題名 + ダッシュボードの承認ページへのリンク。
// RESEND_API_KEY 未設定（または --dry）のときは送信せず out/email-preview.html に書き出す。
//
// 必要な環境変数:
//   RESEND_API_KEY   Resend の APIキー（GitHub Secrets）
//   RESEND_FROM      送信元アドレス（既定 onboarding@resend.dev。独自ドメイン検証後は自分のアドレス）
//   REVIEWER_EMAIL   宛先（未設定なら config.reviewerEmail）
//   DASHBOARD_URL    ダッシュボードURL（未設定なら config.dashboardUrl）
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));

const DRY = process.argv.includes('--dry') || process.env.DRY === '1';
const dataPath = path.join(root, 'out', 'candidates.json');
if (!fs.existsSync(dataPath)) {
  console.error('out/candidates.json がありません。先に generate-candidates.mjs を実行してください');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

const reviewer = process.env.REVIEWER_EMAIL || config.reviewerEmail;
const from = process.env.RESEND_FROM || 'onboarding@resend.dev';
const dashboardUrl = (process.env.DASHBOARD_URL || config.dashboardUrl || '').replace(/\/$/, '');
const approveUrl = `${dashboardUrl}/approve.html?date=${data.date}`;

const esc = (s) =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const badge = (t) =>
  t === 'news'
    ? `<span style="background:#00CEC9;color:#04202a;font-size:12px;font-weight:800;padding:3px 10px;border-radius:999px;">Claudeニュース</span>`
    : `<span style="background:#6C5CE7;color:#fff;font-size:12px;font-weight:800;padding:3px 10px;border-radius:999px;">ロジック</span>`;

const cardsHtml = data.candidates
  .map((c, i) => `
  <tr><td style="padding:0 0 22px;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#12141f;border:1px solid #262a3d;border-radius:14px;overflow:hidden;">
      <tr>
        <td width="150" valign="top" style="padding:16px;">
          <img src="${esc(c.imageUrl)}" width="130" alt="" style="width:130px;border-radius:8px;display:block;">
        </td>
        <td valign="top" style="padding:16px 16px 16px 0;color:#e8eaf2;font-family:sans-serif;">
          <div style="margin-bottom:8px;">${badge(c.post_type)} <span style="color:#8b90a8;font-size:12px;">候補${i + 1}</span></div>
          <div style="font-size:15px;font-weight:800;line-height:1.5;margin-bottom:8px;color:#fff;">${esc(c.note_title || c.headline)}</div>
          <div style="font-size:13px;line-height:1.7;color:#c2c6d8;white-space:pre-wrap;">${esc(c.x_summary)}</div>
        </td>
      </tr>
    </table>
  </td></tr>`)
  .join('');

const html = `<!doctype html><html><body style="margin:0;background:#0b0d16;padding:24px 0;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;">
  <tr><td style="font-family:sans-serif;color:#fff;padding:0 8px 16px;">
    <div style="font-size:13px;color:#8b90a8;">${esc(data.dateLabel)}</div>
    <div style="font-size:22px;font-weight:900;margin-top:4px;">本日のX投稿候補（${data.count}件）</div>
    <div style="font-size:13px;color:#c2c6d8;margin-top:8px;line-height:1.7;">
      投稿対象日: <b>${esc(data.targetDate || data.date)}</b>（${data.targetDate && data.targetDate !== data.date ? '翌日分' : '当日分'}）<br>
      気に入った投稿を選び、noteに全文を公開 → 下のボタンから承認ページを開いて<br>
      <b>noteのURLを貼って「承認して予約」</b>すると、指定時間（${(data.postTimes || []).join(' / ')}）にXへ自動投稿されます。
    </div>
  </td></tr>
  <tr><td align="center" style="padding:8px 8px 24px;">
    <a href="${esc(approveUrl)}" style="display:inline-block;background:#6C5CE7;color:#fff;font-family:sans-serif;font-weight:800;font-size:15px;text-decoration:none;padding:14px 28px;border-radius:10px;">承認ページを開く →</a>
    <div style="font-family:sans-serif;color:#6b7089;font-size:11px;margin-top:8px;">${esc(approveUrl)}</div>
  </td></tr>
  ${cardsHtml}
  <tr><td style="font-family:sans-serif;color:#6b7089;font-size:11px;padding:8px;line-height:1.6;">
    このメールは sns-autopost（GitHub Actions）が自動生成しています。全文（note用Markdown）は承認ページで各候補ごとにコピーできます。
  </td></tr>
</table>
</td></tr></table>
</body></html>`;

const subject = `【本日のX投稿候補 ${data.count}件】${data.date}`;

if (!process.env.RESEND_API_KEY || DRY) {
  const outHtml = path.join(root, 'out', 'email-preview.html');
  fs.writeFileSync(outHtml, html);
  console.log(`RESEND_API_KEY 未設定 or --dry のため送信スキップ。プレビュー: ${outHtml}`);
  console.log(`宛先(予定): ${reviewer} / 承認URL: ${approveUrl}`);
  process.exit(0);
}

if (!reviewer) { console.error('宛先メール(REVIEWER_EMAIL / config.reviewerEmail)がありません'); process.exit(1); }

const res = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ from, to: [reviewer], subject, html }),
});

if (!res.ok) {
  console.error('メール送信に失敗:', res.status, await res.text());
  process.exit(1);
}
const j = await res.json();
console.log('候補メール送信完了:', j.id || JSON.stringify(j), '→', reviewer);
