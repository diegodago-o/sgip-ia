const express = require('express');
const { body, query, param, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware, getVisibleProjectIds } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);

// ── Helpers ──
async function generateCode(projectType) {
  const prefixMap = {
    obra_civil: 'OC', ti: 'TI', consultoria: 'CON',
    interventoria: 'INT', asesoria: 'ASE', mixto: 'MIX', otro: 'OTR',
  };
  const prefix = prefixMap[projectType] || 'PRJ';
  const year = new Date().getFullYear();
  const [rows] = await pool.execute(
    'SELECT COUNT(*) as count FROM projects WHERE code LIKE ?',
    [`${prefix}-${year}-%`]
  );
  const seq = String((rows[0].count || 0) + 1).padStart(3, '0');
  return `${prefix}-${year}-${seq}`;
}

function calcEndDate(startDate, term, unit) {
  if (!startDate || !term) return null;
  const d = new Date(startDate);
  switch (unit) {
    case 'meses': d.setMonth(d.getMonth() + term); break;
    case 'anos': d.setFullYear(d.getFullYear() + term); break;
    case 'dias_habiles': d.setDate(d.getDate() + Math.ceil(term * 1.4)); break;
    default: d.setDate(d.getDate() + term);
  }
  return d.toISOString().split('T')[0];
}

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return false; }
  return true;
}

// ═══ GET /api/projects/options/directors ═══
router.get('/options/directors', async (_req, res) => {
  try {
    const [rows] = await pool.execute(
      "SELECT id, full_name, email FROM users WHERE role IN ('admin','gerente_proyecto','director_pmo') AND is_active = 1 ORDER BY full_name"
    );
    res.json({ data: rows });
  } catch (err) { res.status(500).json({ error: 'Error obteniendo directores' }); }
});

// ═══ GET /api/projects/summary ═══
router.get('/summary', async (req, res) => {
  try {
    // Role-based filtering
    const visibleIds = await getVisibleProjectIds(req.user.id, req.user.role);
    let projectFilter = '';
    let filterParams = [];
    if (visibleIds !== null) {
      if (visibleIds.length === 0) {
        return res.json({ total_projects: 0, adjudicado: 0, en_arranque: 0, in_execution: 0, completed: 0, suspended: 0, total_value: 0, avg_progress: 0, overdue_obligations: 0, expiring_policies: 0, team_members: 0, by_type: [], by_status: [], by_sector: [] });
      }
      projectFilter = `WHERE id IN (${visibleIds.map(() => '?').join(',')})`;
      filterParams = [...visibleIds];
    }

    const [stats] = await pool.execute(`
      SELECT
        COUNT(*) as total_projects,
        SUM(status = 'adjudicado') as adjudicado,
        SUM(status = 'en_arranque') as en_arranque,
        SUM(status = 'en_ejecucion') as en_ejecucion,
        SUM(status IN ('cerrado','liquidado')) as completados,
        SUM(status = 'suspendido') as suspendidos,
        COALESCE(SUM(contract_value), 0) as total_value,
        COALESCE(AVG(progress_pct), 0) as avg_progress
      FROM projects ${projectFilter}
    `, filterParams);

    let overdue = 0, expiring = 0, members = 0;
    try {
      const [ob] = await pool.execute("SELECT COUNT(*) as c FROM obligations WHERE status = 'vencida'");
      overdue = ob[0].c;
    } catch {}
    try {
      const [po] = await pool.execute("SELECT COUNT(*) as c FROM policies WHERE status = 'por_vencer'");
      expiring = po[0].c;
    } catch {}
    try {
      const [tm] = await pool.execute("SELECT COUNT(*) as c FROM team_members WHERE status = 'activo'");
      members = tm[0].c;
    } catch {}

    const [byType] = await pool.execute('SELECT project_type as name, COUNT(*) as value FROM projects GROUP BY project_type ORDER BY value DESC');
    const [byStatus] = await pool.execute("SELECT status as name, COUNT(*) as value FROM projects GROUP BY status");
    const [bySector] = await pool.execute('SELECT sector as name, COUNT(*) as value FROM projects GROUP BY sector');

    const s = stats[0];
    res.json({
      total_projects: s.total_projects || 0,
      adjudicado: s.adjudicado || 0,
      en_arranque: s.en_arranque || 0,
      in_execution: s.en_ejecucion || 0,
      completed: s.completados || 0,
      suspended: s.suspendidos || 0,
      total_value: parseFloat(s.total_value) || 0,
      avg_progress: parseFloat(s.avg_progress) || 0,
      overdue_obligations: overdue,
      expiring_policies: expiring,
      team_members: members,
      by_type: byType,
      by_status: byStatus,
      by_sector: bySector,
    });
  } catch (err) {
    console.error('Summary error:', err);
    res.status(500).json({ error: 'Error obteniendo resumen' });
  }
});

