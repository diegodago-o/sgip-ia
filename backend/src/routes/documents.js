const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { param, body, query, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware, projectAccessMiddleware } = require('../middleware/auth');

const router = express.Router();
router.use(authMiddleware);
// Verify user has access to the project
router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch(e) { next(e); }
});

// ── Upload directory ──
const UPLOAD_BASE = path.join(__dirname, '..', '..', 'uploads');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

// ── Multer config ──
const storage = multer.diskStorage({
  destination: (req, _file, cb) => {
    const dir = path.join(UPLOAD_BASE, 'projects', String(req.params.projectId));
    ensureDir(dir);
    cb(null, dir);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${timestamp}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'image/jpeg', 'image/png', 'image/tiff', 'image/webp',
      'text/plain', 'text/csv',
      'application/zip', 'application/x-rar-compressed',
    ];
    if (allowed.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error(`Tipo de archivo no permitido: ${file.mimetype}`));
    }
  },
});

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return false; }
  return true;
}

function fileHash(filePath) {
  const content = fs.readFileSync(filePath);
  return crypto.createHash('sha256').update(content).digest('hex');
}

// ── File extension to icon mapping (for frontend) ──
function fileIcon(mimetype) {
  if (mimetype?.includes('pdf')) return 'pdf';
  if (mimetype?.includes('word') || mimetype?.includes('document')) return 'word';
  if (mimetype?.includes('excel') || mimetype?.includes('sheet') || mimetype?.includes('csv')) return 'excel';
  if (mimetype?.includes('image')) return 'image';
  if (mimetype?.includes('presentation') || mimetype?.includes('powerpoint')) return 'pptx';
  return 'file';
}

// ═══════════════════════════════════════
// GET /api/documents/:projectId
// List documents for a project
// ═══════════════════════════════════════
router.get('/:projectId',
  [param('projectId').isInt(), query('doc_type').optional().isString()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      let where = 'd.project_id = ?';
      let params = [req.params.projectId];

      if (req.query.doc_type) {
        where += ' AND d.doc_type = ?';
        params.push(req.query.doc_type);
      }

      const [rows] = await pool.execute(
        `SELECT d.*, u.full_name as uploaded_by_name
         FROM documents d
         LEFT JOIN users u ON d.uploaded_by = u.id
         WHERE ${where}
         ORDER BY d.created_at DESC`,
        params
      );

      // Add icon hint and human-readable size
      const data = rows.map(r => ({
        ...r,
        icon: fileIcon(r.mime_type),
        file_size_human: r.file_size
          ? r.file_size > 1048576
            ? `${(r.file_size / 1048576).toFixed(1)} MB`
            : `${(r.file_size / 1024).toFixed(0)} KB`
          : null,
      }));

      res.json({ data });
    } catch (err) {
      console.error('List documents error:', err);
      res.status(500).json({ error: 'Error listando documentos' });
    }
  }
);

// ═══════════════════════════════════════
// POST /api/documents/:projectId/upload
// Upload one or multiple files
// ═══════════════════════════════════════
router.post('/:projectId/upload',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt()],
  (req, res, next) => {
    // Validate project exists before upload
    if (!validationResult(req).isEmpty()) {
      return res.status(400).json({ errors: validationResult(req).array() });
    }
    next();
  },
  upload.array('files', 20),
  async (req, res) => {
    try {
      // Verify project exists
      const [proj] = await pool.execute('SELECT id, status FROM projects WHERE id = ?', [req.params.projectId]);
      if (proj.length === 0) return res.status(404).json({ error: 'Proyecto no encontrado' });

      if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No se recibieron archivos' });
      }

      const results = [];
      const docType = req.body.doc_type || null;

      for (const file of req.files) {
        const hash = fileHash(file.path);

        const [result] = await pool.execute(
          `INSERT INTO documents (project_id, file_name, file_path, file_size, mime_type, file_hash, doc_type, doc_type_source, uploaded_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'manual', ?)`,
          [
            req.params.projectId,
            file.originalname,
            file.path,
            file.size,
            file.mimetype,
            hash,
            docType,
            req.user.id,
          ]
        );

        results.push({
          id: result.insertId,
          file_name: file.originalname,
          file_size: file.size,
          mime_type: file.mimetype,
          doc_type: docType,
        });
      }

      // Update project status to en_arranque if it was adjudicado
      if (proj[0].status === 'adjudicado') {
        await pool.execute(
          "UPDATE projects SET status = 'en_arranque' WHERE id = ? AND status = 'adjudicado'",
          [req.params.projectId]
        );
      }

      // Audit
      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'upload_documents', 'project', parseInt(req.params.projectId),
         JSON.stringify({ count: results.length, files: results.map(r => r.file_name) })]
      );

      res.status(201).json({
        data: results,
        message: `${results.length} archivo${results.length > 1 ? 's' : ''} cargado${results.length > 1 ? 's' : ''} exitosamente`,
      });
    } catch (err) {
      console.error('Upload error:', err);
      // Clean up uploaded files on error
      if (req.files) {
        req.files.forEach(f => { try { fs.unlinkSync(f.path); } catch {} });
      }
      if (err.message?.includes('Tipo de archivo no permitido')) {
        return res.status(400).json({ error: err.message });
      }
      res.status(500).json({ error: 'Error subiendo archivos' });
    }
  }
);

