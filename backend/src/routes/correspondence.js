const express  = require('express');
const path     = require('path');
const fs       = require('fs');
const multer   = require('multer');
const { param, body, validationResult } = require('express-validator');
const pool     = require('../config/database');
const { authMiddleware, roleMiddleware, projectAccessMiddleware } = require('../middleware/auth');
const notifier = require('../services/notifier');
const { resolveAIConfig } = require('../services/aiConfig');

const router = express.Router();

router.use(authMiddleware);

router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch (e) { next(e); }
});

function validate(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; }
  return true;
}

// Convierte cualquier fecha a 'YYYY-MM-DD' o null
function toSqlDate(val) {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ─── Tipo → sigla ─────────────────────────────────────────────────────────────
const TYPE_SIGLA = {
  oficio: 'OF', circular: 'CIR', memorando: 'MEM',
  comunicado: 'COM', carta: 'CA', radicado: 'RAD', derecho_peticion: 'DP',
};

// ─── Genera código consecutivo SALIDA ─────────────────────────────────────────
// Formato: {SIGLAS_PROYECTO}-{TIPO}-{YYYYMMDD}-{NNN}
async function buildConsecutive(projectId, type, date) {
  const [[proj]] = await pool.execute('SELECT code FROM projects WHERE id = ?', [projectId]);
  const siglas = (proj?.code || 'PRJ').split('-')[0].toUpperCase().slice(0, 6);
  const d = date ? new Date(date) : new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const [[row]] = await pool.execute(
    "SELECT COALESCE(MAX(consecutive_num), 0) + 1 AS n FROM correspondence WHERE project_id = ? AND direction = 'salida'",
    [projectId]
  );
  const n = String(row.n).padStart(3, '0');
  return { code: `${siglas}-${TYPE_SIGLA[type] || 'OF'}-${dateStr}-${n}`, num: row.n };
}

// ─── Genera código consecutivo ENTRADA ────────────────────────────────────────
// Formato: {SIGLAS_PROYECTO}-ENT-{YYYYMMDD}-{NNN}
async function buildConsecutiveEntrada(projectId, date) {
  const [[proj]] = await pool.execute('SELECT code FROM projects WHERE id = ?', [projectId]);
  const siglas = (proj?.code || 'PRJ').split('-')[0].toUpperCase().slice(0, 6);
  const d = date ? new Date(date) : new Date();
  const dateStr = `${d.getFullYear()}${String(d.getMonth()+1).padStart(2,'0')}${String(d.getDate()).padStart(2,'0')}`;
  const [[row]] = await pool.execute(
    "SELECT COALESCE(MAX(consecutive_num), 0) + 1 AS n FROM correspondence WHERE project_id = ? AND direction = 'entrada'",
    [projectId]
  );
  const n = String(row.n).padStart(3, '0');
  return { code: `${siglas}-ENT-${dateStr}-${n}`, num: row.n };
}

// ─── Multer — adjuntos de correspondencia de entrada ──────────────────────────
const UPLOAD_DIR = path.join(__dirname, '..', '..', 'uploads', 'correspondence');
if (!fs.existsSync(UPLOAD_DIR)) fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(UPLOAD_DIR, String(req.params.projectId));
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ts   = Date.now();
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${ts}_${safe}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
  fileFilter: (req, file, cb) => {
    const allowed = ['.pdf', '.doc', '.docx', '.png', '.jpg', '.jpeg', '.tiff', '.tif', '.xlsx', '.xls', '.zip', '.rar', '.7z', '.gz', '.tar'];
    const ext = path.extname(file.originalname).toLowerCase();
    if (allowed.includes(ext)) cb(null, true);
    else cb(new Error(`Tipo de archivo no permitido: ${ext}`));
  },
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence — Listar (acepta ?direction=salida|entrada|all)
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const dir = req.query.direction; // 'salida' | 'entrada' | undefined = all
    const dirClause = dir && ['salida', 'entrada'].includes(dir)
      ? `AND c.direction = '${dir}'`
      : '';

    const [rows] = await pool.execute(`
      SELECT c.*,
             u.full_name   AS created_by_name,
             ua.full_name  AS assigned_to_name,
             p.name        AS project_name,
             p.code        AS project_code,
             COALESCE(NULLIF(c.project_entity,''), p.client_name) AS project_entity,
             p.correspondence_sender_name,
             p.correspondence_logo,
             (SELECT COUNT(*) FROM correspondence ch WHERE ch.parent_id = c.id) AS reply_count
      FROM correspondence c
      LEFT JOIN users u  ON c.created_by   = u.id
      LEFT JOIN users ua ON c.assigned_to  = ua.id
      LEFT JOIN projects p ON c.project_id = p.id
      WHERE c.project_id = ? ${dirClause}
      ORDER BY c.reference_date DESC, c.consecutive_num DESC
    `, [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al listar correspondencia' }); }
});

// ════════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id — Detalle
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence/:id',
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[row]] = await pool.execute(`
        SELECT c.*, u.full_name AS created_by_name, ua.full_name AS assigned_to_name
        FROM correspondence c
        LEFT JOIN users u  ON c.created_by  = u.id
        LEFT JOIN users ua ON c.assigned_to = ua.id
        WHERE c.id = ? AND c.project_id = ?
      `, [req.params.id, req.params.projectId]);
      if (!row) return res.status(404).json({ error: 'No encontrado' });
      res.json({ data: row });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id/thread — Hilo completo
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence/:id/thread',
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const id  = Number(req.params.id);
      const pid = Number(req.params.projectId);

      // 1. Buscar la raíz del hilo (remontarse hasta el primer padre)
      let rootId = id;
      let safetyCounter = 0;
      while (safetyCounter++ < 20) {
        const [[cur]] = await pool.execute(
          'SELECT id, parent_id FROM correspondence WHERE id = ? AND project_id = ?',
          [rootId, pid]
        );
        if (!cur) break;
        if (!cur.parent_id) break;
        rootId = cur.parent_id;
      }

      // 2. Traer toda la cadena (raíz + descendientes directos/indirectos)
      const [rows] = await pool.execute(`
        WITH RECURSIVE thread AS (
          SELECT c.id FROM correspondence c WHERE c.id = ? AND c.project_id = ?
          UNION ALL
          SELECT c.id FROM correspondence c INNER JOIN thread t ON c.parent_id = t.id WHERE c.project_id = ?
        )
        SELECT c.*, u.full_name AS created_by_name, ua.full_name AS assigned_to_name
        FROM thread th
        JOIN correspondence c ON c.id = th.id
        LEFT JOIN users u  ON c.created_by  = u.id
        LEFT JOIN users ua ON c.assigned_to = ua.id
        ORDER BY c.reference_date ASC, c.id ASC
      `, [rootId, pid, pid]);

      res.json({ data: rows });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener hilo' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// POST /:projectId/correspondence — Crear (salida O entrada)