// ═══ GET /api/projects ═══
router.get('/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isString(),
    query('sector').optional().isIn(['publico', 'privado', '']),
    query('project_type').optional().isString(),
    query('priority').optional().isIn(['alta', 'media', 'baja', '']),
    query('search').optional().isString(),
    query('sort').optional().isString(),
    query('order').optional().isIn(['asc', 'desc']),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const page = parseInt(req.query.page) || 1;
      const limit = parseInt(req.query.limit) || 20;
      const offset = (page - 1) * limit;

      let where = ['1=1'];
      let params = [];

      // Role-based filtering: GP and Apoyo only see assigned projects
      const visibleIds = await getVisibleProjectIds(req.user.id, req.user.role);
      if (visibleIds !== null) {
        if (visibleIds.length === 0) return res.json({ data: [], pagination: { page, limit, total: 0, pages: 0 } });
        where.push(`p.id IN (${visibleIds.map(() => '?').join(',')})`);
        params.push(...visibleIds);
      }

      if (req.query.status) { where.push('p.status = ?'); params.push(req.query.status); }
      if (req.query.sector) { where.push('p.sector = ?'); params.push(req.query.sector); }
      if (req.query.project_type) { where.push('p.project_type = ?'); params.push(req.query.project_type); }
      if (req.query.priority) { where.push('p.priority = ?'); params.push(req.query.priority); }
      if (req.query.search) {
        where.push('(p.name LIKE ? OR p.code LIKE ? OR p.client_name LIKE ? OR p.contract_number LIKE ?)');
        const s = `%${req.query.search}%`;
        params.push(s, s, s, s);
      }

      const wc = where.join(' AND ');
      const sortMap = { code:'p.code', name:'p.name', status:'p.status', priority:'p.priority', contract_value:'p.contract_value', start_date:'p.start_date', progress_pct:'p.progress_pct', created_at:'p.created_at' };
      const sortCol = sortMap[req.query.sort] || 'p.created_at';
      const sortOrder = req.query.order === 'asc' ? 'ASC' : 'DESC';

      const [countRows] = await pool.execute(`SELECT COUNT(*) as total FROM projects p WHERE ${wc}`, params);
      const total = countRows[0].total;

      const [rows] = await pool.execute(
        `SELECT p.*, u.full_name as director_name FROM projects p LEFT JOIN users u ON p.director_id = u.id WHERE ${wc} ORDER BY ${sortCol} ${sortOrder} LIMIT ${limit} OFFSET ${offset}`,
        params
      );

      res.json({ data: rows, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
    } catch (err) {
      console.error('List error:', err);
      res.status(500).json({ error: 'Error listando proyectos' });
    }
  }
);

