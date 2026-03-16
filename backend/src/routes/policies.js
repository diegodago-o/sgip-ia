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

// ═══ GET /api/policies/:projectId/stats ═══
router.get('/:projectId/stats',
  [param('projectId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const pid = req.params.projectId;
      const [rows] = await pool.execute(`
        SELECT
          COUNT(*) as total,
          SUM(status = 'vigente') as vigente,
          SUM(status = 'por_vencer') as por_vencer,
          SUM(status = 'vencida') as vencida,
          SUM(status = 'en_renovacion') as en_renovacion,
          SUM(status = 'pendiente') as pendiente,
          COALESCE(SUM(insured_value), 0) as total_insured,
          SUM(expiry_date IS NOT NULL AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 15 DAY) AND status NOT IN ('vencida')) as alert_15,
          SUM(expiry_date IS NOT NULL AND expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND status NOT IN ('vencida')) as alert_30
        FROM policies WHERE project_id = ?
      `, [pid]);

      // Check required policies coverage
      const [project] = await pool.execute('SELECT contract_value FROM projects WHERE id = ?', [pid]);
      const contractValue = project[0]?.contract_value || 0;

      res.json({
        data: {
          ...rows[0],
          contract_value: parseFloat(contractValue),
        }
      });
    } catch (err) {
      console.error('Policy stats error:', err);
      res.status(500).json({ error: 'Error obteniendo estadísticas' });
    }
  }
);

