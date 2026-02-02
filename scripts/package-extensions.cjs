const fs = require('fs');
const path = require('path');
const { zipSync } = require('fflate');

const root = path.resolve(__dirname, '..');
const marketplaceDir = path.join(root, 'marketplace', 'extensions');

const EXTENSIONS = [
  { id: 'hello-extension', src: 'examples/hello-extension' },
  { id: 'entity-glossary', src: 'examples/entity-glossary' },
  { id: 'tag-manager', src: 'examples/tag-manager' },
  { id: 'section-outline', src: 'examples/section-outline' },
  { id: 'entity-stats', src: 'examples/entity-stats' },
];

const SKIP_DIRS = new Set(['.git', 'node_modules']);

function collectFiles(dir, baseDir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      files.push(...collectFiles(path.join(dir, entry.name), baseDir));
      continue;
    }
    const fullPath = path.join(dir, entry.name);
    const relPath = path.relative(baseDir, fullPath).replace(/\\/g, '/');
    files.push({ fullPath, relPath });
  }
  return files;
}

function zipDir(srcDir, outFile) {
  const files = {};
  for (const file of collectFiles(srcDir, srcDir)) {
    files[file.relPath] = fs.readFileSync(file.fullPath);
  }
  const data = zipSync(files, { level: 9 });
  fs.writeFileSync(outFile, Buffer.from(data));
}

fs.mkdirSync(marketplaceDir, { recursive: true });

for (const ext of EXTENSIONS) {
  const srcDir = path.join(root, ext.src);
  const outFile = path.join(marketplaceDir, `${ext.id}.vsext`);
  zipDir(srcDir, outFile);
  const size = fs.statSync(outFile).size;
  console.log(`${ext.id}: ${size} bytes`);
}
