const express = require('express');
const pool = require('../config/database');
const { authMiddleware, getVisibleProjectIds } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ═══════════════════════════════════════════════════════════════
// GET /api/dashboard/bi — Full BI analytics
// ═══════════════════════════════════════════════════════════════
router.get('/bi', async (req, res) => {
  try {
    // Role-based project filtering
    const visibleIds = await getVisibleProjectIds(req.user.id, req.user.role);
    let projectFilter = '';
    let filterParams = [];
    if (visibleIds !== null) {
      if (visibleIds.length === 0) return res.json({ projects: [], summary: {}, charts: {} });
      projectFilter = `WHERE p.id IN (${visibleIds.map(() => '?').join(',')})`;
      filterParams = [...visibleIds];
    }

    // ── PROJECTS OVERVIEW ──
    const [projects] = await pool.execute(`
      SELECT p.id, p.name, p.code, p.project_type, p.status, p.priority,
        p.client_name, p.sector, p.contract_value, p.start_date, p.execution_term, p.execution_term_unit,
        p.progress_pct, p.created_at,
        DATEDIFF(CURDATE(), p.start_date) as elapsed_days,
        CASE 
          WHEN p.execution_term_unit IN ('dias_calendario','dias_habiles') THEN DATEDIFF(DATE_ADD(p.start_date, INTERVAL p.execution_term DAY), CURDATE())
          WHEN p.execution_term_unit = 'meses' THEN DATEDIFF(DATE_ADD(p.start_date, INTERVAL p.execution_term MONTH), CURDATE())
          WHEN p.execution_term_unit = 'anos' THEN DATEDIFF(DATE_ADD(p.start_date, INTERVAL p.execution_term YEAR), CURDATE())
          ELSE DATEDIFF(DATE_ADD(p.start_date, INTERVAL p.execution_term DAY), CURDATE())
        END as days_remaining,
        CASE 
          WHEN p.execution_term_unit IN ('dias_calendario','dias_habiles') THEN p.execution_term
          WHEN p.execution_term_unit = 'meses' THEN p.execution_term * 30
          WHEN p.execution_term_unit = 'anos' THEN p.execution_term * 365
          ELSE p.execution_term
        END as total_days_est
      FROM projects p ${projectFilter} ORDER BY p.created_at DESC`, filterParams);

    // ── OBLIGATIONS GLOBAL ──
    const [obGlobal] = await pool.execute(`
      SELECT o.project_id, p.name as project_name, p.code as project_code,
        COUNT(*) as total,
        SUM(o.status='pendiente') as pendientes, SUM(o.status='en_curso') as en_curso,
        SUM(o.status='cumplida') as cumplidas, SUM(o.status='vencida') as vencidas
      FROM obligations o JOIN projects p ON o.project_id=p.id
      GROUP BY o.project_id, p.name, p.code`);

    // Top overdue obligations
    const [overdueObs] = await pool.execute(`
      SELECT o.code, o.description, o.due_date, o.risk_level, o.project_id,
        p.name as project_name, p.code as project_code,
        DATEDIFF(CURDATE(), o.due_date) as days_overdue
      FROM obligations o JOIN projects p ON o.project_id=p.id
      WHERE o.status='vencida' ORDER BY days_overdue DESC LIMIT 20`);

    // ── RISKS GLOBAL ──
    const [riskGlobal] = await pool.execute(`
      SELECT r.project_id, p.name as project_name, p.code as project_code,
        COUNT(*) as total,
        SUM(r.risk_score >= 15) as criticos, SUM(r.risk_score >= 8 AND r.risk_score < 15) as altos,
        SUM(r.status='materializado') as materializados
      FROM risks r JOIN projects p ON r.project_id=p.id
      WHERE r.status NOT IN ('cerrado')
      GROUP BY r.project_id, p.name, p.code`);

    const [topRisks] = await pool.execute(`
      SELECT r.risk_code, r.description, r.category, r.risk_score, r.risk_level, r.status,
        r.project_id, p.name as project_name, p.code as project_code
      FROM risks r JOIN projects p ON r.project_id=p.id
      WHERE r.status NOT IN ('cerrado')
      ORDER BY r.risk_score DESC LIMIT 15`);

    // Risk by category across all projects
    const [riskByCategory] = await pool.execute(`
      SELECT category, COUNT(*) as total, 
        SUM(risk_score >= 15) as criticos, AVG(risk_score) as avg_score
      FROM risks WHERE status NOT IN ('cerrado') GROUP BY category`);

    // ── FINANCIAL GLOBAL ──
    const financialByProject = [];
    for (const p of projects) {
      try {
        // Income — source of truth: budget_income_schedule (pagos reales)
        const [inc] = await pool.execute('SELECT COALESCE(SUM(valor_con_iva),0) as income FROM budget_income_schedule WHERE project_id=?', [p.id]);
        const [pay] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_payroll WHERE project_id=?', [p.id]);
        const [con] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_contractors WHERE project_id=?', [p.id]);
        const [exp] = await pool.execute('SELECT COALESCE(SUM(valor_total),0) as t FROM budget_expenses WHERE project_id=?', [p.id]);
        const income = parseFloat(inc[0].income);
        const expenses = parseFloat(pay[0].t) + parseFloat(con[0].t) + parseFloat(exp[0].t);
        financialByProject.push({
          project_id: p.id, project_name: p.name, project_code: p.code,
          contract_value: parseFloat(p.contract_value || 0),
          income, expenses, margin: income - expenses,
          margin_pct: income > 0 ? ((income - expenses) / income * 100) : 0,
        });
      } catch {}
    }

    // ── SCHEDULE GLOBAL ──
    const [schedGlobal] = await pool.execute(`
      SELECT sa.project_id, p.name as project_name, p.code as project_code,
        COUNT(*) as total,
        SUM(sa.status='completada') as completadas,
        SUM(sa.status='atrasada' OR (sa.end_date < CURDATE() AND sa.progress_pct < 100 AND sa.activity_type='task')) as atrasadas,
        AVG(CASE WHEN sa.activity_type='task' THEN sa.progress_pct END) as avg_progress
      FROM schedule_activities sa JOIN projects p ON sa.project_id=p.id
      WHERE sa.activity_type='task'
      GROUP BY sa.project_id, p.name, p.code`);

    // ── TEAM GLOBAL ──
    const [teamGlobal] = await pool.execute(`
      SELECT tm.project_id, p.name as project_name, p.code as project_code,
        COUNT(*) as total, SUM(tm.status='activo') as activos,
        SUM(tm.profile_compliant=1) as cumplen, SUM(tm.profile_compliant=0) as no_cumplen,
        AVG(tm.dedication_pct) as avg_dedication
      FROM team_members tm JOIN projects p ON tm.project_id=p.id
      GROUP BY tm.project_id, p.name, p.code`);

    // ── POLICIES GLOBAL ──
    const [policyGlobal] = await pool.execute(`
      SELECT pol.project_id, p.name as project_name, p.code as project_code,
        COUNT(*) as total, SUM(pol.status='vigente') as vigentes,
        SUM(pol.status='por_vencer') as por_vencer, SUM(pol.status='vencida') as vencidas
      FROM policies pol JOIN projects p ON pol.project_id=p.id
      GROUP BY pol.project_id, p.name, p.code`);

    const [expiringPolicies] = await pool.execute(`
      SELECT pol.policy_type, pol.insurer, pol.expiry_date, pol.insured_value, pol.status,
        pol.project_id, p.name as project_name, p.code as project_code,
        DATEDIFF(pol.expiry_date, CURDATE()) as days_to_expire
      FROM policies pol JOIN projects p ON pol.project_id=p.id
      WHERE pol.status IN ('vigente','por_vencer') AND pol.expiry_date IS NOT NULL
      ORDER BY pol.expiry_date ASC LIMIT 15`);

    // ── PAYMENTS GLOBAL ──
    const [paymentStats] = await pool.execute(`
      SELECT pay.project_id, p.name as project_name, p.code as project_code,
        COUNT(*) as total,
        SUM(pay.status='pagado') as pagados,
        COALESCE(SUM(CASE WHEN pay.status='pagado' THEN pay.net_value ELSE 0 END),0) as total_paid,
        COALESCE(SUM(pay.gross_value),0) as total_invoiced
      FROM payments pay JOIN projects p ON pay.project_id=p.id
      GROUP BY pay.project_id, p.name, p.code`);

    // ── TIMELINE: recent activity across all projects ──
    let timeline = [];
    try {
      const [recentObs] = await pool.execute(`
        SELECT 'obligation' as type, o.description as detail, o.status, o.updated_at as date,
          o.project_id, p.code as project_code
        FROM obligations o JOIN projects p ON o.project_id=p.id
        WHERE o.updated_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        ORDER BY o.updated_at DESC LIMIT 10`);
      const [recentRisks] = await pool.execute(`
        SELECT 'risk' as type, r.description as detail, r.status, r.updated_at as date,
          r.project_id, p.code as project_code
        FROM risks r JOIN projects p ON r.project_id=p.id
        WHERE r.updated_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        ORDER BY r.updated_at DESC LIMIT 10`);
      const [recentPays] = await pool.execute(`
        SELECT 'payment' as type, pay.concept as detail, pay.status, pay.updated_at as date,
          pay.project_id, p.code as project_code
        FROM payments pay JOIN projects p ON pay.project_id=p.id
        WHERE pay.updated_at >= DATE_SUB(CURDATE(), INTERVAL 30 DAY)
        ORDER BY pay.updated_at DESC LIMIT 10`);
      timeline = [...recentObs, ...recentRisks, ...recentPays]
        .sort((a, b) => new Date(b.date) - new Date(a.date))
        .slice(0, 20);
    } catch {}

    // ── PMO INDICATORS ──
    const pmoByProject = [];
    for (const p of projects) {
      try {
        const months   = projectMonths(p);
        const progress = Math.max(0, Math.min(100, parseFloat(p.progress_pct) || 0));
        const elapsed  = Math.max(1, (parseFloat(p.elapsed_days) || 30) / 30); // months elapsed

        // ─ LÍNEA BASE ─
        const lb_income = parseFloat(p.contract_value) || 0;
        const [pp] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_payroll    WHERE project_id=?', [p.id]);
        const [pc] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_contractors WHERE project_id=?', [p.id]);
        const [pe] = await pool.execute('SELECT COALESCE(SUM(valor_total),0)  as t FROM budget_expenses    WHERE project_id=?', [p.id]);
        const lb_costs = parseFloat(pp[0].t) + parseFloat(pc[0].t) + parseFloat(pe[0].t);

        // Real income payment schedule (grouped by month)
        const [incSched] = await pool.execute(
          'SELECT mes, SUM(valor_con_iva) as valor FROM budget_income_schedule WHERE project_id=? GROUP BY mes ORDER BY mes',
          [p.id]
        );
        const lb_sched = incSched.map(r => ({ mes: parseInt(r.mes), valor: parseFloat(r.valor) }));

        // ─ SEGUIMIENTO (Earned Value approach) ─
        // Income: what's been actually invoiced/collected
        const [seg_inc_q] = await pool.execute(
          "SELECT COALESCE(SUM(valor_con_iva),0) as v FROM budget_income_schedule WHERE project_id=? AND estado IN ('pagado','facturado')",
          [p.id]
        );
        const seg_income_actual = parseFloat(seg_inc_q[0].v);
        // Fallback: proportional to progress if nothing invoiced yet
        const seg_income = seg_income_actual > 0 ? seg_income_actual : (progress > 0 ? lb_income * progress / 100 : 0);

        // Costs (Earned Value): budget × % de avance físico
        const seg_costs = progress > 0 ? lb_costs * progress / 100 : 0;

        // Proportional income schedule for SEG
        const seg_scale = lb_income > 0 ? seg_income / lb_income : 0;
        const seg_sched = lb_sched.map(r => ({ mes: r.mes, valor: r.valor * seg_scale }));

        pmoByProject.push({
          project_id: p.id, project_name: p.name, project_code: p.code,
          progress,
          lb:  lb_costs  > 0 ? pmoIndicators(lb_income,  lb_costs,  lb_sched,  months)  : null,
          seg: seg_costs > 0 ? pmoIndicators(seg_income, seg_costs, seg_sched, elapsed) : null,
        });
      } catch { /* skip */ }
    }

    // Aggregate PMO
    const validLb  = pmoByProject.filter(r => r.lb);
    const validSeg = pmoByProject.filter(r => r.seg);
    const agg_lb_income  = validLb.reduce((s, r)  => s + r.lb.income,  0);
    const agg_lb_costs   = validLb.reduce((s, r)  => s + r.lb.costs,   0);
    const agg_seg_income = validSeg.reduce((s, r) => s + r.seg.income, 0);
    const agg_seg_costs  = validSeg.reduce((s, r) => s + r.seg.costs,  0);
    const avg_months     = projects.length > 0
      ? projects.reduce((s, p) => s + projectMonths(p), 0) / projects.length : 12;
    const avg_elapsed    = projects.length > 0
      ? projects.reduce((s, p) => s + Math.max(1, (parseFloat(p.elapsed_days) || 30) / 30), 0) / projects.length : 6;
    const pmo = {
      aggregate: {
        lb:  agg_lb_costs  > 0 ? pmoIndicators(agg_lb_income,  agg_lb_costs,  [], avg_months)  : null,
        seg: agg_seg_costs > 0 ? pmoIndicators(agg_seg_income, agg_seg_costs, [], avg_elapsed) : null,
      },
      by_project: pmoByProject,
    };

    // ── AGGREGATE STATS ──
    const totalValue = projects.reduce((s, p) => s + parseFloat(p.contract_value || 0), 0);
    const totalObligations = obGlobal.reduce((s, r) => s + parseInt(r.total), 0);
    const totalOverdue = obGlobal.reduce((s, r) => s + parseInt(r.vencidas || 0), 0);
    const totalRisks = riskGlobal.reduce((s, r) => s + parseInt(r.total), 0);
    const totalCritical = riskGlobal.reduce((s, r) => s + parseInt(r.criticos || 0), 0);

    res.json({
      data: {
        summary: {
          total_projects: projects.length,
          by_status: groupCount(projects, 'status'),
          by_type: groupCount(projects, 'project_type'),
          by_priority: groupCount(projects, 'priority'),
          by_sector: groupCount(projects, 'sector'),
          total_value: totalValue,
          total_obligations: totalObligations,
          total_overdue: totalOverdue,
          total_risks: totalRisks,
          total_critical_risks: totalCritical,
          avg_progress: projects.length > 0 ? projects.reduce((s, p) => s + parseFloat(p.progress_pct || 0), 0) / projects.length : 0,
        },
        projects: projects.map(p => ({
          ...p, contract_value: parseFloat(p.contract_value || 0),
          progress_pct: parseFloat(p.progress_pct || 0),
        })),
        obligations: { by_project: obGlobal, overdue: overdueObs },
        risks: { by_project: riskGlobal, top: topRisks, by_category: riskByCategory },
        financial: financialByProject,
        schedule: schedGlobal.map(s => ({ ...s, avg_progress: parseFloat(s.avg_progress || 0) })),
        team: teamGlobal,
        policies: { by_project: policyGlobal, expiring: expiringPolicies },
        payments: paymentStats,
        pmo,
        timeline,
        generated_at: new Date().toISOString(),
      }
    });
  } catch (err) {
    console.error('BI Dashboard error:', err);
    res.status(500).json({ error: err.message });
  }
});

