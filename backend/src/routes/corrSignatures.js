/**
 * Firmas digitales para correspondencia — validez jurídica Ley 527/1999 (Colombia)
 *
 * Authenticated routes  →  /api/exec/:projectId/correspondence/:correspondenceId/firma
 * Public routes         →  /api/firma/corr/:token
 *
 * Diferencia clave vs. actas: cada firmante tiene posición exacta (x,y) en el PDF.
 */
const express = require('express');
const crypto  = require('crypto');
const pool    = require('../config/database');
const { authMiddleware: authenticate } = require('../middleware/auth');

// ── Self-healing tables ──────────────────────────────────────────────────────
async function ensureTables() {
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS corr_signature_requests (
      id                 INT AUTO_INCREMENT PRIMARY KEY,
      correspondence_id  INT NOT NULL,
      project_id         INT NOT NULL,
      status             ENUM('in_progress','completed','rejected','cancelled') DEFAULT 'in_progress',
      created_by         INT NOT NULL,
      document_hash      VARCHAR(64),
      created_at         TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      completed_at       TIMESTAMP NULL
    )
  `);
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS corr_signature_signers (
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
ensureTables().catch(e => console.error('[corrSignatures] ensureTables:', e.message));

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
  } catch (e) { console.error('[corrSignatures] email error:', e.message); }
}

const TYPE_LABEL = {
  oficio: 'OFICIO', circular: 'CIRCULAR', memorando: 'MEMORANDO',
  comunicado: 'COMUNICADO', carta: 'CARTA', radicado: 'RADICADO',
  derecho_peticion: 'DERECHO DE PETICIÓN',
};

function fmtDateEs(d) {
  if (!d) return '';
  const dt = new Date(d);
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio',
                  'agosto','septiembre','octubre','noviembre','diciembre'];
  return `${dt.getDate()} de ${months[dt.getMonth()]} de ${dt.getFullYear()}`;
}

// ── Email Templates ──────────────────────────────────────────────────────────
function emailInviteCorr({ signer, corr, project, allSigners, position }) {
  const url = `${FRONTEND_URL()}/firma/corr/${signer.token}`;
  const prevList = allSigners
    .filter(s => s.sign_order < signer.sign_order && s.status === 'signed')
    .map(s => `<li style="margin-bottom:4px">${s.signer_name} <span style="color:#64748b">(${s.signer_role || 'Firmante'})</span> — ${new Date(s.signed_at).toLocaleString('es-CO', { timeZone: 'America/Bogota' })}</li>`)
    .join('');
  const typeLabel = TYPE_LABEL[corr.correspondence_type] || 'COMUNICACIÓN';
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
        <p style="margin:0;font-size:16px;font-weight:bold;color:#1B5FAA;">${corr.subject}</p>
        <p style="margin:6px 0 0;font-size:13px;color:#374151;">${typeLabel} · ${corr.consecutive_code}</p>
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

function emailCompletedCorr({ corr, project, allSigners, documentHash }) {
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
        El documento <strong>${corr.subject}</strong> (${corr.consecutive_code}) del proyecto <strong>${project.name}</strong>
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
        Adjunto encontrará el documento PDF con las firmas embebidas.<br>
        Este registro constituye evidencia de firma electrónica con validez jurídica
        según Ley 527 de 1999 y Decreto 1074 de 2015 (Colombia).<br>
        Hash del documento: <code style="font-size:11px;">${documentHash || '—'}</code>
      </p>
    </div>
  </div>
</div>
</body></html>`;
}

