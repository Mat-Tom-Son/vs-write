# Extension Signing

VS Write uses Ed25519 digital signatures to verify extension authenticity and integrity. This document explains how the signing system works and how to sign extensions.

## Overview

- **Algorithm**: Ed25519 (via `ed25519-dalek` in Rust, Node.js `crypto` for signing)
- **Hash**: SHA-256 of canonicalized manifest JSON
- **Verification**: Rust-side verification in `src-tauri/src/extensions.rs`
- **UI**: Signature badges in Extensions panel (shield icons)

## Signature Verification Status

| Status | Icon | Meaning |
|--------|------|---------|
| Trusted | Green shield | Signed by a trusted publisher (e.g., vswrite-official) |
| Untrusted | Yellow shield | Valid signature but publisher not in trusted list |
| Invalid | Red shield | Signature doesn't match content |
| Unsigned | Gray shield | No signature present |

## For Users

When you install an extension, VS Write automatically verifies its signature:

1. **Trusted extensions** (green badge): Signed by VS Write or a known publisher
2. **Untrusted extensions** (yellow badge): Signed but publisher unknown - verify the source manually
3. **Unsigned extensions** (gray badge): No signature - only install if you trust the source

## For Extension Developers

### Signing Your Extensions

#### 1. Generate a Keypair (one-time)

```bash
node scripts/generate-keypair.cjs my-publisher-name
```

This creates:
- `keys/my-publisher-name.key` - Private key (KEEP SECRET!)
- `keys/my-publisher-name.pub` - Public key

#### 2. Sign an Extension

Sign a directory:
```bash
node scripts/sign-extension.cjs path/to/extension my-publisher-name
```

Sign a .vsext package:
```bash
node scripts/sign-extension.cjs path/to/extension.vsext my-publisher-name
```

#### 3. Distribute

The signature is stored in `manifest.json`:
```json
{
  "id": "my-extension",
  "name": "My Extension",
  "version": "1.0.0",
  ...
  "signature": "base64-encoded-signature",
  "signatureAlgorithm": "ed25519",
  "publicKeyId": "my-publisher-name"
}
```

### Self-Signed Extensions

If your publisher ID isn't in the trusted list, you can include your public key in the manifest:

```json
{
  ...
  "signature": "...",
  "signatureAlgorithm": "ed25519",
  "publicKeyId": "my-publisher-name",
  "publicKey": "base64-encoded-public-key"
}
```

This allows verification but shows as "untrusted" (yellow badge).

### Becoming a Trusted Publisher

To have your publisher key added to the trusted list:

1. Open an issue on the VS Write repository
2. Provide your publisher ID and public key
3. Demonstrate your identity and track record

## For VS Write Maintainers

### Trusted Publishers

Trusted publisher keys are in `src-tauri/src/extensions.rs`:

```rust
static TRUSTED_PUBLISHERS: &[(&str, &str)] = &[
    ("vswrite-official", "Nqh5oHbH6TO6WrAV1r64m0Z8FWhQru7Ku75tDmMNqkA="),
    // Add more here
];
```

### Signing Bundled Extensions

After modifying bundled extensions:

```bash
# Sign all extension directories
node scripts/sign-extension.cjs examples/hello-extension
node scripts/sign-extension.cjs examples/entity-glossary
node scripts/sign-extension.cjs examples/tag-manager
node scripts/sign-extension.cjs examples/section-outline
node scripts/sign-extension.cjs examples/entity-stats

# Repackage .vsext files
node scripts/package-extensions.cjs
```

### Key Security

- **Private key location**: `keys/vswrite-official.key`
- **Never commit**: The `keys/` directory has a `.gitignore` blocking `*.key` files
- **Backup**: Store the private key securely outside the repository

## Technical Details

### Signing Process

1. Read `manifest.json`
2. Remove signature fields (`signature`, `signatureAlgorithm`, `publicKeyId`, `publicKey`)
3. Sort all keys alphabetically (recursive)
4. Serialize to JSON (no extra whitespace)
5. SHA-256 hash the JSON string
6. Sign hash with Ed25519 private key
7. Base64 encode the signature
8. Add signature fields back to manifest

### Verification Process (Rust)

1. Read `manifest.json`
2. Extract signature and publisher ID
3. Look up public key (trusted list or manifest's `publicKey`)
4. Remove signature fields, canonicalize JSON
5. SHA-256 hash
6. Verify Ed25519 signature against hash
7. Return verification status

### File Locations

| File | Purpose |
|------|---------|
| `scripts/generate-keypair.cjs` | Generate Ed25519 keypairs |
| `scripts/sign-extension.cjs` | Sign extension manifests |
| `scripts/package-extensions.cjs` | Package extensions as .vsext |
| `keys/*.key` | Private keys (gitignored) |
| `keys/*.pub` | Public keys |
| `src-tauri/src/extensions.rs` | Rust verification code |

## Troubleshooting

### "Unknown publisher - public key not found"

The publisher ID isn't in the trusted list and no `publicKey` is in the manifest. Either:
- Add the public key to the manifest (self-signed)
- Request to be added to the trusted publisher list

### "Signature verification failed"

The manifest was modified after signing, or the wrong key was used. Re-sign the extension:
```bash
node scripts/sign-extension.cjs path/to/extension publisher-id
```

### "Invalid public key length"

The public key must be exactly 32 bytes (base64 encoded). Ensure you're using the raw key, not the full SPKI-encoded key.
