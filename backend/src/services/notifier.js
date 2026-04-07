/**
 * Email Notification Service — SGIP-IA
 *
 * Dispatches system email notifications based on configuration in system_settings.
 * All calls are fire-and-forget: routes call notify(...).catch(...) without awaiting.
 *
 * Event types:
 *   Immediate:  acta.created | commitment.created | correspondence.received | payment.approved
 *   Scheduled:  commitment.reminder | commitment.overdue | payment.due_reminder
 */
const db         = require('../config/database');
const { sendMail } = require('./mailer');

// ─── Notification type definitions (shared truth) ────────────────────────────
const NOTIFICATION_TYPES = [
  // ── Immediate ──
  { id: 'acta.created',           category: 'instant',   label: 'Acta creada',                  desc: 'Al firmar y crear una nueva acta de comité',             default_recipients: 'project_team' },
  { id: 'commitment.created',     category: 'instant',   label: 'Compromiso creado',             desc: 'Al registrar un nuevo compromiso en un acta',            default_recipients: 'project_team' },
  { id: 'correspondence.received',category: 'instant',   label: 'Correspondencia recibida',      desc: 'Al ingresar nueva correspondencia al sistema',           default_recipients: 'project_team' },
  { id: 'payment.approved',       category: 'instant',   label: 'Pago aprobado',                 desc: 'Al aprobar un pago de proyecto',                         default_recipients: 'admins'       },
  // ── Scheduled ──
  { id: 'commitment.reminder',    category: 'scheduled', label: 'Recordatorio de compromiso',       desc: 'Días antes del vencimiento de un compromiso',                      default_recipients: 'project_team', default_lead_days: 3  },
  { id: 'commitment.overdue',     category: 'scheduled', label: 'Alerta de compromisos vencidos',   desc: 'Resumen diario de compromisos sin cumplir que ya vencieron',        default_recipients: 'admins',       schedule: 'daily'     },
  { id: 'payment.due_reminder',   category: 'scheduled', label: 'Recordatorio de corte de pago',    desc: 'Días antes del cierre de período de un pago',                      default_recipients: 'admins',       default_lead_days: 5  },
  // ── Vencimientos ──
  { id: 'policy.expiring',        category: 'scheduled', label: 'Póliza próxima a vencer',          desc: 'Alerta cuando una póliza vence en los próximos días (30/15/7/1)',  default_recipients: 'project_team', default_lead_days: 30 },
  { id: 'policy.expired',         category: 'scheduled', label: 'Póliza vencida',                   desc: 'Resumen diario de pólizas ya vencidas en proyectos activos',       default_recipients: 'admins',       schedule: 'daily'     },
  { id: 'contract.ending',        category: 'scheduled', label: 'Contrato próximo a terminar',      desc: 'Alerta cuando el plazo de ejecución está por vencer (60/30/15d)',  default_recipients: 'project_team', default_lead_days: 60 },
  { id: 'milestone.overdue',      category: 'scheduled', label: 'Hito vencido con entregables',     desc: 'Resumen diario de hitos cuya fecha pasó con entregables sin cerrar',default_recipients: 'project_team', schedule: 'daily'     },
];
module.exports.NOTIFICATION_TYPES = NOTIFICATION_TYPES;

// ─── Load configs ─────────────────────────────────────────────────────────────
async function loadNotifConfig() {
  try {
    const [rows] = await db.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'notification_config'");
    if (!rows.length || !rows[0].setting_value) return { enabled: false, notifications: {} };
    return JSON.parse(rows[0].setting_value);
  } catch { return { enabled: false, notifications: {} }; }
}

async function loadEmailConfig() {
  try {
    const [rows] = await db.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'email_config'");
    if (!rows.length || !rows[0].setting_value) return null;
    return JSON.parse(rows[0].setting_value);
  } catch { return null; }
}

// ─── Recipient resolution ─────────────────────────────────────────────────────
async function getRecipients(recipientType, customEmails = [], projectId = null) {
  const emails = new Set();

  try {
    if (recipientType === 'admins' || recipientType === 'project_team') {
      const [admins] = await db.execute(
        "SELECT email FROM users WHERE role IN ('admin', 'visor', 'director_pmo') AND is_active = 1"
      );
      admins.forEach(r => emails.add(r.email));
    }

    if (recipientType === 'project_team' && projectId) {
      const [team] = await db.execute(
        `SELECT u.email FROM users u
         JOIN project_assignments pa ON pa.user_id = u.id
         WHERE pa.project_id = ? AND pa.is_active = 1 AND u.is_active = 1`,
        [projectId]
      );
      team.forEach(r => emails.add(r.email));
    }
  } catch (e) {
    console.warn('[notifier] recipient query error:', e.message);
  }

  // Always add custom emails from config
  if (Array.isArray(customEmails)) {
    customEmails.filter(e => e && e.includes('@')).forEach(e => emails.add(e.trim()));
  }

  return [...emails];
}

