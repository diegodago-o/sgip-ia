/**
 * /api/settings  — System configuration endpoints
 *
 * GET  /api/settings/email          → get email config (passwords masked)
 * PUT  /api/settings/email          → save email config
 * POST /api/settings/email/test     → send test email
 */
const express = require('express');
const router = express.Router();
const { authMiddleware: authenticate, roleMiddleware } = require('../middleware/auth');
const requireAdmin = roleMiddleware('admin');
const db = require('../config/database');
const { sendMail, verifyConnection } = require('../services/mailer');

// ── Auto-create table if it doesn't exist (self-healing) ─────────────────────
async function ensureTable() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS system_settings (
        id           INT PRIMARY KEY AUTO_INCREMENT,
        setting_key  VARCHAR(100) NOT NULL UNIQUE,
        setting_value LONGTEXT,
        is_sensitive TINYINT NOT NULL DEFAULT 0,
        updated_by   INT,
        updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (e) {
    console.error('[settings] ensureTable error:', e.message);
  }
}
// Run once at startup
ensureTable();

// ── Sensitive fields — never sent back to frontend as plaintext ───────────────
const SENSITIVE = ['password', 'client_secret'];

function maskConfig(cfg) {
  const out = { ...cfg };
  for (const key of SENSITIVE) {
    if (out[key]) out[key] = '********';
  }
  return out;
}

// ── Helper: load raw config from DB ──────────────────────────────────────────
async function loadEmailConfig() {
  const [rows] = await db.execute(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'email_config'"
  );
  if (!rows.length || !rows[0].setting_value) return {};
  try { return JSON.parse(rows[0].setting_value); } catch { return {}; }
}

// ── Helper: save config to DB ─────────────────────────────────────────────────
async function saveEmailConfig(cfg, userId) {
  await db.execute(
    `INSERT INTO system_settings (setting_key, setting_value, is_sensitive, updated_by)
     VALUES ('email_config', ?, 1, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [JSON.stringify(cfg), userId]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/settings/email
// ─────────────────────────────────────────────────────────────────────────────
router.get('/email', authenticate, requireAdmin, async (req, res) => {
  try {
    const cfg = await loadEmailConfig();
    res.json({ success: true, data: maskConfig(cfg) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/settings/email
// ─────────────────────────────────────────────────────────────────────────────
router.put('/email', authenticate, requireAdmin, async (req, res) => {
  try {
    const incoming = req.body || {};

    // Preserve existing password/secret if placeholder sent back
    let existing = {};
    try { existing = await loadEmailConfig(); } catch {}

    const cfg = { ...incoming };
    for (const key of SENSITIVE) {
      if (cfg[key] === '********' || cfg[key] === '') {
        cfg[key] = existing[key] || '';   // keep old value
      }
    }

    await saveEmailConfig(cfg, req.user.id);
    res.json({ success: true, message: 'Configuración guardada correctamente' });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/settings/email/test
// ─────────────────────────────────────────────────────────────────────────────
router.post('/email/test', authenticate, requireAdmin, async (req, res) => {
  try {
    const { test_recipient, ...incomingCfg } = req.body || {};

    // Merge with saved config so we can test unsaved changes w/ preserved passwords
    let saved = {};
    try { saved = await loadEmailConfig(); } catch {}

    const cfg = { ...saved, ...incomingCfg };
    for (const key of SENSITIVE) {
      if (cfg[key] === '********' || cfg[key] === '') {
        cfg[key] = saved[key] || '';
      }
    }

    if (!cfg.provider_type) {
      return res.status(400).json({ error: 'Tipo de proveedor no configurado' });
    }

    const recipient = test_recipient || cfg.from_email || cfg.username;
    if (!recipient) {
      return res.status(400).json({ error: 'Ingrese un destinatario para el correo de prueba' });
    }

    // Verify transport first (skip for Graph API, tested implicitly)
    if (cfg.provider_type !== 'oauth2_m365') {
      await verifyConnection(cfg);
    }

    await sendMail(cfg, {
      to: recipient,
      subject: '✅ SGIP-IA — Prueba de conexión de correo',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:8px">
          <h2 style="color:#1e3a5f;margin-top:0">SGIP-IA · Prueba de correo</h2>
          <p style="color:#4a5568">La conexión SMTP/correo está configurada correctamente.</p>
          <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;border-radius:4px;margin:16px 0">
            <strong style="color:#15803d">✓ Configuración verificada</strong><br>
            <span style="color:#166534;font-size:13px">Proveedor: <b>${cfg.provider_type}</b></span>
          </div>
          <p style="color:#718096;font-size:12px;margin-bottom:0">
            Este es un mensaje automático generado por SGIP-IA. No responda a este correo.
          </p>
        </div>`,
    });

    res.json({ success: true, message: `Correo de prueba enviado a ${recipient}` });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Notifications config
