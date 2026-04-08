/**
 * emailInbox.js — Configuración de bandeja de entrada por proyecto
 *
 * GET    /:projectId/email-inbox          → Obtener configuración
 * POST   /:projectId/email-inbox          → Crear / actualizar configuración
 * DELETE /:projectId/email-inbox          → Eliminar configuración
 * POST   /:projectId/email-inbox/test     → Probar conexión
 * POST   /:projectId/email-inbox/sync     → Sincronizar ahora (manual)
 * PATCH  /:projectId/email-inbox/toggle   → Activar / pausar
 */

const express = require('express');
const { param, body, validationResult } = require('express-validator');
const pool    = require('../config/database');
const { authMiddleware, roleMiddleware, projectAccessMiddleware } = require('../middleware/auth');
const { encrypt, decrypt, pollInbox } = require('../services/emailPoller');

const router = express.Router();
router.use(authMiddleware);

router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch (e) { next(e); }
});

function validate(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; }
  return true;
}

const PROVIDERS = ['imap', 'gmail', 'm365_basic', 'm365_modern'];

// ── Mapper: safe view (sin secretos) ─────────────────────────────────────────
function safeView(row) {
  if (!row) return null;
  return {
    id:                row.id,
    project_id:        row.project_id,
    provider:          row.provider,
    email:             row.email,
    imap_host:         row.imap_host,
    imap_port:         row.imap_port,
    imap_use_ssl:      !!row.imap_use_ssl,
    imap_folder:       row.imap_folder,
    username:          row.username,
    has_password:      !!row.password_enc,
    tenant_id:         row.tenant_id,
    client_id:         row.client_id,
    has_client_secret: !!row.client_secret_enc,
    poll_interval_min: row.poll_interval_min,
    enabled:           !!row.enabled,
    last_polled_at:    row.last_polled_at,
    emails_imported:   row.emails_imported,
    last_error:        row.last_error,
    created_at:        row.created_at,
    updated_at:        row.updated_at,
  };
}

