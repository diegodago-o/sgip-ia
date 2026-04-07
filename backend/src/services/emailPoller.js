/**
 * emailPoller.js
 * Servicio de polling IMAP / Microsoft Graph para bandeja de entrada por proyecto.
 *
 * Proveedores soportados:
 *   imap       → IMAP libre (Zoho, AWS SES, etc.)
 *   gmail      → Gmail con App Password (imap.gmail.com:993)
 *   m365_basic → M365 SMTP AUTH (outlook.office365.com:993)
 *   m365_modern→ Microsoft Graph API (OAuth2 client credentials)
 */

const { ImapFlow }    = require('imapflow');
const { simpleParser }= require('mailparser');
const axios           = require('axios');
const crypto          = require('crypto');
const path            = require('path');
const fs              = require('fs');
const pool            = require('../config/database');

// ─── Encriptación AES-256-CBC ─────────────────────────────────────────────────
const ALGO = 'aes-256-cbc';

function getEncKey() {
  const raw = process.env.EMAIL_ENCRYPTION_KEY || '';
  if (raw.length === 64) return Buffer.from(raw, 'hex'); // 32 bytes hex
  return crypto.scryptSync(raw || 'sgip-email-key-default', 'sgip-iv-salt-v1', 32);
}

function encrypt(text) {
  if (!text) return null;
  const iv  = crypto.randomBytes(16);
  const key = getEncKey();
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const enc = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `${iv.toString('hex')}:${enc.toString('hex')}`;
}

function decrypt(enc) {
  if (!enc) return null;
  try {
    const [ivHex, dataHex] = enc.split(':');
    const iv   = Buffer.from(ivHex,  'hex');
    const data = Buffer.from(dataHex, 'hex');
    const key  = getEncKey();
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8');
  } catch { return null; }
}

module.exports = { encrypt, decrypt };

// ─── Directorio de adjuntos ───────────────────────────────────────────────────
const ATTACH_BASE = path.join(__dirname, '..', '..', 'uploads', 'correspondence');
if (!fs.existsSync(ATTACH_BASE)) fs.mkdirSync(ATTACH_BASE, { recursive: true });

// ─── Helpers ──────────────────────────────────────────────────────────────────
function safeText(str, max = 500) {
  return String(str || '').slice(0, max);
}

function toSqlDate(d) {
  if (!d) return null;
  try {
    const dt = d instanceof Date ? d : new Date(d);
    if (isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
  } catch { return null; }
}

/** Verifica si este message_id ya fue procesado para el proyecto */
async function isProcessed(projectId, messageId) {
  if (!messageId) return false;
  const [[row]] = await pool.execute(
    'SELECT id FROM email_inbox_processed WHERE project_id = ? AND message_id = ?',
    [projectId, String(messageId).slice(0, 200)]
  );
  return !!row;
}

/** Marca el message_id como procesado */
async function markProcessed(projectId, messageId) {
  if (!messageId) return;
  await pool.execute(
    'INSERT IGNORE INTO email_inbox_processed (project_id, message_id) VALUES (?, ?)',
    [projectId, String(messageId).slice(0, 200)]
  ).catch(() => {});
}

/** Guarda adjunto en disco y retorna path relativo */
async function saveAttachment(projectId, filename, content) {
  const dir = path.join(ATTACH_BASE, String(projectId));
  fs.mkdirSync(dir, { recursive: true });
  const ts   = Date.now();
  const safe = (filename || 'adjunto').replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 100);
  const fp   = path.join(dir, `${ts}_${safe}`);
  fs.writeFileSync(fp, content);
  return `uploads/correspondence/${projectId}/${ts}_${safe}`;
}

