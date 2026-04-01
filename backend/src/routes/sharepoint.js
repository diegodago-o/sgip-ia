/**
 * /api/sharepoint — SharePoint Online per-project file operations
 *
 * GET  /api/sharepoint/test                          → test global connection (admin)
 * GET  /api/sharepoint/projects/:id/files            → list root folder/library
 * POST /api/sharepoint/projects/:id/upload           → upload file (multipart/form-data)
 * GET  /api/sharepoint/projects/:id/download/:itemId → returns { url } for download
 * GET  /api/sharepoint/projects/:id/preview/:itemId  → embed/web preview URL
 *
 * Connection resolution (per project, in order):
 *  1. project.sharepoint_connection_id → load from sharepoint_connections table
 *  2. project.sharepoint_site_url → env credentials + per-project site URL
 *  3. fallback → all SP_* env variables
 */

const express  = require('express');
const multer   = require('multer');
const axios    = require('axios');
const { param, validationResult } = require('express-validator');
const pool     = require('../config/database');
const { authMiddleware, roleMiddleware } = require('../middleware/auth');
const sp       = require('../services/sharepoint');
const { resolveAIConfig } = require('../services/aiConfig');
const aiEngine = require('../services/ai-engine');

const router       = express.Router();
const requireAdmin = roleMiddleware('admin');

const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 100 * 1024 * 1024 }, // 100 MB max
});

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

function validate(req, res) {
  const errors = validationResult(req);
  if (!errors.isEmpty()) { res.status(400).json({ errors: errors.array() }); return false; }
  return true;
}

/** Load project — returns all SP-related fields. */
async function getProject(req, res) {
  const [rows] = await pool.execute(
    `SELECT id, name, sharepoint_folder, sharepoint_site_url,
            sharepoint_connection_id, sharepoint_drive_id
     FROM projects WHERE id = ?`,
    [req.params.id]
  );
  if (!rows.length) { res.status(404).json({ error: 'Proyecto no encontrado' }); return null; }
  return rows[0];
}

/**
 * Resolve the connection object for a project.
 * Priority: DB connection → env + per-project site URL → env fallback.
 */
async function getProjectConn(project) {
  if (project.sharepoint_connection_id) {
    const [rows] = await pool.execute(
      'SELECT * FROM sharepoint_connections WHERE id = ?',
      [project.sharepoint_connection_id]
    );
    if (!rows.length) throw new Error('La conexión SharePoint asignada a este proyecto no fue encontrada.');
    return rows[0];
  }
  // Fallback: env credentials
  return sp.connFromEnv(project.sharepoint_site_url || null);
}

/** Returns true if this project has some form of SP configured. */
function isProjectConfigured(project) {
  return !!(project.sharepoint_connection_id || project.sharepoint_folder);
}

// ─────────────────────────────────────────────
// Auth on all routes
// ─────────────────────────────────────────────
router.use(authMiddleware);

// ─────────────────────────────────────────────
// GET /api/sharepoint/test — test global env-based connection
// ─────────────────────────────────────────────
router.get('/test', requireAdmin, async (req, res) => {
  try {
    if (!sp.isConfigured()) {
      return res.status(503).json({
        error: 'SharePoint no configurado. Agrega SP_TENANT_ID, SP_CLIENT_ID y SP_CLIENT_SECRET en el .env del servidor, o crea conexiones en Configuración → SharePoint.',
      });
    }
    const conn   = sp.connFromEnv();
    const result = await sp.testConnection(conn);
    res.json(result);
  } catch (err) {
    const status = err.response?.status || 500;
    const msg    = err.response?.data?.error?.message || err.message;
    res.status(status).json({ error: `Error conectando con SharePoint: ${msg}` });
  }
});