// ─── Notification log (dedup) ─────────────────────────────────────────────────
async function ensureLogTable() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS notification_log (
        id                INT PRIMARY KEY AUTO_INCREMENT,
        notification_type VARCHAR(60)  NOT NULL,
        ref_type          VARCHAR(40)  NOT NULL,
        ref_id            INT          NOT NULL,
        sent_date         DATE         NOT NULL,
        created_at        TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE KEY uq_notif (notification_type, ref_type, ref_id, sent_date)
      )
    `);
  } catch {}
}
ensureLogTable();

async function wasAlreadySent(type, refType, refId) {
  try {
    const [rows] = await db.execute(
      'SELECT id FROM notification_log WHERE notification_type = ? AND ref_type = ? AND ref_id = ? AND sent_date = CURDATE()',
      [type, refType, refId]
    );
    return rows.length > 0;
  } catch { return false; }
}

async function markSent(type, refType, refId) {
  try {
    await db.execute(
      'INSERT IGNORE INTO notification_log (notification_type, ref_type, ref_id, sent_date) VALUES (?, ?, ?, CURDATE())',
      [type, refType, refId]
    );
  } catch {}
}

// ─── Email HTML templates ─────────────────────────────────────────────────────
const BRAND = '#1e3a5f';
const BRAND_LIGHT = '#e8f0fb';
const APP_URL = (process.env.APP_URL || 'https://sigp.tecnofactory.net.co').replace(/\/$/, '');

function wrap(content) {
  return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif">
  <div style="max-width:560px;margin:32px auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.08);border:1px solid #e2e8f0">
    <div style="background:${BRAND};padding:24px 28px">
      <span style="color:#fff;font-size:18px;font-weight:700;letter-spacing:-.3px">SGIP-IA</span>
      <span style="color:rgba(255,255,255,.5);font-size:12px;margin-left:10px">Sistema de Gestión de Proyectos</span>
    </div>
    <div style="padding:28px">
      ${content}
    </div>
    <div style="padding:16px 28px;border-top:1px solid #f1f5f9;background:#f8fafc">
      <p style="margin:0;font-size:11px;color:#94a3b8">
        Este es un mensaje automático de SGIP-IA. No responda a este correo.
      </p>
    </div>
  </div>
</body></html>`;
}

function badge(text, color = BRAND) {
  return `<span style="display:inline-block;padding:3px 10px;background:${color}20;color:${color};font-size:11px;font-weight:600;border-radius:20px;border:1px solid ${color}30">${text}</span>`;
}

function row(label, value) {
  return `<tr>
    <td style="padding:6px 0;color:#64748b;font-size:13px;width:40%;vertical-align:top">${label}</td>
    <td style="padding:6px 0;color:#1e293b;font-size:13px;font-weight:500">${value || '—'}</td>
  </tr>`;
}