// ─────────────────────────────────────────────────────────────────────────────
async function loadNotifConfig() {
  const [rows] = await db.execute(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'notification_config'"
  );
  if (!rows.length || !rows[0].setting_value) return { enabled: false, notifications: {} };
  try { return JSON.parse(rows[0].setting_value); } catch { return { enabled: false, notifications: {} }; }
}

async function saveNotifConfig(cfg, userId) {
  await db.execute(
    `INSERT INTO system_settings (setting_key, setting_value, is_sensitive, updated_by)
     VALUES ('notification_config', ?, 0, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [JSON.stringify(cfg), userId]
  );
}

// GET /api/settings/notifications
router.get('/notifications', authenticate, requireAdmin, async (req, res) => {
  try {
    const cfg = await loadNotifConfig();
    res.json({ success: true, data: cfg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/notifications
router.put('/notifications', authenticate, requireAdmin, async (req, res) => {
  try {
    await saveNotifConfig(req.body || {}, req.user.id);
    res.json({ success: true, message: 'Configuración de notificaciones guardada correctamente' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/settings/notifications/test
router.post('/notifications/test', authenticate, requireAdmin, async (req, res) => {
  try {
    const { email } = req.body || {};
    if (!email) return res.status(400).json({ error: 'Correo destinatario requerido' });

    // Reuse the same helper used by the email section
    const cfg = await loadEmailConfig();

    if (!cfg || !cfg.provider_type) {
      return res.status(400).json({ error: 'Configure primero el servidor de correo en la pestaña "Correo electrónico"' });
    }

    // Verify transport before sending (same as email/test does), skip for Graph API
    if (cfg.provider_type !== 'oauth2_m365') {
      await verifyConnection(cfg);
    }

    await sendMail(cfg, {
      to: email,
      subject: '[SGIP-IA] Prueba de notificaciones',
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;border:1px solid #e2e8f0;border-radius:8px">
          <h2 style="color:#1e3a5f;margin-top:0">SGIP-IA · Prueba de notificaciones</h2>
          <p style="color:#4a5568">Las notificaciones por correo están configuradas y funcionando correctamente.</p>
          <div style="background:#f0fdf4;border-left:4px solid #22c55e;padding:12px 16px;border-radius:4px;margin:16px 0">
            <strong style="color:#15803d">✓ Sistema de notificaciones activo</strong><br>
            <span style="color:#166534;font-size:13px">Proveedor: <b>${cfg.provider_type}</b></span>
          </div>
          <p style="color:#718096;font-size:12px;margin-bottom:0">Este es un mensaje automático de SGIP-IA.</p>
        </div>`,
    });

    res.json({ success: true, message: `Correo de prueba enviado a ${email}` });
  } catch (e) {
    console.error('[notifications/test] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// N8N / Webhooks — helpers
// ─────────────────────────────────────────────────────────────────────────────
async function loadN8nConfig() {
  const [rows] = await db.execute(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'n8n_config'"
  );
  if (!rows.length || !rows[0].setting_value) return { enabled: false, webhook_secret: '', events: [] };
  try { return JSON.parse(rows[0].setting_value); } catch { return { enabled: false, webhook_secret: '', events: [] }; }
}

async function saveN8nConfig(cfg, userId) {
  await db.execute(
    `INSERT INTO system_settings (setting_key, setting_value, is_sensitive, updated_by)
     VALUES ('n8n_config', ?, 0, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [JSON.stringify(cfg), userId]
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/settings/n8n
// ─────────────────────────────────────────────────────────────────────────────
router.get('/n8n', authenticate, requireAdmin, async (req, res) => {
  try {
    const cfg = await loadN8nConfig();
    // Mask secret in response
    if (cfg.webhook_secret) cfg.webhook_secret = '********';
    res.json({ success: true, data: cfg });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// PUT /api/settings/n8n
// ─────────────────────────────────────────────────────────────────────────────
router.put('/n8n', authenticate, requireAdmin, async (req, res) => {
  try {
    const incoming = req.body || {};
    let existing = {};
    try { existing = await loadN8nConfig(); } catch {}

    const cfg = { ...incoming };
    // Preserve existing secret if placeholder sent back
    if (cfg.webhook_secret === '********' || cfg.webhook_secret === '') {
      cfg.webhook_secret = existing.webhook_secret || '';
    }

    await saveN8nConfig(cfg, req.user.id);
    res.json({ success: true, message: 'Configuración N8N guardada correctamente' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/settings/n8n/test
// ─────────────────────────────────────────────────────────────────────────────
router.post('/n8n/test', authenticate, requireAdmin, async (req, res) => {
  try {
    const { webhook_url, webhook_secret: incomingSecret } = req.body || {};
    if (!webhook_url) return res.status(400).json({ error: 'URL del webhook requerida' });

    let existing = {};
    try { existing = await loadN8nConfig(); } catch {}

    const secret = (incomingSecret && incomingSecret !== '********')
      ? incomingSecret
      : existing.webhook_secret;

    const { testWebhook } = require('../services/webhook');
    const result = await testWebhook(webhook_url, secret);

    if (result.ok) {
      res.json({ success: true, message: `Webhook respondió correctamente (HTTP ${result.status})` });
    } else {
      res.status(400).json({ error: result.error || `El webhook falló (HTTP ${result.status})` });
    }
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// SSO (Single Sign-On) — Google + Microsoft
// ─────────────────────────────────────────────────────────────────────────────
const SSO_SENSITIVE = ['google_client_secret', 'microsoft_client_secret'];

async function loadSSOConfig() {
  const [rows] = await db.execute(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'sso_config'"
  );
  if (!rows.length || !rows[0].setting_value) return {};
  try { return JSON.parse(rows[0].setting_value); } catch { return {}; }
}

async function saveSSOConfig(cfg, userId) {
  await db.execute(
    `INSERT INTO system_settings (setting_key, setting_value, is_sensitive, updated_by)
     VALUES ('sso_config', ?, 1, ?)
     ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
    [JSON.stringify(cfg), userId]
  );
}

function maskSSOConfig(cfg) {
  const out = { ...cfg };
  for (const key of SSO_SENSITIVE) {
    if (out[key]) out[key] = '********';
  }
  return out;
}

// GET /api/settings/sso
router.get('/sso', authenticate, requireAdmin, async (req, res) => {
  try {
    const cfg = await loadSSOConfig();
    res.json({ success: true, data: maskSSOConfig(cfg) });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/sso
router.put('/sso', authenticate, requireAdmin, async (req, res) => {
  try {
    const incoming = req.body || {};
    let existing = {};
    try { existing = await loadSSOConfig(); } catch {}

    const cfg = { ...incoming };
    // Preserve existing secrets if placeholder sent back
    for (const key of SSO_SENSITIVE) {
      if (cfg[key] === '********' || cfg[key] === '') {
        cfg[key] = existing[key] || '';
      }
    }

    await saveSSOConfig(cfg, req.user.id);
    res.json({ success: true, message: 'Configuración SSO guardada correctamente' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// AI Config — system-wide API keys and default models
// ─────────────────────────────────────────────────────────────────────────────
const { clearAIConfigCache } = require('../services/aiConfig');

const AI_SENSITIVE = ['anthropic_api_key', 'openai_api_key'];

// GET /api/settings/ai
router.get('/ai', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'ai_config'"
    );
    const cfg = rows.length && rows[0].setting_value ? JSON.parse(rows[0].setting_value) : {};
    // Mask secrets before sending to frontend
    const masked = { ...cfg };
    for (const k of AI_SENSITIVE) { if (masked[k]) masked[k] = '********'; }
    res.json({ success: true, data: masked });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/ai
router.put('/ai', authenticate, requireAdmin, async (req, res) => {
  try {
    const incoming = req.body || {};
    const [rows] = await db.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'ai_config'"
    );
    const existing = rows.length && rows[0].setting_value ? JSON.parse(rows[0].setting_value) : {};
    const cfg = { ...incoming };
    // Preserve existing secrets if placeholder was sent back
    for (const k of AI_SENSITIVE) {
      if (cfg[k] === '********' || cfg[k] === '') cfg[k] = existing[k] || '';
    }
    await db.execute(
      `INSERT INTO system_settings (setting_key, setting_value, is_sensitive, updated_by)
       VALUES ('ai_config', ?, 1, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value), updated_by = VALUES(updated_by)`,
      [JSON.stringify(cfg), req.user.id]
    );
    clearAIConfigCache(); // force next request to re-read from DB
    res.json({ success: true, message: 'Configuración de IA guardada correctamente' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════════════
// PLAZOS DE RESPUESTA POR TIPO DOCUMENTAL
// ════════════════════════════════════════════════════════════════════════════

// Helper: derive a safe key from a label (e.g. "Tipo Especial" → "tipo_especial")
function slugify(str) {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

// GET /api/settings/correspondence-deadlines
router.get('/correspondence-deadlines', authenticate, async (req, res) => {
  try {
    const [rows] = await db.execute(
      'SELECT correspondence_type, label, business_days, description FROM correspondence_type_deadlines ORDER BY label, correspondence_type'
    );
    res.json({ data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// PUT /api/settings/correspondence-deadlines  — body: [{ correspondence_type, label, business_days, description }]
router.put('/correspondence-deadlines', authenticate, requireAdmin, async (req, res) => {
  try {
    const items = req.body;
    if (!Array.isArray(items)) return res.status(400).json({ error: 'Se esperaba un array' });
    for (const item of items) {
      if (!item.correspondence_type || !item.business_days) continue;
      await db.execute(
        `INSERT INTO correspondence_type_deadlines (correspondence_type, label, business_days, description, updated_by)
         VALUES (?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE label = VALUES(label), business_days = VALUES(business_days), description = VALUES(description), updated_by = VALUES(updated_by)`,
        [item.correspondence_type, item.label || item.correspondence_type, Number(item.business_days), item.description || null, req.user.id]
      );
    }
    res.json({ success: true, message: 'Plazos actualizados correctamente' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST /api/settings/correspondence-deadlines — create a new document type
router.post('/correspondence-deadlines', authenticate, requireAdmin, async (req, res) => {
  try {
    const { label, business_days, description } = req.body || {};
    if (!label || !label.trim()) return res.status(400).json({ error: 'El nombre del tipo es requerido' });
    if (!business_days || Number(business_days) < 1) return res.status(400).json({ error: 'Los días hábiles deben ser al menos 1' });

    const correspondence_type = slugify(label);
    if (!correspondence_type) return res.status(400).json({ error: 'El nombre no generó una clave válida' });

    // Check for duplicate
    const [[existing]] = await db.execute(
      'SELECT id FROM correspondence_type_deadlines WHERE correspondence_type = ?', [correspondence_type]
    );
    if (existing) return res.status(409).json({ error: `Ya existe un tipo con la clave "${correspondence_type}"` });

    await db.execute(
      `INSERT INTO correspondence_type_deadlines (correspondence_type, label, business_days, description, updated_by) VALUES (?, ?, ?, ?, ?)`,
      [correspondence_type, label.trim(), Number(business_days), description || null, req.user.id]
    );
    res.status(201).json({ success: true, data: { correspondence_type, label: label.trim(), business_days: Number(business_days), description: description || null } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE /api/settings/correspondence-deadlines/:type — remove a custom type
router.delete('/correspondence-deadlines/:type', authenticate, requireAdmin, async (req, res) => {
  try {
    const { type } = req.params;
    // Prevent deleting built-in types
    const BUILTIN = ['oficio', 'circular', 'memorando', 'comunicado', 'carta', 'radicado', 'derecho_peticion'];
    if (BUILTIN.includes(type)) return res.status(400).json({ error: 'No se pueden eliminar los tipos predeterminados del sistema' });

    const [result] = await db.execute('DELETE FROM correspondence_type_deadlines WHERE correspondence_type = ?', [type]);
    if (result.affectedRows === 0) return res.status(404).json({ error: 'Tipo no encontrado' });
    res.json({ success: true, message: 'Tipo eliminado correctamente' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
