#!/usr/bin/env node
/**
 * Sign an extension manifest with Ed25519
 *
 * Usage:
 *   node scripts/sign-extension.cjs <extension-path> [publisher-id]
 *
 * Arguments:
 *   extension-path: Path to extension directory or .vsext file
 *   publisher-id: Publisher ID (default: vswrite-official)
 *
 * Examples:
 *   node scripts/sign-extension.cjs examples/hello-extension
 *   node scripts/sign-extension.cjs marketplace/extensions/hello-extension.vsext vswrite-official
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { unzipSync, zipSync } = require('fflate');

const extensionPath = process.argv[2];
const publisherId = process.argv[3] || 'vswrite-official';

if (!extensionPath) {
  console.error('Usage: node scripts/sign-extension.cjs <extension-path> [publisher-id]');
  process.exit(1);
}

const keysDir = path.join(__dirname, '..', 'keys');
const privateKeyPath = path.join(keysDir, `${publisherId}.key`);

// Check if private key exists
if (!fs.existsSync(privateKeyPath)) {
  console.error(`Error: Private key not found at ${privateKeyPath}`);
  console.error('Generate it first with: node scripts/generate-keypair.cjs ' + publisherId);
  process.exit(1);
}

// Load private key
const privateKeyDer = fs.readFileSync(privateKeyPath);
const privateKey = crypto.createPrivateKey({
  key: privateKeyDer,
  format: 'der',
  type: 'pkcs8'
});

/**
 * Create canonical JSON for signing
 * This matches the Rust get_signable_content() function
 */
function getSignableContent(manifest) {
  // Create a copy and remove signature fields
  const copy = { ...manifest };
  delete copy.signature;
  delete copy.signatureAlgorithm;
  delete copy.publicKeyId;
  delete copy.publicKey;

  // Sort keys recursively for deterministic output
  return JSON.stringify(sortObjectKeys(copy));
}

/**
 * Recursively sort object keys for deterministic JSON
 */
function sortObjectKeys(obj) {
  if (Array.isArray(obj)) {
    return obj.map(sortObjectKeys);
  }
  if (obj !== null && typeof obj === 'object') {
    const sorted = {};
    Object.keys(obj).sort().forEach(key => {
      sorted[key] = sortObjectKeys(obj[key]);
    });
    return sorted;
  }
  return obj;
}

/**
 * Sign manifest content
 */
function signManifest(manifest) {
  const signableContent = getSignableContent(manifest);

  // Hash the content with SHA-256
  const hash = crypto.createHash('sha256').update(signableContent).digest();

  // Sign the hash with Ed25519
  const signature = crypto.sign(null, hash, privateKey);

  return signature.toString('base64');
}

/**
 * Sign an extension directory
 */
function signDirectory(dirPath) {
  const manifestPath = path.join(dirPath, 'manifest.json');

  if (!fs.existsSync(manifestPath)) {
    console.error(`Error: manifest.json not found in ${dirPath}`);
    process.exit(1);
  }

  // Read manifest
  const manifestContent = fs.readFileSync(manifestPath, 'utf8');
  const manifest = JSON.parse(manifestContent);

  console.log(`Signing extension: ${manifest.id || manifest.name}`);
  console.log(`  Publisher: ${publisherId}`);

  // Sign it
  const signature = signManifest(manifest);

  // Add signature fields
  manifest.signature = signature;
  manifest.signatureAlgorithm = 'ed25519';
  manifest.publicKeyId = publisherId;

  // Write updated manifest (pretty-printed)
  const updatedContent = JSON.stringify(manifest, null, 2);
  fs.writeFileSync(manifestPath, updatedContent);

  console.log(`  Signature: ${signature.substring(0, 20)}...`);
  console.log(`  Manifest updated: ${manifestPath}`);

  return manifest;
}

/**
 * Sign a .vsext package (ZIP file)
 */
function signVsext(vsextPath) {
  console.log(`Opening package: ${vsextPath}`);

  // Read and unzip
  const zipData = fs.readFileSync(vsextPath);
  const files = unzipSync(zipData);

  if (!files['manifest.json']) {
    console.error('Error: manifest.json not found in .vsext package');
    process.exit(1);
  }

  // Read manifest from zip
  const manifestContent = Buffer.from(files['manifest.json']).toString('utf8');
  const manifest = JSON.parse(manifestContent);

  console.log(`Signing extension: ${manifest.id || manifest.name}`);
  console.log(`  Publisher: ${publisherId}`);

  // Sign it
  const signature = signManifest(manifest);

  // Add signature fields
  manifest.signature = signature;
  manifest.signatureAlgorithm = 'ed25519';
  manifest.publicKeyId = publisherId;

  // Update manifest in files
  const updatedContent = JSON.stringify(manifest, null, 2);
  files['manifest.json'] = Buffer.from(updatedContent);

  // Re-zip and write
  const newZipData = zipSync(files, { level: 9 });
  fs.writeFileSync(vsextPath, Buffer.from(newZipData));

  console.log(`  Signature: ${signature.substring(0, 20)}...`);
  console.log(`  Package updated: ${vsextPath}`);

  return manifest;
}

// Main
const resolvedPath = path.resolve(extensionPath);

if (!fs.existsSync(resolvedPath)) {
  console.error(`Error: Path not found: ${resolvedPath}`);
  process.exit(1);
}

const stats = fs.statSync(resolvedPath);

if (stats.isDirectory()) {
  signDirectory(resolvedPath);
} else if (resolvedPath.endsWith('.vsext')) {
  signVsext(resolvedPath);
} else {
  console.error('Error: Path must be a directory or .vsext file');
  process.exit(1);
}

console.log('\nDone! Extension signed successfully.');
