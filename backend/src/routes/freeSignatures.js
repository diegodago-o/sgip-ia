/**
 * Firmas libres — firma cualquier PDF sin necesidad de correspondencia
 * Validez jurídica Ley 527/1999 (Colombia)
 *
 * Authenticated routes  →  /api/exec/:projectId/firma-libre
 * Public routes         →  /api/firma/libre/:token
 */
const express   = require('express');
const crypto    = require('crypto');
const multer    = require('multer');
const pool      = require('../config/database');
const { authMiddleware: authenticate } = require('../middleware/auth');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 50 * 1024 * 1024 } });

// ── Self-healing tables ──────────────────────────────────────────────────────
async function ensureTables() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS free_signature_requests (
      id           INT AUTO_INCREMENT PRIMARY KEY,
      project_id   INT NOT NULL,
      title        VARCHAR(255) NOT NULL,
      file_name    VARCHAR(255) NOT NULL,
      file_data    LONGBLOB NOT NULL,
      file_hash    VARCHAR(64),
      status       ENUM('in_progress','completed','rejected','cancelled') DEFAULT 'in_progress',
      created_by   INT NOT NULL,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at TIMESTAMP NULL
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS free_signature_signers (
      id               INT AUTO_INCREMENT PRIMARY KEY,
      request_id       INT NOT NULL,
      signer_name      VARCHAR(255) NOT NULL,
      signer_email     VARCHAR(255) NOT NULL,
      signer_role      VARCHAR(100),
      sign_order       INT DEFAULT 1,
      token            VARCHAR(64) UNIQUE NOT NULL,
      status           ENUM('pending','notified','viewed','signed','rejected') DEFAULT 'pending',
      page_num         INT DEFAULT 1,
      x_percent        DECIMAL(8,6),
      y_percent        DECIMAL(8,6),
      width_percent    DECIMAL(8,6),
      height_percent   DECIMAL(8,6),
      signature_image  LONGTEXT,
      signed_at        TIMESTAMP NULL,
      ip_address       VARCHAR(45),
      user_agent       VARCHAR(500),
      rejection_reason TEXT,
      created_at       TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
}
ensureTables().catch(e => console.error('[freeSignatures] ensureTables:', e.message));

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
  } catch (e) { console.error('[freeSignatures] email error:', e.message); }
}

// ── Email Templates ──────────────────────────────────────────────────────────
function emailInviteFree({ signer, request, project, allSigners, position }) {
  const url = `${FRONTEND_URL()}/firma/libre/${signer.token}`;
  const prevList = allSigners
    .filter(s => s.sign_order < signer.sign_order && s.status === 'signed')
    .map(s => `<li style="margin-bottom:4px">${s.signer_name} <span style="color:#64748b">(${s.signer_role || 'Firmante'})</span> — ${new Date(s.signed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</li>`)
    .join('');
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
        <p style="margin:0;font-size:16px;font-weight:bold;color:#1B5FAA;">${request.title}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#374151;">${request.file_name}</p>
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
        Este correo fue enviado por SGIP-IA. El enlace es personal e intransferible.<br>
        Su IP quedará registrada al momento de la firma.<br>
        Firma electrónica con validez jurídica — Ley 527 de 1999, Decreto 1074 de 2015.
      </p>
    </div>
  </div>
</div>
</body></html>`;
}

function emailCompletedFree({ request, project, allSigners, documentHash }) {
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
        El documento <strong>${request.title}</strong> del proyecto <strong>${project.name}</strong>
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
        Adjunto encontrará el PDF con las firmas embebidas y página de auditoría.<br>
        Hash del documento: <code style="font-size:11px;">${documentHash || '—'}</code><br>
        Firma electrónica con validez jurídica — Ley 527 de 1999 y Decreto 1074 de 2015.
      </p>
    </div>
  </div>
</div>
</body></html>`;
}