// ═══ GET /api/projects/:id ═══
router.get('/:id', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  // Check project access for non-admin roles
  const visibleIds = await getVisibleProjectIds(req.user.id, req.user.role);
  if (visibleIds !== null && !visibleIds.includes(parseInt(req.params.id))) {
    return res.status(403).json({ error: 'No tiene acceso a este proyecto' });
  }
  try {
    const [rows] = await pool.execute(
      'SELECT p.*, u.full_name as director_name, u.email as director_email FROM projects p LEFT JOIN users u ON p.director_id = u.id WHERE p.id = ?',
      [req.params.id]
    );
    if (rows.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

    const project = rows[0];

    // Counts
    const countQueries = [
      ['documents', 'documents'], ['obligations', 'obligations'], ['deliverables', 'deliverables'],
      ['milestones', 'milestones'], ['policies', 'policies'], ['budget_items', 'budget_items'],
    ];
    const counts = {};
    for (const [table, key] of countQueries) {
      try {
        const [c] = await pool.execute(`SELECT COUNT(*) as n FROM ${table} WHERE project_id = ?`, [req.params.id]);
        counts[key] = c[0].n;
      } catch { counts[key] = 0; }
    }
    try {
      const [c] = await pool.execute("SELECT COUNT(*) as n FROM team_members WHERE project_id = ? AND status = 'activo'", [req.params.id]);
      counts.team_members = c[0].n;
    } catch { counts.team_members = 0; }

    project.counts = counts;

    // Tags
    try {
      const [tags] = await pool.execute('SELECT tag FROM project_tags WHERE project_id = ?', [req.params.id]);
      project.tags = tags.map(t => t.tag);
    } catch { project.tags = []; }

    res.json({ data: project });
  } catch (err) {
    console.error('Detail error:', err);
    res.status(500).json({ error: 'Error obteniendo proyecto' });
  }
});

// ═══ POST /api/projects ═══
router.post('/',
  roleMiddleware('admin', 'gerente_proyecto'),
  [
    body('name').trim().notEmpty().withMessage('Nombre requerido'),
    body('project_type').isIn(['obra_civil','ti','consultoria','interventoria','asesoria','mixto','otro']),
    body('sector').isIn(['publico','privado']),
    body('client_name').trim().notEmpty().withMessage('Cliente requerido'),
    body('priority').optional().isIn(['alta','media','baja']),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const code = await generateCode(req.body.project_type);
      const estimated_end_date = calcEndDate(req.body.start_date, parseInt(req.body.execution_term), req.body.execution_term_unit || 'dias_calendario');

      const fields = {
        code, name: req.body.name, project_type: req.body.project_type,
        sector: req.body.sector, client_name: req.body.client_name,
        client_nit: req.body.client_nit || null,
        contract_number: req.body.contract_number || null,
        contract_object: req.body.contract_object || null,
        contract_value: req.body.contract_value || null,
        sign_date: req.body.sign_date || null,
        start_date: req.body.start_date || null,
        execution_term: req.body.execution_term || null,
        execution_term_unit: req.body.execution_term_unit || 'dias_calendario',
        estimated_end_date,
        supervisor: req.body.supervisor || null,
        director_id: req.body.director_id || null,
        location: req.body.location || null,
        status: 'adjudicado',
        priority: req.body.priority || 'media',
        selection_process: req.body.selection_process || null,
        secop_number: req.body.secop_number || null,
        cdp_number: req.body.cdp_number || null,
        rp_number: req.body.rp_number || null,
        sharepoint_folder: req.body.sharepoint_folder || null,
        created_by: req.user.id,
      };

      const cols = Object.keys(fields);
      const ph = cols.map(() => '?').join(',');
      const [result] = await pool.execute(`INSERT INTO projects (${cols.join(',')}) VALUES (${ph})`, Object.values(fields));

      if (req.body.tags && req.body.tags.length > 0) {
        for (const tag of req.body.tags) {
          await pool.execute('INSERT IGNORE INTO project_tags (project_id, tag) VALUES (?,?)', [result.insertId, tag.trim()]);
        }
      }

      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'create', 'project', result.insertId, JSON.stringify({ code })]
      );

      const [rows] = await pool.execute(
        'SELECT p.*, u.full_name as director_name FROM projects p LEFT JOIN users u ON p.director_id = u.id WHERE p.id = ?',
        [result.insertId]
      );

      res.status(201).json({ data: rows[0], message: `Proyecto ${code} creado exitosamente` });
    } catch (err) {
      console.error('Create error:', err);
      if (err.code === 'ER_DUP_ENTRY') return res.status(409).json({ error: 'Código duplicado' });
      res.status(500).json({ error: 'Error creando proyecto' });
    }
  }
);