// ─────────────────────────────────────────────
// GET /api/sharepoint/projects/:id/files
// ─────────────────────────────────────────────
router.get('/projects/:id/files', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const project = await getProject(req, res);
    if (!project) return;

    if (!isProjectConfigured(project)) {
      return res.status(400).json({ error: 'Este proyecto no tiene SharePoint configurado.' });
    }

    const conn     = await getProjectConn(project);
    const driveId  = project.sharepoint_drive_id || null;
    const subpath  = req.query.subpath || '';
    const baseFolder = project.sharepoint_folder || '';
    const folderPath = subpath
      ? `${baseFolder.replace(/\/+$/, '')}/${subpath}`.replace(/^\/+/, '')
      : baseFolder;

    const items = await sp.listFolder(conn, folderPath, driveId);
    res.json({ data: items, folderPath });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg    = err.response?.data?.error?.message || err.message;
    console.error('[sharepoint] listFolder error:', msg);
    res.status(status).json({ error: msg });
  }
});

// ─────────────────────────────────────────────
// POST /api/sharepoint/projects/:id/upload
// ─────────────────────────────────────────────
router.post('/projects/:id/upload', [param('id').isInt()], upload.single('file'), async (req, res) => {
  if (!validate(req, res)) return;
  try {
    if (!req.file) return res.status(400).json({ error: 'No se recibió ningún archivo.' });

    const project = await getProject(req, res);
    if (!project) return;
    if (!isProjectConfigured(project)) {
      return res.status(400).json({ error: 'Este proyecto no tiene SharePoint configurado.' });
    }

    const conn       = await getProjectConn(project);
    const driveId    = project.sharepoint_drive_id || null;
    const baseFolder = project.sharepoint_folder || '';
    const destSub    = req.body.destFolder ? req.body.destFolder.replace(/^\/+/, '') : '';
    const folderPath = destSub
      ? `${baseFolder.replace(/\/+$/, '')}/${destSub}`.replace(/^\/+/, '')
      : baseFolder;

    const result = await sp.uploadFile(
      conn,
      folderPath,
      req.file.originalname,
      req.file.buffer,
      req.file.mimetype,
      driveId
    );
    res.status(201).json({ data: result });
  } catch (err) {
    const status = err.response?.status || 500;
    const msg    = err.response?.data?.error?.message || err.message;
    console.error('[sharepoint] upload error:', msg);
    res.status(status).json({ error: msg });
  }
});

// ─────────────────────────────────────────────
// GET /api/sharepoint/projects/:id/download/:itemId
// Returns { url } — frontend opens in new tab
// ─────────────────────────────────────────────
router.get('/projects/:id/download/:itemId', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const project = await getProject(req, res);
    if (!project) return;

    const conn    = await getProjectConn(project);
    const driveId = project.sharepoint_drive_id || null;
    const url     = await sp.getDownloadUrl(conn, req.params.itemId, driveId);
    res.json({ url });
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────
// GET /api/sharepoint/projects/:id/preview/:itemId
// Returns { url, type } for iframe embed or web fallback
// ─────────────────────────────────────────────
router.get('/projects/:id/preview/:itemId', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const project = await getProject(req, res);
    if (!project) return;

    const conn    = await getProjectConn(project);
    const driveId = project.sharepoint_drive_id || null;
    const result  = await sp.getPreviewUrl(conn, req.params.itemId, driveId);
    res.json(result);
  } catch (err) {
    const msg = err.response?.data?.error?.message || err.message;
    res.status(500).json({ error: msg });
  }
});