function buildTemplate(type, data) {
  const { project_name = '', project_code = '' } = data;
  const projLabel  = project_code ? `[${project_code}] ${project_name}` : project_name;
  const projectUrl = data.project_id ? `${APP_URL}/adjudicacion/${data.project_id}` : null;
  const viewBtn    = (label = 'Ver proyecto →') => projectUrl
    ? `<a href="${projectUrl}" style="display:inline-block;margin-top:22px;padding:10px 22px;background:${BRAND};color:#fff;font-size:13px;font-weight:600;border-radius:8px;text-decoration:none">${label}</a>`
    : '';

  switch (type) {

    case 'acta.created':
      return {
        subject: `[SGIP-IA] Nueva acta de comité — ${projLabel}`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:${BRAND};font-size:18px">Nueva acta registrada</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">Se ha creado una nueva acta de comité en el sistema.</p>
          ${badge('Acta creada', '#0f766e')}
          <table style="width:100%;margin-top:18px;border-collapse:collapse">
            ${row('Proyecto', projLabel)}
            ${row('Tipo', data.minute_type || '')}
            ${row('Título', data.title || '')}
            ${row('Fecha', data.meeting_date ? new Date(data.meeting_date).toLocaleDateString('es-CO') : '')}
          </table>
          ${viewBtn()}
        `),
      };

    case 'commitment.created':
      return {
        subject: `[SGIP-IA] Nuevo compromiso asignado — ${projLabel}`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:${BRAND};font-size:18px">Nuevo compromiso registrado</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">Se ha registrado un nuevo compromiso de seguimiento.</p>
          ${badge('Compromiso', '#7c3aed')}
          <table style="width:100%;margin-top:18px;border-collapse:collapse">
            ${row('Proyecto', projLabel)}
            ${row('Descripción', data.description || '')}
            ${row('Responsable', data.responsible || '')}
            ${row('Fecha límite', data.due_date ? new Date(data.due_date).toLocaleDateString('es-CO') : '')}
            ${row('Prioridad', data.priority || '')}
          </table>
          ${viewBtn()}
        `),
      };

    case 'correspondence.received':
      return {
        subject: `[SGIP-IA] Nueva correspondencia — ${projLabel}`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:${BRAND};font-size:18px">Nueva correspondencia registrada</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">Se ha registrado correspondencia en el proyecto.</p>
          ${badge('Correspondencia', '#b45309')}
          <table style="width:100%;margin-top:18px;border-collapse:collapse">
            ${row('Proyecto', projLabel)}
            ${row('Asunto', data.subject || '')}
            ${row('Tipo', data.correspondence_type || '')}
            ${row('Radicado', data.radicado_number || '')}
            ${row('Fecha', data.reference_date ? new Date(data.reference_date).toLocaleDateString('es-CO') : '')}
          </table>
          ${viewBtn()}
        `),
      };

    case 'payment.approved':
      return {
        subject: `[SGIP-IA] Pago aprobado — ${projLabel}`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:${BRAND};font-size:18px">Pago aprobado</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">Un pago ha sido aprobado en el sistema.</p>
          ${badge('Pago aprobado', '#15803d')}
          <table style="width:100%;margin-top:18px;border-collapse:collapse">
            ${row('Proyecto', projLabel)}
            ${row('Concepto', data.concept || '')}
            ${row('Valor neto', data.net_value ? `$${Number(data.net_value).toLocaleString('es-CO')}` : '')}
            ${row('Período', data.period_to ? new Date(data.period_to).toLocaleDateString('es-CO') : '')}
          </table>
          ${viewBtn()}
        `),
      };

    case 'commitment.reminder': {
      const days = data.days_until;
      return {
        subject: `[SGIP-IA] Recordatorio: compromiso vence en ${days === 1 ? '1 día' : `${days} días`} — ${projLabel}`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:#b45309;font-size:18px">⏰ Compromiso próximo a vencer</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">El siguiente compromiso vence en <strong>${days === 1 ? '1 día' : `${days} días`}</strong>.</p>
          ${badge(`Vence en ${days}d`, '#b45309')}
          <table style="width:100%;margin-top:18px;border-collapse:collapse">
            ${row('Proyecto', projLabel)}
            ${row('Descripción', data.description || '')}
            ${row('Responsable', data.responsible || '')}
            ${row('Fecha límite', data.due_date ? new Date(data.due_date).toLocaleDateString('es-CO') : '')}
            ${row('Prioridad', data.priority || '')}
          </table>
          <div style="margin-top:18px;padding:12px 16px;background:#fffbeb;border-left:3px solid #f59e0b;border-radius:4px">
            <p style="margin:0;font-size:13px;color:#92400e">Actualiza el estado del compromiso antes de la fecha límite.</p>
          </div>
          ${viewBtn()}
        `),
      };
    }

    case 'commitment.overdue': {
      const items = data.items || [];
      const rows = items.map(c =>
        `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px 6px;font-size:12px;color:#1e293b">${c.project_code}</td>
          <td style="padding:8px 6px;font-size:12px;color:#1e293b">${c.description}</td>
          <td style="padding:8px 6px;font-size:12px;color:#64748b">${c.responsible || '—'}</td>
          <td style="padding:8px 6px;font-size:12px;color:#dc2626;font-weight:600">${c.days_overdue}d</td>
        </tr>`
      ).join('');
      return {
        subject: `[SGIP-IA] Resumen de compromisos vencidos — ${items.length} pendiente${items.length !== 1 ? 's' : ''}`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:#dc2626;font-size:18px">⚠️ Compromisos vencidos</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">Los siguientes compromisos han superado su fecha límite y requieren atención.</p>
          <table style="width:100%;border-collapse:collapse;font-size:12px">
            <thead>
              <tr style="background:#f8fafc">
                <th style="padding:8px 6px;text-align:left;color:#64748b;font-weight:600;font-size:11px">PROYECTO</th>
                <th style="padding:8px 6px;text-align:left;color:#64748b;font-weight:600;font-size:11px">COMPROMISO</th>
                <th style="padding:8px 6px;text-align:left;color:#64748b;font-weight:600;font-size:11px">RESPONSABLE</th>
                <th style="padding:8px 6px;text-align:left;color:#64748b;font-weight:600;font-size:11px">VENCIDO</th>
              </tr>
            </thead>
            <tbody>${rows}</tbody>
          </table>
          <p style="margin-top:16px;font-size:12px;color:#94a3b8">Total: ${items.length} compromisos pendientes de atención.</p>
        `),
      };
    }

    case 'payment.due_reminder': {
      const days = data.days_until;
      return {
        subject: `[SGIP-IA] Recordatorio: corte de pago en ${days === 1 ? '1 día' : `${days} días`} — ${projLabel}`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:#0f766e;font-size:18px">💳 Corte de pago próximo</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">El período de corte del siguiente pago finaliza en <strong>${days === 1 ? '1 día' : `${days} días`}</strong>.</p>
          ${badge(`Corte en ${days}d`, '#0f766e')}
          <table style="width:100%;margin-top:18px;border-collapse:collapse">
            ${row('Proyecto', projLabel)}
            ${row('Concepto', data.concept || '')}
            ${row('Valor neto', data.net_value ? `$${Number(data.net_value).toLocaleString('es-CO')}` : '')}
            ${row('Fin de período', data.period_to ? new Date(data.period_to).toLocaleDateString('es-CO') : '')}
            ${row('Estado', data.status || '')}
          </table>
          ${viewBtn()}
        `),
      };
    }

    case 'policy.expiring': {
      const days = data.days_until;
      const urgency = days <= 1 ? '#dc2626' : days <= 7 ? '#b45309' : '#0f766e';
      return {
        subject: `[SGIP-IA] Póliza vence en ${days === 1 ? '1 día' : `${days} días`} — ${projLabel}`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:${urgency};font-size:18px">🛡️ Póliza próxima a vencer</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">La siguiente póliza vence en <strong>${days === 1 ? '1 día' : `${days} días`}</strong>.</p>
          ${badge(`Vence en ${days}d`, urgency)}
          <table style="width:100%;margin-top:18px;border-collapse:collapse">
            ${row('Proyecto', projLabel)}
            ${row('Tipo de póliza', data.policy_type || '')}
            ${row('No. Póliza', data.policy_number || '')}
            ${row('Aseguradora', data.insurer || '')}
            ${row('Vencimiento', data.expiry_date ? new Date(data.expiry_date).toLocaleDateString('es-CO') : '')}
          </table>
          <div style="margin-top:18px;padding:12px 16px;background:#fef9c3;border-left:3px solid ${urgency};border-radius:4px">
            <p style="margin:0;font-size:13px;color:#92400e">Gestione la renovación de la póliza antes de su vencimiento para evitar incumplimientos contractuales.</p>
          </div>
          ${viewBtn()}
        `),
      };
    }

    case 'policy.expired': {
      const items = data.items || [];
      const rows_html = items.map(p =>
        `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px 6px;font-size:12px;color:#1e293b">${p.project_code}</td>
          <td style="padding:8px 6px;font-size:12px;color:#1e293b">${p.policy_type}${p.policy_number ? ' — ' + p.policy_number : ''}</td>
          <td style="padding:8px 6px;font-size:12px;color:#64748b">${p.insurer || '—'}</td>
          <td style="padding:8px 6px;font-size:12px;color:#dc2626;font-weight:600">${p.days_overdue}d vencida</td>
        </tr>`
      ).join('');
      return {
        subject: `[SGIP-IA] Pólizas vencidas — ${items.length} póliza${items.length !== 1 ? 's' : ''} requieren atención`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:#dc2626;font-size:18px">⚠️ Pólizas vencidas</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">Las siguientes pólizas han superado su fecha de vencimiento y requieren renovación inmediata.</p>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f8fafc">
              <th style="padding:8px 6px;text-align:left;color:#64748b;font-size:11px">PROYECTO</th>
              <th style="padding:8px 6px;text-align:left;color:#64748b;font-size:11px">PÓLIZA</th>
              <th style="padding:8px 6px;text-align:left;color:#64748b;font-size:11px">ASEGURADORA</th>
              <th style="padding:8px 6px;text-align:left;color:#64748b;font-size:11px">VENCIMIENTO</th>
            </tr></thead>
            <tbody>${rows_html}</tbody>
          </table>
        `),
      };
    }

    case 'contract.ending': {
      const days = data.days_until;
      const urgency = days <= 15 ? '#dc2626' : days <= 30 ? '#b45309' : '#0f766e';
      return {
        subject: `[SGIP-IA] Contrato termina en ${days === 1 ? '1 día' : `${days} días`} — ${projLabel}`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:${urgency};font-size:18px">📋 Plazo de ejecución próximo a vencer</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">El plazo de ejecución del contrato finaliza en <strong>${days === 1 ? '1 día' : `${days} días`}</strong>.</p>
          ${badge(`Termina en ${days}d`, urgency)}
          <table style="width:100%;margin-top:18px;border-collapse:collapse">
            ${row('Proyecto', projLabel)}
            ${row('Fecha de terminación', data.end_date ? new Date(data.end_date).toLocaleDateString('es-CO') : '')}
            ${row('Plazo total', data.execution_term ? `${data.execution_term} ${data.execution_term_unit || 'días'}` : '')}
          </table>
          <div style="margin-top:18px;padding:12px 16px;background:#fef9c3;border-left:3px solid ${urgency};border-radius:4px">
            <p style="margin:0;font-size:13px;color:#92400e">Verifique el estado de avance y gestione una prórroga si es necesario antes del vencimiento del plazo.</p>
          </div>
          ${viewBtn()}
        `),
      };
    }

    case 'milestone.overdue': {
      const items = data.items || [];
      const rows_html = items.map(m =>
        `<tr style="border-bottom:1px solid #f1f5f9">
          <td style="padding:8px 6px;font-size:12px;color:#1e293b">${m.project_code}</td>
          <td style="padding:8px 6px;font-size:12px;color:#1e293b">${m.name}</td>
          <td style="padding:8px 6px;font-size:12px;color:#64748b">${m.done_del}/${m.total_del}</td>
          <td style="padding:8px 6px;font-size:12px;color:#dc2626;font-weight:600">${m.days_overdue}d</td>
        </tr>`
      ).join('');
      return {
        subject: `[SGIP-IA] Hitos vencidos — ${items.length} hito${items.length !== 1 ? 's' : ''} con entregables pendientes`,
        html: wrap(`
          <h2 style="margin:0 0 6px;color:#dc2626;font-size:18px">⚑ Hitos vencidos con entregables pendientes</h2>
          <p style="margin:0 0 20px;color:#64748b;font-size:14px">Los siguientes hitos han superado su fecha de cierre y aún tienen entregables sin completar.</p>
          <table style="width:100%;border-collapse:collapse">
            <thead><tr style="background:#f8fafc">
              <th style="padding:8px 6px;text-align:left;color:#64748b;font-size:11px">PROYECTO</th>
              <th style="padding:8px 6px;text-align:left;color:#64748b;font-size:11px">HITO</th>
              <th style="padding:8px 6px;text-align:left;color:#64748b;font-size:11px">ENTREGABLES</th>
              <th style="padding:8px 6px;text-align:left;color:#64748b;font-size:11px">VENCIDO</th>
            </tr></thead>
            <tbody>${rows_html}</tbody>
          </table>
        `),
      };
    }

    default:
      return { subject: `[SGIP-IA] Notificación: ${type}`, html: wrap(`<p>Evento: ${type}</p>`) };
  }
}

