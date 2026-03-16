const express = require('express');
const { param, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware, projectAccessMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch(e) { next(e); }
});
function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return false; }
  return true;
}

async function getProjectMonths(projectId) {
  const [rows] = await pool.execute('SELECT execution_term, execution_term_unit FROM projects WHERE id = ?', [projectId]);
  if (rows.length === 0) return 12;
  const p = rows[0];
  if (p.execution_term_unit === 'meses') return p.execution_term || 12;
  if (p.execution_term_unit === 'anos') return (p.execution_term || 1) * 12;
  return Math.ceil((p.execution_term || 360) / 30);
}

function monthLabel(startDate, m) {
  if (!startDate) return `Mes ${m}`;
  const d = new Date(startDate);
  d.setMonth(d.getMonth() + m - 1);
  const names = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
  return `${names[d.getMonth()]} ${d.getFullYear()}`;
}

// ═══════════════════════════════════════════
// GET - Overview (all months)
// ═══════════════════════════════════════════
router.get('/:projectId/tracking', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;
    const pm = await getProjectMonths(pid);
    const [project] = await pool.execute('SELECT start_date FROM projects WHERE id=?', [pid]);
    const startDate = project[0]?.start_date;

    // Only count tracking entries that match REAL budget items (prevents double-counting with orphaned entries)
    const [validTracking] = await pool.execute(`
      SELECT bt.mes, SUM(bt.valor_ejecutado) as ejecutado,
        COUNT(*) as items_total,
        SUM(CASE WHEN bt.valor_ejecutado > 0 THEN 1 ELSE 0 END) as items_filled
      FROM budget_tracking bt
      WHERE bt.project_id = ? AND (
        (bt.fuente = 'payroll' AND EXISTS (SELECT 1 FROM budget_payroll bp WHERE bp.id = bt.item_id AND bp.project_id = bt.project_id))
        OR (bt.fuente = 'contractors' AND EXISTS (SELECT 1 FROM budget_contractors bc WHERE bc.id = bt.item_id AND bc.project_id = bt.project_id))
        OR (bt.fuente = 'expenses' AND EXISTS (SELECT 1 FROM budget_expenses be WHERE be.id = bt.item_id AND be.project_id = bt.project_id))
        OR bt.fuente = 'extra'
      )
      GROUP BY bt.mes`, [pid]);

    const execMap = {};
    for (const r of validTracking) {
      execMap[r.mes] = { ejecutado: parseFloat(r.ejecutado || 0), items_total: r.items_total, items_filled: r.items_filled };
    }

    const months = [];
    for (let m = 1; m <= pm; m++) {
      // Planned from budget tables
      const [payroll] = await pool.execute(
        'SELECT COALESCE(SUM(costo_mensual * cantidad), 0) as total FROM budget_payroll WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)',
        [pid, m, m]);
      const [contractors] = await pool.execute(
        'SELECT COALESCE(SUM(costo_mensual * cantidad), 0) as total FROM budget_contractors WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)',
        [pid, m, m]);
      const [expenses] = await pool.execute(
        'SELECT COALESCE(SUM(valor_mensual), 0) as total FROM budget_expenses WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)',
        [pid, m, m]);

      const planeado = parseFloat(payroll[0].total) + parseFloat(contractors[0].total) + parseFloat(expenses[0].total);
      const exec = execMap[m] || { ejecutado: 0, items_total: 0, items_filled: 0 };

      months.push({
        mes: m, label: monthLabel(startDate, m),
        planeado, ejecutado: exec.ejecutado,
        desviacion: exec.ejecutado - planeado,
        items_total: exec.items_total, items_diligenciados: exec.items_filled,
        tiene_datos: exec.ejecutado > 0,
      });
    }

    let acumPlaneado = 0, acumEjecutado = 0;
    for (const m of months) {
      acumPlaneado += m.planeado;
      acumEjecutado += m.ejecutado;
      m.acumulado_planeado = acumPlaneado;
      m.acumulado_ejecutado = acumEjecutado;
      m.acum_desviacion = acumEjecutado - acumPlaneado;
    }

    res.json({
      data: months, project_months: pm,
      totals: {
        planeado: acumPlaneado, ejecutado: acumEjecutado,
        desviacion: acumEjecutado - acumPlaneado,
        desviacion_pct: acumPlaneado > 0 ? ((acumEjecutado - acumPlaneado) / acumPlaneado * 100) : 0,
      }
    });
  } catch (err) { console.error('Budget tracking:', err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
// GET - Month detail (item-level)
// ═══════════════════════════════════════════
router.get('/:projectId/tracking/:mes', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;
    const mes = parseInt(req.params.mes);
    const [project] = await pool.execute('SELECT start_date FROM projects WHERE id=?', [pid]);
    const startDate = project[0]?.start_date;

    // Saved tracking values for this month
    const [savedRows] = await pool.execute(
      'SELECT * FROM budget_tracking WHERE project_id=? AND mes=?', [pid, mes]);
    const savedMap = {};
    for (const r of savedRows) {
      savedMap[`${r.fuente}-${r.item_id}`] = r;
    }

    const categories = [];

    // 1. Payroll
    const [payrollItems] = await pool.execute(
      'SELECT id, cargo as label, (costo_mensual*cantidad) as planeado FROM budget_payroll WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)',
      [pid, mes, mes]);
    if (payrollItems.length > 0) {
      categories.push({
        key: 'payroll', label: 'Nómina',
        items: payrollItems.map(p => {
          const s = savedMap[`payroll-${p.id}`];
          return { fuente: 'payroll', id: p.id, label: p.label, planeado: parseFloat(p.planeado),
            ejecutado: s ? parseFloat(s.valor_ejecutado) : null,
            desviacion: s ? parseFloat(s.valor_ejecutado) - parseFloat(p.planeado) : null,
            notas: s?.notas || '', tracking_id: s?.id || null };
        }),
      });
    }

    // 2. Contractors
    const [contractorItems] = await pool.execute(
      'SELECT id, cargo as label, (costo_mensual*cantidad) as planeado FROM budget_contractors WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)',
      [pid, mes, mes]);
    if (contractorItems.length > 0) {
      categories.push({
        key: 'contractors', label: 'Contratistas',
        items: contractorItems.map(p => {
          const s = savedMap[`contractors-${p.id}`];
          return { fuente: 'contractors', id: p.id, label: p.label, planeado: parseFloat(p.planeado),
            ejecutado: s ? parseFloat(s.valor_ejecutado) : null,
            desviacion: s ? parseFloat(s.valor_ejecutado) - parseFloat(p.planeado) : null,
            notas: s?.notas || '', tracking_id: s?.id || null };
        }),
      });
    }

    // 3. Expenses
    const [expenseItems] = await pool.execute(
      'SELECT id, label, valor_mensual as planeado FROM budget_expenses WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)',
      [pid, mes, mes]);
    if (expenseItems.length > 0) {
      categories.push({
        key: 'expenses', label: 'Gastos Operativos',
        items: expenseItems.map(p => {
          const s = savedMap[`expenses-${p.id}`];
          return { fuente: 'expenses', id: p.id, label: p.label, planeado: parseFloat(p.planeado),
            ejecutado: s ? parseFloat(s.valor_ejecutado) : null,
            desviacion: s ? parseFloat(s.valor_ejecutado) - parseFloat(p.planeado) : null,
            notas: s?.notas || '', tracking_id: s?.id || null };
        }),
      });
    }

    // 4. Extras (not in budget)
    const extras = savedRows.filter(r => r.fuente === 'extra');
    if (extras.length > 0) {
      categories.push({
        key: 'extras', label: 'Gastos Adicionales (No Presupuestados)',
        items: extras.map(e => ({
          fuente: 'extra', id: e.id, label: e.item_label || 'Gasto adicional',
          planeado: 0, ejecutado: parseFloat(e.valor_ejecutado),
          desviacion: parseFloat(e.valor_ejecutado),
          notas: e.notas || '', tracking_id: e.id,
        })),
      });
    }

    res.json({ data: { mes, label: monthLabel(startDate, mes), categories } });
  } catch (err) { console.error('Month detail:', err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
// POST - Save executed values (item-level)
// ═══════════════════════════════════════════
router.post('/:projectId/tracking/:mes', async (req, res) => {
  try {
    const pid = req.params.projectId;
    const mes = parseInt(req.params.mes);
    const uid = req.user.id;
    const { items } = req.body;

    if (!items || !Array.isArray(items)) {
      return res.status(400).json({ error: 'Se requiere array de items' });
    }

    let saved = 0;
    for (const item of items) {
      if (item.fuente === 'extra') continue;
      await pool.execute(
        `INSERT INTO budget_tracking (project_id, mes, fuente, item_id, item_label, valor_planeado, valor_ejecutado, notas, created_by)
         VALUES (?,?,?,?,?,?,?,?,?)
         ON DUPLICATE KEY UPDATE valor_ejecutado=VALUES(valor_ejecutado), notas=VALUES(notas), created_by=VALUES(created_by)`,
        [pid, mes, item.fuente, item.id, item.label || '',
         parseFloat(item.planeado) || 0, parseFloat(item.ejecutado) || 0,
         item.notas || null, uid]
      );
      saved++;
    }

    res.json({ message: `${saved} ítems guardados para mes ${mes}` });
  } catch (err) { console.error('Save tracking:', err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
// POST - Add extra expense (not in budget)
// ═══════════════════════════════════════════
router.post('/:projectId/tracking/:mes/extra', async (req, res) => {
  try {
    const pid = req.params.projectId;
    const mes = parseInt(req.params.mes);
    const { label, valor, notas } = req.body;
    if (!label || !valor) return res.status(400).json({ error: 'Requiere label y valor' });

    // item_id must fit INT (max 2147483647), use seconds since 2025 + random
    const itemId = Math.floor((Date.now() - 1735689600000) / 1000) + Math.floor(Math.random() * 999);
    const [r] = await pool.execute(
      `INSERT INTO budget_tracking (project_id, mes, fuente, item_id, item_label, valor_planeado, valor_ejecutado, notas, created_by)
       VALUES (?,?,'extra',?,?,0,?,?,?)`,
      [pid, mes, itemId, label, parseFloat(valor), notas || null, req.user.id]
    );

    res.status(201).json({ data: { id: r.insertId, label, valor: parseFloat(valor) }, message: 'Gasto adicional registrado' });
  } catch (err) { console.error('Add extra:', err); res.status(500).json({ error: err.message }); }
});

// ═══════════════════════════════════════════
// DELETE - Remove extra expense
// ═══════════════════════════════════════════
router.delete('/:projectId/tracking/extra/:id', async (req, res) => {
  try {
    await pool.execute(
      "DELETE FROM budget_tracking WHERE id=? AND project_id=? AND fuente='extra'",
      [req.params.id, req.params.projectId]);
    res.json({ message: 'Gasto adicional eliminado' });
  } catch (err) { res.status(500).json({ error: err.message }); }
});

module.exports = router;
