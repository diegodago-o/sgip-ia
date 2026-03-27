const express = require('express');
const pool = require('../config/database');
const { authMiddleware, projectAccessMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch(e) { next(e); }
});

router.get('/:projectId/panel', async (req, res) => {
  const pid = parseInt(req.params.projectId);
  try {
    const [
      [projRows],
      [paySumRows],
      [schedRows],
      [riskRows],
      [obRows],
      [polRows],
      [teamRows],
      [corrRows],
      [msRows],
      [delivRows],
      [changeRows],
      [trackRows],
      [progressRows],
      [payrollBac],
      [conBac],
      [expBac],
      [nextMsRows],
      [tlObsRows],
      [tlMsRows],
      [tlPayRows],
      [tlMinRows],
      [tlChgRows],
      [recentRows],
    ] = await Promise.all([
      // Project
      pool.execute(`SELECT p.id, p.name, p.code, p.status, p.project_type, p.client_name, p.sector,
        p.start_date, p.execution_term, p.execution_term_unit, p.contract_value, p.progress_pct, p.priority,
        DATEDIFF(CURDATE(), p.start_date) as elapsed_days,
        CASE WHEN p.execution_term_unit='meses' THEN p.execution_term*30
             WHEN p.execution_term_unit='anos'  THEN p.execution_term*365
             ELSE p.execution_term END as total_days,
        CASE WHEN p.execution_term_unit='meses' THEN DATE_ADD(p.start_date, INTERVAL p.execution_term MONTH)
             WHEN p.execution_term_unit='anos'  THEN DATE_ADD(p.start_date, INTERVAL p.execution_term YEAR)
             ELSE DATE_ADD(p.start_date, INTERVAL p.execution_term DAY) END as end_date
        FROM projects p WHERE p.id=?`, [pid]),

      // Payments summary
      pool.execute(`SELECT COUNT(*) as total,
        SUM(status='pagado') as pagados, SUM(status='aprobado') as aprobados, SUM(status='pendiente') as pendientes,
        COALESCE(SUM(CASE WHEN status='pagado' THEN net_value ELSE 0 END),0) as total_paid,
        COALESCE(SUM(gross_value),0) as total_invoiced,
        MAX(CASE WHEN status='pagado' THEN paid_date END) as last_payment_date
        FROM payments WHERE project_id=?`, [pid]),

      // Schedule stats (tasks only)
      pool.execute(`SELECT COUNT(*) as total,
        SUM(status='completada') as completadas,
        SUM(status='atrasada' OR (end_date < CURDATE() AND progress_pct < 100 AND activity_type='task')) as atrasadas,
        SUM(status='en_progreso') as en_progreso,
        AVG(CASE WHEN activity_type='task' THEN progress_pct END) as avg_progress
        FROM schedule_activities WHERE project_id=? AND activity_type='task'`, [pid]),

      // Risks
      pool.execute(`SELECT COUNT(*) as total,
        SUM(status NOT IN ('cerrado')) as activos,
        SUM(risk_score >= 15) as criticos,
        SUM(risk_score >= 8 AND risk_score < 15) as altos,
        SUM(risk_score < 8 AND status NOT IN ('cerrado')) as medios_bajos,
        SUM(status='materializado') as materializados
        FROM risks WHERE project_id=?`, [pid]),

      // Obligations
      pool.execute(`SELECT COUNT(*) as total,
        SUM(status='vencida') as vencidas,
        SUM(status='pendiente') as pendientes,
        SUM(status='en_curso') as en_curso,
        SUM(status='cumplida') as cumplidas,
        SUM(due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND status NOT IN ('cumplida','vencida','no_aplica')) as due_week,
        SUM(due_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 30 DAY) AND status NOT IN ('cumplida','vencida','no_aplica')) as due_month
        FROM obligations WHERE project_id=?`, [pid]),

      // Policies
      pool.execute(`SELECT COUNT(*) as total,
        SUM(status='vigente') as vigentes, SUM(status='por_vencer') as por_vencer, SUM(status='vencida') as vencidas,
        SUM(DATEDIFF(expiry_date, CURDATE()) BETWEEN 0 AND 15 AND status != 'vencida') as alert_15,
        MIN(CASE WHEN status IN ('vigente','por_vencer') AND expiry_date > CURDATE() THEN expiry_date END) as next_expiry
        FROM policies WHERE project_id=?`, [pid]),

      // Team
      pool.execute(`SELECT COUNT(*) as total,
        SUM(status='activo') as activos,
        SUM(profile_compliant=1) as conformes,
        SUM(profile_compliant=0 AND status='activo') as no_conformes
        FROM team_members WHERE project_id=?`, [pid]),

      // Correspondence
      pool.execute(`SELECT COUNT(*) as total,
        SUM(status='recibido') as recibidas,
        SUM(status IN ('radicado','enviado')) as enviadas,
        SUM(status='recibido') as sin_respuesta,
        SUM(status='recibido'
            AND reference_date < DATE_SUB(CURDATE(), INTERVAL 7 DAY)) as vencidas_respuesta
        FROM correspondence WHERE project_id=?`, [pid]),

      // Milestones
      pool.execute(`SELECT COUNT(*) as total,
        SUM(status='cumplido') as cumplidos, SUM(status='vencido') as vencidos,
        SUM(status='pendiente') as pendientes,
        MIN(CASE WHEN status='pendiente' AND due_date >= CURDATE() THEN due_date END) as next_due
        FROM milestones WHERE project_id=?`, [pid]),

      // Deliverables
      pool.execute(`SELECT COUNT(*) as total,
        SUM(status='aprobado') as aprobados, SUM(status='rechazado') as rechazados,
        SUM(status='pendiente') as pendientes, SUM(status='en_elaboracion') as en_elaboracion,
        SUM(status='entregado') as entregados
        FROM deliverables WHERE project_id=?`, [pid]),

      // Changes
      pool.execute(`SELECT COUNT(*) as total,
        SUM(status='aprobado') as aprobados, SUM(status='implementado') as implementados,
        SUM(status IN ('solicitado','en_revision')) as pendientes,
        COALESCE(SUM(impact_cost),0) as total_impact_cost,
        COALESCE(SUM(impact_days),0) as total_impact_days
        FROM change_orders WHERE project_id=?`, [pid]),

      // Budget tracking
      pool.execute(`SELECT
        COALESCE(SUM(bt.valor_ejecutado),0) as total_ejecutado,
        COALESCE(SUM(bt.valor_planeado),0)  as total_planeado
        FROM budget_tracking bt WHERE bt.project_id=?
        AND ((bt.fuente='payroll'      AND EXISTS(SELECT 1 FROM budget_payroll     WHERE id=bt.item_id AND project_id=bt.project_id))
          OR (bt.fuente='contractors'  AND EXISTS(SELECT 1 FROM budget_contractors WHERE id=bt.item_id AND project_id=bt.project_id))
          OR (bt.fuente='expenses'     AND EXISTS(SELECT 1 FROM budget_expenses    WHERE id=bt.item_id AND project_id=bt.project_id))
          OR bt.fuente='extra')`, [pid]),

      // Progress records (curva S)
      pool.execute(`SELECT period_label, period_date, physical_planned, physical_actual, financial_planned, financial_actual
        FROM progress_records WHERE project_id=? ORDER BY period_date`, [pid]),

      // BAC: payroll
      pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_payroll WHERE project_id=?', [pid]),
      // BAC: contractors
      pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_contractors WHERE project_id=?', [pid]),
      // BAC: expenses
      pool.execute('SELECT COALESCE(SUM(valor_total),0) as t FROM budget_expenses WHERE project_id=?', [pid]),

      // Next milestone name
      pool.execute(`SELECT name FROM milestones WHERE project_id=? AND status='pendiente' AND due_date >= CURDATE() ORDER BY due_date ASC LIMIT 1`, [pid]),

      // Timeline: obligations
      pool.execute(`SELECT 'obligation' as type, COALESCE(code,'') as ref, LEFT(description,80) as name, due_date as date, status, COALESCE(risk_level,'medio') as severity
        FROM obligations WHERE project_id=? AND due_date IS NOT NULL ORDER BY due_date DESC LIMIT 15`, [pid]),

      // Timeline: milestones
      pool.execute(`SELECT 'milestone' as type, '' as ref, name, due_date as date, status, 'alto' as severity
        FROM milestones WHERE project_id=? AND due_date IS NOT NULL ORDER BY due_date DESC LIMIT 10`, [pid]),

      // Timeline: payments
      pool.execute(`SELECT 'payment' as type, COALESCE(payment_number,'') as ref, concept as name,
        COALESCE(paid_date, invoice_date) as date, status, 'medio' as severity,
        net_value as amount
        FROM payments WHERE project_id=? AND (paid_date IS NOT NULL OR invoice_date IS NOT NULL)
        ORDER BY COALESCE(paid_date, invoice_date) DESC LIMIT 10`, [pid]),

      // Timeline: minutes
      pool.execute(`SELECT 'minute' as type, COALESCE(minute_number,'') as ref, title as name,
        meeting_date as date, status, 'bajo' as severity
        FROM meeting_minutes WHERE project_id=? AND meeting_date IS NOT NULL ORDER BY meeting_date DESC LIMIT 8`, [pid]),

      // Timeline: changes
      pool.execute(`SELECT 'change' as type, COALESCE(change_number,'') as ref, title as name,
        requested_date as date, status, 'medio' as severity
        FROM change_orders WHERE project_id=? AND requested_date IS NOT NULL ORDER BY requested_date DESC LIMIT 5`, [pid]),

      // Recent activity (cross-module union)
      pool.execute(`
        (SELECT 'payment'        as type, concept                          as title, status, created_at as date FROM payments       WHERE project_id=? ORDER BY created_at  DESC LIMIT 3)
        UNION ALL
        (SELECT 'risk'           as type, LEFT(description,60)             as title, status, updated_at as date FROM risks          WHERE project_id=? ORDER BY updated_at  DESC LIMIT 3)
        UNION ALL
        (SELECT 'obligation'     as type, LEFT(description,60)             as title, status, updated_at as date FROM obligations    WHERE project_id=? ORDER BY updated_at  DESC LIMIT 3)
        UNION ALL
        (SELECT 'minute'         as type, title                            as title, status, created_at as date FROM meeting_minutes WHERE project_id=? ORDER BY created_at  DESC LIMIT 3)
        UNION ALL
        (SELECT 'correspondence' as type, LEFT(subject,60)                 as title, status, created_at as date FROM correspondence WHERE project_id=? ORDER BY created_at  DESC LIMIT 2)
        ORDER BY date DESC LIMIT 12`, [pid, pid, pid, pid, pid]),
    ]);

    const proj = projRows[0];
    if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

    // BAC
    const bac = parseFloat(payrollBac[0].t) + parseFloat(conBac[0].t) + parseFloat(expBac[0].t);

    // EVM
    const progress  = parseFloat(proj.progress_pct || 0);
    const ac        = parseFloat(trackRows[0]?.total_ejecutado || 0);
    const ev        = bac * progress / 100;
    const totalDays = Math.max(1, parseFloat(proj.total_days || 1));
    const elapsed   = Math.max(0, parseFloat(proj.elapsed_days || 0));
    const timePct   = Math.min(100, elapsed / totalDays * 100);
    const pv        = bac * timePct / 100;
    const cpi       = ac > 0 && ev >= 0 ? Math.round(ev / ac * 100) / 100 : null;
    const spi       = pv > 0 ? Math.round(ev / pv * 100) / 100 : null;
    const eac       = cpi && cpi > 0 ? Math.round(bac / cpi) : bac;
    const etc       = Math.max(0, eac - ac);
    const vac       = bac - eac;
    const tcpi      = bac > ev && eac > ac ? Math.round((bac - ev) / (eac - ac) * 100) / 100 : null;

    // Semaphores
    const ob = obRows[0], risk = riskRows[0], pol = polRows[0], team = teamRows[0],
          corr = corrRows[0], del = delivRows[0], ms = msRows[0];

    const semaphores = {
      alcance:         parseInt(ob.vencidas)          > 0 ? 'rojo' : parseInt(ob.due_week) > 0 ? 'amarillo' : 'verde',
      tiempo:          !spi ? 'verde' : spi < 0.80   ? 'rojo' : spi < 0.95 ? 'amarillo' : 'verde',
      costo:           !cpi ? 'verde' : cpi < 0.80   ? 'rojo' : cpi < 0.95 ? 'amarillo' : 'verde',
      calidad:         parseInt(ms.vencidos)          > 0 ? 'rojo' : parseInt(del.rechazados) > 0 ? 'amarillo' : 'verde',
      riesgos:         parseInt(risk.criticos)        > 0 ? 'rojo' : parseInt(risk.altos)     > 0 ? 'amarillo' : 'verde',
      equipo:          parseInt(team.no_conformes)    > 1 ? 'rojo' : parseInt(team.no_conformes) > 0 ? 'amarillo' : 'verde',
      polizas:         parseInt(pol.vencidas)         > 0 ? 'rojo' : parseInt(pol.alert_15)   > 0 ? 'amarillo' : 'verde',
      correspondencia: parseInt(corr.vencidas_respuesta) > 0 ? 'rojo' : parseInt(corr.sin_respuesta) > 0 ? 'amarillo' : 'verde',
    };

    // Alerts
    const alerts = [];
    if (parseInt(ob.vencidas)              > 0) alerts.push({ level: 'rojo',     msg: `${ob.vencidas} obligaciones vencidas`,             tab: null, page: `adjudicacion/${pid}?tab=obligations` });
    if (parseInt(pol.vencidas)             > 0) alerts.push({ level: 'rojo',     msg: `${pol.vencidas} pólizas vencidas`,                  tab: null, page: `adjudicacion/${pid}?tab=policies` });
    if (parseInt(risk.criticos)            > 0) alerts.push({ level: 'rojo',     msg: `${risk.criticos} riesgos críticos activos`,          tab: 'risks', page: null });
    if (parseInt(ms.vencidos)             > 0) alerts.push({ level: 'rojo',     msg: `${ms.vencidos} hitos vencidos sin cumplir`,          tab: null, page: `adjudicacion/${pid}?tab=milestones` });
    if (parseInt(pol.alert_15)            > 0) alerts.push({ level: 'amarillo', msg: `${pol.alert_15} póliza(s) vencen en ≤15 días`,       tab: null, page: `adjudicacion/${pid}?tab=policies` });
    if (parseInt(ob.due_week)             > 0) alerts.push({ level: 'amarillo', msg: `${ob.due_week} obligaciones vencen esta semana`,     tab: null, page: `adjudicacion/${pid}?tab=obligations` });
    if (parseInt(corr.vencidas_respuesta) > 0) alerts.push({ level: 'amarillo', msg: `${corr.vencidas_respuesta} corresp. sin respuesta >7 días`, tab: 'correspondence', page: null });

    // Timeline merge
    const timeline = [
      ...tlObsRows.map(r  => ({ ...r, type: 'obligation' })),
      ...tlMsRows.map(r   => ({ ...r, type: 'milestone' })),
      ...tlPayRows.map(r  => ({ ...r, type: 'payment' })),
      ...tlMinRows.map(r  => ({ ...r, type: 'minute' })),
      ...tlChgRows.map(r  => ({ ...r, type: 'change' })),
    ].filter(r => r.date).sort((a, b) => new Date(b.date) - new Date(a.date));

    res.json({
      data: {
        project: {
          ...proj,
          contract_value: parseFloat(proj.contract_value || 0),
          progress_pct:   parseFloat(proj.progress_pct || 0),
        },
        evm: { bac, ac, ev, pv, cpi, spi, eac, etc, vac, tcpi, progress, timePct },
        semaphores,
        alerts,
        modules: {
          payments:        { ...paySumRows[0] },
          schedule:        { ...schedRows[0] },
          risks:           { ...riskRows[0] },
          obligations:     { ...obRows[0] },
          policies:        { ...polRows[0] },
          team:            { ...teamRows[0] },
          correspondence:  { ...corrRows[0] },
          milestones:      { ...msRows[0], next_name: nextMsRows[0]?.name || null },
          deliverables:    { ...delivRows[0] },
          changes:         { ...changeRows[0] },
          budget:          { ...trackRows[0] },
        },
        progress_records: progressRows,
        timeline,
        recent_activity:  recentRows,
      }
    });
  } catch (err) {
    console.error('[indicators] panel error:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