// ─── Main notify function ─────────────────────────────────────────────────────
async function notify(type, data = {}) {
  try {
    const [cfg, emailCfg] = await Promise.all([loadNotifConfig(), loadEmailConfig()]);

    if (!cfg.enabled) return;
    if (!emailCfg?.provider_type) return; // Email not configured

    const typeCfg = (cfg.notifications || {})[type];
    if (!typeCfg || !typeCfg.enabled) return;

    const recipients = await getRecipients(
      typeCfg.recipients || 'admins',
      typeCfg.custom_emails,
      data.project_id
    );
    if (!recipients.length) return;

    const { subject, html } = buildTemplate(type, data);

    // Fire-and-forget to each recipient
    for (const to of recipients) {
      sendMail(emailCfg, { to, subject, html }).catch(e =>
        console.warn(`[notifier] failed to send ${type} to ${to}:`, e.message)
      );
    }
  } catch (e) {
    console.warn('[notifier] error in notify():', e.message);
  }
}

// ─── Scheduled batch sends ───────────────────────────────────────────────────

// Daily overdue digest
async function sendOverdueDigest() {
  try {
    const [cfg, emailCfg] = await Promise.all([loadNotifConfig(), loadEmailConfig()]);
    if (!cfg.enabled || !emailCfg?.provider_type) return;

    const typeCfg = (cfg.notifications || {})['commitment.overdue'];
    if (!typeCfg?.enabled) return;

    // Check dedup: only once per day (use ref_id=0 as sentinel)
    if (await wasAlreadySent('commitment.overdue', 'digest', 0)) return;

    const [overdue] = await db.execute(`
      SELECT cc.id, cc.description, cc.responsible, cc.due_date, cc.priority,
             p.code AS project_code, p.name AS project_name, p.id AS project_id,
             DATEDIFF(CURDATE(), cc.due_date) AS days_overdue
      FROM committee_commitments cc
      JOIN projects p ON p.id = cc.project_id
      WHERE cc.due_date < CURDATE()
        AND cc.status NOT IN ('cumplido', 'cancelado')
      ORDER BY cc.due_date ASC
      LIMIT 50
    `);

    if (!overdue.length) return;

    const recipients = await getRecipients(typeCfg.recipients || 'admins', typeCfg.custom_emails, null);
    if (!recipients.length) return;

    const { subject, html } = buildTemplate('commitment.overdue', { items: overdue });
    for (const to of recipients) {
      sendMail(emailCfg, { to, subject, html }).catch(e =>
        console.warn('[notifier] overdue digest error:', e.message)
      );
    }

    await markSent('commitment.overdue', 'digest', 0);
    console.log(`[notifier] overdue digest sent to ${recipients.length} recipients (${overdue.length} items)`);
  } catch (e) {
    console.warn('[notifier] sendOverdueDigest error:', e.message);
  }
}

