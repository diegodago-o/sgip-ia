const express = require('express');
const { body, param, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const aiEngine = require('../services/ai-engine');
const multer = require('multer');
const fs = require('fs');
const path = require('path');

const { resolveAIConfig, loadSystemAIConfig } = require('../services/aiConfig');

const router = express.Router();
router.use(authMiddleware);

function validate(req, res) {
  const e = validationResult(req);
  if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; }
  return true;
}

// Thin wrapper so call sites stay clean
async function getAIConfig(req) {
  return resolveAIConfig(req.body, req.query, req.user?.id);
}

// ═══════════════════════════════════════════════════════
// FILE TEXT EXTRACTION — PDF, DOCX, XLSX, TXT, images
// ═══════════════════════════════════════════════════════

async function extractTextFromFile(filePath, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  const buffer = fs.readFileSync(filePath);

  // PDF
  if (ext === '.pdf') return extractTextFromPDF(buffer);

  // DOCX (Word) — extract via adm-zip reading word/document.xml
  if (ext === '.docx') {
    try {
      const AdmZip = require('adm-zip');
      const zip = new AdmZip(buffer);
      const entry = zip.getEntry('word/document.xml');
      if (entry) {
        const xml = entry.getData().toString('utf-8');
        const text = xml
          .replace(/<w:br[^>]*\/>/gi, '\n')
          .replace(/<w:p[ >][^]*?<\/w:p>/gi, (m) => {
            const inner = m.replace(/<[^>]+>/g, '');
            return inner.trim() ? inner.trim() + '\n' : '\n';
          })
          .replace(/<[^>]+>/g, '')
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/\n{3,}/g, '\n\n')
          .trim();
        console.log(`[DOCX] OK: ${text.length} chars`);
        if (text.length > 30) return { text, method: 'docx' };
      }
    } catch (e) { console.log(`[DOCX] Failed: ${e.message}`); }
    return { text: '', method: 'failed' };
  }

  // XLSX/XLS (Excel)
  if (['.xlsx', '.xls'].includes(ext)) return extractTextFromExcel(buffer);

  // Plain text
  if (['.txt', '.md', '.csv'].includes(ext)) {
    const text = buffer.toString('utf-8');
    console.log(`[TXT] OK: ${text.length} chars`);
    return { text, method: 'text' };
  }

  // Images — vision API
  if (['.png', '.jpg', '.jpeg', '.webp'].includes(ext)) {
    const base64 = buffer.toString('base64');
    const mimeType = ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
    return { base64, method: 'vision', mimeType };
  }

  // Unknown — try as text
  try {
    const text = buffer.toString('utf-8');
    if (text.length > 30 && !/[\x00-\x08\x0E-\x1F]/.test(text.substring(0, 200))) {
      return { text, method: 'text' };
    }
  } catch {}
  return { text: '', method: 'failed' };
}

async function extractTextFromPDF(buffer) {
  // Method 1: pdf-parse
  try {
    const pdfModule = require('pdf-parse');
    let data = null;
    if (typeof pdfModule === 'function') data = await pdfModule(buffer);
    else if (pdfModule.default && typeof pdfModule.default === 'function') data = await pdfModule.default(buffer);
    if (data?.text?.trim().length > 50) {
      console.log(`[PDF] pdf-parse OK: ${data.numpages || '?'} pág, ${data.text.trim().length} chars`);
      return { text: data.text.trim(), method: 'pdf-parse' };
    }
  } catch (e) { console.log(`[PDF] pdf-parse error: ${e.message}`); }

  // Method 2: Raw BT/ET
  try {
    const pdfText = buffer.toString('latin1');
    const chunks = [];
    const btEt = /BT[\s\S]*?ET/g;
    let m;
    while ((m = btEt.exec(pdfText)) !== null) {
      const tj = /\(([^)]*)\)\s*Tj/g; let t;
      while ((t = tj.exec(m[0])) !== null) chunks.push(t[1]);
      const tjArr = /\[([^\]]*)\]\s*TJ/g;
      while ((t = tjArr.exec(m[0])) !== null) {
        const parts = t[1].match(/\(([^)]*)\)/g);
        if (parts) chunks.push(parts.map(p => p.slice(1, -1)).join(''));
      }
    }
    const raw = chunks.join(' ').replace(/\\n/g, '\n');
    if (raw.length > 100) { console.log(`[PDF] Raw BT/ET: ${raw.length} chars`); return { text: raw, method: 'raw-extract' }; }
  } catch (e) { console.log(`[PDF] Raw error: ${e.message}`); }

  // Method 3: base64 for vision
  console.log('[PDF] Texto no extraíble — fallback a vision');
  return { base64: buffer.toString('base64'), method: 'vision', mimeType: 'application/pdf' };
}

