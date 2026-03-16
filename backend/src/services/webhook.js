/**
 * Outbound webhook dispatcher for SGIP-IA → N8N (or any HTTP endpoint)
 *
 * Usage:
 *   const webhook = require('./services/webhook');
 *   await webhook.emit('acta.created', { project_id: 7, acta_id: 3, title: '...' });
 *
 * Available events:
 *   acta.created            commitment.created
 *   commitment.overdue      correspondence.created
 *   project.updated         payment.pending
 */
const https = require('https');
const http  = require('http');
const db    = require('../config/database');

// ─── Load N8N / webhook config from DB ───────────────────────────────────────
async function loadConfig() {
  try {
    const [rows] = await db.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'n8n_config'"
    );
    if (!rows.length || !rows[0].setting_value) return {};
    return JSON.parse(rows[0].setting_value);
  } catch { return {}; }
}

// ─── Fire a single HTTP POST ──────────────────────────────────────────────────
function postWebhook(url, payload, secret) {
  return new Promise((resolve) => {
    const body = JSON.stringify(payload);
    const parsed = new URL(url);
    const lib  = parsed.protocol === 'https:' ? https : http;

    const headers = {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
      'X-SGIP-Event': payload.event,
      'X-SGIP-Timestamp': String(payload.timestamp),
    };

    // HMAC signature for verification on N8N side
    if (secret) {
      const { createHmac } = require('crypto');
      const sig = createHmac('sha256', secret).update(body).digest('hex');
      headers['X-SGIP-Signature'] = 'sha256=' + sig;
    }

    const req = lib.request({
      hostname: parsed.hostname,
      port:     parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path:     parsed.pathname + parsed.search,
      method:   'POST',
      headers,
    }, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => resolve({ ok: res.statusCode < 400, status: res.statusCode }));
    });

    req.on('error', (e) => resolve({ ok: false, error: e.message }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ ok: false, error: 'timeout' }); });
    req.write(body);
    req.end();
  });
}

// ─── Main emit function ───────────────────────────────────────────────────────
async function emit(eventName, data = {}) {
  try {
    const cfg = await loadConfig();
    if (!cfg.enabled) return;

    const events = cfg.events || [];
    const targets = events.filter(e => e.event === eventName && e.webhook_url);

    if (!targets.length) return;

    const payload = {
      event: eventName,
      timestamp: Date.now(),
      source: 'sgip-ia',
      data,
    };

    // Fire all matching webhooks (non-blocking)
    for (const target of targets) {
      postWebhook(target.webhook_url, payload, cfg.webhook_secret)
        .then(result => {
          if (!result.ok) console.warn(`[webhook] ${eventName} → ${target.webhook_url} failed:`, result);
        })
        .catch(e => console.warn(`[webhook] ${eventName} dispatch error:`, e.message));
    }
  } catch (e) {
    console.error('[webhook] emit error:', e.message);
  }
}

// ─── Test a specific webhook URL ──────────────────────────────────────────────
async function testWebhook(webhookUrl, secret) {
  const payload = {
    event: 'test',
    timestamp: Date.now(),
    source: 'sgip-ia',
    data: {
      message: 'Prueba de conexión desde SGIP-IA',
      success: true,
    },
  };
  return postWebhook(webhookUrl, payload, secret);
}

module.exports = { emit, testWebhook };