// Commitment reminders (X days before due)
async function sendCommitmentReminders() {
  try {
    const [cfg, emailCfg] = await Promise.all([loadNotifConfig(), loadEmailConfig()]);
    if (!cfg.enabled || !emailCfg?.provider_type) return;

    const typeCfg = (cfg.notifications || {})['commitment.reminder'];
    if (!typeCfg?.enabled) return;

    const leadDays = typeCfg.lead_days ?? 3;

    const [upcoming] = await db.execute(`
      SELECT cc.id, cc.description, cc.responsible, cc.due_date, cc.priority,
             p.code AS project_code, p.name AS project_name, p.id AS project_id,
             DATEDIFF(cc.due_date, CURDATE()) AS days_until
      FROM committee_commitments cc
      JOIN projects p ON p.id = cc.project_id
      WHERE cc.due_date = DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND cc.status NOT IN ('cumplido', 'cancelado')
    `, [leadDays]);

    for (const item of upcoming) {
      if (await wasAlreadySent('commitment.reminder', 'commitment', item.id)) continue;

      const recipients = await getRecipients(
        typeCfg.recipients || 'project_team',
        typeCfg.custom_emails,
        item.project_id
      );
      if (!recipients.length) { await markSent('commitment.reminder', 'commitment', item.id); continue; }

      const { subject, html } = buildTemplate('commitment.reminder', { ...item });
      for (const to of recipients) {
        sendMail(emailCfg, { to, subject, html }).catch(e =>
          console.warn('[notifier] reminder error:', e.message)
        );
      }
      await markSent('commitment.reminder', 'commitment', item.id);
    }

    if (upcoming.length) console.log(`[notifier] commitment reminders: ${upcoming.length} sent`);
  } catch (e) {
    console.warn('[notifier] sendCommitmentReminders error:', e.message);
  }
}

