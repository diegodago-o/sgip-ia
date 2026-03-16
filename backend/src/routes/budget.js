const express = require('express');
const { param, body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return false; }
  return true;
}

// ARL rates by risk level
const ARL_RATES = { I: 0.522, II: 1.044, III: 2.436, IV: 4.350, V: 6.960 };

// ── Payroll cost calculator ──
function calcPayroll(p, projectMonths) {
  const base = parseFloat(p.salario_base) || 0;
  const aux = parseFloat(p.aux_transporte) || 0;
  const qty = parseInt(p.cantidad) || 1;
  const mesInicio = parseInt(p.mes_inicio) || 1;
  const mesFin = p.mes_fin ? parseInt(p.mes_fin) : projectMonths;
  const meses = Math.max(1, mesFin - mesInicio + 1);

  const prestaciones = (
    (parseFloat(p.pct_prima) || 0) + (parseFloat(p.pct_vacaciones) || 0) +
    (parseFloat(p.pct_cesantias) || 0) + (parseFloat(p.pct_int_cesantias) || 0) +
    (parseFloat(p.pct_arl) || 0) + (parseFloat(p.pct_pension) || 0) +
    (parseFloat(p.pct_ccf) || 0) + (parseFloat(p.pct_icbf) || 0) +
    (parseFloat(p.pct_sena) || 0) + (parseFloat(p.pct_salud) || 0)
  ) / 100;

  const costoMensual = base + aux + (base * prestaciones);
  const costoTotal = costoMensual * qty * meses;
  return { costo_mensual: Math.round(costoMensual * 100) / 100, meses_vinculacion: meses, costo_total: Math.round(costoTotal * 100) / 100 };
}

// ── Contractor cost calculator ──
function calcContractor(c, projectMonths) {
  const qty = parseInt(c.cantidad) || 1;
  const mesInicio = parseInt(c.mes_inicio) || 1;
  const mesFin = c.mes_fin ? parseInt(c.mes_fin) : projectMonths;
  const meses = Math.max(1, mesFin - mesInicio + 1);

  let costoMensual = 0;
  if (c.tipo_contrato === 'mensual') {
    costoMensual = parseFloat(c.valor_mensual) || 0;
  } else if (c.tipo_contrato === 'por_horas') {
    costoMensual = (parseFloat(c.valor_hora) || 0) * (parseFloat(c.horas_mes) || 0);
  } else if (c.tipo_contrato === 'por_productos') {
    const vp = parseFloat(c.valor_producto) || 0;
    const cp = parseInt(c.cantidad_productos) || 0;
    costoMensual = (vp * cp) / Math.max(1, meses);
  }

  const arlValor = costoMensual * ((parseFloat(c.arl_pct) || 0) / 100);
  costoMensual += arlValor;
  const costoTotal = costoMensual * qty * meses;

  return {
    arl_valor_mensual: Math.round(arlValor * 100) / 100,
    costo_mensual: Math.round(costoMensual * 100) / 100,
    meses_vinculacion: meses,
    costo_total: Math.round(costoTotal * 100) / 100,
  };
}

// ── Expense calculator ──
function calcExpense(e, projectMonths) {
  const mesInicio = parseInt(e.mes_inicio) || 1;
  const mesFin = e.mes_fin ? parseInt(e.mes_fin) : projectMonths;
  const meses = Math.max(1, mesFin - mesInicio + 1);
  const qty = parseFloat(e.cantidad) || 1;
  const uv = parseFloat(e.valor_unitario) || 0;
  const valorMensual = qty * uv;
  const valorTotal = valorMensual * meses;
  return { meses, valor_mensual: Math.round(valorMensual * 100) / 100, valor_total: Math.round(valorTotal * 100) / 100 };
}

// Get project duration in months
async function getProjectMonths(projectId) {
  const [rows] = await pool.execute('SELECT execution_term, execution_term_unit FROM projects WHERE id = ?', [projectId]);
  if (rows.length === 0) return 12;
  const p = rows[0];
  if (p.execution_term_unit === 'meses') return p.execution_term || 12;
  if (p.execution_term_unit === 'anos') return (p.execution_term || 1) * 12;
  return Math.ceil((p.execution_term || 360) / 30);
}

// ═══════════════════════════════════════════
// GET /api/budget/:projectId/summary
// ═══════════════════════════════════════════
router.get('/:projectId/summary', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;
    const pm = await getProjectMonths(pid);

    const [income] = await pool.execute('SELECT COALESCE(SUM(value),0) as total FROM budget_income WHERE project_id = ?', [pid]);
    const [payroll] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as total, COUNT(*) as count FROM budget_payroll WHERE project_id = ?', [pid]);
    const [contractors] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as total, COUNT(*) as count FROM budget_contractors WHERE project_id = ?', [pid]);
    const [expenses] = await pool.execute(`
      SELECT category, COALESCE(SUM(valor_total),0) as total, COUNT(*) as count
      FROM budget_expenses WHERE project_id = ? GROUP BY category
    `, [pid]);

    const [incomeCount] = await pool.execute('SELECT COUNT(*) as c FROM budget_income WHERE project_id = ?', [pid]);
    const [expTotalRow] = await pool.execute('SELECT COALESCE(SUM(valor_total),0) as total FROM budget_expenses WHERE project_id = ?', [pid]);

    const totalIngresos = parseFloat(income[0].total);
    const totalPayroll = parseFloat(payroll[0].total);
    const totalContractors = parseFloat(contractors[0].total);
    const totalExpenses = parseFloat(expTotalRow[0].total);
    const totalEgresos = totalPayroll + totalContractors + totalExpenses;
    const margen = totalIngresos - totalEgresos;

    const initialized = incomeCount[0].c > 0 || payroll[0].count > 0 || contractors[0].count > 0;

    res.json({
      data: {
        initialized,
        project_months: pm,
        total_ingresos: totalIngresos,
        total_payroll: totalPayroll, payroll_count: payroll[0].count,
        total_contractors: totalContractors, contractors_count: contractors[0].count,
        expenses_by_category: expenses,
        total_expenses: totalExpenses,
        total_egresos: totalEgresos,
        margen,
        margen_pct: totalIngresos > 0 ? ((margen / totalIngresos) * 100) : 0,
      }
    });
  } catch (err) { console.error('Budget summary:', err); res.status(500).json({ error: 'Error obteniendo resumen' }); }
});