function groupCount(arr, field) {
  const map = {};
  arr.forEach(item => {
    const key = item[field] || 'sin_definir';
    map[key] = (map[key] || 0) + 1;
  });
  return Object.entries(map).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
}

// ── PMO Financial helpers ──────────────────────────────────────────────────

/** Project duration in months */
function projectMonths(p) {
  const term = parseFloat(p.execution_term) || 12;
  if (p.execution_term_unit === 'anos')  return term * 12;
  if (p.execution_term_unit === 'meses') return term;
  return Math.max(1, term / 30);
}

/**
 * Newton-Raphson monthly IRR — returns annualised % or null.
 *
 * Modelo: inversión total en período 0 (negativo), ingresos mensuales iguales
 * en períodos 1..n (positivos si income > 0). Exactamente UN cambio de signo
 * → convergencia única garantizada.
 *
 * Para proyectos rentables (income > costs): TIR > 0
 * Para proyectos en pérdida  (income < costs): TIR < 0  (negativo válido)
 */
function computeTIR(income, costs, numMonths) {
  const n = Math.max(2, Math.round(numMonths));
  if (!costs || costs <= 0 || income <= 0) return null;

  const monthlyInc = income / n;
  // flows[0] = -costs (outflow), flows[1..n] = monthlyInc (inflow)
  const flows = [-costs, ...Array(n).fill(monthlyInc)];

  // Hay cambio de signo si income > 0 (siempre con este modelo)
  let r = 0.01;
  for (let i = 0; i < 500; i++) {
    let npv = 0, d = 0;
    for (let t = 0; t < flows.length; t++) {
      const denom = Math.pow(1 + r, t);
      npv += flows[t] / denom;
      if (t > 0) d -= t * flows[t] / (denom * (1 + r));
    }
    if (Math.abs(d) < 1e-14) break;
    const delta = npv / d;
    r -= delta;
    if (r <= -0.999) r = -0.998;
    if (Math.abs(delta) < 1e-9) break;
  }
  if (!isFinite(r) || r <= -1) return null;
  const annual = (Math.pow(1 + r, 12) - 1) * 100;
  return (annual > -9999 && annual < 99999) ? Math.round(annual * 10) / 10 : null;
}