// Payment due reminders (X days before period_to)
async function sendPaymentReminders() {
  try {
    const [cfg, emailCfg] = await Promise.all([loadNotifConfig(), loadEmailConfig()]);
    if (!cfg.enabled || !emailCfg?.provider_type) return;

    const typeCfg = (cfg.notifications || {})['payment.due_reminder'];
    if (!typeCfg?.enabled) return;

    const leadDays = typeCfg.lead_days ?? 5;

    const [upcoming] = await db.execute(`
      SELECT pay.id, pay.concept, pay.net_value, pay.period_to, pay.status,
             p.code AS project_code, p.name AS project_name, p.id AS project_id,
             DATEDIFF(pay.period_to, CURDATE()) AS days_until
      FROM payments pay
      JOIN projects p ON p.id = pay.project_id
      WHERE pay.period_to = DATE_ADD(CURDATE(), INTERVAL ? DAY)
        AND pay.status NOT IN ('pagado')
    `, [leadDays]);

    for (const item of upcoming) {
      if (await wasAlreadySent('payment.due_reminder', 'payment', item.id)) continue;

      const recipients = await getRecipients(
        typeCfg.recipients || 'admins',
        typeCfg.custom_emails,
        item.project_id
      );
      if (!recipients.length) { await markSent('payment.due_reminder', 'payment', item.id); continue; }

      const { subject, html } = buildTemplate('payment.due_reminder', { ...item });
      for (const to of recipients) {
        sendMail(emailCfg, { to, subject, html }).catch(e =>
          console.warn('[notifier] payment reminder error:', e.message)
        );
      }
      await markSent('payment.due_reminder', 'payment', item.id);
    }

    if (upcoming.length) console.log(`[notifier] payment reminders: ${upcoming.length} sent`);
  } catch (e) {
    console.warn('[notifier] sendPaymentReminders error:', e.message);
  }
}

