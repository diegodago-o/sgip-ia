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

// Default checklist template for Colombian projects
const TEMPLATE = [
  { category: 'contractual', items: [
    'Verificar cumplimiento del objeto contractual',
    'Verificar cumplimiento de obligaciones específicas',
    'Verificar entrega de productos/entregables pactados',
    'Verificar vigencia y estado de pólizas de garantía',
    'Verificar inexistencia de multas o sanciones pendientes',
    'Obtener paz y salvo de interventoría/supervisión',
  ]},
  { category: 'financiero', items: [
    'Conciliar pagos realizados vs valor del contrato',
    'Verificar amortización total del anticipo',
    'Calcular retenciones acumuladas y su liberación',
    'Verificar pago de aportes a seguridad social y parafiscales',
    'Verificar pagos a subcontratistas y proveedores',
    'Elaborar balance financiero final',
  ]},
  { category: 'tecnico', items: [
    'Verificar entrega de planos as-built / documentación final',
    'Verificar pruebas de funcionamiento y calidad',
    'Verificar corrección de no conformidades',
    'Obtener acta de recibo a satisfacción',
  ]},
  { category: 'documental', items: [
    'Recopilar informes mensuales/periódicos completos',
    'Verificar archivo de actas de comité/seguimiento',
    'Recopilar correspondencia relevante del proyecto',
    'Compilar registro fotográfico final',
    'Archivar expediente contractual completo',
  ]},
  { category: 'administrativo', items: [
    'Elaborar informe final de gestión',
    'Documentar lecciones aprendidas',
    'Realizar evaluación de desempeño del contratista',
    'Elaborar acta de liquidación',
    'Obtener firmas del acta de liquidación',
  ]},
];

// ═══ Stats ═══
router.get('/:projectId/closure/stats', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;
    const [rows] = await pool.execute(`
      SELECT COUNT(*) as total, SUM(is_completed=1) as completed,
        category, SUM(CASE WHEN is_completed=1 THEN 1 ELSE 0 END) as cat_done,
        COUNT(*) as cat_total
      FROM closure_checklists WHERE project_id=? GROUP BY category WITH ROLLUP`, [pid]);
    const totals = rows.find(r => r.category === null) || { total: 0, completed: 0 };
    const byCategory = rows.filter(r => r.category !== null).map(r => ({
      category: r.category, total: r.cat_total, completed: r.cat_done,
      pct: r.cat_total > 0 ? ((r.cat_done / r.cat_total) * 100).toFixed(0) : 0,
    }));
    res.json({ data: {
      total: totals.total || 0, completed: totals.completed || 0,
      pct: totals.total > 0 ? ((totals.completed / totals.total) * 100).toFixed(0) : 0,
      by_category: byCategory,
    }});
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ List (grouped by category) ═══
router.get('/:projectId/closure', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT c.*, u.full_name as completed_by_name, d.file_name as evidence_name
      FROM closure_checklists c
      LEFT JOIN users u ON c.completed_by = u.id
      LEFT JOIN documents d ON c.evidence_doc_id = d.id
      WHERE c.project_id = ? ORDER BY c.category, c.item_order, c.id`, [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Initialize from template ═══
router.post('/:projectId/closure/init-template', roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt()], async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const pid = req.params.projectId;
      const [existing] = await pool.execute('SELECT COUNT(*) as c FROM closure_checklists WHERE project_id=?', [pid]);
      if (existing[0].c > 0) return res.status(409).json({ error: 'Ya existe un checklist. Elimínelo primero para reiniciar.' });
      let order = 0;
      for (const group of TEMPLATE) {
        for (const item of group.items) {
          await pool.execute(
            'INSERT INTO closure_checklists (project_id, category, item_order, description) VALUES (?,?,?,?)',
            [pid, group.category, order++, item]);
        }
      }
      res.status(201).json({ message: `Checklist inicializado con ${order} items`, count: order });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Add custom item ═══
router.post('/:projectId/closure', roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt(), body('description').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body; const pid = req.params.projectId;
      const [mx] = await pool.execute('SELECT COALESCE(MAX(item_order),0)+1 as n FROM closure_checklists WHERE project_id=? AND category=?', [pid, b.category || 'contractual']);
      const [r] = await pool.execute(
        'INSERT INTO closure_checklists (project_id,category,item_order,description,responsible,notes) VALUES (?,?,?,?,?,?)',
        [pid, b.category || 'contractual', mx[0].n, b.description, b.responsible || null, b.notes || null]);
      const [rows] = await pool.execute('SELECT * FROM closure_checklists WHERE id=?', [r.insertId]);
      res.status(201).json({ data: rows[0], message: 'Item agregado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Toggle completion ═══
router.put('/:projectId/closure/:id/toggle', roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [ex] = await pool.execute('SELECT is_completed FROM closure_checklists WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      if (ex.length === 0) return res.status(404).json({ error: 'No encontrado' });
      const newVal = ex[0].is_completed ? 0 : 1;
      await pool.execute(
        'UPDATE closure_checklists SET is_completed=?, completed_by=?, completed_at=? WHERE id=?',
        [newVal, newVal ? req.user.id : null, newVal ? new Date() : null, req.params.id]);
      const [rows] = await pool.execute('SELECT c.*, u.full_name as completed_by_name FROM closure_checklists c LEFT JOIN users u ON c.completed_by=u.id WHERE c.id=?', [req.params.id]);
      res.json({ data: rows[0] });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Update item ═══
router.put('/:projectId/closure/:id', roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const allowed = ['description', 'category', 'responsible', 'notes', 'evidence_doc_id', 'item_order'];
      const updates = []; const values = [];
      allowed.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f] === '' ? null : req.body[f]); } });
      if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
      values.push(req.params.id);
      values.push(req.params.projectId);
      await pool.execute(`UPDATE closure_checklists SET ${updates.join(',')} WHERE id=? AND project_id=?`, values);
      const [rows] = await pool.execute('SELECT * FROM closure_checklists WHERE id=?', [req.params.id]);
      res.json({ data: rows[0], message: 'Actualizado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Delete item ═══
router.delete('/:projectId/closure/:id', roleMiddleware('admin'),
  [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
    if (!validate(req, res)) return;
    try {
      await pool.execute('DELETE FROM closure_checklists WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      res.json({ message: 'Item eliminado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

module.exports = router;