/** Crea la correspondencia de entrada en BD */
async function createEntrada(projectId, data, userId) {
  try {
    // Obtener datos del proyecto para rellenar campos
    const [[proj]] = await pool.execute(
      'SELECT code, contract_number, client_name, start_date FROM projects WHERE id = ?',
      [projectId]
    );
    if (!proj) return;

    // Código consecutivo de entrada
    const siglas = (proj.code || 'PRJ').split('-')[0].toUpperCase().slice(0, 6);
    const now    = new Date();
    const dateStr = `${now.getFullYear()}${String(now.getMonth()+1).padStart(2,'0')}${String(now.getDate()).padStart(2,'0')}`;
    const [[row]] = await pool.execute(
      "SELECT COALESCE(MAX(consecutive_num),0)+1 AS n FROM correspondence WHERE project_id = ? AND direction = 'entrada'",
      [projectId]
    );
    const n    = String(row.n).padStart(3, '0');
    const code = `${siglas}-ENT-${dateStr}-${n}`;

    const [r] = await pool.execute(`
      INSERT INTO correspondence
        (project_id, direction, consecutive_num, consecutive_code, correspondence_type,
         subject, reference_date, received_date,
         sender_entity_external, sender_name_external,
         notes, attachment_path, attachment_original_name,
         contract_reference, project_entity, project_start_date,
         status, created_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `, [
      projectId,
      'entrada',
      row.n,
      code,
      data.type || 'radicado',
      safeText(data.subject, 490),
      toSqlDate(data.date) || toSqlDate(new Date()),
      toSqlDate(new Date()),
      safeText(data.senderEntity, 290),
      safeText(data.senderName,   190),
      safeText(data.notes, 2000),
      data.attachmentPath   || null,
      data.attachmentName   || null,
      proj.contract_number  || null,
      proj.client_name      || null,
      toSqlDate(proj.start_date),
      'recibido',
      userId || 1,
    ]);
    return r.insertId;
  } catch (err) {
    console.error(`[emailPoller] Error creando correspondencia para proyecto ${projectId}:`, err.message);
    return null;
  }
}

/** Actualiza estado del inbox en BD */
async function updateInboxState(inboxId, updates) {
  const sets   = Object.keys(updates).map(k => `${k} = ?`).join(', ');
  const values = [...Object.values(updates), inboxId];
  await pool.execute(`UPDATE project_email_inbox SET ${sets} WHERE id = ?`, values).catch(() => {});
}