// ── buildSignedPdf — embebe firmas en el PDF original con pdf-lib ─────────────
async function buildSignedPdf(request, project, signers) {
  const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');

  // Load original PDF
  const pdfDoc = await PDFDocument.load(request.file_data);
  const pages  = pdfDoc.getPages();
  const font   = await pdfDoc.embedFont(StandardFonts.Helvetica);
  const fontB  = await pdfDoc.embedFont(StandardFonts.HelveticaBold);

  // Embed each signature image on its designated page
  for (const signer of signers) {
    if (signer.status !== 'signed' || !signer.signature_image) continue;
    const pageIdx = (signer.page_num || 1) - 1;
    const page    = pages[Math.min(pageIdx, pages.length - 1)];
    const { width, height } = page.getSize();

    // Parse base64 signature image
    const base64Data = signer.signature_image.includes(',')
      ? signer.signature_image.split(',')[1]
      : signer.signature_image;
    const sigBuffer = Buffer.from(base64Data, 'base64');

    let sigImage;
    try {
      sigImage = await pdfDoc.embedPng(sigBuffer);
    } catch {
      try { sigImage = await pdfDoc.embedJpg(sigBuffer); } catch { continue; }
    }

    const x  = (signer.x_percent || 0.05) * width;
    // pdf-lib Y axis is from bottom — convert from top-origin percent
    const y  = height - ((signer.y_percent || 0.8) + (signer.height_percent || 0.08)) * height;
    const w  = (signer.width_percent  || 0.25) * width;
    const h  = (signer.height_percent || 0.08) * height;

    // Draw border box
    page.drawRectangle({ x, y, width: w, height: h, borderColor: rgb(0.11, 0.37, 0.67), borderWidth: 0.5 });
    // Draw signature image
    page.drawImage(sigImage, { x: x + 2, y: y + 2, width: w - 4, height: h - 4 });
    // Label below
    page.drawText(`${signer.signer_name} · ${signer.signer_role || 'Firmante'}`, {
      x, y: y - 10, size: 6, font, color: rgb(0.4, 0.4, 0.4),
    });
  }

  // ── Audit page ────────────────────────────────────────────────────────────
  const auditPage = pdfDoc.addPage([595.28, 841.89]); // A4
  const { width: aw, height: ah } = auditPage.getSize();
  let cy = ah - 50;
  const lh = 16;

  const drawText = (text, opts = {}) => {
    auditPage.drawText(text, { x: opts.x || 50, y: cy, size: opts.size || 9, font: opts.bold ? fontB : font, color: opts.color || rgb(0.22, 0.22, 0.22), ...opts });
    if (opts.advance !== false) cy -= (opts.lh || lh);
  };

  // Header bar
  auditPage.drawRectangle({ x: 0, y: ah - 70, width: aw, height: 70, color: rgb(0.11, 0.37, 0.67) });
  auditPage.drawText('REGISTRO DE FIRMAS ELECTRÓNICAS', { x: 50, y: ah - 30, size: 14, font: fontB, color: rgb(1,1,1) });
  auditPage.drawText('SGIP-IA · Sistema de Gestión Integral de Proyectos', { x: 50, y: ah - 48, size: 8, font, color: rgb(0.58, 0.78, 0.97) });
  cy = ah - 90;

  drawText(`Proyecto: ${project.name} (${project.code || ''})`, { bold: true, size: 10 });
  drawText(`Documento: ${request.title}`, { bold: true, size: 10 });
  drawText(`Archivo: ${request.file_name}`, { size: 8, color: rgb(0.4,0.4,0.4) });
  drawText(`Hash del documento original: ${request.file_hash || '—'}`, { size: 7, color: rgb(0.5,0.5,0.5) });
  cy -= 10;

  // Separator
  auditPage.drawLine({ start: { x: 50, y: cy }, end: { x: aw - 50, y: cy }, thickness: 0.5, color: rgb(0.8,0.8,0.8) });
  cy -= 20;

  drawText('FIRMANTES', { bold: true, size: 9, color: rgb(0.11, 0.37, 0.67) });
  cy -= 5;

  for (const [i, s] of signers.entries()) {
    const statusLabel = s.status === 'signed' ? '✓ Firmado' : s.status === 'rejected' ? '✗ Rechazado' : '○ Pendiente';
    const statusColor = s.status === 'signed' ? rgb(0.02, 0.59, 0.41) : s.status === 'rejected' ? rgb(0.86, 0.15, 0.15) : rgb(0.5,0.5,0.5);

    auditPage.drawRectangle({ x: 50, y: cy - 48, width: aw - 100, height: 52, color: rgb(0.97,0.98,0.99), borderColor: rgb(0.88,0.91,0.95), borderWidth: 0.5 });

    auditPage.drawText(`${i + 1}. ${s.signer_name}`, { x: 60, y: cy - 10, size: 9, font: fontB, color: rgb(0.11,0.37,0.67) });
    auditPage.drawText(`Rol: ${s.signer_role || '—'} · Orden: ${s.sign_order}`, { x: 60, y: cy - 22, size: 8, font, color: rgb(0.4,0.4,0.4) });
    auditPage.drawText(statusLabel, { x: aw - 130, y: cy - 10, size: 8, font: fontB, color: statusColor });

    if (s.status === 'signed' && s.signed_at) {
      auditPage.drawText(`Fecha: ${new Date(s.signed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}`, { x: 60, y: cy - 34, size: 8, font, color: rgb(0.3,0.3,0.3) });
      auditPage.drawText(`IP: ${s.ip_address || '—'}`, { x: 300, y: cy - 34, size: 7, font, color: rgb(0.5,0.5,0.5) });
    }
    if (s.status === 'rejected' && s.rejection_reason) {
      auditPage.drawText(`Motivo: ${s.rejection_reason.slice(0, 80)}`, { x: 60, y: cy - 34, size: 7, font, color: rgb(0.6,0.2,0.2) });
    }
    cy -= 62;
    if (cy < 80) break;
  }

  // Footer legal
  cy = 40;
  auditPage.drawLine({ start: { x: 50, y: cy + 16 }, end: { x: aw - 50, y: cy + 16 }, thickness: 0.3, color: rgb(0.8,0.8,0.8) });
  auditPage.drawText('Documento firmado electrónicamente con validez jurídica según Ley 527 de 1999 y Decreto 1074 de 2015 (Colombia).', { x: 50, y: cy + 4, size: 6, font, color: rgb(0.6,0.6,0.6) });
  auditPage.drawText(`Generado: ${new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' })} · SGIP-IA`, { x: 50, y: cy - 6, size: 6, font, color: rgb(0.7,0.7,0.7) });

  return Buffer.from(await pdfDoc.save());
}

