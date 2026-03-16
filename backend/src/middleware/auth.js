const jwt = require('jsonwebtoken');
const pool = require('../config/database');

// ════════════════════════════════════════════════════════════
// ROLE NORMALIZATION: Old DB values → current system values
// The DB ENUM has: admin, director, consultor, visor
// The code expects: admin, gerente_proyecto, apoyo, director_pmo, ceo
// ════════════════════════════════════════════════════════════
const ROLE_MAP = {
  admin: 'admin',
  director: 'gerente_proyecto',
  gerente_proyecto: 'gerente_proyecto',
  consultor: 'apoyo',
  apoyo: 'apoyo',
  visor: 'director_pmo',
  director_pmo: 'director_pmo',
  ceo: 'ceo',
};

function normalizeRole(dbRole) {
  return ROLE_MAP[dbRole] || ROLE_MAP[String(dbRole).toLowerCase()] || 'apoyo';
}

// ════════════════════════════════════════════════════════════
// AUTH MIDDLEWARE — verifies JWT + normalizes role
// ════════════════════════════════════════════════════════════
const authMiddleware = async (req, res, next) => {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Token no proporcionado' });
  }
  try {
    const decoded = jwt.verify(header.split(' ')[1], process.env.JWT_SECRET);
    const [rows] = await pool.execute(
      'SELECT id, email, full_name, role FROM users WHERE id = ? AND is_active = 1',
      [decoded.id]
    );
    if (rows.length === 0) return res.status(401).json({ error: 'Usuario no encontrado o inactivo' });

    const dbRole = rows[0].role;
    const normalized = normalizeRole(dbRole);
    rows[0].role = normalized;
    req.user = rows[0];

    // Debug log (remove in production)
    if (process.env.NODE_ENV !== 'production') {
      console.log(`🔑 Auth: ${rows[0].full_name} | DB role: "${dbRole}" → normalized: "${normalized}" | ${req.method} ${req.path}`);
    }

    next();
  } catch (err) {
    return res.status(401).json({ error: err.name === 'TokenExpiredError' ? 'Token expirado' : 'Token inválido' });
  }
};

// ════════════════════════════════════════════════════════════
// ROLE MIDDLEWARE — checks if user has required role
// BULLETPROOF: accepts both old and new role names
// ════════════════════════════════════════════════════════════
const roleMiddleware = (...requiredRoles) => (req, res, next) => {
  if (!req.user) {
    return res.status(403).json({ error: 'No tiene permisos para esta acción' });
  }

  const userRole = req.user.role; // Already normalized by authMiddleware

  // Normalize the required roles too (routes may use old names like 'director')
  const normalizedRequired = requiredRoles.map(r => normalizeRole(r));

  if (normalizedRequired.includes(userRole)) {
    return next();
  }

  console.warn(`⛔ Role denied: user="${req.user.full_name}" role="${userRole}" required=[${requiredRoles}]→[${normalizedRequired}] path=${req.method} ${req.path}`);
  return res.status(403).json({ error: 'No tiene permisos para esta acción' });
};

// ════════════════════════════════════════════════════════════
// ROLE DEFINITIONS
// ════════════════════════════════════════════════════════════
const ROLES = {
  admin:            { label: 'Administrador',       canEdit: true,  canApprove: true,  canManageUsers: true,  seeAllProjects: true  },
  gerente_proyecto: { label: 'Gerente de Proyecto',  canEdit: true,  canApprove: true,  canManageUsers: false, seeAllProjects: false },
  director_pmo:     { label: 'Director PMO',         canEdit: false, canApprove: false, canManageUsers: false, seeAllProjects: true  },
  ceo:              { label: 'Dirección General',     canEdit: false, canApprove: false, canManageUsers: false, seeAllProjects: true  },
  apoyo:            { label: 'Apoyo / Seguimiento',   canEdit: true,  canApprove: false, canManageUsers: false, seeAllProjects: false },
};

// ════════════════════════════════════════════════════════════
// PROJECT ACCESS MIDDLEWARE
// ════════════════════════════════════════════════════════════
const projectAccessMiddleware = (requireEdit = false) => async (req, res, next) => {
  try {
    const projectId = req.params.projectId || req.params.id;
    if (!projectId) return next();
    const role = normalizeRole(req.user.role);
    if (role === 'admin') return next();
    if (role === 'director_pmo' || role === 'ceo') {
      if (requireEdit) return res.status(403).json({ error: 'Su rol es solo de consulta' });
      return next();
    }
    const [a] = await pool.execute(
      'SELECT role_in_project FROM project_assignments WHERE project_id=? AND user_id=? AND is_active=1',
      [projectId, req.user.id]
    );
    if (a.length === 0) return res.status(403).json({ error: 'No tiene acceso a este proyecto' });
    req.projectRole = a[0].role_in_project;
    next();
  } catch (err) { res.status(500).json({ error: 'Error verificando permisos' }); }
};

async function getVisibleProjectIds(userId, userRole) {
  const role = normalizeRole(userRole);
  if (['admin', 'director_pmo', 'ceo'].includes(role)) return null;
  const [rows] = await pool.execute(
    'SELECT project_id FROM project_assignments WHERE user_id=? AND is_active=1', [userId]
  );
  return rows.map(r => r.project_id);
}

function canApprove(role) {
  const r = normalizeRole(role);
  return r === 'admin' || r === 'gerente_proyecto';
}

// ════════════════════════════════════════════════════════════
// API KEY MIDDLEWARE — for external integrations (N8N, etc.)
// Checks X-API-Key header against hashed keys in api_keys table
// ════════════════════════════════════════════════════════════
const apiKeyMiddleware = async (req, res, next) => {
  const key = req.headers['x-api-key'];
  if (!key) return res.status(401).json({ error: 'API Key no proporcionada' });

  const { createHash } = require('crypto');
  const hash = createHash('sha256').update(key).digest('hex');

  try {
    const [rows] = await pool.execute(
      'SELECT id, name FROM api_keys WHERE key_hash = ? AND is_active = 1',
      [hash]
    );
    if (!rows.length) return res.status(401).json({ error: 'API Key inválida o revocada' });

    // Update last_used_at (fire and forget)
    pool.execute('UPDATE api_keys SET last_used_at = NOW() WHERE id = ?', [rows[0].id]).catch(() => {});

    req.apiKey = rows[0]; // { id, name }
    next();
  } catch (err) {
    return res.status(500).json({ error: 'Error verificando API Key' });
  }
};

// ════════════════════════════════════════════════════════════
// ANY AUTH — accepts JWT Bearer token OR X-API-Key
// ════════════════════════════════════════════════════════════
const anyAuth = (req, res, next) => {
  if (req.headers.authorization?.startsWith('Bearer ')) return authMiddleware(req, res, next);
  if (req.headers['x-api-key']) return apiKeyMiddleware(req, res, next);
  return res.status(401).json({ error: 'Autenticación requerida (Bearer token o X-API-Key)' });
};

module.exports = { authMiddleware, roleMiddleware, projectAccessMiddleware, getVisibleProjectIds, canApprove, normalizeRole, ROLES, apiKeyMiddleware, anyAuth };