async function extractTextFromExcel(buffer) {
  try {
    const ExcelJS = require('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    const lines = [];
    let sheetCount = 0;
    wb.eachSheet(sheet => {
      sheetCount++;
      lines.push(`\n=== HOJA: ${sheet.name} ===`);
      sheet.eachRow(row => {
        const cells = row.values.slice(1).map(v => (v === null || v === undefined) ? '' : String(typeof v === 'object' && v.result !== undefined ? v.result : v));
        lines.push(cells.join(' | '));
      });
    });
    const text = lines.join('\n').trim();
    console.log(`[XLSX] OK: ${text.length} chars, ${sheetCount} sheets`);
    return { text, method: 'xlsx' };
  } catch (e) { console.log(`[XLSX] Failed: ${e.message}`); return { text: '', method: 'failed' }; }
}

// Vision API call
async function callVisionAPI(provider, apiKey, model, base64Data, mimeType, promptText) {
  if (provider === 'openai') {
    if (mimeType === 'application/pdf') throw new Error('PDF requiere procesamiento visual. Use Claude o convierta a Word.');
    const messages = [
      { role: 'system', content: 'Eres un experto en análisis de documentos de contratación pública colombiana.' },
      { role: 'user', content: [
        { type: 'text', text: promptText },
        { type: 'image_url', image_url: { url: `data:${mimeType};base64,${base64Data}`, detail: 'high' } },
      ]},
    ];
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: model || 'gpt-4o', messages, max_completion_tokens: 4096, temperature: 0.1 }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`OpenAI Vision: ${err}`); }
    const data = await res.json();
    return data.choices[0].message.content;
  } else {
    const contentType = mimeType === 'application/pdf' ? 'document' : 'image';
    const messages = [{ role: 'user', content: [
      { type: contentType, source: { type: 'base64', media_type: mimeType, data: base64Data } },
      { type: 'text', text: promptText },
    ]}];
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model: model || 'claude-sonnet-4-20250514', max_tokens: 4096,
        system: 'Eres un experto en análisis de documentos de contratación pública colombiana.', messages, temperature: 0.1 }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`Anthropic Vision: ${err}`); }
    const data = await res.json();
    return data.content.map(b => b.text || '').join('');
  }
}

// ═══════════════════════════════════════════════════════
// 1. ANALYZE DOCUMENT — Upload file → AI analyzes
// ═══════════════════════════════════════════════════════
const upload = multer({ dest: path.join(__dirname, '../../uploads/tmp'), limits: { fileSize: 15 * 1024 * 1024 } });

