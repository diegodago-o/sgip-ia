const express = require('express');
const { param, body, validationResult } = require('express-validator');
const pool = require('../config/database');
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

// Convierte cualquier fecha (ISO, string, Date) a 'YYYY-MM-DD' o null
function toSqlDate(val) {
  if (!val) return null;
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

// ─── Tipo → sigla ────────────────────────────────────────────────────────────
const TYPE_SIGLA = {
  oficio: 'OF', circular: 'CIR', memorando: 'MEM',
  comunicado: 'COM', carta: 'CA', radicado: 'RAD', derecho_peticion: 'DP',
};

// ─── Genera código consecutivo ──────────────────────────────────────────────
// Formato: {SIGLAS_PROYECTO}-{TIPO}-{YYYYMMDD}-{NNN}
// Ejemplo: OC-OF-20260314-001
async function buildConsecutive(projectId, type, date) {
  // 1. Siglas del proyecto: tomamos el primer segmento del código del proyecto
  const [[proj]] = await pool.execute('SELECT code FROM projects WHERE id = ?', [projectId]);
  const rawCode = proj?.code || 'PRJ';
  // Extraer las primeras letras: OC-2024-001 → OC | SGIP-001 → SGIP
  const siglas = rawCode.split('-')[0].toUpperCase().slice(0, 6);

  // 2. Fecha YYYYMMDD
  const d = date ? new Date(date) : new Date();
  const year  = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const day   = String(d.getDate()).padStart(2, '0');
  const dateStr = `${year}${month}${day}`;

  // 3. Consecutivo por proyecto
  const [[row]] = await pool.execute(
    'SELECT COALESCE(MAX(consecutive_num), 0) + 1 AS n FROM correspondence WHERE project_id = ?',
    [projectId]
  );
  const n = String(row.n).padStart(3, '0');
  const typeSigla = TYPE_SIGLA[type] || 'OF';

  return { code: `${siglas}-${typeSigla}-${dateStr}-${n}`, num: row.n };
}

// ══════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence — Listar
// ══════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT c.*, u.full_name AS created_by_name,
             p.name AS project_name, p.code AS project_code,
             COALESCE(NULLIF(c.project_entity,''), p.client_name) AS project_entity,
             p.correspondence_sender_name, p.correspondence_logo
      FROM correspondence c
      LEFT JOIN users u ON c.created_by = u.id
      LEFT JOIN projects p ON c.project_id = p.id
      WHERE c.project_id = ?
      ORDER BY c.reference_date DESC, c.consecutive_num DESC
    `, [req.params.projectId]);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error al listar correspondencia' }); }
});

// ══════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id — Detalle
// ══════════════════════════════════════════════════════════════════════════════
router.get('/:projectId/correspondence/:id',
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const [[row]] = await pool.execute(`
        SELECT c.*, u.full_name AS created_by_name
        FROM correspondence c
        LEFT JOIN users u ON c.created_by = u.id
        WHERE c.id = ? AND c.project_id = ?
      `, [req.params.id, req.params.projectId]);
      if (!row) return res.status(404).json({ error: 'No encontrado' });
      res.json({ data: row });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// POST /:projectId/correspondence — Crear
// ══════════════════════════════════════════════════════════════════════════════
router.post('/:projectId/correspondence',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [
    param('projectId').isInt(),
    body('subject').trim().notEmpty().withMessage('El asunto es requerido'),
    body('reference_date').isISO8601().withMessage('Fecha inválida'),
    body('correspondence_type').optional().isIn(['oficio','circular','memorando','comunicado','carta','radicado','derecho_peticion']),
  ],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body;
      const pid = req.params.projectId;
      const type = b.correspondence_type || 'oficio';

      // Auto-completar datos del proyecto si no vienen
      const [[proj]] = await pool.execute(
        `SELECT contract_number, client_name, start_date, name, contract_object
         FROM projects WHERE id = ?`, [pid]
      );

      const { code, num } = await buildConsecutive(pid, type, b.reference_date);

      const [r] = await pool.execute(`
        INSERT INTO correspondence
          (project_id, consecutive_num, consecutive_code, correspondence_type,
           subject, reference_date,
           recipient_name, recipient_title, recipient_entity, recipient_address, recipient_city,
           sender_name, sender_title, sender_entity,
           body, closing,
           contract_reference, project_entity, project_start_date, project_object,
           status, radicado_number, sent_date, response_date, notes, ai_prompt,
           created_by)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      `, [
        pid, num, code, type,
        b.subject, toSqlDate(b.reference_date),
        b.recipient_name  || null, b.recipient_title  || null,
        b.recipient_entity || proj?.client_name || null,
        b.recipient_address || null, b.recipient_city || 'Bogotá D.C.',
        b.sender_name  || null, b.sender_title  || null, b.sender_entity || null,
        b.body    || null, b.closing || 'Cordialmente,',
        b.contract_reference || proj?.contract_number || null,
        b.project_entity     || proj?.client_name     || null,
        toSqlDate(b.project_start_date || proj?.start_date || null),
        b.project_object     || proj?.contract_object    || null,
        b.status || 'borrador',
        b.radicado_number || null,
        toSqlDate(b.sent_date),
        toSqlDate(b.response_date),
        b.notes || null,
        b.ai_prompt || null,
        req.user.id,
      ]);

      const [[created]] = await pool.execute(
        'SELECT * FROM correspondence WHERE id = ?', [r.insertId]
      );
      // Notify (fire-and-forget)
      const [projNotify] = await pool.execute('SELECT code, name FROM projects WHERE id = ?', [pid]);
      notifier.notify('correspondence.received', {
        project_id:          Number(pid),
        project_code:        projNotify[0]?.code || '',
        project_name:        projNotify[0]?.name || '',
        subject:             created.subject || '',
        correspondence_type: created.correspondence_type || '',
        radicado_number:     created.radicado_number || '',
        reference_date:      created.reference_date || null,
      }).catch(() => {});

      res.status(201).json({ data: created, message: 'Correspondencia creada' });
    } catch (err) {
      console.error(err);
      if (err.code === 'ER_DUP_ENTRY')
        return res.status(409).json({ error: 'Código consecutivo duplicado, intente de nuevo' });
      res.status(500).json({ error: 'Error al crear correspondencia' });
    }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// PUT /:projectId/correspondence/:id — Actualizar
// ══════════════════════════════════════════════════════════════════════════════
router.put('/:projectId/correspondence/:id',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body;
      await pool.execute(`
        UPDATE correspondence SET
          correspondence_type = COALESCE(?, correspondence_type),
          subject             = COALESCE(?, subject),
          reference_date      = COALESCE(?, reference_date),
          recipient_name      = ?,
          recipient_title     = ?,
          recipient_entity    = ?,
          recipient_address   = ?,
          recipient_city      = ?,
          sender_name         = ?,
          sender_title        = ?,
          sender_entity       = ?,
          body                = ?,
          closing             = ?,
          contract_reference  = ?,
          project_entity      = ?,
          project_start_date  = ?,
          project_object      = ?,
          status              = COALESCE(?, status),
          radicado_number     = ?,
          sent_date           = ?,
          response_date       = ?,
          notes               = ?
        WHERE id = ? AND project_id = ?
      `, [
        b.correspondence_type || null,
        b.subject || null,
        toSqlDate(b.reference_date),
        b.recipient_name  ?? null, b.recipient_title  ?? null,
        b.recipient_entity ?? null, b.recipient_address ?? null, b.recipient_city ?? null,
        b.sender_name ?? null, b.sender_title ?? null, b.sender_entity ?? null,
        b.body ?? null, b.closing ?? null,
        b.contract_reference ?? null, b.project_entity ?? null,
        toSqlDate(b.project_start_date),
        b.project_object ?? null,
        b.status || null,
        b.radicado_number ?? null,
        toSqlDate(b.sent_date),
        toSqlDate(b.response_date),
        b.notes ?? null,
        req.params.id, req.params.projectId,
      ]);
      const [[updated]] = await pool.execute('SELECT * FROM correspondence WHERE id = ?', [req.params.id]);
      res.json({ data: updated, message: 'Actualizado correctamente' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al actualizar' }); }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// PATCH /:projectId/correspondence/:id/status — Cambio rápido de estado
// ══════════════════════════════════════════════════════════════════════════════
router.patch('/:projectId/correspondence/:id/status',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), param('id').isInt(), body('status').isIn(['borrador','radicado','enviado','recibido','respondido','archivado'])],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const extra = {};
      if (req.body.status === 'enviado' && req.body.sent_date)     extra.sent_date     = req.body.sent_date;
      if (req.body.status === 'respondido' && req.body.response_date) extra.response_date = req.body.response_date;
      if (req.body.radicado_number) extra.radicado_number = req.body.radicado_number;

      let sql = 'UPDATE correspondence SET status = ?';
      const params = [req.body.status];
      for (const [k, v] of Object.entries(extra)) { sql += `, ${k} = ?`; params.push(v); }
      sql += ' WHERE id = ? AND project_id = ?';
      params.push(req.params.id, req.params.projectId);
      await pool.execute(sql, params);
      res.json({ message: 'Estado actualizado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// DELETE /:projectId/correspondence/:id
// ══════════════════════════════════════════════════════════════════════════════
router.delete('/:projectId/correspondence/:id',
  roleMiddleware('admin', 'gerente_proyecto'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      await pool.execute('DELETE FROM correspondence WHERE id = ? AND project_id = ?',
        [req.params.id, req.params.projectId]);
      res.json({ message: 'Eliminado' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error al eliminar' }); }
  }
);

// ══════════════════════════════════════════════════════════════════════════════
// POST /:projectId/correspondence/ai-generate — IA llena los campos
// ══════════════════════════════════════════════════════════════════════════════
router.post('/:projectId/correspondence/ai-generate',
  roleMiddleware('admin', 'gerente_proyecto', 'apoyo'),
  [param('projectId').isInt(), body('prompt').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const pid = req.params.projectId;

      // Datos del proyecto para contexto
      const [[proj]] = await pool.execute(`
        SELECT name, code, contract_number, client_name, start_date,
               execution_term, execution_term_unit, estimated_end_date,
               progress_pct, contract_value, contract_object, sector
        FROM projects WHERE id = ?`, [pid]);

      if (!proj) return res.status(404).json({ error: 'Proyecto no encontrado' });

      // ── Configuración de IA — usa resolveAIConfig (env > DB > body) ──
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
  "sender_name": "Nombre del remitente (usualmente el gerente de proyecto)",
  "sender_title": "Cargo del remitente",
  "body": "Cuerpo completo de la comunicación en formato formal colombiano. Incluir: saludo, párrafo de referencia al contrato, desarrollo del tema, solicitud o información principal, y cierre. Usar lenguaje formal.",
  "closing": "Frase de cierre formal (ej: Cordialmente,)",
  "contract_reference": "${proj.contract_number || ''}",
  "project_entity": "${proj.client_name || ''}",
  "notes": "Observaciones internas opcionales"
}`;

      const result = await aiEngine.callLLM(
        provider, apiKey, model,
        systemPrompt,
        req.body.prompt,
        { maxTokens: 2000, temperature: 0.3 }
      );

      // Parsear JSON de respuesta
      let generated = {};
      try {
        const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
        generated = JSON.parse(cleaned);
      } catch {
        return res.status(422).json({ error: 'La IA no devolvió un JSON válido. Intenta reformular tu instrucción.' });
      }

      // Asegurar datos del proyecto
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

// ══════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id/preview — Vista previa (texto)
// ══════════════════════════════════════════════════════════════════════════════
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

// ══════════════════════════════════════════════════════════════════════════════
// GET /:projectId/correspondence/:id/download — Descarga Word (.docx)
// ══════════════════════════════════════════════════════════════════════════════
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
        ShadingType, HeadingLevel, PageBreak, TabStopType, TabStopLeader,
        convertInchesToTwip, UnderlineType, ImageRun, ExternalHyperlink,
      } = require('docx');

      // ─── Helpers ──────────────────────────────────────────────────────────
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

      // Colores corporativos
      const COLOR_PRIMARY   = '1E3A5F'; // Azul marino
      const COLOR_SECONDARY = '2E86AB'; // Azul medio
      const COLOR_ACCENT    = 'F0F4F8'; // Gris claro fondo
      const COLOR_LINE      = 'CBD5E0'; // Gris borde
      const COLOR_WHITE     = 'FFFFFF';

      const typeLabel = TYPE_LABEL[c.correspondence_type] || 'COMUNICACIÓN';
      const firstName = (c.recipient_name || '').split(' ')[0] || 'señor(a)';

      // ─── Párrafo vacío ──────────────────────────────────────────────────
      const spacer = (lines = 1) => Array.from({ length: lines }, () =>
        new Paragraph({ children: [new TextRun({ text: '', size: 22 })], spacing: { after: 0 } })
      );

      // ─── Celdas de tabla para encabezado ───────────────────────────────
      const headerCell = (text, opts = {}) => new TableCell({
        children: [new Paragraph({
          children: [new TextRun({
            text,
            bold: opts.bold || false,
            color: opts.color || COLOR_WHITE,
            size: opts.size || 22,
            font: 'Calibri',
          })],
          alignment: opts.align || AlignmentType.LEFT,
          spacing: { before: 40, after: 40 },
        })],
        shading: { type: ShadingType.SOLID, color: opts.bg || COLOR_PRIMARY },
        margins: { top: 80, bottom: 80, left: 150, right: 150 },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
        columnSpan: opts.span || 1,
      });

      // ─── Logo del proyecto (si está configurado) ──────────────────────
      let logoImageRun = null;
      if (c.correspondence_logo) {
        try {
          const m = c.correspondence_logo.match(/^data:image\/(png|jpeg|jpg|gif|webp);base64,(.+)$/);
          if (m) {
            const imgType = m[1] === 'jpg' ? 'jpeg' : m[1];
            logoImageRun = new ImageRun({
              data: Buffer.from(m[2], 'base64'),
              transformation: { width: 130, height: 45 },
              type: imgType,
            });
          }
        } catch (_) { /* ignorar errores de logo */ }
      }
      const headerEntityName = c.correspondence_sender_name || c.project_entity || c.project_name || 'SGIP';

      // ─── Tabla de encabezado corporativo ───────────────────────────────
      const headerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE } },
        rows: [
          // Fila 1: Logo/Nombre empresa + tipo doc
          new TableRow({
            children: [
              new TableCell({
                width: { size: 65, type: WidthType.PERCENTAGE },
                children: [
                  ...(logoImageRun ? [new Paragraph({
                    children: [logoImageRun],
                    spacing: { before: 60, after: 20 },
                  })] : []),
                  new Paragraph({
                    children: [new TextRun({ text: headerEntityName, bold: true, color: COLOR_WHITE, size: 28, font: 'Calibri' })],
                    spacing: { before: logoImageRun ? 0 : 60, after: 20 },
                  }),
                  new Paragraph({
                    children: [new TextRun({ text: `Proyecto: ${c.project_name || ''}`, color: 'BDD7EE', size: 18, font: 'Calibri' })],
                    spacing: { after: 20 },
                  }),
                  new Paragraph({
                    children: [new TextRun({ text: `Código: ${c.project_code || ''}`, color: 'BDD7EE', size: 18, font: 'Calibri' })],
                    spacing: { after: 60 },
                  }),
                ],
                shading: { type: ShadingType.SOLID, color: COLOR_PRIMARY },
                margins: { top: 100, bottom: 100, left: 200, right: 100 },
                borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
              }),
              new TableCell({
                width: { size: 35, type: WidthType.PERCENTAGE },
                children: [
                  new Paragraph({
                    children: [new TextRun({ text: typeLabel, bold: true, color: COLOR_WHITE, size: 26, font: 'Calibri' })],
                    alignment: AlignmentType.CENTER,
                    spacing: { before: 60, after: 20 },
                  }),
                  new Paragraph({
                    children: [new TextRun({ text: c.consecutive_code, color: 'BDD7EE', size: 20, font: 'Calibri Mono' })],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 20 },
                  }),
                  new Paragraph({
                    children: [new TextRun({ text: fmtDate(c.reference_date), color: 'BDD7EE', size: 18, font: 'Calibri' })],
                    alignment: AlignmentType.CENTER,
                    spacing: { after: 60 },
                  }),
                ],
                shading: { type: ShadingType.SOLID, color: COLOR_SECONDARY },
                margins: { top: 100, bottom: 100, left: 150, right: 200 },
                borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
              }),
            ],
          }),
        ],
      });

      // ─── Tabla de referencia al contrato ──────────────────────────────
      const refRows = [];
      if (c.contract_reference) refRows.push(['Contrato N°', c.contract_reference]);
      if (c.project_start_date)  refRows.push(['Fecha inicio', fmtDate(c.project_start_date)]);

      const refTable = refRows.length > 0 ? new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE }, insideH: { style: BorderStyle.NONE }, insideV: { style: BorderStyle.NONE } },
        rows: [
          new TableRow({
            children: refRows.map(([label, value]) => [
              new TableCell({
                width: { size: 20, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: label, bold: true, size: 18, color: COLOR_PRIMARY, font: 'Calibri' })], spacing: { before: 60, after: 60 } })],
                shading: { type: ShadingType.SOLID, color: COLOR_ACCENT },
                margins: { top: 60, bottom: 60, left: 150, right: 100 },
                borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
              }),
              new TableCell({
                width: { size: 30, type: WidthType.PERCENTAGE },
                children: [new Paragraph({ children: [new TextRun({ text: value, size: 18, font: 'Calibri', color: '333333' })], spacing: { before: 60, after: 60 } })],
                margins: { top: 60, bottom: 60, left: 100, right: 150 },
                borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
              }),
            ]).flat(),
          }),
        ],
      }) : null;

      // ─── Línea divisoria (tabla de 1 celda coloreada) ─────────────────
      const divider = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
        rows: [new TableRow({ children: [new TableCell({
          children: [new Paragraph({ children: [new TextRun({ text: '' })] })],
          shading: { type: ShadingType.SOLID, color: COLOR_SECONDARY },
          borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          margins: { top: 0, bottom: 0 },
        })] })],
      });

      // ─── Bloque destinatario ──────────────────────────────────────────
      const recipientBlock = [
        new Paragraph({ children: [new TextRun({ text: c.recipient_name || '', bold: true, size: 22, color: COLOR_PRIMARY, font: 'Calibri' })], spacing: { after: 40 } }),
        c.recipient_title ? new Paragraph({ children: [new TextRun({ text: c.recipient_title, size: 20, font: 'Calibri', color: '555555' })], spacing: { after: 40 } }) : null,
        c.recipient_entity ? new Paragraph({ children: [new TextRun({ text: c.recipient_entity, size: 20, font: 'Calibri', color: '555555' })], spacing: { after: 40 } }) : null,
        c.recipient_address ? new Paragraph({ children: [new TextRun({ text: c.recipient_address, size: 20, font: 'Calibri', color: '555555' })], spacing: { after: 40 } }) : null,
        new Paragraph({ children: [new TextRun({ text: c.recipient_city || 'Bogotá D.C.', size: 20, font: 'Calibri', color: '555555' })], spacing: { after: 40 } }),
      ].filter(Boolean);

      // ─── Asunto ──────────────────────────────────────────────────────
      const subjectBlock = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
        rows: [new TableRow({ children: [
          new TableCell({
            width: { size: 15, type: WidthType.PERCENTAGE },
            children: [new Paragraph({ children: [new TextRun({ text: 'ASUNTO:', bold: true, size: 20, color: COLOR_PRIMARY, font: 'Calibri' })], spacing: { before: 80, after: 80 } })],
            shading: { type: ShadingType.SOLID, color: COLOR_ACCENT },
            margins: { top: 80, bottom: 80, left: 150, right: 100 },
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: c.subject, bold: true, size: 20, font: 'Calibri', color: '1A1A1A' })], spacing: { before: 80, after: 80 } })],
            margins: { top: 80, bottom: 80, left: 150, right: 150 },
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          }),
        ]})],
      });

      // ─── Cuerpo del documento (párrafos con rich text / links) ───────
      const { parseHtml: parseBodyHtml } = require('../utils/htmlParser');
      const bodyBlocks = parseBodyHtml(c.body || '');
      const bodyParagraphs = bodyBlocks.map(block => {
        const children = block.segments.map(seg => {
          const runProps = {
            text:      seg.text,
            bold:      seg.bold      || false,
            italics:   seg.italic    || false,
            underline: seg.underline ? { type: UnderlineType.SINGLE } : undefined,
            font:      'Calibri',
            size:      22,
            color:     seg.link ? '0563C1' : '1A1A1A',
          };
          if (seg.link) {
            return new ExternalHyperlink({ link: seg.link, children: [new TextRun(runProps)] });
          }
          return new TextRun(runProps);
        });
        return new Paragraph({
          children,
          spacing:   { after: 160 },
          alignment: AlignmentType.JUSTIFIED,
        });
      });

      // ─── Firma ────────────────────────────────────────────────────────
      // 2 blank rows above the line give ~1 inch of space for the drawn
      // digital signature image (corrSig) so it does not overlap the typed name below.
      const blankCell = (h = 400) => new TableRow({ children: [new TableCell({
        children: [new Paragraph({ children: [new TextRun({ text: '' })], spacing: { before: h, after: 0 } })],
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
      })] });
      const signatureTable = new Table({
        width: { size: 60, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
        rows: [
          blankCell(500), // space for drawn signature image (~0.35 in)
          blankCell(500), // extra room (~0.35 in)  — total ≈ 0.7 in above the line
          new TableRow({ children: [new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: '_'.repeat(35), color: COLOR_LINE, size: 22 })], alignment: AlignmentType.LEFT })],
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          })] }),
          blankCell(300), // espacio entre línea y nombre para que stamp corrSig no pise el texto
          new TableRow({ children: [new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: c.sender_name || '', bold: true, size: 22, color: COLOR_PRIMARY, font: 'Calibri' })], spacing: { after: 40 } })],
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          })] }),
          new TableRow({ children: [new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: c.sender_title || '', size: 20, color: '555555', font: 'Calibri' })], spacing: { after: 40 } })],
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          })] }),
          ...((c.sender_entity || c.project_entity) ? [new TableRow({ children: [new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: c.sender_entity || c.project_entity, size: 20, color: '555555', font: 'Calibri' })] })],
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          })] })] : []),
        ],
      });

      // ─── Footer ───────────────────────────────────────────────────────
      const footerTable = new Table({
        width: { size: 100, type: WidthType.PERCENTAGE },
        borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
        rows: [new TableRow({ children: [
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: `${typeLabel} No. ${c.consecutive_code}`, size: 16, color: '888888', font: 'Calibri' })] })],
            shading: { type: ShadingType.SOLID, color: COLOR_ACCENT },
            margins: { top: 60, bottom: 60, left: 150, right: 100 },
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          }),
          new TableCell({
            children: [new Paragraph({ children: [new TextRun({ text: `Generado: ${fmtDate(new Date().toISOString())} · SGIP-IA`, size: 16, color: '888888', font: 'Calibri' })], alignment: AlignmentType.RIGHT })],
            shading: { type: ShadingType.SOLID, color: COLOR_ACCENT },
            margins: { top: 60, bottom: 60, left: 100, right: 150 },
            borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
          }),
        ]})],
      });

      // ─── Armar documento ──────────────────────────────────────────────
      const children = [
        headerTable,
        ...spacer(1),
        divider,
        ...spacer(1),
        // Lugar y fecha
        new Paragraph({
          children: [new TextRun({ text: `${c.recipient_city || 'Bogotá D.C.'}, ${fmtDate(c.reference_date)}`, size: 20, font: 'Calibri', color: '444444' })],
          alignment: AlignmentType.RIGHT,
          spacing: { after: 200 },
        }),
        // Destinatario
        ...recipientBlock,
        ...spacer(1),
        // Asunto y ref
        subjectBlock,
        ...(refTable ? [...spacer(1), refTable] : []),
        ...spacer(1),
        // Saludo
        new Paragraph({
          children: [new TextRun({ text: `Respetado(a) señor(a) ${firstName}:`, size: 22, font: 'Calibri', color: '1A1A1A' })],
          spacing: { after: 200 },
        }),
        // Cuerpo
        ...bodyParagraphs,
        ...spacer(1),
        // Cierre
        new Paragraph({
          children: [new TextRun({ text: c.closing || 'Cordialmente,', size: 22, font: 'Calibri', color: '1A1A1A' })],
          spacing: { after: 600 },
        }),
        // Firma
        signatureTable,
        ...spacer(2),
        // Footer
        footerTable,
      ];

      const doc = new Document({
        styles: {
          default: {
            document: {
              run: { font: 'Calibri', size: 22, color: '1A1A1A' },
              paragraph: { spacing: { line: 276 } },
            },
          },
        },
        sections: [{
          properties: {
            page: {
              margin: {
                top: convertInchesToTwip(1),
                bottom: convertInchesToTwip(1),
                left: convertInchesToTwip(1.2),
                right: convertInchesToTwip(1.2),
              },
            },
          },
          children,
        }],
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

module.exports = router;