// ═══ PUT /api/projects/:id ═══
router.put('/:id',
  roleMiddleware('admin', 'gerente_proyecto'),
  [param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [existing] = await pool.execute('SELECT * FROM projects WHERE id = ?', [req.params.id]);
      if (existing.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

      const allowed = [
        'name','project_type','sector','client_name','client_nit','contract_number',
        'contract_object','contract_value','sign_date','start_date','execution_term',
        'execution_term_unit','supervisor','director_id','location','status','priority',
        'progress_pct','selection_process','secop_number','cdp_number','rp_number',
        'sharepoint_folder',
      ];

      const updates = [];
      const values = [];
      for (const f of allowed) {
        if (req.body[f] !== undefined) { updates.push(`${f} = ?`); values.push(req.body[f]); }
      }

      if (req.body.start_date || req.body.execution_term || req.body.execution_term_unit) {
        const p = existing[0];
        const newEnd = calcEndDate(
          req.body.start_date || p.start_date,
          parseInt(req.body.execution_term || p.execution_term),
          req.body.execution_term_unit || p.execution_term_unit
        );
        if (newEnd) { updates.push('estimated_end_date = ?'); values.push(newEnd); }
      }

      if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

      values.push(req.params.id);
      await pool.execute(`UPDATE projects SET ${updates.join(',')} WHERE id = ?`, values);

      // ── Propagate contract_value change to budget ──
      if (req.body.contract_value !== undefined) {
        const pid = parseInt(req.params.id);
        const oldCV = parseFloat(existing[0].contract_value || 0);
        const newCV = parseFloat(req.body.contract_value || 0);

        if (oldCV !== newCV && newCV > 0) {
          const newIVA = newCV * 0.19;
          const newTotal = newCV + newIVA;
          const ratio = oldCV > 0 ? newCV / oldCV : 1;
          const ratioTotal = oldCV > 0 ? newTotal / (oldCV + oldCV * 0.19) : 1;

          // Update budget_income rows (created by /init)
          try {
            await pool.execute(
              "UPDATE budget_income SET value=? WHERE project_id=? AND label LIKE '%Contrato sin IVA%'",
              [newCV, pid]
            );
            await pool.execute(
              "UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%IVA Generado%' OR (es_iva=1))",
              [newIVA, pid]
            );
            await pool.execute(
              "UPDATE budget_income SET value=? WHERE project_id=? AND (label LIKE '%con IVA%' OR es_total_con_iva=1)",
              [newTotal, pid]
            );
          } catch (budgetErr) {
            console.warn('Budget income update (non-critical):', budgetErr.message);
          }

          // Proportionally update budget_income_schedule (monthly distribution)
          try {
            const [schedRows] = await pool.execute(
              'SELECT id FROM budget_income_schedule WHERE project_id=?', [pid]
            );
            if (schedRows.length > 0) {
              await pool.execute(
                `UPDATE budget_income_schedule SET
                  valor_sin_iva = ROUND(valor_sin_iva * ?, 2),
                  valor_iva = ROUND(valor_iva * ?, 2),
                  valor_con_iva = ROUND(valor_con_iva * ?, 2)
                 WHERE project_id=?`,
                [ratio, ratio, ratio, pid]
              );
            }
          } catch (schedErr) {
            console.warn('Income schedule update (non-critical):', schedErr.message);
          }

          console.log(`📊 Contract value propagated: ${oldCV} → ${newCV} for project ${pid}`);
        }
      }

      if (req.body.tags !== undefined) {
        await pool.execute('DELETE FROM project_tags WHERE project_id = ?', [req.params.id]);
        for (const tag of (req.body.tags || [])) {
          await pool.execute('INSERT IGNORE INTO project_tags (project_id, tag) VALUES (?,?)', [req.params.id, tag.trim()]);
        }
      }

      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'update', 'project', parseInt(req.params.id), JSON.stringify(req.body)]
      );

      const [rows] = await pool.execute(
        'SELECT p.*, u.full_name as director_name FROM projects p LEFT JOIN users u ON p.director_id = u.id WHERE p.id = ?',
        [req.params.id]
      );
      res.json({ data: rows[0], message: 'Proyecto actualizado' });
    } catch (err) {
      console.error('Update error:', err);
      res.status(500).json({ error: 'Error actualizando proyecto' });
    }
  }
);

