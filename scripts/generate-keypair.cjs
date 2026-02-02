#!/usr/bin/env node
/**
 * Generate Ed25519 keypair for extension signing
 *
 * Usage:
 *   node scripts/generate-keypair.cjs [publisher-id]
 *
 * Output:
 *   - keys/<publisher-id>.key (private key - KEEP SECRET)
 *   - keys/<publisher-id>.pub (public key - share this)
 *   - Prints the base64 public key for Rust TRUSTED_PUBLISHERS
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const publisherId = process.argv[2] || 'vswrite-official';
const keysDir = path.join(__dirname, '..', 'keys');

// Create keys directory if it doesn't exist
if (!fs.existsSync(keysDir)) {
  fs.mkdirSync(keysDir, { recursive: true });
  console.log(`Created keys directory: ${keysDir}`);
}

const privateKeyPath = path.join(keysDir, `${publisherId}.key`);
const publicKeyPath = path.join(keysDir, `${publisherId}.pub`);

// Check if keys already exist
if (fs.existsSync(privateKeyPath)) {
  console.error(`Error: Private key already exists at ${privateKeyPath}`);
  console.error('Delete it first if you want to regenerate.');
  process.exit(1);
}

// Generate Ed25519 keypair
console.log(`Generating Ed25519 keypair for publisher: ${publisherId}`);
const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519', {
  publicKeyEncoding: {
    type: 'spki',
    format: 'der'
  },
  privateKeyEncoding: {
    type: 'pkcs8',
    format: 'der'
  }
});

// Save private key (DER format)
fs.writeFileSync(privateKeyPath, privateKey);
console.log(`Private key saved: ${privateKeyPath}`);

// Save public key (DER format)
fs.writeFileSync(publicKeyPath, publicKey);
console.log(`Public key saved: ${publicKeyPath}`);

// Extract raw 32-byte public key from SPKI format
// SPKI for Ed25519 is: 30 2a 30 05 06 03 2b 65 70 03 21 00 <32 bytes of public key>
// The raw key starts at offset 12
const rawPublicKey = publicKey.slice(12);
const publicKeyBase64 = rawPublicKey.toString('base64');

console.log('\n' + '='.repeat(60));
console.log('IMPORTANT: Keep your private key secure!');
console.log('='.repeat(60));
console.log(`\nPublic Key (Base64, for Rust TRUSTED_PUBLISHERS):`);
console.log(`  "${publicKeyBase64}"`);
console.log(`\nAdd this to src-tauri/src/extensions.rs:`);
console.log(`  ("${publisherId}", "${publicKeyBase64}"),`);
console.log('\n' + '='.repeat(60));

// Create .gitignore in keys directory to prevent accidental commits
const gitignorePath = path.join(keysDir, '.gitignore');
if (!fs.existsSync(gitignorePath)) {
  fs.writeFileSync(gitignorePath, '# Never commit private keys!\n*.key\n');
  console.log('\nCreated .gitignore to protect private keys');
}

console.log('\nDone! Now you can sign extensions with:');
console.log(`  node scripts/sign-extension.cjs <extension-path> ${publisherId}`);
