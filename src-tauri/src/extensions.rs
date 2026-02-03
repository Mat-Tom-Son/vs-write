use std::fs::{self, File};
use std::io::{self, Read};
use std::path::{Path, PathBuf};
use zip::ZipArchive;
use ed25519_dalek::{Signature, VerifyingKey, Verifier};
use base64::{Engine as _, engine::general_purpose::STANDARD as BASE64};
use sha2::{Sha256, Digest};
use tauri::{AppHandle, Manager};

use crate::agent::lua_extensions::ExtensionManifest;

/// Validate extension ID to prevent path traversal attacks
///
/// Extension IDs must:
/// - Only contain alphanumeric characters, hyphens, and underscores
/// - Not contain ".." (parent directory references)
/// - Not start with path separators (/, \)
/// - Be between 1 and 64 characters long
fn validate_extension_id(id: &str) -> Result<(), String> {
    // Check length
    if id.is_empty() {
        return Err("Extension ID cannot be empty".to_string());
    }
    if id.len() > 64 {
        return Err("Extension ID cannot be longer than 64 characters".to_string());
    }

    // Check for path traversal patterns
    if id.contains("..") {
        return Err("Extension ID cannot contain '..' (path traversal not allowed)".to_string());
    }

    // Check for path separators at start
    if id.starts_with('/') || id.starts_with('\\') {
        return Err("Extension ID cannot start with a path separator".to_string());
    }

    // Check that all characters are safe (alphanumeric, hyphen, underscore)
    let is_valid = id.chars().all(|c| {
        c.is_ascii_alphanumeric() || c == '-' || c == '_'
    });

    if !is_valid {
        return Err(
            "Extension ID can only contain letters, numbers, hyphens, and underscores".to_string()
        );
    }

    Ok(())
}

fn copy_dir_recursive(src: &Path, dst: &Path) -> io::Result<()> {
    fs::create_dir_all(dst)?;
    for entry in fs::read_dir(src)? {
        let entry = entry?;
        let file_type = entry.file_type()?;
        let src_path = entry.path();
        let dst_path = dst.join(entry.file_name());

        if file_type.is_dir() {
            copy_dir_recursive(&src_path, &dst_path)?;
        } else if file_type.is_file() {
            fs::copy(&src_path, &dst_path)?;
        } else if file_type.is_symlink() {
            // Avoid copying symlinks to prevent unexpected filesystem behavior.
            log::warn!("Skipping symlink in bundled extension: {}", src_path.display());
        }
    }
    Ok(())
}

fn bundled_extensions_roots(app: &AppHandle) -> Vec<PathBuf> {
    let mut roots = Vec::new();

    if let Ok(resource_dir) = app.path().resource_dir() {
        // When bundle resources include "../marketplace/extensions/*", the bundled files may live
        // next to the Resources directory (macOS: Contents/marketplace/extensions).
        roots.push(resource_dir.join("../marketplace/extensions"));
        roots.push(resource_dir.join("marketplace/extensions"));
    }

    // In dev builds, fall back to the repository path so `tauri dev` works without requiring
    // resources to be copied into the runtime resource directory.
    if cfg!(debug_assertions) {
        roots.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../marketplace/extensions"));
    }

    roots
}

#[derive(serde::Serialize)]
pub struct ExtractResult {
    pub extension_id: String,
    pub path: String,
}

#[derive(serde::Serialize)]
pub struct ExtensionInfo {
    pub id: String,
    pub version: String,
}

/// Result of signature verification
#[derive(serde::Serialize, Clone)]
pub struct SignatureVerification {
    /// Whether the extension is signed
    pub is_signed: bool,
    /// Whether the signature is valid (only meaningful if is_signed is true)
    pub is_valid: bool,
    /// The publisher/key ID that signed the extension
    pub publisher_id: Option<String>,
    /// Whether the publisher is trusted
    pub is_trusted: bool,
    /// Human-readable status message
    pub status: String,
    /// Error message if verification failed
    pub error: Option<String>,
}

