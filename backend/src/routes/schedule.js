const express = require('express');
const { param, body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

function validate(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; }
  return true;
}

// ── Recalc parent progress + status from children ──
async function recalcParent(parentId) {
  if (!parentId) return;
  const [children] = await pool.execute(
    'SELECT progress_pct, weight_pct FROM schedule_activities WHERE parent_id = ?', [parentId]);
  if (children.length === 0) return;
  const totalWeight = children.reduce((s, c) => s + parseFloat(c.weight_pct || 0), 0);
  let progress = 0;
  if (totalWeight > 0) {
    progress = children.reduce((s, c) => s + (parseFloat(c.progress_pct) * parseFloat(c.weight_pct || 0) / totalWeight), 0);
  } else {
    progress = children.reduce((s, c) => s + parseFloat(c.progress_pct), 0) / children.length;
  }
  const status = progress >= 100 ? 'completada' : progress > 0 ? 'en_progreso' : 'no_iniciada';
  await pool.execute('UPDATE schedule_activities SET progress_pct = ?, status = ? WHERE id = ?',
    [progress.toFixed(2), status, parentId]);
  const [parent] = await pool.execute('SELECT parent_id FROM schedule_activities WHERE id = ?', [parentId]);
  if (parent[0] && parent[0].parent_id) await recalcParent(parent[0].parent_id);
}

// ── Auto-detect status (FIXED: progress>0 always = en_progreso) ──
function calcStatus(startDate, endDate, progress) {
  const p = parseFloat(progress);
  if (p >= 100) return 'completada';
  if (p > 0) return 'en_progreso';
  if (!startDate) return 'no_iniciada';
  if (endDate && new Date(endDate) < new Date() && p < 100) return 'atrasada';
  return 'no_iniciada';
}

// ── Auto-generate WBS code ──
async function generateWBS(projectId, parentId) {
  if (parentId) {
    const [parent] = await pool.execute('SELECT wbs_code FROM schedule_activities WHERE id=?', [parentId]);
    const parentWBS = (parent[0] && parent[0].wbs_code) || '';
    const [siblings] = await pool.execute(
      'SELECT COUNT(*) as c FROM schedule_activities WHERE project_id=? AND parent_id=?', [projectId, parentId]);
    const num = (siblings[0].c || 0) + 1;
    return parentWBS ? parentWBS + '.' + num : String(num);
  }
  const [roots] = await pool.execute(
    'SELECT COUNT(*) as c FROM schedule_activities WHERE project_id=? AND parent_id IS NULL', [projectId]);
  return String((roots[0].c || 0) + 1);
}

// ── Update project progress + auto-trigger status ──
async function updateProjectProgress(projectId) {
  const [avgR] = await pool.execute(
    'SELECT AVG(progress_pct) as p FROM schedule_activities WHERE project_id=? AND parent_id IS NULL', [projectId]);
  if (avgR[0].p !== null) {
    const pct = parseFloat(avgR[0].p).toFixed(2);
    await pool.execute('UPDATE projects SET progress_pct=? WHERE id=?', [pct, projectId]);
    if (parseFloat(pct) > 0) {
      try { await pool.execute("UPDATE projects SET status='en_ejecucion' WHERE id=? AND status='en_arranque'", [projectId]); } catch(e) {}
    }
  }
}