// ═══ DELETE /api/projects/:id ═══
router.delete('/:id',
  roleMiddleware('admin'),
  [param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [existing] = await pool.execute('SELECT code FROM projects WHERE id = ?', [req.params.id]);
      if (existing.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

      await pool.execute('DELETE FROM projects WHERE id = ?', [req.params.id]);
      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'delete', 'project', parseInt(req.params.id), JSON.stringify({ code: existing[0].code })]
      );
      res.json({ message: `Proyecto ${existing[0].code} eliminado` });
    } catch (err) {
      console.error('Delete error:', err);
      res.status(500).json({ error: 'Error eliminando proyecto' });
    }
  }
);

// ═══════════════════════════════════════════════
// POST /api/projects/:id/change-status
// Managed status transitions with validation
// ═══════════════════════════════════════════════
const STATUS_LABELS = {
  adjudicado: 'Adjudicado', en_arranque: 'En Arranque', en_ejecucion: 'En Ejecución',
  suspendido: 'Suspendido', cerrado: 'Cerrado', liquidado: 'Liquidado',
};

// Valid manual transitions: from → [allowed targets]
const TRANSITIONS = {
  adjudicado: ['en_arranque'],
  en_arranque: ['en_ejecucion', 'suspendido'],
  en_ejecucion: ['suspendido', 'cerrado'],
  suspendido: ['en_ejecucion', 'cerrado'],
  cerrado: ['liquidado'],
  liquidado: [],
};

router.post('/:id/change-status',
  roleMiddleware('admin', 'gerente_proyecto'),
  [param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { new_status, reason } = req.body;
      if (!new_status || !STATUS_LABELS[new_status]) {
        return res.status(400).json({ error: 'Estado inválido' });
      }

      const [proj] = await pool.execute('SELECT id, code, name, status FROM projects WHERE id=?', [req.params.id]);
      if (!proj.length) return res.status(404).json({ error: 'Proyecto no encontrado' });
      const p = proj[0];

      const allowed = TRANSITIONS[p.status] || [];
      if (!allowed.includes(new_status)) {
        return res.status(400).json({
          error: `No se puede pasar de "${STATUS_LABELS[p.status]}" a "${STATUS_LABELS[new_status]}". Transiciones permitidas: ${allowed.map(s => STATUS_LABELS[s]).join(', ') || 'ninguna'}`,
        });
      }

      await pool.execute('UPDATE projects SET status=? WHERE id=?', [new_status, req.params.id]);

      // Audit
      await pool.execute(
        'INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
        [req.user.id, 'change_status', 'project', p.id,
          JSON.stringify({ from: p.status, to: new_status, reason: reason || '' })]
      );

      const [updated] = await pool.execute('SELECT * FROM projects WHERE id=?', [req.params.id]);
      res.json({
        data: updated[0],
        message: `Estado cambiado: ${STATUS_LABELS[p.status]} → ${STATUS_LABELS[new_status]}`,
      });
    } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Error' }); }
  }
);

// ═══ Get status info (current + allowed transitions) ═══
router.get('/:id/status-info', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [proj] = await pool.execute('SELECT id, status FROM projects WHERE id=?', [req.params.id]);
    if (!proj.length) return res.status(404).json({ error: 'No encontrado' });
    const current = proj[0].status;
    const allowed = (TRANSITIONS[current] || []).map(s => ({ value: s, label: STATUS_LABELS[s] }));
    res.json({ data: { current, label: STATUS_LABELS[current], transitions: allowed } });
  } catch (err) { res.status(500).json({ error: 'Error' }); }
});


module.exports = router;
