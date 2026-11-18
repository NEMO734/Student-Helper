import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.resolve(__dirname, '..', 'public');
const parentDir = path.resolve(__dirname, '..', '..');

fs.mkdirSync(publicDir, { recursive: true });

const assets = [
  { src: 'secret.mp3', dest: 'secret.mp3' },
  { src: 'app_icon.ico', dest: 'favicon.ico' },
];

for (const { src, dest } of assets) {
  const srcPath = path.join(parentDir, src);
  const destPath = path.join(publicDir, dest);
  if (fs.existsSync(srcPath) && !fs.existsSync(destPath)) {
    try {
      const buf = fs.readFileSync(srcPath);
      fs.writeFileSync(destPath, buf);
      console.log(`Copied ${src} -> public/${dest} (${buf.length} bytes)`);
    } catch (err) {
      console.warn(`Could not copy ${src}: ${err.message}`);
    }
  }
}
