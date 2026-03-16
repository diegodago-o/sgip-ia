const express = require('express');
const { param, body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return false; }
  return true;
}

// ── Auto-check profile compliance ──
function checkCompliance(member) {
  const issues = [];
  if (member.required_profession && member.actual_profession) {
    if (!member.actual_profession.toLowerCase().includes(member.required_profession.toLowerCase())) {
      issues.push('Profesión no coincide');
    }
  } else if (member.required_profession && !member.actual_profession) {
    issues.push('Profesión no registrada');
  }

  if (member.required_experience_years && member.actual_experience_years != null) {
    if (parseInt(member.actual_experience_years) < parseInt(member.required_experience_years)) {
      issues.push(`Experiencia insuficiente (${member.actual_experience_years}/${member.required_experience_years} años)`);
    }
  } else if (member.required_experience_years && member.actual_experience_years == null) {
    issues.push('Experiencia no registrada');
  }

  if (member.required_certifications) {
    const reqCerts = member.required_certifications.split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const actCerts = (member.actual_certifications || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
    const missing = reqCerts.filter(r => !actCerts.some(a => a.includes(r)));
    if (missing.length > 0) issues.push(`Certificaciones faltantes: ${missing.join(', ')}`);
  }

  return {
    compliant: issues.length === 0,
    notes: issues.length > 0 ? issues.join('; ') : 'Perfil cumple requisitos',
  };
}

// ═══ GET /api/team/:projectId/stats ═══
router.get('/:projectId/stats', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT
        COUNT(*) as total,
        SUM(status = 'activo') as activos,
        SUM(status = 'inactivo') as inactivos,
        SUM(status = 'por_reemplazar') as por_reemplazar,
        SUM(profile_compliant = 1) as compliant,
        SUM(profile_compliant = 0) as non_compliant,
        SUM(profile_compliant IS NULL) as unchecked,
        ROUND(AVG(dedication_pct), 1) as avg_dedication
      FROM team_members WHERE project_id = ?
    `, [req.params.projectId]);
    res.json({ data: rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ GET /api/team/:projectId ═══
router.get('/:projectId', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT tm.*, u.email as user_email
      FROM team_members tm
      LEFT JOIN users u ON tm.user_id = u.id
      WHERE tm.project_id = ?
      ORDER BY
        FIELD(tm.status, 'por_reemplazar','activo','inactivo'),
        tm.profile_compliant ASC,
        tm.role_in_project,
        tm.created_at
    `, [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error listando equipo' }); }
});

// ═══ POST /api/team/:projectId ═══
router.post('/:projectId',
  roleMiddleware('admin', 'director'),
  [
    param('projectId').isInt(),
    body('full_name').trim().notEmpty().withMessage('Nombre requerido'),
    body('role_in_project').trim().notEmpty().withMessage('Rol requerido'),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body;
      const compliance = checkCompliance(b);

      const [result] = await pool.execute(
        `INSERT INTO team_members (project_id, user_id, full_name, person_name, role_in_project,
          required_profession, required_experience_years, required_certifications,
          actual_profession, actual_experience_years, actual_certifications,
          dedication_pct, resource_type, participation_type, join_date, leave_date, status, profile_compliant, compliance_notes)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          req.params.projectId, b.user_id || null, b.full_name, b.person_name || null, b.role_in_project,
          b.required_profession || null, b.required_experience_years || null, b.required_certifications || null,
          b.actual_profession || null, b.actual_experience_years || null, b.actual_certifications || null,
          b.dedication_pct || 100, b.resource_type || null, b.participation_type || null,
          b.join_date || null, b.leave_date || null,
          b.status || 'activo', compliance.compliant ? 1 : 0, compliance.notes,
        ]
      );

      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'create', 'team_member', result.insertId, JSON.stringify({ name: b.full_name })]
      );

      const [rows] = await pool.execute('SELECT * FROM team_members WHERE id = ?', [result.insertId]);
      res.status(201).json({ data: rows[0], message: `${b.full_name} agregado al equipo` });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error agregando miembro' }); }
  }
);

// ═══ PUT /api/team/:projectId/:id ═══
router.put('/:projectId/:id',
  roleMiddleware('admin', 'director'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [existing] = await pool.execute(
        'SELECT * FROM team_members WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]
      );
      if (existing.length === 0) return res.status(404).json({ error: 'Miembro no encontrado' });

      const merged = { ...existing[0], ...req.body };
      const compliance = checkCompliance(merged);

      const allowed = [
        'full_name', 'person_name', 'role_in_project', 'user_id',
        'required_profession', 'required_experience_years', 'required_certifications',
        'actual_profession', 'actual_experience_years', 'actual_certifications',
        'dedication_pct', 'resource_type', 'participation_type', 'join_date', 'leave_date', 'status',
      ];

      const updates = [];
      const values = [];
      allowed.forEach(f => {
        if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f] === '' ? null : req.body[f]); }
      });
      updates.push('profile_compliant=?', 'compliance_notes=?');
      values.push(compliance.compliant ? 1 : 0, compliance.notes);
      values.push(req.params.id);

      await pool.execute(`UPDATE team_members SET ${updates.join(',')} WHERE id = ?`, values);

      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'update', 'team_member', parseInt(req.params.id), JSON.stringify(req.body)]
      );

      const [rows] = await pool.execute('SELECT * FROM team_members WHERE id = ?', [req.params.id]);
      res.json({ data: rows[0], message: 'Miembro actualizado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error actualizando' }); }
  }
);

// ═══ DELETE /api/team/:projectId/:id ═══
router.delete('/:projectId/:id',
  roleMiddleware('admin', 'director'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [existing] = await pool.execute(
        'SELECT full_name FROM team_members WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]
      );
      if (existing.length === 0) return res.status(404).json({ error: 'No encontrado' });

      await pool.execute('DELETE FROM team_members WHERE id = ?', [req.params.id]);

      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'delete', 'team_member', parseInt(req.params.id), JSON.stringify({ name: existing[0].full_name })]
      );

      res.json({ message: `${existing[0].full_name} removido del equipo` });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error eliminando' }); }
  }
);

module.exports = router;
