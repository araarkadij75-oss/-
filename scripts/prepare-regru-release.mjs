import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'hosted-snapshot');
const releaseId = new Date().toISOString().replace(/[:.]/g, '-');
const outputRoot = path.join(root, 'artifacts', 'regru-releases');
const output = path.join(outputRoot, releaseId);
const files = [
  'index.html',
  'dispatcher-logistic.html',
  'master.html',
  'sw.js',
  'avito-profit.js',
  'profit-accounting.js',
  'profit-bridge.js',
  'profit-ui.js',
  'visual-refinement.css',
  'crm-api/finance.php',
  'telegram-ui.js',
  'crm-api/telegram.php',
  'cloud-config.js',
  'firestore-regru.js',
  'premium-v181721.css',
  'quota-safe-v181719.js',
  'icon.svg',
  'manifest.json',
  'manifest-dispatcher-logistic.json',
  'manifest-master.json',
];

for (const name of files) {
  const src = path.join(source, name);
  if (!fs.existsSync(src) || !fs.statSync(src).isFile()) {
    throw new Error(`Нет обязательного файла hosted-snapshot/${name}`);
  }
}
if (fs.existsSync(output)) throw new Error(`Каталог релиза уже существует: ${output}`);

fs.mkdirSync(output, { recursive: true });
const manifest = {
  releaseId,
  source: 'hosted-snapshot',
  createdAt: new Date().toISOString(),
  productionTarget: '/var/www/u3680049/data/www/crm.remontpkspb.ru/candidate',
  productionReplaceAllowlist: ['avito-profit.js', 'profit-accounting.js', 'profit-bridge.js', 'profit-ui.js', 'visual-refinement.css', 'crm-api/finance.php', 'crm-api/telegram.php', 'telegram-ui.js', 'index.html', 'dispatcher-logistic.html', 'master.html', 'sw.js'],
  protectedPaths: ['cloud-config.js', 'firestore-regru.js', 'premium-v181721.css', 'quota-safe-v181719.js', 'icon.svg', 'manifest.json', 'manifest-dispatcher-logistic.json', 'manifest-master.json'],
  files: {},
};
for (const name of files) {
  const bytes = fs.readFileSync(path.join(source, name));
  const destination = path.join(output, name);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, bytes, { flag: 'wx' });
  manifest.files[name] = {
    size: bytes.length,
    sha256: crypto.createHash('sha256').update(bytes).digest('hex'),
  };
}
fs.writeFileSync(path.join(output, 'RELEASE-MANIFEST.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ releaseId, output, files: Object.keys(manifest.files), manifest: path.join(output, 'RELEASE-MANIFEST.json') }, null, 2));