// ═══════════════════════════════════════════
// POST /api/budget/:projectId/init
// ═══════════════════════════════════════════
router.post('/:projectId/init', roleMiddleware('admin', 'gerente_proyecto'), [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = parseInt(req.params.projectId);
    const [proj] = await pool.execute('SELECT contract_value FROM projects WHERE id = ?', [pid]);
    if (proj.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const cv = parseFloat(proj[0].contract_value) || 0;
    const iva = cv * 0.19;

    const defaults = [
      { label: 'Valor del Contrato sin IVA', value: cv, sort: 0 },
      { label: 'IVA Generado (19%)', value: iva, sort: 1 },
      { label: 'Valor del Contrato con IVA', value: cv + iva, sort: 2 },
      { label: 'Retefuente', value: 0, sort: 3 },
      { label: 'Estampillas', value: 0, sort: 4, notes: 'Borrar si no aplica' },
      { label: 'Gravamen al manejo financiero', value: 0, sort: 5 },
    ];

    for (const d of defaults) {
      const [ex] = await pool.execute('SELECT id FROM budget_income WHERE project_id = ? AND label = ?', [pid, d.label]);
      if (ex.length === 0) {
        await pool.execute(
          'INSERT INTO budget_income (project_id, label, value, sort_order, notes) VALUES (?,?,?,?,?)',
          [pid, d.label, d.value, d.sort, d.notes || null]
        );
      }
    }

    res.json({ message: 'Ingresos inicializados' });
  } catch (err) { console.error('Init:', err); res.status(500).json({ error: 'Error inicializando' }); }
});

// ═══════════════════════════════════════════
// POST /api/budget/:projectId/sync-value
// Re-sync budget_income with current contract_value
// ═══════════════════════════════════════════
router.post('/:projectId/sync-value', roleMiddleware('admin', 'director'), [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = parseInt(req.params.projectId);
    const [proj] = await pool.execute('SELECT contract_value FROM projects WHERE id=?', [pid]);
    if (!proj.length) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const cv = parseFloat(proj[0].contract_value) || 0;
    const iva = cv * 0.19;
    const total = cv + iva;

    // Update budget_income base rows
    let updated = 0;
    const ops = [
      ["UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%Contrato sin IVA%' OR (sort_order=0 AND tipo='ingreso' AND es_iva=0 AND es_total_con_iva=0))", [cv, pid]],
      ["UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%IVA Generado%' OR es_iva=1)", [iva, pid]],
      ["UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%con IVA%' OR es_total_con_iva=1)", [total, pid]],
    ];
    for (const [sql, params] of ops) {
      try { const [r] = await pool.execute(sql, params); updated += r.affectedRows; } catch {}
    }

    // Re-distribute income_schedule proportionally if exists
    let schedUpdated = 0;
    try {
      const [sched] = await pool.execute('SELECT SUM(valor_sin_iva) as t FROM budget_income_schedule WHERE project_id=?', [pid]);
      const oldSchedTotal = parseFloat(sched[0]?.t || 0);
      if (oldSchedTotal > 0 && Math.abs(oldSchedTotal - cv) > 1) {
        const ratio = cv / oldSchedTotal;
        const [r] = await pool.execute(
          `UPDATE budget_income_schedule SET
            valor_sin_iva = ROUND(valor_sin_iva * ?, 2),
            valor_iva = ROUND(valor_iva * ?, 2),
            valor_con_iva = ROUND(valor_con_iva * ?, 2)
           WHERE project_id=?`,
          [ratio, ratio, ratio, pid]
        );
        schedUpdated = r.affectedRows;
      }
    } catch {}

    res.json({
      message: `Valor sincronizado: ${cv.toLocaleString('es-CO')}`,
      contract_value: cv, iva, total,
      income_rows_updated: updated,
      schedule_rows_updated: schedUpdated,
    });
  } catch (err) { console.error('Sync value:', err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
// INCOME CRUD
// ═══════════════════════════════════════════
router.get('/:projectId/income', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  const [rows] = await pool.execute('SELECT * FROM budget_income WHERE project_id = ? ORDER BY sort_order', [req.params.projectId]);
  res.json({ data: rows });
});

router.post('/:projectId/income', roleMiddleware('admin', 'director'), [param('projectId').isInt(), body('label').trim().notEmpty()], async (req, res) => {
  if (!validate(req, res)) return;
  const [r] = await pool.execute('INSERT INTO budget_income (project_id, label, value, notes, sort_order) VALUES (?,?,?,?,99)', [req.params.projectId, req.body.label, req.body.value || 0, req.body.notes || null]);
  const [rows] = await pool.execute('SELECT * FROM budget_income WHERE id = ?', [r.insertId]);
  res.status(201).json({ data: rows[0] });
});

router.put('/:projectId/income/:id', roleMiddleware('admin', 'director'), [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  const updates = []; const values = [];
  ['label', 'value', 'notes'].forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f]); } });
  if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
  values.push(req.params.id);
  await pool.execute(`UPDATE budget_income SET ${updates.join(',')} WHERE id = ?`, values);
  const [rows] = await pool.execute('SELECT * FROM budget_income WHERE id = ?', [req.params.id]);
  res.json({ data: rows[0] });
});

