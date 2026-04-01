/**
 * Shared AI configuration loader.
 * Reads system-wide AI keys/models from system_settings (key = 'ai_config').
 * Results are cached for 30 s to avoid a DB round-trip on every AI call.
 *
 * Priority for API keys:
 *   1. Environment variable  (highest — set by ops/infra, cannot be overridden)
 *   2. System config in DB   (set by admin in Configuración → Integraciones → Motor de IA)
 *   3. Key sent by the user  (BYOK — optional personal override)
 */

const pool = require('../config/database');

let _cache    = null;
let _cacheTs  = 0;
const TTL_MS  = 30_000; // 30 seconds

async function loadSystemAIConfig() {
  const now = Date.now();
  if (_cache && (now - _cacheTs) < TTL_MS) return _cache;

  try {
    const [rows] = await pool.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'ai_config'"
    );
    _cache   = rows.length && rows[0].setting_value ? JSON.parse(rows[0].setting_value) : {};
    _cacheTs = now;
  } catch {
    _cache   = {};
    _cacheTs = now;
  }
  return _cache;
}

/** Call after saving a new config so the next request picks up the change immediately. */
function clearAIConfigCache() {
  _cache   = null;
  _cacheTs = 0;
}

/**
 * Resolve the final API key and model for a request.
 * @param {object} reqBody  — req.body (provider, api_key, model sent by client)
 * @param {object} reqQuery — req.query (provider can also come from query string)
 * @param {number} userId   — for logging
 */
async function resolveAIConfig(reqBody = {}, reqQuery = {}, userId = null) {
  const sysCfg    = await loadSystemAIConfig();
  // Priority: request param → env var → system DB config → fallback
  const provider  = reqBody.provider || reqQuery.provider || process.env.AI_PROVIDER || sysCfg.default_provider || 'anthropic';

  let apiKey, model, source;

  if (provider === 'anthropic') {
    const envKey = process.env.ANTHROPIC_API_KEY;
    const dbKey  = sysCfg.anthropic_api_key;
    const userKey = reqBody.api_key;

    if (envKey)       { apiKey = envKey;  source = 'env';    }
    else if (dbKey)   { apiKey = dbKey;   source = 'system'; }
    else if (userKey) { apiKey = userKey; source = 'user';   }

    model = reqBody.model || sysCfg.anthropic_model || process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514';

  } else {
    const envKey  = process.env.OPENAI_API_KEY;
    const dbKey   = sysCfg.openai_api_key;
    const userKey = reqBody.api_key;

    if (envKey)       { apiKey = envKey;  source = 'env';    }
    else if (dbKey)   { apiKey = dbKey;   source = 'system'; }
    else if (userKey) { apiKey = userKey; source = 'user';   }

    model = reqBody.model || sysCfg.openai_model || process.env.OPENAI_MODEL || 'gpt-4o';
  }

  if (source === 'user') {
    console.warn(`[AI] Usuario usando clave propia (user=${userId}, provider=${provider})`);
  }

  if (!apiKey) {
    throw new Error(
      `API key no configurada para ${provider}. ` +
      `Un administrador debe configurarla en Configuración → Integraciones → Motor de IA, ` +
      `o puede ingresar su propia clave en el campo de configuración.`
    );
  }

  return { provider, apiKey, model, source };
}

module.exports = { loadSystemAIConfig, clearAIConfigCache, resolveAIConfig };
