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
    const ExcelJS = require('exceljs');
    const pid = req.params.projectId;
    const pm = await getProjectMonths(pid);
    const [[project]] = await pool.execute(
      'SELECT code, name, client_name, contract_value, start_date, execution_term, execution_term_unit FROM projects WHERE id=?', [pid]
    );
    const startDate = project?.start_date;

    const fmtCOP = (v) => v != null ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v) : '$0';
    const NUM_FMT = '"$"#,##0';

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

    // ── Helpers de estilo ExcelJS ──────────────────────────────────
    const C = {
      TEAL:    '0F766E', TEAL_L:  'CCFBF1',
      BLUE:    '1E40AF', BLUE_L:  'DBEAFE',
      PURPLE:  '6D28D9', PURPLE_L:'EDE9FE',
      GREEN:   '065F46', GREEN_L: 'D1FAE5',
      RED:     'B91C1C', RED_L:   'FEE2E2',
      AMBER:   '78350F', AMBER_L: 'FEF3C7',
      SLATE:   '1E293B', SLATE_L: 'F8FAFC',
      WHITE:   'FFFFFF', GRAY:    'F1F5F9',
    };

    const border = (color='CBD5E1') => ({
      top:    { style:'thin', color:{ argb:'FF'+color } },
      bottom: { style:'thin', color:{ argb:'FF'+color } },
      left:   { style:'thin', color:{ argb:'FF'+color } },
      right:  { style:'thin', color:{ argb:'FF'+color } },
    });
    const borderMed = (color='64748B') => ({
      top:    { style:'medium', color:{ argb:'FF'+color } },
      bottom: { style:'medium', color:{ argb:'FF'+color } },
      left:   { style:'medium', color:{ argb:'FF'+color } },
      right:  { style:'medium', color:{ argb:'FF'+color } },
    });

    const applyStyle = (cell, { bold=false, italic=false, sz=10, color=C.SLATE, bg=null,
      align='left', valign='middle', numFmt=null, wrap=false, borders=null } = {}) => {
      cell.font = { name:'Calibri', size:sz, bold, italic, color:{ argb:'FF'+color } };
      if (bg) cell.fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+bg } };
      cell.alignment = { horizontal:align, vertical:valign, wrapText:wrap };
      if (numFmt) cell.numFmt = numFmt;
      cell.border = borders || border();
    };

    const wb = new ExcelJS.Workbook();
    wb.creator = 'SGIP-IA';
    wb.created = new Date();

    // ════════════════════════════════════════════════════════════════
    // HOJA RESUMEN
    // ════════════════════════════════════════════════════════════════
    const ws = wb.addWorksheet('Resumen', { views:[{ showGridLines:false }] });
    ws.columns = [
      { key:'mes',   width:16 },
      { key:'plan',  width:20 },
      { key:'exec',  width:20 },
      { key:'dev',   width:20 },
      { key:'aexec', width:20 },
      { key:'adev',  width:20 },
    ];

    const kpiDev    = totalExec - totalPlan;
    const kpiDevPct = totalPlan > 0 ? (kpiDev/totalPlan*100).toFixed(1) : '0.0';
    const isOver    = kpiDev >= 0;

    // Fila 1 — Título principal
    ws.mergeCells('A1:F1');
    const t1 = ws.getCell('A1');
    t1.value = `SEGUIMIENTO PRESUPUESTAL — ${(project?.code||'').toUpperCase()}`;
    applyStyle(t1, { bold:true, sz:16, color:C.WHITE, bg:C.TEAL, align:'center', borders:borderMed(C.TEAL) });
    ws.getRow(1).height = 32;

    // Fila 2 — Nombre proyecto
    ws.mergeCells('A2:F2');
    const t2 = ws.getCell('A2');
    t2.value = project?.name || '';
    applyStyle(t2, { bold:true, sz:12, color:'B2DFDB', bg:C.TEAL, align:'center', borders:borderMed(C.TEAL) });
    ws.getRow(2).height = 22;

    // Fila 3 — Info cliente
    ws.mergeCells('A3:F3');
    const t3 = ws.getCell('A3');
    t3.value = `Cliente: ${project?.client_name||''}   |   Plazo: ${project?.execution_term||''} ${project?.execution_term_unit||''}   |   Valor contrato: ${fmtCOP(project?.contract_value)}`;
    applyStyle(t3, { sz:9, color:'B2DFDB', bg:C.TEAL, align:'center', italic:true, borders:borderMed(C.TEAL) });
    ws.getRow(3).height = 16;

    // Fila 4 — Separador
    ws.mergeCells('A4:F4');
    ws.getCell('A4').fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+C.GRAY } };
    ws.getRow(4).height = 8;

    // Fila 5 — KPIs (2 bloques x2 columnas + 1 x2)
    const kpiRow = ws.getRow(5);
    kpiRow.height = 50;
    // KPI 1: Planeado (A5:B5)
    ws.mergeCells('A5:B5');
    const kpi1 = ws.getCell('A5');
    kpi1.value = { richText: [
      { text: 'TOTAL PLANEADO\n', font:{ name:'Calibri', size:9, bold:true, color:{ argb:'FF'+C.BLUE } } },
      { text: fmtCOP(totalPlan),  font:{ name:'Calibri', size:14, bold:true, color:{ argb:'FF'+C.BLUE } } },
    ]};
    applyStyle(kpi1, { bg:C.BLUE_L, align:'center', wrap:true, borders:borderMed(C.BLUE) });

    // KPI 2: Ejecutado (C5:D5)
    ws.mergeCells('C5:D5');
    const kpi2 = ws.getCell('C5');
    kpi2.value = { richText: [
      { text: 'TOTAL EJECUTADO\n', font:{ name:'Calibri', size:9, bold:true, color:{ argb:'FF'+C.PURPLE } } },
      { text: fmtCOP(totalExec),   font:{ name:'Calibri', size:14, bold:true, color:{ argb:'FF'+C.PURPLE } } },
    ]};
    applyStyle(kpi2, { bg:C.PURPLE_L, align:'center', wrap:true, borders:borderMed(C.PURPLE) });

    // KPI 3: Desviación (E5:F5)
    ws.mergeCells('E5:F5');
    const kpi3 = ws.getCell('E5');
    kpi3.value = { richText: [
      { text: (isOver ? 'SOBRECOSTO' : 'AHORRO')+'\n', font:{ name:'Calibri', size:9, bold:true, color:{ argb:'FF'+(isOver?C.RED:C.GREEN) } } },
      { text: fmtCOP(Math.abs(kpiDev)),                font:{ name:'Calibri', size:14, bold:true, color:{ argb:'FF'+(isOver?C.RED:C.GREEN) } } },
      { text: `  (${isOver?'+':''}${kpiDevPct}%)`,     font:{ name:'Calibri', size:10, bold:false, color:{ argb:'FF'+(isOver?C.RED:C.GREEN) } } },
    ]};
    applyStyle(kpi3, { bg: isOver?C.RED_L:C.GREEN_L, align:'center', wrap:true, borders:borderMed(isOver?C.RED:C.GREEN) });

    // Fila 6 — Separador
    ws.mergeCells('A6:F6');
    ws.getCell('A6').fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+C.GRAY } };
    ws.getRow(6).height = 8;

    // Fila 7 — Encabezados tabla (6 columnas)
    const cols7 = ['MES','PLANEADO','EJECUTADO','DESVIACIÓN','ACUM. EJECUTADO','ACUM. DESVIACIÓN'];
    cols7.forEach((h, i) => {
      const c = ws.getRow(7).getCell(i+1);
      c.value = h;
      applyStyle(c, { bold:true, sz:10, color:C.WHITE, bg:C.TEAL, align:'center', borders:borderMed() });
    });
    ws.getRow(7).height = 20;

    // Filas de datos
    for (const m of overviewMonths) {
      const row = ws.addRow([]);
      row.height = 18;
      const devBg  = !m.tieneData ? C.SLATE_L : m.desviacion  > 0 ? C.RED_L   : m.desviacion  < 0 ? C.GREEN_L  : C.WHITE;
      const devCol = !m.tieneData ? 'CBD5E1'   : m.desviacion  > 0 ? C.RED     : m.desviacion  < 0 ? C.GREEN    : C.SLATE;
      const adevBg = !m.tieneData ? C.SLATE_L  : m.acumDev > 0 ? C.RED_L   : m.acumDev < 0 ? C.GREEN_L  : C.WHITE;
      const adevCol= !m.tieneData ? 'CBD5E1'   : m.acumDev > 0 ? C.RED     : m.acumDev < 0 ? C.GREEN    : C.SLATE;

      const c1 = row.getCell(1); c1.value = m.label;
      applyStyle(c1, { bold:m.tieneData, sz:10, color:C.SLATE, bg:m.tieneData?C.WHITE:C.SLATE_L, align:'left' });

      const c2 = row.getCell(2); c2.value = m.planeado;
      applyStyle(c2, { sz:10, color:C.BLUE, bg:C.BLUE_L, align:'right', numFmt:NUM_FMT });

      const c3 = row.getCell(3); c3.value = m.tieneData ? m.ejecutado : null;
      applyStyle(c3, { sz:10, color:m.tieneData?C.PURPLE:'CBD5E1', bg:m.tieneData?C.PURPLE_L:C.SLATE_L, align:'right', numFmt:NUM_FMT });

      const c4 = row.getCell(4); c4.value = m.tieneData ? m.desviacion : null;
      applyStyle(c4, { sz:10, bold:m.tieneData, color:devCol, bg:devBg, align:'right', numFmt:NUM_FMT });

      const c5 = row.getCell(5); c5.value = m.tieneData ? m.acumExec : null;
      applyStyle(c5, { sz:10, color:m.tieneData?C.PURPLE:'CBD5E1', bg:m.tieneData?C.PURPLE_L:C.SLATE_L, align:'right', numFmt:NUM_FMT });

      const c6 = row.getCell(6); c6.value = m.tieneData ? m.acumDev : null;
      applyStyle(c6, { sz:10, bold:m.tieneData, color:adevCol, bg:adevBg, align:'right', numFmt:NUM_FMT });
    }

    // Fila TOTAL
    const totRow = ws.addRow([]);
    totRow.height = 22;
    const totCells = [
      { v:'TOTAL',   bg:'0F5953', col:C.WHITE, bold:true, align:'center', nm:null },
      { v:totalPlan, bg:'164E63', col:C.WHITE, bold:true, align:'right',  nm:NUM_FMT },
      { v:totalExec, bg:'2E1065', col:C.WHITE, bold:true, align:'right',  nm:NUM_FMT },
      { v:kpiDev,    bg:isOver?'7F1D1D':'064E3B', col:C.WHITE, bold:true, align:'right', nm:NUM_FMT },
      { v:'', bg:C.TEAL, col:C.WHITE }, { v:'', bg:C.TEAL, col:C.WHITE },
    ];
    totCells.forEach((t,i) => {
      const c = totRow.getCell(i+1);
      c.value = t.v;
      applyStyle(c, { bold:t.bold, sz:11, color:t.col, bg:t.bg, align:t.align||'left', numFmt:t.nm, borders:borderMed() });
    });

    // Fila fecha generación
    ws.addRow([]);
    const fecRow = ws.addRow([]);
    ws.mergeCells(`A${fecRow.number}:F${fecRow.number}`);
    const fecCell = fecRow.getCell(1);
    fecCell.value = `Generado el ${new Date().toLocaleDateString('es-CO',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} — SGIP-IA`;
    applyStyle(fecCell, { sz:8, color:'94A3B8', italic:true, align:'right', bg:C.GRAY, borders:border('E2E8F0') });
    fecRow.height = 14;

    // ════════════════════════════════════════════════════════════════
    // HOJAS POR MES
    // ════════════════════════════════════════════════════════════════
    for (const [mes, detail] of Object.entries(monthDetails)) {
      const moInfo = overviewMonths.find(m => m.mes === parseInt(mes));
      const shName = detail.label.replace(/[\\/*?[\]:]/g,'').substring(0,31);
      const ms = wb.addWorksheet(shName, { views:[{ showGridLines:false }] });
      ms.columns = [
        { key:'item',  width:42 },
        { key:'plan',  width:20 },
        { key:'exec',  width:20 },
        { key:'dev',   width:20 },
        { key:'notas', width:35 },
      ];

      // Header
      ms.mergeCells('A1:E1');
      const mh1 = ms.getCell('A1');
      mh1.value = `${detail.label.toUpperCase()} — DETALLE PRESUPUESTAL`;
      applyStyle(mh1, { bold:true, sz:15, color:C.WHITE, bg:C.TEAL, align:'center', borders:borderMed(C.TEAL) });
      ms.getRow(1).height = 28;

      ms.mergeCells('A2:E2');
      const mh2 = ms.getCell('A2');
      mh2.value = `${project?.code||''} — ${project?.name||''}`;
      applyStyle(mh2, { sz:10, color:'B2DFDB', bg:C.TEAL, align:'center', italic:true, borders:borderMed(C.TEAL) });
      ms.getRow(2).height = 18;

      // KPIs del mes
      ms.mergeCells('A3:E3');
      ms.getCell('A3').fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+C.GRAY } };
      ms.getRow(3).height = 8;

      const moIsOver = moInfo.desviacion >= 0;
      const devPct   = moInfo.planeado > 0 ? Math.abs(moInfo.desviacion/moInfo.planeado*100).toFixed(1) : '0.0';
      ms.getRow(4).height = 46;
      // KPI Plan (A4:B4)
      ms.mergeCells('A4:B4');
      const mk1 = ms.getCell('A4');
      mk1.value = { richText:[
        { text:'PLANEADO MES\n', font:{name:'Calibri',size:9,bold:true,color:{argb:'FF'+C.BLUE}} },
        { text:fmtCOP(moInfo.planeado), font:{name:'Calibri',size:13,bold:true,color:{argb:'FF'+C.BLUE}} },
      ]};
      applyStyle(mk1, { bg:C.BLUE_L, align:'center', wrap:true, borders:borderMed(C.BLUE) });
      // KPI Exec (C4:D4)
      ms.mergeCells('C4:D4');
      const mk2 = ms.getCell('C4');
      mk2.value = { richText:[
        { text:'EJECUTADO MES\n', font:{name:'Calibri',size:9,bold:true,color:{argb:'FF'+C.PURPLE}} },
        { text:fmtCOP(moInfo.ejecutado), font:{name:'Calibri',size:13,bold:true,color:{argb:'FF'+C.PURPLE}} },
      ]};
      applyStyle(mk2, { bg:C.PURPLE_L, align:'center', wrap:true, borders:borderMed(C.PURPLE) });
      // KPI Desv (E4)
      const mk3 = ms.getCell('E4');
      mk3.value = { richText:[
        { text:(moIsOver?'SOBRECOSTO':'AHORRO')+'\n', font:{name:'Calibri',size:9,bold:true,color:{argb:'FF'+(moIsOver?C.RED:C.GREEN)}} },
        { text:fmtCOP(Math.abs(moInfo.desviacion)),   font:{name:'Calibri',size:13,bold:true,color:{argb:'FF'+(moIsOver?C.RED:C.GREEN)}} },
        { text:`  (${devPct}%)`,                      font:{name:'Calibri',size:9,color:{argb:'FF'+(moIsOver?C.RED:C.GREEN)}} },
      ]};
      applyStyle(mk3, { bg:moIsOver?C.RED_L:C.GREEN_L, align:'center', wrap:true, borders:borderMed(moIsOver?C.RED:C.GREEN) });

      ms.mergeCells('A5:E5');
      ms.getCell('A5').fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+C.GRAY } };
      ms.getRow(5).height = 8;

      // Encabezados tabla
      const hCols = ['ÍTEM / CONCEPTO','PLANEADO','EJECUTADO','DESVIACIÓN','NOTAS'];
      const hRow = ms.addRow([]);
      hRow.height = 20;
      hCols.forEach((h,i) => {
        const c = hRow.getCell(i+1);
        c.value = h;
        applyStyle(c, { bold:true, sz:10, color:C.WHITE, bg:C.TEAL, align:i===0||i===4?'left':'center', borders:borderMed() });
      });

      let mTotPlan=0, mTotExec=0;
      for (const cat of detail.categories) {
        // Encabezado categoría
        const catRow = ms.addRow([]);
        catRow.height = 18;
        ms.mergeCells(`A${catRow.number}:E${catRow.number}`);
        const catCell = catRow.getCell(1);
        catCell.value = `  ${cat.label.toUpperCase()}`;
        applyStyle(catCell, { bold:true, sz:10, color:C.AMBER, bg:C.AMBER_L, align:'left', borders:borderMed(C.AMBER) });

        let cPlan=0, cExec=0;
        for (const it of cat.items) {
          const exec = it.ejecutado != null ? it.ejecutado : 0;
          const dev  = it.ejecutado != null ? exec - it.planeado : null;
          const iBg  = it.ejecutado==null ? C.SLATE_L : dev > 0 ? C.RED_L : dev < 0 ? C.GREEN_L : C.WHITE;
          const iCol = it.ejecutado==null ? 'CBD5E1' : dev > 0 ? C.RED : dev < 0 ? C.GREEN : C.SLATE;
          cPlan += it.planeado; cExec += exec;

          const iRow = ms.addRow([]);
          iRow.height = 16;
          const ic1 = iRow.getCell(1); ic1.value = `    ${it.label}`;
          applyStyle(ic1, { sz:9, color:C.SLATE, bg:C.WHITE, align:'left' });
          const ic2 = iRow.getCell(2); ic2.value = it.planeado;
          applyStyle(ic2, { sz:9, color:C.BLUE, bg:C.BLUE_L, align:'right', numFmt:NUM_FMT });
          const ic3 = iRow.getCell(3); ic3.value = it.ejecutado != null ? exec : null;
          applyStyle(ic3, { sz:9, color:it.ejecutado!=null?C.PURPLE:'CBD5E1', bg:it.ejecutado!=null?C.PURPLE_L:C.SLATE_L, align:'right', numFmt:NUM_FMT });
          const ic4 = iRow.getCell(4); ic4.value = dev;
          applyStyle(ic4, { sz:9, bold:dev!=null&&Math.abs(dev)>0, color:iCol, bg:iBg, align:'right', numFmt:NUM_FMT });
          const ic5 = iRow.getCell(5); ic5.value = it.notas||'';
          applyStyle(ic5, { sz:8, color:'64748B', bg:C.WHITE, align:'left', wrap:true });
        }

        // Subtotal categoría
        const stRow = ms.addRow([]);
        stRow.height = 17;
        const catDev = cExec - cPlan;
        const sc1 = stRow.getCell(1); sc1.value = `Subtotal ${cat.label}`;
        applyStyle(sc1, { bold:true, sz:9, color:C.SLATE, bg:C.GRAY, align:'right', borders:borderMed('94A3B8') });
        const sc2 = stRow.getCell(2); sc2.value = cPlan;
        applyStyle(sc2, { bold:true, sz:9, color:C.BLUE, bg:C.GRAY, align:'right', numFmt:NUM_FMT, borders:borderMed('94A3B8') });
        const sc3 = stRow.getCell(3); sc3.value = cExec;
        applyStyle(sc3, { bold:true, sz:9, color:C.PURPLE, bg:C.GRAY, align:'right', numFmt:NUM_FMT, borders:borderMed('94A3B8') });
        const sc4 = stRow.getCell(4); sc4.value = catDev;
        applyStyle(sc4, { bold:true, sz:9, color:catDev>=0?C.RED:C.GREEN, bg:catDev>=0?C.RED_L:C.GREEN_L, align:'right', numFmt:NUM_FMT, borders:borderMed('94A3B8') });
        const sc5 = stRow.getCell(5); sc5.value = '';
        applyStyle(sc5, { bg:C.GRAY, borders:borderMed('94A3B8') });

        mTotPlan += cPlan; mTotExec += cExec;
      }

      // Separador
      const sepRow = ms.addRow([]); sepRow.height = 8;
      ms.mergeCells(`A${sepRow.number}:E${sepRow.number}`);
      sepRow.getCell(1).fill = { type:'pattern', pattern:'solid', fgColor:{ argb:'FF'+C.GRAY } };

      // Total mes
      const totMesRow = ms.addRow([]); totMesRow.height = 24;
      const totMesDev = mTotExec - mTotPlan;
      const tm = [
        { v:'TOTAL MES', bg:'0F5953', col:C.WHITE, bold:true, align:'center', nm:null },
        { v:mTotPlan,    bg:'164E63', col:C.WHITE, bold:true, align:'right',  nm:NUM_FMT },
        { v:mTotExec,    bg:'2E1065', col:C.WHITE, bold:true, align:'right',  nm:NUM_FMT },
        { v:totMesDev,   bg:totMesDev>=0?'7F1D1D':'064E3B', col:C.WHITE, bold:true, align:'right', nm:NUM_FMT },
        { v:'', bg:C.TEAL, col:C.WHITE },
      ];
      tm.forEach((t,i) => {
        const c = totMesRow.getCell(i+1);
        c.value = t.v;
        applyStyle(c, { bold:t.bold, sz:12, color:t.col, bg:t.bg, align:t.align, numFmt:t.nm, borders:borderMed() });
      });

      // Fecha
      ms.addRow([]);
      const mfRow = ms.addRow([]); mfRow.height = 14;
      ms.mergeCells(`A${mfRow.number}:E${mfRow.number}`);
      const mfCell = mfRow.getCell(1);
      mfCell.value = `Generado el ${new Date().toLocaleDateString('es-CO',{weekday:'long',year:'numeric',month:'long',day:'numeric'})} — SGIP-IA`;
      applyStyle(mfCell, { sz:8, color:'94A3B8', italic:true, align:'right', bg:C.GRAY, borders:border('E2E8F0') });
    }

    // ── Return file ─────────────────────────────────────────────────
    const fileName = `Seg_Presupuestal_${project?.code||pid}_${new Date().toISOString().slice(0,10)}.xlsx`;
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    await wb.xlsx.write(res);
    res.end();
  } catch (err) { console.error('Export tracking:', err); res.status(500).json({ error: err.message }); }
});

module.exports = router;
