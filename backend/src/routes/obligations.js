const express = require('express');
const { param, body, query, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return false; }
  return true;
}

// ── Generate obligation code ──
async function generateObligationCode(projectId) {
  const [proj] = await pool.execute('SELECT code FROM projects WHERE id = ?', [projectId]);
  if (proj.length === 0) return null;
  const [rows] = await pool.execute(
    'SELECT COUNT(*) as c FROM obligations WHERE project_id = ?', [projectId]
  );
  const seq = String((rows[0].c || 0) + 1).padStart(2, '0');
  return `OBL-${proj[0].code}-${seq}`;
}

// ═══ GET /api/obligations/:projectId/stats ═══
// Summary counters for the project
router.get('/:projectId/stats',
  [param('projectId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const pid = req.params.projectId;
      const [rows] = await pool.execute(`
        SELECT
          COUNT(*) as total,
          SUM(status = 'pendiente') as pendiente,
          SUM(status = 'en_curso') as en_curso,
          SUM(status = 'cumplida') as cumplida,
          SUM(status = 'vencida') as vencida,
          SUM(status = 'no_aplica') as no_aplica,
          SUM(risk_level = 'alto') as riesgo_alto,
          SUM(risk_level = 'medio') as riesgo_medio,
          SUM(risk_level = 'bajo') as riesgo_bajo,
          SUM(due_date IS NOT NULL AND due_date <= CURDATE() AND status NOT IN ('cumplida','no_aplica')) as overdue,
          SUM(due_date IS NOT NULL AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND status NOT IN ('cumplida','no_aplica')) as due_this_week,
          SUM(due_date IS NOT NULL AND due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND status NOT IN ('cumplida','no_aplica')) as due_this_month
        FROM obligations WHERE project_id = ?
      `, [pid]);
      res.json({ data: rows[0] });
    } catch (err) {
      console.error('Obligation stats error:', err);
      res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }
  }
);

// ═══ GET /api/obligations/:projectId ═══
// List with filters
router.get('/:projectId',
  [
    param('projectId').isInt(),
    query('status').optional().isString(),
    query('risk_level').optional().isIn(['alto', 'medio', 'bajo', '']),
    query('obligation_type').optional().isString(),
    query('search').optional().isString(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      let where = ['o.project_id = ?'];
      let params = [req.params.projectId];

      if (req.query.status) { where.push('o.status = ?'); params.push(req.query.status); }
      if (req.query.risk_level) { where.push('o.risk_level = ?'); params.push(req.query.risk_level); }
      if (req.query.obligation_type) { where.push('o.obligation_type = ?'); params.push(req.query.obligation_type); }
      if (req.query.search) {
        where.push('(o.description LIKE ? OR o.code LIKE ? OR o.source_clause LIKE ?)');
        const s = `%${req.query.search}%`;
        params.push(s, s, s);
      }

      const wc = where.join(' AND ');

      const [rows] = await pool.execute(`
        SELECT o.*,
          u.full_name as responsible_name,
          d.file_name as source_document_name,
          CASE
            WHEN o.status IN ('cumplida','no_aplica') THEN 'ok'
            WHEN o.due_date IS NOT NULL AND o.due_date < CURDATE() THEN 'overdue'
            WHEN o.due_date IS NOT NULL AND o.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) THEN 'urgent'
            WHEN o.due_date IS NOT NULL AND o.due_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'upcoming'
            ELSE 'normal'
          END as alert_level,
          CASE
            WHEN o.due_date IS NOT NULL AND o.due_date >= CURDATE() THEN DATEDIFF(o.due_date, CURDATE())
            WHEN o.due_date IS NOT NULL THEN DATEDIFF(o.due_date, CURDATE())
            ELSE NULL
          END as days_remaining
        FROM obligations o
        LEFT JOIN users u ON o.responsible_user_id = u.id
        LEFT JOIN documents d ON o.source_document_id = d.id
        WHERE ${wc}
        ORDER BY
          FIELD(o.status, 'vencida','pendiente','en_curso','cumplida','no_aplica'),
          o.risk_level = 'alto' DESC,
          o.due_date ASC,
          o.created_at DESC
      `, params);

      res.json({ data: rows });
    } catch (err) {
      console.error('List obligations error:', err);
      res.status(500).json({ error: 'Error listando obligaciones' });
    }
  }
);

// ═══ POST /api/obligations/:projectId ═══
router.post('/:projectId',
  roleMiddleware('admin', 'director'),
  [
    param('projectId').isInt(),
    body('description').trim().notEmpty().withMessage('Descripción requerida'),
    body('obligation_type').isIn(['hacer', 'entregar', 'no_hacer', 'condicion']),
    body('periodicity').optional().isIn(['unica','diaria','semanal','quincenal','mensual','bimestral','trimestral','semestral','anual','al_cierre']),
    body('due_date').optional({ nullable: true }).isISO8601(),
    body('risk_level').optional().isIn(['alto', 'medio', 'bajo']),
    body('responsible_user_id').optional({ nullable: true }).isInt(),
    body('source_document_id').optional({ nullable: true }).isInt(),
    body('source_clause').optional({ nullable: true }).trim(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      // Verify project
      const [proj] = await pool.execute('SELECT id FROM projects WHERE id = ?', [req.params.projectId]);
      if (proj.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

      const code = await generateObligationCode(req.params.projectId);

      const fields = {
        project_id: parseInt(req.params.projectId),
        code,
        description: req.body.description,
        obligation_type: req.body.obligation_type,
        source_document_id: req.body.source_document_id || null,
        source_clause: req.body.source_clause || null,
        periodicity: req.body.periodicity || 'unica',
        due_date: req.body.due_date || null,
        due_date_rule: req.body.due_date_rule || null,
        responsible_user_id: req.body.responsible_user_id || null,
        responsible_role: req.body.responsible_role || null,
        risk_level: req.body.risk_level || 'medio',
        status: 'pendiente',
        notes: req.body.notes || null,
      };

      const cols = Object.keys(fields);
      const ph = cols.map(() => '?').join(',');
      const [result] = await pool.execute(
        `INSERT INTO obligations (${cols.join(',')}) VALUES (${ph})`,
        Object.values(fields)
      );

      // Audit
      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'create', 'obligation', result.insertId, JSON.stringify({ code, project_id: req.params.projectId })]
      );

      const [rows] = await pool.execute(
        `SELECT o.*, u.full_name as responsible_name, d.file_name as source_document_name
         FROM obligations o
         LEFT JOIN users u ON o.responsible_user_id = u.id
         LEFT JOIN documents d ON o.source_document_id = d.id
         WHERE o.id = ?`,
        [result.insertId]
      );

      res.status(201).json({ data: rows[0], message: `Obligación ${code} creada` });
    } catch (err) {
      console.error('Create obligation error:', err);
      res.status(500).json({ error: 'Error creando obligación' });
    }
  }
);

