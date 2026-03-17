/**
 * Rutas: Compromisos de Comité
 * Compromisos generados en sesiones de comité, independientes de actas.
 * Se acumulan y muestran en cada comité posterior hasta cumplirse.
 */
const express = require('express');
const pool = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const notifier = require('../services/notifier');

const router = express.Router({ mergeParams: true }); // hereda :projectId
router.use(authMiddleware);

// ─────────────────────────────────────────────────────────────
// GET /api/committee/:projectId/commitments
// Lista todos los compromisos del proyecto
// Query params: status (pendiente|en_progreso|cumplido|cancelado|abiertos)
// ─────────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  const { projectId } = req.params;
  const { status } = req.query;

  try {
    let where = 'WHERE cc.project_id = ?';
    const params = [projectId];

    if (status === 'abiertos') {
      where += ` AND cc.status IN ('pendiente','en_progreso')`;
    } else if (status && status !== 'todos') {
      where += ` AND cc.status = ?`;
      params.push(status);
    }

    const [rows] = await pool.execute(`
      SELECT
        cc.*,
        CASE
          WHEN cc.status IN ('pendiente','en_progreso')
               AND cc.due_date < CURDATE() THEN 'vencido'
          ELSE cc.status
        END AS status_real,
        DATEDIFF(cc.due_date, CURDATE()) AS days_remaining,
        u.full_name AS created_by_name
      FROM committee_commitments cc
      LEFT JOIN users u ON cc.created_by = u.id
      ${where}
      ORDER BY
        FIELD(cc.status,'pendiente','en_progreso','cumplido','cancelado'),
        cc.due_date ASC
    `, params);

    // Estadísticas
    const [stats] = await pool.execute(`
      SELECT
        COUNT(*) AS total,
        SUM(status IN ('pendiente','en_progreso')) AS abiertos,
        SUM(status = 'pendiente') AS pendientes,
        SUM(status = 'en_progreso') AS en_progreso,
        SUM(status = 'cumplido') AS cumplidos,
        SUM(status IN ('pendiente','en_progreso') AND due_date < CURDATE()) AS vencidos
      FROM committee_commitments
      WHERE project_id = ?
    `, [projectId]);

    res.json({ data: rows, stats: stats[0] });
  } catch (err) {
    console.error('Error listando compromisos de comité:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// POST /api/committee/:projectId/commitments
// Crea uno o varios compromisos surgidos en un comité
// Body: { commitments: [...] } o un solo objeto
// ─────────────────────────────────────────────────────────────
router.post('/', async (req, res) => {
  const { projectId } = req.params;
  const userId = req.user.id;
  const body = req.body;

  // Acepta array o objeto individual
  const items = Array.isArray(body.commitments) ? body.commitments : [body];

  if (!items.length) {
    return res.status(400).json({ error: 'Se requiere al menos un compromiso' });
  }

  try {
    const created = [];
    for (const item of items) {
      const {
        description,
        responsible = null,
        due_date = null,
        priority = 'media',
        origin_date,
        committee_type = 'comite_seguimiento',
        notes = null,
      } = item;

      if (!description || !description.trim()) continue;
      if (!origin_date) return res.status(400).json({ error: 'origin_date es requerido' });

      const [result] = await pool.execute(`
        INSERT INTO committee_commitments
          (project_id, description, responsible, due_date, priority,
           origin_date, committee_type, notes, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pendiente', ?)
      `, [projectId, description.trim(), responsible, due_date, priority,
          origin_date, committee_type, notes, userId]);

      const [newRow] = await pool.execute(
        'SELECT * FROM committee_commitments WHERE id = ?', [result.insertId]
      );
      created.push(newRow[0]);
    }

    // Notify for each created commitment (fire-and-forget)
    const [proj] = await pool.execute('SELECT code, name FROM projects WHERE id = ?', [projectId]);
    for (const c of created) {
      notifier.notify('commitment.created', {
        project_id: Number(projectId),
        project_code: proj[0]?.code || '',
        project_name: proj[0]?.name || '',
        description: c.description,
        responsible: c.responsible,
        due_date: c.due_date,
        priority: c.priority,
      }).catch(() => {});
    }

    res.status(201).json({ data: created, message: `${created.length} compromiso(s) creado(s)` });
  } catch (err) {
    console.error('Error creando compromiso de comité:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// PUT /api/committee/:projectId/commitments/:id
// Actualiza estado, notas, evidencia, fecha cumplimiento, etc.
// ─────────────────────────────────────────────────────────────
router.put('/:id', async (req, res) => {
  const { projectId, id } = req.params;
  const {
    description,
    responsible,
    due_date,
    status,
    priority,
    notes,
    evidence,
    completed_date,
    committee_type,
  } = req.body;

  try {
    // Verificar que el compromiso pertenece al proyecto
    const [existing] = await pool.execute(
      'SELECT id FROM committee_commitments WHERE id = ? AND project_id = ?',
      [id, projectId]
    );
    if (!existing.length) return res.status(404).json({ error: 'Compromiso no encontrado' });

    // Si marca como cumplido, registrar fecha
    const finalCompletedDate = status === 'cumplido'
      ? (completed_date || new Date().toISOString().split('T')[0])
      : (status === 'pendiente' || status === 'en_progreso' ? null : completed_date);

    await pool.execute(`
      UPDATE committee_commitments SET
        description    = COALESCE(?, description),
        responsible    = COALESCE(?, responsible),
        due_date       = COALESCE(?, due_date),
        status         = COALESCE(?, status),
        priority       = COALESCE(?, priority),
        notes          = COALESCE(?, notes),
        evidence       = COALESCE(?, evidence),
        completed_date = ?,
        committee_type = COALESCE(?, committee_type),
        updated_at     = NOW()
      WHERE id = ? AND project_id = ?
    `, [description, responsible, due_date, status, priority, notes, evidence,
        finalCompletedDate, committee_type, id, projectId]);

    const [updated] = await pool.execute(
      'SELECT * FROM committee_commitments WHERE id = ?', [id]
    );

    res.json({ data: updated[0], message: 'Compromiso actualizado' });
  } catch (err) {
    console.error('Error actualizando compromiso de comité:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// DELETE /api/committee/:projectId/commitments/:id
// ─────────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  const { projectId, id } = req.params;

  try {
    const [existing] = await pool.execute(
      'SELECT id FROM committee_commitments WHERE id = ? AND project_id = ?',
      [id, projectId]
    );
    if (!existing.length) return res.status(404).json({ error: 'Compromiso no encontrado' });

    await pool.execute('DELETE FROM committee_commitments WHERE id = ?', [id]);
    res.json({ message: 'Compromiso eliminado' });
  } catch (err) {
    console.error('Error eliminando compromiso de comité:', err);
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────
// GET /api/committee/:projectId/commitments/pending-for-session
// Compromisos abiertos para mostrar al iniciar un nuevo comité
// ─────────────────────────────────────────────────────────────
router.get('/pending-for-session', async (req, res) => {
  const { projectId } = req.params;

  try {
    const [rows] = await pool.execute(`
      SELECT
        cc.*,
        CASE
          WHEN cc.due_date < CURDATE() THEN 'vencido'
          WHEN cc.due_date = CURDATE() THEN 'vence_hoy'
          WHEN DATEDIFF(cc.due_date, CURDATE()) <= 7 THEN 'por_vencer'
          ELSE 'vigente'
        END AS urgencia,
        DATEDIFF(cc.due_date, CURDATE()) AS days_remaining,
        DATEDIFF(CURDATE(), cc.origin_date) AS days_open
      FROM committee_commitments cc
      WHERE cc.project_id = ?
        AND cc.status IN ('pendiente','en_progreso')
      ORDER BY cc.due_date ASC, cc.priority = 'alta' DESC
    `, [projectId]);

    res.json({ data: rows, total: rows.length });
  } catch (err) {
    console.error('Error obteniendo compromisos pendientes:', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
