/**
 * GET /api/notifications
 *
 * Returns aggregated system alerts visible to the current user:
 *   - Overdue commitments (due_date < today, not completed/cancelled)
 *   - Payments pending action (not yet paid)
 */
const express = require('express');
const router  = express.Router();
const { authMiddleware: authenticate } = require('../middleware/auth');
const { getVisibleProjectIds, normalizeRole } = require('../middleware/auth');
const db = require('../config/database');

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/notifications
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authenticate, async (req, res) => {
  try {
    const role       = normalizeRole(req.user.role);
    const projectIds = await getVisibleProjectIds(req.user.id, role);

    // Build a project filter clause
    // null = user sees all projects (admin / director_pmo / ceo)
    const projectFilter  = projectIds === null ? '' : 'AND p.id IN (?)';
    const projectArgs    = projectIds === null ? [] : [projectIds.length ? projectIds : [0]];

    const items = [];

    // ── 1. Overdue commitments ──────────────────────────────────────────────
    try {
      const [commitments] = await db.execute(
        `SELECT
           cc.id,
           cc.description,
           cc.due_date,
           cc.priority,
           cc.responsible,
           p.id   AS project_id,
           p.code AS project_code,
           p.name AS project_name,
           DATEDIFF(CURDATE(), cc.due_date) AS days_overdue
         FROM committee_commitments cc
         JOIN projects p ON p.id = cc.project_id
         WHERE cc.due_date < CURDATE()
           AND cc.status NOT IN ('cumplido', 'cancelado')
           ${projectFilter}
         ORDER BY cc.due_date ASC
         LIMIT 15`,
        projectArgs
      );

      for (const r of commitments) {
        items.push({
          type:         'commitment_overdue',
          id:           `c_${r.id}`,
          title:        r.description,
          project_code: r.project_code,
          project_name: r.project_name,
          project_id:   r.project_id,
          due_date:     r.due_date,
          days_overdue: r.days_overdue,
          priority:     r.priority,
          responsible:  r.responsible,
        });
      }
    } catch (e) {
      // Table might not exist in all environments — skip silently
      if (process.env.NODE_ENV !== 'production') console.warn('[notifications] commitments query:', e.message);
    }

    // ── 2. Payments pending (not paid, not cancelled) ───────────────────────
    try {
      const [payments] = await db.execute(
        `SELECT
           pay.id,
           pay.concept,
           pay.status,
           pay.net_value,
           pay.period_to,
           p.id   AS project_id,
           p.code AS project_code,
           p.name AS project_name
         FROM payments pay
         JOIN projects p ON p.id = pay.project_id
         WHERE pay.status IN ('borrador', 'en_revision', 'aprobado')
           ${projectFilter}
         ORDER BY pay.period_to ASC
         LIMIT 10`,
        projectArgs
      );

      const STATUS_LABEL = {
        borrador:    'Borrador',
        en_revision: 'En revisión',
        aprobado:    'Aprobado',
      };

      for (const r of payments) {
        items.push({
          type:         'payment_pending',
          id:           `p_${r.id}`,
          title:        r.concept || `Pago ${r.project_code}`,
          project_code: r.project_code,
          project_name: r.project_name,
          project_id:   r.project_id,
          status_label: STATUS_LABEL[r.status] || r.status,
          net_value:    r.net_value,
          period_to:    r.period_to,
        });
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.warn('[notifications] payments query:', e.message);
    }

    res.json({
      success: true,
      total:   items.length,
      data:    items,
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
