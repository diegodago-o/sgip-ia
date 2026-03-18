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
    .map(s => `<li style="margin-bottom:4px">${s.signer_name} <span style="color:#64748b">(${s.signer_role || 'Firmante'})</span> — ${new Date(s.signed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</li>`)
    .join('');
  const mtDate = minute.meeting_date
    ? new Date(minute.meeting_date).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
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
        Firma electrónica con validez jurídica — Ley 527 de 1999, Decreto 1074 de 2015.
      </p>
    </div>
  </div>
</div>
</body></html>`;
}

function emailCompleted({ minute, project, allSigners, documentHash }) {
  const rows = allSigners.map(s => `
    <tr>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${s.signer_name}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;color:#64748b;">${s.signer_role || '—'}</td>
      <td style="padding:9px 12px;border-bottom:1px solid #f1f5f9;font-size:13px;">${s.signed_at ? new Date(s.signed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '—'}</td>
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
        según Ley 527 de 1999 y Decreto 1074 de 2015 (Colombia).
        Hash del documento: <code style="font-size:11px;">${documentHash || '—'}</code>
      </p>
    </div>
  </div>
</div>
</body></html>`;
}

function emailCancelled({ cancelledBy, reason, minute, project, type, recipient }) {
  const isRejection = type === 'rejected';
  const headerColor = isRejection ? '#DC2626' : '#64748b';
  const headerLight = isRejection ? '#FCA5A5' : '#CBD5E1';
  const icon        = isRejection ? '❌' : '🚫';
  const title       = isRejection ? 'Proceso cancelado — firma rechazada' : 'Proceso de firmas cancelado';
  const body = isRejection
    ? `<strong>${cancelledBy}</strong> rechazó la firma del documento <strong>${minute.title}</strong>
       del proyecto <strong>${project.name}</strong>, por lo que el proceso de firmas ha sido cancelado.`
    : `El proceso de firmas del documento <strong>${minute.title}</strong>
       del proyecto <strong>${project.name}</strong> ha sido cancelado por el administrador.`;
  const reasonBlock = reason
    ? `<div style="background:#FEF2F2;border-left:4px solid ${headerColor};border-radius:8px;padding:16px 20px;margin:20px 0;">
         <p style="margin:0 0 4px;font-size:11px;color:#991B1B;font-weight:bold;text-transform:uppercase;">Motivo:</p>
         <p style="margin:0;font-size:14px;color:#374151;">${reason}</p>
       </div>`
    : '';
  return `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:Arial,sans-serif;">
<div style="max-width:600px;margin:32px auto;padding:0 16px;">
  <div style="background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 4px rgba(0,0,0,.1);">
    <div style="background:${headerColor};padding:24px 32px;">
      <h1 style="color:white;margin:0;font-size:20px;">${icon} ${title}</h1>
      <p style="color:${headerLight};margin:4px 0 0;font-size:13px;">SGIP-IA · Sistema de Gestión Integral de Proyectos</p>
    </div>
    <div style="padding:32px;">
      <p style="color:#374151;font-size:14px;line-height:1.6;">${body}</p>
      ${reasonBlock}
      <p style="font-size:13px;color:#64748b;">
        No se requiere ninguna acción de su parte. Si tiene preguntas, comuníquese con el responsable del proyecto.
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
    // Fetch before cancelling so we can notify
    const [reqs] = await pool.execute(
      "SELECT * FROM signature_requests WHERE minute_id=? AND project_id=? AND status='in_progress'",
      [minuteId, projectId]
    );

    await pool.execute(
      "UPDATE signature_requests SET status='cancelled' WHERE minute_id=? AND project_id=? AND status='in_progress'",
      [minuteId, projectId]
    );

    if (reqs.length) {
      const req_ = reqs[0];
      const [[minute]]  = await pool.execute('SELECT id,title FROM meeting_minutes WHERE id=?', [req_.minute_id]);
      const [[project]] = await pool.execute('SELECT name,code FROM projects WHERE id=?', [req_.project_id]);
      const [signers]   = await pool.execute(
        'SELECT * FROM signature_signers WHERE request_id=? ORDER BY sign_order', [req_.id]
      );
      const emailCfg = await loadEmailConfig();
      const cancelHtml = emailCancelled({ minute, project, type: 'cancelled' });
      for (const s of signers) {
        await trySendMail(emailCfg, {
          to: s.signer_email,
          subject: `🚫 Proceso cancelado: ${minute.title} — ${project.name}`,
          html: cancelHtml,
        });
      }
    }

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

    function safeArrStr(v) {
      if (Array.isArray(v)) return v;
      if (!v) return [];
      try { return JSON.parse(v); } catch { return typeof v === 'string' ? [v] : []; }
    }
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
          attendees:    safeArrStr(minute.attendees),
          agreements:   safeArrStr(minute.agreements),
          action_items: safeArrStr(minute.action_items),
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
      // Reload request to get completed_at
      const [[completedReq]] = await pool.execute(
        'SELECT * FROM signature_requests WHERE id=?', [signer.request_id]
      );
      // Generate PDF certificate to attach
      let pdfAttachment = null;
      try {
        const pdfBuf = await buildCertificatePdf(completedReq, allSigners, minute, project);
        const pdfName = `Certificado_Firma_Acta${minute.minute_number || minute.id}_${project.code || req_.project_id}.pdf`;
        pdfAttachment = [{ filename: pdfName, content: pdfBuf, contentType: 'application/pdf' }];
      } catch (pdfErr) {
        console.error('[signatures] PDF generation for email failed:', pdfErr.message);
      }
      // Notify everyone with completion email + PDF attached
      const completedHtml = emailCompleted({ minute, project, allSigners, documentHash: completedReq.document_hash });
      for (const s of allSigners) {
        await trySendMail(emailCfg, {
          to: s.signer_email,
          subject: `✅ Documento firmado: ${minute.title} — ${project.name}`,
          html: completedHtml,
          attachments: pdfAttachment,
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

    const [allSigners] = await pool.execute(
      'SELECT * FROM signature_signers WHERE request_id=? ORDER BY sign_order', [signer.request_id]
    );
    const emailCfg = await loadEmailConfig();

    // Notify creator
    const [creator] = await pool.execute('SELECT email,name FROM users WHERE id=?', [reqs[0].created_by]);
    if (creator.length) {
      await trySendMail(emailCfg, {
        to: creator[0].email,
        subject: `❌ Firma rechazada: ${minute.title} — ${project.name}`,
        html: emailRejected({ rejector: signer, reason, minute, project }),
      });
    }

    // Notify all other signers (who haven't already rejected)
    const cancelledHtml = emailCancelled({
      cancelledBy: signer.signer_name, reason, minute, project, type: 'rejected',
    });
    for (const s of allSigners) {
      if (s.id === signer.id) continue; // skip the rejector
      await trySendMail(emailCfg, {
        to: s.signer_email,
        subject: `🚫 Proceso cancelado: ${minute.title} — ${project.name}`,
        html: cancelledHtml,
      });
    }

    res.json({ success: true, message: 'Has rechazado la firma. El creador del documento y los demás firmantes han sido notificados.' });
  } catch (e) { console.error('[firma POST /rechazar]', e); res.status(500).json({ error: e.message }); }
});

// ── buildCertificatePdf — generate PDF buffer (reusable) ─────────────────────
async function buildCertificatePdf(req_, signers, minute, project) {
  const PDFDocument = require('pdfkit');

  function safeArr(v) {
      if (Array.isArray(v)) return v;
      if (!v) return [];
      try { return JSON.parse(v); } catch { return typeof v === 'string' ? [v] : []; }
    }
    const attendees   = safeArr(minute.attendees);
    const agreements  = safeArr(minute.agreements);
    const actionItems = safeArr(minute.action_items);

    const MT = {
      comite_seguimiento: 'Comite de Seguimiento', comite_obra: 'Comite de Obra',
      reunion_tecnica: 'Reunion Tecnica', reunion_financiera: 'Reunion Financiera', otro: 'Reunion',
    };

    // PDF setup
    const doc = new PDFDocument({
      size: 'LETTER',
      margins: { top: 55, bottom: 55, left: 60, right: 60 },
      info: {
        Title: minute.title,
        Author: 'SGIP-IA',
        Subject: 'Acta firmada - ' + project.name,
        Creator: 'SGIP-IA',
      },
      userPassword: '',
      ownerPassword: require('crypto').randomBytes(16).toString('hex'),
      permissions: {
        printing: 'highResolution',
        modifying: false,
        copying: false,
        annotating: false,
        fillingForms: false,
        contentAccessibility: true,
        documentAssembly: false,
      },
    });

    const chunks = [];
    doc.on('data', function(c) { chunks.push(c); });

    const ML   = doc.page.margins.left;
    const PW   = doc.page.width;
    const PH   = doc.page.height;
    const MBot = doc.page.margins.bottom;
    const W    = PW - ML - doc.page.margins.right;
    const BLUE = '#1B3A5C';
    const LGR  = '#777777';
    const GRAY = '#444444';
    const GRN  = '#059669';

    // Check if we need a new page
    function checkPage(needed) {
      if (doc.y + needed > PH - MBot) {
        doc.addPage();
      }
    }

    // Draw a colored section header bar, return new Y
    function sectionHdr(label, y, color) {
      color = color || BLUE;
      doc.rect(ML, y, W, 20).fill(color);
      doc.fillColor('white').fontSize(8.5).font('Helvetica-Bold')
         .text(label, ML + 8, y + 5, { width: W - 16, lineBreak: false });
      return y + 26;
    }

    // Draw a thin separator line, return new Y
    function separator(y) {
      doc.moveTo(ML, y).lineTo(ML + W, y).strokeColor('#CCCCCC').lineWidth(0.5).stroke();
      return y + 8;
    }

    // =====================================================
    // PAGE 1 — ACTA CONTENT
    // =====================================================

    // Banner
    doc.rect(ML, 55, W, 38).fill(BLUE);
    doc.fillColor('white').fontSize(15).font('Helvetica-Bold')
       .text('ACTA DE REUNION', ML + 10, 63, { width: W - 100, lineBreak: false });
    doc.fillColor('#93C5FD').fontSize(7.5).font('Helvetica')
       .text('Firma Electronica - Ley 527/1999 - Decreto 1074/2015', ML + 10, 81, { width: W - 100, lineBreak: false });
    // Acta number in banner
    doc.fillColor('white').fontSize(9).font('Helvetica-Bold')
       .text('Acta N ' + (minute.minute_number || minute.id), ML + W - 90, 69, { width: 86, align: 'right', lineBreak: false });

    let y = 106;

    // Title
    doc.fillColor(BLUE).fontSize(12).font('Helvetica-Bold')
       .text(minute.title || 'Acta de Reunion', ML, y, { width: W, align: 'center' });
    y = doc.y + 3;
    doc.fillColor(LGR).fontSize(9).font('Helvetica')
       .text(project.name + (project.code ? ' (' + project.code + ')' : ''), ML, y, { width: W, align: 'center' });
    y = doc.y + 10;

    // Info grid: explicit 2-column layout
    // Each row: left item at ML, right item at ML+W/2
    const half = W / 2 - 6;
    const lw   = 62; // label width
    function infoRow(lbl1, val1, lbl2, val2, startY) {
      // left column
      doc.fillColor(LGR).fontSize(7.5).font('Helvetica')
         .text(lbl1, ML, startY, { width: lw, lineBreak: false });
      doc.fillColor('#111').fontSize(9).font('Helvetica')
         .text(val1 || '-', ML + lw, startY, { width: half - lw });
      const leftH = doc.y;

      // right column - restart at same startY
      if (lbl2) {
        doc.fillColor(LGR).fontSize(7.5).font('Helvetica')
           .text(lbl2, ML + half + 12, startY, { width: lw, lineBreak: false });
        doc.fillColor('#111').fontSize(9).font('Helvetica')
           .text(val2 || '-', ML + half + 12 + lw, startY, { width: half - lw });
      }
      const rightH = doc.y;
      return Math.max(leftH, rightH) + 4;
    }

    const dateStr = minute.meeting_date
      ? new Date(minute.meeting_date).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric', timeZone: 'America/Bogota' })
      : '-';

    y = infoRow('Fecha:', dateStr, 'Lugar:', minute.location || '-', y);
    y = infoRow('Tipo:', MT[minute.minute_type] || minute.minute_type || '-', 'Contrato:', project.contract_number || '-', y);
    y = infoRow('Cliente:', project.client_name || '-', '', '', y);
    y = separator(y + 2);

    // Asistentes
    if (attendees.length) {
      checkPage(40);
      y = sectionHdr('1. ASISTENTES', y);
      attendees.forEach(function(a, i) {
        checkPage(14);
        var name   = a.name   || (typeof a === 'string' ? a : '');
        var entity = a.entity || a.cargo || '';
        var role   = a.role   || '';
        var parts  = [name];
        if (entity) parts.push(entity);
        if (role)   parts.push(role);
        doc.fillColor(GRAY).fontSize(9).font('Helvetica')
           .text((i + 1) + '.  ' + parts.join('  -  '), ML + 8, y, { width: W - 16 });
        y = doc.y + 2;
      });
      y += 4;
    }

    // Agenda
    if (minute.agenda) {
      checkPage(40);
      y = sectionHdr('2. TEMAS TRATADOS', y);
      minute.agenda.split('\n').filter(function(l) { return l.trim(); }).forEach(function(line) {
        checkPage(14);
        doc.fillColor(GRAY).fontSize(9).font('Helvetica')
           .text('  -  ' + line.trim(), ML + 8, y, { width: W - 16 });
        y = doc.y + 2;
      });
      y += 4;
    }

    // Discussion
    if (minute.discussions) {
      checkPage(40);
      y = sectionHdr('3. DESARROLLO DE LA REUNION', y);
      doc.fillColor(GRAY).fontSize(9).font('Helvetica')
         .text(minute.discussions, ML + 4, y, { width: W - 8, lineGap: 2 });
      y = doc.y + 8;
    }

    // Agreements
    if (agreements.length) {
      checkPage(40);
      y = sectionHdr('4. ACUERDOS', y);
      agreements.forEach(function(a, i) {
        checkPage(14);
        var txt = typeof a === 'string' ? a : (a.description || JSON.stringify(a));
        doc.fillColor(GRAY).fontSize(9).font('Helvetica')
           .text((i + 1) + '.  ' + txt, ML + 8, y, { width: W - 16 });
        y = doc.y + 3;
      });
      y += 4;
    }

    // Action items
    if (actionItems.length) {
      checkPage(40);
      y = sectionHdr('5. COMPROMISOS', y);
      actionItems.forEach(function(c, i) {
        checkPage(30);
        var task = c.task || c.description || c.compromiso || JSON.stringify(c);
        var resp = c.responsible || c.responsable || '';
        var due  = c.due_date    || c.fecha       || '';
        doc.fillColor('#111').fontSize(9).font('Helvetica-Bold')
           .text((i + 1) + '.  ' + task, ML + 8, y, { width: W - 16 });
        y = doc.y + 1;
        if (resp || due) {
          var meta = (resp ? 'Responsable: ' + resp : '') + (resp && due ? '   ' : '') + (due ? 'Fecha: ' + due : '');
          doc.fillColor(LGR).fontSize(8).font('Helvetica')
             .text(meta, ML + 20, y, { width: W - 28 });
          y = doc.y + 1;
        }
        y += 5;
      });
    }

    // =====================================================
    // PAGE 2 — CERTIFICATE
    // =====================================================
    doc.addPage();

    // Banner
    doc.rect(ML, 55, W, 38).fill(GRN);
    doc.fillColor('white').fontSize(14).font('Helvetica-Bold')
       .text('CERTIFICADO DE FIRMAS DIGITALES', ML + 10, 62, { width: W - 20, lineBreak: false });
    doc.fillColor('#A7F3D0').fontSize(7.5).font('Helvetica')
       .text('Firma Electronica con Validez Juridica - Ley 527 de 1999 - Decreto 1074 de 2015', ML + 10, 80, { width: W - 20, lineBreak: false });

    y = 108;

    // Document info block
    doc.fillColor(GRN).fontSize(10).font('Helvetica-Bold')
       .text('Documento firmado', ML, y);
    y = doc.y + 5;

    var docFields = [
      ['Titulo:', minute.title || '-'],
      ['Proyecto:', project.name + (project.code ? ' (' + project.code + ')' : '')],
      ['Acta N:', String(minute.minute_number || minute.id)],
      ['Fecha del acta:', minute.meeting_date ? new Date(minute.meeting_date).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' }) : '-'],
      ['Proceso completado:', req_.completed_at ? new Date(req_.completed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '-'],
      ['Hash SHA-256:', req_.document_hash || '-'],
    ];
    var dlw = 120;
    docFields.forEach(function(pair) {
      doc.fillColor(LGR).fontSize(8).font('Helvetica')
         .text(pair[0], ML, y, { width: dlw, lineBreak: false });
      doc.fillColor('#111').fontSize(8.5).font('Helvetica')
         .text(pair[1], ML + dlw, y, { width: W - dlw });
      y = doc.y + 2;
    });

    y = separator(y + 4);

    // Firmantes
    doc.fillColor(GRN).fontSize(10).font('Helvetica-Bold')
       .text('Firmantes', ML, y);
    y = doc.y + 8;

    signers.forEach(function(s) {
      checkPage(90);
      var topY  = y;
      var imgW  = 155;
      var imgH  = 60;
      var tW    = W - imgW - 14;  // text column width

      // Name
      doc.fillColor(BLUE).fontSize(10).font('Helvetica-Bold')
         .text(s.sign_order + '. ' + s.signer_name, ML, y, { width: tW, lineBreak: false });
      y = doc.y + 2;

      // Role
      doc.fillColor(LGR).fontSize(8.5).font('Helvetica')
         .text(s.signer_role || 'Firmante', ML, y, { width: tW, lineBreak: false });
      y = doc.y + 5;

      // Meta fields
      var mlw = 52;
      var metaFields = [
        ['Correo:', s.signer_email || '-'],
        ['Firmado:', s.signed_at ? new Date(s.signed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' }) : '-'],
        ['IP:', s.ip_address || '-'],
      ];
      metaFields.forEach(function(mf) {
        doc.fillColor(LGR).fontSize(7.5).font('Helvetica')
           .text(mf[0], ML + 4, y, { width: mlw, lineBreak: false });
        doc.fillColor(GRAY).fontSize(8).font('Helvetica')
           .text(mf[1], ML + 4 + mlw, y, { width: tW - mlw - 4, lineBreak: false });
        y = doc.y + 3;
      });

      var textBottom = y;

      // Signature image — positioned to the right of text block
      var imgX = ML + tW + 14;
      doc.rect(imgX, topY, imgW, imgH).fillAndStroke('#F8FAFC', '#CCCCCC');
      if (s.signature_image) {
        try {
          var b64    = s.signature_image.replace(/^data:image\/\w+;base64,/, '');
          var imgBuf = Buffer.from(b64, 'base64');
          doc.image(imgBuf, imgX + 5, topY + 5, {
            width:  imgW - 10,
            height: imgH - 10,
            fit:    [imgW - 10, imgH - 10],
          });
        } catch(ex) { /* skip */ }
      }
      doc.fillColor(LGR).fontSize(7).font('Helvetica')
         .text('Firma electronica', imgX, topY + imgH + 2, { width: imgW, align: 'center', lineBreak: false });

      // Advance Y past whichever is taller
      y = Math.max(textBottom, topY + imgH + 14) + 6;
      y = separator(y);
    });

    // Legal notice box
    checkPage(75);
    y += 4;
    doc.rect(ML, y, W, 62).fill('#F0FDF4');
    doc.rect(ML, y, 4, 62).fill(GRN);
    doc.fillColor('#166534').fontSize(8.5).font('Helvetica-Bold')
       .text('VALIDEZ JURIDICA', ML + 12, y + 8, { width: W - 20, lineBreak: false });
    doc.fillColor('#166534').fontSize(7.5).font('Helvetica')
       .text(
         'Este documento ha sido firmado electronicamente conforme a la Ley 527 de 1999 y el Decreto 1074 de 2015 (Secc. 2, Cap. 1, Tit. V, Parte 5) de la Republica de Colombia. ' +
         'Cada firma fue obtenida mediante un enlace unico enviado al correo del firmante, registrando direccion IP, ' +
         'fecha y hora del servidor, y hash SHA-256 del contenido. ' +
         'Este PDF esta protegido contra modificaciones. Cualquier alteracion invalidara las firmas.',
         ML + 12, y + 22, { width: W - 24, lineGap: 1.5 }
       );
    y += 70;

    // Footer
    doc.fillColor('#AAAAAA').fontSize(7.5).font('Helvetica')
       .text(
         'Certificado generado por SGIP-IA el ' + new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' }) + ' - sigp.tecnofactory.net.co',
         ML, y, { width: W, align: 'center', lineBreak: false }
       );

    doc.end();
    await new Promise(function(resolve) { doc.on('end', resolve); });
    return Buffer.concat(chunks);
}

// ── GET /certificate  —  sealed PDF with full acta + audit trail ──────────────
router.get('/certificate', async (req, res) => {
  const { projectId, minuteId } = req.params;
  try {
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

    const pdfBuffer = await buildCertificatePdf(req_, signers, minute, project);
    const filename = 'Certificado_Firma_Acta' + (minute.minute_number || minute.id) + '_' + (project.code || projectId) + '.pdf';
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'attachment; filename="' + filename + '"');
    res.send(pdfBuffer);
  } catch (e) {
    console.error('[signatures] GET /certificate:', e);
    res.status(500).json({ error: e.message });
  }
});

module.exports = { signaturesRouter: router, firmaRouter: publicRouter };