// ═══ PUT /api/obligations/:projectId/:id ═══
router.put('/:projectId/:id',
  roleMiddleware('admin', 'director'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [existing] = await pool.execute(
        'SELECT id FROM obligations WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]
      );
      if (existing.length === 0) return res.status(404).json({ error: 'Obligación no encontrada' });

      const allowed = [
        'description', 'obligation_type', 'source_document_id', 'source_clause',
        'periodicity', 'due_date', 'due_date_rule', 'responsible_user_id',
        'responsible_role', 'risk_level', 'status', 'notes',
      ];

      const updates = [];
      const values = [];
      for (const f of allowed) {
        if (req.body[f] !== undefined) {
          updates.push(`${f} = ?`);
          values.push(req.body[f] === '' ? null : req.body[f]);
        }
      }

      if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

      // Auto-mark overdue obligations that are being completed
      if (req.body.status === 'cumplida' || req.body.status === 'no_aplica') {
        // ok
      }

      values.push(req.params.id);
      await pool.execute(`UPDATE obligations SET ${updates.join(',')} WHERE id = ?`, values);

      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'update', 'obligation', parseInt(req.params.id), JSON.stringify(req.body)]
      );

      const [rows] = await pool.execute(
        `SELECT o.*, u.full_name as responsible_name, d.file_name as source_document_name
         FROM obligations o
         LEFT JOIN users u ON o.responsible_user_id = u.id
         LEFT JOIN documents d ON o.source_document_id = d.id
         WHERE o.id = ?`,
        [req.params.id]
      );

      res.json({ data: rows[0], message: 'Obligación actualizada' });
    } catch (err) {
      console.error('Update obligation error:', err);
      res.status(500).json({ error: 'Error actualizando obligación' });
    }
  }
);

// ═══ DELETE /api/obligations/:projectId/:id ═══
router.delete('/:projectId/:id',
  roleMiddleware('admin'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [existing] = await pool.execute(
        'SELECT code FROM obligations WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]
      );
      if (existing.length === 0) return res.status(404).json({ error: 'Obligación no encontrada' });

      await pool.execute('DELETE FROM obligations WHERE id = ?', [req.params.id]);

      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'delete', 'obligation', parseInt(req.params.id), JSON.stringify({ code: existing[0].code })]
      );

      res.json({ message: `Obligación ${existing[0].code} eliminada` });
    } catch (err) {
      console.error('Delete obligation error:', err);
      res.status(500).json({ error: 'Error eliminando obligación' });
    }
  }
);

// ═══ PATCH /api/obligations/:projectId/bulk — Mass update ═══
router.patch('/:projectId/bulk',
  roleMiddleware('admin', 'director'),
  [param('projectId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { ids, action, value } = req.body;
      if (!ids?.length) return res.status(400).json({ error: 'No se seleccionaron obligaciones' });

      const pid = req.params.projectId;
      let updated = 0;

      if (action === 'status' && value) {
        const validStatus = ['pendiente', 'en_curso', 'cumplida', 'vencida', 'no_aplica'];
        if (!validStatus.includes(value)) return res.status(400).json({ error: 'Estado inválido' });
        const placeholders = ids.map(() => '?').join(',');
        const [result] = await pool.execute(
          `UPDATE obligations SET status=? WHERE project_id=? AND id IN (${placeholders})`,
          [value, pid, ...ids]
        );
        updated = result.affectedRows;
      } else if (action === 'risk_level' && value) {
        const validRisk = ['alto', 'medio', 'bajo'];
        if (!validRisk.includes(value)) return res.status(400).json({ error: 'Nivel de riesgo inválido' });
        const placeholders = ids.map(() => '?').join(',');
        const [result] = await pool.execute(
          `UPDATE obligations SET risk_level=? WHERE project_id=? AND id IN (${placeholders})`,
          [value, pid, ...ids]
        );
        updated = result.affectedRows;
      } else if (action === 'delete') {
        const placeholders = ids.map(() => '?').join(',');
        const [result] = await pool.execute(
          `DELETE FROM obligations WHERE project_id=? AND id IN (${placeholders})`,
          [pid, ...ids]
        );
        updated = result.affectedRows;
      } else {
        return res.status(400).json({ error: 'Acción no válida' });
      }

      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, `bulk_${action}`, 'obligation', 0, JSON.stringify({ ids, action, value, updated })]
      );

      res.json({ message: `${updated} obligaciones actualizadas`, updated });
    } catch (err) {
      console.error('Bulk obligation error:', err);
      res.status(500).json({ error: 'Error en acción masiva' });
    }
  }
);

module.exports = router;
