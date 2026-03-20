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

module.exports = router;