// ── Policy expiry alerts ──────────────────────────────────────────────────────
async function sendPolicyExpiryAlerts() {
  try {
    const [cfg, emailCfg] = await Promise.all([loadNotifConfig(), loadEmailConfig()]);
    if (!cfg.enabled || !emailCfg?.provider_type) return;

    // Lead-day reminders
    const expiringCfg = (cfg.notifications || {})['policy.expiring'];
    if (expiringCfg?.enabled) {
      const leadDays = [30, 15, 7, 1];
      for (const days of leadDays) {
        const [rows] = await db.execute(`
          SELECT pol.id, pol.policy_type, pol.policy_number, pol.expiry_date, pol.insurer,
                 p.id AS project_id, p.code AS project_code, p.name AS project_name,
                 DATEDIFF(pol.expiry_date, CURDATE()) AS days_until
          FROM policies pol
          JOIN projects p ON p.id = pol.project_id
          WHERE pol.expiry_date = DATE_ADD(CURDATE(), INTERVAL ? DAY)
            AND pol.status NOT IN ('inactiva', 'cancelada')
            AND p.status NOT IN ('cerrado', 'liquidado')
        `, [days]);

        for (const item of rows) {
          if (await wasAlreadySent('policy.expiring', 'policy', item.id)) continue;
          const recipients = await getRecipients(expiringCfg.recipients || 'project_team', expiringCfg.custom_emails, item.project_id);
          if (!recipients.length) { await markSent('policy.expiring', 'policy', item.id); continue; }
          const { subject, html } = buildTemplate('policy.expiring', {
            ...item, project_name: item.project_name, project_code: item.project_code,
          });
          for (const to of recipients) sendMail(emailCfg, { to, subject, html }).catch(() => {});
          await markSent('policy.expiring', 'policy', item.id);
        }
      }
    }

    // Expired digest
    const expiredCfg = (cfg.notifications || {})['policy.expired'];
    if (expiredCfg?.enabled) {
      if (await wasAlreadySent('policy.expired', 'digest', 0)) return;
      const [expired] = await db.execute(`
        SELECT pol.id, pol.policy_type, pol.policy_number, pol.insurer,
               p.code AS project_code, DATEDIFF(CURDATE(), pol.expiry_date) AS days_overdue
        FROM policies pol
        JOIN projects p ON p.id = pol.project_id
        WHERE pol.expiry_date < CURDATE()
          AND pol.status NOT IN ('inactiva', 'cancelada')
          AND p.status NOT IN ('cerrado', 'liquidado')
        ORDER BY pol.expiry_date ASC LIMIT 30
      `);
      if (expired.length) {
        const recipients = await getRecipients(expiredCfg.recipients || 'admins', expiredCfg.custom_emails, null);
        const { subject, html } = buildTemplate('policy.expired', { items: expired });
        for (const to of recipients) sendMail(emailCfg, { to, subject, html }).catch(() => {});
        await markSent('policy.expired', 'digest', 0);
        console.log(`[notifier] policy.expired digest: ${expired.length} pólizas`);
      }
    }
  } catch (e) { console.warn('[notifier] sendPolicyExpiryAlerts:', e.message); }
}