function emailCancelledCorr({ corr, project, type, cancelledBy, reason }) {
  const isRejection = type === 'rejected';
  const headerColor = isRejection ? '#DC2626' : '#64748b';
  const headerLight = isRejection ? '#FCA5A5' : '#CBD5E1';
  const icon  = isRejection ? '❌' : '🚫';
  const title = isRejection ? 'Proceso cancelado — firma rechazada' : 'Proceso de firmas cancelado';
  const body  = isRejection
    ? `<strong>${cancelledBy}</strong> rechazó la firma del documento <strong>${corr.subject}</strong> (${corr.consecutive_code}) del proyecto <strong>${project.name}</strong>.`
    : `El proceso de firmas del documento <strong>${corr.subject}</strong> (${corr.consecutive_code}) del proyecto <strong>${project.name}</strong> ha sido cancelado.`;
  const reasonBlock = reason
    ? `<div style="background:#FEF2F2;border-left:4px solid ${headerColor};border-radius:8px;padding:16px 20px;margin:20px 0;">
         <p style="margin:0 0 4px;font-size:11px;color:#991B1B;font-weight:bold;text-transform:uppercase;">Motivo:</p>
         <p style="margin:0;font-size:14px;color:#374151;">${reason}</p>
       </div>` : '';
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
      <p style="font-size:13px;color:#64748b;">No se requiere ninguna acción de su parte.</p>
    </div>
  </div>
</div>
</body></html>`;
}

// ── buildCorrespondencePdf — genera el PDF del documento ────────────────────
// options: { showPlaceholders: bool, withSignatures: bool }
async function buildCorrespondencePdf(corr, project, signers, options = {}) {
  const PDFDocument = require('pdfkit');
  const { showPlaceholders = false, withSignatures = false } = options;

  const PAGE_W = 612;  // LETTER width in points
  const PAGE_H = 792;  // LETTER height in points
  const ML = 60;       // left margin
  const MR = 60;       // right margin
  const MT = 55;       // top margin
  const MB = 55;       // bottom margin
  const W  = PAGE_W - ML - MR;

  // bufferPages:true — needed for doc.switchToPage() so we can embed signatures
  // on any page of a multi-page document without losing content already written.
  const doc = new PDFDocument({
    size: 'LETTER',
    margins: { top: MT, bottom: MB, left: ML, right: MR },
    bufferPages: true,
    info: {
      Title: corr.subject || 'Correspondencia',
      Author: 'SGIP-IA',
      Subject: `${TYPE_LABEL[corr.correspondence_type] || 'COMUNICACIÓN'} - ${project.name}`,
      Creator: 'SGIP-IA',
    },
  });

  // Track the real page count as PDFKit adds pages during content generation.
  let pageCount = 1;
  doc.on('pageAdded', () => pageCount++);

  const chunks = [];
  doc.on('data', c => chunks.push(c));

  const typeLabel  = TYPE_LABEL[corr.correspondence_type] || 'COMUNICACIÓN';
  const firstName  = (corr.recipient_name || '').split(' ')[0] || 'señor(a)';

  function checkPage(needed) {
    if (doc.y + needed > PAGE_H - MB) doc.addPage();
  }

  // ─────────────────────────────────────────
  // ENCABEZADO CORPORATIVO
  // ─────────────────────────────────────────
  // El nombre de la entidad puede ser largo (ej: "Departamento Administrativo de la
  // Presidencia de la República"). lineBreak:false en PDFKit no recorta el texto
  // sino que lo desborda horizontalmente, solapando la columna derecha.
  // Solución: HEADER_H = 76pt para acomodar hasta 2 líneas del nombre de entidad
  // (font 11 × 2 líneas × 1.2 interlineado ≈ 26pt), con Proyecto/Código a partir
  // de y+40 y y+52, fuera de la zona de 2 líneas.
  const HEADER_H  = 84;  // +8pt para acomodar logo + nombre + proyecto + código
  const ENTITY_W  = W * 0.65 - 20;  // ancho util columna izquierda
  const rcX = ML + W * 0.65;
  const rcW = W * 0.35;

  // Columna izquierda (65%): rectángulo azul oscuro
  const headerEntityName = project.correspondence_sender_name || corr.project_entity || project.name || 'SGIP';
  doc.rect(ML, MT, W * 0.65, HEADER_H).fill('#1E3A5F');

  // Logo del proyecto (si está configurado)
  let logoDrawn = false;
  if (project.correspondence_logo) {
    try {
      const m = project.correspondence_logo.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
      if (m) {
        const imgBuf = Buffer.from(m[2], 'base64');
        doc.image(imgBuf, ML + 10, MT + 6, { height: 22, fit: [110, 22] });
        logoDrawn = true;
      }
    } catch (_) { /* ignorar errores de logo */ }
  }

  // Nombre de entidad: si hay logo lo ponemos debajo, si no en la posición normal
  const entityY = logoDrawn ? MT + 31 : MT + 8;
  const entityH  = logoDrawn ? 18 : 26;
  doc.fillColor('white').fontSize(11).font('Helvetica-Bold')
     .text(headerEntityName, ML + 10, entityY, { width: ENTITY_W, height: entityH });
  // Proyecto y código en filas fijas por debajo
  doc.fillColor('#BDD7EE').fontSize(8).font('Helvetica')
     .text(`Proyecto: ${project.name || ''}`,
           ML + 10, MT + 52, { width: ENTITY_W, lineBreak: false });
  doc.fillColor('#BDD7EE').fontSize(8).font('Helvetica')
     .text(`Código: ${project.code || ''}`,
           ML + 10, MT + 63, { width: ENTITY_W, lineBreak: false });

  // Columna derecha (35%): rectángulo azul medio, alineado con nueva altura
  doc.rect(rcX, MT, rcW, HEADER_H).fill('#2E86AB');
  doc.fillColor('white').fontSize(12).font('Helvetica-Bold')
     .text(typeLabel, rcX, MT + 14, { width: rcW, align: 'center', lineBreak: false });
  doc.fillColor('#BDD7EE').fontSize(8).font('Helvetica')
     .text(corr.consecutive_code || '', rcX, MT + 40, { width: rcW, align: 'center', lineBreak: false });
  doc.fillColor('#BDD7EE').fontSize(8).font('Helvetica')
     .text(fmtDateEs(corr.reference_date), rcX, MT + 52, { width: rcW, align: 'center', lineBreak: false });

  // Línea separadora azul
  const headerBottom = MT + HEADER_H;
  doc.rect(ML, headerBottom, W, 3).fill('#2E86AB');
  doc.y = headerBottom + 14;

  // ─────────────────────────────────────────
  // CIUDAD Y FECHA (alineada a la derecha)
  // ─────────────────────────────────────────
  const cityDate = `${corr.recipient_city || 'Bogotá D.C.'}, ${fmtDateEs(corr.reference_date)}`;
  doc.fillColor('#374151').fontSize(10).font('Helvetica')
     .text(cityDate, ML, doc.y, { width: W, align: 'right' });
  doc.y += 16;

  // ─────────────────────────────────────────
  // BLOQUE DESTINATARIO
  // ─────────────────────────────────────────
  if (corr.recipient_name) {
    doc.fillColor('#111111').fontSize(10).font('Helvetica-Bold').text(corr.recipient_name, ML, doc.y, { width: W });
    doc.y = doc.y + 2;
  }
  if (corr.recipient_title) {
    doc.fillColor('#374151').fontSize(10).font('Helvetica').text(corr.recipient_title, ML, doc.y, { width: W });
    doc.y = doc.y + 2;
  }
  if (corr.recipient_entity) {
    doc.fillColor('#374151').fontSize(10).font('Helvetica').text(corr.recipient_entity, ML, doc.y, { width: W });
    doc.y = doc.y + 2;
  }
  if (corr.recipient_address) {
    doc.fillColor('#374151').fontSize(10).font('Helvetica').text(corr.recipient_address, ML, doc.y, { width: W });
    doc.y = doc.y + 2;
  }
  if (corr.recipient_city) {
    doc.fillColor('#374151').fontSize(10).font('Helvetica').text(corr.recipient_city, ML, doc.y, { width: W });
  }
  doc.y = doc.y + 14;

  // ─────────────────────────────────────────
  // CAJA DE ASUNTO
  // ─────────────────────────────────────────
  checkPage(40);
  const asuntoY = doc.y;
  doc.rect(ML, asuntoY, W, 22).fill('#F0F4F8');
  doc.fillColor('#1E3A5F').fontSize(9).font('Helvetica-Bold')
     .text('ASUNTO:  ', ML + 6, asuntoY + 6, { continued: true, lineBreak: false });
  doc.fillColor('#111111').fontSize(9).font('Helvetica')
     .text(corr.subject || '', { lineBreak: false });
  doc.y = asuntoY + 30;

  // ─────────────────────────────────────────
  // REFERENCIA CONTRATO (si existe)
  // ─────────────────────────────────────────
  if (corr.contract_reference) {
    doc.fillColor('#374151').fontSize(10).font('Helvetica')
       .text(`REF:  Contrato No. ${corr.contract_reference}`, ML, doc.y, { width: W });
    doc.y = doc.y + 12;
  }
  doc.y = doc.y + 4;

  // ─────────────────────────────────────────
  // SALUDO
  // ─────────────────────────────────────────
  checkPage(20);
  doc.fillColor('#111111').fontSize(10.5).font('Helvetica')
     .text(`Respetado(a) señor(a) ${firstName}:`, ML, doc.y, { width: W });
  doc.y = doc.y + 14;

  // ─────────────────────────────────────────
  // CUERPO DEL DOCUMENTO
  // ─────────────────────────────────────────
  const bodyText = corr.body || '';
  const paragraphs = bodyText.split('\n').filter(p => p.trim());
  for (const para of paragraphs) {
    checkPage(30);
    doc.fillColor('#111111').fontSize(10.5).font('Helvetica')
       .text(para.trim(), ML, doc.y, { width: W, align: 'justify' });
    doc.y = doc.y + 10;
  }
  doc.y = doc.y + 10;

  // ─────────────────────────────────────────
  // FRASE DE CIERRE
  // ─────────────────────────────────────────
  checkPage(20);
  doc.fillColor('#111111').fontSize(10.5).font('Helvetica')
     .text(corr.closing || 'Cordialmente,', ML, doc.y, { width: W });
  doc.y = doc.y + 14;

  // ─────────────────────────────────────────
  // BLOQUE REMITENTE
  // Línea de firma + sender_name + sender_title + project_entity
  // Va en flujo normal ANTES de las zonas de firma digitales (que usan
  // coordenadas absolutas y se superponen sobre el área de firma).
  // ─────────────────────────────────────────
  if (corr.sender_name || corr.sender_title) {
    checkPage(100); // espacio firma + nombre + cargo + entidad
    doc.y += 52;    // espacio en blanco para la imagen de firma digital

    // Línea de firma (similar a w-40 del preview HTML → ~150 pt)
    doc.moveTo(ML, doc.y)
       .lineTo(ML + 150, doc.y)
       .strokeColor('#9CA3AF')
       .lineWidth(0.8)
       .stroke();
    doc.y += 6;

    if (corr.sender_name) {
      doc.fillColor('#1E3A5F').fontSize(10.5).font('Helvetica-Bold')
         .text(corr.sender_name, ML, doc.y, { width: W });
      doc.y += 2;
    }
    if (corr.sender_title) {
      doc.fillColor('#4B5563').fontSize(9).font('Helvetica')
         .text(corr.sender_title, ML, doc.y, { width: W });
      doc.y += 2;
    }
    if (corr.project_entity) {
      doc.fillColor('#6B7280').fontSize(9).font('Helvetica')
         .text(corr.project_entity, ML, doc.y, { width: W });
    }
    doc.y += 14;
  } else {
    // Sin datos de remitente: dejar espacio mínimo para la firma digital
    doc.y += 70;
  }

  // ─────────────────────────────────────────
  // ZONA DE FIRMAS
  // Dibujar DESPUÉS del texto en coordenadas absolutas
  // ─────────────────────────────────────────
  const SIGNER_COLORS = [
    '#1B5FAA', '#059669', '#D97706', '#DC2626', '#7C3AED', '#0891B2',
  ];

  if (showPlaceholders || withSignatures) {
    // Save position on the last content page before any page switching.
    const savedDocY = doc.y;
    const lastContentPage = pageCount - 1; // 0-indexed

    for (let i = 0; i < signers.length; i++) {
      const s = signers[i];
      if (!s.x_percent && s.x_percent !== 0) continue; // skip if no position set

      // Switch to the signer's target page (clamped to actual page range).
      // page_num is 1-indexed; clamp to [1, pageCount].
      const targetPage = Math.max(0, Math.min((s.page_num || 1) - 1, lastContentPage));
      doc.switchToPage(targetPage);

      const absX  = parseFloat(s.x_percent)      * PAGE_W;
      const absY  = parseFloat(s.y_percent)      * PAGE_H;
      const absW  = parseFloat(s.width_percent)  * PAGE_W;
      const absH  = parseFloat(s.height_percent) * PAGE_H;
      const color = SIGNER_COLORS[i % SIGNER_COLORS.length];
      // Safe zone: labels below signature box must fit before bottom margin
      const labelSafe = absY + absH + 28 < PAGE_H - MB;

      if (withSignatures && s.signature_image) {
        try {
          const b64 = s.signature_image.replace(/^data:image\/\w+;base64,/, '');
          const imgBuf = Buffer.from(b64, 'base64');
          doc.image(imgBuf, absX, absY, { width: absW, height: absH, fit: [absW, absH] });

          // Thin underline below image
          doc.moveTo(absX + 4, absY + absH + 1).lineTo(absX + absW - 4, absY + absH + 1)
             .strokeColor(color).lineWidth(0.5).stroke();

          // Labels — row 1: name  |  row 2: cargo · fecha (single line, saves space)
          if (labelSafe) {
            doc.fillColor('#374151').fontSize(7.5).font('Helvetica-Bold')
               .text(s.signer_name || '', absX, absY + absH + 3, { width: absW, align: 'center', lineBreak: false });
            // Combine role + date on one line separated by  ·
            const roleParts = [];
            if (s.signer_role) roleParts.push(s.signer_role);
            if (s.signed_at) {
              roleParts.push(new Date(s.signed_at).toLocaleString('es-CO', {
                day: '2-digit', month: '2-digit', year: 'numeric',
                hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
              }));
            }
            if (roleParts.length > 0) {
              doc.fillColor('#94a3b8').fontSize(6.5).font('Helvetica')
                 .text(roleParts.join(' · '), absX, absY + absH + 14, { width: absW, align: 'center', lineBreak: false });
            }
          }
        } catch (imgErr) {
          console.error('[corrSignatures] embed signature image error:', imgErr.message);
          doc.rect(absX, absY, absW, absH).dash(4, { space: 3 }).strokeColor(color).lineWidth(1).stroke();
          if (absY + 8 < PAGE_H - MB) {
            doc.fillColor(color).fontSize(7.5).font('Helvetica')
               .text(s.signer_name || `Firmante ${i + 1}`, absX + 4, absY + 4, { width: absW - 8, lineBreak: false });
          }
        }
      } else if (showPlaceholders) {
        doc.rect(absX, absY, absW, absH).undash().fillAndStroke(`${color}18`, color);
        if (absY + 8 < PAGE_H - MB) {
          doc.fillColor(color).fontSize(8).font('Helvetica-Bold')
             .text(`${i + 1}. ${s.signer_name || 'Firmante'}`, absX + 4, absY + 6, { width: absW - 8, lineBreak: false });
        }
        if (s.signer_role && absY + 20 < PAGE_H - MB) {
          doc.fillColor(color).fontSize(7).font('Helvetica')
             .text(s.signer_role, absX + 4, absY + 18, { width: absW - 8, lineBreak: false });
        }
      }
    }

    // Restore to the last content page and original Y so the footer draws correctly.
    doc.switchToPage(lastContentPage);
    doc.y = savedDocY;
  }

  // ─────────────────────────────────────────
  // FOOTER (última página)
  // IMPORTANTE: footerY DEBE ser < PAGE_H - MB (= 737 = maxY de PDFKit).
  // Si footerY + 5 >= maxY, doc.text() con coordenada explícita detecta overflow
  // y agrega una página nueva en blanco antes de renderizar el texto.
  // Usamos PAGE_H - MB - 22 = 715 → el footer queda dentro del área de contenido
  // (715–733) sin solaparse con el cuerpo y sin generar página extra.
  // ─────────────────────────────────────────
  const footerY = PAGE_H - MB - 22;          // 715 — dentro de maxY (737)
  doc.rect(ML, footerY, W, 18).fill('#F0F4F8');
  const nowStr = new Date().toLocaleString('es-CO', { timeZone: 'America/Bogota' });
  doc.fillColor('#64748b').fontSize(7).font('Helvetica')
     .text(`${corr.consecutive_code || ''} — SGIP-IA`, ML + 6, footerY + 5, { width: W / 2 - 12, lineBreak: false });
  doc.fillColor('#94a3b8').fontSize(7).font('Helvetica')
     .text(`Generado: ${nowStr}`, ML + W / 2, footerY + 5, { width: W / 2 - 6, align: 'right', lineBreak: false });

  // Capture content page count BEFORE the optional audit page is added.
  // The audit page (added below for withSignatures) is NOT part of the document
  // proper; it's an appendix. X-PDF-Pages reflects only content pages.
  const contentPageCount = pageCount;

  // ─────────────────────────────────────────
  // PÁGINA DE AUDITORÍA (solo en PDF firmado)
  // ─────────────────────────────────────────
  const { request: auditReq } = options;
  if (withSignatures && auditReq) {
    doc.addPage();

    const AL  = 54;
    const AW  = PAGE_W - AL * 2;
    const ROW_H = 21;
    const COL1  = 148;
    let ay = 0;

    const fmtTs = (d) => d
      ? new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota' })
      : '—';

    // ── Header bar ──
    doc.rect(0, 0, PAGE_W, 58).fill('#1E3A5F');
    doc.fillColor('white').fontSize(15).font('Helvetica-Bold')
       .text('Informe de Auditoría Final', AL, 14, { width: AW });
    doc.fillColor('#93C5FD').fontSize(8).font('Helvetica')
       .text('Firma electrónica · Ley 527 de 1999 · Decreto 1074 de 2015 · SGIP-IA', AL, 38, { width: AW });
    ay = 76;

    // ── Info table ──
    const hashStr = (auditReq.document_hash || '—');
    const typeLabel2 = TYPE_LABEL[corr.correspondence_type] || 'COMUNICACIÓN';
    const infoRows = [
      ['Documento', corr.subject || '—'],
      ['Código / Tipo', `${corr.consecutive_code || '—'}  ·  ${typeLabel2}`],
      ['Proyecto', `${project.name}${project.code ? ' (' + project.code + ')' : ''}`],
      ['Fecha del documento', fmtDateEs(corr.reference_date)],
      ['Estado', 'Firmado electrónicamente — Proceso completado'],
      ['Fecha de completado', fmtTs(auditReq.completed_at)],
      ['ID de transacción (SHA-256)', hashStr.slice(0, 52) + (hashStr.length > 52 ? '…' : '')],
    ];

    // Table header
    doc.rect(AL, ay, AW, 17).fill('#1E3A5F');
    doc.fillColor('white').fontSize(8).font('Helvetica-Bold')
       .text('Información del Documento', AL + 6, ay + 5, { width: AW - 12, lineBreak: false });
    ay += 17;

    infoRows.forEach(([label, value], i) => {
      const bg = i % 2 === 0 ? '#F8FAFC' : '#FFFFFF';
      doc.rect(AL, ay, AW, ROW_H).fill(bg);
      doc.rect(AL, ay, AW, ROW_H).strokeColor('#E2E8F0').lineWidth(0.3).stroke();
      doc.fillColor('#475569').fontSize(7.5).font('Helvetica-Bold')
         .text(label, AL + 6, ay + 7, { width: COL1 - 12, lineBreak: false });
      doc.fillColor('#111827').fontSize(7.5).font('Helvetica')
         .text(String(value), AL + COL1 + 4, ay + 7, { width: AW - COL1 - 8, lineBreak: false });
      ay += ROW_H;
    });

    ay += 20;

    // ── Historial de firmas ──
    doc.rect(AL, ay, AW, 17).fill('#1E3A5F');
    doc.fillColor('white').fontSize(8).font('Helvetica-Bold')
       .text('Historial de Firmas', AL + 6, ay + 5, { width: AW - 12, lineBreak: false });
    ay += 22;

    // Build events
    const auditEvents = [];
    auditEvents.push({
      color: '#1B5FAA', icon: '●',
      title: 'Proceso de firmas iniciado',
      detail: fmtTs(auditReq.created_at),
    });
    signers.forEach((s) => {
      auditEvents.push({
        color: '#0891B2', icon: '◆',
        title: `Invitación enviada a ${s.signer_name}`,
        detail: `${s.signer_email}${s.signer_role ? ' · ' + s.signer_role : ''}`,
      });
      if (s.status === 'signed') {
        auditEvents.push({
          color: '#059669', icon: '✓',
          title: `Firmado por ${s.signer_name}`,
          detail: `${fmtTs(s.signed_at)}${s.ip_address ? ' · IP: ' + s.ip_address : ''}`,
        });
      }
      if (s.status === 'rejected') {
        auditEvents.push({
          color: '#DC2626', icon: '✗',
          title: `Rechazado por ${s.signer_name}`,
          detail: s.rejection_reason || '—',
        });
      }
    });
    if (auditReq.completed_at) {
      auditEvents.push({
        color: '#059669', icon: '★',
        title: 'Proceso completado — todos los firmantes han firmado',
        detail: fmtTs(auditReq.completed_at),
      });
    }

    const DOT_X = AL + 8;
    const EV_H  = 30;

    for (let i = 0; i < auditEvents.length; i++) {
      const ev = auditEvents[i];
      if (ay + EV_H > PAGE_H - 80) { doc.addPage(); ay = 40; }

      // Dot
      doc.circle(DOT_X, ay + 9, 5).fill(ev.color);
      // Connector line
      if (i < auditEvents.length - 1) {
        doc.moveTo(DOT_X, ay + 15).lineTo(DOT_X, ay + EV_H)
           .strokeColor('#E2E8F0').lineWidth(1).stroke();
      }
      // Text
      doc.fillColor('#111827').fontSize(9).font('Helvetica-Bold')
         .text(ev.title, AL + 20, ay + 2, { width: AW - 24, lineBreak: false });
      doc.fillColor('#64748B').fontSize(7.5).font('Helvetica')
         .text(ev.detail, AL + 20, ay + 15, { width: AW - 24, lineBreak: false });
      ay += EV_H;
    }

    // ── Legal footer ──
    ay += 20;
    if (ay + 50 > PAGE_H - 30) { doc.addPage(); ay = 40; }
    doc.rect(AL, ay, AW, 0.5).fill('#CBD5E1');
    ay += 10;
    doc.fillColor('#94A3B8').fontSize(7).font('Helvetica')
       .text(
         'Este informe de auditoría constituye evidencia de firma electrónica con plena validez jurídica conforme a la Ley 527 de 1999 y el Decreto 1074 de 2015 de la República de Colombia. El identificador de transacción (hash SHA-256) garantiza la integridad del documento original. Cualquier modificación posterior al proceso de firma invalida este certificado. SGIP-IA · Sistema de Gestión Integral de Proyectos con IA.',
         AL, ay, { width: AW, align: 'justify' },
       );
  }

  // Finalize — flushPages() writes all bufferPages content to the stream before end().
  doc.flushPages();
  doc.end();
  return new Promise((resolve, reject) => {
    doc.on('end', () => resolve({ buffer: Buffer.concat(chunks), pageCount: contentPageCount }));
    doc.on('error', reject);
  });
}

// ════════════════════════════════════════════════════════════════════
// AUTHENTICATED ROUTER  —  /api/exec/:projectId/correspondence/:correspondenceId/firma
// ════════════════════════════════════════════════════════════════════
const router = express.Router({ mergeParams: true });

// GET / — get current signature request status
router.get('/', authenticate, async (req, res) => {
  const { projectId, correspondenceId } = req.params;
  try {
    const [reqs] = await pool.execute(
      'SELECT * FROM corr_signature_requests WHERE correspondence_id=? AND project_id=? ORDER BY created_at DESC LIMIT 1',
      [correspondenceId, projectId]
    );
    if (!reqs.length) return res.json({ success: true, data: null });

    const [signers] = await pool.execute(
      'SELECT id,signer_name,signer_email,signer_role,sign_order,status,signed_at,ip_address,rejection_reason,page_num,x_percent,y_percent,width_percent,height_percent FROM corr_signature_signers WHERE request_id=? ORDER BY sign_order',
      [reqs[0].id]
    );
    res.json({ success: true, data: { ...reqs[0], signers } });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// POST / — create signature request
router.post('/', authenticate, async (req, res) => {
  const { projectId, correspondenceId } = req.params;
  const { signers } = req.body;

  if (!signers || !Array.isArray(signers) || signers.length === 0)
    return res.status(400).json({ error: 'Se requiere al menos un firmante' });

  for (const s of signers) {
    if (!s.name?.trim() || !s.email?.trim())
      return res.status(400).json({ error: 'Cada firmante requiere nombre y correo' });
    const pos = [s.x_percent, s.y_percent, s.width_percent, s.height_percent];
    if (pos.some(v => v === undefined || v === null || isNaN(parseFloat(v)) || parseFloat(v) < 0 || parseFloat(v) > 1))
      return res.status(400).json({ error: `El firmante "${s.name}" tiene coordenadas de posición inválidas (deben estar entre 0 y 1)` });
  }

  try {
    const [[corr]] = await pool.execute('SELECT * FROM correspondence WHERE id=? AND project_id=?', [correspondenceId, projectId]);
    if (!corr) return res.status(404).json({ error: 'Correspondencia no encontrada' });

    const [[project]] = await pool.execute('SELECT id,name,code,client_name,correspondence_sender_name,correspondence_logo FROM projects WHERE id=?', [projectId]);
    if (!project) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const [existing] = await pool.execute(
      "SELECT id FROM corr_signature_requests WHERE correspondence_id=? AND status='in_progress'", [correspondenceId]
    );
    if (existing.length) return res.status(409).json({ error: 'Ya hay un proceso de firma activo para esta correspondencia' });

    const docHash = crypto.createHash('sha256').update(JSON.stringify({
      id: corr.id, subject: corr.subject, body: corr.body,
      closing: corr.closing, consecutive_code: corr.consecutive_code,
    })).digest('hex');

    const [result] = await pool.execute(
      "INSERT INTO corr_signature_requests (correspondence_id,project_id,status,created_by,document_hash) VALUES (?,?,'in_progress',?,?)",
      [correspondenceId, projectId, req.user.id, docHash]
    );
    const requestId = result.insertId;

    const signerRecords = [];
    for (const s of signers) {
      const token = crypto.randomBytes(32).toString('hex');
      const order = s.order || 1;
      await pool.execute(
        'INSERT INTO corr_signature_signers (request_id,signer_name,signer_email,signer_role,sign_order,token,page_num,x_percent,y_percent,width_percent,height_percent) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [requestId, s.name.trim(), s.email.trim().toLowerCase(), s.role || '', order, token,
         s.page_num || 1, s.x_percent, s.y_percent, s.width_percent, s.height_percent]
      );
      signerRecords.push({ ...s, signer_name: s.name.trim(), signer_email: s.email.trim().toLowerCase(), signer_role: s.role || '', token, sign_order: order, status: 'pending' });
    }

    // Notify first signer
    const first = signerRecords.sort((a, b) => a.sign_order - b.sign_order)[0];
    const emailCfg = await loadEmailConfig();
    if (first) {
      await trySendMail(emailCfg, {
        to: first.signer_email,
        subject: `✍️ Firma requerida: ${corr.subject} — ${project.name}`,
        html: emailInviteCorr({ signer: first, corr, project, allSigners: signerRecords, position: 1 }),
      });
      await pool.execute("UPDATE corr_signature_signers SET status='notified' WHERE token=?", [first.token]);
    }

    res.status(201).json({ success: true, data: { requestId } });
  } catch (e) { console.error('[corrSig POST /]', e); res.status(500).json({ error: e.message }); }
});

// DELETE / — cancel active request
router.delete('/', authenticate, async (req, res) => {
  const { projectId, correspondenceId } = req.params;
  try {
    const [reqs] = await pool.execute(
      "SELECT * FROM corr_signature_requests WHERE correspondence_id=? AND project_id=? AND status='in_progress'",
      [correspondenceId, projectId]
    );

    await pool.execute(
      "UPDATE corr_signature_requests SET status='cancelled' WHERE correspondence_id=? AND project_id=? AND status='in_progress'",
      [correspondenceId, projectId]
    );

    if (reqs.length) {
      const req_ = reqs[0];
      const [[corr]]    = await pool.execute('SELECT id,subject,consecutive_code,correspondence_type FROM correspondence WHERE id=?', [req_.correspondence_id]);
      const [[project]] = await pool.execute('SELECT id,name,code,client_name,correspondence_sender_name,correspondence_logo FROM projects WHERE id=?', [req_.project_id]);
      const [signers]   = await pool.execute('SELECT * FROM corr_signature_signers WHERE request_id=? ORDER BY sign_order', [req_.id]);
      const emailCfg = await loadEmailConfig();
      const cancelHtml = emailCancelledCorr({ corr, project, type: 'cancelled' });
      for (const s of signers) {
        await trySendMail(emailCfg, {
          to: s.signer_email,
          subject: `🚫 Proceso cancelado: ${corr.subject} — ${project.name}`,
          html: cancelHtml,
        });
      }
    }

    res.json({ success: true });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// GET /pdf — return PDF preview for admin positioning UI (no signatures, no placeholders)
router.get('/pdf', authenticate, async (req, res) => {
  const { projectId, correspondenceId } = req.params;
  try {
    const [[corr]] = await pool.execute('SELECT * FROM correspondence WHERE id=? AND project_id=?', [correspondenceId, projectId]);
    if (!corr) return res.status(404).json({ error: 'Correspondencia no encontrada' });
    const [[project]] = await pool.execute('SELECT id,name,code,client_name,correspondence_sender_name,correspondence_logo FROM projects WHERE id=?', [projectId]);

    const result = await buildCorrespondencePdf(corr, project, [], {});
    // X-PDF-Pages lets the frontend set the container height dynamically
    // so signature placement works for 1-page, 2-page, 5-page, 15-page docs.
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${corr.consecutive_code || 'preview'}.pdf"`);
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('X-PDF-Pages', result.pageCount);
    res.setHeader('Access-Control-Expose-Headers', 'X-PDF-Pages');
    res.send(result.buffer);
  } catch (e) { console.error('[corrSig GET /pdf]', e); res.status(500).json({ error: e.message }); }
});

