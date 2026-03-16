const express = require('express');
const { param, body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware, projectAccessMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
// Verify user has access to the project
router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch(e) { next(e); }
});
function validate(req, res) { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; }

// ═══ Summary/Stats ═══
router.get('/:projectId/risks/stats', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='identificado') as identificado, SUM(status='mitigando') as mitigando,
        SUM(status='materializado') as materializado, SUM(status='cerrado') as cerrado,
        SUM(risk_level='critico') as criticos, SUM(risk_level='alto') as altos,
        SUM(risk_level='medio') as medios, SUM(risk_level='bajo') as bajos,
        AVG(risk_score) as avg_score
      FROM risks WHERE project_id=?`, [req.params.projectId]);
    rows[0].avg_score = parseFloat(rows[0].avg_score || 0).toFixed(1);
    res.json({ data: rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Matrix data (for heatmap) ═══
router.get('/:projectId/risks/matrix', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT probability, impact, COUNT(*) as count, GROUP_CONCAT(id) as ids
      FROM risks WHERE project_id=? AND status != 'cerrado'
      GROUP BY probability, impact`, [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ List ═══
router.get('/:projectId/risks', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT r.*, u.full_name as created_by_name
      FROM risks r LEFT JOIN users u ON r.created_by = u.id
      WHERE r.project_id = ?
      ORDER BY r.risk_score DESC, r.created_at DESC`, [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Create ═══
router.post('/:projectId/risks', roleMiddleware('admin','gerente_proyecto','apoyo'),
  [param('projectId').isInt(), body('description').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body; const pid = req.params.projectId;
      // Auto risk code
      const [mx] = await pool.execute('SELECT COUNT(*)+1 as n FROM risks WHERE project_id=?', [pid]);
      const code = `R-${String(mx[0].n).padStart(3,'0')}`;
      const [r] = await pool.execute(
        `INSERT INTO risks (project_id,risk_code,category,description,probability,impact,
          mitigation_plan,contingency_plan,responsible,trigger_event,status,identified_date,created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [pid, code, b.category||'operativo', b.description, b.probability||'media', b.impact||'medio',
          b.mitigation_plan||null, b.contingency_plan||null, b.responsible||null, b.trigger_event||null,
          'identificado', b.identified_date||new Date().toISOString().split('T')[0], req.user.id]);
      const [rows] = await pool.execute('SELECT * FROM risks WHERE id=?', [r.insertId]);
      res.status(201).json({ data: rows[0], message: `Riesgo ${code} registrado` });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Update ═══
router.put('/:projectId/risks/:id', roleMiddleware('admin','gerente_proyecto','apoyo'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const allowed = ['category','description','probability','impact','mitigation_plan',
        'contingency_plan','responsible','trigger_event','status','close_date'];
      const updates = []; const values = [];
      allowed.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f]===''?null:req.body[f]); }});
      if (req.body.status === 'cerrado' && !req.body.close_date) { updates.push('close_date=CURDATE()'); }
      if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
      values.push(req.params.id);
      values.push(req.params.projectId);
      await pool.execute(`UPDATE risks SET ${updates.join(',')} WHERE id=? AND project_id=?`, values);
      const [rows] = await pool.execute('SELECT * FROM risks WHERE id=?', [req.params.id]);
      res.json({ data: rows[0], message: 'Riesgo actualizado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Delete ═══
router.delete('/:projectId/risks/:id', roleMiddleware('admin'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      await pool.execute('DELETE FROM risks WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      res.json({ message: 'Riesgo eliminado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

module.exports = router;
