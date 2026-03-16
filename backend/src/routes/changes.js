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

// ══════════════════════════════════════════════════════════
// PROPAGATION: When a change order is implemented,
// cascade the new values to all related modules
// ══════════════════════════════════════════════════════════
async function propagateToProject(projectId, changeOrder, userId) {
  const co = changeOrder;
  const pid = projectId;
  const log = [];

  // 1. Get current project values BEFORE update
  const [projRows] = await pool.execute('SELECT contract_value, estimated_end_date FROM projects WHERE id=?', [pid]);
  if (!projRows.length) return log;
  const oldCV = parseFloat(projRows[0].contract_value || 0);
  const oldEnd = projRows[0].estimated_end_date;

  // 2. Calculate new values from ALL implemented changes (not just this one)
  // This ensures consistency even if multiple changes are implemented
  const [allChanges] = await pool.execute(
    "SELECT COALESCE(SUM(impact_cost),0) as total_cost, COALESCE(SUM(impact_days),0) as total_days FROM change_orders WHERE project_id=? AND status='implementado'",
    [pid]);

  // Get the ORIGINAL contract value (before any changes)
  // We recalculate from original + all implemented changes
  const [origProj] = await pool.execute(
    "SELECT COALESCE(SUM(impact_cost),0) as prev_additions FROM change_orders WHERE project_id=? AND status='implementado' AND id != ?",
    [pid, co.id]);
  const originalCV = oldCV - parseFloat(origProj[0].prev_additions || 0);
  const newCV = originalCV + parseFloat(allChanges[0].total_cost || 0);

  // 3. Update project contract_value
  if (newCV !== oldCV) {
    await pool.execute('UPDATE projects SET contract_value=? WHERE id=?', [newCV, pid]);
    log.push('Valor contrato: $' + oldCV.toLocaleString() + ' → $' + newCV.toLocaleString());
  }

  // 4. Update estimated_end_date if there are days impact
  if (co.new_end_date) {
    await pool.execute('UPDATE projects SET estimated_end_date=? WHERE id=?', [co.new_end_date, pid]);
    log.push('Fecha fin: ' + (oldEnd || 'N/A') + ' → ' + co.new_end_date);
  } else if (parseInt(co.impact_days) > 0 && oldEnd) {
    const d = new Date(oldEnd);
    d.setDate(d.getDate() + parseInt(co.impact_days));
    const newEnd = d.toISOString().split('T')[0];
    await pool.execute('UPDATE projects SET estimated_end_date=? WHERE id=?', [newEnd, pid]);
    log.push('Fecha fin: ' + oldEnd + ' → ' + newEnd + ' (+' + co.impact_days + ' días)');
  }

  // 5. Propagate to budget_income (income breakdown)
  if (newCV !== oldCV && newCV > 0) {
    const newIVA = newCV * 0.19;
    const newTotal = newCV + newIVA;

    try {
      // Update the 3 core budget rows
      await pool.execute(
        "UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%Contrato sin IVA%' OR (sort_order=0 AND es_iva=0 AND es_total_con_iva=0))",
        [newCV, pid]);
      await pool.execute(
        "UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%IVA%' OR es_iva=1)",
        [newIVA, pid]);
      await pool.execute(
        "UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%con IVA%' OR es_total_con_iva=1)",
        [newTotal, pid]);
      log.push('Presupuesto ingresos actualizado');
    } catch (e) {
      console.warn('Budget income propagation (non-critical):', e.message);
    }

    // 6. Propagate to budget_income_schedule (monthly distribution)
    try {
      const [schedRows] = await pool.execute('SELECT COUNT(*) as c FROM budget_income_schedule WHERE project_id=?', [pid]);
      if (schedRows[0].c > 0 && oldCV > 0) {
        const ratio = newCV / oldCV;
        await pool.execute(
          'UPDATE budget_income_schedule SET valor_sin_iva = ROUND(valor_sin_iva * ?, 2), valor_iva = ROUND(valor_iva * ?, 2), valor_con_iva = ROUND(valor_con_iva * ?, 2) WHERE project_id=?',
          [ratio, ratio, ratio, pid]);
        log.push('Flujo mensual de ingresos proporcionalizado');
      }
    } catch (e) {
      console.warn('Income schedule propagation (non-critical):', e.message);
    }
  }

  // 7. Audit log
  await pool.execute(
    'INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
    [userId, 'implement_change', 'change_order', co.id,
     JSON.stringify({ change_number: co.change_number, title: co.title, impact_cost: co.impact_cost, impact_days: co.impact_days, propagation: log })]
  );

  console.log('✅ Otrosí #' + co.change_number + ' propagado:', log.join(' | '));
  return log;
}