// ── Contract ending alerts ────────────────────────────────────────────────────
async function sendContractEndingAlerts() {
  try {
    const [cfg, emailCfg] = await Promise.all([loadNotifConfig(), loadEmailConfig()]);
    if (!cfg.enabled || !emailCfg?.provider_type) return;

    const typeCfg = (cfg.notifications || {})['contract.ending'];
    if (!typeCfg?.enabled) return;

    for (const days of [60, 30, 15]) {
      const [rows] = await db.execute(`
        SELECT p.id, p.name, p.code, p.execution_term, p.execution_term_unit,
               CASE
                 WHEN p.execution_term_unit = 'dias'  THEN DATE_ADD(p.start_date, INTERVAL p.execution_term DAY)
                 WHEN p.execution_term_unit = 'meses' THEN DATE_ADD(p.start_date, INTERVAL p.execution_term MONTH)
                 WHEN p.execution_term_unit = 'años'  THEN DATE_ADD(p.start_date, INTERVAL p.execution_term YEAR)
                 ELSE DATE_ADD(p.start_date, INTERVAL p.execution_term DAY)
               END AS end_date
        FROM projects p
        WHERE p.status IN ('en_ejecucion', 'adjudicado')
          AND p.start_date IS NOT NULL AND p.execution_term IS NOT NULL
        HAVING DATEDIFF(end_date, CURDATE()) = ?
      `, [days]);

      for (const item of rows) {
        if (await wasAlreadySent('contract.ending', 'project', item.id)) continue;
        const recipients = await getRecipients(typeCfg.recipients || 'project_team', typeCfg.custom_emails, item.id);
        if (!recipients.length) { await markSent('contract.ending', 'project', item.id); continue; }
        const { subject, html } = buildTemplate('contract.ending', {
          ...item, project_name: item.name, project_code: item.code, days_until: days,
        });
        for (const to of recipients) sendMail(emailCfg, { to, subject, html }).catch(() => {});
        await markSent('contract.ending', 'project', item.id);
      }
    }
  } catch (e) { console.warn('[notifier] sendContractEndingAlerts:', e.message); }
}

// ── Milestone overdue digest ──────────────────────────────────────────────────
async function sendMilestoneOverdueAlerts() {
  try {
    const [cfg, emailCfg] = await Promise.all([loadNotifConfig(), loadEmailConfig()]);
    if (!cfg.enabled || !emailCfg?.provider_type) return;

    const typeCfg = (cfg.notifications || {})['milestone.overdue'];
    if (!typeCfg?.enabled) return;
    if (await wasAlreadySent('milestone.overdue', 'digest', 0)) return;

    const [milestones] = await db.execute(`
      SELECT m.id, m.name, p.code AS project_code, p.id AS project_id,
             DATEDIFF(CURDATE(), m.end_date) AS days_overdue,
             COUNT(d.id) AS total_del,
             SUM(CASE WHEN d.status = 'completado' THEN 1 ELSE 0 END) AS done_del
      FROM milestones m
      JOIN projects p ON p.id = m.project_id
      LEFT JOIN deliverables d ON d.milestone_id = m.id AND d.status != 'cancelado'
      WHERE m.end_date < CURDATE()
        AND m.status NOT IN ('completado', 'cancelado')
        AND p.status NOT IN ('cerrado', 'liquidado')
      GROUP BY m.id
      HAVING total_del > 0 AND done_del < total_del
      ORDER BY m.end_date ASC LIMIT 30
    `);

    if (!milestones.length) return;
    const recipients = await getRecipients(typeCfg.recipients || 'project_team', typeCfg.custom_emails, null);
    const { subject, html } = buildTemplate('milestone.overdue', { items: milestones });
    for (const to of recipients) sendMail(emailCfg, { to, subject, html }).catch(() => {});
    await markSent('milestone.overdue', 'digest', 0);
    console.log(`[notifier] milestone.overdue digest: ${milestones.length} hitos`);
  } catch (e) { console.warn('[notifier] sendMilestoneOverdueAlerts:', e.message); }
}

// Run all scheduled checks
async function runScheduledChecks() {
  await Promise.allSettled([
    sendCommitmentReminders(),
    sendPaymentReminders(),
    sendOverdueDigest(),
    sendPolicyExpiryAlerts(),
    sendContractEndingAlerts(),
    sendMilestoneOverdueAlerts(),
  ]);
}

module.exports = { notify, runScheduledChecks, NOTIFICATION_TYPES };