// ─── IMAP polling (imap, gmail, m365_basic) ───────────────────────────────────
async function pollImap(inbox) {
  const { ImapFlow } = require('imapflow');
  const { simpleParser } = require('mailparser');

  const providerDefaults = {
    gmail:      { host: 'imap.gmail.com',           port: 993, secure: true },
    m365_basic: { host: 'outlook.office365.com',    port: 993, secure: true },
    imap:       { host: inbox.imap_host || 'localhost', port: inbox.imap_port || 993, secure: inbox.imap_use_ssl !== false },
  };
  const def  = providerDefaults[inbox.provider] || providerDefaults.imap;
  const host = inbox.imap_host || def.host;
  const port = inbox.imap_port || def.port;
  const tls  = inbox.imap_use_ssl !== false;
  const user = inbox.username;
  const pass = decrypt(inbox.password_enc);

  if (!user || !pass) throw new Error('Credenciales IMAP no configuradas');

  const client = new ImapFlow({
    host, port,
    secure: tls,
    auth: { user, pass },
    logger: false,
    tls: { rejectUnauthorized: false }, // Acepta certs corporativos self-signed
  });

  let imported = 0;

  await client.connect();
  try {
    const lock = await client.getMailboxLock(inbox.imap_folder || 'INBOX');
    try {
      const lastUid = inbox.last_uid || 0;
      // Buscar mensajes nuevos (UID > lastUid), máximo 50 a la vez
      const searchResult = await client.search({ uid: `${lastUid + 1}:*` });

      // Filtrar solo UIDs realmente mayores (imapflow puede devolver el último si no hay nuevos)
      const uids = searchResult.filter(u => u > lastUid).slice(0, 50);
      if (uids.length === 0) return 0;

      let maxUid = lastUid;
      for (const uid of uids) {
        try {
          const msg = await client.fetchOne(`${uid}`, {
            source: true,
            uid: true,
          }, { uid: true });

          if (!msg?.source) continue;

          const parsed = await simpleParser(msg.source);
          const messageId = parsed.messageId || `uid-${uid}`;

          // Evitar duplicados
          if (await isProcessed(inbox.project_id, messageId)) {
            maxUid = Math.max(maxUid, uid);
            continue;
          }

          // Extraer remitente
          const fromAddr = parsed.from?.value?.[0];
          const senderEmail  = fromAddr?.address || '';
          const senderName   = fromAddr?.name    || senderEmail.split('@')[0] || '';
          const senderEntity = senderEmail.split('@')[1]?.replace(/\.(com|co|gov|org|net|edu).*/, '') || senderName;

          // Adjunto principal (primer PDF o Word)
          let attachmentPath = null, attachmentName = null;
          if (parsed.attachments?.length > 0) {
            const ALLOWED_EXTS = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.tiff', '.xlsx', '.xls'];
            const main = parsed.attachments.find(a => {
              const ext = path.extname(a.filename || '').toLowerCase();
              return ALLOWED_EXTS.includes(ext) && a.size < 30 * 1024 * 1024;
            }) || parsed.attachments[0];

            if (main?.content) {
              attachmentPath = await saveAttachment(inbox.project_id, main.filename || 'adjunto', main.content);
              attachmentName = main.filename || 'adjunto';
            }
          }

          // Notas: extracto del texto del correo
          const bodyText = (parsed.text || '').slice(0, 1000).trim();
          const notes = [
            `📧 De: ${senderName} <${senderEmail}>`,
            bodyText ? `\n${bodyText}` : '',
          ].filter(Boolean).join('');

          await createEntrada(inbox.project_id, {
            type:           'radicado',
            subject:        parsed.subject || '(Sin asunto)',
            date:           parsed.date,
            senderEntity:   senderEntity || senderEmail,
            senderName:     senderName,
            notes,
            attachmentPath,
            attachmentName,
          }, null);

          await markProcessed(inbox.project_id, messageId);
          maxUid = Math.max(maxUid, uid);
          imported++;
        } catch (msgErr) {
          console.warn(`[emailPoller] Error procesando UID ${uid}:`, msgErr.message);
        }
      }

      // Actualizar last_uid
      if (maxUid > lastUid) {
        await updateInboxState(inbox.id, { last_uid: maxUid });
      }
    } finally {
      lock.release();
    }
  } finally {
    await client.logout().catch(() => {});
  }
  return imported;
}