// ─────────────────────────────────────────────
// GET /api/sharepoint/projects/:id/coverage
// Returns document coverage stats for a project — reads DB only (no Graph calls)
// ─────────────────────────────────────────────
router.get('/projects/:id/coverage', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const pid = req.params.id;
    const [[deliverables], [policies], [minutes]] = await Promise.all([
      pool.execute(`
        SELECT d.id, d.name, d.sp_item_id
        FROM deliverables d
        JOIN milestones m ON d.milestone_id = m.id
        WHERE m.project_id = ? AND COALESCE(d.status,'') NOT IN ('cancelado')
      `, [pid]),
      pool.execute(`
        SELECT id,
          CONCAT(policy_type, IFNULL(CONCAT(' — No. ', policy_number), '')) AS name,
          sp_item_id
        FROM policies WHERE project_id = ?
      `, [pid]),
      pool.execute(`
        SELECT id, title AS name, sp_item_id
        FROM meeting_minutes
        WHERE project_id = ? AND COALESCE(status,'') != 'archivada'
      `, [pid]),
    ]);

    const summarize = rows => ({
      total:   rows.length,
      linked:  rows.filter(r => r.sp_item_id).length,
      missing: rows.filter(r => !r.sp_item_id).map(r => ({ id: r.id, name: r.name || 'Sin nombre' })),
    });

    res.json({
      deliverables: summarize(deliverables),
      policies:     summarize(policies),
      minutes:      summarize(minutes),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// HELPERS — Text extraction from Buffer (no disk write)
// ─────────────────────────────────────────────────────────────────────────────

async function extractBufferText(buffer, filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();

  // DOCX — adm-zip reads word/document.xml directly from buffer
  if (ext === 'docx') {
    try {
      const AdmZip = require('adm-zip');
      const zip    = new AdmZip(buffer);
      const entry  = zip.getEntry('word/document.xml');
      if (entry) {
        const xml  = entry.getData().toString('utf-8');
        const text = xml
          .replace(/<w:br[^>]*\/>/gi, '\n')
          .replace(/<w:p[ >][^]*?<\/w:p>/gi, m => {
            const inner = m.replace(/<[^>]+>/g, '');
            return inner.trim() ? inner.trim() + '\n' : '\n';
          })
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
          .replace(/\n{3,}/g, '\n\n').trim();
        if (text.length > 30) return { text, method: 'docx' };
      }
    } catch (e) { /* fallback below */ }
    return { text: '', method: 'failed' };
  }

  // XLSX — xlsx library supports buffers
  if (['xlsx', 'xls'].includes(ext)) {
    try {
      const XLSX  = require('xlsx');
      const wb    = XLSX.read(buffer, { type: 'buffer' });
      const lines = [];
      wb.SheetNames.forEach(name => {
        lines.push(`\n=== HOJA: ${name} ===`);
        const ws   = wb.Sheets[name];
        const rows = XLSX.utils.sheet_to_csv(ws);
        lines.push(rows);
      });
      return { text: lines.join('\n').trim(), method: 'xlsx' };
    } catch (e) { return { text: '', method: 'failed' }; }
  }

  // PDF — pdf-parse if available, else base64 for vision
  if (ext === 'pdf') {
    try {
      const pdfParse = require('pdf-parse');
      const result   = await pdfParse(buffer);
      if (result.text && result.text.length > 30) return { text: result.text, method: 'pdf' };
    } catch (e) { /* fallback to vision */ }
    // Vision fallback
    return { base64: buffer.toString('base64'), mimeType: 'application/pdf', method: 'vision' };
  }

  // Plain text
  if (['txt', 'md', 'csv'].includes(ext)) {
    return { text: buffer.toString('utf-8'), method: 'text' };
  }

  return { text: '', method: 'unsupported' };
}

// ─────────────────────────────────────────────────────────────────────────────
// PROMPTS
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Eres un experto en gestión de proyectos, contratación pública colombiana y análisis documental.
Analizas documentos con profundidad, extraes información estructurada y das recomendaciones concretas.
Siempre respondes en español colombiano profesional. Siempre respondes en JSON válido exacto según el esquema solicitado.`;

function classifyPrompt(text) {
  return `Analiza el siguiente documento y clasifícalo. Responde SOLO con JSON válido, sin texto adicional.

ESQUEMA DE RESPUESTA:
{
  "type": "<tipo_clave>",
  "type_label": "<nombre legible>",
  "confidence": "alta|media|baja",
  "summary": "<resumen de 2-3 oraciones de qué es el documento>",
  "period": "<período o fecha principal si aplica, sino null>",
  "parties": ["<parte 1>", "<parte 2>"],
  "key_value": "<valor monetario principal si existe, sino null>"
}

TIPOS POSIBLES:
- informe_gestion → Informe de Gestión/Avance
- acta → Acta de Comité/Reunión/Sesión
- contrato → Contrato/Otrosí/Convenio/Adición
- entregable → Entregable Técnico/Producto
- correspondencia → Correspondencia/Oficio/Comunicación
- poliza → Póliza de Seguros
- presupuesto → Presupuesto/Cotización/Propuesta Económica
- estudio → Estudio Previo/Técnico/Diagnóstico
- otro → Cualquier otro tipo

DOCUMENTO:
${text.substring(0, 6000)}`;
}

function deepAnalysisPrompt(text, docType) {
  const schemas = {
    informe_gestion: `{
  "avance_fisico": "<% reportado o descripción>",
  "avance_financiero": "<% o valor ejecutado>",
  "periodo": "<período del informe>",
  "logros": ["<logro 1>", "<logro 2>"],
  "alertas": ["<alerta 1>", "<alerta 2>"],
  "compromisos": [{"descripcion":"","responsable":"","fecha_limite":""}],
  "proximas_actividades": ["<actividad 1>"],
  "inconsistencias": ["<inconsistencia vs lo esperado>"],
  "indicadores_clave": [{"nombre":"","valor":"","meta":""}],
  "recomendaciones": ["<recomendación 1>"],
  "riesgo_general": "alto|medio|bajo",
  "resumen_ejecutivo": "<párrafo ejecutivo completo>"
}`,
    acta: `{
  "fecha": "<fecha de la reunión>",
  "tipo_comite": "<tipo>",
  "lugar": "<lugar o modalidad>",
  "asistentes": [{"nombre":"","cargo":"","entidad":""}],
  "compromisos": [{"descripcion":"","responsable":"","fecha_limite":"","prioridad":"alta|media|baja"}],
  "decisiones": ["<decisión 1>"],
  "temas_pendientes": ["<tema pendiente>"],
  "acuerdos_financieros": ["<acuerdo>"],
  "proxima_reunion": "<fecha o periodicidad>",
  "resumen_ejecutivo": "<resumen>"
}`,
    contrato: `{
  "partes": [{"nombre":"","rol":"contratante|contratista|interventor"}],
  "objeto": "<objeto del contrato>",
  "valor": "<valor total>",
  "plazo": "<plazo de ejecución>",
  "fecha_inicio": "<fecha>",
  "fecha_fin": "<fecha>",
  "obligaciones_contratista": ["<obligación>"],
  "obligaciones_contratante": ["<obligación>"],
  "hitos_pago": [{"descripcion":"","porcentaje":"","requisito":""}],
  "clausulas_riesgo": ["<cláusula crítica>"],
  "documentos_exigidos": ["<póliza/informe/etc>"],
  "alertas": ["<alerta contractual>"],
  "resumen_ejecutivo": "<resumen>"
}`,
    entregable: `{
  "nombre_entregable": "<nombre>",
  "version": "<versión>",
  "fecha": "<fecha>",
  "cumplimiento": "completo|parcial|no_cumple",
  "aspectos_cumplidos": ["<aspecto>"],
  "observaciones": ["<observación>"],
  "correcciones_requeridas": ["<corrección>"],
  "estado_sugerido": "aprobado|aprobado_con_observaciones|rechazado",
  "referencias_tecnicas": ["<norma o referencia>"],
  "resumen_ejecutivo": "<resumen>"
}`,
    correspondencia: `{
  "tipo": "<solicitud|respuesta|notificación|requerimiento|otro>",
  "remitente": "<entidad/persona>",
  "destinatario": "<entidad/persona>",
  "fecha": "<fecha>",
  "radicado": "<número si existe>",
  "asunto": "<asunto>",
  "accion_requerida": "<qué se debe hacer>",
  "plazo_respuesta": "<plazo si existe>",
  "referencias_legales": ["<ley/decreto/artículo>"],
  "riesgo_incumplimiento": "alto|medio|bajo",
  "consecuencias_incumplimiento": "<consecuencias>",
  "resumen_ejecutivo": "<resumen>"
}`,
    poliza: `{
  "aseguradora": "<nombre>",
  "tomador": "<nombre>",
  "beneficiario": "<nombre>",
  "tipo_poliza": "<tipo>",
  "numero": "<número>",
  "vigencia_desde": "<fecha>",
  "vigencia_hasta": "<fecha>",
  "valor_asegurado": "<valor>",
  "coberturas": [{"tipo":"","valor":"","vigencia":""}],
  "exclusiones": ["<exclusión>"],
  "alertas": ["<fecha próxima a vencer u observación>"],
  "resumen_ejecutivo": "<resumen>"
}`,
    otro: `{
  "tipo_detectado": "<descripción del tipo>",
  "partes_involucradas": ["<parte>"],
  "fecha_principal": "<fecha>",
  "puntos_clave": ["<punto clave>"],
  "compromisos": [{"descripcion":"","responsable":"","fecha_limite":""}],
  "alertas": ["<alerta>"],
  "recomendaciones": ["<recomendación>"],
  "resumen_ejecutivo": "<resumen>"
}`
  };

  const schema = schemas[docType] || schemas.otro;
  return `Analiza en profundidad el siguiente documento de tipo "${docType}".
Extrae TODA la información relevante. Responde SOLO con JSON válido exacto según el esquema, sin texto adicional.

ESQUEMA:
${schema}

DOCUMENTO COMPLETO:
${text.substring(0, 14000)}`;
}

function actionPrompt(actionType, analysis, text) {
  if (actionType === 'draft_response') {
    return `Basándote en el siguiente análisis de documento, redacta una respuesta formal profesional.
La respuesta debe ser en formato de oficio/comunicación oficial colombiana.
Incluye: encabezado formal, cuerpo con respuesta a cada punto relevante, y cierre.

ANÁLISIS:
${JSON.stringify(analysis, null, 2)}

Responde SOLO con el texto del oficio, sin JSON.`;
  }

  if (actionType === 'validate_legal') {
    return `Valida el siguiente documento frente a la normativa colombiana de contratación pública aplicable.
Responde SOLO con JSON válido:
{
  "marco_normativo": ["<ley/decreto aplicable>"],
  "cumplimientos": [{"requisito":"","estado":"cumple|parcial|incumple","observacion":""}],
  "incumplimientos_criticos": ["<incumplimiento>"],
  "recomendaciones_legales": ["<recomendación>"],
  "concepto_general": "favorable|con_observaciones|desfavorable",
  "conclusion": "<párrafo de conclusión legal>"
}

ANÁLISIS DEL DOCUMENTO:
${JSON.stringify(analysis, null, 2)}

TEXTO ORIGINAL (fragmento):
${(text || '').substring(0, 4000)}`;
  }

  if (actionType === 'risk_analysis') {
    return `Realiza un análisis profundo de riesgos del siguiente documento.
Responde SOLO con JSON válido:
{
  "riesgos": [{"categoria":"legal|financiero|tecnico|cronograma|cumplimiento","descripcion":"","probabilidad":"alta|media|baja","impacto":"alto|medio|bajo","nivel":"critico|importante|moderado|bajo","mitigacion":""}],
  "riesgo_general": "critico|alto|medio|bajo",
  "acciones_inmediatas": ["<acción urgente>"],
  "resumen_riesgos": "<párrafo ejecutivo de riesgos>"
}

ANÁLISIS DEL DOCUMENTO:
${JSON.stringify(analysis, null, 2)}`;
  }

  return '';
}

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/sharepoint/projects/:id/analyze/:itemId
// Body: { step: 'classify'|'analyze'|'action', doc_type?, action_type?, analysis? }
// ─────────────────────────────────────────────────────────────────────────────
router.post('/projects/:id/analyze/:itemId', [param('id').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const { step = 'classify', doc_type, action_type, analysis: prevAnalysis } = req.body;
    const { provider, apiKey, model } = await resolveAIConfig(req.body, req.query, req.user?.id);

    // For action steps we don't need to re-download the file
    if (step === 'action') {
      if (!action_type || !prevAnalysis) return res.status(400).json({ error: 'action_type y analysis son requeridos' });
      const prompt  = actionPrompt(action_type, prevAnalysis, prevAnalysis._raw_text || '');
      const isJSON  = action_type !== 'draft_response';
      const result  = await aiEngine.callLLM(provider, apiKey, model, SYSTEM_PROMPT, prompt, { temperature: 0.2, maxTokens: 4000 });
      if (isJSON) {
        try { return res.json({ data: JSON.parse(result), provider }); } catch { /* fall through */ }
      }
      return res.json({ data: { text: result }, provider });
    }

    // Steps 'classify' and 'analyze' require downloading the file
    const project = await getProject(req, res);
    if (!project) return;
    if (!isProjectConfigured(project)) return res.status(400).json({ error: 'Sin SharePoint configurado' });

    const conn     = await getProjectConn(project);
    const driveId  = project.sharepoint_drive_id || null;
    const itemId   = req.params.itemId;

    // 1. Get temporary download URL from Graph API
    const downloadUrl = await sp.getDownloadUrl(conn, itemId, driveId);

    // 2. Fetch file bytes directly (server→SharePoint, no client involved)
    const fileResp = await axios.get(downloadUrl, { responseType: 'arraybuffer', timeout: 30000 });
    const buffer   = Buffer.from(fileResp.data);

    // 3. Get filename from content-disposition or item metadata
    const contentDisp = fileResp.headers['content-disposition'] || '';
    const fnMatch     = contentDisp.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    const filename    = fnMatch ? fnMatch[1].replace(/['"]/g, '') : (req.query.filename || 'documento.pdf');

    // 4. Extract text
    const extracted = await extractBufferText(buffer, filename);

    if (extracted.method === 'unsupported') {
      return res.status(400).json({ error: 'Formato no soportado para análisis. Use PDF, DOCX, XLSX o TXT.' });
    }

    let text = extracted.text || '';

    // Vision fallback for PDFs without embedded text
    if (extracted.method === 'vision') {
      const vPrompt = step === 'classify'
        ? classifyPrompt('[Documento PDF — analizar visualmente]')
        : deepAnalysisPrompt('[Documento PDF — analizar visualmente]', doc_type || 'otro');

      let vResult;
      if (provider === 'anthropic') {
        const r = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
          body: JSON.stringify({ model, max_tokens: 4096, system: SYSTEM_PROMPT,
            messages: [{ role: 'user', content: [
              { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: extracted.base64 } },
              { type: 'text', text: vPrompt },
            ]}] }),
        });
        const d = await r.json();
        vResult = d.content?.map(b => b.text || '').join('') || '';
      } else {
        // OpenAI doesn't support PDF vision — convert prompt to text analysis
        return res.status(400).json({ error: 'Este PDF no tiene texto extraíble. Configura Claude para analizarlo visualmente, o use un DOCX.' });
      }
      try {
        return res.json({ data: JSON.parse(vResult), provider, meta: { method: 'vision', filename } });
      } catch {
        return res.json({ data: { raw: vResult }, provider, meta: { method: 'vision', filename } });
      }
    }

    if (!text || text.length < 30) {
      return res.status(400).json({ error: 'No se pudo extraer texto del documento.' });
    }

    // 5. Build prompt and call AI
    const prompt = step === 'classify'
      ? classifyPrompt(text)
      : deepAnalysisPrompt(text, doc_type || 'otro');

    const raw = await aiEngine.callLLM(provider, apiKey, model, SYSTEM_PROMPT, prompt, { temperature: 0.1, maxTokens: 5000 });

    let parsed;
    try {
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : raw);
    } catch {
      parsed = { raw };
    }

    // Attach raw text excerpt for later action prompts
    if (step === 'analyze') parsed._raw_text = text.substring(0, 3000);

    res.json({ data: parsed, provider, model, meta: { method: extracted.method, chars: text.length, filename } });
  } catch (err) {
    console.error('[SP analyze]', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
