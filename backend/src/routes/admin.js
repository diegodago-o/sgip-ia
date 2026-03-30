const express = require('express');
const bcrypt = require('bcryptjs');
const { body, param, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware, ROLES } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function validate(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; }
  return true;
}

// ═══ ROLES INFO ═══
router.get('/roles', (req, res) => {
  res.json({ data: Object.entries(ROLES).map(([key, val]) => ({ key, ...val })) });
});

// ═══ LIST USERS (Admin only) ═══
router.get('/users', roleMiddleware('admin'), async (req, res) => {
  try {
    const [users] = await pool.execute(
      `SELECT u.id, u.email, u.full_name, u.role, u.phone, u.position, u.is_active, u.last_login, u.created_at,
              u.oauth_provider,
        (SELECT COUNT(*) FROM project_assignments pa WHERE pa.user_id = u.id AND pa.is_active = 1) as project_count
       FROM users u ORDER BY u.full_name`
    );
    res.json({ data: users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══ CREATE USER (Admin only) ═══
router.post('/users',
  roleMiddleware('admin'),
  [body('email').isEmail(), body('full_name').trim().notEmpty(), body('role').isIn(Object.keys(ROLES)), body('password').isLength({ min: 6 })],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { email, full_name, role, password, phone, position } = req.body;
      const hash = await bcrypt.hash(password, 10);
      const [result] = await pool.execute(
        'INSERT INTO users (email, password_hash, full_name, role, phone, position) VALUES (?,?,?,?,?,?)',
        [email, hash, full_name, role, phone || null, position || null]
      );
      await pool.execute('INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
        [req.user.id, 'create_user', 'user', result.insertId, JSON.stringify({ email, role })]);
      const [rows] = await pool.execute('SELECT id,email,full_name,role,phone,position,is_active,created_at FROM users WHERE id=?', [result.insertId]);
      res.status(201).json({ data: rows[0], message: `Usuario ${full_name} creado` });
    } catch (err) {
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Email ya registrado' });
      res.status(500).json({ error: err.message });
    }
  });

// ═══ UPDATE USER (Admin only) ═══
router.put('/users/:id',
  roleMiddleware('admin'),
  [param('id').isInt(), body('full_name').trim().notEmpty(), body('role').isIn(Object.keys(ROLES))],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { full_name, role, phone, position, is_active, email } = req.body;
      const fields = ['full_name=?', 'role=?', 'phone=?', 'position=?'];
      const values = [full_name, role, phone || null, position || null];
      if (is_active !== undefined) { fields.push('is_active=?'); values.push(is_active ? 1 : 0); }
      if (email) { fields.push('email=?'); values.push(email); }
      values.push(req.params.id);
      await pool.execute(`UPDATE users SET ${fields.join(',')} WHERE id=?`, values);
      // If password change
      if (req.body.password && req.body.password.length >= 6) {
        const hash = await bcrypt.hash(req.body.password, 10);
        await pool.execute('UPDATE users SET password_hash=? WHERE id=?', [hash, req.params.id]);
      }
      await pool.execute('INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
        [req.user.id, 'update_user', 'user', parseInt(req.params.id), JSON.stringify({ role })]);
      const [rows] = await pool.execute('SELECT id,email,full_name,role,phone,position,is_active,created_at FROM users WHERE id=?', [req.params.id]);
      res.json({ data: rows[0], message: 'Usuario actualizado' });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

// ═══ DELETE USER (Admin only) ═══
router.delete('/users/:id', roleMiddleware('admin'), async (req, res) => {
  try {
    const targetId = parseInt(req.params.id);
    if (targetId === req.user.id) return res.status(400).json({ error: 'No puede eliminar su propio usuario' });
    const [rows] = await pool.execute('SELECT id, full_name, email FROM users WHERE id=?', [targetId]);
    if (!rows.length) return res.status(404).json({ error: 'Usuario no encontrado' });
    // Eliminar asignaciones primero
    await pool.execute('DELETE FROM project_assignments WHERE user_id=?', [targetId]);
    await pool.execute('DELETE FROM users WHERE id=?', [targetId]);
    await pool.execute('INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
      [req.user.id, 'delete_user', 'user', targetId, JSON.stringify({ email: rows[0].email, full_name: rows[0].full_name })]);
    res.json({ message: `Usuario ${rows[0].full_name} eliminado` });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══ TOGGLE USER ACTIVE (Admin only) ═══
router.patch('/users/:id/toggle', roleMiddleware('admin'), async (req, res) => {
  try {
    await pool.execute('UPDATE users SET is_active = NOT is_active WHERE id=?', [req.params.id]);
    const [rows] = await pool.execute('SELECT id,is_active FROM users WHERE id=?', [req.params.id]);
    res.json({ data: rows[0], message: rows[0].is_active ? 'Usuario activado' : 'Usuario desactivado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══ PROJECT ASSIGNMENTS ═══

// List ALL projects for admin assignment UI (no pagination limit)
router.get('/all-projects', roleMiddleware('admin'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      'SELECT id, name, code, status FROM projects ORDER BY name ASC'
    );
    res.json({ data: rows });
  } catch (err) {
    res.status(500).json({ error: 'Error listando proyectos' });
  }
});

// List assignments for a user (Admin only)
router.get('/users/:userId/assignments', roleMiddleware('admin'), async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT pa.*, p.name as project_name, p.code as project_code, p.status as project_status
       FROM project_assignments pa
       JOIN projects p ON p.id = pa.project_id
       WHERE pa.user_id = ? AND pa.is_active = 1
       ORDER BY p.name`,
      [req.params.userId]
    );
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List assignments for a project (GP or Admin)
router.get('/projects/:projectId/assignments', async (req, res) => {
  try {
    const [rows] = await pool.execute(
      `SELECT pa.*, u.full_name, u.email, u.role as user_role, u.position,
              ab.full_name as assigned_by_name
       FROM project_assignments pa
       JOIN users u ON u.id = pa.user_id
       LEFT JOIN users ab ON ab.id = pa.assigned_by
       WHERE pa.project_id = ? ORDER BY pa.role_in_project, u.full_name`,
      [req.params.projectId]
    );
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Assign user to project (Admin or GP of that project)
router.post('/projects/:projectId/assignments',
  [body('user_id').isInt(), body('role_in_project').isIn(['gerente_proyecto', 'apoyo'])],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { user_id, role_in_project, notes } = req.body;
      // Only 1 GP per project
      if (role_in_project === 'gerente_proyecto') {
        const [existing] = await pool.execute(
          "SELECT u.full_name FROM project_assignments pa JOIN users u ON u.id=pa.user_id WHERE pa.project_id=? AND pa.role_in_project='gerente_proyecto' AND pa.is_active=1 AND pa.user_id != ?",
          [req.params.projectId, user_id]
        );
        if (existing.length > 0) {
          return res.status(400).json({ error: `Ya existe un GP asignado (${existing[0].full_name}). Remuévalo primero.` });
        }
      }
      // Only admin or GP of this project can assign
      if (req.user.role !== 'admin') {
        const [check] = await pool.execute(
          "SELECT id FROM project_assignments WHERE project_id=? AND user_id=? AND role_in_project='gerente_proyecto' AND is_active=1",
          [req.params.projectId, req.user.id]
        );
        if (check.length === 0) return res.status(403).json({ error: 'Solo el GP o Admin pueden asignar personas' });
      }
      await pool.execute(
        `INSERT INTO project_assignments (project_id, user_id, role_in_project, assigned_by, notes)
         VALUES (?,?,?,?,?) ON DUPLICATE KEY UPDATE role_in_project=VALUES(role_in_project), is_active=1, notes=VALUES(notes)`,
        [req.params.projectId, user_id, role_in_project, req.user.id, notes || null]
      );
      const [u] = await pool.execute('SELECT full_name FROM users WHERE id=?', [user_id]);
      res.json({ message: `${u[0]?.full_name || 'Usuario'} asignado al proyecto como ${role_in_project}` });
    } catch (err) { res.status(500).json({ error: err.message }); }
  });

// Remove assignment
router.delete('/projects/:projectId/assignments/:userId', async (req, res) => {
  try {
    if (req.user.role !== 'admin') {
      const [check] = await pool.execute(
        "SELECT id FROM project_assignments WHERE project_id=? AND user_id=? AND role_in_project='gerente_proyecto' AND is_active=1",
        [req.params.projectId, req.user.id]
      );
      if (check.length === 0) return res.status(403).json({ error: 'Solo el GP o Admin pueden desasignar' });
    }
    await pool.execute('UPDATE project_assignments SET is_active=0 WHERE project_id=? AND user_id=?',
      [req.params.projectId, req.params.userId]);
    res.json({ message: 'Asignación removida' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// List users available for assignment (for dropdown)
router.get('/users/assignable', async (req, res) => {
  try {
    const [users] = await pool.execute(
      "SELECT id, full_name, email, role, position FROM users WHERE is_active=1 AND role != 'admin' ORDER BY full_name"
    );
    res.json({ data: users });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