/// Trusted publisher public keys
/// These are base64-encoded Ed25519 public keys (raw 32-byte keys)
static TRUSTED_PUBLISHERS: &[(&str, &str)] = &[
    // VS Write official key - used to sign bundled extensions
    ("vswrite-official", "Nqh5oHbH6TO6WrAV1r64m0Z8FWhQru7Ku75tDmMNqkA="),
    // Add more trusted publishers here
];

/// Get the canonical manifest content for signing
/// This removes signature-related fields and produces deterministic JSON
fn get_signable_content(manifest: &serde_json::Value) -> String {
    let mut manifest_copy = manifest.clone();

    // Remove signature fields before hashing
    if let Some(obj) = manifest_copy.as_object_mut() {
        obj.remove("signature");
        obj.remove("signatureAlgorithm");
        obj.remove("publicKeyId");
    }

    // Produce deterministic JSON (sorted keys, no extra whitespace)
    serde_json::to_string(&manifest_copy).unwrap_or_default()
}

/// Verify an extension's signature
fn verify_signature(
    manifest: &serde_json::Value,
    signature_b64: &str,
    public_key_id: &str,
) -> Result<SignatureVerification, String> {
    // Find the public key for this publisher
    let public_key_b64 = TRUSTED_PUBLISHERS
        .iter()
        .find(|(id, _)| *id == public_key_id)
        .map(|(_, key)| *key);

    let is_trusted = public_key_b64.is_some();

    // If publisher not in trusted list, try to get key from manifest
    // (for self-signed extensions)
    let public_key_b64 = public_key_b64.or_else(|| {
        manifest.get("publicKey")
            .and_then(|v| v.as_str())
    });

    let public_key_b64 = match public_key_b64 {
        Some(key) => key,
        None => {
            return Ok(SignatureVerification {
                is_signed: true,
                is_valid: false,
                publisher_id: Some(public_key_id.to_string()),
                is_trusted: false,
                status: "Unknown publisher - public key not found".to_string(),
                error: Some("Public key not found for publisher".to_string()),
            });
        }
    };

    // Decode the public key
    let public_key_bytes = BASE64.decode(public_key_b64)
        .map_err(|e| format!("Invalid public key encoding: {}", e))?;

    // Ed25519 public keys are 32 bytes
    let public_key_array: [u8; 32] = public_key_bytes
        .try_into()
        .map_err(|_| "Invalid public key length (expected 32 bytes)")?;

    let verifying_key = VerifyingKey::from_bytes(&public_key_array)
        .map_err(|e| format!("Invalid public key: {}", e))?;

    // Decode the signature
    let signature_bytes = BASE64.decode(signature_b64)
        .map_err(|e| format!("Invalid signature encoding: {}", e))?;

    let signature = Signature::from_slice(&signature_bytes)
        .map_err(|e| format!("Invalid signature: {}", e))?;

    // Get the content that was signed
    let signable_content = get_signable_content(manifest);

    // Hash the content (we sign the SHA-256 hash)
    let mut hasher = Sha256::new();
    hasher.update(signable_content.as_bytes());
    let hash = hasher.finalize();

    // Verify the signature
    match verifying_key.verify(&hash, &signature) {
        Ok(_) => Ok(SignatureVerification {
            is_signed: true,
            is_valid: true,
            publisher_id: Some(public_key_id.to_string()),
            is_trusted,
            status: if is_trusted {
                format!("Verified - signed by trusted publisher '{}'", public_key_id)
            } else {
                format!("Valid signature from untrusted publisher '{}'", public_key_id)
            },
            error: None,
        }),
        Err(e) => Ok(SignatureVerification {
            is_signed: true,
            is_valid: false,
            publisher_id: Some(public_key_id.to_string()),
            is_trusted,
            status: "Signature verification failed".to_string(),
            error: Some(format!("Signature verification failed: {}", e)),
        }),
    }
}

