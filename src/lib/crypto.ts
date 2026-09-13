import CryptoJS from "crypto-js";

// 与学习通官方一致的固定密钥（Python 版沿用），用于 fanyalogin 加密账号密码
const CX_AES_KEY = "u2oh6Vu^HWe4_AES";

/**
 * 超星 fanyalogin 使用 AES-128-CBC + PKCS7，key 与 iv 相同。
 * 输出 base64。
 */
export function chaoxingEncrypt(plaintext: string): string {
  const key = CryptoJS.enc.Utf8.parse(CX_AES_KEY);
  const iv = CryptoJS.enc.Utf8.parse(CX_AES_KEY);
  const encrypted = CryptoJS.AES.encrypt(plaintext, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return encrypted.toString();
}

/**
 * 平台侧可逆加密（用于在 DB 中保存超星密码）。
 * 使用 APP_SECRET 派生 key；本地无密钥时用固定开发密钥。
 */
const DEV_SECRET = "dev-only-secret-change-me";

function deriveKey(secret: string): CryptoJS.lib.WordArray {
  return CryptoJS.SHA256(secret).toString(CryptoJS.enc.Hex).slice(0, 32) as unknown as CryptoJS.lib.WordArray;
}

export function appEncrypt(text: string, secret?: string): string {
  const s = secret || DEV_SECRET;
  const key = CryptoJS.enc.Utf8.parse(CryptoJS.SHA256(s).toString().slice(0, 32));
  const iv = CryptoJS.lib.WordArray.random(16);
  const encrypted = CryptoJS.AES.encrypt(text, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return iv.toString(CryptoJS.enc.Base64) + ":" + encrypted.toString();
}

export function appDecrypt(payload: string, secret?: string): string {
  if (!payload) return "";
  const s = secret || DEV_SECRET;
  const key = CryptoJS.enc.Utf8.parse(CryptoJS.SHA256(s).toString().slice(0, 32));
  const [ivB64, dataB64] = payload.split(":");
  if (!ivB64 || !dataB64) return "";
  const iv = CryptoJS.enc.Base64.parse(ivB64);
  const decrypted = CryptoJS.AES.decrypt(dataB64, key, {
    iv,
    mode: CryptoJS.mode.CBC,
    padding: CryptoJS.pad.Pkcs7,
  });
  return decrypted.toString(CryptoJS.enc.Utf8);
}

// 派生 key 保留引用（避免 tree-shaking 告警，实际未使用）
void deriveKey;
