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

// ═══ Get or auto-generate liquidation record ═══
router.get('/:projectId/liquidation', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;
    const [existing] = await pool.execute(
      `SELECT l.*, u.full_name as created_by_name FROM liquidation_records l
       LEFT JOIN users u ON l.created_by = u.id WHERE l.project_id=?`, [pid]);

    if (existing.length > 0) {
      return res.json({ data: existing[0] });
    }

    // Auto-populate from project data
    const [proj] = await pool.execute('SELECT * FROM projects WHERE id=?', [pid]);
    if (proj.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const p = proj[0];

    // Calc financials from payments
    let totalPaid = 0, totalRetained = 0;
    try {
      const [pay] = await pool.execute(
        `SELECT COALESCE(SUM(CASE WHEN status='pagado' THEN net_value END),0) as paid,
                COALESCE(SUM(retention_value),0) as retained
         FROM payments WHERE project_id=?`, [pid]);
      totalPaid = parseFloat(pay[0].paid);
      totalRetained = parseFloat(pay[0].retained);
    } catch {}

    // Calc additions from change orders
    let additionsValue = 0, additionsDays = 0, suspensionDays = 0;
    try {
      const [changes] = await pool.execute(
        `SELECT COALESCE(SUM(CASE WHEN status IN ('aprobado','implementado') AND impact_cost != 0 THEN impact_cost END),0) as cost,
                COALESCE(SUM(CASE WHEN status IN ('aprobado','implementado') AND impact_days > 0 AND change_type != 'suspension' THEN impact_days END),0) as days,
                COALESCE(SUM(CASE WHEN status IN ('aprobado','implementado') AND change_type='suspension' THEN ABS(impact_days) END),0) as susp
         FROM change_orders WHERE project_id=?`, [pid]);
      additionsValue = parseFloat(changes[0].cost);
      additionsDays = parseInt(changes[0].days);
      suspensionDays = parseInt(changes[0].susp);
    } catch {}

    // Progress
    let physPct = parseFloat(p.progress_pct) || 0;

    // IMPORTANT: contract_value already includes implemented additions (propagated by changes.js)
    // So original_value = contract_value - additions, NOT contract_value + additions
    const currentCV = parseFloat(p.contract_value || 0);
    const originalValue = currentCV - additionsValue;
    const finalValue = currentCV; // Already correct (original + additions)
    const balance = finalValue - totalPaid;

    res.json({ data: {
      project_id: pid, status: 'borrador', liquidation_type: 'bilateral',
      original_value: originalValue,
      additions_value: additionsValue,
      final_contract_value: finalValue,
      total_paid: totalPaid,
      total_retained: totalRetained,
      retention_release: totalRetained,
      balance_in_favor_of: balance > 0 ? 'contratista' : balance < 0 ? 'entidad' : 'equilibrio',
      balance_amount: Math.abs(balance),
      original_start_date: p.start_date,
      original_end_date: p.estimated_end_date,
      actual_end_date: null,
      total_additions_days: additionsDays,
      total_suspension_days: suspensionDays,
      physical_completion_pct: physPct,
      _is_draft: true, // indicates auto-generated, not saved yet
    }});
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Save / Create liquidation ═══
router.post('/:projectId/liquidation', roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt()], async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const pid = req.params.projectId; const b = req.body;
      const [existing] = await pool.execute('SELECT id FROM liquidation_records WHERE project_id=?', [pid]);

      // Sanitize dates: '2025-08-16T05:00:00.000Z' → '2025-08-16'
      const d = v => v ? String(v).split('T')[0] : null;

      const fields = {
        liquidation_type: b.liquidation_type || 'bilateral',
        liquidation_date: d(b.liquidation_date),
        original_value: b.original_value || 0,
        additions_value: b.additions_value || 0,
        final_contract_value: b.final_contract_value || 0,
        total_paid: b.total_paid || 0,
        total_retained: b.total_retained || 0,
        retention_release: b.retention_release || 0,
        balance_in_favor_of: b.balance_in_favor_of || 'equilibrio',
        balance_amount: b.balance_amount || 0,
        original_start_date: d(b.original_start_date),
        original_end_date: d(b.original_end_date),
        actual_end_date: d(b.actual_end_date),
        total_additions_days: b.total_additions_days || 0,
        total_suspension_days: b.total_suspension_days || 0,
        physical_completion_pct: b.physical_completion_pct || 100,
        pending_obligations: b.pending_obligations || null,
        contractor_observations: b.contractor_observations || null,
        entity_observations: b.entity_observations || null,
        status: b.status || 'borrador',
        signed_by_contractor: b.signed_by_contractor || null,
        signed_by_entity: b.signed_by_entity || null,
        document_id: b.document_id || null,
      };

      if (existing.length > 0) {
        // Update
        const updates = Object.entries(fields).map(([k]) => `${k}=?`);
        const values = Object.values(fields);
        if (b.status === 'firmada') { updates.push('signed_at=NOW()'); }
        values.push(existing[0].id);
        await pool.execute(`UPDATE liquidation_records SET ${updates.join(',')} WHERE id=?`, values);
        // Update project status if signed
        if (b.status === 'firmada') {
          await pool.execute('UPDATE projects SET status="liquidado" WHERE id=?', [pid]);
        }
        const [rows] = await pool.execute('SELECT * FROM liquidation_records WHERE id=?', [existing[0].id]);
        return res.json({ data: rows[0], message: 'Acta de liquidación actualizada' });
      } else {
        // Insert
        fields.project_id = pid;
        fields.created_by = req.user.id;
        const cols = Object.keys(fields);
        const ph = cols.map(() => '?').join(',');
        const [r] = await pool.execute(`INSERT INTO liquidation_records (${cols.join(',')}) VALUES (${ph})`, Object.values(fields));
        const [rows] = await pool.execute('SELECT * FROM liquidation_records WHERE id=?', [r.insertId]);
        res.status(201).json({ data: rows[0], message: 'Acta de liquidación creada' });
      }
    } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Error guardando liquidación' }); }
});

module.exports = router;
