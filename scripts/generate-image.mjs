// 単発の投稿画像を生成: out/research.json を読み out/post.png を書き出す。
// 実体は scripts/lib/render-image.mjs（generate-candidates.mjs と共通）。
import './env.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderImage } from './lib/render-image.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'config.json'), 'utf8'));
const research = JSON.parse(fs.readFileSync(path.join(root, 'out', 'research.json'), 'utf8'));

await renderImage(research, path.join(root, 'out', 'post.png'), config);
console.log('画像生成完了: out/post.png');