router.delete('/:projectId/income/:id', roleMiddleware('admin', 'director'), [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  await pool.execute('DELETE FROM budget_income WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
  res.json({ message: 'Eliminado' });
});

// ═══════════════════════════════════════════
// PAYROLL CRUD
// ═══════════════════════════════════════════
router.get('/:projectId/payroll', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  const [rows] = await pool.execute('SELECT * FROM budget_payroll WHERE project_id = ? ORDER BY sort_order', [req.params.projectId]);
  res.json({ data: rows });
});

router.post('/:projectId/payroll', roleMiddleware('admin', 'director'), [param('projectId').isInt(), body('cargo').trim().notEmpty(), body('salario_base').isDecimal()], async (req, res) => {
  if (!validate(req, res)) return;
  const pm = await getProjectMonths(parseInt(req.params.projectId));
  const b = req.body;
  // Validate months within project
  if (parseInt(b.mes_inicio) > pm) return res.status(400).json({ error: `Mes inicio no puede ser mayor al plazo del contrato (${pm} meses)` });
  if (b.mes_fin && parseInt(b.mes_fin) > pm) return res.status(400).json({ error: `Mes fin no puede ser mayor al plazo del contrato (${pm} meses). Si necesita más meses, gestione un control de cambios para ampliar el plazo.` });
  const calc = calcPayroll(b, pm);

  const [r] = await pool.execute(
    `INSERT INTO budget_payroll (project_id, cargo, cantidad, salario_base, aux_transporte, mes_inicio, mes_fin,
      pct_prima, pct_vacaciones, pct_cesantias, pct_int_cesantias, pct_arl, pct_pension, pct_ccf, pct_icbf, pct_sena, pct_salud,
      costo_mensual, meses_vinculacion, costo_total, notes, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,99)`,
    [req.params.projectId, b.cargo, b.cantidad || 1, b.salario_base, b.aux_transporte || 0, b.mes_inicio || 1, b.mes_fin || null,
      b.pct_prima ?? 8.333, b.pct_vacaciones ?? 4.167, b.pct_cesantias ?? 8.333, b.pct_int_cesantias ?? 1.0,
      b.pct_arl ?? 0.522, b.pct_pension ?? 12.0, b.pct_ccf ?? 4.0, b.pct_icbf ?? 3.0, b.pct_sena ?? 2.0, b.pct_salud ?? 8.5,
      calc.costo_mensual, calc.meses_vinculacion, calc.costo_total, b.notes || null]
  );
  const [rows] = await pool.execute('SELECT * FROM budget_payroll WHERE id = ?', [r.insertId]);
  res.status(201).json({ data: rows[0] });
});

router.put('/:projectId/payroll/:id', roleMiddleware('admin', 'director'), [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  const pm = await getProjectMonths(parseInt(req.params.projectId));
  // Merge existing with updates
  const [existing] = await pool.execute('SELECT * FROM budget_payroll WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
  if (existing.length === 0) return res.status(404).json({ error: 'No encontrado' });
  const merged = { ...existing[0], ...req.body };
  const calc = calcPayroll(merged, pm);

  const allowed = ['cargo','cantidad','salario_base','aux_transporte','mes_inicio','mes_fin',
    'pct_prima','pct_vacaciones','pct_cesantias','pct_int_cesantias','pct_arl','pct_pension','pct_ccf','pct_icbf','pct_sena','pct_salud','notes'];
  const updates = []; const values = [];
  allowed.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f] === '' ? null : req.body[f]); } });
  updates.push('costo_mensual=?', 'meses_vinculacion=?', 'costo_total=?');
  values.push(calc.costo_mensual, calc.meses_vinculacion, calc.costo_total, req.params.id);
  await pool.execute(`UPDATE budget_payroll SET ${updates.join(',')} WHERE id = ?`, values);
  const [rows] = await pool.execute('SELECT * FROM budget_payroll WHERE id = ?', [req.params.id]);
  res.json({ data: rows[0] });
});

router.delete('/:projectId/payroll/:id', roleMiddleware('admin', 'director'), [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  await pool.execute('DELETE FROM budget_payroll WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
  res.json({ message: 'Eliminado' });
});

// ═══════════════════════════════════════════
// CONTRACTORS CRUD
// ═══════════════════════════════════════════
router.get('/:projectId/contractors', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  const [rows] = await pool.execute('SELECT * FROM budget_contractors WHERE project_id = ? ORDER BY sort_order', [req.params.projectId]);
  res.json({ data: rows });
});