/// Verify an extension's signature from its manifest file
#[tauri::command]
pub fn verify_extension_signature(manifest_path: String) -> Result<SignatureVerification, String> {
    log::info!("Verifying extension signature for {}", manifest_path);

    // Read the manifest
    let manifest_content = fs::read_to_string(&manifest_path)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;

    let manifest: serde_json::Value = serde_json::from_str(&manifest_content)
        .map_err(|e| format!("Failed to parse manifest JSON: {}", e))?;

    // Check if the extension is signed
    let signature = manifest.get("signature").and_then(|v| v.as_str());
    let public_key_id = manifest.get("publicKeyId").and_then(|v| v.as_str());

    match (signature, public_key_id) {
        (Some(sig), Some(key_id)) => {
            verify_signature(&manifest, sig, key_id)
        }
        (Some(_), None) => {
            Ok(SignatureVerification {
                is_signed: true,
                is_valid: false,
                publisher_id: None,
                is_trusted: false,
                status: "Signed but missing publicKeyId".to_string(),
                error: Some("Extension has signature but no publicKeyId".to_string()),
            })
        }
        _ => {
            Ok(SignatureVerification {
                is_signed: false,
                is_valid: false,
                publisher_id: None,
                is_trusted: false,
                status: "Not signed".to_string(),
                error: None,
            })
        }
    }
}

/// Get list of trusted publishers
#[tauri::command]
pub fn get_trusted_publishers() -> Vec<String> {
    TRUSTED_PUBLISHERS
        .iter()
        .map(|(id, _)| id.to_string())
        .collect()
}

/// Install bundled Lua extensions into the app data extensions directory.
///
/// This copies any bundled extension directories that contain a `manifest.json` with at least one
/// `luaScript` tool (or a `hooks.lua` file) into `${appDataDir}/extensions/<extension_id>`.
///
/// The install is idempotent: if an extension is already installed with the same version, it's
/// skipped. If the bundled version differs, the installed copy is replaced.
#[tauri::command]
pub fn install_bundled_lua_extensions(app: AppHandle) -> Result<Vec<String>, String> {
    let bundled_root = match bundled_extensions_roots(&app).into_iter().find(|p| p.exists()) {
        Some(path) => path,
        None => return Ok(Vec::new()),
    };

    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to resolve app data directory: {}", e))?;
    let extensions_dir = app_data_dir.join("extensions");

    fs::create_dir_all(&extensions_dir).map_err(|e| {
        format!(
            "Failed to create extensions directory {}: {}",
            extensions_dir.display(),
            e
        )
    })?;

    let mut installed_ids = Vec::new();

    let entries = fs::read_dir(&bundled_root).map_err(|e| {
        format!(
            "Failed to read bundled extensions directory {}: {}",
            bundled_root.display(),
            e
        )
    })?;

    for entry in entries {
        let entry = entry.map_err(|e| format!("Failed to read directory entry: {}", e))?;
        let file_type = entry
            .file_type()
            .map_err(|e| format!("Failed to get file type: {}", e))?;
        if !file_type.is_dir() {
            continue;
        }

        let src_dir = entry.path();
        let manifest_path = src_dir.join("manifest.json");
        if !manifest_path.exists() {
            continue;
        }

        let manifest_content = fs::read_to_string(&manifest_path).map_err(|e| {
            format!(
                "Failed to read bundled manifest {}: {}",
                manifest_path.display(),
                e
            )
        })?;
        let manifest: ExtensionManifest = serde_json::from_str(&manifest_content).map_err(|e| {
            format!(
                "Failed to parse bundled manifest {}: {}",
                manifest_path.display(),
                e
            )
        })?;

        let has_lua_tools = manifest.tools.iter().any(|t| t.lua_script.is_some());
        let has_hooks = src_dir.join("hooks.lua").exists();
        if !has_lua_tools && !has_hooks {
            continue;
        }

        validate_extension_id(&manifest.id)?;

        let dest_dir = extensions_dir.join(&manifest.id);

        let mut should_install = true;
        if dest_dir.exists() {
            let existing_manifest_path = dest_dir.join("manifest.json");
            if let Ok(existing_content) = fs::read_to_string(&existing_manifest_path) {
                if let Ok(existing_manifest) = serde_json::from_str::<ExtensionManifest>(&existing_content)
                {
                    if existing_manifest.version == manifest.version {
                        should_install = false;
                    }
                }
            }
        }

        if !should_install {
            continue;
        }

        if dest_dir.exists() {
            let meta = fs::symlink_metadata(&dest_dir).map_err(|e| {
                format!(
                    "Failed to read existing extension path {}: {}",
                    dest_dir.display(),
                    e
                )
            })?;
            if meta.is_dir() {
                fs::remove_dir_all(&dest_dir).map_err(|e| {
                    format!(
                        "Failed to remove existing extension directory {}: {}",
                        dest_dir.display(),
                        e
                    )
                })?;
            } else {
                fs::remove_file(&dest_dir).map_err(|e| {
                    format!(
                        "Failed to remove existing extension file {}: {}",
                        dest_dir.display(),
                        e
                    )
                })?;
            }
        }

        copy_dir_recursive(&src_dir, &dest_dir).map_err(|e| {
            format!(
                "Failed to install bundled extension '{}' to {}: {}",
                manifest.id,
                dest_dir.display(),
                e
            )
        })?;

        installed_ids.push(manifest.id);
    }

    Ok(installed_ids)
}