router.post('/extract', upload.single('file'), async (req, res) => {
  try {
    const { provider, apiKey, model } = await getAIConfig(req);
    let text = req.body.text || '';
    let method = 'manual-text';

    if (req.file) {
      const result = await extractTextFromFile(req.file.path, req.file.originalname);
      try { fs.unlinkSync(req.file.path); } catch {}

      if (result.method === 'vision') {
        if (provider === 'openai' && result.mimeType === 'application/pdf') {
          return res.status(400).json({ error: 'PDF requiere procesamiento visual. Use Claude o convierta a Word.' });
        }
        const analysisPrompt = req.body.analysis_prompt || 'Analiza este documento a fondo.';
        const vResult = await callVisionAPI(provider, apiKey, model, result.base64, result.mimeType, analysisPrompt);
        return res.json({ data: { analysis: vResult }, provider, model, meta: { method: 'vision' } });
      }

      if (result.method === 'failed' || !result.text || result.text.length < 30) {
        return res.status(400).json({ error: 'No se pudo extraer texto. Formatos: PDF, DOCX, XLSX, TXT. Instale: npm install adm-zip xlsx' });
      }

      text = result.text;
      method = result.method;
      console.log(`[EXTRACT] ${method}: ${text.length} chars from ${req.file.originalname}`);
    }

    if (!text || text.trim().length < 30) {
      return res.status(400).json({ error: 'Texto insuficiente. Suba un archivo o pegue el contenido.' });
    }

    const analysisPrompt = req.body.analysis_prompt;
    const extractionType = req.body.extraction_type;

    if (analysisPrompt || extractionType === 'analyze') {
      // ANALYSIS MODE — natural language (ChatGPT-style)
      const userPrompt = analysisPrompt || 'Analiza este documento a fondo y dame un resumen completo.';
      const systemPrompt = `Eres un experto en contratación pública colombiana y gestión de proyectos.
Analiza documentos de forma detallada y profesional.

REGLAS:
- Responde en español colombiano profesional
- Sé exhaustivo pero organizado
- Usa encabezados, numeración y estructura clara
- Cita datos específicos del documento (valores, fechas, nombres)
- Si identificas riesgos o alertas, resáltalos claramente
- Da recomendaciones prácticas cuando sea pertinente`;

      const safeText = aiEngine.truncateText(text, (aiEngine.MAX_INPUT_TOKENS[provider] || 15000) - 2000);
      const fullPrompt = `DOCUMENTO A ANALIZAR:\n\n${safeText}\n\nINSTRUCCIÓN: ${userPrompt}`;

      const analysis = await aiEngine.callLLM(provider, apiKey, model, systemPrompt, fullPrompt, {
        temperature: 0.3, maxTokens: 6000,
      });

      await pool.execute(
        'INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
        [req.user.id, 'ai_analyze_doc', 'document', 0, JSON.stringify({ provider, model, method, chars: text.length })]
      );
      return res.json({ data: { analysis }, provider, model, meta: { method, chars: text.length } });
    }

    // STRUCTURED MODE — JSON extraction (legacy)
    const aiResult = await aiEngine.extractFromDocument(provider, apiKey, model, text, extractionType || 'general');
    await pool.execute(
      'INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
      [req.user.id, 'ai_extract', 'document', 0, JSON.stringify({ provider, model, extraction_type: extractionType, method, chars: text.length })]
    );
    res.json({ data: aiResult, provider, model, meta: { method, chars: text.length } });
  } catch (err) {
    console.error('AI Extract error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══ 2. GENERATE ═══
router.post('/:projectId/generate',
  [param('projectId').isInt(), body('document_type').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { provider, apiKey, model } = await getAIConfig(req);
      const result = await aiEngine.generateDocument(provider, apiKey, model, req.params.projectId, req.body.document_type, req.body.instructions || '');
      await pool.execute('INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
        [req.user.id, 'ai_generate', 'project', parseInt(req.params.projectId), JSON.stringify({ provider, model, doc_type: req.body.document_type })]);
      res.json({ data: { content: result }, provider, model });
    } catch (err) { console.error('AI Generate error:', err.message); res.status(500).json({ error: err.message }); }
  });

// ═══ 3. ANALYZE PROJECT ═══
router.post('/:projectId/analyze', [param('projectId').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { provider, apiKey, model } = await getAIConfig(req);
      const result = await aiEngine.analyzeProject(provider, apiKey, model, req.params.projectId);
      await pool.execute('INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
        [req.user.id, 'ai_analyze', 'project', parseInt(req.params.projectId), JSON.stringify({ provider, model })]);
      res.json({ data: result, provider, model });
    } catch (err) { console.error('AI Analyze error:', err.message); res.status(500).json({ error: err.message }); }
  });

// ═══ 4. CHAT ═══
router.post('/:projectId/chat',
  [param('projectId').isInt(), body('message').trim().notEmpty()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const { provider, apiKey, model } = await getAIConfig(req);
      const messages = [];
      if (req.body.history && Array.isArray(req.body.history)) {
        req.body.history.forEach(m => messages.push({ role: m.role, content: m.content }));
      }
      messages.push({ role: 'user', content: req.body.message });
      const result = await aiEngine.chatWithProject(provider, apiKey, model, req.params.projectId, messages);
      res.json({ data: { response: result }, provider, model });
    } catch (err) { console.error('AI Chat error:', err.message); res.status(500).json({ error: err.message }); }
  });

// ═══ 5. SETTINGS — reports whether system key is configured (env or DB) ═══
router.get('/settings', async (req, res) => {
  try {
    const sysCfg = await loadSystemAIConfig();
    const anthropicReady = !!(process.env.ANTHROPIC_API_KEY || sysCfg.anthropic_api_key);
    const openaiReady    = !!(process.env.OPENAI_API_KEY    || sysCfg.openai_api_key);
    res.json({ data: {
      anthropic_configured: anthropicReady,
      openai_configured:    openaiReady,
      // 'env' | 'system' | 'none' — tells the UI which source is active
      anthropic_source: process.env.ANTHROPIC_API_KEY ? 'env' : (sysCfg.anthropic_api_key ? 'system' : 'none'),
      openai_source:    process.env.OPENAI_API_KEY    ? 'env' : (sysCfg.openai_api_key    ? 'system' : 'none'),
      default_provider: process.env.AI_PROVIDER || sysCfg.default_provider || 'anthropic',
      anthropic_model:  process.env.ANTHROPIC_MODEL || sysCfg.anthropic_model || 'claude-sonnet-4-20250514',
      openai_model:     process.env.OPENAI_MODEL    || sysCfg.openai_model    || 'gpt-4o',
    }});
  } catch { res.json({ data: { anthropic_configured: false, openai_configured: false } }); }
});

// ═══════════════════════════════════════════════════════
// 6. EXTRACT PROJECT FROM CONTRACT — pre-fill project form
// ═══════════════════════════════════════════════════════
router.post('/extract-project', upload.single('file'), async (req, res) => {
  try {
    const { provider, apiKey, model } = await getAIConfig(req);
    let text = req.body.text || '';
    let method = 'manual-text';
    let base64Data = null;
    let mimeType = null;

    if (req.file) {
      const result = await extractTextFromFile(req.file.path, req.file.originalname);
      try { fs.unlinkSync(req.file.path); } catch {}
      if (result.method === 'vision') {
        base64Data = result.base64;
        mimeType   = result.mimeType;
        method     = 'vision';
      } else {
        text   = result.text;
        method = result.method;
      }
    }

    const SCHEMA = `{
  "name": "Nombre corto del proyecto (máx 80 chars, basado en el objeto del contrato)",
  "project_type": "obra_civil | ti | consultoria | interventoria | asesoria | mixto | otro",
  "sector": "publico | privado",
  "client_name": "Nombre del contratante / entidad",
  "client_nit": "NIT del contratante (solo dígitos y guión)",
  "contract_number": "Número o referencia del contrato",
  "contract_object": "Objeto completo del contrato",
  "contract_value": 0,
  "sign_date": "YYYY-MM-DD o null",
  "start_date": "YYYY-MM-DD o null",
  "execution_term": 0,
  "execution_term_unit": "dias_calendario | dias_habiles | meses | anos",
  "supervisor": "Nombre del supervisor o null",
  "location": "Municipio o departamento o null",
  "selection_process": "licitacion | concurso_meritos | minima_cuantia | contratacion_directa | otro | null",
  "secop_number": "Número SECOP o null",
  "cdp_number": "Número CDP o null",
  "rp_number": "Número RP o null",
  "confidence": 85,
  "missing_fields": ["campo1", "campo2"]
}`;

    const systemPrompt = 'Eres un experto en contratación pública y privada colombiana. Extraes datos de contratos en JSON estricto.';

    const buildPrompt = (docContent) =>
      `Analiza el siguiente documento contractual y extrae los datos del proyecto.\n\nDOCUMENTO:\n${docContent}\n\n` +
      `Devuelve ÚNICAMENTE el siguiente JSON (sin markdown, sin texto adicional):\n${SCHEMA}\n\n` +
      `REGLAS:\n` +
      `- Responde SOLO con el JSON\n` +
      `- Si no encuentras un campo usa null\n` +
      `- Fechas en formato YYYY-MM-DD\n` +
      `- contract_value: número entero o float (sin puntos de miles, sin símbolo $)\n` +
      `- execution_term: número entero\n` +
      `- sector "publico" si el contratante es entidad estatal (alcaldía, gobernación, ministerio, empresa del estado)\n` +
      `- project_type según palabras clave: obra_civil=construcción/infraestructura, ti=software/sistemas, consultoria=estudios/consulta, interventoria=supervisión/control, asesoria=asesoramiento`;

    let content;
    if (method === 'vision') {
      content = await callVisionAPI(provider, apiKey, model, base64Data, mimeType, buildPrompt('[ver documento adjunto]'));
    } else {
      if (!text || text.trim().length < 30) {
        return res.status(400).json({ error: 'Texto insuficiente. Suba un PDF, DOCX o pegue el contenido del contrato.' });
      }
      const safeText = aiEngine.truncateText(text, (aiEngine.MAX_INPUT_TOKENS[provider] || 15000) - 2000);
      content = await aiEngine.callLLM(provider, apiKey, model, systemPrompt, buildPrompt(safeText), { temperature: 0.1, maxTokens: 2048 });
    }

    // Parse JSON from AI response
    let extracted = {};
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) extracted = JSON.parse(jsonMatch[0]);
      else throw new Error('no JSON found');
    } catch {
      return res.status(422).json({ error: 'No se pudo interpretar la respuesta. Intente nuevamente.' });
    }

    // Normalize numeric types
    if (extracted.contract_value != null) {
      const n = typeof extracted.contract_value === 'string'
        ? parseFloat(extracted.contract_value.replace(/[^0-9.]/g, ''))
        : Number(extracted.contract_value);
      extracted.contract_value = isNaN(n) ? null : n;
    }
    if (extracted.execution_term != null) {
      extracted.execution_term = parseInt(extracted.execution_term) || null;
    }

    await pool.execute(
      'INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
      [req.user.id, 'ai_extract_project', 'project', 0,
        JSON.stringify({ provider, model, method, chars: text.length, confidence: extracted.confidence })]
    );

    res.json({ data: extracted, provider, model, meta: { method, chars: text.length } });
  } catch (err) {
    console.error('AI Extract-Project error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