// ─── Graph API polling (m365_modern) ─────────────────────────────────────────
async function pollGraphApi(inbox) {
  const tenantId      = inbox.tenant_id;
  const clientId      = inbox.client_id;
  const clientSecret  = decrypt(inbox.client_secret_enc);
  const userEmail     = inbox.email;

  if (!tenantId || !clientId || !clientSecret || !userEmail)
    throw new Error('Credenciales M365 Auth Moderna incompletas');

  // 1. Obtener token
  const tokenRes = await axios.post(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     clientId,
      client_secret: clientSecret,
      scope:         'https://graph.microsoft.com/.default',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );
  const token = tokenRes.data.access_token;
  const graphHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  let imported = 0;
  let nextLink = inbox.graph_delta_link;

  // 2. Si no hay delta link, usar delta inicial (sólo mensajes recientes — últimas 48h)
  if (!nextLink) {
    const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    nextLink = `https://graph.microsoft.com/v1.0/users/${userEmail}/mailFolders/inbox/messages/delta?$filter=receivedDateTime ge ${since}&$top=20&$select=id,subject,from,receivedDateTime,bodyPreview,hasAttachments,internetMessageId`;
  }

  // 3. Paginar mensajes
  let url = nextLink;
  let lastDelta = nextLink;

  while (url) {
    const res = await axios.get(url, { headers: graphHeaders });
    const msgs = res.data.value || [];
    lastDelta  = res.data['@odata.deltaLink'] || lastDelta;
    url        = res.data['@odata.nextLink']  || null;

    for (const msg of msgs) {
      const messageId = msg.internetMessageId || msg.id;
      if (await isProcessed(inbox.project_id, messageId)) continue;

      // Extraer remitente
      const fromEmail  = msg.from?.emailAddress?.address || '';
      const fromName   = msg.from?.emailAddress?.name    || fromEmail.split('@')[0] || '';
      const fromEntity = fromEmail.split('@')[1]?.replace(/\.(com|co|gov|org|net|edu).*/, '') || fromName;

      // Adjuntos
      let attachmentPath = null, attachmentName = null;
      if (msg.hasAttachments) {
        try {
          const attRes = await axios.get(
            `https://graph.microsoft.com/v1.0/users/${userEmail}/messages/${msg.id}/attachments`,
            { headers: graphHeaders }
          );
          const ALLOWED_EXTS = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.tiff', '.xlsx', '.xls'];
          const main = (attRes.data.value || []).find(a => {
            const ext = path.extname(a.name || '').toLowerCase();
            return ALLOWED_EXTS.includes(ext) && a.size < 30 * 1024 * 1024 && a.contentBytes;
          });
          if (main) {
            const buf = Buffer.from(main.contentBytes, 'base64');
            attachmentPath = await saveAttachment(inbox.project_id, main.name, buf);
            attachmentName = main.name;
          }
        } catch (attErr) {
          console.warn(`[emailPoller] Error descargando adjuntos Graph:`, attErr.message);
        }
      }

      const notes = [
        `📧 De: ${fromName} <${fromEmail}>`,
        msg.bodyPreview ? `\n${msg.bodyPreview.slice(0, 500)}` : '',
      ].filter(Boolean).join('');

      await createEntrada(inbox.project_id, {
        type:         'radicado',
        subject:      msg.subject || '(Sin asunto)',
        date:         msg.receivedDateTime,
        senderEntity: fromEntity || fromEmail,
        senderName:   fromName,
        notes,
        attachmentPath,
        attachmentName,
      }, null);

      await markProcessed(inbox.project_id, messageId);
      imported++;
    }
  }

  // Guardar delta link para próxima llamada
  if (lastDelta && lastDelta !== inbox.graph_delta_link) {
    await updateInboxState(inbox.id, { graph_delta_link: lastDelta });
  }

  return imported;
}

// ─── Entry point: poll un inbox ───────────────────────────────────────────────
async function pollInbox(inbox) {
  const startAt = Date.now();
  let imported = 0;
  try {
    if (inbox.provider === 'm365_modern') {
      imported = await pollGraphApi(inbox);
    } else {
      imported = await pollImap(inbox);
    }
    // Actualizar estado: éxito
    await updateInboxState(inbox.id, {
      last_polled_at:  new Date().toISOString().slice(0, 19).replace('T', ' '),
      emails_imported: (inbox.emails_imported || 0) + imported,
      last_error:      null,
    });
    if (imported > 0) {
      console.log(`[emailPoller] Proyecto ${inbox.project_id}: +${imported} correo(s) importado(s) (${Date.now()-startAt}ms)`);
    }
  } catch (err) {
    console.error(`[emailPoller] Error en proyecto ${inbox.project_id}:`, err.message);
    await updateInboxState(inbox.id, {
      last_polled_at: new Date().toISOString().slice(0, 19).replace('T', ' '),
      last_error:     err.message.slice(0, 500),
    });
  }
  return imported;
}

// ─── Run all due inboxes ──────────────────────────────────────────────────────
async function runEmailPolling() {
  try {
    const [inboxes] = await pool.execute(`
      SELECT * FROM project_email_inbox
      WHERE enabled = TRUE
        AND (
          last_polled_at IS NULL
          OR last_polled_at < DATE_SUB(NOW(), INTERVAL poll_interval_min MINUTE)
        )
    `);
    if (inboxes.length === 0) return;
    console.log(`[emailPoller] Revisando ${inboxes.length} bandeja(s)...`);
    // Ejecutar en paralelo (máx 5 a la vez)
    const chunks = [];
    for (let i = 0; i < inboxes.length; i += 5) chunks.push(inboxes.slice(i, i + 5));
    for (const chunk of chunks) {
      await Promise.allSettled(chunk.map(inbox => pollInbox(inbox)));
    }
  } catch (err) {
    console.error('[emailPoller] Error en runEmailPolling:', err.message);
  }
}

module.exports = { runEmailPolling, encrypt, decrypt, pollInbox };