router.post('/:projectId/contractors', roleMiddleware('admin', 'director'), [param('projectId').isInt(), body('cargo').trim().notEmpty()], async (req, res) => {
  if (!validate(req, res)) return;
  const pm = await getProjectMonths(parseInt(req.params.projectId));
  const b = req.body;
  if (parseInt(b.mes_inicio) > pm) return res.status(400).json({ error: `Mes inicio no puede ser mayor al plazo del contrato (${pm} meses)` });
  if (b.mes_fin && parseInt(b.mes_fin) > pm) return res.status(400).json({ error: `Mes fin no puede ser mayor al plazo del contrato (${pm} meses). Gestione un control de cambios para ampliar el plazo.` });
  if (b.arl_nivel) b.arl_pct = ARL_RATES[b.arl_nivel] || 0.522;
  const calc = calcContractor(b, pm);

  const [r] = await pool.execute(
    `INSERT INTO budget_contractors (project_id, cargo, cantidad, tipo_contrato, valor_mensual, valor_hora, horas_mes,
      valor_producto, cantidad_productos, arl_nivel, arl_pct, arl_valor_mensual, mes_inicio, mes_fin,
      costo_mensual, meses_vinculacion, costo_total, notes, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,99)`,
    [req.params.projectId, b.cargo, b.cantidad || 1, b.tipo_contrato || 'mensual',
      b.valor_mensual || null, b.valor_hora || null, b.horas_mes || null,
      b.valor_producto || null, b.cantidad_productos || null,
      b.arl_nivel || 'I', b.arl_pct ?? 0.522, calc.arl_valor_mensual, b.mes_inicio || 1, b.mes_fin || null,
      calc.costo_mensual, calc.meses_vinculacion, calc.costo_total, b.notes || null]
  );
  const [rows] = await pool.execute('SELECT * FROM budget_contractors WHERE id = ?', [r.insertId]);
  res.status(201).json({ data: rows[0] });
});

router.put('/:projectId/contractors/:id', roleMiddleware('admin', 'director'), [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  const pm = await getProjectMonths(parseInt(req.params.projectId));
  const [existing] = await pool.execute('SELECT * FROM budget_contractors WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
  if (existing.length === 0) return res.status(404).json({ error: 'No encontrado' });
  const merged = { ...existing[0], ...req.body };
  if (merged.arl_nivel) merged.arl_pct = ARL_RATES[merged.arl_nivel] || merged.arl_pct;
  const calc = calcContractor(merged, pm);

  const allowed = ['cargo','cantidad','tipo_contrato','valor_mensual','valor_hora','horas_mes','valor_producto','cantidad_productos','arl_nivel','arl_pct','mes_inicio','mes_fin','notes'];
  const updates = []; const values = [];
  allowed.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f] === '' ? null : req.body[f]); } });
  if (req.body.arl_nivel) { updates.push('arl_pct=?'); values.push(ARL_RATES[req.body.arl_nivel] || 0.522); }
  updates.push('arl_valor_mensual=?', 'costo_mensual=?', 'meses_vinculacion=?', 'costo_total=?');
  values.push(calc.arl_valor_mensual, calc.costo_mensual, calc.meses_vinculacion, calc.costo_total, req.params.id);
  await pool.execute(`UPDATE budget_contractors SET ${updates.join(',')} WHERE id = ?`, values);
  const [rows] = await pool.execute('SELECT * FROM budget_contractors WHERE id = ?', [req.params.id]);
  res.json({ data: rows[0] });
});

router.delete('/:projectId/contractors/:id', roleMiddleware('admin', 'director'), [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  await pool.execute('DELETE FROM budget_contractors WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
  res.json({ message: 'Eliminado' });
});

// ═══════════════════════════════════════════
// EXPENSES CRUD
// ═══════════════════════════════════════════
const EXPENSE_CATS = ['arriendo_equipos','gastos_legales','servicios_publicos','gastos_viaje','activos_fijos','otros'];

router.get('/:projectId/expenses', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  const cat = req.query.category;
  let sql = 'SELECT * FROM budget_expenses WHERE project_id = ?';
  const params = [req.params.projectId];
  if (cat && EXPENSE_CATS.includes(cat)) { sql += ' AND category = ?'; params.push(cat); }
  sql += ' ORDER BY category, sort_order';
  const [rows] = await pool.execute(sql, params);
  res.json({ data: rows });
});

router.post('/:projectId/expenses', roleMiddleware('admin', 'director'), [param('projectId').isInt(), body('label').trim().notEmpty(), body('category').isIn(EXPENSE_CATS)], async (req, res) => {
  if (!validate(req, res)) return;
  const pm = await getProjectMonths(parseInt(req.params.projectId));
  const b = req.body;
  if (parseInt(b.mes_inicio) > pm) return res.status(400).json({ error: `Mes inicio no puede superar el plazo del contrato (${pm} meses)` });
  if (b.mes_fin && parseInt(b.mes_fin) > pm) return res.status(400).json({ error: `Mes fin no puede superar el plazo del contrato (${pm} meses). Gestione un control de cambios para ampliar el plazo.` });
  const calc = calcExpense(b, pm);

  const [r] = await pool.execute(
    `INSERT INTO budget_expenses (project_id, category, label, cantidad, valor_unitario, mes_inicio, mes_fin, meses, valor_mensual, valor_total, notes, sort_order)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,99)`,
    [req.params.projectId, b.category, b.label, b.cantidad || 1, b.valor_unitario || 0, b.mes_inicio || 1, b.mes_fin || null,
      calc.meses, calc.valor_mensual, calc.valor_total, b.notes || null]
  );
  const [rows] = await pool.execute('SELECT * FROM budget_expenses WHERE id = ?', [r.insertId]);
  res.status(201).json({ data: rows[0] });
});