/**
 * VPN al 10 % anual (tasa mensual equivalente).
 * Mismo modelo de flujos que computeTIR.
 */
function computeVPN(income, costs, numMonths) {
  const n  = Math.max(2, Math.round(numMonths));
  if (!costs || costs <= 0) return 0;
  const mr = Math.pow(1.10, 1 / 12) - 1; // ≈ 0.797 % mensual
  const monthlyInc = income / n;
  const flows = [-costs, ...Array(n).fill(monthlyInc)];
  return Math.round(flows.reduce((s, cf, t) => s + cf / Math.pow(1 + mr, t), 0));
}

/** Compute all PMO indicators. numMonths = horizon used for TIR/VPN. */
function pmoIndicators(income, costs, numMonths) {
  if (!income && !costs) return { income: 0, costs: 0, rentabilidad: null, margen: null, tir: null, vpn: null };
  const rentabilidad = costs > 0 ? Math.round((income - costs) / costs * 100 * 10) / 10 : null;
  const margen       = income > 0 ? Math.round((income - costs) / income * 100 * 10) / 10 : null;
  const tir = computeTIR(income, costs, numMonths);
  const vpn = computeVPN(income, costs, numMonths);
  return { income, costs, rentabilidad, margen, tir, vpn };
}

module.exports = router;