// GET /certificate — return final signed PDF (completed processes only)
router.get('/certificate', authenticate, async (req, res) => {
  const { projectId, correspondenceId } = req.params;
  try {
    const [[corr]] = await pool.execute('SELECT * FROM correspondence WHERE id=? AND project_id=?', [correspondenceId, projectId]);
    if (!corr) return res.status(404).json({ error: 'Correspondencia no encontrada' });
    const [[project]] = await pool.execute('SELECT id,name,code,client_name,correspondence_sender_name,correspondence_logo FROM projects WHERE id=?', [projectId]);

    const [reqs] = await pool.execute(
      "SELECT * FROM corr_signature_requests WHERE correspondence_id=? AND project_id=? AND status='completed' ORDER BY completed_at DESC LIMIT 1",
      [correspondenceId, projectId]
    );
    if (!reqs.length) return res.status(404).json({ error: 'No hay proceso completado para esta correspondencia' });

    const [signers] = await pool.execute(
      'SELECT * FROM corr_signature_signers WHERE request_id=? ORDER BY sign_order', [reqs[0].id]
    );
    const result = await buildCorrespondencePdf(corr, project, signers, { withSignatures: true, request: reqs[0] });
    const filename = `Firmado_${corr.consecutive_code || correspondenceId}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(result.buffer);
  } catch (e) { console.error('[corrSig GET /certificate]', e); res.status(500).json({ error: e.message }); }
});

// ════════════════════════════════════════════════════════════════════
// PUBLIC ROUTER  —  /api/firma/corr
// ════════════════════════════════════════════════════════════════════
const publicRouter = express.Router();

// GET /:token — signing page data (public, no auth)
publicRouter.get('/:token', async (req, res) => {
  try {
    const [signers] = await pool.execute(
      'SELECT * FROM corr_signature_signers WHERE token=?', [req.params.token]
    );
    if (!signers.length) return res.status(404).json({ error: 'Enlace de firma inválido o expirado' });
    const signer = signers[0];

    const [reqs] = await pool.execute('SELECT * FROM corr_signature_requests WHERE id=?', [signer.request_id]);
    if (!reqs.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const req_ = reqs[0];

    const [allSigners] = await pool.execute(
      'SELECT id,signer_name,signer_role,sign_order,status,signed_at FROM corr_signature_signers WHERE request_id=? ORDER BY sign_order',
      [req_.id]
    );
    const [[corr]] = await pool.execute(
      'SELECT id,subject,consecutive_code,correspondence_type,reference_date,recipient_name,recipient_entity,recipient_city,contract_reference FROM correspondence WHERE id=?',
      [req_.correspondence_id]
    );
    const [[project]] = await pool.execute('SELECT id,name,code,client_name,correspondence_sender_name,correspondence_logo FROM projects WHERE id=?', [req_.project_id]);

    if (signer.status === 'notified')
      await pool.execute("UPDATE corr_signature_signers SET status='viewed' WHERE token=?", [req.params.token]);

    res.json({
      success: true,
      data: {
        signer: {
          id: signer.id,
          signer_name: signer.signer_name, signer_email: signer.signer_email,
          signer_role: signer.signer_role, sign_order: signer.sign_order,
          status: signer.status,
          page_num: signer.page_num, x_percent: signer.x_percent, y_percent: signer.y_percent,
          width_percent: signer.width_percent, height_percent: signer.height_percent,
        },
        request: { id: req_.id, status: req_.status, document_hash: req_.document_hash },
        allSigners: allSigners.map(s => ({
          id: s.id, signer_name: s.signer_name, signer_role: s.signer_role,
          sign_order: s.sign_order, status: s.status, signed_at: s.signed_at,
        })),
        corr: {
          id: corr.id, subject: corr.subject, consecutive_code: corr.consecutive_code,
          correspondence_type: corr.correspondence_type, reference_date: corr.reference_date,
          recipient_name: corr.recipient_name, recipient_entity: corr.recipient_entity,
          recipient_city: corr.recipient_city, contract_reference: corr.contract_reference,
          typeLabel: TYPE_LABEL[corr.correspondence_type] || 'COMUNICACIÓN',
        },
        project: { name: project.name, code: project.code, client_name: project.client_name },
      },
    });
  } catch (e) { console.error('[corrSig public GET]', e); res.status(500).json({ error: e.message }); }
});

// GET /:token/pdf — PDF with placeholder boxes (shows signer WHERE to sign)
publicRouter.get('/:token/pdf', async (req, res) => {
  try {
    const [signers] = await pool.execute('SELECT * FROM corr_signature_signers WHERE token=?', [req.params.token]);
    if (!signers.length) return res.status(404).json({ error: 'Enlace de firma inválido' });
    const signer = signers[0];

    const [reqs] = await pool.execute('SELECT * FROM corr_signature_requests WHERE id=?', [signer.request_id]);
    if (!reqs.length) return res.status(404).json({ error: 'Solicitud no encontrada' });
    const req_ = reqs[0];

    const [[corr]]    = await pool.execute('SELECT * FROM correspondence WHERE id=?', [req_.correspondence_id]);
    const [[project]] = await pool.execute('SELECT id,name,code,client_name,correspondence_sender_name,correspondence_logo FROM projects WHERE id=?', [req_.project_id]);
    const [allSigners] = await pool.execute(
      'SELECT * FROM corr_signature_signers WHERE request_id=? ORDER BY sign_order', [req_.id]
    );

    const result = await buildCorrespondencePdf(corr, project, allSigners, { showPlaceholders: true });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', 'inline; filename="documento.pdf"');
    res.setHeader('Cache-Control', 'no-cache');
    res.send(result.buffer);
  } catch (e) { console.error('[corrSig public GET /pdf]', e); res.status(500).json({ error: e.message }); }
});

// POST /:token/firmar — submit signature
publicRouter.post('/:token/firmar', async (req, res) => {
  const { signature_image } = req.body;
  if (!signature_image) return res.status(400).json({ error: 'Se requiere la imagen de firma' });

  try {
    const [signers] = await pool.execute('SELECT * FROM corr_signature_signers WHERE token=?', [req.params.token]);
    if (!signers.length) return res.status(404).json({ error: 'Enlace de firma inválido' });
    const signer = signers[0];

    if (signer.status === 'signed')   return res.status(409).json({ error: 'Ya firmaste este documento' });
    if (signer.status === 'rejected') return res.status(409).json({ error: 'Ya rechazaste este documento' });

    const [reqs] = await pool.execute('SELECT * FROM corr_signature_requests WHERE id=?', [signer.request_id]);
    if (!reqs.length || reqs[0].status !== 'in_progress')
      return res.status(409).json({ error: 'El proceso de firma ya no está activo' });

    const req_ = reqs[0];
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.socket.remoteAddress || '';
    const ua = req.headers['user-agent'] || '';

    // Verify it's their turn
    const [prevSigners] = await pool.execute(
      "SELECT * FROM corr_signature_signers WHERE request_id=? AND sign_order < ? AND status != 'signed' ORDER BY sign_order",
      [signer.request_id, signer.sign_order]
    );
    if (prevSigners.length)
      return res.status(409).json({ error: `Esperando la firma de ${prevSigners[0].signer_name}` });

    // Save signature
    await pool.execute(
      "UPDATE corr_signature_signers SET status='signed', signature_image=?, signed_at=NOW(), ip_address=?, user_agent=? WHERE token=?",
      [signature_image, ip, ua, req.params.token]
    );

    // Check if all signed
    const [pending] = await pool.execute(
      "SELECT * FROM corr_signature_signers WHERE request_id=? AND status NOT IN ('signed') ORDER BY sign_order",
      [signer.request_id]
    );

    const [[corr]]    = await pool.execute('SELECT * FROM correspondence WHERE id=?', [req_.correspondence_id]);
    const [[project]] = await pool.execute('SELECT * FROM projects WHERE id=?', [req_.project_id]);
    const emailCfg    = await loadEmailConfig();

    if (pending.length === 0) {
      // All signed → complete
      await pool.execute(
        "UPDATE corr_signature_requests SET status='completed', completed_at=NOW() WHERE id=?",
        [signer.request_id]
      );
      const [allSigners] = await pool.execute(
        'SELECT * FROM corr_signature_signers WHERE request_id=? ORDER BY sign_order', [signer.request_id]
      );
      const [[completedReq]] = await pool.execute(
        'SELECT * FROM corr_signature_requests WHERE id=?', [signer.request_id]
      );

      // Generate signed PDF to attach
      let pdfAttachment = null;
      try {
        const result = await buildCorrespondencePdf(corr, project, allSigners, { withSignatures: true, request: completedReq });
        const pdfName = `Firmado_${corr.consecutive_code || corr.id}.pdf`;
        pdfAttachment = [{ filename: pdfName, content: result.buffer, contentType: 'application/pdf' }];
      } catch (pdfErr) {
        console.error('[corrSignatures] PDF generation for email failed:', pdfErr.message);
      }

      const completedHtml = emailCompletedCorr({ corr, project, allSigners, documentHash: completedReq.document_hash });
      for (const s of allSigners) {
        await trySendMail(emailCfg, {
          to: s.signer_email,
          subject: `✅ Documento firmado: ${corr.subject} — ${project.name}`,
          html: completedHtml,
          attachments: pdfAttachment,
        });
      }
      return res.json({ success: true, message: 'Firma registrada. Todos los firmantes han completado el proceso.', allSigned: true });
    }

    // Notify next signer
    const next = pending[0];
    const [allSigners] = await pool.execute(
      'SELECT * FROM corr_signature_signers WHERE request_id=? ORDER BY sign_order', [signer.request_id]
    );
    const position = allSigners.findIndex(s => s.id === next.id) + 1;
    await trySendMail(emailCfg, {
      to: next.signer_email,
      subject: `✍️ Firma requerida: ${corr.subject} — ${project.name}`,
      html: emailInviteCorr({ signer: next, corr, project, allSigners, position }),
    });
    await pool.execute("UPDATE corr_signature_signers SET status='notified' WHERE id=?", [next.id]);

    res.json({
      success: true,
      message: `Firma registrada. Notificación enviada a ${next.signer_name}.`,
      allSigned: false,
    });
  } catch (e) { console.error('[corrSig POST /firmar]', e); res.status(500).json({ error: e.message }); }
});

// POST /:token/rechazar — reject (public)
publicRouter.post('/:token/rechazar', async (req, res) => {
  const { reason } = req.body;
  try {
    const [signers] = await pool.execute('SELECT * FROM corr_signature_signers WHERE token=?', [req.params.token]);
    if (!signers.length) return res.status(404).json({ error: 'Enlace de firma inválido' });
    const signer = signers[0];
    if (['signed','rejected'].includes(signer.status))
      return res.status(409).json({ error: 'Ya procesaste este documento' });

    await pool.execute(
      "UPDATE corr_signature_signers SET status='rejected', rejection_reason=?, signed_at=NOW(), ip_address=? WHERE token=?",
      [reason || '', req.socket.remoteAddress || '', req.params.token]
    );
    await pool.execute(
      "UPDATE corr_signature_requests SET status='rejected' WHERE id=? AND status='in_progress'",
      [signer.request_id]
    );

    const [reqs] = await pool.execute('SELECT * FROM corr_signature_requests WHERE id=?', [signer.request_id]);
    const [[corr]]    = await pool.execute('SELECT id,subject,consecutive_code,correspondence_type FROM correspondence WHERE id=?', [reqs[0].correspondence_id]);
    const [[project]] = await pool.execute('SELECT id,name,code,client_name,correspondence_sender_name,correspondence_logo FROM projects WHERE id=?', [reqs[0].project_id]);
    const [allSigners] = await pool.execute(
      'SELECT * FROM corr_signature_signers WHERE request_id=? ORDER BY sign_order', [signer.request_id]
    );
    const emailCfg = await loadEmailConfig();

    const cancelledHtml = emailCancelledCorr({ corr, project, type: 'rejected', cancelledBy: signer.signer_name, reason });
    for (const s of allSigners) {
      if (s.id === signer.id) continue;
      await trySendMail(emailCfg, {
        to: s.signer_email,
        subject: `🚫 Proceso cancelado: ${corr.subject} — ${project.name}`,
        html: cancelledHtml,
      });
    }

    res.json({ success: true, message: 'Has rechazado la firma. Los demás firmantes han sido notificados.' });
  } catch (e) { console.error('[corrSig POST /rechazar]', e); res.status(500).json({ error: e.message }); }
});

module.exports = { corrSigRouter: router, corrSigPublicRouter: publicRouter };
