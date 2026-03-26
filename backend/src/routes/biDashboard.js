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

        // ─ LÍNEA BASE: INGRESOS ─
        // Fuente primaria: schedule de ingresos planificados (budget_income_schedule)
        const [lbIncRow] = await pool.execute(
          'SELECT COALESCE(SUM(valor_con_iva),0) as t FROM budget_income_schedule WHERE project_id=?', [p.id]
        );
        const lb_income_sched = parseFloat(lbIncRow[0].t);
        // Fallback: contract_value si el schedule no está configurado
        const lb_income = lb_income_sched > 0 ? lb_income_sched : (parseFloat(p.contract_value) || 0);

        // ─ LÍNEA BASE: COSTOS ─
        const [pp] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_payroll    WHERE project_id=?', [p.id]);
        const [pc] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_contractors WHERE project_id=?', [p.id]);
        const [pe] = await pool.execute('SELECT COALESCE(SUM(valor_total),0)  as t FROM budget_expenses    WHERE project_id=?', [p.id]);
        const lb_costs = parseFloat(pp[0].t) + parseFloat(pc[0].t) + parseFloat(pe[0].t);

        // ─ SEGUIMIENTO: INGRESOS REALES ─
        // Facturado/pagado del schedule de ingresos
        const [seg_inc_q] = await pool.execute(
          "SELECT COALESCE(SUM(valor_con_iva),0) as v FROM budget_income_schedule WHERE project_id=? AND estado IN ('pagado','facturado')",
          [p.id]
        );
        const seg_income_actual = parseFloat(seg_inc_q[0].v);
        // Fallback: proporcional al avance si nada facturado aún
        const seg_income = seg_income_actual > 0 ? seg_income_actual : (progress > 0 ? lb_income * progress / 100 : 0);

        // ─ SEGUIMIENTO: COSTOS REALES ─
        // Fuente primaria: budget_tracking.valor_ejecutado (ejecución real registrada)
        const [btRow] = await pool.execute(
          'SELECT COALESCE(SUM(valor_ejecutado),0) as t FROM budget_tracking WHERE project_id=?', [p.id]
        );
        const seg_costs_real = parseFloat(btRow[0].t);
        // Fallback: Earned Value si no hay tracking real (lb_costs × avance%)
        const seg_costs = seg_costs_real > 0 ? seg_costs_real : (progress > 0 ? lb_costs * progress / 100 : 0);

        // ─ SPI (Índice de Desempeño de Cronograma) ─
        // Preferir progress_records si tienen datos de avance planificado
        const [prRow] = await pool.execute(
          'SELECT physical_planned, physical_actual FROM progress_records WHERE project_id=? AND physical_planned > 0 ORDER BY period_date DESC LIMIT 1',
          [p.id]
        );
        let spi = null;
        if (prRow.length > 0 && parseFloat(prRow[0].physical_planned) > 0) {
          // Fuente real: registros de avance
          spi = Math.round(parseFloat(prRow[0].physical_actual) / parseFloat(prRow[0].physical_planned) * 100) / 100;
        } else {
          // Fallback: avance físico real ÷ avance esperado por tiempo transcurrido
          const progress_expected = p.total_days_est > 0
            ? Math.min(100, (parseFloat(p.elapsed_days) || 0) / parseFloat(p.total_days_est) * 100)
            : 0;
          spi = progress_expected > 0
            ? Math.round((progress / progress_expected) * 100) / 100
            : null;
        }

        // ─ CPI (Índice de Desempeño de Costos) ─
        // EV (Valor Ganado) = Costo planificado × % avance real
        // AC (Costo Real)   = budget_tracking.valor_ejecutado (o estimado proporcional)
        const ev = lb_costs * progress / 100;
        let cpi = null;
        if (seg_costs_real > 0 && ev > 0) {
          // Fuente real: ejecución de budget_tracking
          cpi = Math.round(ev / seg_costs_real * 100) / 100;
        } else if (elapsed > 0 && months > 0 && lb_costs > 0 && progress > 0) {
          // Fallback estimado: EV ÷ (lb_costs × tiempo_transcurrido)
          const ac_est = lb_costs * Math.min(1, elapsed / months);
          cpi = ac_est > 0 ? Math.round(ev / ac_est * 100) / 100 : null;
        }

        // ─ Actividades atrasadas ─
        const projSched     = schedGlobal.find(s => s.project_id === p.id);
        const atrasadas     = parseInt(projSched?.atrasadas || 0);
        const totalActs     = parseInt(projSched?.total || 0);
        const pct_atrasadas = totalActs > 0 ? Math.round(atrasadas / totalActs * 1000) / 10 : 0;

        // ─ Recaudo vs contrato ─
        // Fuente: payments.net_value WHERE status='pagado' (pagos reales recibidos)
        const [recRow] = await pool.execute(
          "SELECT COALESCE(SUM(net_value),0) as t FROM payments WHERE project_id=? AND status='pagado'", [p.id]
        );
        const pagos_recibidos = parseFloat(recRow[0].t);
        const contract_value  = parseFloat(p.contract_value) || 0;
        const recaudo_pct = contract_value > 0
          ? Math.round(pagos_recibidos / contract_value * 1000) / 10
          : null;

        // ─ Semáforo RAG — estándar PMO: basado en SPI y CPI ─
        // Verde:    SPI >= 0.95 Y CPI >= 0.95
        // Amarillo: SPI o CPI entre 0.80 y 0.95
        // Rojo:     SPI < 0.80 O CPI < 0.80 O suspendido
        let rag = 'verde';
        const spiBad  = spi !== null && spi  < 0.80;
        const cpiBad  = cpi !== null && cpi  < 0.80;
        const spiWarn = spi !== null && spi  < 0.95;
        const cpiWarn = cpi !== null && cpi  < 0.95;
        if (p.status === 'suspendido' || spiBad || cpiBad) {
          rag = 'rojo';
        } else if (spiWarn || cpiWarn) {
          rag = 'amarillo';
        }

        pmoByProject.push({
          project_id: p.id, project_name: p.name, project_code: p.code,
          progress, spi, cpi, pct_atrasadas, recaudo_pct,
          pagos_recibidos, contract_value,
          _months: months,   // duración propia — necesaria para TIR consolidada
          _elapsed: elapsed, // tiempo transcurrido — para TIR SEG consolidada
          rag,
          lb:  lb_costs  > 0 ? pmoIndicators(lb_income,  lb_costs,  months)  : null,
          seg: seg_costs > 0 ? pmoIndicators(seg_income, seg_costs, elapsed) : null,
        });
      } catch { /* skip */ }
    }

    // ── AGGREGATE PMO ──────────────────────────────────────────────────────────
    const validLb  = pmoByProject.filter(r => r.lb);
    const validSeg = pmoByProject.filter(r => r.seg);
    const agg_lb_income  = validLb.reduce((s, r)  => s + r.lb.income,  0);
    const agg_lb_costs   = validLb.reduce((s, r)  => s + r.lb.costs,   0);
    const agg_seg_income = validSeg.reduce((s, r) => s + r.seg.income, 0);
    const agg_seg_costs  = validSeg.reduce((s, r) => s + r.seg.costs,  0);

    // ─ Rentabilidad portafolio: (ΣIngresos - ΣCostos) / ΣIngresos — recalcular sobre totales
    // ─ VPN portafolio: suma de VPNs individuales (VPN es aditivo para proyectos independientes)
    // ─ TIR portafolio: flujos mensuales CONSOLIDADOS → Newton-Raphson (único método correcto)
    function aggIndicators(validArr, agg_income, agg_costs, getIncome, getCosts, getMonths) {
      if (agg_costs === 0) return null;

      // Rentabilidad = margen neto sobre ingresos totales
      const rentabilidad = agg_income > 0
        ? Math.round((agg_income - agg_costs) / agg_income * 100 * 10) / 10
        : null;

      // VPN portafolio = Σ VPN_individual
      // Usa getIncome/getCosts/getMonths para tomar LB o SEG según el escenario correcto
      const vpn = validArr.reduce((s, r) => {
        return s + computeVPN(getIncome(r), getCosts(r), getMonths(r));
      }, 0);

      // TIR portafolio = TIR de flujos consolidados mes a mes
      // Modelo: t=0 → -ΣCostos; t=1..n_max → suma de (income_i/n_i) de proyectos activos en t
      const portfolioProjects = validArr
        .map(r => ({
          income: getCosts(r) > 0 ? getIncome(r) : 0,
          costs:  getCosts(r),
          n:      Math.max(2, Math.round(getMonths(r))),
        }))
        .filter(p => p.costs > 0 && p.income > 0);

      const tir = computeConsolidatedTIR(portfolioProjects);

      return { income: agg_income, costs: agg_costs, rentabilidad, margen: rentabilidad, tir, vpn };
    }

    // LB: income = r.lb.income, costs = r.lb.costs, months = r._months
    const agg_lb_ind = aggIndicators(
      validLb, agg_lb_income, agg_lb_costs,
      r => r.lb.income, r => r.lb.costs, r => r._months
    );
    // SEG: income = r.seg.income, costs = r.seg.costs, elapsed = r._elapsed
    const agg_seg_ind = aggIndicators(
      validSeg, agg_seg_income, agg_seg_costs,
      r => r.seg.income, r => r.seg.costs, r => r._elapsed
    );

    // ─ Agregados operativos ─
    const validSpi = pmoByProject.filter(r => r.spi !== null);
    const avg_spi  = validSpi.length > 0
      ? Math.round(validSpi.reduce((s, r) => s + r.spi, 0) / validSpi.length * 100) / 100 : null;

    const validCpi = pmoByProject.filter(r => r.cpi !== null);
    const avg_cpi  = validCpi.length > 0
      ? Math.round(validCpi.reduce((s, r) => s + r.cpi, 0) / validCpi.length * 100) / 100 : null;

    const avg_pct_atrasadas = pmoByProject.length > 0
      ? Math.round(pmoByProject.reduce((s, r) => s + (r.pct_atrasadas || 0), 0) / pmoByProject.length * 10) / 10 : 0;

    // ─ Recaudo total: usar pagos_recibidos directos (sin reconstruir desde recaudo_pct redondeado) ─
    const total_pagos    = pmoByProject.reduce((s, r) => s + (r.pagos_recibidos || 0), 0);
    const total_contrato = pmoByProject.reduce((s, r) => s + (r.contract_value  || 0), 0);
    const total_recaudo_pct = total_contrato > 0
      ? Math.round(total_pagos / total_contrato * 1000) / 10 : null;

    const rag_verde    = pmoByProject.filter(r => r.rag === 'verde').length;
    const rag_amarillo = pmoByProject.filter(r => r.rag === 'amarillo').length;
    const rag_rojo     = pmoByProject.filter(r => r.rag === 'rojo').length;

    const pmo = {
      aggregate: {
        lb:  agg_lb_ind,
        seg: agg_seg_ind,
        spi: avg_spi,
        cpi: avg_cpi,
        pct_atrasadas: avg_pct_atrasadas,
        recaudo_pct: total_recaudo_pct,
        rag: { verde: rag_verde, amarillo: rag_amarillo, rojo: rag_rojo, total: pmoByProject.length },
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

/**
 * TIR del PORTAFOLIO calculada sobre flujos mensuales CONSOLIDADOS.
 *
 * Método: cada proyecto aporta su inversión en t=0 y sus ingresos distribuidos
 * uniformemente en t=1..n_i. Los flujos de todos los proyectos se SUMAN por período,
 * generando un único vector consolidado sobre el que se resuelve TIR(VAN=0).
 *
 * Esto es matemáticamente correcto (≠ suma/promedio de TIRs individuales).
 *
 * @param {Array<{income, costs, n}>} projects — array de proyectos con n=duración en meses
 * @returns {number|null} TIR anualizada en %
 */
function computeConsolidatedTIR(projects) {
  if (!projects || projects.length === 0) return null;
  const valid = projects.filter(p => p.costs > 0 && p.income > 0 && p.n >= 2);
  if (valid.length === 0) return null;

  // Horizonte = duración máxima entre proyectos
  const nMax = Math.max(...valid.map(p => p.n));

  // Construir flujos consolidados
  const flows = new Array(nMax + 1).fill(0);
  flows[0] = -valid.reduce((s, p) => s + p.costs, 0); // inversión total en t=0

  for (const p of valid) {
    const monthly = p.income / p.n;
    for (let t = 1; t <= p.n; t++) {
      flows[t] += monthly; // cada proyecto aporta su cuota mensual
    }
  }

  // Verificar cambio de signo (condición necesaria para TIR real única)
  const hasPositive = flows.slice(1).some(f => f > 0);
  if (!hasPositive) return null;

  // Newton-Raphson sobre el vector consolidado
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

/** Compute all PMO indicators. numMonths = horizon used for TIR/VPN. */
function pmoIndicators(income, costs, numMonths) {
  if (!income && !costs) return { income: 0, costs: 0, rentabilidad: null, margen: null, tir: null, vpn: null };
  // Rentabilidad = Margen Neto = (Ingresos - Costos) / Ingresos × 100
  const rentabilidad = income > 0 ? Math.round((income - costs) / income * 100 * 10) / 10 : null;
  const margen       = income > 0 ? Math.round((income - costs) / income * 100 * 10) / 10 : null;
  const tir = computeTIR(income, costs, numMonths);
  const vpn = computeVPN(income, costs, numMonths);
  return { income, costs, rentabilidad, margen, tir, vpn };
}

module.exports = router;