// ════════════════════════════════════════════════════════════════════════════════
router.post('/:projectId/correspondence',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [
    param('projectId').isInt(),
    body('subject').trim().notEmpty().withMessage('El asunto es requerido'),
    body('reference_date').isISO8601().withMessage('Fecha inválida'),
    body('correspondence_type').optional().isIn(['oficio','circular','memorando','comunicado','carta','radicado','derecho_peticion']),
    body('direction').optional().isIn(['salida','entrada']),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b    = req.body;
      const pid  = req.params.projectId;
      const direction = b.direction || 'salida';
      const type = b.correspondence_type || (direction === 'entrada' ? 'radicado' : 'oficio');

      // Datos del proyecto
      const [[proj]] = await pool.execute(
        `SELECT contract_number, client_name, start_date, name, contract_object FROM projects WHERE id = ?`, [pid]
      );

      // Código consecutivo según dirección
      let code, num;
      if (direction === 'entrada') {
        ({ code, num } = await buildConsecutiveEntrada(pid, b.reference_date));
      } else {
        ({ code, num } = await buildConsecutive(pid, type, b.reference_date));
      }

      // Estado por defecto según dirección
      const defaultStatus = direction === 'entrada' ? 'recibido' : 'borrador';

      const [r] = await pool.execute(`
        INSERT INTO correspondence
          (project_id, direction, consecutive_num, consecutive_code, correspondence_type,
           subject, reference_date,
           recipient_name, recipient_title, recipient_entity, recipient_address, recipient_city,
           sender_name, sender_title, sender_entity,
           body, closing,
           contract_reference, project_entity, project_start_date, project_object,
           status, radicado_number, sent_date, response_date, notes, ai_prompt,
           sender_entity_external, sender_name_external, sender_email, received_date, assigned_to, parent_id,
           fecha_limite,
           created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        pid, direction, num, code, type,
        b.subject, toSqlDate(b.reference_date),
        b.recipient_name   || null, b.recipient_title   || null,
        b.recipient_entity || proj?.client_name || null,
        b.recipient_address || null, b.recipient_city || 'Bogotá D.C.',
        b.sender_name  || null, b.sender_title  || null, b.sender_entity || null,
        b.body    || null, b.closing || (direction === 'salida' ? 'Cordialmente,' : null),
        b.contract_reference || proj?.contract_number || null,
        b.project_entity     || proj?.client_name     || null,
        toSqlDate(b.project_start_date || proj?.start_date || null),
        b.project_object     || proj?.contract_object    || null,
        b.status || defaultStatus,
        b.radicado_number || null,
        toSqlDate(b.sent_date),
        toSqlDate(b.response_date),
        b.notes || null,
        b.ai_prompt || null,
        // campos entrada
        b.sender_entity_external || null,
        b.sender_name_external   || null,
        b.sender_email           || null,
        toSqlDate(b.received_date),
        b.assigned_to ? Number(b.assigned_to) : null,
        b.parent_id   ? Number(b.parent_id)   : null,
        toSqlDate(b.fecha_limite) || null,
        req.user.id,
      ]);

      const [[created]] = await pool.execute(
        'SELECT * FROM correspondence WHERE id = ?', [r.insertId]
      );

      // Si tiene parent, marcar el parent como 'respondido' + timeline
      if (b.parent_id) {
        const [[par]] = await pool.execute('SELECT status FROM correspondence WHERE id = ? AND project_id = ?', [Number(b.parent_id), pid]).catch(() => [[null]]);
        await pool.execute("UPDATE correspondence SET status = 'respondido' WHERE id = ? AND project_id = ?", [Number(b.parent_id), pid]).catch(() => {});
        if (par) {
          await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, created_by) VALUES (?,?,?,?,?)',
            [Number(b.parent_id), par.status, 'respondido', `Respuesta creada: ${code}`, req.user.id]).catch(() => {});
        }
      }

      // Timeline inicial para entradas
      if (direction === 'entrada') {
        await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, assigned_to_user_id, created_by) VALUES (?,?,?,?,?,?)',
          [r.insertId, null, created.status, 'Comunicación radicada', b.assigned_to ? Number(b.assigned_to) : null, req.user.id]).catch(() => {});
        // Si viene con asignado, registrar también ese evento
        if (b.assigned_to) {
          await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, assigned_to_user_id, created_by) VALUES (?,?,?,?,?,?)',
            [r.insertId, 'recibido', 'asignado', 'Responsable asignado al radicar', Number(b.assigned_to), req.user.id]).catch(() => {});
        }
      } else if (direction === 'salida') {
        await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, created_by) VALUES (?,?,?,?,?)',
          [r.insertId, null, 'borrador', 'Comunicación creada como borrador', req.user.id]).catch(() => {});
      }

      // Notificaciones
      const [projNotify] = await pool.execute('SELECT code, name FROM projects WHERE id = ?', [pid]);
      const notifBase = {
        project_id:          Number(pid),
        project_code:        projNotify[0]?.code || '',
        project_name:        projNotify[0]?.name || '',
        subject:             created.subject || '',
        correspondence_type: created.correspondence_type || '',
        direction:           direction,
        radicado_number:     created.radicado_number || '',
        reference_date:      created.reference_date || null,
        consecutive_code:    created.consecutive_code || '',
        fecha_limite:        created.fecha_limite || null,
        sender_name_external:  created.sender_name_external  || '',
        sender_entity_external: created.sender_entity_external || '',
      };

      // 1. Notificación interna: correspondencia recibida
      notifier.notify('correspondence.received', notifBase).catch(() => {});

      // 2. Acuse de recibo al remitente externo (solo entradas con sender_email)
      if (direction === 'entrada' && created.sender_email) {
        pool.execute("SELECT setting_value FROM system_settings WHERE setting_key = 'company_name' LIMIT 1")
          .then(([[orgRow]]) => {
            const orgName = orgRow?.setting_value || projNotify[0]?.name || 'SGIP-IA';
            notifier.notifyExternal('correspondence.radicada', { ...notifBase, org_name: orgName }, [created.sender_email]).catch(() => {});
          })
          .catch(() => {
            notifier.notifyExternal('correspondence.radicada', { ...notifBase, org_name: projNotify[0]?.name || 'SGIP-IA' }, [created.sender_email]).catch(() => {});
          });
      }

      // 3. Notificación al responsable asignado
      if (created.assigned_to) {
        pool.execute('SELECT email, name FROM users WHERE id = ? AND is_active = 1 LIMIT 1', [created.assigned_to])
          .then(([[assignedUser]]) => {
            if (assignedUser?.email) {
              notifier.notifyExternal('correspondence.assigned', notifBase, [assignedUser.email]);
            }
          }).catch(() => {});
      }

      res.status(201).json({ data: created, message: 'Correspondencia creada' });
    } catch (err) {
      console.error(err);
      if (err.code === 'ER_DUP_ENTRY')
        return res.status(409).json({ error: 'Código consecutivo duplicado, intente de nuevo' });
      res.status(500).json({ error: 'Error al crear correspondencia' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// PUT /:projectId/correspondence/:id — Actualizar
// ════════════════════════════════════════════════════════════════════════════════
router.put('/:projectId/correspondence/:id',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body;
      // Capturar estado anterior para detectar cambio de asignación
      const [[prev]] = await pool.execute('SELECT status, assigned_to, direction FROM correspondence WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
      await pool.execute(`
        UPDATE correspondence SET
          correspondence_type       = COALESCE(?, correspondence_type),
          subject                   = COALESCE(?, subject),
          reference_date            = COALESCE(?, reference_date),
          recipient_name            = ?,
          recipient_title           = ?,
          recipient_entity          = ?,
          recipient_address         = ?,
          recipient_city            = ?,
          sender_name               = ?,
          sender_title              = ?,
          sender_entity             = ?,
          body                      = ?,
          closing                   = ?,
          contract_reference        = ?,
          project_entity            = ?,
          project_start_date        = ?,
          project_object            = ?,
          status                    = COALESCE(?, status),
          radicado_number           = ?,
          sent_date                 = ?,
          response_date             = ?,
          notes                     = ?,
          sender_entity_external    = ?,
          sender_name_external      = ?,
          sender_email              = ?,
          received_date             = ?,
          assigned_to               = ?,
          parent_id                 = COALESCE(?, parent_id),
          fecha_limite              = ?
        WHERE id = ? AND project_id = ?
      `, [
        b.correspondence_type || null,
        b.subject             || null,
        toSqlDate(b.reference_date),
        b.recipient_name    ?? null, b.recipient_title    ?? null,
        b.recipient_entity  ?? null, b.recipient_address  ?? null, b.recipient_city ?? null,
        b.sender_name       ?? null, b.sender_title       ?? null, b.sender_entity  ?? null,
        b.body              ?? null, b.closing            ?? null,
        b.contract_reference ?? null, b.project_entity   ?? null,
        toSqlDate(b.project_start_date),
        b.project_object    ?? null,
        b.status            || null,
        b.radicado_number   ?? null,
        toSqlDate(b.sent_date),
        toSqlDate(b.response_date),
        b.notes             ?? null,
        b.sender_entity_external ?? null,
        b.sender_name_external   ?? null,
        b.sender_email           ?? null,
        toSqlDate(b.received_date),
        b.assigned_to ? Number(b.assigned_to) : null,
        b.parent_id   ? Number(b.parent_id)   : null,
        toSqlDate(b.fecha_limite) || null,
        req.params.id, req.params.projectId,
      ]);
      const [[updated]] = await pool.execute('SELECT * FROM correspondence WHERE id = ?', [req.params.id]);

      // Auto-timeline para salidas cuando cambia el status via edición
      if (prev && prev.direction === 'salida' && b.status && b.status !== prev.status) {
        const notes = { radicado: 'Comunicación radicada', enviado: 'Comunicación enviada', archivado: 'Comunicación archivada' }[b.status] || `Estado cambiado a ${b.status}`;
        await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, created_by) VALUES (?,?,?,?,?)',
          [req.params.id, prev.status, b.status, notes, req.user.id]).catch(() => {});
      }

      // Auto-timeline para entradas cuando cambia el asignado
      if (prev && prev.direction === 'entrada' && b.assigned_to) {
        const newAssigned = Number(b.assigned_to);
        const oldAssigned = prev.assigned_to ? Number(prev.assigned_to) : null;
        if (newAssigned !== oldAssigned) {
          const prevStatus = prev.status;
          const newStatus  = ['recibido'].includes(prevStatus) ? 'asignado' : prevStatus;
          if (newStatus !== prevStatus) {
            await pool.execute("UPDATE correspondence SET status = ? WHERE id = ?", [newStatus, req.params.id]).catch(() => {});
          }
          await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, assigned_to_user_id, created_by) VALUES (?,?,?,?,?,?)',
            [req.params.id, prevStatus, newStatus, oldAssigned ? 'Responsable reasignado' : 'Responsable asignado', newAssigned, req.user.id]).catch(() => {});

          // Notificar al nuevo responsable
          pool.execute('SELECT email FROM users WHERE id = ? AND is_active = 1 LIMIT 1', [newAssigned])
            .then(([[u]]) => {
              if (!u?.email) return;
              const [[pRow]] = [[]]; // se carga más abajo si falta
              pool.execute('SELECT code, name FROM projects WHERE id = ?', [req.params.projectId])
                .then(([[proj]]) => {
                  notifier.notifyExternal('correspondence.assigned', {
                    project_id:              Number(req.params.projectId),
                    project_code:            proj?.code || '',
                    project_name:            proj?.name || '',
                    subject:                 updated.subject || '',
                    correspondence_type:     updated.correspondence_type || '',
                    radicado_number:         updated.radicado_number || '',
                    consecutive_code:        updated.consecutive_code || '',
                    reference_date:          updated.reference_date || null,
                    fecha_limite:            updated.fecha_limite || null,
                    sender_name_external:    updated.sender_name_external  || '',
                    sender_entity_external:  updated.sender_entity_external || '',
                  }, [u.email]);
                }).catch(() => {});
            }).catch(() => {});
        }
      }

      res.json({ data: updated, message: 'Actualizado correctamente' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /:projectId/correspondence/:id/status — Cambio rápido de estado
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:projectId/correspondence/:id/status',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [
    param('projectId').isInt(), param('id').isInt(),
    body('status').isIn(['borrador','radicado','enviado','recibido','asignado','en_revision','soporte_solicitado','respondido','cerrado','archivado','en_atencion']),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const extra = {};
      if (req.body.status === 'enviado'    && req.body.sent_date)     extra.sent_date     = req.body.sent_date;
      if (req.body.status === 'respondido' && req.body.response_date) extra.response_date = req.body.response_date;
      if (req.body.radicado_number)  extra.radicado_number  = req.body.radicado_number;
      if (req.body.assigned_to)      extra.assigned_to      = Number(req.body.assigned_to);

      const [[cur]] = await pool.execute('SELECT status FROM correspondence WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
      const prevStatus = cur?.status || null;

      let sql = 'UPDATE correspondence SET status = ?';
      const params = [req.body.status];
      for (const [k, v] of Object.entries(extra)) { sql += `, ${k} = ?`; params.push(v); }
      sql += ' WHERE id = ? AND project_id = ?';
      params.push(req.params.id, req.params.projectId);
      await pool.execute(sql, params);

      // Registrar en timeline
      if (prevStatus !== req.body.status) {
        const notes = req.body.notes || {
          radicado: 'Comunicación radicada',
          enviado:  'Comunicación enviada',
          archivado: 'Comunicación archivada',
        }[req.body.status] || `Estado cambiado a ${req.body.status}`;
        await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, created_by) VALUES (?,?,?,?,?)',
          [req.params.id, prevStatus, req.body.status, notes, req.user.id]).catch(() => {});
      }

      res.json({ message: 'Estado actualizado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /:projectId/correspondence/:id/assign — Asignar responsable
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:projectId/correspondence/:id/assign',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const assignedTo = req.body.assigned_to ? Number(req.body.assigned_to) : null;
      const [[cur]] = await pool.execute('SELECT status FROM correspondence WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
      const prevStatus = cur?.status || 'recibido';
      const newStatus  = prevStatus === 'recibido' ? 'asignado' : prevStatus;
      await pool.execute(`
        UPDATE correspondence
        SET assigned_to = ?, status = ?
        WHERE id = ? AND project_id = ?
      `, [assignedTo, newStatus, req.params.id, req.params.projectId]);
      await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, assigned_to_user_id, created_by) VALUES (?,?,?,?,?,?)',
        [req.params.id, prevStatus, newStatus, 'Responsable asignado', assignedTo, req.user.id]).catch(() => {});
      res.json({ message: 'Responsable asignado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al asignar' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /:projectId/correspondence/:id/request-support — Pedir soporte
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:projectId/correspondence/:id/request-support',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt(), body('notes').notEmpty().isString().trim()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[cur]] = await pool.execute('SELECT status FROM correspondence WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
      if (!cur) return res.status(404).json({ error: 'No encontrado' });
      if (!['recibido','asignado','en_revision','soporte_solicitado'].includes(cur.status))
        return res.status(409).json({ error: 'No se puede solicitar soporte en este estado' });
      await pool.execute("UPDATE correspondence SET status = 'soporte_solicitado' WHERE id = ? AND project_id = ?", [req.params.id, req.params.projectId]);
      await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, created_by) VALUES (?,?,?,?,?)',
        [req.params.id, cur.status, 'soporte_solicitado', req.body.notes, req.user.id]);
      res.json({ message: 'Soporte solicitado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /:projectId/correspondence/:id/close — Cerrar comunicación
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:projectId/correspondence/:id/close',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[cur]] = await pool.execute('SELECT status FROM correspondence WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
      if (!cur) return res.status(404).json({ error: 'No encontrado' });
      if (!['respondido'].includes(cur.status))
        return res.status(409).json({ error: 'Solo se puede cerrar una comunicación respondida' });
      await pool.execute("UPDATE correspondence SET status = 'cerrado' WHERE id = ? AND project_id = ?", [req.params.id, req.params.projectId]);
      await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, created_by) VALUES (?,?,?,?,?)',
        [req.params.id, cur.status, 'cerrado', req.body.notes || 'Comunicación cerrada', req.user.id]);
      res.json({ message: 'Comunicación cerrada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// PATCH /:projectId/correspondence/:id/archive — Archivar
// ════════════════════════════════════════════════════════════════════════════════
router.patch('/:projectId/correspondence/:id/archive',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[cur]] = await pool.execute('SELECT status FROM correspondence WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
      if (!cur) return res.status(404).json({ error: 'No encontrado' });
      await pool.execute("UPDATE correspondence SET status = 'archivado' WHERE id = ? AND project_id = ?", [req.params.id, req.params.projectId]);
      await pool.execute('INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, created_by) VALUES (?,?,?,?,?)',
        [req.params.id, cur.status, 'archivado', req.body.notes || 'Comunicación archivada', req.user.id]);
      res.json({ message: 'Archivado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id/timeline — Trazabilidad completa
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence/:id/timeline',
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[corr]] = await pool.execute('SELECT id FROM correspondence WHERE id = ? AND project_id = ?', [req.params.id, req.params.projectId]);
      if (!corr) return res.status(404).json({ error: 'Correspondencia no encontrada' });
      const [rows] = await pool.execute(`
        SELECT t.*, u.full_name AS created_by_name, ua.full_name AS assigned_to_name
        FROM correspondence_timeline t
        LEFT JOIN users u  ON t.created_by          = u.id
        LEFT JOIN users ua ON t.assigned_to_user_id = ua.id
        WHERE t.correspondence_id = ?
        ORDER BY t.created_at ASC
      `, [req.params.id]);
      res.json({ data: rows });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al obtener trazabilidad' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// POST /:projectId/correspondence/:id/timeline — Registrar avance / cambio estado
// ════════════════════════════════════════════════════════════════════════════════
router.post('/:projectId/correspondence/:id/timeline',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [
    param('projectId').isInt(), param('id').isInt(),
    body('to_status').isIn(['recibido','asignado','en_revision','soporte_solicitado','respondido','cerrado','archivado']),
    body('notes').optional({ nullable: true }).isString().trim().isLength({ max: 2000 }),
    body('assigned_to_user_id').optional({ nullable: true }).isInt(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const corrId   = Number(req.params.id);
      const pid      = Number(req.params.projectId);
      const toStatus = req.body.to_status;
      const notes    = req.body.notes    || null;
      const assignTo = req.body.assigned_to_user_id ? Number(req.body.assigned_to_user_id) : null;

      const [[corr]] = await pool.execute('SELECT id, status FROM correspondence WHERE id = ? AND project_id = ?', [corrId, pid]);
      if (!corr) return res.status(404).json({ error: 'Correspondencia no encontrada' });

      // Actualizar estado (y asignación si viene)
      let sql = 'UPDATE correspondence SET status = ?';
      const params = [toStatus];
      if (assignTo !== null) { sql += ', assigned_to = ?'; params.push(assignTo); }
      sql += ' WHERE id = ? AND project_id = ?';
      params.push(corrId, pid);
      await pool.execute(sql, params);

      // Insertar evento en timeline
      const [r] = await pool.execute(
        'INSERT INTO correspondence_timeline (correspondence_id, from_status, to_status, notes, assigned_to_user_id, created_by) VALUES (?, ?, ?, ?, ?, ?)',
        [corrId, corr.status, toStatus, notes, assignTo, req.user.id]
      );
      const [[event]] = await pool.execute(`
        SELECT t.*, u.full_name AS created_by_name, ua.full_name AS assigned_to_name
        FROM correspondence_timeline t
        LEFT JOIN users u  ON t.created_by          = u.id
        LEFT JOIN users ua ON t.assigned_to_user_id = ua.id
        WHERE t.id = ?
      `, [r.insertId]);

      res.status(201).json({ data: event, message: 'Avance registrado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al registrar avance' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// POST /:projectId/correspondence/:id/link — Vincular como respuesta a otro item
// ════════════════════════════════════════════════════════════════════════════════
router.post('/:projectId/correspondence/:id/link',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt(), body('parent_id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const id       = Number(req.params.id);
      const pid      = Number(req.params.projectId);
      const parentId = Number(req.body.parent_id);

      // Validar que el padre existe y pertenece al mismo proyecto
      const [[parent]] = await pool.execute(
        'SELECT id FROM correspondence WHERE id = ? AND project_id = ?', [parentId, pid]
      );
      if (!parent) return res.status(404).json({ error: 'Correspondencia padre no encontrada' });
      if (parentId === id) return res.status(400).json({ error: 'No se puede vincular consigo mismo' });

      await pool.execute(
        'UPDATE correspondence SET parent_id = ? WHERE id = ? AND project_id = ?',
        [parentId, id, pid]
      );
      // Marcar el padre como respondido
      await pool.execute(
        "UPDATE correspondence SET status = 'respondido' WHERE id = ? AND project_id = ? AND status NOT IN ('archivado','respondido')",
        [parentId, pid]
      );

      res.json({ message: 'Vinculado correctamente' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al vincular' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// POST /:projectId/correspondence/:id/attachment — Subir adjunto (entrada)
// ════════════════════════════════════════════════════════════════════════════════
router.post('/:projectId/correspondence/:id/attachment',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  upload.single('file'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    try {
      // Eliminar adjunto anterior si existía
      const [[prev]] = await pool.execute(
        'SELECT attachment_path FROM correspondence WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]
      );
      if (prev?.attachment_path) {
        const oldPath = path.join(__dirname, '..', '..', prev.attachment_path);
        if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      }

      const relPath = path.join('uploads', 'correspondence', String(req.params.projectId), req.file.filename)
        .replace(/\\/g, '/');

      await pool.execute(
        'UPDATE correspondence SET attachment_path = ?, attachment_original_name = ? WHERE id = ? AND project_id = ?',
        [relPath, req.file.originalname, req.params.id, req.params.projectId]
      );
      res.json({ message: 'Adjunto guardado', path: relPath, original_name: req.file.originalname });
    } catch (err) {
      console.error(err);
      // Limpiar el archivo si falló la BD
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Error al guardar adjunto' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id/attachment — Descargar adjunto
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence/:id/attachment',
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[row]] = await pool.execute(
        'SELECT attachment_path, attachment_original_name FROM correspondence WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]
      );
      if (!row?.attachment_path) return res.status(404).json({ error: 'Sin adjunto' });
      const filePath = path.join(__dirname, '..', '..', row.attachment_path);
      if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Archivo no encontrado en servidor' });
      res.download(filePath, row.attachment_original_name || 'adjunto');
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al descargar' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /:projectId/correspondence/:id
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:projectId/correspondence/:id',
  roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      // Eliminar adjunto físico
      const [[row]] = await pool.execute(
        'SELECT attachment_path FROM correspondence WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]
      );
      if (row?.attachment_path) {
        const fp = path.join(__dirname, '..', '..', row.attachment_path);
        if (fs.existsSync(fp)) fs.unlinkSync(fp);
      }
      await pool.execute('DELETE FROM correspondence WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]);
      res.json({ message: 'Eliminado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// POST /:projectId/correspondence/ai-generate — IA llena los campos (salida)
// ════════════════════════════════════════════════════════════════════════════════
router.post('/:projectId/correspondence/ai-generate',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), body('prompt').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const pid = req.params.projectId;
      const [[proj]] = await pool.execute(`
        SELECT name, code, contract_number, client_name, start_date,
               execution_term, execution_term_unit, estimated_end_date,
               progress_pct, contract_value, contract_object, sector
        FROM projects WHERE id = ?`, [pid]);
      if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

      const aiEngine = require('../services/ai-engine');
      const { provider, apiKey, model } = await resolveAIConfig(req.body, req.query, req.user?.id);
      const today = new Date().toISOString().split('T')[0];

      const systemPrompt = `Eres un asistente experto en redacción de correspondencia oficial para proyectos de construcción e ingeniería en Colombia. Tu tarea es analizar la instrucción en lenguaje natural del usuario y generar un JSON estructurado con los campos necesarios para una comunicación oficial.

Contexto del proyecto:
- Nombre: ${proj.name}
- Código: ${proj.code}
- Contrato N°: ${proj.contract_number || 'No especificado'}
- Entidad contratante: ${proj.client_name || 'No especificada'}
- Fecha de inicio: ${proj.start_date || 'No especificada'}
- Plazo: ${proj.execution_term} ${proj.execution_term_unit}
- Fecha estimada de terminación: ${proj.estimated_end_date || 'No especificada'}
- Avance actual: ${proj.progress_pct}%
- Objeto: ${proj.contract_object || 'No especificado'}
- Fecha hoy: ${today}

Genera ÚNICAMENTE un JSON válido con estos campos (sin markdown, sin texto adicional):
{
  "correspondence_type": "oficio|circular|memorando|comunicado|carta|radicado|derecho_peticion",
  "subject": "Asunto conciso y formal (máx 150 chars)",
  "reference_date": "YYYY-MM-DD",
  "recipient_name": "Nombre completo del destinatario",
  "recipient_title": "Cargo del destinatario",
  "recipient_entity": "Entidad del destinatario",
  "recipient_city": "Ciudad",
  "sender_name": "Nombre del remitente",
  "sender_title": "Cargo del remitente",
  "body": "Cuerpo completo de la comunicación en formato formal colombiano.",
  "closing": "Frase de cierre formal (ej: Cordialmente,)",
  "contract_reference": "${proj.contract_number || ''}",
  "project_entity": "${proj.client_name || ''}",
  "notes": "Observaciones internas opcionales"
}`;

      const result = await aiEngine.callLLM(provider, apiKey, model, systemPrompt, req.body.prompt, { maxTokens: 2000, temperature: 0.3 });
      let generated = {};
      try {
        const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        generated = JSON.parse(cleaned);
      } catch {
        return res.status(422).json({ error: 'La IA no devolvió un JSON válido. Intenta reformular tu instrucción.' });
      }

      generated.contract_reference = generated.contract_reference || proj.contract_number;
      generated.project_entity     = generated.project_entity     || proj.client_name;
      generated.project_start_date = proj.start_date;
      generated.project_object     = proj.contract_object;
      generated.ai_prompt          = req.body.prompt;

      res.json({ data: generated, message: 'Campos generados por IA. Revisa y ajusta antes de guardar.' });
    } catch (err) {
      console.error('AI generate error:', err);
      res.status(500).json({ error: err.message || 'Error al generar con IA' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id/preview — Vista previa texto
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence/:id/preview',
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[c]] = await pool.execute(
        'SELECT * FROM correspondence WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]
      );
      if (!c) return res.status(404).json({ error: 'No encontrado' });
      const fmtDate = (d) => {
        if (!d) return '';
        const s = String(d).substring(0, 10);
        const [y, m, day] = s.split('-').map(Number);
        const dt = new Date(y, m - 1, day);
        const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        return `${dt.getDate()} de ${months[dt.getMonth()]} de ${dt.getFullYear()}`;
      };
      const TYPE_LABEL = { oficio:'OFICIO', circular:'CIRCULAR', memorando:'MEMORANDO', comunicado:'COMUNICADO', carta:'CARTA', radicado:'RADICADO', derecho_peticion:'DERECHO DE PETICIÓN' };
      const text = `${TYPE_LABEL[c.correspondence_type]||'COMUNICACIÓN'} ${c.consecutive_code}\n\n${c.recipient_city||'Bogotá D.C.'}, ${fmtDate(c.reference_date)}\n\n${c.recipient_name||''}\n${c.recipient_title||''}\n${c.recipient_entity||''}\n\nAsunto: ${c.subject}\n${c.contract_reference?`Ref.: Contrato No. ${c.contract_reference}`:''}\n\n${c.body||''}\n\n${c.closing||'Cordialmente,'}\n\n\n${c.sender_name||''}\n${c.sender_title||''}\n${c.project_entity||''}`.trim();
      res.json({ data: { text, record: c } });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id/download — Descarga Word (.docx) — solo salida
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence/:id/download',
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[c]] = await pool.execute(
        `SELECT cr.*, p.name as project_name, p.code as project_code,
                p.correspondence_sender_name, p.correspondence_logo
         FROM correspondence cr
         JOIN projects p ON cr.project_id = p.id
         WHERE cr.id = ? AND cr.project_id = ?`,
        [req.params.id, req.params.projectId]
      );
      if (!c) return res.status(404).json({ error: 'No encontrado' });

      const {
        Document, Packer, Paragraph, TextRun, AlignmentType,
        BorderStyle, Table, TableRow, TableCell, WidthType,
        ShadingType, HeadingLevel, TabStopType, TabStopLeader,
        convertInchesToTwip, UnderlineType, ImageRun, ExternalHyperlink,
      } = require('docx');

      const TYPE_LABEL = {
        oficio: 'OFICIO', circular: 'CIRCULAR', memorando: 'MEMORANDO',
        comunicado: 'COMUNICADO', carta: 'CARTA', radicado: 'RADICADO',
        derecho_peticion: 'DERECHO DE PETICIÓN',
      };
      const fmtDate = (d) => {
        if (!d) return '';
        const s = String(d).substring(0, 10);
        const [y, m, day] = s.split('-').map(Number);
        const dt = new Date(y, m - 1, day);
        const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
        return `${dt.getDate()} de ${months[dt.getMonth()]} de ${dt.getFullYear()}`;
      };

      const COLOR_PRIMARY   = '1E3A5F';
      const COLOR_SECONDARY = '2E86AB';
      const COLOR_ACCENT    = 'F0F4F8';
      const COLOR_WHITE     = 'FFFFFF';

      const typeLabel = TYPE_LABEL[c.correspondence_type] || 'COMUNICACIÓN';
      const firstName = (c.recipient_name || '').split(' ')[0] || 'señor(a)';

      const spacer = (lines = 1) => Array.from({ length: lines }, () =>
        new Paragraph({ children: [new TextRun({ text: '', size: 22 })], spacing: { after: 0 } })
      );

      let logoImageRun = null;
      if (c.correspondence_logo) {
        try {
          const m = c.correspondence_logo.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
          if (m) {
            const imgType = m[1] === 'jpg' ? 'jpeg' : m[1];
            logoImageRun = new ImageRun({ data: Buffer.from(m[2], 'base64'), transformation: { width: 130, height: 45 }, type: imgType });
          }
        } catch (_) {}
      }
      const headerEntityName = c.correspondence_sender_name || c.project_entity || c.project_name || 'SGIP';

      const makeBorderNone = () => ({ top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } });

      const headerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { ...makeBorderNone(), insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE } },
        rows: [new TableRow({ children: [
          new TableCell({
            width: { size: 65, type: WidthType.PERCENTAGE },
            children: [
              ...(logoImageRun ? [new Paragraph({ children: [logoImageRun], spacing: { before: 60, after: 20 } })] : []),
              new Paragraph({ children: [new TextRun({ text: headerEntityName, bold: true, color: COLOR_WHITE, size: 28, font: 'Calibri' })], spacing: { before: logoImageRun ? 0 : 60, after: 20 } }),
              new Paragraph({ children: [new TextRun({ text: `Proyecto: ${c.project_name || ''}`, color: 'BDD7EE', size: 18, font: 'Calibri' })], spacing: { after: 20 } }),
              new Paragraph({ children: [new TextRun({ text: `Código: ${c.project_code || ''}`, color: 'BDD7EE', size: 18, font: 'Calibri' })], spacing: { after: 60 } }),
            ],
            shading: { type: ShadingType.SOLID, color: COLOR_PRIMARY },
            margins: { top: 100, bottom: 100, left: 200, right: 100 },
            borders: makeBorderNone(),
          }),
          new TableCell({
            width: { size: 35, type: WidthType.PERCENTAGE },
            children: [
              new Paragraph({ children: [new TextRun({ text: typeLabel, bold: true, color: COLOR_WHITE, size: 26, font: 'Calibri' })], alignment: AlignmentType.CENTER, spacing: { before: 60, after: 20 } }),
              new Paragraph({ children: [new TextRun({ text: c.consecutive_code, color: 'BDD7EE', size: 20, font: 'Calibri' })], alignment: AlignmentType.CENTER, spacing: { after: 20 } }),
              new Paragraph({ children: [new TextRun({ text: fmtDate(c.reference_date), color: 'BDD7EE', size: 18, font: 'Calibri' })], alignment: AlignmentType.CENTER, spacing: { after: 60 } }),
            ],
            shading: { type: ShadingType.SOLID, color: COLOR_SECONDARY },
            margins: { top: 100, bottom: 100, left: 150, right: 200 },
            borders: makeBorderNone(),
          }),
        ]})],
      });

      const refRows = [];
      if (c.contract_reference) refRows.push(['Contrato N°', c.contract_reference]);
      if (c.project_start_date) refRows.push(['Fecha inicio', fmtDate(c.project_start_date)]);
      const refTable = refRows.length > 0 ? new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { ...makeBorderNone(), insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE } },
        rows: [new TableRow({ children: refRows.map(([label, value]) => [
          new TableCell({ width: { size: 20, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, color: COLOR_PRIMARY, font: 'Calibri' })], spacing: { before: 60, after: 60 } })], shading: { type: ShadingType.SOLID, color: COLOR_ACCENT }, margins: { top: 60, bottom: 60, left: 150, right: 100 }, borders: makeBorderNone() }),
          new TableCell({ width: { size: 30, type: WidthType.PERCENTAGE }, children: [new Paragraph({ children: [new TextRun({ text: value, size: 18, font: 'Calibri', color: '333333' })], spacing: { before: 60, after: 60 } })], margins: { top: 60, bottom: 60, left: 100, right: 150 }, borders: makeBorderNone() }),
        ]).flat() })],
      }) : null;

      const divider = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: makeBorderNone(),
        rows: [new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '' })] })], shading: { type: ShadingType.SOLID, color: COLOR_SECONDARY }, borders: makeBorderNone(), margins: { top: 0, bottom: 0 } })] })],
      });

      const recipientBlock = [
        ...(c.recipient_name    ? [new Paragraph({ children: [new TextRun({ text: c.recipient_name,    bold: true, size: 22, color: COLOR_PRIMARY, font: 'Calibri' })], spacing: { after: 40 } })] : []),
        ...(c.recipient_title   ? [new Paragraph({ children: [new TextRun({ text: c.recipient_title,   size: 20, color: '555555', font: 'Calibri' })], spacing: { after: 20 } })] : []),
        ...(c.recipient_entity  ? [new Paragraph({ children: [new TextRun({ text: c.recipient_entity,  size: 20, color: '555555', font: 'Calibri' })], spacing: { after: 20 } })] : []),
        ...(c.recipient_address ? [new Paragraph({ children: [new TextRun({ text: c.recipient_address, size: 18, color: '888888', font: 'Calibri' })], spacing: { after: 20 } })] : []),
        new Paragraph({ children: [new TextRun({ text: c.recipient_city || 'Bogotá D.C.', size: 18, color: '888888', font: 'Calibri' })], spacing: { after: 20 } }),
      ];

      const subjectBlock = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.THICK, color: COLOR_SECONDARY, size: 16 }, right: { style: BorderStyle.NONE }, insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE } },
        rows: [new TableRow({ children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'ASUNTO: ', bold: true, size: 20, color: COLOR_PRIMARY, font: 'Calibri' }), new TextRun({ text: c.subject || '', size: 20, font: 'Calibri', bold: true })], spacing: { before: 80, after: 80 } })], shading: { type: ShadingType.SOLID, color: 'F8FAFB' }, margins: { top: 60, bottom: 60, left: 150, right: 150 }, borders: makeBorderNone() }),
        ]})],
      });

      // Parse body HTML → paragraphs
      const { parseHtmlToParagraphs } = require('../utils/htmlParser');
      const bodyParagraphs = parseHtmlToParagraphs(c.body || '', { font: 'Calibri', size: 22, color: '1A1A1A' });

      const signatureTable = new Table({
        width: { size: 40, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE } },
        rows: [
          new TableRow({ children: [new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: '' })], spacing: { after: 0 } })], borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.SINGLE, color: '999999', size: 4 }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } }, margins: { top: 0, bottom: 0, left: 0, right: 0 } })] }),
          new TableRow({ children: [new TableCell({ children: [
            ...(c.sender_name   ? [new Paragraph({ children: [new TextRun({ text: c.sender_name,   bold: true, size: 22, color: COLOR_PRIMARY, font: 'Calibri' })], spacing: { before: 60, after: 20 } })] : []),
            ...(c.sender_title  ? [new Paragraph({ children: [new TextRun({ text: c.sender_title,  size: 18, color: '555555', font: 'Calibri' })], spacing: { after: 20 } })] : []),
            ...(c.sender_entity ? [new Paragraph({ children: [new TextRun({ text: c.sender_entity, size: 18, color: '888888', font: 'Calibri' })], spacing: { after: 20 } })] : []),
          ], borders: makeBorderNone() })] }),
        ],
      });

      const footerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.SINGLE, color: 'DDDDDD', size: 4 }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE } },
        rows: [new TableRow({ children: [
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: `${typeLabel} No. ${c.consecutive_code}`, size: 16, color: '999999', font: 'Calibri' })], spacing: { before: 60, after: 60 } })], borders: makeBorderNone() }),
          new TableCell({ children: [new Paragraph({ children: [new TextRun({ text: 'Generado por SGIP-IA', size: 16, color: '999999', font: 'Calibri' })], alignment: AlignmentType.RIGHT, spacing: { before: 60, after: 60 } })], borders: makeBorderNone() }),
        ]})],
      });

      const children = [
        headerTable, ...spacer(1), divider, ...spacer(1),
        new Paragraph({ children: [new TextRun({ text: `${c.recipient_city || 'Bogotá D.C.'}, ${fmtDate(c.reference_date)}`, size: 20, font: 'Calibri', color: '444444' })], alignment: AlignmentType.RIGHT, spacing: { after: 200 } }),
        ...recipientBlock, ...spacer(1),
        subjectBlock,
        ...(refTable ? [...spacer(1), refTable] : []),
        ...spacer(1),
        new Paragraph({ children: [new TextRun({ text: `Respetado(a) señor(a) ${firstName}:`, size: 22, font: 'Calibri', color: '1A1A1A' })], spacing: { after: 200 } }),
        ...bodyParagraphs, ...spacer(1),
        new Paragraph({ children: [new TextRun({ text: c.closing || 'Cordialmente,', size: 22, font: 'Calibri', color: '1A1A1A' })], spacing: { after: 600 } }),
        signatureTable, ...spacer(2), footerTable,
      ];

      const doc = new Document({
        styles: { default: { document: { run: { font: 'Calibri', size: 22, color: '1A1A1A' }, paragraph: { spacing: { line: 276 } } } } },
        sections: [{ properties: { page: { margin: { top: convertInchesToTwip(1), bottom: convertInchesToTwip(1), left: convertInchesToTwip(1.2), right: convertInchesToTwip(1.2) } } }, children }],
      });

      const buffer = await Packer.toBuffer(doc);
      const filename = `${c.consecutive_code}.docx`;
      res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
      res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
      res.setHeader('Content-Length', buffer.length);
      res.send(buffer);
    } catch (err) {
      console.error('DOCX generation error:', err);
      res.status(500).json({ error: 'Error al generar el documento Word: ' + err.message });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// POST /:projectId/correspondence/:id/attachments — Subir adjunto a tabla nueva
// ════════════════════════════════════════════════════════════════════════════════
router.post('/:projectId/correspondence/:id/attachments',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  upload.single('file'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo' });
    try {
      const relPath = path.join('uploads', 'correspondence', String(req.params.projectId), req.file.filename)
        .replace(/\\/g, '/');
      const [r] = await pool.execute(
        'INSERT INTO correspondence_attachments (correspondence_id, file_path, original_name, file_size, mime_type) VALUES (?, ?, ?, ?, ?)',
        [req.params.id, relPath, req.file.originalname, req.file.size || null, req.file.mimetype || null]
      );
      res.status(201).json({ data: { id: r.insertId, original_name: req.file.originalname, file_path: relPath } });
    } catch (err) {
      console.error(err);
      if (req.file?.path && fs.existsSync(req.file.path)) fs.unlinkSync(req.file.path);
      res.status(500).json({ error: 'Error al guardar adjunto' });
    }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id/attachments — Listar todos los adjuntos
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence/:id/attachments',
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [rows] = await pool.execute(
        'SELECT id, original_name, file_size, mime_type, created_at FROM correspondence_attachments WHERE correspondence_id = ?',
        [req.params.id]
      );
      res.json({ data: rows });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al listar adjuntos' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id/attachments/:attId — Descargar adjunto (Bearer)
// ════════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence/:id/attachments/:attId',
  [param('projectId').isInt(), param('id').isInt(), param('attId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[att]] = await pool.execute(
        'SELECT * FROM correspondence_attachments WHERE id = ? AND correspondence_id = ?',
        [req.params.attId, req.params.id]
      );
      if (!att) return res.status(404).json({ error: 'Adjunto no encontrado' });
      const absPath = path.join(__dirname, '..', '..', att.file_path);
      if (!fs.existsSync(absPath)) return res.status(404).json({ error: 'Archivo no encontrado' });
      res.download(absPath, att.original_name);
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al descargar adjunto' }); }
  }
);

// ════════════════════════════════════════════════════════════════════════════════
// DELETE /:projectId/correspondence/:id/attachments/:attId — Eliminar adjunto
// ════════════════════════════════════════════════════════════════════════════════
router.delete('/:projectId/correspondence/:id/attachments/:attId',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt(), param('attId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[att]] = await pool.execute(
        'SELECT * FROM correspondence_attachments WHERE id = ? AND correspondence_id = ?',
        [req.params.attId, req.params.id]
      );
      if (!att) return res.status(404).json({ error: 'Adjunto no encontrado' });
      // Eliminar archivo físico
      const absPath = path.join(__dirname, '..', '..', att.file_path);
      if (fs.existsSync(absPath)) { try { fs.unlinkSync(absPath); } catch (_) {} }
      // Eliminar registro
      await pool.execute('DELETE FROM correspondence_attachments WHERE id = ?', [att.id]);
      res.json({ message: 'Adjunto eliminado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar adjunto' }); }
  }
);

module.exports = router;