router.put('/:projectId/expenses/:id', roleMiddleware('admin', 'director'), [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  const pm = await getProjectMonths(parseInt(req.params.projectId));
  const [existing] = await pool.execute('SELECT * FROM budget_expenses WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
  if (existing.length === 0) return res.status(404).json({ error: 'No encontrado' });
  const merged = { ...existing[0], ...req.body };
  const calc = calcExpense(merged, pm);

  const allowed = ['category','label','cantidad','valor_unitario','mes_inicio','mes_fin','notes'];
  const updates = []; const values = [];
  allowed.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f] === '' ? null : req.body[f]); } });
  updates.push('meses=?', 'valor_mensual=?', 'valor_total=?');
  values.push(calc.meses, calc.valor_mensual, calc.valor_total, req.params.id);
  await pool.execute(`UPDATE budget_expenses SET ${updates.join(',')} WHERE id = ?`, values);
  const [rows] = await pool.execute('SELECT * FROM budget_expenses WHERE id = ?', [req.params.id]);
  res.json({ data: rows[0] });
});

router.delete('/:projectId/expenses/:id', roleMiddleware('admin', 'director'), [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  await pool.execute('DELETE FROM budget_expenses WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
  res.json({ message: 'Eliminado' });
});

// ═══════════════════════════════════════════
// GET /api/budget/:projectId/monthly
// Monthly breakdown
// ═══════════════════════════════════════════
router.get('/:projectId/monthly', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;
    const pm = await getProjectMonths(pid);
    const monthly = [];

    for (let m = 1; m <= pm; m++) {
      const [payroll] = await pool.execute(
        'SELECT COALESCE(SUM(costo_mensual * cantidad), 0) as total FROM budget_payroll WHERE project_id = ? AND mes_inicio <= ? AND (mes_fin IS NULL OR mes_fin >= ?)',
        [pid, m, m]
      );
      const [contractors] = await pool.execute(
        'SELECT COALESCE(SUM(costo_mensual * cantidad), 0) as total FROM budget_contractors WHERE project_id = ? AND mes_inicio <= ? AND (mes_fin IS NULL OR mes_fin >= ?)',
        [pid, m, m]
      );
      const [expenses] = await pool.execute(
        'SELECT COALESCE(SUM(valor_mensual), 0) as total FROM budget_expenses WHERE project_id = ? AND mes_inicio <= ? AND (mes_fin IS NULL OR mes_fin >= ?)',
        [pid, m, m]
      );

      monthly.push({
        month: m,
        payroll: parseFloat(payroll[0].total),
        contractors: parseFloat(contractors[0].total),
        expenses: parseFloat(expenses[0].total),
        total: parseFloat(payroll[0].total) + parseFloat(contractors[0].total) + parseFloat(expenses[0].total),
      });
    }

    res.json({ data: monthly, project_months: pm });
  } catch (err) { console.error('Monthly:', err); res.status(500).json({ error: 'Error' }); }
});