// ═══════════════════════════════════════
// PUT /api/documents/:projectId/:docId
// Update document metadata (classify, rename)
// ═══════════════════════════════════════
router.put('/:projectId/:docId',
  roleMiddleware('admin', 'gerente_proyecto'),
  [
    param('projectId').isInt(),
    param('docId').isInt(),
    body('doc_type').optional().isIn([
      'pliego','anexo_tecnico','propuesta_tecnica','propuesta_economica',
      'contrato','adicion_otrosi','acta_inicio','poliza','presupuesto','otro'
    ]),
    body('file_name').optional().trim().notEmpty(),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [existing] = await pool.execute(
        'SELECT id FROM documents WHERE id = ? AND project_id = ?',
        [req.params.docId, req.params.projectId]
      );
      if (existing.length === 0) return res.status(404).json({ error: 'Documento no encontrado' });

      const updates = [];
      const values = [];

      if (req.body.doc_type !== undefined) {
        updates.push('doc_type = ?', "doc_type_source = 'manual'");
        values.push(req.body.doc_type);
      }
      if (req.body.file_name) {
        updates.push('file_name = ?');
        values.push(req.body.file_name);
      }

      if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });

      values.push(req.params.docId);
      await pool.execute(`UPDATE documents SET ${updates.join(', ')} WHERE id = ?`, values);

      const [rows] = await pool.execute(
        'SELECT d.*, u.full_name as uploaded_by_name FROM documents d LEFT JOIN users u ON d.uploaded_by = u.id WHERE d.id = ?',
        [req.params.docId]
      );

      res.json({ data: rows[0], message: 'Documento actualizado' });
    } catch (err) {
      console.error('Update doc error:', err);
      res.status(500).json({ error: 'Error actualizando documento' });
    }
  }
);

// ═══════════════════════════════════════
// GET /api/documents/:projectId/:docId/download
// Download a file
// ═══════════════════════════════════════
router.get('/:projectId/:docId/download',
  [param('projectId').isInt(), param('docId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [rows] = await pool.execute(
        'SELECT file_name, file_path, mime_type FROM documents WHERE id = ? AND project_id = ?',
        [req.params.docId, req.params.projectId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado' });

      const doc = rows[0];
      if (!fs.existsSync(doc.file_path)) {
        return res.status(404).json({ error: 'Archivo no encontrado en disco' });
      }

      res.setHeader('Content-Disposition', `attachment; filename="${encodeURIComponent(doc.file_name)}"`);
      res.setHeader('Content-Type', doc.mime_type || 'application/octet-stream');
      fs.createReadStream(doc.file_path).pipe(res);
    } catch (err) {
      console.error('Download error:', err);
      res.status(500).json({ error: 'Error descargando archivo' });
    }
  }
);

// ═══════════════════════════════════════
// DELETE /api/documents/:projectId/:docId
// ═══════════════════════════════════════
router.delete('/:projectId/:docId',
  roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt(), param('docId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [rows] = await pool.execute(
        'SELECT id, file_name, file_path FROM documents WHERE id = ? AND project_id = ?',
        [req.params.docId, req.params.projectId]
      );
      if (rows.length === 0) return res.status(404).json({ error: 'Documento no encontrado' });

      // Delete file from disk
      try { fs.unlinkSync(rows[0].file_path); } catch {}

      // Delete from DB
      await pool.execute('DELETE FROM documents WHERE id = ?', [req.params.docId]);

      // Audit
      await pool.execute(
        'INSERT INTO audit_log (user_id, action, entity_type, entity_id, details) VALUES (?,?,?,?,?)',
        [req.user.id, 'delete_document', 'document', parseInt(req.params.docId),
         JSON.stringify({ file_name: rows[0].file_name, project_id: req.params.projectId })]
      );

      res.json({ message: `Documento "${rows[0].file_name}" eliminado` });
    } catch (err) {
      console.error('Delete doc error:', err);
      res.status(500).json({ error: 'Error eliminando documento' });
    }
  }
);

module.exports = router;
