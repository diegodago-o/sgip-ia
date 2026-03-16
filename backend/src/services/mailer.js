/**
 * Mailer service — supports:
 *  - smtp       : Custom SMTP (host, port, user, pass, TLS/SSL)
 *  - smtp_gmail : Gmail shortcut (smtp.gmail.com:587 STARTTLS)
 *  - smtp_m365  : Microsoft 365 basic SMTP (smtp.office365.com:587)
 *  - oauth2_m365: Microsoft 365 modern auth via Microsoft Graph API
 *                 (App registration with Mail.Send permission)
 */
const nodemailer = require('nodemailer');
const https = require('https');

// ─── Fetch M365 OAuth2 access token (client credentials) ────────────────────
async function getM365AccessToken(tenantId, clientId, clientSecret) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
    scope: 'https://graph.microsoft.com/.default',
  }).toString();

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'login.microsoftonline.com',
      path: `/${tenantId}/oauth2/v2.0/token`,
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          if (parsed.access_token) resolve(parsed.access_token);
          else reject(new Error(parsed.error_description || 'No se pudo obtener token M365'));
        } catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Send via Microsoft Graph API ───────────────────────────────────────────
async function sendViaGraph(accessToken, { from, fromName, to, subject, html, text }) {
  const body = JSON.stringify({
    message: {
      subject,
      body: { contentType: 'HTML', content: html || text || '' },
      toRecipients: [{ emailAddress: { address: to } }],
      from: { emailAddress: { address: from, name: fromName || from } },
    },
    saveToSentItems: true,
  });

  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'graph.microsoft.com',
      path: `/v1.0/users/${encodeURIComponent(from)}/sendMail`,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const req = https.request(options, res => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve({ accepted: [to] });
        else {
          try {
            const err = JSON.parse(data);
            reject(new Error(err.error?.message || `Graph API error ${res.statusCode}`));
          } catch { reject(new Error(`Graph API error ${res.statusCode}`)); }
        }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// ─── Build nodemailer transporter from config ────────────────────────────────
function buildTransporter(cfg) {
  const type = cfg.provider_type || 'smtp';

  if (type === 'smtp_gmail') {
    return nodemailer.createTransport({
      host: 'smtp.gmail.com',
      port: 587,
      secure: false,
      auth: { user: cfg.username, pass: cfg.password },
    });
  }

  if (type === 'smtp_m365') {
    return nodemailer.createTransport({
      host: 'smtp.office365.com',
      port: 587,
      secure: false,
      tls: { ciphers: 'SSLv3', rejectUnauthorized: false },
      auth: { user: cfg.username, pass: cfg.password },
    });
  }

  // Generic SMTP
  return nodemailer.createTransport({
    host: cfg.smtp_host,
    port: parseInt(cfg.smtp_port) || 587,
    secure: cfg.smtp_secure === true || cfg.smtp_secure === 'true' || cfg.smtp_port === '465',
    auth: cfg.username ? { user: cfg.username, pass: cfg.password } : undefined,
    tls: { rejectUnauthorized: cfg.smtp_reject_unauthorized !== false },
  });
}

// ─── Main sendMail function ──────────────────────────────────────────────────
async function sendMail(cfg, { to, subject, html, text }) {
  const type = cfg.provider_type || 'smtp';
  const fromEmail = cfg.from_email || cfg.username;
  const fromName = cfg.from_name || 'SGIP-IA';

  if (type === 'oauth2_m365') {
    if (!cfg.tenant_id || !cfg.client_id || !cfg.client_secret) {
      throw new Error('Configuración OAuth2 incompleta: se requiere tenant_id, client_id y client_secret');
    }
    const token = await getM365AccessToken(cfg.tenant_id, cfg.client_id, cfg.client_secret);
    return sendViaGraph(token, { from: fromEmail, fromName, to, subject, html, text });
  }

  const transporter = buildTransporter(cfg);
  return transporter.sendMail({
    from: fromName ? `"${fromName}" <${fromEmail}>` : fromEmail,
    to,
    subject,
    html,
    text,
  });
}

// ─── Verify connection (for test) ────────────────────────────────────────────
async function verifyConnection(cfg) {
  const type = cfg.provider_type || 'smtp';

  if (type === 'oauth2_m365') {
    // For OAuth2 just attempt to get a token
    await getM365AccessToken(cfg.tenant_id, cfg.client_id, cfg.client_secret);
    return true;
  }

  const transporter = buildTransporter(cfg);
  await transporter.verify();
  return true;
}

module.exports = { sendMail, verifyConnection };
