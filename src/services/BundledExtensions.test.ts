import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync, existsSync } from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const MARKETPLACE_DIR = path.join(ROOT, 'marketplace', 'extensions');
const MARKETPLACE_INDEX = path.join(MARKETPLACE_DIR, 'marketplace.json');

describe('Bundled extensions', () => {
  it('ships bundled Lua extensions that match marketplace.json versions', () => {
    const marketplace = JSON.parse(readFileSync(MARKETPLACE_INDEX, 'utf-8'));
    const bundled = marketplace.extensions.filter((ext: { bundled?: boolean }) => ext.bundled);

    expect(bundled.length).toBeGreaterThan(0);

    for (const ext of bundled) {
      const extensionDir = path.join(MARKETPLACE_DIR, ext.path);
      expect(existsSync(extensionDir)).toBe(true);

      const manifestPath = path.join(extensionDir, 'manifest.json');
      expect(existsSync(manifestPath)).toBe(true);

      const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'));
      expect(manifest.id).toBe(ext.id);
      expect(manifest.version).toBe(ext.version);
    }
  });
});
