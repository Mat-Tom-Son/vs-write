import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';
import { unzipSync } from 'fflate';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MARKETPLACE_DIR = path.join(ROOT, 'marketplace', 'extensions');
const MARKETPLACE_INDEX = path.join(MARKETPLACE_DIR, 'marketplace.json');

describe('Bundled extensions', () => {
  it('ships bundled packages that match marketplace.json versions', () => {
    const marketplace = JSON.parse(readFileSync(MARKETPLACE_INDEX, 'utf-8'));
    const bundled = marketplace.extensions.filter((ext: { bundled?: boolean }) => ext.bundled);

    expect(bundled.length).toBeGreaterThan(0);

    for (const ext of bundled) {
      const packagePath = path.join(MARKETPLACE_DIR, ext.filename);
      expect(existsSync(packagePath)).toBe(true);

      const archive = readFileSync(packagePath);
      const entries = unzipSync(new Uint8Array(archive));
      const manifestBytes = entries['manifest.json'];
      expect(manifestBytes).toBeDefined();

      const manifest = JSON.parse(new TextDecoder('utf-8').decode(manifestBytes));
      expect(manifest.id).toBe(ext.id);
      expect(manifest.version).toBe(ext.version);
    }
  });
});