// ══════════════════════════════════════════════════════════
// REVERSE PROPAGATION: When a change is un-implemented or deleted
// ══════════════════════════════════════════════════════════
async function reversePropagate(projectId, changeOrder, userId) {
  const co = changeOrder;
  const pid = projectId;

  // Get current project value
  const [projRows] = await pool.execute('SELECT contract_value, estimated_end_date FROM projects WHERE id=?', [pid]);
  if (!projRows.length) return;
  const currentCV = parseFloat(projRows[0].contract_value || 0);
  const impactCost = parseFloat(co.impact_cost || 0);

  if (impactCost !== 0) {
    const revertedCV = currentCV - impactCost;
    await pool.execute('UPDATE projects SET contract_value=? WHERE id=?', [revertedCV, pid]);

    // Revert budget
    if (revertedCV > 0 && currentCV > 0) {
      const ratio = revertedCV / currentCV;
      const newIVA = revertedCV * 0.19;
      const newTotal = revertedCV + newIVA;
      try {
        await pool.execute("UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%Contrato sin IVA%' OR (sort_order=0 AND es_iva=0 AND es_total_con_iva=0))", [revertedCV, pid]);
        await pool.execute("UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%IVA%' OR es_iva=1)", [newIVA, pid]);
        await pool.execute("UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%con IVA%' OR es_total_con_iva=1)", [newTotal, pid]);
        await pool.execute('UPDATE budget_income_schedule SET valor_sin_iva=ROUND(valor_sin_iva*?,2), valor_iva=ROUND(valor_iva*?,2), valor_con_iva=ROUND(valor_con_iva*?,2) WHERE project_id=?', [ratio, ratio, ratio, pid]);
      } catch (e) { console.warn('Reverse budget propagation:', e.message); }
    }
  }

  // Revert end date if days were added
  if (parseInt(co.impact_days) > 0 && projRows[0].estimated_end_date) {
    const d = new Date(projRows[0].estimated_end_date);
    d.setDate(d.getDate() - parseInt(co.impact_days));
    await pool.execute('UPDATE projects SET estimated_end_date=? WHERE id=?', [d.toISOString().split('T')[0], pid]);
  }

  await pool.execute('INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
    [userId, 'reverse_change', 'change_order', co.id, JSON.stringify({ title: co.title, reverted_cost: impactCost, reverted_days: co.impact_days })]);
}

