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

// ═══════════════════════════════════════════
// MILESTONES
// ═══════════════════════════════════════════

router.get('/:projectId/milestones/stats', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='pendiente') as pendiente, SUM(status='cumplido') as cumplido, SUM(status='vencido') as vencido,
        SUM(due_date IS NOT NULL AND due_date < CURDATE() AND status='pendiente') as overdue
      FROM milestones WHERE project_id = ?`, [req.params.projectId]);
    res.json({ data: rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

router.get('/:projectId/milestones', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT m.*,
        CASE WHEN m.status='cumplido' THEN 'ok' WHEN m.due_date < CURDATE() AND m.status='pendiente' THEN 'overdue'
          WHEN m.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND m.status='pendiente' THEN 'urgent' ELSE 'normal' END as alert_level,
        CASE WHEN m.due_date IS NOT NULL THEN DATEDIFF(m.due_date, CURDATE()) ELSE NULL END as days_remaining,
        (SELECT COUNT(*) FROM deliverables d WHERE d.milestone_id = m.id) as deliverable_count
      FROM milestones m WHERE m.project_id = ?
      ORDER BY FIELD(m.status,'vencido','pendiente','cumplido'), m.due_date ASC`, [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error listando hitos' }); }
});

router.post('/:projectId/milestones', roleMiddleware('admin','director'),
  [param('projectId').isInt(), body('name').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body;
      const [r] = await pool.execute(
        'INSERT INTO milestones (project_id,name,description,due_date,due_date_rule,status) VALUES (?,?,?,?,?,?)',
        [req.params.projectId, b.name, b.description||null, b.due_date||null, b.due_date_rule||null, 'pendiente']);
      await pool.execute('INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
        [req.user.id,'create','milestone',r.insertId,JSON.stringify({name:b.name})]);
      const [rows] = await pool.execute('SELECT * FROM milestones WHERE id = ?', [r.insertId]);
      res.status(201).json({ data: rows[0], message: `Hito "${b.name}" creado` });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error creando hito' }); }
});

