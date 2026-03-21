/**
 * OAuth 2.0 SSO — Google + Microsoft 365
 *
 * GET /api/auth/google            → redirect to Google consent
 * GET /api/auth/google/callback   → exchange code → JWT → redirect frontend
 * GET /api/auth/microsoft         → redirect to Microsoft consent
 * GET /api/auth/microsoft/callback→ exchange code → JWT → redirect frontend
 * GET /api/auth/sso-providers     → return which providers are enabled (public)
 */
const express  = require('express');
const crypto   = require('crypto');
const jwt      = require('jsonwebtoken');
const pool     = require('../config/database');
const { normalizeRole } = require('../middleware/auth');

const router = express.Router();

// ── CSRF state store (in-memory, TTL 10 min) ─────────────────────────────────
const pendingStates = new Map();

function createState() {
  const s = crypto.randomBytes(32).toString('hex');
  const timer = setTimeout(() => pendingStates.delete(s), 10 * 60 * 1000);
  if (timer.unref) timer.unref();
  pendingStates.set(s, true);
  return s;
}

function consumeState(s) {
  if (!pendingStates.has(s)) return false;
  pendingStates.delete(s);
  return true;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function frontendUrl() {
  return (process.env.FRONTEND_URL || 'http://localhost:3001').replace(/\/$/, '');
}

function backendUrl(req) {
  const base = process.env.BACKEND_URL;
  if (base) return base.replace(/\/$/, '');
  const proto = req.headers['x-forwarded-proto'] || req.protocol;
  const host  = req.headers['x-forwarded-host']  || req.get('host');
  return `${proto}://${host}`;
}

function redirectError(res, msg) {
  return res.redirect(`${frontendUrl()}/oauth/callback?error=${encodeURIComponent(msg)}`);
}

// ── Load SSO config from system_settings ─────────────────────────────────────
async function loadSSOConfig() {
  const [rows] = await pool.execute(
    "SELECT setting_value FROM system_settings WHERE setting_key = 'sso_config'"
  );
  if (!rows.length || !rows[0].setting_value) return {};
  try { return JSON.parse(rows[0].setting_value); } catch { return {}; }
}

// ── Find or create user after SSO ─────────────────────────────────────────────
async function findOrCreateUser({ email, full_name, avatar_url, provider, provider_id, cfg }) {
  const allowNew    = cfg.allow_new_users !== false;
  const defaultRole = cfg.default_role || 'apoyo';

  // Look up by email first (handles existing local users linking SSO)
  const [rows] = await pool.execute(
    'SELECT * FROM users WHERE email = ? AND is_active = 1',
    [email]
  );

  if (rows.length > 0) {
    const user = rows[0];
    // Attach OAuth provider info if not already set
    if (!user.oauth_provider) {
      await pool.execute(
        'UPDATE users SET oauth_provider = ?, oauth_provider_id = ? WHERE id = ?',
        [provider, provider_id, user.id]
      );
    }
    // Update avatar if we have one and user doesn't
    if (avatar_url && !user.avatar_url) {
      await pool.execute('UPDATE users SET avatar_url = ? WHERE id = ?', [avatar_url, user.id]);
    }
    await pool.execute('UPDATE users SET last_login = NOW() WHERE id = ?', [user.id]);
    return { ...user, oauth_provider: provider, oauth_provider_id: provider_id };
  }

  // New user
  if (!allowNew) {
    const err = new Error('SSO_NEW_USERS_DISABLED');
    err.status = 403;
    throw err;
  }

  const [result] = await pool.execute(
    `INSERT INTO users
       (email, full_name, avatar_url, role, oauth_provider, oauth_provider_id, is_active, last_login)
     VALUES (?, ?, ?, ?, ?, ?, 1, NOW())`,
    [email, full_name, avatar_url || null, defaultRole, provider, provider_id]
  );
  const [newRows] = await pool.execute('SELECT * FROM users WHERE id = ?', [result.insertId]);
  return newRows[0];
}

// ── Issue JWT and redirect ─────────────────────────────────────────────────────
function issueTokenAndRedirect(res, user) {
  const role  = normalizeRole(user.role);
  const token = jwt.sign(
    { id: user.id, email: user.email, role, full_name: user.full_name },
    process.env.JWT_SECRET,
    { expiresIn: process.env.JWT_EXPIRES_IN || '8h' }
  );
  const payload = encodeURIComponent(JSON.stringify({
    token,
    user: { id: user.id, email: user.email, full_name: user.full_name, role, avatar_url: user.avatar_url || null },
  }));
  return res.redirect(`${frontendUrl()}/oauth/callback?payload=${payload}`);
}

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC: which providers are enabled (for login page buttons)
// GET /api/auth/sso-providers
// ══════════════════════════════════════════════════════════════════════════════
router.get('/sso-providers', async (_req, res) => {
  try {
    const cfg = await loadSSOConfig();
    // Microsoft: multi-tenant mode doesn't require tenant_id (uses 'organizations' endpoint)
    const msReady = !!(cfg.microsoft_enabled && cfg.microsoft_client_id && cfg.microsoft_client_secret);
    const msMulti  = cfg.microsoft_mode !== 'single';           // default → multi
    const msSingle = cfg.microsoft_mode === 'single' && !!cfg.microsoft_tenant_id;
    res.json({
      google:    !!(cfg.google_enabled    && cfg.google_client_id    && cfg.google_client_secret),
      microsoft: msReady && (msMulti || msSingle),
    });
  } catch {
    res.json({ google: false, microsoft: false });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// GOOGLE
// ══════════════════════════════════════════════════════════════════════════════
router.get('/google', async (req, res) => {
  try {
    const cfg = await loadSSOConfig();
    if (!cfg.google_enabled || !cfg.google_client_id) {
      return redirectError(res, 'Google SSO no está habilitado');
    }
    const state    = createState();
    const callback = `${backendUrl(req)}/api/auth/google/callback`;
    const params   = new URLSearchParams({
      client_id:     cfg.google_client_id,
      redirect_uri:  callback,
      response_type: 'code',
      scope:         'openid email profile',
      state,
      access_type:   'online',
      prompt:        'select_account',
    });
    res.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params}`);
  } catch (e) {
    redirectError(res, 'Error iniciando Google SSO');
  }
});

router.get('/google/callback', async (req, res) => {
  const { code, state, error } = req.query;

  if (error)               return redirectError(res, `Google: ${error}`);
  if (!consumeState(state)) return redirectError(res, 'Estado inválido o expirado (CSRF)');
  if (!code)               return redirectError(res, 'No se recibió código de autorización');

  try {
    const cfg      = await loadSSOConfig();
    const callback = `${backendUrl(req)}/api/auth/google/callback`;

    // Exchange code for tokens
    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id:     cfg.google_client_id,
        client_secret: cfg.google_client_secret,
        redirect_uri:  callback,
        grant_type:    'authorization_code',
      }),
    });
    const tokens = await tokenRes.json();
    if (tokens.error) return redirectError(res, `Google token error: ${tokens.error_description || tokens.error}`);

    // Get user info
    const userRes  = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await userRes.json();

    if (!profile.email) return redirectError(res, 'Google no devolvió email del usuario');

    const user = await findOrCreateUser({
      email:       profile.email,
      full_name:   profile.name || profile.email,
      avatar_url:  profile.picture || null,
      provider:    'google',
      provider_id: profile.id,
      cfg,
    });

    issueTokenAndRedirect(res, user);
  } catch (e) {
    console.error('[oauth/google/callback]', e.message);
    const msg = e.message === 'SSO_NEW_USERS_DISABLED'
      ? 'Tu cuenta no está registrada en el sistema. Contacta al administrador.'
      : 'Error procesando autenticación con Google';
    redirectError(res, msg);
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// MICROSOFT 365
// ══════════════════════════════════════════════════════════════════════════════
/**
 * Resolves which Microsoft tenant endpoint to use.
 *
 * microsoft_mode === 'single' + microsoft_tenant_id set → restrict to that tenant only
 * anything else (including default/empty) → 'organizations' endpoint:
 *   accepts ANY Azure AD / Microsoft 365 organizational tenant (multi-tenant)
 *   personal Microsoft accounts (@outlook.com/@hotmail.com) are excluded by design
 *
 * To allow personal accounts as well, change 'organizations' → 'common'.
 */
function msTenantEndpoint(cfg) {
  if (cfg.microsoft_mode === 'single' && cfg.microsoft_tenant_id) {
    return cfg.microsoft_tenant_id;
  }
  return 'organizations'; // all M365 tenants, no personal accounts
}

router.get('/microsoft', async (req, res) => {
  try {
    const cfg = await loadSSOConfig();
    if (!cfg.microsoft_enabled || !cfg.microsoft_client_id || !cfg.microsoft_client_secret) {
      return redirectError(res, 'Microsoft SSO no está habilitado');
    }
    // In single-tenant mode, tenant_id is required
    if (cfg.microsoft_mode === 'single' && !cfg.microsoft_tenant_id) {
      return redirectError(res, 'Microsoft SSO: falta el Tenant ID para modo de tenant único');
    }
    const tenant   = msTenantEndpoint(cfg);
    const state    = createState();
    const callback = `${backendUrl(req)}/api/auth/microsoft/callback`;
    const params   = new URLSearchParams({
      client_id:     cfg.microsoft_client_id,
      redirect_uri:  callback,
      response_type: 'code',
      scope:         'openid email profile User.Read',
      state,
      prompt:        'select_account',
    });
    res.redirect(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/authorize?${params}`);
  } catch (e) {
    redirectError(res, 'Error iniciando Microsoft SSO');
  }
});

router.get('/microsoft/callback', async (req, res) => {
  const { code, state, error, error_description } = req.query;

  if (error)               return redirectError(res, `Microsoft: ${error_description || error}`);
  if (!consumeState(state)) return redirectError(res, 'Estado inválido o expirado (CSRF)');
  if (!code)               return redirectError(res, 'No se recibió código de autorización');

  try {
    const cfg      = await loadSSOConfig();
    const callback = `${backendUrl(req)}/api/auth/microsoft/callback`;

    // Exchange code for tokens — use same tenant endpoint as the authorization request
    const tenant = msTenantEndpoint(cfg);
    console.log('[oauth/ms/callback] tenant endpoint:', tenant);
    console.log('[oauth/ms/callback] redirect_uri:', callback);

    const tokenRes = await fetch(
      `https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          code,
          client_id:     cfg.microsoft_client_id,
          client_secret: cfg.microsoft_client_secret,
          redirect_uri:  callback,
          grant_type:    'authorization_code',
          scope:         'openid email profile User.Read',
        }),
      }
    );
    const tokens = await tokenRes.json();
    if (tokens.error) {
      console.error('[oauth/ms/callback] token error:', tokens.error, '|', tokens.error_description);
      return redirectError(res, `Microsoft: ${tokens.error_description || tokens.error}`);
    }
    console.log('[oauth/ms/callback] token OK, fetching Graph /me');

    // Get user info from Microsoft Graph
    const userRes = await fetch('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', {
      headers: { Authorization: `Bearer ${tokens.access_token}` },
    });
    const profile = await userRes.json();
    console.log('[oauth/ms/callback] Graph profile:', JSON.stringify({ id: profile.id, mail: profile.mail, upn: profile.userPrincipalName, err: profile.error }));

    if (profile.error) {
      return redirectError(res, `Microsoft Graph: ${profile.error.message || profile.error.code}`);
    }

    const email = profile.mail || profile.userPrincipalName;
    if (!email) return redirectError(res, 'Microsoft no devolvió email del usuario');

    const user = await findOrCreateUser({
      email,
      full_name:   profile.displayName || email,
      avatar_url:  null,
      provider:    'microsoft',
      provider_id: profile.id,
      cfg,
    });

    issueTokenAndRedirect(res, user);
  } catch (e) {
    console.error('[oauth/microsoft/callback] EXCEPTION:', e.message, e.stack);
    const msg = e.message === 'SSO_NEW_USERS_DISABLED'
      ? 'Tu cuenta no está registrada en el sistema. Contacta al administrador.'
      : 'Error procesando autenticación con Microsoft';
    redirectError(res, msg);
  }
});

module.exports = router;
