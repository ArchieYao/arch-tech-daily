import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'data');
const CONFIG_FILE = join(DATA_DIR, 'api-config.enc.json');
const ENCRYPTION_KEY = process.env.CONFIG_SECRET || 'ai-daily-web-default-secret-2025';

if (!process.env.CONFIG_SECRET) {
  console.warn('[config] ⚠️  未设置 CONFIG_SECRET 环境变量，正在使用默认加密密钥。建议在 .env 中设置随机字符串以提高安全性。');
}

mkdirSync(DATA_DIR, { recursive: true });

function deriveKey(secret) {
  return scryptSync(secret, 'ai-daily-web-salt', 32);
}

function encrypt(text) {
  const iv = randomBytes(16);
  const key = deriveKey(ENCRYPTION_KEY);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  const tag = cipher.getAuthTag().toString('hex');
  return { iv: iv.toString('hex'), encrypted, tag };
}

function decrypt(data) {
  const key = deriveKey(ENCRYPTION_KEY);
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(data.iv, 'hex'));
  decipher.setAuthTag(Buffer.from(data.tag, 'hex'));
  let decrypted = decipher.update(data.encrypted, 'hex', 'utf8');
  decrypted += decipher.final('utf8');
  return decrypted;
}

export function saveApiConfig(config) {
  const plaintext = JSON.stringify(config);
  const encrypted = encrypt(plaintext);
  writeFileSync(CONFIG_FILE, JSON.stringify(encrypted));
}

export function loadApiConfig() {
  if (!existsSync(CONFIG_FILE)) return null;
  try {
    const data = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'));
    const plaintext = decrypt(data);
    return JSON.parse(plaintext);
  } catch {
    return null;
  }
}

// 默认 API 配置（首次启动时自动写入）
export const DEFAULT_API_CONFIG = {
  preset: 'doubao',
  apiKey: '',
  baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
  model: 'doubao-seed-2-0-pro-260215',
  schedules: [],
};

// 加载配置，如无已保存配置则自动初始化默认值
export function loadApiConfigOrInit() {
  const existing = loadApiConfig();
  if (existing) return existing;
  saveApiConfig(DEFAULT_API_CONFIG);
  console.log('[config] 已自动初始化默认 API 配置 (doubao)');
  return DEFAULT_API_CONFIG;
}

// Preset channels
export const API_PRESETS = {
  gemini: {
    name: 'Google Gemini',
    baseURL: 'https://generativelanguage.googleapis.com/v1beta',
    defaultModel: 'gemini-2.0-flash',
    type: 'gemini',
  },
  doubao: {
    name: '豆包 (Doubao)',
    baseURL: 'https://ark.cn-beijing.volces.com/api/v3',
    defaultModel: 'doubao-seed-2-0-pro-260215',
    type: 'openai',
  },
  openai: {
    name: 'OpenAI',
    baseURL: 'https://api.openai.com/v1',
    defaultModel: 'gpt-4o-mini',
    type: 'openai',
  },
  minimax: {
    name: 'MiniMax',
    baseURL: '',
    defaultModel: 'MiniMax-M2.7',
    type: 'minimax',
  },
  custom: {
    name: '自定义',
    baseURL: '',
    defaultModel: '',
    type: 'openai',
  },
};
