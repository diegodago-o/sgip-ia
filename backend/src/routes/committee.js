const express = require('express');
const { param } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, projectAccessMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
// Verify user has access to the project
router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch(e) { next(e); }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/committee/:projectId/dashboard
// Returns ALL project data consolidated for committee display
// ═══════════════════════════════════════════════════════════════
router.get('/:projectId/dashboard', [param('projectId').isInt()], async (req, res) => {
  try {
    const pid = parseInt(req.params.projectId);
    const committeeType = req.query.type || 'mensual';

    // ── 1. PROJECT INFO ──
    const [projRows] = await pool.execute('SELECT * FROM projects WHERE id=?', [pid]);
    if (!projRows.length) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const project = projRows[0];

    // Calculate time progress
    const startDate = project.start_date ? new Date(project.start_date) : null;
    const now = new Date();
    let totalDays = 0, elapsedDays = 0, timePct = 0, daysRemaining = 0;
    if (startDate) {
      const endDate = new Date(startDate);
      const term = parseInt(project.execution_term) || 12;
      if (project.execution_term_unit === 'dias') endDate.setDate(endDate.getDate() + term);
      else endDate.setMonth(endDate.getMonth() + term);
      totalDays = Math.max(1, Math.ceil((endDate - startDate) / 86400000));
      elapsedDays = Math.ceil((now - startDate) / 86400000);
      daysRemaining = Math.max(0, Math.ceil((endDate - now) / 86400000));
      timePct = Math.min(100, Math.max(0, (elapsedDays / totalDays) * 100));
    }

    // ── 2. SCHEDULE / CRONOGRAMA ──
    const [schedStats] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='no_iniciada') as no_iniciada, SUM(status='en_progreso') as en_progreso,
        SUM(status='completada') as completada, SUM(status='atrasada') as atrasada,
        SUM(status='suspendida') as suspendida,
        SUM(activity_type='task') as tasks,
        AVG(CASE WHEN activity_type='task' THEN progress_pct END) as avg_progress
      FROM schedule_activities WHERE project_id=?`, [pid]);
    const sched = schedStats[0];
    sched.avg_progress = parseFloat(sched.avg_progress || 0);

    // Late activities detail
    const [lateActivities] = await pool.execute(`
      SELECT name, end_date, progress_pct, DATEDIFF(CURDATE(), end_date) as days_late
      FROM schedule_activities
      WHERE project_id=? AND activity_type='task' AND end_date < CURDATE() AND progress_pct < 100
      ORDER BY days_late DESC LIMIT 10`, [pid]);

    // Upcoming milestones
    const [upcomingMilestones] = await pool.execute(`
      SELECT name, end_date, progress_pct, DATEDIFF(end_date, CURDATE()) as days_until
      FROM schedule_activities
      WHERE project_id=? AND (activity_type='milestone' OR weight_pct > 5) AND progress_pct < 100
      ORDER BY end_date ASC LIMIT 5`, [pid]);

    // ── 3. FINANCIAL / PRESUPUESTO ──
    const [incomeRows] = await pool.execute('SELECT * FROM budget_income WHERE project_id=?', [pid]);
    let totalIncome = 0, ivaTotal = 0;
    for (const r of incomeRows) {
      const val = parseFloat(r.value || 0);
      if (r.es_iva) ivaTotal += val;
      else if (!r.es_total_con_iva && r.tipo === 'ingreso') totalIncome += val;
    }
    const totalConIva = totalIncome + ivaTotal;

    const [payroll] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_payroll WHERE project_id=?', [pid]);
    const [contractors] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_contractors WHERE project_id=?', [pid]);
    const [expenses] = await pool.execute('SELECT COALESCE(SUM(valor_total),0) as t FROM budget_expenses WHERE project_id=?', [pid]);
    const [pucRows] = await pool.execute('SELECT * FROM budget_puc_accounts WHERE project_id=?', [pid]);
    const totalPuc = pucRows.filter(r => r.cuenta && r.cuenta.startsWith('5') && !r.es_subtotal).reduce((s, r) => s + parseFloat(r.valor || 0), 0);

    const totalBudgeted = totalPuc + parseFloat(payroll[0].t) + parseFloat(contractors[0].t) + parseFloat(expenses[0].t);

    // Budget tracking (actual execution - only valid entries)
    let totalExecuted = 0, executionByMonth = [];
    try {
      const [tracking] = await pool.execute(`
        SELECT bt.mes, SUM(bt.valor_ejecutado) as ejecutado
        FROM budget_tracking bt
        WHERE bt.project_id = ? AND (
          (bt.fuente = 'payroll' AND EXISTS (SELECT 1 FROM budget_payroll bp WHERE bp.id = bt.item_id AND bp.project_id = bt.project_id))
          OR (bt.fuente = 'contractors' AND EXISTS (SELECT 1 FROM budget_contractors bc WHERE bc.id = bt.item_id AND bc.project_id = bt.project_id))
          OR (bt.fuente = 'expenses' AND EXISTS (SELECT 1 FROM budget_expenses be WHERE be.id = bt.item_id AND be.project_id = bt.project_id))
          OR bt.fuente = 'extra'
        )
        GROUP BY bt.mes ORDER BY bt.mes`, [pid]);
      executionByMonth = tracking;
      totalExecuted = tracking.reduce((s, r) => s + parseFloat(r.ejecutado || 0), 0);
    } catch (e) { console.warn('Budget tracking query:', e.message); }

    // Payments received
    let paymentsData = { total_invoiced: 0, total_paid: 0, pending: 0, payments: [] };
    try {
      const [pays] = await pool.execute(`
        SELECT status, COUNT(*) as cnt, SUM(gross_value) as gross, SUM(net_value) as net
        FROM payments WHERE project_id=? GROUP BY status`, [pid]);
      const [payList] = await pool.execute(`
        SELECT payment_number, concept, gross_value, net_value, invoice_date, status
        FROM payments WHERE project_id=? ORDER BY invoice_date DESC LIMIT 5`, [pid]);
      paymentsData.payments = payList;
      pays.forEach(p => {
        if (p.status === 'pagado') paymentsData.total_paid += parseFloat(p.net || 0);
        paymentsData.total_invoiced += parseFloat(p.gross || 0);
      });
      paymentsData.pending = paymentsData.total_invoiced - paymentsData.total_paid;
    } catch {}

    // ── 4. OBLIGATIONS ──
    const [obStats] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='pendiente') as pendientes, SUM(status='en_curso') as en_curso,
        SUM(status='cumplida') as cumplidas, SUM(status='vencida') as vencidas
      FROM obligations WHERE project_id=?`, [pid]);

    // Overdue obligations
    const [overdueObs] = await pool.execute(`
      SELECT code, description, due_date, obligation_type, risk_level
      FROM obligations WHERE project_id=? AND status='vencida'
      ORDER BY due_date ASC LIMIT 10`, [pid]);

    // ── 5. RISKS ──
    const [riskStats] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='identificado') as identificados, SUM(status='mitigando') as mitigando,
        SUM(status='materializado') as materializados, SUM(status='cerrado') as cerrados,
        SUM(risk_score >= 15) as criticos, SUM(risk_score >= 8 AND risk_score < 15) as altos
      FROM risks WHERE project_id=?`, [pid]);

    const [topRisks] = await pool.execute(`
      SELECT risk_code, description, category, probability, impact, risk_score, risk_level, mitigation_plan, status
      FROM risks WHERE project_id=? AND status NOT IN ('cerrado')
      ORDER BY risk_score DESC LIMIT 5`, [pid]);

    // ── 6. POLICIES / PÓLIZAS ──
    const [policyStats] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='vigente') as vigentes, SUM(status='por_vencer') as por_vencer,
        SUM(status='vencida') as vencidas, SUM(status='aprobada') as aprobadas
      FROM policies WHERE project_id=?`, [pid]);

    const [expiringPolicies] = await pool.execute(`
      SELECT policy_type, insurer, expiry_date, insured_value, status,
        DATEDIFF(expiry_date, CURDATE()) as days_to_expire
      FROM policies WHERE project_id=? AND status IN ('vigente','por_vencer')
      ORDER BY expiry_date ASC LIMIT 5`, [pid]);

    // ── 7. TEAM ──
    const [teamStats] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='activo') as activos, SUM(status='por_reemplazar') as por_reemplazar,
        SUM(profile_compliant=1) as cumplen_perfil, SUM(profile_compliant=0) as no_cumplen,
        AVG(dedication_pct) as avg_dedication
      FROM team_members WHERE project_id=?`, [pid]);

    // ── 8. MILESTONES & DELIVERABLES ──
    const [mileStats] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='completado') as completados, SUM(status='en_progreso') as en_progreso,
        SUM(status='pendiente') as pendientes, SUM(status='atrasado') as atrasados
      FROM milestones WHERE project_id=?`, [pid]);

    const [delivStats] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='aprobado') as aprobados, SUM(status='en_revision') as en_revision,
        SUM(status='pendiente') as pendientes, SUM(status='rechazado') as rechazados
      FROM deliverables WHERE project_id=?`, [pid]);

    // ── 9. COMMITMENTS (from meeting action_items) ──
    let commitments = { total: 0, completed: 0, pending: 0, overdue: 0, items: [] };
    try {
      const [minutes] = await pool.execute(`
        SELECT id, minute_number, meeting_date, action_items
        FROM meeting_minutes WHERE project_id=? AND action_items IS NOT NULL
        ORDER BY meeting_date DESC`, [pid]);

      let allItems = [];
      for (const m of minutes) {
        let items = [];
        try { items = typeof m.action_items === 'string' ? JSON.parse(m.action_items) : (m.action_items || []); } catch {}
        items.forEach((it, idx) => {
          allItems.push({
            ...it,
            minute_id: m.id,
            minute_number: m.minute_number,
            meeting_date: m.meeting_date,
            item_index: idx,
          });
        });
      }
      commitments.total = allItems.length;
      commitments.completed = allItems.filter(i => i.status === 'completado' || i.completed).length;
      commitments.pending = allItems.filter(i => !i.completed && i.status !== 'completado').length;
      commitments.overdue = allItems.filter(i => {
        if (i.completed || i.status === 'completado') return false;
        return i.due_date && new Date(i.due_date) < now;
      }).length;
      // Last 15 pending items
      commitments.items = allItems
        .filter(i => !i.completed && i.status !== 'completado')
        .sort((a, b) => new Date(a.due_date || '9999') - new Date(b.due_date || '9999'))
        .slice(0, 15);
    } catch {}

    // ── 10. CHANGES / ADICIONES ──
    let changes = { total: 0, approved: 0, pending: 0, total_value: 0 };
    try {
      const [ch] = await pool.execute(`
        SELECT COUNT(*) as total,
          SUM(status='aprobado') as approved, SUM(status='pendiente') as pending,
          SUM(CASE WHEN status='aprobado' THEN value_change ELSE 0 END) as total_value
        FROM change_orders WHERE project_id=?`, [pid]);
      changes = { ...ch[0], total_value: parseFloat(ch[0].total_value || 0) };
    } catch {}

    // ── 11. DOCUMENTS ──
    const [docStats] = await pool.execute(`
      SELECT COUNT(*) as total FROM documents WHERE project_id=?`, [pid]);

    // ── SEMÁFOROS (traffic lights) ──
    const physicalProgress = sched.avg_progress || 0;
    const timeProgress = timePct;
    const financialProgress = totalConIva > 0 ? (totalExecuted / totalConIva * 100) : 0;

    const semaforos = {
      general: calcSemaforo(physicalProgress, timeProgress, obStats[0], riskStats[0]),
      cronograma: physicalProgress >= timeProgress - 5 ? 'verde' : physicalProgress >= timeProgress - 15 ? 'amarillo' : 'rojo',
      financiero: Math.abs(financialProgress - timeProgress) < 10 ? 'verde' : Math.abs(financialProgress - timeProgress) < 25 ? 'amarillo' : 'rojo',
      obligaciones: parseInt(obStats[0].vencidas || 0) === 0 ? 'verde' : parseInt(obStats[0].vencidas) <= 3 ? 'amarillo' : 'rojo',
      riesgos: parseInt(riskStats[0].criticos || 0) === 0 && parseInt(riskStats[0].materializados || 0) === 0 ? 'verde' : parseInt(riskStats[0].criticos || 0) <= 2 ? 'amarillo' : 'rojo',
      polizas: parseInt(policyStats[0].vencidas || 0) === 0 ? 'verde' : 'rojo',
      equipo: parseInt(teamStats[0].por_reemplazar || 0) === 0 ? 'verde' : parseInt(teamStats[0].por_reemplazar) <= 2 ? 'amarillo' : 'rojo',
      compromisos: commitments.overdue === 0 ? 'verde' : commitments.overdue <= 3 ? 'amarillo' : 'rojo',
    };

    // ── PERIOD CALCULATION based on committee type ──
    let periodEnd = new Date();
    let periodStart = new Date();
    let periodLabel = '';
    if (committeeType === 'custom') {
      const df = req.query.date_from;
      const dt = req.query.date_to;
      if (df) periodStart = new Date(df + 'T00:00:00');
      if (dt) periodEnd   = new Date(dt + 'T23:59:59');
      periodLabel = 'Personalizado';
    } else if (committeeType === 'quincenal') {
      periodStart.setDate(periodEnd.getDate() - 15);
      periodLabel = 'Quincenal';
    } else if (committeeType === 'extraordinario') {
      periodStart.setDate(periodEnd.getDate() - 7);
      periodLabel = 'Extraordinario';
    } else {
      periodStart.setMonth(periodEnd.getMonth() - 1);
      periodLabel = 'Mensual';
    }
    const periodStartStr = periodStart.toISOString().split('T')[0];
    const periodEndStr = periodEnd.toISOString().split('T')[0];
    const periodDays = Math.ceil((periodEnd - periodStart) / 86400000);

    // ── PERIOD ACTIVITY — what happened in this period ──
    let periodActivity = { activities_completed: 0, obligations_completed: 0, risks_new: 0, risks_closed: 0, payments_count: 0, payments_value: 0 };
    try {
      const [actComp] = await pool.execute(
        "SELECT COUNT(*) as c FROM schedule_activities WHERE project_id=? AND status='completada' AND updated_at BETWEEN ? AND ?",
        [pid, periodStartStr, periodEndStr]);
      periodActivity.activities_completed = parseInt(actComp[0]?.c || 0);

      const [obComp] = await pool.execute(
        "SELECT COUNT(*) as c FROM obligations WHERE project_id=? AND status='cumplida' AND updated_at BETWEEN ? AND ?",
        [pid, periodStartStr, periodEndStr]);
      periodActivity.obligations_completed = parseInt(obComp[0]?.c || 0);

      const [rNew] = await pool.execute(
        "SELECT COUNT(*) as c FROM risks WHERE project_id=? AND created_at BETWEEN ? AND ?",
        [pid, periodStartStr, periodEndStr]);
      periodActivity.risks_new = parseInt(rNew[0]?.c || 0);

      const [rClosed] = await pool.execute(
        "SELECT COUNT(*) as c FROM risks WHERE project_id=? AND status IN ('cerrado','mitigado') AND updated_at BETWEEN ? AND ?",
        [pid, periodStartStr, periodEndStr]);
      periodActivity.risks_closed = parseInt(rClosed[0]?.c || 0);

      const [pays] = await pool.execute(
        "SELECT COUNT(*) as c, COALESCE(SUM(net_value),0) as v FROM payments WHERE project_id=? AND status='pagado' AND paid_date BETWEEN ? AND ?",
        [pid, periodStartStr, periodEndStr]);
      periodActivity.payments_count = parseInt(pays[0]?.c || 0);
      periodActivity.payments_value = parseFloat(pays[0]?.v || 0);
    } catch (e) { console.warn('Period activity:', e.message); }

    // ── RESPONSE ──
    res.json({
      data: {
        project: {
          id: project.id, name: project.name, code: project.code,
          contract_type: project.contract_type, status: project.status,
          priority: project.priority, client_name: project.client_name,
          contract_value: parseFloat(project.contract_value || 0),
          start_date: project.start_date, execution_term: project.execution_term,
          execution_term_unit: project.execution_term_unit,
          total_days: totalDays, elapsed_days: elapsedDays,
          days_remaining: daysRemaining, time_pct: Math.round(timePct * 10) / 10,
        },
        semaforos,
        schedule: {
          stats: sched,
          physical_progress: Math.round(physicalProgress * 10) / 10,
          time_progress: Math.round(timePct * 10) / 10,
          deviation: Math.round((physicalProgress - timePct) * 10) / 10,
          late_activities: lateActivities,
          upcoming_milestones: upcomingMilestones,
        },
        financial: {
          total_income: totalConIva, total_income_sin_iva: totalIncome, iva: ivaTotal,
          total_budgeted: totalBudgeted,
          total_executed: totalExecuted,
          budget_pct: totalBudgeted > 0 ? Math.round((totalExecuted / totalBudgeted) * 1000) / 10 : 0,
          execution_pct: totalConIva > 0 ? Math.round((totalExecuted / totalConIva) * 1000) / 10 : 0,
          breakdown: {
            payroll: parseFloat(payroll[0].t), contractors: parseFloat(contractors[0].t),
            expenses: parseFloat(expenses[0].t), puc: totalPuc,
          },
          by_month: executionByMonth,
          payments: paymentsData,
        },
        obligations: { ...obStats[0], overdue: overdueObs },
        risks: { ...riskStats[0], top: topRisks },
        policies: { ...policyStats[0], expiring: expiringPolicies },
        team: { ...teamStats[0], avg_dedication: parseFloat(teamStats[0].avg_dedication || 0) },
        milestones: mileStats[0],
        deliverables: delivStats[0],
        commitments,
        changes,
        documents: docStats[0],
        period: { type: committeeType, label: periodLabel, start: periodStartStr, end: periodEndStr, days: periodDays },
        period_activity: periodActivity,
        generated_at: new Date().toISOString(),
      }
    });
  } catch (err) {
    console.error('Committee dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

function calcSemaforo(physical, time, obs, risks) {
  let score = 0;
  // Physical vs time
  if (physical >= time - 5) score += 3;
  else if (physical >= time - 15) score += 2;
  else score += 0;
  // Obligations
  if (parseInt(obs.vencidas || 0) === 0) score += 2;
  else if (parseInt(obs.vencidas) <= 3) score += 1;
  // Risks
  if (parseInt(risks.criticos || 0) === 0 && parseInt(risks.materializados || 0) === 0) score += 2;
  else if (parseInt(risks.criticos) <= 2) score += 1;

  if (score >= 6) return 'verde';
  if (score >= 3) return 'amarillo';
  return 'rojo';
}

// ═══════════════════════════════════════════════════════════════
// PATCH /api/committee/:projectId/commitments/:minuteId/:index
// Update a single commitment status inline from committee view
// ═══════════════════════════════════════════════════════════════
router.patch('/:projectId/commitments/:minuteId/:index', [param('projectId').isInt(), param('minuteId').isInt(), param('index').isInt()], async (req, res) => {
  try {
    const { minuteId, index } = req.params;
    const idx = parseInt(index);

    const [rows] = await pool.execute(
      'SELECT id, action_items FROM meeting_minutes WHERE id=? AND project_id=?',
      [minuteId, req.params.projectId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Acta no encontrada' });

    let items = [];
    try { items = typeof rows[0].action_items === 'string' ? JSON.parse(rows[0].action_items) : (rows[0].action_items || []); } catch {}

    if (idx < 0 || idx >= items.length) return res.status(400).json({ error: 'Índice de compromiso inválido' });

    const allowed = ['status', 'notes', 'evidence', 'completed_date', 'responsible', 'due_date', 'priority'];
    allowed.forEach(f => { if (req.body[f] !== undefined) items[idx][f] = req.body[f]; });

    if (req.body.status === 'completado') {
      items[idx].completed = true;
      if (!items[idx].completed_date) items[idx].completed_date = new Date().toISOString().split('T')[0];
    } else if (req.body.status === 'pendiente' || req.body.status === 'en_progreso') {
      items[idx].completed = false;
    }

    await pool.execute('UPDATE meeting_minutes SET action_items=? WHERE id=?', [JSON.stringify(items), minuteId]);
    res.json({ data: items[idx], message: 'Compromiso actualizado' });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════════════════════════
// GET /api/committee/:projectId/history
// List past committee reports
// ═══════════════════════════════════════════════════════════════
router.get('/:projectId/history', [param('projectId').isInt()], async (req, res) => {
  try {
    const [rows] = await pool.execute(`
      SELECT id, minute_number, title, meeting_date, minute_type, status
      FROM meeting_minutes
      WHERE project_id=? AND minute_type IN ('comite_seguimiento','comite_obra')
      ORDER BY meeting_date DESC`, [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