// ═══════════════════════════════════════════
// INCOME SCHEDULE (Flujo de ingresos)
// ═══════════════════════════════════════════
router.get('/:projectId/income-schedule', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute('SELECT * FROM budget_income_schedule WHERE project_id=? ORDER BY sort_order, mes', [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:projectId/income-schedule', async (req, res) => {
  try {
    const pid = req.params.projectId;
    const b = req.body;
    const sinIva = parseFloat(b.valor_sin_iva) || 0;
    const iva = Math.round(sinIva * 0.19 * 100) / 100;
    const conIva = sinIva + iva;
    const [ms] = await pool.execute('SELECT COALESCE(MAX(sort_order),0)+1 as s FROM budget_income_schedule WHERE project_id=?', [pid]);
    const [r] = await pool.execute(
      `INSERT INTO budget_income_schedule (project_id, tipo_pago, mes, descripcion, valor_sin_iva, valor_iva, valor_con_iva, estado, fecha_estimada, notas, sort_order)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [pid, b.tipo_pago||'mensual', b.mes||null, b.descripcion||null, sinIva, iva, conIva, b.estado||'pendiente', b.fecha_estimada||null, b.notas||null, ms[0].s]
    );
    const [rows] = await pool.execute('SELECT * FROM budget_income_schedule WHERE id=?', [r.insertId]);
    res.status(201).json({ data: rows[0] });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:projectId/income-schedule/:id', async (req, res) => {
  try {
    const b = req.body;
    const f = []; const v = [];
    if (b.tipo_pago) { f.push('tipo_pago=?'); v.push(b.tipo_pago); }
    if (b.mes !== undefined) { f.push('mes=?'); v.push(b.mes); }
    if (b.descripcion !== undefined) { f.push('descripcion=?'); v.push(b.descripcion); }
    if (b.valor_sin_iva !== undefined) {
      const sinIva = parseFloat(b.valor_sin_iva) || 0;
      const iva = Math.round(sinIva * 0.19 * 100) / 100;
      f.push('valor_sin_iva=?','valor_iva=?','valor_con_iva=?');
      v.push(sinIva, iva, sinIva + iva);
    }
    if (b.estado) { f.push('estado=?'); v.push(b.estado); }
    if (b.fecha_estimada !== undefined) { f.push('fecha_estimada=?'); v.push(b.fecha_estimada || null); }
    if (b.notas !== undefined) { f.push('notas=?'); v.push(b.notas); }
    if (f.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    v.push(req.params.id, req.params.projectId);
    await pool.execute(`UPDATE budget_income_schedule SET ${f.join(',')} WHERE id=? AND project_id=?`, v);
    res.json({ message: 'Actualizado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/income-schedule/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM budget_income_schedule WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
    res.json({ message: 'Eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// Generate monthly schedule automatically
router.post('/:projectId/income-schedule/generate', async (req, res) => {
  try {
    const pid = req.params.projectId;
    const pm = await getProjectMonths(parseInt(pid));
    const { valor_mensual_sin_iva, tipo_pago } = req.body;

    if (tipo_pago === 'mensual') {
      const sinIva = parseFloat(valor_mensual_sin_iva) || 0;
      const iva = Math.round(sinIva * 0.19 * 100) / 100;
      // Clear existing schedule
      await pool.execute('DELETE FROM budget_income_schedule WHERE project_id=?', [pid]);
      for (let m = 1; m <= pm; m++) {
        await pool.execute(
          `INSERT INTO budget_income_schedule (project_id, tipo_pago, mes, descripcion, valor_sin_iva, valor_iva, valor_con_iva, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
          [pid, 'mensual', m, `Pago mensual - Mes ${m}`, sinIva, iva, sinIva + iva, m]
        );
      }
    } else if (tipo_pago === 'unico') {
      const sinIva = parseFloat(valor_mensual_sin_iva) || 0;
      const iva = Math.round(sinIva * 0.19 * 100) / 100;
      await pool.execute('DELETE FROM budget_income_schedule WHERE project_id=?', [pid]);
      await pool.execute(
        `INSERT INTO budget_income_schedule (project_id, tipo_pago, mes, descripcion, valor_sin_iva, valor_iva, valor_con_iva, sort_order) VALUES (?,?,?,?,?,?,?,?)`,
        [pid, 'unico', pm, 'Pago único al finalizar', sinIva, iva, sinIva + iva, 1]
      );
    }

    const [rows] = await pool.execute('SELECT * FROM budget_income_schedule WHERE project_id=? ORDER BY sort_order, mes', [pid]);
    res.json({ data: rows, message: 'Flujo generado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
// PUC ACCOUNTS
// ═══════════════════════════════════════════

router.get('/:projectId/puc', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute('SELECT * FROM budget_puc_accounts WHERE project_id=? ORDER BY sort_order, cuenta', [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:projectId/puc', async (req, res) => {
  try {
    const { cuenta, nombre, parent_cuenta, valor, notas } = req.body;
    if (!cuenta || !nombre) return res.status(400).json({ error: 'Cuenta y nombre requeridos' });
    const [ms] = await pool.execute('SELECT COALESCE(MAX(sort_order),0)+1 as s FROM budget_puc_accounts WHERE project_id=?', [req.params.projectId]);
    await pool.execute(
      'INSERT INTO budget_puc_accounts (project_id, cuenta, nombre, parent_cuenta, nivel, valor, sort_order, es_predefinida, notas) VALUES (?,?,?,?,?,?,?,0,?)',
      [req.params.projectId, cuenta, nombre, parent_cuenta || null, parent_cuenta ? 1 : 0, valor || 0, ms[0].s, notas || null]
    );
    const [rows] = await pool.execute('SELECT * FROM budget_puc_accounts WHERE project_id=? ORDER BY sort_order, cuenta', [req.params.projectId]);
    res.json({ data: rows, message: 'Cuenta creada' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe esa cuenta' });
    res.status(500).json({ error: err.message });
  }
});

router.put('/:projectId/puc/:id', async (req, res) => {
  try {
    const { valor, nombre, notas } = req.body;
    const f = []; const v = [];
    if (valor !== undefined) { f.push('valor=?'); v.push(parseFloat(valor) || 0); }
    if (nombre) { f.push('nombre=?'); v.push(nombre); }
    if (notas !== undefined) { f.push('notas=?'); v.push(notas); }
    if (f.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    v.push(req.params.id, req.params.projectId);
    await pool.execute(`UPDATE budget_puc_accounts SET ${f.join(',')} WHERE id=? AND project_id=?`, v);
    res.json({ message: 'Actualizado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.delete('/:projectId/puc/:id', async (req, res) => {
  try {
    const [c] = await pool.execute('SELECT es_predefinida FROM budget_puc_accounts WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
    if (c.length && c[0].es_predefinida) return res.status(400).json({ error: 'No se pueden eliminar cuentas predefinidas' });
    await pool.execute('DELETE FROM budget_puc_accounts WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
    res.json({ message: 'Eliminada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:projectId/puc/init', async (req, res) => {
  try {
    const pid = req.params.projectId;
    const accts = [
      { cuenta:'4',nombre:'INGRESOS',parent:null,nivel:0,sort:0,sub:1 },
      { cuenta:'41',nombre:'Operacionales',parent:'4',nivel:1,sort:1,sub:1 },
      { cuenta:'5',nombre:'GASTOS',parent:null,nivel:0,sort:10,sub:1 },
      { cuenta:'5105',nombre:'Gastos de personal',parent:'5',nivel:1,sort:11,sub:1 },
      { cuenta:'5110',nombre:'Honorarios',parent:'5',nivel:1,sort:12 },
      { cuenta:'5120',nombre:'Arrendamientos',parent:'5',nivel:1,sort:13 },
      { cuenta:'5130',nombre:'Seguros',parent:'5',nivel:1,sort:14 },
      { cuenta:'5135',nombre:'Servicios',parent:'5',nivel:1,sort:15 },
      { cuenta:'5140',nombre:'Gastos legales',parent:'5',nivel:1,sort:16 },
      { cuenta:'5145',nombre:'Mantenimiento y reparaciones',parent:'5',nivel:1,sort:17 },
      { cuenta:'5150',nombre:'Adecuación e instalación',parent:'5',nivel:1,sort:18 },
      { cuenta:'5155',nombre:'Gastos de viaje',parent:'5',nivel:1,sort:19 },
      { cuenta:'5195',nombre:'Diversos',parent:'5',nivel:1,sort:20 },
      { cuenta:'5305',nombre:'Financieros',parent:'5',nivel:1,sort:21 },
    ];
    for (const a of accts) {
      await pool.execute(
        `INSERT IGNORE INTO budget_puc_accounts (project_id,cuenta,nombre,parent_cuenta,nivel,sort_order,es_subtotal,es_predefinida) VALUES (?,?,?,?,?,?,?,1)`,
        [pid, a.cuenta, a.nombre, a.parent, a.nivel, a.sort, a.sub?1:0]
      );
    }
    const [rows] = await pool.execute('SELECT * FROM budget_puc_accounts WHERE project_id=? ORDER BY sort_order,cuenta', [pid]);
    res.json({ data: rows, message: 'PUC inicializado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
// DEDUCTIONS (R, AF, GNC)
// ═══════════════════════════════════════════

router.get('/:projectId/deductions', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute('SELECT * FROM budget_deductions WHERE project_id=? ORDER BY sort_order', [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.put('/:projectId/deductions/:id', async (req, res) => {
  try {
    const { valor, porcentaje, nombre, base_calculo, notas } = req.body;
    const f = []; const v = [];
    if (valor !== undefined) { f.push('valor=?'); v.push(parseFloat(valor) || 0); }
    if (porcentaje !== undefined) { f.push('porcentaje=?'); v.push(porcentaje !== null ? parseFloat(porcentaje) : null); }
    if (nombre) { f.push('nombre=?'); v.push(nombre); }
    if (base_calculo) { f.push('base_calculo=?'); v.push(base_calculo); }
    if (notas !== undefined) { f.push('notas=?'); v.push(notas); }
    if (f.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
    v.push(req.params.id, req.params.projectId);
    await pool.execute(`UPDATE budget_deductions SET ${f.join(',')} WHERE id=? AND project_id=?`, v);
    res.json({ message: 'Actualizado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:projectId/deductions', async (req, res) => {
  try {
    const { codigo, nombre, tipo, valor, porcentaje, base_calculo, notas } = req.body;
    if (!codigo || !nombre) return res.status(400).json({ error: 'Código y nombre requeridos' });
    const [ms] = await pool.execute('SELECT COALESCE(MAX(sort_order),0)+1 as s FROM budget_deductions WHERE project_id=?', [req.params.projectId]);
    await pool.execute(
      'INSERT INTO budget_deductions (project_id,codigo,nombre,tipo,valor,porcentaje,base_calculo,sort_order,notas) VALUES (?,?,?,?,?,?,?,?,?)',
      [req.params.projectId, codigo, nombre, tipo||'otro', valor||0, porcentaje||null, base_calculo||'manual', ms[0].s, notas||null]
    );
    res.json({ message: 'Deducción creada' });
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Ya existe ese código' });
    res.status(500).json({ error: err.message });
  }
});

router.delete('/:projectId/deductions/:id', async (req, res) => {
  try {
    await pool.execute('DELETE FROM budget_deductions WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
    res.json({ message: 'Eliminada' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

router.post('/:projectId/deductions/init', async (req, res) => {
  try {
    const pid = req.params.projectId;
    const defs = [
      { codigo:'R',nombre:'Retenciones',tipo:'retencion',sort:0,pct:4.0,base:'ingresos' },
      { codigo:'AF',nombre:'Activos fijos',tipo:'activo_fijo',sort:1,pct:null,base:'manual' },
      { codigo:'GNC',nombre:'Gastos No Contabilizados',tipo:'gnc',sort:2,pct:null,base:'manual' },
    ];
    for (const d of defs) {
      await pool.execute(
        `INSERT IGNORE INTO budget_deductions (project_id,codigo,nombre,tipo,porcentaje,base_calculo,sort_order) VALUES (?,?,?,?,?,?,?)`,
        [pid, d.codigo, d.nombre, d.tipo, d.pct, d.base, d.sort]
      );
    }
    const [rows] = await pool.execute('SELECT * FROM budget_deductions WHERE project_id=? ORDER BY sort_order', [pid]);
    res.json({ data: rows, message: 'Deducciones inicializadas' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
// FINANCIAL SUMMARY (Estado de Resultados)
// ═══════════════════════════════════════════
router.get('/:projectId/financial-summary', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;

    // Income
    const [incomeRows] = await pool.execute('SELECT * FROM budget_income WHERE project_id=? ORDER BY sort_order', [pid]);
    let ingresosSinIva = 0, ivaTotal = 0;
    for (const r of incomeRows) {
      const val = parseFloat(r.value || 0);
      if (r.es_iva) ivaTotal += val;
      else if (r.es_total_con_iva) { /* skip, calculated */ }
      else if (r.tipo === 'ingreso') ingresosSinIva += val;
    }
    const totalConIva = ingresosSinIva + ivaTotal;

    // Income schedule
    let incomeSchedule = [];
    try { const [s] = await pool.execute('SELECT * FROM budget_income_schedule WHERE project_id=? ORDER BY sort_order, mes', [pid]); incomeSchedule = s; } catch {}
    const schedSinIva = incomeSchedule.reduce((s,r)=>s+parseFloat(r.valor_sin_iva||0),0);
    const schedIva = incomeSchedule.reduce((s,r)=>s+parseFloat(r.valor_iva||0),0);
    const schedConIva = incomeSchedule.reduce((s,r)=>s+parseFloat(r.valor_con_iva||0),0);

    // PUC (gastos contables directos)
    const [pucRows] = await pool.execute('SELECT * FROM budget_puc_accounts WHERE project_id=? ORDER BY sort_order,cuenta', [pid]);
    const totalPucGastos = pucRows.filter(r => r.cuenta.startsWith('5') && !r.es_subtotal).reduce((s, r) => s + parseFloat(r.valor || 0), 0);

    // Budget tables gastos
    const [payroll] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_payroll WHERE project_id=?', [pid]);
    const [contractors] = await pool.execute('SELECT COALESCE(SUM(costo_total),0) as t FROM budget_contractors WHERE project_id=?', [pid]);
    const [expTotal] = await pool.execute('SELECT COALESCE(SUM(valor_total),0) as t FROM budget_expenses WHERE project_id=?', [pid]);
    const [expByCat] = await pool.execute('SELECT category,COALESCE(SUM(valor_total),0) as total FROM budget_expenses WHERE project_id=? GROUP BY category', [pid]);

    const tPayroll = parseFloat(payroll[0].t);
    const tContractors = parseFloat(contractors[0].t);
    const tExpenses = parseFloat(expTotal[0].t);
    const totalGastos = totalPucGastos + tPayroll + tContractors + tExpenses;

    // Deductions
    const [deductions] = await pool.execute('SELECT * FROM budget_deductions WHERE project_id=? ORDER BY sort_order', [pid]);
    const gananciaContable = totalConIva - totalGastos;

    const calcDed = deductions.map(d => {
      let sugerido = parseFloat(d.valor || 0);
      if (d.porcentaje && d.base_calculo === 'ingresos') sugerido = totalConIva * parseFloat(d.porcentaje) / 100;
      else if (d.porcentaje && d.base_calculo === 'ganancia_contable') sugerido = gananciaContable * parseFloat(d.porcentaje) / 100;
      const final_val = parseFloat(d.valor || 0) > 0 ? parseFloat(d.valor) : sugerido;
      return { ...d, valor_sugerido: Math.round(sugerido * 100) / 100, valor_final: Math.round(final_val * 100) / 100 };
    });

    const retenciones = calcDed.filter(d => d.tipo === 'retencion').reduce((s, d) => s + d.valor_final, 0);
    const activosFijos = calcDed.filter(d => d.tipo === 'activo_fijo').reduce((s, d) => s + d.valor_final, 0);
    const gnc = calcDed.filter(d => d.tipo === 'gnc').reduce((s, d) => s + d.valor_final, 0);

    const gananciaDistribuible = gananciaContable - retenciones - activosFijos;
    const gananciaReal = gananciaDistribuible - gnc;

    res.json({ data: {
      ingresos_sin_iva: ingresosSinIva, iva: ivaTotal, total_con_iva: totalConIva, income_rows: incomeRows,
      income_schedule: incomeSchedule, sched_sin_iva: schedSinIva, sched_iva: schedIva, sched_con_iva: schedConIva,
      puc_accounts: pucRows, total_puc_gastos: totalPucGastos,
      total_payroll: tPayroll, total_contractors: tContractors, total_expenses: tExpenses,
      expenses_by_category: expByCat, total_gastos: totalGastos,
      deductions: calcDed, retenciones, activos_fijos: activosFijos, gnc,
      ganancia_contable: gananciaContable, ganancia_contable_pct: totalConIva > 0 ? gananciaContable/totalConIva*100 : 0,
      ganancia_distribuible: gananciaDistribuible, ganancia_distribuible_pct: totalConIva > 0 ? gananciaDistribuible/totalConIva*100 : 0,
      ganancia_real: gananciaReal, ganancia_real_pct: totalConIva > 0 ? gananciaReal/totalConIva*100 : 0,
    }});
  } catch (err) { console.error('Financial summary:', err); res.status(500).json({ error: err.message }); }
});

module.exports = router;
