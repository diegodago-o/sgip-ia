const express = require('express');
const { param, body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware, projectAccessMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch(e) { next(e); }
});
function validate(req, res) { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; }

// ═══════════════════════════════════════════════════════════
// AUTO-CALCULATE: Builds Curva S from schedule + budget data
// No manual entry needed — reads real data from other modules
// ═══════════════════════════════════════════════════════════

function getMonthLabel(startDate, m) {
  if (!startDate) return `Mes ${m}`;
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + m - 1);
  const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${names[d.getMonth()]} ${d.getFullYear()}`;
}

function getMonthEnd(startDate, m) {
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + m);
  d.setDate(0); // last day of previous month = last day of month m
  return d;
}

// ═══ GET - Auto-calculated Curva S data ═══
router.get('/:projectId/progress', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;

    // Project info
    const [proj] = await pool.execute(
      'SELECT start_date, execution_term, execution_term_unit, contract_value, progress_pct FROM projects WHERE id=?', [pid]);
    if (!proj.length) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const p = proj[0];
    const startDate = p.start_date;
    const cv = parseFloat(p.contract_value || 0);

    // Calculate total months
    let totalMonths = 12;
    if (p.execution_term_unit === 'meses') totalMonths = p.execution_term || 12;
    else if (p.execution_term_unit === 'anos') totalMonths = (p.execution_term || 1) * 12;
    else totalMonths = Math.ceil((p.execution_term || 360) / 30);

    // Get schedule activities for physical progress
    const [activities] = await pool.execute(
      'SELECT id, name, start_date, end_date, progress_pct, weight_pct, activity_type, status FROM schedule_activities WHERE project_id=? AND parent_id IS NULL ORDER BY sort_order',
      [pid]);

    // Get budget tracking for financial progress (validated entries only)
    const [tracking] = await pool.execute(`
      SELECT bt.mes, SUM(bt.valor_ejecutado) as ejecutado
      FROM budget_tracking bt
      WHERE bt.project_id = ? AND (
        (bt.fuente = 'payroll' AND EXISTS (SELECT 1 FROM budget_payroll bp WHERE bp.id = bt.item_id AND bp.project_id = bt.project_id))
        OR (bt.fuente = 'contractors' AND EXISTS (SELECT 1 FROM budget_contractors bc WHERE bc.id = bt.item_id AND bc.project_id = bt.project_id))
        OR (bt.fuente = 'expenses' AND EXISTS (SELECT 1 FROM budget_expenses be WHERE be.id = bt.item_id AND be.project_id = bt.project_id))
        OR bt.fuente = 'extra'
      )
      GROUP BY bt.mes`, [pid]);
    const execMap = {};
    for (const r of tracking) execMap[r.mes] = parseFloat(r.ejecutado || 0);

    // Get planned budget per month
    const budgetPlanMap = {};
    for (let m = 1; m <= totalMonths; m++) {
      const [payroll] = await pool.execute(
        'SELECT COALESCE(SUM(costo_mensual * cantidad), 0) as t FROM budget_payroll WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)', [pid, m, m]);
      const [contractors] = await pool.execute(
        'SELECT COALESCE(SUM(costo_mensual * cantidad), 0) as t FROM budget_contractors WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)', [pid, m, m]);
      const [expenses] = await pool.execute(
        'SELECT COALESCE(SUM(valor_mensual), 0) as t FROM budget_expenses WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)', [pid, m, m]);
      budgetPlanMap[m] = parseFloat(payroll[0].t) + parseFloat(contractors[0].t) + parseFloat(expenses[0].t);
    }

    // Get saved observations
    const [savedObs] = await pool.execute(
      'SELECT * FROM progress_records WHERE project_id=? ORDER BY period_date', [pid]);
    const obsMap = {};
    for (const r of savedObs) {
      const label = r.period_label;
      obsMap[label] = r;
    }

    // Determine current month (how many months since start)
    const now = new Date();
    let currentMonth = 0;
    if (startDate) {
      const start = new Date(startDate);
      currentMonth = Math.ceil((now - start) / (30.44 * 24 * 60 * 60 * 1000));
      if (currentMonth < 1) currentMonth = 1;
      if (currentMonth > totalMonths) currentMonth = totalMonths;
    }

    // Build monthly data
    const months = [];
    let acumPlanFis = 0, acumRealFis = 0, acumPlanFin = 0, acumRealFin = 0;

    for (let m = 1; m <= totalMonths; m++) {
      const label = getMonthLabel(startDate, m);
      const isFuture = m > currentMonth;

      // --- PHYSICAL PROGRESS ---
      // Planned: linear distribution (100% / totalMonths per month, cumulative)
      const physPlanned = Math.min((m / totalMonths) * 100, 100);

      // Actual: from schedule activities — weighted average of top-level activities
      // Only calculate for past/current months
      let physActual = 0;
      if (!isFuture && activities.length > 0) {
        // Peso efectivo: parsear primero, fallback a 1 si es 0 o inválido
        let weightedProgress = 0;

        for (const a of activities) {
          const w = (parseFloat(a.weight_pct) || 1) / totalWeight;
          // Actividad completada = 100%, sin importar lo que diga progress_pct
          const actPct = a.status === 'completada' ? 100 : (parseFloat(a.progress_pct) || 0);
          // Check if activity should have started by this month
          if (a.start_date && startDate) {
            const actStart = new Date(a.start_date);
            const monthEnd = getMonthEnd(startDate, m);
            if (actStart <= monthEnd) {
              weightedProgress += actPct * w;
            }
          } else {
            weightedProgress += actPct * w;
          }
        }
        // For past months (not current), we'd need historical snapshots
        // Since we don't have them, use current progress scaled to month position
        if (m < currentMonth) {
          // Scale: assume linear progress up to current value
          const currentProgress = activities.reduce((s, a) => {
            const tw = activities.reduce((s2, a2) => s2 + (parseFloat(a2.weight_pct) || 1), 0);
            const actPct = a.status === 'completada' ? 100 : (parseFloat(a.progress_pct) || 0);
            return s + (actPct * (parseFloat(a.weight_pct) || 1) / tw);
          }, 0);
          physActual = Math.min((m / currentMonth) * currentProgress, 100);
        } else if (m === currentMonth) {
          physActual = weightedProgress;
        }
      }

      // --- FINANCIAL PROGRESS ---
      const finPlanned = budgetPlanMap[m] || 0;
      const finActual = execMap[m] || 0;

      acumPlanFis = physPlanned; // already cumulative
      acumRealFis = physActual;
      acumPlanFin += finPlanned;
      acumRealFin += finActual;

      // Check for saved manual observation
      const saved = obsMap[label] || obsMap[`Mes ${m}`];

      months.push({
        mes: m,
        label,
        isFuture,
        isCurrent: m === currentMonth,
        // Physical (%)
        physical_planned: Math.round(physPlanned * 10) / 10,
        physical_actual: Math.round(physActual * 10) / 10,
        physical_deviation: Math.round((physActual - physPlanned) * 10) / 10,
        // Financial ($)
        financial_planned: Math.round(finPlanned),
        financial_actual: Math.round(finActual),
        financial_deviation: Math.round(finActual - finPlanned),
        // Cumulative financial
        acum_financial_planned: Math.round(acumPlanFin),
        acum_financial_actual: Math.round(acumRealFin),
        // Observations (from saved records)
        observations: saved?.observations || null,
        record_id: saved?.id || null,
      });
    }

    // Summary
    const latestActual = months.filter(m => !m.isFuture);
    const latest = latestActual.length > 0 ? latestActual[latestActual.length - 1] : null;

    res.json({
      data: months,
      summary: {
        total_months: totalMonths,
        current_month: currentMonth,
        contract_value: cv,
        // Physical
        physical_planned: latest?.physical_planned || 0,
        physical_actual: latest?.physical_actual || 0,
        physical_deviation: latest?.physical_deviation || 0,
        // Financial
        total_planned: acumPlanFin,
        total_executed: acumRealFin,
        financial_deviation: acumRealFin - acumPlanFin,
        execution_pct: cv > 0 ? Math.round((acumRealFin / cv) * 1000) / 10 : 0,
        // Activities
        activities_total: activities.length,
        activities_completed: activities.filter(a => a.status === 'completada').length,
        overall_progress: parseFloat(p.progress_pct || 0),
      },
    });
  } catch (err) { console.error('Progress auto-calc:', err); res.status(500).json({ error: err.message }); }
});

// ═══ GET - Summary (for header cards) ═══
router.get('/:projectId/progress/summary', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;
    const [proj] = await pool.execute('SELECT contract_value, progress_pct FROM projects WHERE id=?', [pid]);
    const cv = parseFloat(proj[0]?.contract_value || 0);

    // Financial from tracking
    const [tracking] = await pool.execute(`
      SELECT SUM(bt.valor_ejecutado) as total
      FROM budget_tracking bt
      WHERE bt.project_id = ? AND (
        (bt.fuente = 'payroll' AND EXISTS (SELECT 1 FROM budget_payroll bp WHERE bp.id = bt.item_id AND bp.project_id = bt.project_id))
        OR (bt.fuente = 'contractors' AND EXISTS (SELECT 1 FROM budget_contractors bc WHERE bc.id = bt.item_id AND bc.project_id = bt.project_id))
        OR (bt.fuente = 'expenses' AND EXISTS (SELECT 1 FROM budget_expenses be WHERE be.id = bt.item_id AND be.project_id = bt.project_id))
        OR bt.fuente = 'extra'
      )`, [pid]);
    const totalExec = parseFloat(tracking[0]?.total || 0);

    // Schedule progress
    const [sched] = await pool.execute(
      'SELECT COUNT(*) as total, SUM(status="completada") as done FROM schedule_activities WHERE project_id=? AND parent_id IS NULL', [pid]);

    const [records] = await pool.execute('SELECT COUNT(*) as c FROM progress_records WHERE project_id=?', [pid]);

    res.json({
      data: {
        total_executed: totalExec,
        execution_pct: cv > 0 ? Math.round((totalExec / cv) * 1000) / 10 : 0,
        contract_value: cv,
        physical_progress: parseFloat(proj[0]?.progress_pct || 0),
        activities_total: parseInt(sched[0]?.total || 0),
        activities_completed: parseInt(sched[0]?.done || 0),
        periods: parseInt(records[0]?.c || 0),
        deviation_physical: 0,
        deviation_financial: 0,
      }
    });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ POST - Save observation for a period (optional enrichment) ═══
router.post('/:projectId/progress', roleMiddleware('admin','gerente_proyecto','director','apoyo','consultor'),
  [param('projectId').isInt()],
  async (req, res) => {
    try {
      const b = req.body; const pid = req.params.projectId;

      // Check if record exists for this period
      const [existing] = await pool.execute(
        'SELECT id FROM progress_records WHERE project_id=? AND period_label=?', [pid, b.period_label]);

      if (existing.length > 0) {
        // Update
        await pool.execute(
          'UPDATE progress_records SET observations=?, physical_planned=?, physical_actual=?, financial_planned=?, financial_actual=?, period_date=? WHERE id=?',
          [b.observations || null, b.physical_planned || 0, b.physical_actual || 0, b.financial_planned || 0, b.financial_actual || 0, b.period_date || new Date().toISOString().split('T')[0], existing[0].id]);
        return res.json({ message: 'Observación guardada' });
      }

      // Insert new
      await pool.execute(
        'INSERT INTO progress_records (project_id,period_label,period_date,physical_planned,physical_actual,financial_planned,financial_actual,observations,recorded_by) VALUES (?,?,?,?,?,?,?,?,?)',
        [pid, b.period_label, b.period_date || new Date().toISOString().split('T')[0],
         b.physical_planned || 0, b.physical_actual || 0, b.financial_planned || 0, b.financial_actual || 0,
         b.observations || null, req.user.id]);

      // Update project progress
      const [latestProg] = await pool.execute(
        'SELECT physical_actual FROM progress_records WHERE project_id=? ORDER BY period_date DESC LIMIT 1', [pid]);
      if (latestProg.length > 0) {
        await pool.execute('UPDATE projects SET progress_pct=? WHERE id=?', [latestProg[0].physical_actual, pid]);
      }

      res.status(201).json({ message: 'Registro guardado' });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ═══ DELETE ═══
router.delete('/:projectId/progress/:id', roleMiddleware('admin'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    try {
      await pool.execute('DELETE FROM progress_records WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      res.json({ message: 'Registro eliminado' });
    } catch (err) { res.status(500).json({ error: 'Error' }); }
});

module.exports = router;
