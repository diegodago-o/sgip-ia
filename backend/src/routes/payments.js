const express = require('express');
const { param, body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware, projectAccessMiddleware } = require('../middleware/auth');
const notifier = require('../services/notifier');

const router = express.Router();
router.use(authMiddleware);
// Verify user has access to the project
router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch(e) { next(e); }
});
function validate(req, res) { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; }

// ═══════════════════════════════════════
// CÁLCULO DE PAGOS — Fórmula Colombia
// Base = valor del servicio sin IVA
// IVA = Base * iva_pct%
// Factura (gross) = Base + IVA
// RETEIVA = IVA * reteiva_pct% (retención sobre IVA)
// RETEFUENTE = Base * retefuente_pct% (retención en la fuente)
// RETEICA = Base * reteica_pct% (retención ICA)
// Total Consignar (net) = Factura - RETEIVA - RETEFUENTE - RETEICA - Amortización
// ═══════════════════════════════════════
function calcPayment(b) {
  const base = parseFloat(b.base_value) || 0;
  const ivaPct = parseFloat(b.iva_pct) ?? 19;
  const amort = parseFloat(b.amortization) || 0;
  const reteivaPct    = parseFloat(b.reteiva_pct)    || 0;
  const retefuentePct = parseFloat(b.retefuente_pct) || 0;
  const reteicaPct    = parseFloat(b.reteica_pct)    || 0;
  const gmfPct        = parseFloat(b.gmf_pct)        || 0;

  const ivaValue        = Math.round(base  * ivaPct        / 100);
  const gross           = base + ivaValue;
  const reteivaValue    = Math.round(ivaValue * reteivaPct / 100);
  const retefuenteValue = Math.round(base  * retefuentePct / 100);
  const reteicaValue    = Math.round(base  * reteicaPct    / 100);
  const gmfValue        = Math.round(gross * gmfPct        / 100);
  const totalRetentions = reteivaValue + retefuenteValue + reteicaValue + gmfValue;
  const net = gross - totalRetentions - amort;

  return {
    base_value: base,
    iva_pct: ivaPct,
    iva_value: ivaValue,
    gross_value: gross,
    amortization: amort,
    reteiva_pct: reteivaPct,
    reteiva_value: reteivaValue,
    retefuente_pct: retefuentePct,
    retefuente_value: retefuenteValue,
    reteica_pct: reteicaPct,
    reteica_value: reteicaValue,
    gmf_pct: gmfPct,
    gmf_value: gmfValue,
    retention_pct: 0,
    retention_value: totalRetentions,
    taxes: ivaValue,
    net_value: net,
  };
}