router.put('/:projectId/milestones/:id', roleMiddleware('admin','director'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [ex] = await pool.execute('SELECT id FROM milestones WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      if (ex.length===0) return res.status(404).json({error:'Hito no encontrado'});
      const allowed = ['name','description','due_date','due_date_rule','status'];
      const updates = []; const values = [];
      allowed.forEach(f => { if (req.body[f]!==undefined) { updates.push(`${f}=?`); values.push(req.body[f]===''?null:req.body[f]); }});
      if (req.body.status==='cumplido') { updates.push('completed_at=NOW()'); }
      if (updates.length===0) return res.status(400).json({error:'Nada que actualizar'});
      values.push(req.params.id);
      await pool.execute(`UPDATE milestones SET ${updates.join(',')} WHERE id=?`, values);
      const [rows] = await pool.execute('SELECT * FROM milestones WHERE id=?', [req.params.id]);
      res.json({ data: rows[0], message: 'Hito actualizado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

router.delete('/:projectId/milestones/:id', roleMiddleware('admin'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [ex] = await pool.execute('SELECT name FROM milestones WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      if (ex.length===0) return res.status(404).json({error:'No encontrado'});
      await pool.execute('DELETE FROM milestones WHERE id=?', [req.params.id]);
      res.json({ message: `Hito "${ex[0].name}" eliminado` });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══════════════════════════════════════════
// DELIVERABLES
// ═══════════════════════════════════════════

router.get('/:projectId/deliverables/stats', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(status='pendiente') as pendiente, SUM(status='en_elaboracion') as en_elaboracion,
        SUM(status='entregado') as entregado, SUM(status='aprobado') as aprobado, SUM(status='rechazado') as rechazado
      FROM deliverables WHERE project_id = ?`, [req.params.projectId]);
    res.json({ data: rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

router.get('/:projectId/deliverables', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT d.*, o.code as obligation_code, o.description as obligation_desc, m.name as milestone_name,
        CASE WHEN d.status IN ('aprobado') THEN 'ok' WHEN d.due_date < CURDATE() AND d.status NOT IN ('aprobado','entregado') THEN 'overdue'
          WHEN d.due_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY) AND d.status NOT IN ('aprobado','entregado') THEN 'urgent' ELSE 'normal' END as alert_level,
        CASE WHEN d.due_date IS NOT NULL THEN DATEDIFF(d.due_date, CURDATE()) ELSE NULL END as days_remaining
      FROM deliverables d
      LEFT JOIN obligations o ON d.obligation_id = o.id
      LEFT JOIN milestones m ON d.milestone_id = m.id
      WHERE d.project_id = ?
      ORDER BY FIELD(d.status,'rechazado','pendiente','en_elaboracion','entregado','aprobado'), d.due_date ASC`,
      [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error listando entregables' }); }
});

router.post('/:projectId/deliverables', roleMiddleware('admin','director'),
  [param('projectId').isInt(), body('name').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body;
      const [r] = await pool.execute(
        'INSERT INTO deliverables (project_id,obligation_id,milestone_id,name,description,required_format,due_date,acceptance_criteria,status,sp_item_id,sp_file_url) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        [req.params.projectId, b.obligation_id||null, b.milestone_id||null, b.name, b.description||null, b.required_format||null, b.due_date||null, b.acceptance_criteria||null, 'pendiente', b.sp_item_id||null, b.sp_file_url||null]);
      await pool.execute('INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
        [req.user.id,'create','deliverable',r.insertId,JSON.stringify({name:b.name})]);
      const [rows] = await pool.execute('SELECT * FROM deliverables WHERE id=?', [r.insertId]);
      res.status(201).json({ data: rows[0], message: `Entregable "${b.name}" creado` });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error creando entregable' }); }
});

router.put('/:projectId/deliverables/:id', roleMiddleware('admin','director'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [ex] = await pool.execute('SELECT id FROM deliverables WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      if (ex.length===0) return res.status(404).json({error:'Entregable no encontrado'});
      const allowed = ['name','description','obligation_id','milestone_id','required_format','due_date','acceptance_criteria','status','sp_item_id','sp_file_url'];
      const updates = []; const values = [];
      allowed.forEach(f => { if (req.body[f]!==undefined) { updates.push(`${f}=?`); values.push(req.body[f]===''?null:req.body[f]); }});
      if (req.body.status==='entregado'||req.body.status==='aprobado') { updates.push('delivered_at=NOW()'); }
      if (updates.length===0) return res.status(400).json({error:'Nada que actualizar'});
      values.push(req.params.id);
      await pool.execute(`UPDATE deliverables SET ${updates.join(',')} WHERE id=?`, values);
      const [rows] = await pool.execute('SELECT * FROM deliverables WHERE id=?', [req.params.id]);
      res.json({ data: rows[0], message: 'Entregable actualizado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

router.delete('/:projectId/deliverables/:id', roleMiddleware('admin'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [ex] = await pool.execute('SELECT name FROM deliverables WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      if (ex.length===0) return res.status(404).json({error:'No encontrado'});
      await pool.execute('DELETE FROM deliverables WHERE id=?', [req.params.id]);
      res.json({ message: `Entregable "${ex[0].name}" eliminado` });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══════════════════════════════════════════
// OBLIGATION EVIDENCE
// ═══════════════════════════════════════════

router.get('/:projectId/obligations/:oblId/evidence', [param('projectId').isInt(), param('oblId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT oe.*, d.file_name, d.mime_type, d.file_size, u.full_name as uploaded_by_name
      FROM obligation_evidence oe
      LEFT JOIN documents d ON oe.document_id = d.id
      LEFT JOIN users u ON oe.uploaded_by = u.id
      WHERE oe.obligation_id = ?
      ORDER BY oe.created_at DESC`, [req.params.oblId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

router.post('/:projectId/obligations/:oblId/evidence', roleMiddleware('admin','director','consultor'),
  [param('projectId').isInt(), param('oblId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body;
      const [r] = await pool.execute(
        'INSERT INTO obligation_evidence (obligation_id, document_id, description, uploaded_by) VALUES (?,?,?,?)',
        [req.params.oblId, b.document_id||null, b.description||null, req.user.id]);
      const [rows] = await pool.execute(`
        SELECT oe.*, d.file_name, u.full_name as uploaded_by_name
        FROM obligation_evidence oe
        LEFT JOIN documents d ON oe.document_id = d.id
        LEFT JOIN users u ON oe.uploaded_by = u.id WHERE oe.id=?`, [r.insertId]);
      res.status(201).json({ data: rows[0], message: 'Evidencia registrada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

router.delete('/:projectId/obligations/:oblId/evidence/:evId', roleMiddleware('admin','director'),
  [param('projectId').isInt(), param('oblId').isInt(), param('evId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      await pool.execute('DELETE FROM obligation_evidence WHERE id=? AND obligation_id=?', [req.params.evId, req.params.oblId]);
      res.json({ message: 'Evidencia eliminada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

module.exports = router;