// ═══ Stats ═══
router.get('/:projectId/schedule/stats', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.projectId;
    const [rows] = await pool.execute(
      "SELECT COUNT(*) as total, SUM(status='no_iniciada') as no_iniciada, SUM(status='en_progreso') as en_progreso, SUM(status='completada') as completada, SUM(status='atrasada') as atrasada, SUM(status='suspendida') as suspendida, SUM(activity_type='task') as tasks, SUM(activity_type='milestone') as milestones_count, AVG(CASE WHEN activity_type='task' THEN progress_pct END) as avg_progress, SUM(baseline_start IS NOT NULL) as has_baseline FROM schedule_activities WHERE project_id = ?", [pid]);
    const [critical] = await pool.execute(
      "SELECT COUNT(*) as count FROM schedule_activities WHERE project_id = ? AND activity_type = 'task' AND status IN ('atrasada','en_progreso') AND end_date <= DATE_ADD(CURDATE(), INTERVAL 7 DAY)", [pid]);
    const d = rows[0];
    d.critical_path = critical[0].count;
    d.avg_progress = parseFloat(d.avg_progress || 0).toFixed(1);
    d.baseline_set = parseInt(d.has_baseline || 0) > 0;
    res.json({ data: d });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ List — tree structure ═══
router.get('/:projectId/schedule', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(
      "SELECT a.*, DATEDIFF(a.end_date, a.start_date) as calc_duration, CASE WHEN a.end_date < CURDATE() AND a.progress_pct < 100 AND a.activity_type='task' THEN true ELSE false END as is_late, DATEDIFF(a.end_date, CURDATE()) as days_remaining, (SELECT COUNT(*) FROM schedule_activities c WHERE c.parent_id = a.id) as child_count FROM schedule_activities a WHERE a.project_id = ? ORDER BY a.sort_order, a.wbs_code, a.start_date, a.id", [req.params.projectId]);
    const map = {}; const tree = [];
    rows.forEach(function(r) { r.children = []; map[r.id] = r; });
    rows.forEach(function(r) { if (r.parent_id && map[r.parent_id]) map[r.parent_id].children.push(r); else tree.push(r); });
    res.json({ data: tree, flat: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Create ═══
router.post('/:projectId/schedule', roleMiddleware('admin','director'),
  [param('projectId').isInt(), body('name').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body; const pid = req.params.projectId;
      const progress = (b.activity_type === 'milestone' && b.status === 'completada') ? 100 : parseFloat(b.progress_pct || 0);
      const status = b.status || calcStatus(b.start_date, b.end_date, progress);
      const dur = (b.start_date && b.end_date) ? Math.ceil((new Date(b.end_date) - new Date(b.start_date)) / 86400000) : (b.duration_days || null);
      const wbs = b.wbs_code || await generateWBS(pid, b.parent_id || null);
      const [maxSort] = await pool.execute(
        'SELECT COALESCE(MAX(sort_order),0)+1 as next FROM schedule_activities WHERE project_id=? AND COALESCE(parent_id,0)=?',
        [pid, b.parent_id || 0]);
      const [r] = await pool.execute(
        "INSERT INTO schedule_activities (project_id,parent_id,wbs_code,name,description,activity_type,start_date,end_date,duration_days,weight_pct,predecessor_ids,assigned_to,status,progress_pct,sort_order) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        [pid, b.parent_id||null, wbs, b.name, b.description||null, b.activity_type||'task',
         b.start_date||null, b.end_date||null, dur, b.weight_pct||0,
         b.predecessor_ids ? JSON.stringify(b.predecessor_ids) : null,
         b.assigned_to||null, status, progress, maxSort[0].next]);
      if (b.parent_id) await recalcParent(b.parent_id);
      await updateProjectProgress(pid);
      await pool.execute('INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
        [req.user.id, 'create', 'schedule_activity', r.insertId, JSON.stringify({name: b.name, wbs: wbs})]);
      const [rows] = await pool.execute('SELECT * FROM schedule_activities WHERE id=?', [r.insertId]);
      res.status(201).json({ data: rows[0], message: 'Actividad "' + b.name + '" (' + wbs + ') creada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error creando actividad' }); }
});

// ═══ Update ═══
router.put('/:projectId/schedule/:id', roleMiddleware('admin','director'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [ex] = await pool.execute('SELECT * FROM schedule_activities WHERE id=? AND project_id=?',
        [req.params.id, req.params.projectId]);
      if (ex.length === 0) return res.status(404).json({ error: 'Actividad no encontrada' });
      const allowed = ['name','description','wbs_code','activity_type','start_date','end_date','duration_days',
        'weight_pct','predecessor_ids','assigned_to','status','sort_order','progress_pct','parent_id'];
      const updates = []; const values = [];
      for (var i = 0; i < allowed.length; i++) {
        var f = allowed[i];
        if (req.body[f] !== undefined) {
          updates.push(f + '=?');
          var val = req.body[f] === '' ? null : req.body[f];
          if (f === 'predecessor_ids' && Array.isArray(val)) val = JSON.stringify(val);
          values.push(val);
        }
      }
      // Auto status from progress (only if status not explicitly sent)
      if (req.body.progress_pct !== undefined && req.body.status === undefined) {
        var sd = req.body.start_date || ex[0].start_date;
        var ed = req.body.end_date || ex[0].end_date;
        updates.push('status=?');
        values.push(calcStatus(sd, ed, req.body.progress_pct));
      }
      // Auto duration
      if (req.body.start_date && req.body.end_date) {
        updates.push('duration_days=?');
        values.push(Math.ceil((new Date(req.body.end_date) - new Date(req.body.start_date)) / 86400000));
      }
      // completada → 100%, no_iniciada → 0%
      if (req.body.status === 'completada' && req.body.progress_pct === undefined) { updates.push('progress_pct=?'); values.push(100); }
      if (req.body.status === 'no_iniciada' && req.body.progress_pct === undefined) { updates.push('progress_pct=?'); values.push(0); }

      if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
      values.push(req.params.id);
      await pool.execute('UPDATE schedule_activities SET ' + updates.join(',') + ' WHERE id=?', values);
      var parentId = req.body.parent_id !== undefined ? req.body.parent_id : ex[0].parent_id;
      if (parentId) await recalcParent(parentId);
      await updateProjectProgress(req.params.projectId);
      const [rows] = await pool.execute('SELECT * FROM schedule_activities WHERE id=?', [req.params.id]);
      res.json({ data: rows[0], message: 'Actividad actualizada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Set baseline ═══
router.post('/:projectId/schedule/set-baseline', roleMiddleware('admin','director'),
  [param('projectId').isInt()], async (req, res) => {
    try {
      const [result] = await pool.execute(
        'UPDATE schedule_activities SET baseline_start=start_date, baseline_end=end_date WHERE project_id=? AND start_date IS NOT NULL',
        [req.params.projectId]);
      res.json({ message: 'Linea base fijada (' + result.affectedRows + ' actividades)', count: result.affectedRows });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Clear baseline ═══
router.post('/:projectId/schedule/clear-baseline', roleMiddleware('admin','director'),
  [param('projectId').isInt()], async (req, res) => {
    try {
      await pool.execute('UPDATE schedule_activities SET baseline_start=NULL, baseline_end=NULL WHERE project_id=?', [req.params.projectId]);
      res.json({ message: 'Linea base eliminada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Regenerate all WBS codes ═══
router.post('/:projectId/schedule/regenerate-wbs', roleMiddleware('admin','director'),
  [param('projectId').isInt()], async (req, res) => {
    try {
      var pid = req.params.projectId;
      const [rows] = await pool.execute(
        'SELECT id, parent_id FROM schedule_activities WHERE project_id=? ORDER BY sort_order, id', [pid]);
      var byParent = {};
      for (var i = 0; i < rows.length; i++) {
        var key = rows[i].parent_id || 'root';
        if (!byParent[key]) byParent[key] = [];
        byParent[key].push(rows[i]);
      }
      async function assignWBS(parentId, prefix) {
        var children = byParent[parentId || 'root'] || [];
        for (var j = 0; j < children.length; j++) {
          var wbs = prefix ? prefix + '.' + (j + 1) : String(j + 1);
          await pool.execute('UPDATE schedule_activities SET wbs_code=? WHERE id=?', [wbs, children[j].id]);
          await assignWBS(children[j].id, wbs);
        }
      }
      await assignWBS(null, '');
      res.json({ message: 'WBS regenerados (' + rows.length + ' actividades)' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Bulk reorder ═══
router.put('/:projectId/schedule/reorder', roleMiddleware('admin','director'),
  [param('projectId').isInt()], async (req, res) => {
    try {
      var items = req.body.items;
      if (!items || !items.length) return res.status(400).json({ error: 'items requeridos' });
      for (var i = 0; i < items.length; i++) {
        await pool.execute('UPDATE schedule_activities SET sort_order=? WHERE id=? AND project_id=?',
          [items[i].sort_order, items[i].id, req.params.projectId]);
      }
      res.json({ message: 'Orden actualizado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Delete (+ children cascade) ═══
router.delete('/:projectId/schedule/:id', roleMiddleware('admin'),
  [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [ex] = await pool.execute('SELECT name,parent_id FROM schedule_activities WHERE id=? AND project_id=?',
        [req.params.id, req.params.projectId]);
      if (ex.length === 0) return res.status(404).json({ error: 'No encontrada' });
      await pool.execute('DELETE FROM schedule_activities WHERE parent_id=? AND project_id=?',
        [req.params.id, req.params.projectId]);
      await pool.execute('DELETE FROM schedule_activities WHERE id=?', [req.params.id]);
      if (ex[0].parent_id) await recalcParent(ex[0].parent_id);
      await updateProjectProgress(req.params.projectId);
      res.json({ message: '"' + ex[0].name + '" eliminada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

module.exports = router;