/// Extract a .vsext (ZIP) file to the extensions directory
#[tauri::command]
pub fn extract_extension(
    vsext_path: String,
    extensions_dir: String,
) -> Result<ExtractResult, String> {
    log::info!("Extracting extension from {} to {}", vsext_path, extensions_dir);

    // Open the .vsext (ZIP) file
    let file = File::open(&vsext_path)
        .map_err(|e| format!("Failed to open .vsext file: {}", e))?;

    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    // Read manifest.json to get extension ID
    let extension_id = {
        // Check which manifest file exists
        let file_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
        let has_manifest_json = file_names.iter().any(|name| name == "manifest.json");
        let manifest_name = if has_manifest_json {
            "manifest.json"
        } else if file_names.iter().any(|name| name == "extension.js") {
            "extension.js"
        } else {
            return Err("No manifest.json or extension.js found in .vsext file".to_string());
        };

        let mut manifest_file = archive.by_name(manifest_name)
            .map_err(|e| format!("Failed to read {}: {}", manifest_name, e))?;

        let mut manifest_content = String::new();
        manifest_file.read_to_string(&mut manifest_content)
            .map_err(|e| format!("Failed to read manifest: {}", e))?;

        // Try parsing as JSON first (manifest.json)
        if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&manifest_content) {
            manifest["id"]
                .as_str()
                .ok_or("manifest.json missing 'id' field")?
                .to_string()
        } else {
            // Fallback: extract from extension.js (look for id: 'something')
            manifest_content
                .lines()
                .find(|line| line.contains("id:"))
                .and_then(|line| {
                    line.split("id:")
                        .nth(1)?
                        .split(&['\'', '"', ','][..])
                        .nth(1)
                })
                .ok_or("Could not determine extension ID from manifest")?
                .to_string()
        }
    };

    log::info!("Extension ID: {}", extension_id);

    // Validate extension ID to prevent path traversal attacks
    validate_extension_id(&extension_id)?;

    // Create extraction directory
    let extract_path = PathBuf::from(&extensions_dir).join(&extension_id);

    // Delete existing directory if it exists (for updates)
    if extract_path.exists() {
        log::info!("Removing existing extension at {:?}", extract_path);
        fs::remove_dir_all(&extract_path)
            .map_err(|e| format!("Failed to remove existing extension: {}", e))?;
    }

    fs::create_dir_all(&extract_path)
        .map_err(|e| format!("Failed to create extension directory: {}", e))?;

    // Extract all files
    for i in 0..archive.len() {
        let mut file = archive.by_index(i)
            .map_err(|e| format!("Failed to read file from archive: {}", e))?;

        let outpath = match file.enclosed_name() {
            Some(path) => extract_path.join(path),
            None => continue, // Skip if path is unsafe
        };

        if file.is_dir() {
            fs::create_dir_all(&outpath)
                .map_err(|e| format!("Failed to create directory: {}", e))?;
        } else {
            if let Some(p) = outpath.parent() {
                if !p.exists() {
                    fs::create_dir_all(p)
                        .map_err(|e| format!("Failed to create parent directory: {}", e))?;
                }
            }

            let mut outfile = File::create(&outpath)
                .map_err(|e| format!("Failed to create file: {}", e))?;

            io::copy(&mut file, &mut outfile)
                .map_err(|e| format!("Failed to write file: {}", e))?;
        }
    }

    log::info!("Extension extracted successfully to {:?}", extract_path);

    Ok(ExtractResult {
        extension_id,
        path: extract_path.to_string_lossy().to_string(),
    })
}