// ════════════════════════════════════════════════════════════════════
// GET /:projectId/email-inbox
// ════════════════════════════════════════════════════════════════════
router.get('/:projectId/email-inbox', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [[row]] = await pool.execute(
      'SELECT * FROM project_email_inbox WHERE project_id = ?',
      [req.params.projectId]
    );
    res.json({ data: safeView(row) });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ════════════════════════════════════════════════════════════════════
// POST /:projectId/email-inbox — Crear o actualizar (upsert)
// ════════════════════════════════════════════════════════════════════
router.post('/:projectId/email-inbox',
  roleMiddleware('admin', 'gerente_proyecto'),
  [
    param('projectId').isInt(),
    body('provider').isIn(PROVIDERS),
    body('email').isEmail().normalizeEmail(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const pid = req.params.projectId;
      const b   = req.body;

      // Recuperar fila existente para no sobreescribir contraseñas si no se envían
      const [[existing]] = await pool.execute(
        'SELECT * FROM project_email_inbox WHERE project_id = ?', [pid]
      );

      // Encriptar contraseñas solo si vienen en el request
      const passwordEnc     = b.password     ? encrypt(b.password)      : (existing?.password_enc     || null);
      const clientSecretEnc = b.client_secret? encrypt(b.client_secret) : (existing?.client_secret_enc || null);

      if (existing) {
        // UPDATE
        await pool.execute(`
          UPDATE project_email_inbox SET
            provider          = ?,
            email             = ?,
            imap_host         = ?,
            imap_port         = ?,
            imap_use_ssl      = ?,
            imap_folder       = ?,
            username          = ?,
            password_enc      = ?,
            tenant_id         = ?,
            client_id         = ?,
            client_secret_enc = ?,
            poll_interval_min = ?
          WHERE project_id = ?
        `, [
          b.provider,
          b.email,
          b.imap_host        || null,
          b.imap_port        || 993,
          b.imap_use_ssl !== false ? 1 : 0,
          b.imap_folder      || 'INBOX',
          b.username         || null,
          passwordEnc,
          b.tenant_id        || null,
          b.client_id        || null,
          clientSecretEnc,
          b.poll_interval_min || 15,
          pid,
        ]);
      } else {
        // INSERT
        await pool.execute(`
          INSERT INTO project_email_inbox
            (project_id, provider, email, imap_host, imap_port, imap_use_ssl,
             imap_folder, username, password_enc, tenant_id, client_id,
             client_secret_enc, poll_interval_min, enabled)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `, [
          pid,
          b.provider,
          b.email,
          b.imap_host        || null,
          b.imap_port        || 993,
          b.imap_use_ssl !== false ? 1 : 0,
          b.imap_folder      || 'INBOX',
          b.username         || null,
          passwordEnc,
          b.tenant_id        || null,
          b.client_id        || null,
          clientSecretEnc,
          b.poll_interval_min || 15,
          0, // disabled by default until tested
        ]);
      }

      const [[updated]] = await pool.execute(
        'SELECT * FROM project_email_inbox WHERE project_id = ?', [pid]
      );
      res.json({ data: safeView(updated), message: 'Configuración guardada' });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
  }
);

// ════════════════════════════════════════════════════════════════════
// DELETE /:projectId/email-inbox
// ════════════════════════════════════════════════════════════════════
router.delete('/:projectId/email-inbox',
  roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      await pool.execute('DELETE FROM project_email_inbox WHERE project_id = ?', [req.params.projectId]);
      res.json({ message: 'Configuración eliminada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// ════════════════════════════════════════════════════════════════════
// PATCH /:projectId/email-inbox/toggle — Activar / pausar
// ════════════════════════════════════════════════════════════════════
router.patch('/:projectId/email-inbox/toggle',
  roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[row]] = await pool.execute(
        'SELECT id, enabled FROM project_email_inbox WHERE project_id = ?',
        [req.params.projectId]
      );
      if (!row) return res.status(404).json({ error: 'No hay configuración de bandeja' });
      const newState = req.body.enabled !== undefined ? (req.body.enabled ? 1 : 0) : (row.enabled ? 0 : 1);
      await pool.execute(
        'UPDATE project_email_inbox SET enabled = ? WHERE project_id = ?',
        [newState, req.params.projectId]
      );
      res.json({ enabled: !!newState, message: newState ? 'Bandeja activada' : 'Bandeja pausada' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  }
);

// ════════════════════════════════════════════════════════════════════
// POST /:projectId/email-inbox/test — Probar conexión
// ════════════════════════════════════════════════════════════════════
router.post('/:projectId/email-inbox/test',
  roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    const b = req.body;
    let provider = b.provider;
    try {
      const pid = req.params.projectId;

      // Recuperar config guardada como base; el request puede sobreescribir
      const [[saved]] = await pool.execute(
        'SELECT * FROM project_email_inbox WHERE project_id = ?', [pid]
      );

      provider       = b.provider || saved?.provider;
      const email    = b.email    || saved?.email;

      if (provider === 'm365_modern') {
        // Probar con Graph API
        const tenantId     = b.tenant_id     || saved?.tenant_id;
        const clientId     = b.client_id     || saved?.client_id;
        const clientSecret = b.client_secret || decrypt(saved?.client_secret_enc);

        if (!tenantId || !clientId || !clientSecret)
          return res.status(400).json({ error: 'Faltan credenciales M365 (tenant_id, client_id, client_secret)' });

        const axios = require('axios');
        const tokenRes = await axios.post(
          `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
          new URLSearchParams({
            grant_type: 'client_credentials',
            client_id: clientId,
            client_secret: clientSecret,
            scope: 'https://graph.microsoft.com/.default',
          }),
          { headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, timeout: 10000 }
        );
        const token = tokenRes.data.access_token;

        // Verificar acceso al buzón
        const mailRes = await axios.get(
          `https://graph.microsoft.com/v1.0/users/${email}/mailFolders/inbox`,
          { headers: { Authorization: `Bearer ${token}` }, timeout: 10000 }
        );
        const totalItems = mailRes.data.totalItemCount || 0;
        res.json({ ok: true, message: `Conexión exitosa. Buzón accesible (${totalItems} mensajes en bandeja).` });

      } else {
        // Probar con IMAP
        const { ImapFlow } = require('imapflow');
        const providerDefaults = {
          gmail:      { host: 'imap.gmail.com',        port: 993, secure: true },
          m365_basic: { host: 'outlook.office365.com', port: 993, secure: true },
          imap:       { host: b.imap_host || saved?.imap_host || 'localhost', port: b.imap_port || saved?.imap_port || 993, secure: true },
        };
        const def  = providerDefaults[provider] || providerDefaults.imap;
        const host = b.imap_host || saved?.imap_host || def.host;
        const port = b.imap_port || saved?.imap_port || def.port;
        const tls  = b.imap_use_ssl !== false;
        const user = b.username || saved?.username;
        const pass = b.password  || decrypt(saved?.password_enc);

        if (!user || !pass) return res.status(400).json({ error: 'Faltan usuario y contraseña' });

        const client = new ImapFlow({
          host, port, secure: tls,
          auth: { user, pass },
          logger: false,
          tls: { rejectUnauthorized: false },
          connectionTimeout: 10000,
        });

        await client.connect();
        const status = await client.status(b.imap_folder || saved?.imap_folder || 'INBOX', { messages: true, unseen: true });
        await client.logout().catch(() => {});

        res.json({
          ok: true,
          message: `Conexión exitosa. Bandeja: ${status.messages} mensajes, ${status.unseen} sin leer.`,
        });
      }
    } catch (err) {
      console.error('[email-inbox/test]', err.message);

      // Mensajes de error más descriptivos según la causa
      const raw = err.message || '';
      let friendly = raw;

      if (/AUTHENTICATE|Invalid credentials|authentication failed|LOGIN failed/i.test(raw)) {
        friendly = provider === 'gmail'
          ? 'Credenciales incorrectas. Para Gmail usa una Contraseña de aplicación (no tu contraseña normal). Actívala en myaccount.google.com → Seguridad → Contraseñas de aplicaciones.'
          : 'Usuario o contraseña incorrectos.';
      } else if (/Command failed|IMAP/i.test(raw) && provider === 'm365_basic') {
        friendly = 'Conexión IMAP rechazada por Microsoft 365. Verifica:\n1) IMAP habilitado para este buzón: admin.exchange.microsoft.com → Buzones → [usuario] → Administrar apps de correo → IMAP ✓\n2) SMTP AUTH habilitado: admin.microsoft.com → Usuarios activos → [usuario] → Correo → Correo autenticado SMTP ✓\n3) Si la cuenta tiene MFA activo, usa una Contraseña de aplicación en lugar de la contraseña normal.\nSi persiste, usa "Microsoft 365 (Auth moderna)" que no requiere ninguna de estas configuraciones.';
      } else if (/Command failed/i.test(raw)) {
        friendly = 'El servidor rechazó el comando IMAP. Verifica que las credenciales y el servidor sean correctos.';
      } else if (/ECONNREFUSED|ENOTFOUND|ETIMEDOUT|timeout/i.test(raw)) {
        friendly = `No se pudo conectar al servidor. Verifica el host (${b.imap_host || 'por defecto'}) y el puerto, y que no haya firewall bloqueando la conexión.`;
      } else if (/certificate|TLS|SSL/i.test(raw)) {
        friendly = 'Error de certificado TLS. Intenta deshabilitar SSL o verifica la configuración del servidor.';
      }

      res.status(400).json({ ok: false, error: friendly });
    }
  }
);

// ════════════════════════════════════════════════════════════════════
// POST /:projectId/email-inbox/sync — Sincronizar ahora (manual)
// ════════════════════════════════════════════════════════════════════
router.post('/:projectId/email-inbox/sync',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[inbox]] = await pool.execute(
        'SELECT * FROM project_email_inbox WHERE project_id = ?',
        [req.params.projectId]
      );
      if (!inbox) return res.status(404).json({ error: 'No hay configuración de bandeja' });

      // Ejecutar sync (puede tardar, pero respondemos en máx 30s)
      const imported = await Promise.race([
        pollInbox(inbox),
        new Promise((_, rej) => setTimeout(() => rej(new Error('Timeout 30s')), 30000)),
      ]);

      const [[updated]] = await pool.execute(
        'SELECT last_polled_at, emails_imported, last_error FROM project_email_inbox WHERE project_id = ?',
        [req.params.projectId]
      );
      res.json({
        message:        `Sincronización completada: ${imported} correo(s) nuevo(s)`,
        imported,
        last_polled_at: updated?.last_polled_at,
        emails_imported:updated?.emails_imported,
        last_error:     updated?.last_error,
      });
    } catch (err) {
      console.error('[email-inbox/sync]', err.message);
      res.status(500).json({ error: err.message });
    }
  }
);

module.exports = router;
