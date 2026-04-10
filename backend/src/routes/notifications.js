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

    // ── 3. Expiring / expired policies ─────────────────────────────────────
    try {
      const [policies] = await db.execute(
        `SELECT pol.id, pol.policy_type, pol.policy_number, pol.expiry_date, pol.insurer,
                p.id AS project_id, p.code AS project_code, p.name AS project_name,
                DATEDIFF(pol.expiry_date, CURDATE()) AS days_until
         FROM policies pol
         JOIN projects p ON p.id = pol.project_id
         WHERE pol.status NOT IN ('inactiva', 'cancelada')
           AND p.status NOT IN ('cerrado', 'liquidado')
           AND pol.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY)
           ${projectFilter}
         ORDER BY pol.expiry_date ASC
         LIMIT 20`,
        projectArgs
      );
      for (const r of policies) {
        const isExpired = r.days_until < 0;
        items.push({
          type:         isExpired ? 'policy_expired' : 'policy_expiring',
          id:           `pol_${r.id}`,
          title:        `Póliza ${r.policy_type}${r.policy_number ? ' No. ' + r.policy_number : ''}${r.insurer ? ' — ' + r.insurer : ''}`,
          project_code: r.project_code,
          project_name: r.project_name,
          project_id:   r.project_id,
          days_until:   r.days_until,
          expiry_date:  r.expiry_date,
        });
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.warn('[notifications] policies query:', e.message);
    }

    // ── 4. Contracts ending soon (≤60 days) or overdue ──────────────────────
    try {
      const [contracts] = await db.execute(
        `SELECT p.id, p.name, p.code, p.execution_term, p.execution_term_unit,
                CASE
                  WHEN p.execution_term_unit = 'dias'  THEN DATE_ADD(p.start_date, INTERVAL p.execution_term DAY)
                  WHEN p.execution_term_unit = 'meses' THEN DATE_ADD(p.start_date, INTERVAL p.execution_term MONTH)
                  WHEN p.execution_term_unit = 'años'  THEN DATE_ADD(p.start_date, INTERVAL p.execution_term YEAR)
                  ELSE DATE_ADD(p.start_date, INTERVAL p.execution_term DAY)
                END AS end_date
         FROM projects p
         WHERE p.status IN ('en_ejecucion', 'adjudicado')
           AND p.start_date IS NOT NULL AND p.execution_term IS NOT NULL
           ${projectFilter}
         HAVING DATEDIFF(end_date, CURDATE()) BETWEEN -30 AND 60
         ORDER BY end_date ASC
         LIMIT 10`,
        projectArgs
      );
      for (const r of contracts) {
        const daysUntil = r.days_until !== undefined ? r.days_until
          : Math.round((new Date(r.end_date) - new Date()) / 86400000);
        items.push({
          type:         daysUntil < 0 ? 'contract_overdue' : 'contract_ending',
          id:           `proj_end_${r.id}`,
          title:        r.name,
          project_code: r.code,
          project_name: r.name,
          project_id:   r.id,
          days_until:   daysUntil,
          end_date:     r.end_date,
        });
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.warn('[notifications] contracts query:', e.message);
    }

    // ── 5. Overdue milestones with incomplete deliverables ──────────────────
    try {
      const [milestones] = await db.execute(
        `SELECT m.id, m.name, m.end_date,
                p.id AS project_id, p.code AS project_code, p.name AS project_name,
                DATEDIFF(CURDATE(), m.end_date) AS days_overdue,
                COUNT(d.id) AS total_del,
                SUM(CASE WHEN d.status = 'completado' THEN 1 ELSE 0 END) AS done_del
         FROM milestones m
         JOIN projects p ON p.id = m.project_id
         LEFT JOIN deliverables d ON d.milestone_id = m.id AND d.status != 'cancelado'
         WHERE m.end_date < CURDATE()
           AND m.status NOT IN ('completado', 'cancelado')
           AND p.status NOT IN ('cerrado', 'liquidado')
           ${projectFilter}
         GROUP BY m.id
         HAVING total_del > 0 AND done_del < total_del
         ORDER BY m.end_date ASC
         LIMIT 10`,
        projectArgs
      );
      for (const r of milestones) {
        items.push({
          type:         'milestone_overdue',
          id:           `m_${r.id}`,
          title:        r.name,
          project_code: r.project_code,
          project_name: r.project_name,
          project_id:   r.project_id,
          days_overdue: r.days_overdue,
          done_del:     Number(r.done_del),
          total_del:    Number(r.total_del),
          end_date:     r.end_date,
        });
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.warn('[notifications] milestones query:', e.message);
    }

    // ── 6. Correspondencia próxima a vencer (≤3 días) ──────────────────────
    try {
      const [corrWarning] = await db.execute(
        `SELECT c.id, c.subject, c.consecutive_code, c.radicado_number,
                c.fecha_limite, c.correspondence_type, c.status,
                p.id   AS project_id,
                p.code AS project_code,
                p.name AS project_name,
                DATEDIFF(c.fecha_limite, CURDATE()) AS days_until
         FROM correspondence c
         JOIN projects p ON p.id = c.project_id
         WHERE c.direction = 'entrada'
           AND c.fecha_limite IS NOT NULL
           AND c.fecha_limite >= CURDATE()
           AND DATEDIFF(c.fecha_limite, CURDATE()) <= 3
           AND c.status NOT IN ('respondido', 'archivado', 'cerrado')
           AND p.status NOT IN ('cerrado', 'liquidado')
           ${projectFilter}
         ORDER BY c.fecha_limite ASC
         LIMIT 20`,
        projectArgs
      );

      for (const r of corrWarning) {
        items.push({
          type:         'correspondence_deadline_warning',
          id:           `cw_${r.id}`,
          title:        r.radicado_number ? `Radicado ${r.radicado_number}` : (r.subject || `Correspondencia ${r.consecutive_code}`),
          subtitle:     r.subject || '',
          project_code: r.project_code,
          project_name: r.project_name,
          project_id:   r.project_id,
          days_until:   r.days_until,
          fecha_limite: r.fecha_limite,
          corr_type:    r.correspondence_type,
        });
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.warn('[notifications] corr warning query:', e.message);
    }

    // ── 7. Correspondencia fuera de plazo ───────────────────────────────────
    try {
      const [corrOverdue] = await db.execute(
        `SELECT c.id, c.subject, c.consecutive_code, c.radicado_number,
                c.fecha_limite, c.correspondence_type, c.status,
                p.id   AS project_id,
                p.code AS project_code,
                p.name AS project_name,
                DATEDIFF(CURDATE(), c.fecha_limite) AS days_overdue
         FROM correspondence c
         JOIN projects p ON p.id = c.project_id
         WHERE c.direction = 'entrada'
           AND c.fecha_limite IS NOT NULL
           AND c.fecha_limite < CURDATE()
           AND c.status NOT IN ('respondido', 'archivado', 'cerrado')
           AND p.status NOT IN ('cerrado', 'liquidado')
           ${projectFilter}
         ORDER BY c.fecha_limite ASC
         LIMIT 20`,
        projectArgs
      );

      for (const r of corrOverdue) {
        items.push({
          type:         'correspondence_overdue',
          id:           `co_${r.id}`,
          title:        r.radicado_number ? `Radicado ${r.radicado_number}` : (r.subject || `Correspondencia ${r.consecutive_code}`),
          subtitle:     r.subject || '',
          project_code: r.project_code,
          project_name: r.project_name,
          project_id:   r.project_id,
          days_overdue: r.days_overdue,
          fecha_limite: r.fecha_limite,
          corr_type:    r.correspondence_type,
        });
      }
    } catch (e) {
      if (process.env.NODE_ENV !== 'production') console.warn('[notifications] corr overdue query:', e.message);
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