/// Delete an extension directory
#[tauri::command]
pub fn delete_extension(extension_path: String) -> Result<(), String> {
    log::info!("Deleting extension at {}", extension_path);

    let path = Path::new(&extension_path);

    if !path.exists() {
        return Err("Extension directory does not exist".to_string());
    }

    fs::remove_dir_all(path)
        .map_err(|e| format!("Failed to delete extension directory: {}", e))?;

    log::info!("Extension deleted successfully");
    Ok(())
}

/// Read extension metadata from a .vsext file without extracting
#[tauri::command]
pub fn read_extension_info(vsext_path: String) -> Result<ExtensionInfo, String> {
    log::info!("Reading extension info from {}", vsext_path);

    let file = File::open(&vsext_path)
        .map_err(|e| format!("Failed to open .vsext file: {}", e))?;

    let mut archive = ZipArchive::new(file)
        .map_err(|e| format!("Failed to read ZIP archive: {}", e))?;

    // Check which manifest file exists
    let file_names: Vec<String> = archive.file_names().map(|s| s.to_string()).collect();
    let has_manifest_json = file_names.iter().any(|name| name == "manifest.json");
    let manifest_name = if has_manifest_json {
        "manifest.json"
    } else if file_names.iter().any(|name| name == "extension.js") {
        "extension.js"
    } else {
        return Err("No manifest.json or extension.js found in .vsext file".to_string());
    };

    let mut manifest_file = archive.by_name(manifest_name)
        .map_err(|e| format!("Failed to read {}: {}", manifest_name, e))?;

    let mut manifest_content = String::new();
    manifest_file.read_to_string(&mut manifest_content)
        .map_err(|e| format!("Failed to read manifest: {}", e))?;

    // Try parsing as JSON first
    if let Ok(manifest) = serde_json::from_str::<serde_json::Value>(&manifest_content) {
        let id = manifest["id"]
            .as_str()
            .ok_or("manifest.json missing 'id' field")?
            .to_string();

        let version = manifest["version"]
            .as_str()
            .ok_or("manifest.json missing 'version' field")?
            .to_string();

        // Validate extension ID before returning
        validate_extension_id(&id)?;

        return Ok(ExtensionInfo { id, version });
    }

    // Fallback: parse extension.js
    let id = manifest_content
        .lines()
        .find(|line| line.contains("id:"))
        .and_then(|line| {
            line.split("id:")
                .nth(1)?
                .split(&['\'', '"', ','][..])
                .nth(1)
        })
        .ok_or("Could not determine extension ID")?
        .to_string();

    let version = manifest_content
        .lines()
        .find(|line| line.contains("version:"))
        .and_then(|line| {
            line.split("version:")
                .nth(1)?
                .split(&['\'', '"', ','][..])
                .nth(1)
        })
        .ok_or("Could not determine extension version")?
        .to_string();

    // Validate extension ID before returning
    validate_extension_id(&id)?;

    Ok(ExtensionInfo { id, version })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_valid_extension_ids() {
        // Valid IDs with various allowed characters
        assert!(validate_extension_id("hello-world").is_ok());
        assert!(validate_extension_id("my_extension").is_ok());
        assert!(validate_extension_id("Extension123").is_ok());
        assert!(validate_extension_id("a").is_ok()); // Minimum length
        assert!(validate_extension_id("valid-extension_name-123").is_ok());
        assert!(validate_extension_id("UPPERCASE").is_ok());
        assert!(validate_extension_id("mix3d-CaSe_123").is_ok());
    }

    #[test]
    fn test_path_traversal_attacks_blocked() {
        // Parent directory references
        assert!(validate_extension_id("..").is_err());
        assert!(validate_extension_id("../etc").is_err());
        assert!(validate_extension_id("foo/../bar").is_err());
        assert!(validate_extension_id("../../etc/passwd").is_err());
        assert!(validate_extension_id("valid..invalid").is_err());

        let err = validate_extension_id("..").unwrap_err();
        assert!(err.contains("path traversal"));
    }

    #[test]
    fn test_absolute_paths_blocked() {
        // Leading path separators
        assert!(validate_extension_id("/absolute/path").is_err());
        assert!(validate_extension_id("\\windows\\path").is_err());
        assert!(validate_extension_id("/etc").is_err());

        let err = validate_extension_id("/test").unwrap_err();
        assert!(err.contains("path separator"));
    }

    #[test]
    fn test_invalid_characters_blocked() {
        // Spaces
        assert!(validate_extension_id("has spaces").is_err());
        assert!(validate_extension_id("hello world").is_err());

        // Special characters
        assert!(validate_extension_id("has@symbol").is_err());
        assert!(validate_extension_id("has#hash").is_err());
        assert!(validate_extension_id("has$dollar").is_err());
        assert!(validate_extension_id("has%percent").is_err());
        assert!(validate_extension_id("has&ampersand").is_err());
        assert!(validate_extension_id("has*asterisk").is_err());
        assert!(validate_extension_id("has(paren").is_err());
        assert!(validate_extension_id("has!exclaim").is_err());
        assert!(validate_extension_id("has?question").is_err());
        assert!(validate_extension_id("has'quote").is_err());
        assert!(validate_extension_id("has\"doublequote").is_err());

        // Path separators in middle
        assert!(validate_extension_id("foo/bar").is_err());
        assert!(validate_extension_id("foo\\bar").is_err());

        let err = validate_extension_id("has spaces").unwrap_err();
        assert!(err.contains("letters, numbers, hyphens, and underscores"));
    }

    #[test]
    fn test_length_validation() {
        // Empty string
        assert!(validate_extension_id("").is_err());
        let err = validate_extension_id("").unwrap_err();
        assert!(err.contains("cannot be empty"));

        // Too long (> 64 characters)
        let too_long = "a".repeat(65);
        assert!(validate_extension_id(&too_long).is_err());
        let err = validate_extension_id(&too_long).unwrap_err();
        assert!(err.contains("longer than 64"));

        // Exactly 64 characters (should pass)
        let exactly_64 = "a".repeat(64);
        assert!(validate_extension_id(&exactly_64).is_ok());
    }

    #[test]
    fn test_edge_cases() {
        // Single character IDs
        assert!(validate_extension_id("a").is_ok());
        assert!(validate_extension_id("1").is_ok());
        assert!(validate_extension_id("-").is_ok());
        assert!(validate_extension_id("_").is_ok());

        // All hyphens/underscores
        assert!(validate_extension_id("---").is_ok());
        assert!(validate_extension_id("___").is_ok());
        assert!(validate_extension_id("-_-").is_ok());

        // Numbers only
        assert!(validate_extension_id("12345").is_ok());

        // Mixed valid characters
        assert!(validate_extension_id("a1-b2_c3").is_ok());
    }

    #[test]
    fn test_common_malicious_patterns() {
        // Null bytes
        assert!(validate_extension_id("test\0malicious").is_err());

        // Unicode normalization attacks
        assert!(validate_extension_id("test\u{202E}evil").is_err());

        // Control characters
        assert!(validate_extension_id("test\nmalicious").is_err());
        assert!(validate_extension_id("test\rmalicious").is_err());
        assert!(validate_extension_id("test\tmalicious").is_err());
    }
}