// ═══ List ═══
router.get('/:projectId/changes', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(
      'SELECT co.*, u.full_name as approved_by_name, u2.full_name as created_by_name FROM change_orders co LEFT JOIN users u ON co.approved_by = u.id LEFT JOIN users u2 ON co.created_by = u2.id WHERE co.project_id = ? ORDER BY co.change_number ASC',
      [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Summary ═══
router.get('/:projectId/changes/summary', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(
      "SELECT COUNT(*) as total, SUM(status='aprobado' OR status='implementado') as approved, SUM(status='solicitado' OR status='en_revision') as pending, SUM(status='rechazado') as rejected, COALESCE(SUM(CASE WHEN status IN ('aprobado','implementado') THEN impact_cost END),0) as total_cost_impact, COALESCE(SUM(CASE WHEN status IN ('aprobado','implementado') THEN impact_days END),0) as total_days_impact FROM change_orders WHERE project_id=?",
      [req.params.projectId]);

    // Also return original vs current contract value for context
    const [proj] = await pool.execute('SELECT contract_value FROM projects WHERE id=?', [req.params.projectId]);
    const d = rows[0];
    d.current_contract_value = parseFloat(proj[0]?.contract_value || 0);
    d.original_contract_value = d.current_contract_value - parseFloat(d.total_cost_impact || 0);
    res.json({ data: d });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Create ═══
router.post('/:projectId/changes', roleMiddleware('admin','gerente_proyecto'),
  [param('projectId').isInt(), body('title').trim().notEmpty(), body('justification').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body; const pid = req.params.projectId;
      const [mx] = await pool.execute('SELECT COALESCE(MAX(change_number),0)+1 as n FROM change_orders WHERE project_id=?', [pid]);

      // Calc projected new values
      let newVal = b.new_contract_value || null;
      let newEnd = b.new_end_date || null;
      if (!newVal && b.impact_cost) {
        const [proj] = await pool.execute('SELECT contract_value, estimated_end_date FROM projects WHERE id=?', [pid]);
        newVal = parseFloat(proj[0]?.contract_value || 0) + parseFloat(b.impact_cost || 0);
        if (b.impact_days && proj[0]?.estimated_end_date) {
          const d = new Date(proj[0].estimated_end_date);
          d.setDate(d.getDate() + parseInt(b.impact_days));
          newEnd = d.toISOString().split('T')[0];
        }
      }

      const [r] = await pool.execute(
        'INSERT INTO change_orders (project_id,change_number,change_type,title,justification,requested_date,impact_cost,impact_days,new_contract_value,new_end_date,status,document_id,notes,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
        [pid, mx[0].n, b.change_type||'otro_si', b.title, b.justification,
          b.requested_date||new Date().toISOString().split('T')[0],
          b.impact_cost||0, b.impact_days||0, newVal, newEnd,
          'solicitado', b.document_id||null, b.notes||null, req.user.id]);

      const [rows] = await pool.execute('SELECT * FROM change_orders WHERE id=?', [r.insertId]);
      res.status(201).json({ data: rows[0], message: 'Cambio #' + mx[0].n + ' registrado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Update (includes approve/implement with FULL propagation) ═══
router.put('/:projectId/changes/:id', roleMiddleware('admin','gerente_proyecto'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const pid = parseInt(req.params.projectId);
      const [ex] = await pool.execute('SELECT * FROM change_orders WHERE id=? AND project_id=?', [req.params.id, pid]);
      if (ex.length === 0) return res.status(404).json({ error: 'No encontrado' });
      const prevStatus = ex[0].status;

      const allowed = ['change_type','title','justification','requested_date','impact_cost','impact_days',
        'new_contract_value','new_end_date','status','document_id','notes'];
      const updates = []; const values = [];
      allowed.forEach(function(f) { if (req.body[f] !== undefined) { updates.push(f + '=?'); values.push(req.body[f]===''?null:req.body[f]); }});

      if (req.body.status === 'aprobado' && prevStatus !== 'aprobado') {
        updates.push('approved_by=?', 'approved_at=NOW()');
        values.push(req.user.id);
      }

      if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
      values.push(req.params.id);
      await pool.execute('UPDATE change_orders SET ' + updates.join(',') + ' WHERE id=?', values);

      // ── PROPAGATION on status change ──
      let propagationLog = [];

      // Newly implemented → propagate forward
      if (req.body.status === 'implementado' && prevStatus !== 'implementado') {
        const [updated] = await pool.execute('SELECT * FROM change_orders WHERE id=?', [req.params.id]);
        propagationLog = await propagateToProject(pid, updated[0], req.user.id);
      }

      // Was implemented, now changed to something else → reverse
      if (prevStatus === 'implementado' && req.body.status && req.body.status !== 'implementado') {
        await reversePropagate(pid, ex[0], req.user.id);
        propagationLog = ['Propagación revertida'];
      }

      const [rows] = await pool.execute('SELECT * FROM change_orders WHERE id=?', [req.params.id]);
      res.json({
        data: rows[0],
        message: 'Cambio actualizado',
        propagation: propagationLog.length > 0 ? propagationLog : undefined,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Error' }); }
});

// ═══ Delete (with reverse propagation if was implemented) ═══
router.delete('/:projectId/changes/:id', roleMiddleware('admin'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const pid = parseInt(req.params.projectId);
      const [ex] = await pool.execute('SELECT * FROM change_orders WHERE id=? AND project_id=?', [req.params.id, pid]);
      if (ex.length === 0) return res.status(404).json({ error: 'No encontrado' });

      // If it was implemented, reverse the propagation first
      if (ex[0].status === 'implementado') {
        await reversePropagate(pid, ex[0], req.user.id);
      }

      await pool.execute('DELETE FROM change_orders WHERE id=?', [req.params.id]);
      res.json({ message: 'Cambio eliminado' + (ex[0].status === 'implementado' ? ' (valores del proyecto revertidos)' : '') });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

module.exports = router;
