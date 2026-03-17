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
const requireAdmin = roleMiddleware('admin', 'director_pmo');
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

module.exports = router;
