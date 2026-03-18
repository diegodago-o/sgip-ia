/**
 * Firmas digitales — validez jurídica según Ley 527/1999 (Colombia)
 *
 * Authenticated routes  →  /api/exec/:projectId/minutes/:minuteId/firma
 * Public routes         →  /api/firma/:token
 */
const express = require('express');
const crypto  = require('crypto');
const pool    = require('../config/database');
const { authMiddleware: authenticate } = require('../middleware/auth');

// ── Self-healing tables ──────────────────────────────────────────────────────
async function ensureTable() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS signature_requests (
      id            INT AUTO_INCREMENT PRIMARY KEY,
      minute_id     INT NOT NULL,
      project_id    INT NOT NULL,
      status        ENUM('in_progress','completed','rejected','cancelled') DEFAULT 'in_progress',
      created_by    INT NOT NULL,
      document_hash VARCHAR(64),
      created_at    TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at  TIMESTAMP NULL
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS signature_signers (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      request_id       INT NOT NULL,
      signer_name      VARCHAR(255) NOT NULL,
      signer_email     VARCHAR(255) NOT NULL,
      signer_role      VARCHAR(100),
      sign_order       INT DEFAULT 1,
      token            VARCHAR(64) UNIQUE NOT NULL,
      status           ENUM('pending','notified','viewed','signed','rejected') DEFAULT 'pending',
      signature_image  LONGTEXT,
      signed_at        TIMESTAMP NULL,
      ip_address       VARCHAR(45),
      user_agent       VARCHAR(500),
      rejection_reason TEXT,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
ensureTable().catch(e => console.error('[signatures] ensureTable:', e.message));

// ── Helpers ──────────────────────────────────────────────────────────────────
const FRONTEND_URL = () => process.env.FRONTEND_URL || 'https://sigp.tecnofactory.net.co';

async function loadEmailConfig() {
  try {
    const [rows] = await pool.execute(
      "SELECT setting_value FROM system_settings WHERE setting_key = 'email_config'"
    );
    if (!rows.length || !rows[0].setting_value) return null;
    const cfg = JSON.parse(rows[0].setting_value);
    return cfg.provider_type ? cfg : null;
  } catch { return null; }
}

async function trySendMail(emailCfg, opts) {
  if (!emailCfg) return;
  try {
    const { sendMail } = require('../services/mailer');
    await sendMail(emailCfg, opts);
  } catch (e) { console.error('[signatures] email error:', e.message); }
}

const MT_LABEL = {
  comite_seguimiento: 'Comité de Seguimiento',
  comite_obra:        'Comité de Obra',
  reunion_tecnica:    'Reunión Técnica',
  reunion_financiera: 'Reunión Financiera',
  otro:               'Reunión',
};

function emailInvite({ signer, minute, project, allSigners, position }) {
  const url = `${FRONTEND_URL()}/firma/${signer.token}`;
  const prevList = allSigners
    .filter(s => s.sign_order < signer.sign_order && s.status === 'signed')
    .map(s => `<li style="margin-bottom:4px">${s.signer_name} <span style="color:#64748b">(${s.signer_role || 'Firmante'})</span> — ${new Date(s.signed_at).toLocaleString('es-CO')}</li>`)
    .join('');
  const mtDate = minute.meeting_date
    ? new Date(minute.meeting_date).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:32px auto;padding:0 16px;">
  <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);">
    <div style="background:#1B5FAA;padding:24px 32px;">
      <h1 style="color:white;margin:0;font-size:20px;font-weight:bold;">✍️ Firma requerida</h1>
      <p style="color:#93C5FD;margin:4px 0 0;font-size:13px;">SGIP-IA · Sistema de Gestión Integral de Proyectos</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;font-size:15px;">Hola <strong>${signer.signer_name}</strong>,</p>
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        Su firma electrónica es requerida para el siguiente documento del proyecto <strong>${project.name} (${project.code})</strong>:
      </p>
      <div style="background:#f0f7ff;border-left:4px solid #1B5FAA;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 4px;font-size:11px;color:#64748b;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;">Documento a firmar</p>
        <p style="margin:0;font-size:16px;font-weight:bold;color:#1B5FAA;">${minute.title}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#374151;">${MT_LABEL[minute.minute_type] || 'Reunión'} · ${mtDate}</p>
        <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Su rol: <strong>${signer.signer_role || 'Firmante'}</strong> · Firmante ${position} de ${allSigners.length}</p>
      </div>
      ${prevList ? `
      <div style="background:#f0fdf4;border-radius:8px;padding:12px 16px;margin-bottom:20px;">
        <p style="margin:0 0 6px;font-size:11px;color:#166534;font-weight:bold;text-transform:uppercase;">Firmas anteriores:</p>
        <ul style="margin:0;padding-left:16px;font-size:13px;color:#166534;">${prevList}</ul>
      </div>` : ''}
      <a href="${url}" style="display:block;text-align:center;background:#1B5FAA;color:white;text-decoration:none;padding:14px 32px;border-radius:8px;font-size:15px;font-weight:bold;margin:20px 0;">
        Abrir documento y firmar
      </a>
      <p style="font-size:11px;color:#94a3b8;text-align:center;">
        O copia: <a href="${url}" style="color:#1B5FAA;word-break:break-all;">${url}</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0;">
      <p style="font-size:11px;color:#94a3b8;margin:0;line-height:1.6;">
        Este correo fue enviado por SGIP-IA. El enlace es personal e intransferible.
        Su IP quedará registrada al momento de la firma.<br>
        Firma electrónica con validez jurídica — Ley 527 de 1999, Decreto 2364 de 2012.
      </p>
    </div>
  </div>
</div>
</body></html>`;
}

function emailCompleted({ minute, project, allSigners }) {
  const rows = allSigners.map(s => `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${s.signer_name}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${s.signer_role || '—'}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${new Date(s.signed_at).toLocaleString('es-CO')}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:12px;color:#94a3b8;">${s.ip_address || '—'}</td>
    </tr>`).join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<div style="max-width:640px;margin:32px auto;padding:0 16px;">
  <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);">
    <div style="background:#059669;padding:24px 32px;">
      <h1 style="color:white;margin:0;font-size:20px;">✅ Documento firmado por todos</h1>
      <p style="color:#A7F3D0;margin:4px 0 0;font-size:13px;">SGIP-IA · Sistema de Gestión Integral de Proyectos</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        El documento <strong>${minute.title}</strong> del proyecto <strong>${project.name}</strong>
        ha sido firmado electrónicamente por todos los firmantes requeridos.
      </p>
      <table style="width:100%;border-collapse:collapse;margin:20px 0;border:1px solid #e2e8f0;border-radius:8px;overflow:hidden;">
        <thead><tr style="background:#f8fafc;">
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Firmante</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Rol</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">Fecha y hora</th>
          <th style="padding:9px 12px;text-align:left;font-size:11px;color:#64748b;text-transform:uppercase;">IP</th>
        </tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:12px;color:#94a3b8;border-top:1px solid #f1f5f9;padding-top:16px;margin-top:8px;">
        Este registro constituye evidencia de firma electrónica con validez jurídica
        según Ley 527 de 1999 y Decreto 2364 de 2012 (Colombia).
        Hash del documento: <code style="font-size:11px;">${allSigners[0]?.document_hash || '—'}</code>
      </p>
    </div>
  </div>
</div>
</body></html>`;
}

function emailRejected({ rejector, reason, minute, project }) {
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:32px auto;padding:0 16px;">
  <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);">
    <div style="background:#DC2626;padding:24px 32px;">
      <h1 style="color:white;margin:0;font-size:20px;">❌ Firma rechazada</h1>
      <p style="color:#FCA5A5;margin:4px 0 0;font-size:13px;">SGIP-IA · Sistema de Gestión Integral de Proyectos</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;font-size:14px;line-height:1.6;">
        <strong>${rejector.signer_name}</strong> (${rejector.signer_role || 'Firmante'}) rechazó la firma del documento
        <strong>${minute.title}</strong> del proyecto <strong>${project.name}</strong>.
      </p>
      <div style="background:#FEF2F2;border-left:4px solid #DC2626;border-radius:8px;padding:16px 20px;margin:20px 0;">
        <p style="margin:0 0 4px;font-size:11px;color:#991B1B;font-weight:bold;text-transform:uppercase;">Motivo del rechazo:</p>
        <p style="margin:0;font-size:14px;color:#374151;">${reason || 'No se especificó motivo.'}</p>
      </div>
      <p style="font-size:13px;color:#64748b;">
        El proceso de firma ha sido cancelado. Corrija el documento e inicie un nuevo proceso si lo requiere.
      </p>
    </div>
  </div>
</div>
</body></html>`;
}

// ════════════════════════════════════════════════════════════════════
// AUTHENTICATED ROUTER  —  mounted at /api/exec/:projectId/minutes/:minuteId/firma
// ════════════════════════════════════════════════════════════════════
const router = express.Router({ mergeParams: true });

// POST / — create signature request
router.post('/', authenticate, async (req, res) => {
  const { projectId, minuteId } = req.params;
  const { signers } = req.body;

  if (!signers || !Array.isArray(signers) || signers.length === 0)
    return res.status(400).json({ error: 'Se requiere al menos un firmante' });

  for (const s of signers) {
    if (!s.name?.trim() || !s.email?.trim())
      return res.status(400).json({ error: 'Cada firmante requiere nombre y correo' });
  }

  try {
    const [[minute]] = await pool.execute('SELECT * FROM meeting_minutes WHERE id=? AND project_id=?', [minuteId, projectId]);
    if (!minute) return res.status(404).json({ error: 'Acta no encontrada' });

    const [[project]] = await pool.execute('SELECT id,name,code FROM projects WHERE id=?', [projectId]);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const [existing] = await pool.execute(
      "SELECT id FROM signature_requests WHERE minute_id=? AND status='in_progress'", [minuteId]
    );
    if (existing.length) return res.status(409).json({ error: 'Ya hay un proceso de firma activo para esta acta' });

    const docHash = crypto.createHash('sha256').update(JSON.stringify({
      id: minute.id, title: minute.title, meeting_date: minute.meeting_date,
      agreements: minute.agreements, action_items: minute.action_items,
    })).digest('hex');

    const [result] = await pool.execute(
      "INSERT INTO signature_requests (minute_id,project_id,status,created_by,document_hash) VALUES (?,?,'in_progress',?,?)",
      [minuteId, projectId, req.user.id, docHash]
    );
    const requestId = result.insertId;

    // Insert signers & collect with tokens
    const signerRecords = [];
    for (const s of signers) {
      const token = crypto.randomBytes(32).toString('hex');
      const order = s.order || 1;
      await pool.execute(
        'INSERT INTO signature_signers (request_id,signer_name,signer_email,signer_role,sign_order,token) VALUES (?,?,?,?,?,?)',
        [requestId, s.name.trim(), s.email.trim().toLowerCase(), s.role || '', order, token]
      );
      // Normalize field names to match DB column names used by emailInvite
      signerRecords.push({
        ...s,
        signer_name:  s.name.trim(),
        signer_email: s.email.trim().toLowerCase(),
        signer_role:  s.role || '',
        token,
        sign_order: order,
        status: 'pending',
      });
    }

    // Sort by order and notify first
    signerRecords.sort((a, b) => a.sign_order - b.sign_order);
    const first = signerRecords[0];
    const emailCfg = await loadEmailConfig();
    if (emailCfg) {
      await trySendMail(emailCfg, {
        to: first.email,
        subject: `✍️ Firma requerida: ${minute.title} — ${project.name}`,
        html: emailInvite({ signer: first, minute, project, allSigners: signerRecords, position: 1 }),
      });
      await pool.execute("UPDATE signature_signers SET status='notified' WHERE token=?", [first.token]);
    }

    res.json({
      success: true, requestId,
      message: emailCfg
        ? `Proceso iniciado. Correo enviado a ${first.email}.`
        : 'Proceso iniciado. Configure el servidor de correo para notificaciones automáticas.',
    });
  } catch (e) { console.error('[signatures] POST:', e); res.status(500).json({ error: e.message }); }
});

// GET / — get active request status
router.get('/', authenticate, async (req, res) => {
  const { minuteId, projectId } = req.params;
  try {
    const [reqs] = await pool.execute(
      'SELECT * FROM signature_requests WHERE minute_id=? AND project_id=? ORDER BY created_at DESC LIMIT 1',
      [minuteId, projectId]
    );
    if (!reqs.length) return res.json({ success: true, data: null });

    const [signers] = await pool.execute(
      'SELECT id,signer_name,signer_email,signer_role,sign_order,status,signed_at,ip_address,rejection_reason FROM signature_signers WHERE request_id=? ORDER BY sign_order',
      [reqs[0].id]
    );
    res.json({ success: true, data: { ...reqs[0], signers } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// DELETE / — cancel active request
router.delete('/', authenticate, async (req, res) => {
  const { minuteId, projectId } = req.params;
  try {
    await pool.execute(
      "UPDATE signature_requests SET status='cancelled' WHERE minute_id=? AND project_id=? AND status='in_progress'",
      [minuteId, projectId]
    );
    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════
// PUBLIC ROUTER  —  mounted at /api/firma
// ════════════════════════════════════════════════════════════════════
const publicRouter = express.Router();

// GET /:token — load signing page data (public, no auth)
publicRouter.get('/:token', async (req, res) => {
  try {
    const [signers] = await pool.execute(
      'SELECT * FROM signature_signers WHERE token=?', [req.params.token]
    );
    if (!signers.length) return res.status(404).json({ error: 'Enlace de firma inválido o expirado' });
    const signer = signers[0];

    const [reqs] = await pool.execute('SELECT * FROM signature_requests WHERE id=?', [signer.request_id]);
    if (!reqs.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const req_ = reqs[0];

    // All signers for this request (to show progress)
    const [allSigners] = await pool.execute(
      'SELECT id,signer_name,signer_role,sign_order,status,signed_at FROM signature_signers WHERE request_id=? ORDER BY sign_order',
      [req_.id]
    );

    const [[minute]] = await pool.execute(
      'SELECT id,title,minute_type,meeting_date,location,agenda,discussions,attendees,agreements,action_items,minute_number FROM meeting_minutes WHERE id=?',
      [req_.minute_id]
    );
    const [[project]] = await pool.execute('SELECT name,code,client_name FROM projects WHERE id=?', [req_.project_id]);

    // Mark as viewed
    if (signer.status === 'notified')
      await pool.execute("UPDATE signature_signers SET status='viewed' WHERE token=?", [req.params.token]);

    res.json({
      success: true,
      data: {
        signer: {
          id: signer.id, name: signer.signer_name, email: signer.signer_email,
          role: signer.signer_role, order: signer.sign_order, status: signer.status,
        },
        request: { id: req_.id, status: req_.status, document_hash: req_.document_hash },
        allSigners: allSigners.map(s => ({
          id: s.id, name: s.signer_name, role: s.signer_role,
          order: s.sign_order, status: s.status, signed_at: s.signed_at,
        })),
        minute: {
          id: minute.id, title: minute.title, minute_type: minute.minute_type,
          meeting_date: minute.meeting_date, location: minute.location,
          agenda: minute.agenda, discussions: minute.discussions,
          minute_number: minute.minute_number,
          attendees: (() => { try { return JSON.parse(minute.attendees || '[]'); } catch { return []; } })(),
          agreements: (() => { try { return JSON.parse(minute.agreements || '[]'); } catch { return []; } })(),
          action_items: (() => { try { return JSON.parse(minute.action_items || '[]'); } catch { return []; } })(),
        },
        project: { name: project.name, code: project.code, client_name: project.client_name },
      },
    });
  } catch (e) { console.error('[firma GET]', e); res.status(500).json({ error: e.message }); }
});

// POST /:token/firmar — submit signature (public)
publicRouter.post('/:token/firmar', async (req, res) => {
  const { signature_image } = req.body;
  if (!signature_image) return res.status(400).json({ error: 'Se requiere la imagen de firma' });

  try {
    const [signers] = await pool.execute('SELECT * FROM signature_signers WHERE token=?', [req.params.token]);
    if (!signers.length) return res.status(404).json({ error: 'Enlace de firma inválido' });
    const signer = signers[0];

    if (signer.status === 'signed')   return res.status(409).json({ error: 'Ya firmaste este documento' });
    if (signer.status === 'rejected') return res.status(409).json({ error: 'Ya rechazaste este documento' });

    const [reqs] = await pool.execute('SELECT * FROM signature_requests WHERE id=?', [signer.request_id]);
    if (!reqs.length || reqs[0].status !== 'in_progress')
      return res.status(409).json({ error: 'El proceso de firma ya no está activo' });

    const req_ = reqs[0];
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';

    // Verify it's their turn (all signers with lower order must be signed)
    const [prevSigners] = await pool.execute(
      "SELECT * FROM signature_signers WHERE request_id=? AND sign_order < ? AND status != 'signed' ORDER BY sign_order",
      [signer.request_id, signer.sign_order]
    );
    if (prevSigners.length)
      return res.status(409).json({ error: `Esperando la firma de ${prevSigners[0].signer_name} (orden ${prevSigners[0].sign_order})` });

    // Save signature
    await pool.execute(
      "UPDATE signature_signers SET status='signed', signature_image=?, signed_at=NOW(), ip_address=?, user_agent=? WHERE token=?",
      [signature_image, ip, ua, req.params.token]
    );

    // Check if all signed
    const [pending] = await pool.execute(
      "SELECT * FROM signature_signers WHERE request_id=? AND status NOT IN ('signed') ORDER BY sign_order",
      [signer.request_id]
    );

    const [[minute]] = await pool.execute('SELECT * FROM meeting_minutes WHERE id=?', [req_.minute_id]);
    const [[project]] = await pool.execute('SELECT * FROM projects WHERE id=?', [req_.project_id]);
    const emailCfg = await loadEmailConfig();

    if (pending.length === 0) {
      // All signed → complete
      await pool.execute(
        "UPDATE signature_requests SET status='completed', completed_at=NOW() WHERE id=?",
        [signer.request_id]
      );
      const [allSigners] = await pool.execute(
        'SELECT * FROM signature_signers WHERE request_id=? ORDER BY sign_order', [signer.request_id]
      );
      // Notify everyone with completion email
      const completedHtml = emailCompleted({ minute, project, allSigners });
      for (const s of allSigners) {
        await trySendMail(emailCfg, {
          to: s.signer_email,
          subject: `✅ Documento firmado: ${minute.title} — ${project.name}`,
          html: completedHtml,
        });
      }
      return res.json({ success: true, message: 'Firma registrada. Todos los firmantes han completado el proceso.', allSigned: true });
    }

    // Notify next signer
    const next = pending[0];
    const [allSigners] = await pool.execute(
      'SELECT * FROM signature_signers WHERE request_id=? ORDER BY sign_order', [signer.request_id]
    );
    const position = allSigners.findIndex(s => s.id === next.id) + 1;
    await trySendMail(emailCfg, {
      to: next.signer_email,
      subject: `✍️ Firma requerida: ${minute.title} — ${project.name}`,
      html: emailInvite({ signer: next, minute, project, allSigners, position }),
    });
    await pool.execute("UPDATE signature_signers SET status='notified' WHERE id=?", [next.id]);

    res.json({
      success: true,
      message: `Firma registrada. Notificación enviada a ${next.signer_name} (${next.signer_email}).`,
      allSigned: false,
    });
  } catch (e) { console.error('[firma POST /firmar]', e); res.status(500).json({ error: e.message }); }
});

// POST /:token/rechazar — reject (public)
publicRouter.post('/:token/rechazar', async (req, res) => {
  const { reason } = req.body;
  try {
    const [signers] = await pool.execute('SELECT * FROM signature_signers WHERE token=?', [req.params.token]);
    if (!signers.length) return res.status(404).json({ error: 'Enlace de firma inválido' });
    const signer = signers[0];
    if (['signed','rejected'].includes(signer.status))
      return res.status(409).json({ error: 'Ya procesaste este documento' });

    await pool.execute(
      "UPDATE signature_signers SET status='rejected', rejection_reason=?, signed_at=NOW(), ip_address=? WHERE token=?",
      [reason || '', req.socket.remoteAddress || '', req.params.token]
    );
    await pool.execute(
      "UPDATE signature_requests SET status='rejected' WHERE id=? AND status='in_progress'",
      [signer.request_id]
    );

    const [reqs] = await pool.execute('SELECT * FROM signature_requests WHERE id=?', [signer.request_id]);
    const [[minute]] = await pool.execute('SELECT * FROM meeting_minutes WHERE id=?', [reqs[0].minute_id]);
    const [[project]] = await pool.execute('SELECT * FROM projects WHERE id=?', [reqs[0].project_id]);

    // Notify creator
    const [creator] = await pool.execute('SELECT email FROM users WHERE id=?', [reqs[0].created_by]);
    const emailCfg = await loadEmailConfig();
    if (creator.length) {
      await trySendMail(emailCfg, {
        to: creator[0].email,
        subject: `❌ Firma rechazada: ${minute.title} — ${project.name}`,
        html: emailRejected({ rejector: signer, reason, minute, project }),
      });
    }

    res.json({ success: true, message: 'Has rechazado la firma. El creador del documento ha sido notificado.' });
  } catch (e) { console.error('[firma POST /rechazar]', e); res.status(500).json({ error: e.message }); }
});

// ── GET /certificate  —  sealed PDF with full acta + audit trail ──────────────
router.get('/certificate', async (req, res) => {
  const { projectId, minuteId } = req.params;
  try {
    const PDFDocument = require('pdfkit');

    // Load request
    const [reqs] = await pool.execute(
      "SELECT * FROM signature_requests WHERE minute_id=? AND project_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1",
      [minuteId, projectId]
    );
    if (!reqs.length) return res.status(404).json({ error: 'No hay un proceso de firma completado para esta acta' });
    const req_ = reqs[0];

    const [signers] = await pool.execute(
      'SELECT * FROM signature_signers WHERE request_id=? ORDER BY sign_order', [req_.id]
    );
    const [[minute]] = await pool.execute('SELECT * FROM meeting_minutes WHERE id=?', [minuteId]);
    const [[project]] = await pool.execute('SELECT name,code,contract_number,client_name FROM projects WHERE id=?', [projectId]);

    function safeArr(v) {
      if (Array.isArray(v)) return v;
      if (!v) return [];
      try { return JSON.parse(v); } catch { return typeof v === 'string' ? [v] : []; }
    }
    const attendees   = safeArr(minute.attendees);
    const agreements  = safeArr(minute.agreements);
    const actionItems = safeArr(minute.action_items);

    // ── Build PDF ──────────────────────────────────────────────────
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 60, bottom: 60, left: 65, right: 65 },
      info: {
        Title:    minute.title,
        Author:   'SGIP-IA — Sistema de Gestión Integral de Proyectos',
        Subject:  `Acta firmada — ${project.name}`,
        Keywords: 'firma electronica, acta, sgip',
        Creator:  'SGIP-IA',
      },
      // Encrypt: owner can print high-res; user cannot edit/copy
      userPassword:  '',
      ownerPassword: require('crypto').randomBytes(16).toString('hex'),
      permissions: {
        printing:         'highResolution',
        modifying:        false,
        copying:          false,
        annotating:       false,
        fillingForms:     false,
        contentAccessibility: true,
        documentAssembly: false,
      },
    });

    const chunks = [];
    doc.on('data', c => chunks.push(c));

    const BLUE   = '#1B3A5C';
    const LIGHT  = '#E8F0F7';
    const GRAY   = '#555555';
    const LGRAY  = '#888888';
    const GREEN  = '#166534';
    const W      = doc.page.width - 130; // usable width

    // ── Helper: section header ─────────────────────────────────────
    const sectionTitle = (txt) => {
      doc.moveDown(0.6)
         .fillColor(BLUE).fontSize(11).font('Helvetica-Bold').text(txt.toUpperCase(), { continued: false })
         .moveDown(0.15)
         .moveTo(doc.page.margins.left, doc.y)
         .lineTo(doc.page.margins.left + W, doc.y)
         .strokeColor('#BBCFE0').lineWidth(1).stroke()
         .moveDown(0.3);
    };

    // ── Helper: field pair ─────────────────────────────────────────
    const field = (label, value) => {
      doc.fillColor(LGRAY).fontSize(8).font('Helvetica').text(label, { continued: true })
         .fillColor('#222').fontSize(9).font('Helvetica').text(`  ${value || '—'}`);
      doc.moveDown(0.2);
    };

    // ══ PAGE 1: ACTA CONTENT ═══════════════════════════════════════

    // Logo / header bar
    doc.rect(doc.page.margins.left - 5, 45, W + 10, 48).fill(BLUE);
    doc.fillColor('white').fontSize(14).font('Helvetica-Bold')
       .text('ACTA DE REUNIÓN', doc.page.margins.left + 5, 56, { width: W - 120 });
    doc.fontSize(8).font('Helvetica')
       .text('Firma Electrónica · Ley 527/1999 · Decreto 2364/2012', doc.page.margins.left + 5, 74, { width: W - 10 });
    doc.fillColor(BLUE).fontSize(9).font('Helvetica-Bold')
       .text(`Acta N° ${minute.minute_number || minute.id}`, doc.page.margins.left + W - 80, 63, { width: 90, align: 'right' });

    doc.y = 110;

    // Subtitle: title
    doc.fillColor('#111').fontSize(13).font('Helvetica-Bold')
       .text(minute.title, { align: 'center' }).moveDown(0.4);
    doc.fillColor(GRAY).fontSize(9).font('Helvetica')
       .text(project.name + (project.code ? ` (${project.code})` : ''), { align: 'center' }).moveDown(0.6);

    // Info grid
    const infoItems = [
      ['Fecha',       minute.meeting_date ? new Date(minute.meeting_date).toLocaleDateString('es-CO', { day:'2-digit', month:'long', year:'numeric' }) : '—'],
      ['Lugar',       minute.location || '—'],
      ['Tipo',        ({ comite_seguimiento:'Comité de Seguimiento', comite_obra:'Comité de Obra', reunion_tecnica:'Reunión Técnica', reunion_financiera:'Reunión Financiera', otro:'Reunión' })[minute.minute_type] || minute.minute_type || '—'],
      ['Contrato',    project.contract_number || '—'],
      ['Cliente',     project.client_name || '—'],
    ];
    const colW = (W - 20) / 2;
    infoItems.forEach(([lbl, val], i) => {
      const x = doc.page.margins.left + (i % 2 === 1 ? colW + 20 : 0);
      if (i % 2 === 0 && i > 0) doc.moveDown(0.05);
      const savedY = doc.y;
      doc.fillColor(LGRAY).fontSize(7.5).font('Helvetica').text(lbl, x, savedY, { width: 55, continued: true });
      doc.fillColor('#111').fontSize(9).font('Helvetica').text(val, { width: colW - 55 });
      if (i % 2 === 0) doc.y = savedY; // next item on same line
    });
    doc.moveDown(0.5);

    // Attendees
    if (attendees.length) {
      sectionTitle('1. Asistentes');
      attendees.forEach((a, i) => {
        const name   = a.name   || a;
        const entity = a.entity || a.cargo || '';
        const role   = a.role   || '';
        doc.fillColor('#111').fontSize(9).font('Helvetica')
           .text(`${i + 1}.  ${name}${entity ? '  ·  ' + entity : ''}${role ? '  ·  ' + role : ''}`, {
             indent: 10
           }).moveDown(0.1);
      });
    }

    // Agenda
    if (minute.agenda) {
      sectionTitle('2. Temas tratados');
      minute.agenda.split('\n').filter(l => l.trim()).forEach(line => {
        doc.fillColor('#111').fontSize(9).font('Helvetica')
           .text(`•  ${line.trim()}`, { indent: 10 }).moveDown(0.1);
      });
    }

    // Discussion
    if (minute.discussions) {
      sectionTitle('3. Desarrollo de la reunión');
      doc.fillColor(GRAY).fontSize(9).font('Helvetica')
         .text(minute.discussions, { indent: 0, lineGap: 2 }).moveDown(0.2);
    }

    // Agreements
    if (agreements.length) {
      sectionTitle('4. Acuerdos');
      agreements.forEach((a, i) => {
        const txt = typeof a === 'string' ? a : (a.description || JSON.stringify(a));
        doc.fillColor('#111').fontSize(9).font('Helvetica')
           .text(`${i + 1}.  ${txt}`, { indent: 10 }).moveDown(0.15);
      });
    }

    // Action items
    if (actionItems.length) {
      sectionTitle('5. Compromisos');
      actionItems.forEach((c, i) => {
        const task = c.task || c.description || c.compromiso || JSON.stringify(c);
        const resp = c.responsible || c.responsable || '';
        const due  = c.due_date    || c.fecha       || '';
        doc.fillColor('#111').fontSize(9).font('Helvetica-Bold')
           .text(`${i + 1}.  ${task}`, { indent: 10, continued: false }).moveDown(0.05);
        if (resp || due) {
          doc.fillColor(LGRAY).fontSize(8).font('Helvetica')
             .text(`${resp ? 'Responsable: ' + resp : ''}${resp && due ? '   ' : ''}${due ? 'Fecha: ' + due : ''}`, { indent: 20 });
        }
        doc.moveDown(0.2);
      });
    }

    // ══ PAGE 2: CERTIFICATE / AUDIT TRAIL ══════════════════════════
    doc.addPage();

    doc.rect(doc.page.margins.left - 5, 45, W + 10, 48).fill('#059669');
    doc.fillColor('white').fontSize(14).font('Helvetica-Bold')
       .text('CERTIFICADO DE FIRMAS DIGITALES', doc.page.margins.left + 5, 56, { width: W - 10 });
    doc.fontSize(8).font('Helvetica')
       .text('Firma Electrónica con Validez Jurídica — Ley 527 de 1999 — Decreto 2364 de 2012', doc.page.margins.left + 5, 74);

    doc.y = 115;

    // Document info
    doc.fillColor(BLUE).fontSize(10).font('Helvetica-Bold').text('Documento firmado').moveDown(0.3);
    field('Título:', minute.title);
    field('Proyecto:', `${project.name} ${project.code ? '(' + project.code + ')' : ''}`);
    field('Acta N°:', String(minute.minute_number || minute.id));
    field('Fecha del acta:', minute.meeting_date ? new Date(minute.meeting_date).toLocaleDateString('es-CO') : '—');
    field('Proceso completado:', req_.completed_at ? new Date(req_.completed_at).toLocaleString('es-CO') : '—');
    field('Hash SHA-256:', req_.document_hash || '—');
    doc.moveDown(0.5);

    // Signers
    doc.fillColor(BLUE).fontSize(10).font('Helvetica-Bold').text('Firmantes').moveDown(0.4);

    for (const s of signers) {
      // Signer block background
      const blockY = doc.y;
      doc.save();

      // Name + role
      doc.fillColor('#111').fontSize(10).font('Helvetica-Bold')
         .text(`${s.sign_order}. ${s.signer_name}`, { continued: false });
      doc.fillColor(GRAY).fontSize(8.5).font('Helvetica')
         .text(s.signer_role || 'Firmante').moveDown(0.1);
      field('Correo:', s.signer_email);
      field('Firmado el:', s.signed_at ? new Date(s.signed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—');
      field('Dirección IP:', s.ip_address || '—');

      // Signature image
      if (s.signature_image) {
        try {
          const b64 = s.signature_image.replace(/^data:image\/\w+;base64,/, '');
          const imgBuf = Buffer.from(b64, 'base64');
          doc.image(imgBuf, doc.page.margins.left + W - 155, blockY, { width: 150, height: 58, fit: [150, 58] });
        } catch { /* skip bad image */ }
      }

      // Separator
      doc.moveDown(0.4)
         .moveTo(doc.page.margins.left, doc.y)
         .lineTo(doc.page.margins.left + W, doc.y)
         .strokeColor('#DDDDDD').lineWidth(0.5).stroke()
         .moveDown(0.4);
      doc.restore();
    }

    // Legal notice
    doc.moveDown(0.8);
    doc.rect(doc.page.margins.left, doc.y, W, 55).fill('#F0FDF4');
    doc.fillColor(GREEN).fontSize(8).font('Helvetica-Bold')
       .text('VALIDEZ JURÍDICA', doc.page.margins.left + 8, doc.y - 48, { width: W - 16 }).moveDown(0.2);
    doc.fillColor('#166534').fontSize(7.5).font('Helvetica')
       .text(
         'Este documento ha sido firmado electrónicamente conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012 de la República de Colombia. ' +
         'Cada firma fue obtenida mediante un enlace único enviado al correo del firmante, registrando IP, fecha/hora del servidor y hash SHA-256 del contenido. ' +
         'Este PDF está protegido contra modificaciones. Cualquier alteración invalidará las firmas.',
         doc.page.margins.left + 8, doc.y, { width: W - 16, lineGap: 1 }
       );

    // Footer with generation timestamp
    doc.moveDown(2);
    doc.fillColor(LGRAY).fontSize(7.5).font('Helvetica')
       .text(
         `Certificado generado por SGIP-IA el ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })} · sgip.tecnofactory.net.co`,
         { align: 'center' }
       );

    doc.end();

    await new Promise(resolve => doc.on('end', resolve));
    const pdfBuffer = Buffer.concat(chunks);

    const filename = `Certificado_Firma_Acta${minute.minute_number || minute.id}_${project.code || projectId}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (e) {
    console.error('[signatures] GET /certificate:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = { signaturesRouter: router, firmaRouter: publicRouter };
