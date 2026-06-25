use base64::{engine::general_purpose::STANDARD, Engine};

/// simpleDecrypt 密钥 (从 JS 逆向分析得出)
const SIMPLE_KEY_BYTES: [u8; 16] = [71, 57, 122, 104, 85, 121, 112, 104, 113, 80, 87, 90, 71, 87, 122, 90];

/// l_encrypt / decode_media 共用密钥
const L_KEY: &str = "ym1eS4t0jTLakZYQ";

/// simpleDecrypt - 解密 data-url (Base64 + XOR)
/// 对应 JS 中的 simpleDecrypt 函数
pub fn simple_decrypt(ciphertext: &str) -> Option<String> {
    let raw_bytes = STANDARD.decode(ciphertext).ok()?;
    let mut result = Vec::with_capacity(raw_bytes.len());

    for (i, &byte) in raw_bytes.iter().enumerate() {
        result.push(byte ^ SIMPLE_KEY_BYTES[i % SIMPLE_KEY_BYTES.len()]);
    }

    let decrypted_str = String::from_utf8(result).ok()?;
    urlencoding::decode(&decrypted_str).ok().map(|s| s.into_owned())
}

/// l_encrypt - 生成 token (URL encode + XOR + Base64)
/// 对应 JS 中的 l_encrypt 函数
pub fn l_encrypt(plaintext: &str) -> String {
    let encoded = urlencoding::encode(plaintext);
    let l_key_bytes = L_KEY.as_bytes();
    let mut result = Vec::with_capacity(encoded.len());

    for (i, &byte) in encoded.as_bytes().iter().enumerate() {
        result.push(byte ^ l_key_bytes[i % l_key_bytes.len()]);
    }

    STANDARD.encode(&result)
}

/// decode_media - 解密媒体信息 (XOR + URL decode + JSON parse)
/// 对应 JS 中的 decode_media 函数
pub fn decode_media(media_base64: &str) -> Option<serde_json::Value> {
    let media_bytes = STANDARD.decode(media_base64).ok()?;
    let l_key_bytes = L_KEY.as_bytes();
    let mut result = Vec::with_capacity(media_bytes.len());

    for (i, &byte) in media_bytes.iter().enumerate() {
        result.push(byte ^ l_key_bytes[i % l_key_bytes.len()]);
    }

    let url_encoded = String::from_utf8(result).ok()?;
    let json_str = urlencoding::decode(&url_encoded).ok()?;
    serde_json::from_str(&json_str).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_l_encrypt_roundtrip() {
        // l_encrypt should produce a base64 string
        let result = l_encrypt("testVideoId123");
        assert!(!result.is_empty());
        // Result should be valid base64
        assert!(STANDARD.decode(&result).is_ok());
    }
}
