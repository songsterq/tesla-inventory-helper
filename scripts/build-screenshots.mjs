import { readdir } from 'node:fs/promises';
import { homedir } from 'node:os';
import { extname, basename, join } from 'node:path';
import sharp from 'sharp';

const SRC = join(homedir(), 'Desktop', 'tih');
const TARGET_W = 1280;
const TARGET_H = 800;

const files = (await readdir(SRC))
  .filter((f) => extname(f).toLowerCase() === '.png')
  .filter((f) => !f.includes('-cropped') && !f.includes('-letterboxed'))
  .sort();

if (files.length === 0) {
  console.error(`No source PNGs in ${SRC}`);
  process.exit(1);
}

let i = 0;
for (const file of files) {
  i++;
  const inPath = join(SRC, file);
  const meta = await sharp(inPath).metadata();
  console.log(`\n${file} (${meta.width}x${meta.height})`);

  // Cropped: cover-fit to 1280x800, attention-based crop (centers on detail).
  const croppedPath = join(SRC, `${i}-cropped.png`);
  await sharp(inPath)
    .resize(TARGET_W, TARGET_H, { fit: 'cover', position: sharp.strategy.attention })
    .png()
    .toFile(croppedPath);
  console.log(`  ✔ ${basename(croppedPath)}`);

  // Letterboxed: contain-fit, white bars to fill the rest.
  const letterPath = join(SRC, `${i}-letterboxed.png`);
  await sharp(inPath)
    .resize(TARGET_W, TARGET_H, {
      fit: 'contain',
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    })
    .png()
    .toFile(letterPath);
  console.log(`  ✔ ${basename(letterPath)}`);
}
