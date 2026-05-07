import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const svgPath = resolve(root, 'public/icon.svg');
const outDir = resolve(root, 'public/icon');
const sizes = [16, 32, 48, 96, 128];

const svg = await readFile(svgPath);
await mkdir(outDir, { recursive: true });

for (const size of sizes) {
  const png = await sharp(svg, { density: Math.max(72, size * 4) })
    .resize(size, size)
    .png()
    .toBuffer();
  const out = resolve(outDir, `${size}.png`);
  await writeFile(out, png);
  console.log(`✔ ${size}.png (${png.length} B)`);
}