// ═══ GET /api/policies/:projectId ═══
router.get('/:projectId',
  [param('projectId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [rows] = await pool.execute(`
        SELECT p.*,
          d.file_name as document_name,
          CASE
            WHEN p.status = 'vencida' THEN 'expired'
            WHEN p.expiry_date IS NOT NULL AND p.expiry_date < CURDATE() THEN 'expired'
            WHEN p.expiry_date IS NOT NULL AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 5 DAY) THEN 'critical'
            WHEN p.expiry_date IS NOT NULL AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 15 DAY) THEN 'warning'
            WHEN p.expiry_date IS NOT NULL AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'caution'
            WHEN p.expiry_date IS NOT NULL AND p.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 60 DAY) THEN 'notice'
            ELSE 'ok'
          END as alert_level,
          CASE
            WHEN p.expiry_date IS NOT NULL THEN DATEDIFF(p.expiry_date, CURDATE())
            ELSE NULL
          END as days_to_expiry
        FROM policies p
        LEFT JOIN documents d ON p.document_id = d.id
        WHERE p.project_id = ?
        ORDER BY
          FIELD(p.status, 'vencida','por_vencer','en_renovacion','pendiente','vigente'),
          p.expiry_date ASC
      `, [req.params.projectId]);

      res.json({ data: rows });
    } catch (err) {
      console.error('List policies error:', err);
      res.status(500).json({ error: 'Error listando pólizas' });
    }
  }
);

// ═══ POST /api/policies/:projectId ═══
router.post('/:projectId',
  roleMiddleware('admin', 'director'),
  [
    param('projectId').isInt(),
    body('policy_type').isIn(['cumplimiento','calidad','pago_salarios','responsabilidad_civil','estabilidad_obra','todo_riesgo','otra']),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [proj] = await pool.execute('SELECT id, contract_value FROM projects WHERE id = ?', [req.params.projectId]);
      if (proj.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

      // Auto-calculate insured value if coverage_pct provided
      let insuredValue = req.body.insured_value || null;
      if (!insuredValue && req.body.coverage_pct && proj[0].contract_value) {
        insuredValue = (parseFloat(req.body.coverage_pct) / 100) * parseFloat(proj[0].contract_value);
      }

      // Determine initial status based on dates
      let status = req.body.status || 'pendiente';
      if (req.body.expiry_date && req.body.issue_date) {
        const expiry = new Date(req.body.expiry_date);
        const today = new Date();
        if (expiry < today) status = 'vencida';
        else if (expiry <= new Date(today.getTime() + 30 * 86400000)) status = 'por_vencer';
        else status = 'vigente';
      }

      const fields = {
        project_id: parseInt(req.params.projectId),
        policy_type: req.body.policy_type,
        insurer: req.body.insurer || null,
        policy_number: req.body.policy_number || null,
        coverage_pct: req.body.coverage_pct || null,
        insured_value: insuredValue,
        issue_date: req.body.issue_date || null,
        expiry_date: req.body.expiry_date || null,
        status,
        document_id: req.body.document_id || null,
        required_by_contract: req.body.required_by_contract !== undefined ? req.body.required_by_contract : 1,
      };

      const cols = Object.keys(fields);
      const ph = cols.map(() => '?').join(',');
      const [result] = await pool.execute(
        `INSERT INTO policies (${cols.join(',')}) VALUES (${ph})`,
        Object.values(fields)
      );

      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'create', 'policy', result.insertId, JSON.stringify({ type: req.body.policy_type })]
      );

      const [rows] = await pool.execute('SELECT * FROM policies WHERE id = ?', [result.insertId]);
      res.status(201).json({ data: rows[0], message: 'Póliza registrada' });
    } catch (err) {
      console.error('Create policy error:', err);
      res.status(500).json({ error: 'Error creando póliza' });
    }
  }
);

// ═══ PUT /api/policies/:projectId/:id ═══
router.put('/:projectId/:id',
  roleMiddleware('admin', 'director'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [existing] = await pool.execute(
        'SELECT id FROM policies WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]
      );
      if (existing.length === 0) return res.status(404).json({ error: 'Póliza no encontrada' });

      const allowed = [
        'policy_type', 'insurer', 'policy_number', 'coverage_pct', 'insured_value',
        'issue_date', 'expiry_date', 'status', 'document_id', 'required_by_contract',
      ];

      const updates = [];
      const values = [];
      for (const f of allowed) {
        if (req.body[f] !== undefined) {
          updates.push(`${f} = ?`);
          values.push(req.body[f] === '' ? null : req.body[f]);
        }
      }

      // Auto-calculate insured value if coverage changes
      if (req.body.coverage_pct && !req.body.insured_value) {
        const [proj] = await pool.execute('SELECT contract_value FROM projects WHERE id = ?', [req.params.projectId]);
        if (proj[0]?.contract_value) {
          updates.push('insured_value = ?');
          values.push((parseFloat(req.body.coverage_pct) / 100) * parseFloat(proj[0].contract_value));
        }
      }

      if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

      values.push(req.params.id);
      await pool.execute(`UPDATE policies SET ${updates.join(',')} WHERE id = ?`, values);

      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'update', 'policy', parseInt(req.params.id), JSON.stringify(req.body)]
      );

      const [rows] = await pool.execute(
        'SELECT p.*, d.file_name as document_name FROM policies p LEFT JOIN documents d ON p.document_id = d.id WHERE p.id = ?',
        [req.params.id]
      );
      res.json({ data: rows[0], message: 'Póliza actualizada' });
    } catch (err) {
      console.error('Update policy error:', err);
      res.status(500).json({ error: 'Error actualizando póliza' });
    }
  }
);

// ═══ DELETE /api/policies/:projectId/:id ═══
router.delete('/:projectId/:id',
  roleMiddleware('admin'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [existing] = await pool.execute(
        'SELECT policy_type FROM policies WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]
      );
      if (existing.length === 0) return res.status(404).json({ error: 'Póliza no encontrada' });

      await pool.execute('DELETE FROM policies WHERE id = ?', [req.params.id]);
      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'delete', 'policy', parseInt(req.params.id), JSON.stringify({ type: existing[0].policy_type })]
      );
      res.json({ message: 'Póliza eliminada' });
    } catch (err) {
      console.error('Delete policy error:', err);
      res.status(500).json({ error: 'Error eliminando póliza' });
    }
  }
);

module.exports = router;
