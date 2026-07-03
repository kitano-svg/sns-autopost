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

  const headlineLines = wrap(research.headline, 11);
  const subLines = wrap(research.sub, 24);
  const HEADLINE_SIZE = 84;
  const SUB_SIZE = 38;
  const POINT_SIZE = 36;

  let y = 640;
  const headlineSvg = headlineLines
    .map((l) => {
      const s = `<text x="80" y="${y}" font-family="${FONT}" font-size="${HEADLINE_SIZE}" font-weight="900" fill="#ffffff">${esc(l)}</text>`;
      y += HEADLINE_SIZE + 16;
      return s;
    })
    .join('\n');

  y += 8;
  const subSvg = subLines
    .map((l) => {
      const s = `<text x="84" y="${y}" font-family="${FONT}" font-size="${SUB_SIZE}" font-weight="700" fill="#d9dcff">${esc(l)}</text>`;
      y += SUB_SIZE + 12;
      return s;
    })
    .join('\n');

  y += 42;
  const pointsSvg = (research.points || [])
    .slice(0, 3)
    .map((p) => {
      const lines = wrap(p, 25);
      const bullet = `<circle cx="100" cy="${y - 12}" r="9" fill="${config.accentColor2}"/>`;
      const texts = lines
        .map((l) => {
          const s = `<text x="132" y="${y}" font-family="${FONT}" font-size="${POINT_SIZE}" font-weight="700" fill="#ffffff">${esc(l)}</text>`;
          y += POINT_SIZE + 12;
          return s;
        })
        .join('\n');
      y += 14;
      return bullet + '\n' + texts;
    })
    .join('\n');

  const overlay = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#0b0d1a" stop-opacity="0"/>
      <stop offset="30%" stop-color="#0b0d1a" stop-opacity="0.78"/>
      <stop offset="100%" stop-color="#0b0d1a" stop-opacity="0.92"/>
    </linearGradient>
  </defs>

  <rect x="0" y="420" width="${W}" height="${H - 420}" fill="url(#panel)"/>

  <rect x="64" y="64" rx="26" ry="26" width="560" height="60" fill="#0b0d1a" fill-opacity="0.72"/>
  <rect x="64" y="64" rx="26" ry="26" width="560" height="60" fill="none" stroke="${config.accentColor2}" stroke-width="2"/>
  <text x="94" y="106" font-family="${FONT}" font-size="30" font-weight="800" fill="#ffffff">${esc(config.brand)}</text>

  <rect x="80" y="${640 - HEADLINE_SIZE - 4}" width="120" height="10" fill="${config.accentColor2}"/>

  ${headlineSvg}
  ${subSvg}
  ${pointsSvg}

  <rect x="0" y="${H - 96}" width="${W}" height="96" fill="${config.accentColor}"/>
  <text x="80" y="${H - 36}" font-family="${FONT}" font-size="32" font-weight="800" fill="#ffffff">${esc(config.handle)}</text>
  <text x="${W - 80}" y="${H - 36}" text-anchor="end" font-family="${FONT}" font-size="30" font-weight="700" fill="#ffffff">${esc(research.date || '')}</text>
</svg>`;

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const isJpg = /\.jpe?g$/i.test(outPath);
  let img = sharp(base).composite([{ input: Buffer.from(overlay) }]);
  img = isJpg ? img.jpeg({ quality: 85 }) : img.png();
  await img.toFile(outPath);
  return outPath;
}
