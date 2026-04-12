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

// ═══════════════════════════════════════════
// GET - Export Excel (Seguimiento Presupuestal)
// ═══════════════════════════════════════════
router.get('/:projectId/tracking-export', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const XLSX = require('xlsx');
    const pid = req.params.projectId;
    const pm = await getProjectMonths(pid);
    const [[project]] = await pool.execute(
      'SELECT code, name, client_name, contract_value, start_date, execution_term, execution_term_unit FROM projects WHERE id=?', [pid]
    );
    const startDate = project?.start_date;

    const fmt = (v) => v != null ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v) : '$0';

    // ── Fetch overview ──────────────────────────────────────────────
    const [validTracking] = await pool.execute(`
      SELECT bt.mes, SUM(bt.valor_ejecutado) as ejecutado
      FROM budget_tracking bt
      WHERE bt.project_id = ? AND (
        (bt.fuente = 'payroll'      AND EXISTS (SELECT 1 FROM budget_payroll bp      WHERE bp.id = bt.item_id AND bp.project_id = bt.project_id))
        OR (bt.fuente = 'contractors' AND EXISTS (SELECT 1 FROM budget_contractors bc WHERE bc.id = bt.item_id AND bc.project_id = bt.project_id))
        OR (bt.fuente = 'expenses'    AND EXISTS (SELECT 1 FROM budget_expenses be   WHERE be.id = bt.item_id AND be.project_id = bt.project_id))
        OR bt.fuente = 'extra'
      )
      GROUP BY bt.mes`, [pid]);
    const execMap = {};
    for (const r of validTracking) execMap[r.mes] = parseFloat(r.ejecutado || 0);

    const overviewMonths = [];
    let acumPlan = 0, acumExec = 0;
    for (let m = 1; m <= pm; m++) {
      const [[pay]]  = await pool.execute('SELECT COALESCE(SUM(costo_mensual*cantidad),0) as t FROM budget_payroll WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)', [pid,m,m]);
      const [[con]]  = await pool.execute('SELECT COALESCE(SUM(costo_mensual*cantidad),0) as t FROM budget_contractors WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)', [pid,m,m]);
      const [[exp]]  = await pool.execute('SELECT COALESCE(SUM(valor_mensual),0) as t FROM budget_expenses WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)', [pid,m,m]);
      const planeado = parseFloat(pay.t)+parseFloat(con.t)+parseFloat(exp.t);
      const ejecutado = execMap[m] || 0;
      acumPlan += planeado; acumExec += ejecutado;
      overviewMonths.push({ mes: m, label: monthLabel(startDate, m), planeado, ejecutado, desviacion: ejecutado - planeado, acumPlan, acumExec, acumDev: acumExec - acumPlan, tieneData: ejecutado > 0 });
    }
    const totalPlan = acumPlan, totalExec = acumExec;

    // ── Fetch month details ────────────────────────────────────────
    const monthDetails = {};
    for (const mo of overviewMonths.filter(m => m.tieneData)) {
      const mes = mo.mes;
      const [saved] = await pool.execute('SELECT * FROM budget_tracking WHERE project_id=? AND mes=?', [pid, mes]);
      const savedMap = {};
      for (const r of saved) savedMap[`${r.fuente}-${r.item_id}`] = r;

      const cats = [];
      const [payItems] = await pool.execute('SELECT id, cargo as label, (costo_mensual*cantidad) as planeado FROM budget_payroll WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)', [pid,mes,mes]);
      if (payItems.length) cats.push({ key:'payroll', label:'Nómina', items: payItems.map(p => { const s=savedMap[`payroll-${p.id}`]; return { label:p.label, planeado:parseFloat(p.planeado), ejecutado:s?parseFloat(s.valor_ejecutado):null, notas:s?.notas||'' }; }) });
      const [conItems] = await pool.execute('SELECT id, cargo as label, (costo_mensual*cantidad) as planeado FROM budget_contractors WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)', [pid,mes,mes]);
      if (conItems.length) cats.push({ key:'contractors', label:'Contratistas', items: conItems.map(p => { const s=savedMap[`contractors-${p.id}`]; return { label:p.label, planeado:parseFloat(p.planeado), ejecutado:s?parseFloat(s.valor_ejecutado):null, notas:s?.notas||'' }; }) });
      const [expItems] = await pool.execute('SELECT id, label, valor_mensual as planeado FROM budget_expenses WHERE project_id=? AND mes_inicio<=? AND (mes_fin IS NULL OR mes_fin>=?)', [pid,mes,mes]);
      if (expItems.length) cats.push({ key:'expenses', label:'Gastos Operativos', items: expItems.map(p => { const s=savedMap[`expenses-${p.id}`]; return { label:p.label, planeado:parseFloat(p.planeado), ejecutado:s?parseFloat(s.valor_ejecutado):null, notas:s?.notas||'' }; }) });
      const extras = saved.filter(r => r.fuente==='extra');
      if (extras.length) cats.push({ key:'extras', label:'Gastos Adicionales (No Presupuestados)', items: extras.map(e => ({ label:e.item_label||'Gasto adicional', planeado:0, ejecutado:parseFloat(e.valor_ejecutado), notas:e.notas||'' })) });

      monthDetails[mes] = { label: mo.label, categories: cats };
    }

    // ── Build workbook ─────────────────────────────────────────────
    const wb = XLSX.utils.book_new();
    const TEAL    = 'FF00897B'; // brand teal
    const DARK    = 'FF1E293B';
    const BLUE_H  = 'FF1E40AF';
    const BLUE_L  = 'FFDBEAFE';
    const PURPLE_L= 'FFEDE9FE';
    const HEAD_BG = 'FF0F766E';
    const GRAY    = 'FFF8FAFC';
    const RED_L   = 'FFFEE2E2';
    const GREEN_L = 'FFD1FAE5';
    const BORDER  = { top:{style:'thin',color:{rgb:'FFE2E8F0'}}, bottom:{style:'thin',color:{rgb:'FFE2E8F0'}}, left:{style:'thin',color:{rgb:'FFE2E8F0'}}, right:{style:'thin',color:{rgb:'FFE2E8F0'}} };
    const BORDER_MED = { top:{style:'medium',color:{rgb:'FF64748B'}}, bottom:{style:'medium',color:{rgb:'FF64748B'}}, left:{style:'medium',color:{rgb:'FF64748B'}}, right:{style:'medium',color:{rgb:'FF64748B'}} };

    const cell = (v, opts={}) => {
      const c = { v, t: typeof v === 'number' ? 'n' : 's' };
      if (opts.bold || opts.bg || opts.color || opts.align || opts.fmt || opts.border || opts.wrap || opts.sz) {
        c.s = {
          font: { bold: !!opts.bold, color: { rgb: opts.color || DARK }, sz: opts.sz || 10, name: 'Calibri' },
          fill: opts.bg ? { fgColor: { rgb: opts.bg } } : undefined,
          alignment: { horizontal: opts.align || 'left', vertical: 'center', wrapText: !!opts.wrap },
          numFmt: opts.fmt || (typeof v === 'number' ? '#,##0' : undefined),
          border: opts.border || BORDER,
        };
      }
      return c;
    };

    // ═══ HOJA RESUMEN ════════════════════════════════════════════════
    const rsData = [];

    // Header
    rsData.push([cell(`SEGUIMIENTO PRESUPUESTAL — ${(project?.code||'').toUpperCase()}`, { bold:true, sz:16, color:'FFFFFFFF', bg:HEAD_BG, align:'center' }), ...Array(6).fill(cell('',{bg:HEAD_BG}))]);
    rsData.push([cell(project?.name||'', { sz:11, color:'FFFFFFFF', bg:HEAD_BG, align:'center' }), ...Array(6).fill(cell('',{bg:HEAD_BG}))]);
    rsData.push([cell(`Cliente: ${project?.client_name||''}  |  Plazo: ${project?.execution_term||''} ${project?.execution_term_unit||''}  |  Valor contrato: ${fmt(project?.contract_value)}`, { sz:9, color:'FFB2DFDB', bg:HEAD_BG, align:'center' }), ...Array(6).fill(cell('',{bg:HEAD_BG}))]);
    rsData.push([cell('',{bg:GRAY}), ...Array(6).fill(cell('',{bg:GRAY}))]);

    // KPI row
    const kpiDev = totalExec - totalPlan;
    const kpiDevPct = totalPlan > 0 ? ((kpiDev/totalPlan)*100).toFixed(1) : '0.0';
    rsData.push([
      cell('TOTAL PLANEADO', { bold:true, bg:BLUE_L, color:BLUE_H, align:'center', sz:9 }),
      cell(totalPlan, { bold:true, bg:BLUE_L, color:BLUE_H, align:'center', fmt:'#,##0', sz:11 }),
      cell('TOTAL EJECUTADO', { bold:true, bg:PURPLE_L, color:'FF6D28D9', align:'center', sz:9 }),
      cell(totalExec, { bold:true, bg:PURPLE_L, color:'FF6D28D9', align:'center', fmt:'#,##0', sz:11 }),
      cell(kpiDev >= 0 ? 'SOBRECOSTO' : 'AHORRO', { bold:true, bg: kpiDev >= 0 ? RED_L : GREEN_L, color: kpiDev >= 0 ? 'FFB91C1C' : 'FF065F46', align:'center', sz:9 }),
      cell(kpiDev, { bold:true, bg: kpiDev >= 0 ? RED_L : GREEN_L, color: kpiDev >= 0 ? 'FFB91C1C' : 'FF065F46', align:'center', fmt:'#,##0', sz:11 }),
      cell(`${kpiDevPct}%`, { bold:true, bg: kpiDev >= 0 ? RED_L : GREEN_L, color: kpiDev >= 0 ? 'FFB91C1C' : 'FF065F46', align:'center', sz:11 }),
    ]);
    rsData.push([cell('',{bg:GRAY}), ...Array(6).fill(cell('',{bg:GRAY}))]);

    // Table header
    rsData.push([
      cell('MES',         { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'center', border:BORDER_MED }),
      cell('PLANEADO',    { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'center', border:BORDER_MED }),
      cell('EJECUTADO',   { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'center', border:BORDER_MED }),
      cell('DESVIACIÓN',  { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'center', border:BORDER_MED }),
      cell('ACUM. PLAN.', { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'center', border:BORDER_MED }),
      cell('ACUM. EJEC.', { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'center', border:BORDER_MED }),
      cell('ACUM. DESV.', { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'center', border:BORDER_MED }),
    ]);

    for (const m of overviewMonths) {
      const devBgC = !m.tieneData ? GRAY : m.desviacion > 0 ? RED_L : m.desviacion < 0 ? GREEN_L : GRAY;
      const devCol = !m.tieneData ? '94A3B8' : m.desviacion > 0 ? 'FFB91C1C' : 'FF065F46';
      const acBgC  = !m.tieneData ? GRAY : m.acumDev > 0 ? RED_L : m.acumDev < 0 ? GREEN_L : GRAY;
      rsData.push([
        cell(m.label,      { bg:'FFFFFFFF', align:'left',   bold: m.tieneData }),
        cell(m.planeado,   { bg:BLUE_L,     align:'right',  fmt:'#,##0', color:BLUE_H }),
        cell(m.tieneData ? m.ejecutado : '', { bg: m.tieneData ? PURPLE_L : GRAY, align:'right', fmt:'#,##0', color: m.tieneData ? 'FF6D28D9' : '94A3B8' }),
        cell(m.tieneData ? m.desviacion : '', { bg:devBgC, align:'right', fmt:'#,##0', color:devCol }),
        cell(m.tieneData ? m.acumPlan : '',  { bg: m.tieneData ? BLUE_L : GRAY, align:'right', fmt:'#,##0', color: m.tieneData ? BLUE_H : '94A3B8' }),
        cell(m.tieneData ? m.acumExec : '',  { bg: m.tieneData ? PURPLE_L : GRAY, align:'right', fmt:'#,##0', color: m.tieneData ? 'FF6D28D9' : '94A3B8' }),
        cell(m.tieneData ? m.acumDev  : '',  { bg:acBgC, align:'right', fmt:'#,##0', color: m.tieneData ? (m.acumDev>0?'FFB91C1C':'FF065F46') : '94A3B8' }),
      ]);
    }

    // Totals row
    rsData.push([
      cell('TOTAL', { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'right', border:BORDER_MED }),
      cell(totalPlan, { bold:true, bg:'FF1E3A5F', color:'FFFFFFFF', align:'right', fmt:'#,##0', border:BORDER_MED }),
      cell(totalExec, { bold:true, bg:'FF2E1065', color:'FFFFFFFF', align:'right', fmt:'#,##0', border:BORDER_MED }),
      cell(kpiDev,    { bold:true, bg: kpiDev>=0 ? 'FF7F1D1D' : 'FF064E3B', color:'FFFFFFFF', align:'right', fmt:'#,##0', border:BORDER_MED }),
      cell('', { bg:HEAD_BG }), cell('', { bg:HEAD_BG }), cell('', { bg:HEAD_BG }),
    ]);

    const rsSheet = XLSX.utils.aoa_to_sheet(rsData);
    rsSheet['!cols'] = [{ wch: 14 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 18 }];
    rsSheet['!rows'] = [{ hpt: 28 }, { hpt: 20 }, { hpt: 16 }, { hpt: 6 }, { hpt: 34 }, { hpt: 6 }];
    rsSheet['!merges'] = [
      { s:{r:0,c:0}, e:{r:0,c:6} },
      { s:{r:1,c:0}, e:{r:1,c:6} },
      { s:{r:2,c:0}, e:{r:2,c:6} },
      { s:{r:3,c:0}, e:{r:3,c:6} },
    ];
    XLSX.utils.book_append_sheet(wb, rsSheet, 'Resumen');

    // ═══ HOJAS POR MES ═══════════════════════════════════════════════
    for (const [mes, detail] of Object.entries(monthDetails)) {
      const shData = [];
      const moInfo = overviewMonths.find(m => m.mes === parseInt(mes));

      // Month header
      shData.push([cell(`${detail.label.toUpperCase()} — DETALLE PRESUPUESTAL`, { bold:true, sz:14, color:'FFFFFFFF', bg:HEAD_BG, align:'center' }), ...Array(4).fill(cell('',{bg:HEAD_BG}))]);
      shData.push([cell(`${project?.code||''} — ${project?.name||''}`, { sz:10, color:'FFB2DFDB', bg:HEAD_BG, align:'center' }), ...Array(4).fill(cell('',{bg:HEAD_BG}))]);
      shData.push([cell('',{bg:GRAY}), ...Array(4).fill(cell('',{bg:GRAY}))]);

      // Month KPIs
      shData.push([
        cell('PLANEADO MES', { bold:true, bg:BLUE_L, color:BLUE_H, align:'center', sz:9 }),
        cell(moInfo.planeado, { bold:true, bg:BLUE_L, color:BLUE_H, align:'center', fmt:'#,##0', sz:11 }),
        cell('EJECUTADO MES', { bold:true, bg:PURPLE_L, color:'FF6D28D9', align:'center', sz:9 }),
        cell(moInfo.ejecutado, { bold:true, bg:PURPLE_L, color:'FF6D28D9', align:'center', fmt:'#,##0', sz:11 }),
        cell(moInfo.desviacion >= 0 ? `SOBRECOSTO ${((moInfo.desviacion/moInfo.planeado)*100).toFixed(1)}%` : `AHORRO ${(Math.abs(moInfo.desviacion/moInfo.planeado)*100).toFixed(1)}%`,
          { bold:true, bg: moInfo.desviacion>=0?RED_L:GREEN_L, color: moInfo.desviacion>=0?'FFB91C1C':'FF065F46', align:'center', sz:10 }),
      ]);
      shData.push([cell('',{bg:GRAY}), ...Array(4).fill(cell('',{bg:GRAY}))]);

      // Column headers
      shData.push([
        cell('ÍTEM / CONCEPTO',   { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'left',   border:BORDER_MED }),
        cell('PLANEADO',          { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'center', border:BORDER_MED }),
        cell('EJECUTADO',         { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'center', border:BORDER_MED }),
        cell('DESVIACIÓN',        { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'center', border:BORDER_MED }),
        cell('NOTAS',             { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'left',   border:BORDER_MED }),
      ]);

      let monthTotPlan = 0, monthTotExec = 0;
      for (const cat of detail.categories) {
        // Category header
        shData.push([
          cell(cat.label.toUpperCase(), { bold:true, bg:'FFFDE68A', color:'FF78350F', align:'left', sz:10, border:BORDER_MED }),
          cell('', { bg:'FFFDE68A' }), cell('', { bg:'FFFDE68A' }), cell('', { bg:'FFFDE68A' }), cell('', { bg:'FFFDE68A' }),
        ]);

        let catPlan = 0, catExec = 0;
        for (const it of cat.items) {
          const exec = it.ejecutado != null ? it.ejecutado : 0;
          const dev  = it.ejecutado != null ? exec - it.planeado : null;
          const iBg  = it.ejecutado != null ? (dev > 0 ? RED_L : dev < 0 ? GREEN_L : 'FFFFFFFF') : GRAY;
          catPlan += it.planeado; catExec += exec;
          shData.push([
            cell(`  ${it.label}`, { bg:'FFFFFFFF' }),
            cell(it.planeado, { bg:BLUE_L, color:BLUE_H, align:'right', fmt:'#,##0' }),
            cell(it.ejecutado != null ? exec : '', { bg: it.ejecutado!=null ? PURPLE_L : GRAY, color: it.ejecutado!=null ? 'FF6D28D9' : '94A3B8', align:'right', fmt:'#,##0' }),
            cell(dev != null ? dev : '', { bg:iBg, color: dev!=null?(dev>0?'FFB91C1C':dev<0?'FF065F46':DARK):'94A3B8', align:'right', fmt:'#,##0' }),
            cell(it.notas||'', { bg:'FFFFFFFF', wrap:true, sz:9 }),
          ]);
        }

        // Category subtotal
        const catDev = catExec - catPlan;
        shData.push([
          cell(`Subtotal ${cat.label}`, { bold:true, bg:'FFF1F5F9', align:'right', sz:9, border:BORDER_MED }),
          cell(catPlan, { bold:true, bg:'FFF1F5F9', color:BLUE_H, align:'right', fmt:'#,##0', border:BORDER_MED }),
          cell(catExec, { bold:true, bg:'FFF1F5F9', color:'FF6D28D9', align:'right', fmt:'#,##0', border:BORDER_MED }),
          cell(catDev,  { bold:true, bg: catDev>=0?RED_L:GREEN_L, color: catDev>=0?'FFB91C1C':'FF065F46', align:'right', fmt:'#,##0', border:BORDER_MED }),
          cell('', { bg:'FFF1F5F9' }),
        ]);
        monthTotPlan += catPlan; monthTotExec += catExec;
      }

      // Grand total
      const totDev = monthTotExec - monthTotPlan;
      shData.push([cell('',{bg:GRAY}), ...Array(4).fill(cell('',{bg:GRAY}))]);
      shData.push([
        cell('TOTAL MES', { bold:true, bg:HEAD_BG, color:'FFFFFFFF', align:'right', sz:11, border:BORDER_MED }),
        cell(monthTotPlan, { bold:true, bg:'FF1E3A5F', color:'FFFFFFFF', align:'right', fmt:'#,##0', sz:11, border:BORDER_MED }),
        cell(monthTotExec, { bold:true, bg:'FF2E1065', color:'FFFFFFFF', align:'right', fmt:'#,##0', sz:11, border:BORDER_MED }),
        cell(totDev, { bold:true, bg: totDev>=0?'FF7F1D1D':'FF064E3B', color:'FFFFFFFF', align:'right', fmt:'#,##0', sz:11, border:BORDER_MED }),
        cell('', { bg:HEAD_BG }),
      ]);

      const sh = XLSX.utils.aoa_to_sheet(shData);
      sh['!cols'] = [{ wch: 40 }, { wch: 18 }, { wch: 18 }, { wch: 18 }, { wch: 30 }];
      sh['!rows'] = [{ hpt: 24 }, { hpt: 18 }, { hpt: 6 }, { hpt: 30 }, { hpt: 6 }];
      sh['!merges'] = [
        { s:{r:0,c:0}, e:{r:0,c:4} },
        { s:{r:1,c:0}, e:{r:1,c:4} },
        { s:{r:2,c:0}, e:{r:2,c:4} },
      ];
      // Sanitize sheet name (max 31 chars, no special chars)
      const shName = detail.label.replace(/[\\/*?[\]:]/g,'').substring(0, 31);
      XLSX.utils.book_append_sheet(wb, sh, shName);
    }

    // ── Return file ─────────────────────────────────────────────────
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    const fileName = `Seg_Presupuestal_${project?.code||pid}_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.send(buf);
  } catch (err) { console.error('Export tracking:', err); res.status(500).json({ error: err.message }); }
});

module.exports = router;
