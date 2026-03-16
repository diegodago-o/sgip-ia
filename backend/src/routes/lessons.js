const express = require('express');
const { param, body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware, projectAccessMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
// Verify user has access to the project
router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch(e) { next(e); }
});
function validate(req, res) { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; }

// ═══ List ═══
router.get('/:projectId/lessons', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT l.*, u.full_name as reported_by_name
      FROM lessons_learned l LEFT JOIN users u ON l.reported_by = u.id
      WHERE l.project_id = ? ORDER BY l.created_at DESC`, [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Stats ═══
router.get('/:projectId/lessons/stats', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT COUNT(*) as total,
        SUM(lesson_type='positiva') as positivas,
        SUM(lesson_type='negativa') as negativas,
        SUM(lesson_type='mejora') as mejoras
      FROM lessons_learned WHERE project_id=?`, [req.params.projectId]);
    // By category
    const [cats] = await pool.execute(`
      SELECT category, COUNT(*) as count FROM lessons_learned
      WHERE project_id=? GROUP BY category ORDER BY count DESC`, [req.params.projectId]);
    rows[0].by_category = cats;
    res.json({ data: rows[0] });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Global search across all projects ═══
router.get('/lessons/search', async (req, res) => {
  try {
    const q = req.query.q || '';
    const cat = req.query.category || '';
    let where = ['1=1']; let params = [];
    if (q) { where.push('(l.title LIKE ? OR l.situation LIKE ? OR l.recommendation LIKE ?)'); const s = `%${q}%`; params.push(s, s, s); }
    if (cat) { where.push('l.category = ?'); params.push(cat); }
    const [rows] = await pool.execute(`
      SELECT l.*, u.full_name as reported_by_name, p.code as project_code, p.name as project_name
      FROM lessons_learned l
      LEFT JOIN users u ON l.reported_by = u.id
      LEFT JOIN projects p ON l.project_id = p.id
      WHERE ${where.join(' AND ')}
      ORDER BY l.created_at DESC LIMIT 50`, params);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Create ═══
router.post('/:projectId/lessons', roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), body('title').trim().notEmpty(), body('situation').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body; const pid = req.params.projectId;
      const [r] = await pool.execute(
        `INSERT INTO lessons_learned (project_id,category,lesson_type,title,situation,action_taken,result,recommendation,impact_area,reported_by)
         VALUES (?,?,?,?,?,?,?,?,?,?)`,
        [pid, b.category || 'gestion', b.lesson_type || 'mejora', b.title, b.situation,
          b.action_taken || null, b.result || null, b.recommendation || null, b.impact_area || null, req.user.id]);
      const [rows] = await pool.execute('SELECT * FROM lessons_learned WHERE id=?', [r.insertId]);
      res.status(201).json({ data: rows[0], message: 'Lección registrada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Update ═══
router.put('/:projectId/lessons/:id', roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const allowed = ['category', 'lesson_type', 'title', 'situation', 'action_taken', 'result', 'recommendation', 'impact_area'];
      const updates = []; const values = [];
      allowed.forEach(f => { if (req.body[f] !== undefined) { updates.push(`${f}=?`); values.push(req.body[f] === '' ? null : req.body[f]); } });
      if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
      values.push(req.params.id);
      values.push(req.params.projectId);
      await pool.execute(`UPDATE lessons_learned SET ${updates.join(',')} WHERE id=? AND project_id=?`, values);
      const [rows] = await pool.execute('SELECT * FROM lessons_learned WHERE id=?', [req.params.id]);
      res.json({ data: rows[0], message: 'Actualizada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Delete ═══
router.delete('/:projectId/lessons/:id', roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt(), param('id').isInt()], async (req, res) => {
    if (!validate(req, res)) return;
    try {
      await pool.execute('DELETE FROM lessons_learned WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      res.json({ message: 'Lección eliminada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

module.exports = router;