// ═══ Summary ═══
router.get('/:projectId/payments/summary', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;
    const [rows] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='pagado') as pagados, SUM(status='aprobado') as aprobados,
        SUM(status='en_revision') as en_revision, SUM(status='rechazado') as rechazados,
        COALESCE(SUM(CASE WHEN status='pagado' THEN net_value END),0) as total_paid,
        COALESCE(SUM(CASE WHEN status='pagado' THEN gross_value END),0) as total_paid_gross,
        COALESCE(SUM(CASE WHEN status='pagado' THEN base_value END),0) as total_paid_base,
        COALESCE(SUM(CASE WHEN status IN ('aprobado','pagado') THEN gross_value END),0) as total_approved_gross,
        COALESCE(SUM(amortization),0) as total_amortized,
        COALESCE(SUM(retention_value),0) as total_retained,
        COALESCE(SUM(retefuente_value),0) as total_retefuente,
        COALESCE(SUM(reteica_value),0) as total_reteica,
        COALESCE(SUM(reteiva_value),0) as total_reteiva,
        COALESCE(SUM(IFNULL(gmf_value,0)),0) as total_gmf
      FROM payments WHERE project_id=?`, [pid]);
    const [proj] = await pool.execute('SELECT contract_value FROM projects WHERE id=?', [pid]);
    const cv = parseFloat(proj[0]?.contract_value || 0);
    const tp = parseFloat(rows[0]?.total_paid || 0);
    const tpBase = parseFloat(rows[0]?.total_paid_base || 0);
    rows[0].contract_value = cv;
    // payment_pct: compare base_value (sin IVA) vs contract_value (sin IVA) for coherent percentage
    rows[0].payment_pct = cv > 0 ? ((tpBase / cv) * 100).toFixed(1) : 0;
    rows[0].remaining = cv - tpBase;
    res.json({ data: rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ List ═══
router.get('/:projectId/payments', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT p.*, u.full_name as approved_by_name, d.file_name as doc_name
      FROM payments p
      LEFT JOIN users u ON p.approved_by = u.id
      LEFT JOIN documents d ON p.document_id = d.id
      WHERE p.project_id = ?
      ORDER BY p.payment_number ASC`, [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Create ═══
router.post('/:projectId/payments', roleMiddleware('admin','gerente_proyecto'),
  [param('projectId').isInt(), body('concept').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body; const pid = req.params.projectId;
      const calc = calcPayment(b);
      const [mx] = await pool.execute('SELECT COALESCE(MAX(payment_number),0)+1 as n FROM payments WHERE project_id=?', [pid]);
      const scheduleId = b.schedule_id ? parseInt(b.schedule_id) : null;
      const [r] = await pool.execute(
        `INSERT INTO payments (project_id,payment_number,payment_type,concept,period_from,period_to,
          base_value,iva_pct,iva_value,gross_value,amortization,
          retention_pct,retention_value,reteiva_pct,reteiva_value,
          retefuente_pct,retefuente_value,reteica_pct,reteica_value,
          gmf_pct,gmf_value,taxes,net_value,
          invoice_number,invoice_date,paid_date,status,document_id,notes,schedule_id)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [pid, mx[0].n, b.payment_type||'corte_mensual', b.concept, b.period_from||null, b.period_to||null,
          calc.base_value, calc.iva_pct, calc.iva_value, calc.gross_value, calc.amortization,
          calc.retention_pct, calc.retention_value, calc.reteiva_pct, calc.reteiva_value,
          calc.retefuente_pct, calc.retefuente_value, calc.reteica_pct, calc.reteica_value,
          calc.gmf_pct, calc.gmf_value, calc.taxes, calc.net_value,
          b.invoice_number||null, b.invoice_date||null, b.paid_date||null,
          'borrador', b.document_id||null, b.notes||null, scheduleId]);

      // Mark schedule item as 'facturado' if linked
      if (scheduleId) {
        try {
          await pool.execute(
            `UPDATE budget_income_schedule SET estado='facturado' WHERE id=? AND project_id=?`,
            [scheduleId, pid]
          );
        } catch {}
      }

      const [rows] = await pool.execute('SELECT * FROM payments WHERE id=?', [r.insertId]);
      res.status(201).json({ data: rows[0], message: `Pago #${mx[0].n} creado` });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Error' }); }
});

// ═══ Update ═══
router.put('/:projectId/payments/:id', roleMiddleware('admin','gerente_proyecto'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [ex] = await pool.execute('SELECT * FROM payments WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      if (ex.length === 0) return res.status(404).json({ error: 'Pago no encontrado' });

      const b = req.body;
      const merged = {
        base_value:     b.base_value     !== undefined ? b.base_value     : ex[0].base_value,
        iva_pct:        b.iva_pct        !== undefined ? b.iva_pct        : ex[0].iva_pct,
        amortization:   b.amortization   !== undefined ? b.amortization   : ex[0].amortization,
        reteiva_pct:    b.reteiva_pct    !== undefined ? b.reteiva_pct    : ex[0].reteiva_pct,
        retefuente_pct: b.retefuente_pct !== undefined ? b.retefuente_pct : ex[0].retefuente_pct,
        reteica_pct:    b.reteica_pct    !== undefined ? b.reteica_pct    : ex[0].reteica_pct,
        gmf_pct:        b.gmf_pct        !== undefined ? b.gmf_pct        : (ex[0].gmf_pct || 0),
      };
      const calc = calcPayment(merged);

      const metaFields = ['payment_type','concept','period_from','period_to','invoice_number','invoice_date','paid_date','status','document_id','notes'];
      const sets = []; const vals = [];
      metaFields.forEach(f => { if (b[f] !== undefined) { sets.push(`${f}=?`); vals.push(b[f]===''?null:b[f]); }});

      sets.push('base_value=?','iva_pct=?','iva_value=?','gross_value=?','amortization=?');
      vals.push(calc.base_value, calc.iva_pct, calc.iva_value, calc.gross_value, calc.amortization);
      sets.push('retention_pct=?','retention_value=?','taxes=?','net_value=?');
      vals.push(calc.retention_pct, calc.retention_value, calc.taxes, calc.net_value);
      sets.push('reteiva_pct=?','reteiva_value=?','retefuente_pct=?','retefuente_value=?','reteica_pct=?','reteica_value=?','gmf_pct=?','gmf_value=?');
      vals.push(calc.reteiva_pct, calc.reteiva_value, calc.retefuente_pct, calc.retefuente_value, calc.reteica_pct, calc.reteica_value, calc.gmf_pct, calc.gmf_value);

      if (b.status === 'aprobado') { sets.push('approved_by=?', 'approved_at=NOW()'); vals.push(req.user.id); }
      if (b.status === 'pagado' && !b.paid_date) { sets.push('paid_date=CURDATE()'); }

      vals.push(req.params.id);
      await pool.execute(`UPDATE payments SET ${sets.join(',')} WHERE id=?`, vals);
      const [rows] = await pool.execute('SELECT * FROM payments WHERE id=?', [req.params.id]);

      // Propagate status to linked schedule item (fire-and-forget)
      if (b.status && b.status !== ex[0].status && rows[0].schedule_id) {
        const schedEstado = b.status === 'pagado' ? 'pagado' : b.status === 'aprobado' ? 'facturado' : null;
        if (schedEstado) {
          pool.execute(
            `UPDATE budget_income_schedule SET estado=? WHERE id=? AND project_id=?`,
            [schedEstado, rows[0].schedule_id, req.params.projectId]
          ).catch(() => {});
        }
      }

      // Notify if status just changed to 'aprobado' (fire-and-forget)
      if (b.status === 'aprobado' && ex[0].status !== 'aprobado') {
        const [proj] = await pool.execute('SELECT code, name FROM projects WHERE id = ?', [req.params.projectId]);
        notifier.notify('payment.approved', {
          project_id:   Number(req.params.projectId),
          project_code: proj[0]?.code || '',
          project_name: proj[0]?.name || '',
          concept:      rows[0].concept || '',
          net_value:    rows[0].net_value,
          period_to:    rows[0].period_to,
        }).catch(() => {});
      }

      res.json({ data: rows[0], message: 'Pago actualizado' });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Error' }); }
});

// ═══ Delete ═══
router.delete('/:projectId/payments/:id', roleMiddleware('admin'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [ex] = await pool.execute('SELECT payment_number FROM payments WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      if (ex.length === 0) return res.status(404).json({ error: 'No encontrado' });
      await pool.execute('DELETE FROM payments WHERE id=?', [req.params.id]);
      res.json({ message: `Pago #${ex[0].payment_number} eliminado` });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

module.exports = router;
