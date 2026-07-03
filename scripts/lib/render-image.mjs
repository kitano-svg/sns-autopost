// 投稿画像レンダラ（AI背景 + テンプレのテキスト差し込み）。
// generate-image.mjs / generate-candidates.mjs から共通で使う。
// renderImage(research, outPath, config) を呼ぶと outPath(.png / .jpg) に 1080x1350 の画像を書き出す。
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';

const W = 1080;
const H = 1350; // Instagram 4:5 縦型（Xでもそのまま使える）
const FONT = `'Noto Sans CJK JP','Noto Sans JP','Yu Gothic','Meiryo',sans-serif`;

function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// 全角基準のざっくり文字幅で行分割（日本語向け）
function wrap(text, maxChars) {
  const lines = [];
  let line = '';
  let width = 0;
  for (const ch of String(text)) {
    const w = /[\x00-\xff]/.test(ch) ? 0.55 : 1;
    if (width + w > maxChars) {
      lines.push(line);
      line = ch;
      width = w;
    } else {
      line += ch;
      width += w;
    }
  }
  if (line) lines.push(line);
  return lines;
}

async function generateAiBackground(promptText) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY 未設定');
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-image:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        contents: [{
          parts: [{
            text: `${promptText}. Vertical portrait composition, abstract high-quality background for a social media graphic. Absolutely no text, no letters, no logos, no people. Dark enough at the bottom half for white text overlay.`,
          }],
        }],
      }),
    }
  );
  if (!res.ok) throw new Error(`Gemini API ${res.status}: ${await res.text()}`);
  const data = await res.json();
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error('Geminiレスポンスに画像がありません');
  return Buffer.from(part.inlineData.data, 'base64');
}

function gradientBackground(config) {
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#1b1f3a"/>
        <stop offset="55%" stop-color="#3b2a6d"/>
        <stop offset="100%" stop-color="#0d1024"/>
      </linearGradient>
      <radialGradient id="glow" cx="0.8" cy="0.15" r="0.7">
        <stop offset="0%" stop-color="${config.accentColor2}" stop-opacity="0.35"/>
        <stop offset="100%" stop-color="${config.accentColor2}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="${W}" height="${H}" fill="url(#g)"/>
    <rect width="${W}" height="${H}" fill="url(#glow)"/>
  </svg>`;
  return sharp(Buffer.from(svg)).png().toBuffer();
}

// research: { headline, sub, points[], image_prompt, date }
export async function renderImage(research, outPath, config) {
  let bg;
  try {
    bg = await generateAiBackground(research.image_prompt);
    console.log('AI背景生成: 成功 (Gemini)');
  } catch (e) {
    console.warn('AI背景生成に失敗、グラデーション背景にフォールバック:', e.message);
    bg = await gradientBackground(config);
  }

  const base = await sharp(bg).resize(W, H, { fit: 'cover' }).toBuffer();

  // --- テキストオーバーレイ（エディトリアル調・下から積んで署名との余白を確保） ---
  const HEAD = 98, HEAD_LH = 106, SUB = 40, SUB_LH = 54, MX = 88;
  const headLines = wrap(research.headline, 9);
  const subLines = wrap(research.sub, 22).slice(0, 2);
  const headCount = headLines.length;
  const subCount = subLines.length;

  const lastSubBaseline = 1132; // サブ最終行のベースライン（署名の上に十分な余白）
  const subBaselines = subLines.map((_, i) => lastSubBaseline - (subCount - 1 - i) * SUB_LH);
  const headBottomBaseline = subCount ? subBaselines[0] - 78 : 1150;
  const headBaselines = headLines.map((_, j) => headBottomBaseline - (headCount - 1 - j) * HEAD_LH);
  const ruleY = headBaselines[0] - HEAD - 6;

  const headlineSvg = headBaselines
    .map((by, idx) => `<text x="${MX}" y="${by}" font-family="${FONT}" font-size="${HEAD}" font-weight="900" fill="#ffffff" letter-spacing="-1.5">${esc(headLines[idx])}</text>`)
    .join('\n');
  const subSvg = subBaselines
    .map((by, idx) => `<text x="${MX}" y="${by}" font-family="${FONT}" font-size="${SUB}" font-weight="600" fill="#e7e9f6">${esc(subLines[idx])}</text>`)
    .join('\n');

  const overlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="scrim" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#05060d" stop-opacity="0.55"/>
      <stop offset="40%" stop-color="#05060d" stop-opacity="0.12"/>
      <stop offset="70%" stop-color="#05060d" stop-opacity="0.72"/>
      <stop offset="100%" stop-color="#05060d" stop-opacity="0.96"/>
    </linearGradient>
  </defs>

  <rect width="${W}" height="${H}" fill="url(#scrim)"/>

  <!-- キッカー（小さなブランド表示） -->
  <circle cx="${MX + 7}" cy="102" r="7" fill="${config.accentColor2}"/>
  <text x="${MX + 26}" y="112" font-family="${FONT}" font-size="28" font-weight="700" fill="#eef0ff" opacity="0.92">${esc(config.brand)}</text>

  <!-- アクセントルール -->
  <rect x="${MX}" y="${ruleY}" width="72" height="6" rx="3" fill="${config.accentColor2}"/>

  ${headlineSvg}
  ${subSvg}

  <!-- 署名（控えめ・帯なし） -->
  <text x="${MX}" y="${H - 66}" font-family="${FONT}" font-size="28" font-weight="700" fill="#c7cbe6">${esc(config.handle)}</text>
  <text x="${W - MX}" y="${H - 66}" text-anchor="end" font-family="${FONT}" font-size="26" font-weight="600" fill="#9aa0c4">${esc(research.date || '')}</text>
</svg>`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const isJpg = /\.jpe?g$/i.test(outPath);
  let img = sharp(base).composite([{ input: Buffer.from(overlay) }]);
  img = isJpg ? img.jpeg({ quality: 85 }) : img.png();
  await img.toFile(outPath);
  return outPath;
}