// ── Notify next signer ────────────────────────────────────────────────────────
async function notifyNextSigner(requestId) {
  const [signers] = await pool.execute(
    'SELECT * FROM free_signature_signers WHERE request_id = ? ORDER BY sign_order ASC',
    [requestId]
  );
  const [reqRows] = await pool.execute(
    `SELECT r.*, p.name, p.code FROM free_signature_requests r
     JOIN projects p ON p.id = r.project_id WHERE r.id = ?`,
    [requestId]
  );
  if (!reqRows.length) return;
  const request = reqRows[0];
  const project = { name: request.name, code: request.code };

  const allSigned = signers.every(s => s.status === 'signed');
  if (allSigned) {
    // Mark completed
    await pool.execute(
      "UPDATE free_signature_requests SET status='completed', completed_at=NOW() WHERE id=?",
      [requestId]
    );
    console.log(`[firma] Request ${requestId} completed — building signed PDF`);
    // Build signed PDF (requires pdf-lib — install with: npm install pdf-lib)
    let signedPdf = null;
    try {
      signedPdf = await buildSignedPdf(request, project, signers);
      console.log(`[firma] Signed PDF built (${signedPdf.length} bytes)`);
    } catch (pdfErr) {
      console.error('[firma] buildSignedPdf failed — is pdf-lib installed?', pdfErr.message);
    }
    // Send completion emails
    const emailCfg = await loadEmailConfig();
    const html = emailCompletedFree({ request, project, allSigners: signers, documentHash: request.file_hash });
    for (const s of signers) {
      const mailOpts = {
        to: s.signer_email, subject: `✅ Documento firmado — ${request.title}`, html,
      };
      if (signedPdf) {
        mailOpts.attachments = [{ filename: `firmado_${request.file_name}`, content: signedPdf, contentType: 'application/pdf' }];
      }
      await trySendMail(emailCfg, mailOpts);
    }
    console.log(`[firma] Completion emails sent to ${signers.length} signer(s)`);
    return;
  }

  // Find next pending signer
  const next = signers.find(s => s.status === 'pending' || s.status === 'notified');
  if (!next) return;

  await pool.execute(
    "UPDATE free_signature_signers SET status='notified' WHERE id=?", [next.id]
  );
  const emailCfg = await loadEmailConfig();
  const position  = signers.findIndex(s => s.id === next.id) + 1;
  const html = emailInviteFree({ signer: next, request, project, allSigners: signers, position });
  await trySendMail(emailCfg, {
    to: next.signer_email,
    subject: `✍️ Firma requerida — ${request.title}`,
    html,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// AUTHENTICATED ROUTER  /api/exec/:projectId/firma-libre
// ═══════════════════════════════════════════════════════════════════════════════
const authRouter = express.Router({ mergeParams: true });

// GET / — list all free signature requests for project
authRouter.get('/', authenticate, async (req, res) => {
  const { projectId } = req.params;
  try {
    const [rows] = await pool.execute(`
      SELECT r.id, r.title, r.file_name, r.status, r.created_at, r.completed_at,
             u.name AS created_by_name,
             (SELECT COUNT(*) FROM free_signature_signers WHERE request_id = r.id) AS total_signers,
             (SELECT COUNT(*) FROM free_signature_signers WHERE request_id = r.id AND status = 'signed') AS signed_count
      FROM free_signature_requests r
      LEFT JOIN users u ON u.id = r.created_by
      WHERE r.project_id = ?
      ORDER BY r.created_at DESC
    `, [projectId]);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al listar solicitudes' });
  }
});

// POST / — create new request (multipart: file + title + signers JSON)
authRouter.post('/', authenticate, upload.single('file'), async (req, res) => {
  const { projectId } = req.params;
  const { title, signers: signersJson } = req.body;
  const file = req.file;

  if (!file) return res.status(400).json({ error: 'Debe subir un archivo PDF' });
  if (!title?.trim()) return res.status(400).json({ error: 'El título es requerido' });

  let signers;
  try { signers = JSON.parse(signersJson); } catch { return res.status(400).json({ error: 'Firmantes inválidos' }); }
  if (!Array.isArray(signers) || !signers.length) return res.status(400).json({ error: 'Debe agregar al menos un firmante' });

  const hash = crypto.createHash('sha256').update(file.buffer).digest('hex');

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const [ins] = await conn.execute(
      'INSERT INTO free_signature_requests (project_id, title, file_name, file_data, file_hash, created_by) VALUES (?,?,?,?,?,?)',
      [projectId, title.trim(), file.originalname, file.buffer, hash, req.user.id]
    );
    const requestId = ins.insertId;

    for (const s of signers) {
      const token = crypto.randomBytes(32).toString('hex');
      await conn.execute(
        `INSERT INTO free_signature_signers
         (request_id, signer_name, signer_email, signer_role, sign_order, token, page_num, x_percent, y_percent, width_percent, height_percent)
         VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
        [requestId, s.signer_name, s.signer_email, s.signer_role || '', s.sign_order || 1,
         token, s.page_num || 1, s.x_percent || 0.1, s.y_percent || 0.7, s.width_percent || 0.25, s.height_percent || 0.08]
      );
    }

    await conn.commit();
    // Notify first signer
    await notifyNextSigner(requestId);
    res.status(201).json({ id: requestId, message: 'Solicitud creada exitosamente' });
  } catch (e) {
    await conn.rollback();
    console.error(e);
    res.status(500).json({ error: 'Error al crear solicitud' });
  } finally {
    conn.release();
  }
});

// GET /:id — get status + signers
authRouter.get('/:id', authenticate, async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const [reqs] = await pool.execute(
      'SELECT * FROM free_signature_requests WHERE id = ? AND project_id = ?', [id, projectId]
    );
    if (!reqs.length) return res.status(404).json({ error: 'No encontrado' });
    const [signers] = await pool.execute(
      'SELECT id, signer_name, signer_email, signer_role, sign_order, status, signed_at, ip_address, page_num, x_percent, y_percent, width_percent, height_percent FROM free_signature_signers WHERE request_id = ? ORDER BY sign_order',
      [id]
    );
    const r = reqs[0];
    res.json({ ...r, file_data: undefined, signers });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener solicitud' });
  }
});

// DELETE /:id — cancel
authRouter.delete('/:id', authenticate, async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const [reqs] = await pool.execute(
      "SELECT * FROM free_signature_requests WHERE id=? AND project_id=? AND status='in_progress'",
      [id, projectId]
    );
    if (!reqs.length) return res.status(404).json({ error: 'No encontrado o no cancelable' });
    await pool.execute("UPDATE free_signature_requests SET status='cancelled' WHERE id=?", [id]);
    res.json({ message: 'Cancelado' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al cancelar' });
  }
});

// GET /:id/pdf — download original or signed PDF
authRouter.get('/:id/pdf', authenticate, async (req, res) => {
  const { projectId, id } = req.params;
  try {
    const [reqs] = await pool.execute(
      'SELECT * FROM free_signature_requests WHERE id=? AND project_id=?', [id, projectId]
    );
    if (!reqs.length) return res.status(404).json({ error: 'No encontrado' });
    const request = reqs[0];

    if (request.status === 'completed') {
      // Return signed PDF
      const [signers] = await pool.execute(
        'SELECT * FROM free_signature_signers WHERE request_id=? ORDER BY sign_order', [id]
      );
      const [projRows] = await pool.execute('SELECT name, code FROM projects WHERE id=?', [projectId]);
      const project = projRows[0] || { name: '', code: '' };
      const signedPdf = await buildSignedPdf(request, project, signers);
      res.set({
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="firmado_${request.file_name}"`,
      });
      return res.send(signedPdf);
    }

    // Return original PDF
    res.set({
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${request.file_name}"`,
    });
    res.send(request.file_data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener PDF' });
  }
});

// ═══════════════════════════════════════════════════════════════════════════════
// PUBLIC ROUTER  /api/firma/libre
// ═══════════════════════════════════════════════════════════════════════════════
const publicRouter = express.Router();

// GET /:token — get signer info for public signing page
publicRouter.get('/:token', async (req, res) => {
  try {
    const [signers] = await pool.execute(
      'SELECT * FROM free_signature_signers WHERE token=?', [req.params.token]
    );
    if (!signers.length) return res.status(404).json({ error: 'Token inválido' });
    const signer = signers[0];

    const [reqs] = await pool.execute(
      `SELECT r.*, p.name AS project_name, p.code AS project_code
       FROM free_signature_requests r JOIN projects p ON p.id = r.project_id
       WHERE r.id = ?`, [signer.request_id]
    );
    if (!reqs.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const request = reqs[0];

    if (request.status === 'cancelled') return res.status(410).json({ error: 'Este proceso de firma fue cancelado' });
    if (request.status === 'completed') return res.status(410).json({ error: 'Este documento ya fue firmado por todos los firmantes' });
    if (signer.status === 'signed')     return res.status(410).json({ error: 'Ya firmaste este documento. Gracias.' });
    if (signer.status === 'rejected')   return res.status(410).json({ error: 'Rechazaste este documento.' });

    const [allSigners] = await pool.execute(
      'SELECT id, signer_name, signer_role, sign_order, status, signed_at FROM free_signature_signers WHERE request_id=? ORDER BY sign_order',
      [signer.request_id]
    );

    // Check if it's this signer's turn
    const prevPending = allSigners.find(s => s.sign_order < signer.sign_order && s.status !== 'signed' && s.status !== 'rejected');
    if (prevPending) {
      return res.status(403).json({ error: `Aún no es tu turno. Está esperando la firma de ${prevPending.signer_name}.` });
    }

    // Mark as viewed
    if (signer.status === 'notified' || signer.status === 'pending') {
      await pool.execute("UPDATE free_signature_signers SET status='viewed' WHERE id=?", [signer.id]);
    }

    res.json({
      signer: {
        id: signer.id, name: signer.signer_name, email: signer.signer_email,
        role: signer.signer_role, order: signer.sign_order,
        page_num: signer.page_num, x_percent: signer.x_percent, y_percent: signer.y_percent,
        width_percent: signer.width_percent, height_percent: signer.height_percent,
      },
      request: {
        id: request.id, title: request.title, file_name: request.file_name,
        project_name: request.project_name, project_code: request.project_code,
      },
      allSigners,
      position: allSigners.findIndex(s => s.id === signer.id) + 1,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error del servidor' });
  }
});

// GET /:token/pdf — get PDF for signing (public, no auth)
publicRouter.get('/:token/pdf', async (req, res) => {
  try {
    const [signers] = await pool.execute(
      'SELECT request_id FROM free_signature_signers WHERE token=?', [req.params.token]
    );
    if (!signers.length) return res.status(404).json({ error: 'Token inválido' });
    const [reqs] = await pool.execute(
      'SELECT file_data, file_name, status FROM free_signature_requests WHERE id=?', [signers[0].request_id]
    );
    if (!reqs.length || reqs[0].status === 'cancelled') return res.status(404).json({ error: 'No disponible' });
    res.set({ 'Content-Type': 'application/pdf', 'Content-Disposition': `inline; filename="${reqs[0].file_name}"` });
    res.send(reqs[0].file_data);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al obtener PDF' });
  }
});

// POST /:token/firmar — submit signature
publicRouter.post('/:token/firmar', express.json({ limit: '10mb' }), async (req, res) => {
  const { signature_image } = req.body;
  if (!signature_image) return res.status(400).json({ error: 'Firma requerida' });

  try {
    const [signers] = await pool.execute(
      'SELECT * FROM free_signature_signers WHERE token=?', [req.params.token]
    );
    if (!signers.length) return res.status(404).json({ error: 'Token inválido' });
    const signer = signers[0];

    if (['signed', 'rejected'].includes(signer.status)) {
      return res.status(409).json({ error: 'Ya procesaste este documento' });
    }

    const [reqs] = await pool.execute(
      'SELECT status FROM free_signature_requests WHERE id=?', [signer.request_id]
    );
    if (!reqs.length || reqs[0].status !== 'in_progress') {
      return res.status(410).json({ error: 'Este proceso ya no está activo' });
    }

    // Verify turn
    const [allSigners] = await pool.execute(
      'SELECT * FROM free_signature_signers WHERE request_id=? ORDER BY sign_order', [signer.request_id]
    );
    const prevPending = allSigners.find(s => s.sign_order < signer.sign_order && s.status !== 'signed');
    if (prevPending) return res.status(403).json({ error: 'Aún no es tu turno' });

    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket?.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';

    await pool.execute(
      "UPDATE free_signature_signers SET status='signed', signature_image=?, signed_at=NOW(), ip_address=?, user_agent=? WHERE id=?",
      [signature_image, ip, ua, signer.id]
    );

    // Respond immediately — don't block on PDF generation / email
    res.json({ message: '¡Firma registrada exitosamente!' });

    // Notify next signer (or build final PDF) in background
    notifyNextSigner(signer.request_id).catch(e => {
      console.error('[firmar] notifyNextSigner error:', e.message, e.stack);
    });
  } catch (e) {
    console.error('[firmar] error:', e);
    res.status(500).json({ error: 'Error al registrar firma' });
  }
});

// POST /:token/rechazar — reject signature
publicRouter.post('/:token/rechazar', express.json(), async (req, res) => {
  const { reason } = req.body;
  try {
    const [signers] = await pool.execute(
      'SELECT * FROM free_signature_signers WHERE token=?', [req.params.token]
    );
    if (!signers.length) return res.status(404).json({ error: 'Token inválido' });
    const signer = signers[0];

    await pool.execute(
      "UPDATE free_signature_signers SET status='rejected', rejection_reason=?, signed_at=NOW() WHERE id=?",
      [reason || '', signer.id]
    );
    await pool.execute(
      "UPDATE free_signature_requests SET status='rejected', completed_at=NOW() WHERE id=?",
      [signer.request_id]
    );
    res.json({ message: 'Documento rechazado' });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'Error al rechazar' });
  }
});

module.exports = { freeSignAuthRouter: authRouter, freeSignPublicRouter: publicRouter };
