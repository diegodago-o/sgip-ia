/**
 * SGIP-IA · AI Auto-Populate
 * Reads uploaded contract documents and auto-fills project modules
 */
const express = require('express');
const { param } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware } = require('../middleware/auth');
const fs = require('fs');
const path = require('path');

const { resolveAIConfig } = require('../services/aiConfig');

const router = express.Router();
router.use(authMiddleware);

async function getAIConfig(req) {
  return resolveAIConfig(req.body, req.query, req.user?.id);
}

// Provider-agnostic LLM call
async function callLLM(provider, apiKey, model, systemPrompt, userContent, maxTokens = 4096) {
  if (provider === 'anthropic') {
    const body = {
      model, max_tokens: maxTokens, system: systemPrompt,
      messages: [{ role: 'user', content: userContent }], temperature: 0.1,
    };
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${err}`); }
    const data = await res.json();
    return data.content.map(b => b.text || '').join('');
  } else {
    // OpenAI
    const messages = [
      { role: 'system', content: systemPrompt },
    ];
    // userContent can be string or array (for vision)
    if (typeof userContent === 'string') {
      messages.push({ role: 'user', content: userContent });
    } else if (Array.isArray(userContent)) {
      messages.push({ role: 'user', content: userContent });
    }
    const body = {
      model: model || 'gpt-4o', messages,
      max_completion_tokens: maxTokens, temperature: 0.1,
    };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`OpenAI API error ${res.status}: ${err}`); }
    const data = await res.json();
    return data.choices[0].message.content;
  }
}

// Call with PDF documents (vision)
async function callLLMWithDocs(provider, apiKey, model, systemPrompt, textContent, pdfBuffers, maxTokens = 4096) {
  if (provider === 'anthropic') {
    // Anthropic supports PDFs natively
    const content = [];
    for (const pdf of pdfBuffers) {
      content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: pdf.base64 } });
    }
    if (textContent) content.push({ type: 'text', text: textContent });
    
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: maxTokens, system: systemPrompt, messages: [{ role: 'user', content }], temperature: 0.1 }),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`Anthropic API error ${res.status}: ${err}`); }
    const data = await res.json();
    return data.content.map(b => b.text || '').join('');
  } else {
    // OpenAI: PDFs not supported natively. Try to convert to images.
    const content = [];
    
    for (const pdf of pdfBuffers) {
      // Try pdf-to-img conversion
      const images = await convertPDFToImages(Buffer.from(pdf.base64, 'base64'), pdf.name);
      if (images.length > 0) {
        console.log(`   Convertido ${pdf.name} → ${images.length} imágenes para OpenAI vision`);
        // Send first N pages (limit to avoid token overflow, each image ~800 tokens)
        const maxPages = Math.min(images.length, 15);
        for (let i = 0; i < maxPages; i++) {
          content.push({ type: 'image_url', image_url: { url: `data:image/png;base64,${images[i]}`, detail: 'high' } });
        }
        if (images.length > maxPages) {
          content.push({ type: 'text', text: `[Nota: se enviaron ${maxPages} de ${images.length} páginas del documento "${pdf.name}". Las páginas restantes fueron omitidas por límites de tokens.]` });
        }
      } else {
        content.push({ type: 'text', text: `[No se pudo procesar el PDF "${pdf.name}" — es un documento escaneado. Para mejores resultados use Claude (Anthropic) que lee PDFs nativamente, o suba el documento como imágenes JPG/PNG.]` });
      }
    }
    
    if (textContent) content.push({ type: 'text', text: textContent });
    
    if (content.length === 0) {
      throw new Error('No se pudo procesar ningún documento para OpenAI. Los PDFs escaneados funcionan mejor con Claude (Anthropic).');
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ];
    const body = { model: model || 'gpt-4o', messages, max_completion_tokens: maxTokens, temperature: 0.1 };
    const res = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const err = await res.text(); throw new Error(`OpenAI API error ${res.status}: ${err}`); }
    const data = await res.json();
    return data.choices[0].message.content;
  }
}

// Convert PDF pages to PNG base64 images
async function convertPDFToImages(pdfBuffer, fileName) {
  const images = [];
  
  // Method 1: Try pdf-poppler (needs system poppler installed)
  try {
    const { Poppler } = require('node-poppler');
    const poppler = new Poppler();
    const tmpDir = path.join(__dirname, '..', '..', 'uploads', 'tmp');
    if (!fs.existsSync(tmpDir)) fs.mkdirSync(tmpDir, { recursive: true });
    
    const tmpPdf = path.join(tmpDir, `tmp_${Date.now()}.pdf`);
    fs.writeFileSync(tmpPdf, pdfBuffer);
    
    const options = { pngFile: true, singleFile: false, resolutionXYAxis: 150 };
    const outPrefix = path.join(tmpDir, `img_${Date.now()}`);
    await poppler.pdfToCairo(tmpPdf, outPrefix, options);
    
    // Read generated images
    const tmpFiles = fs.readdirSync(tmpDir).filter(f => f.startsWith(path.basename(outPrefix)) && f.endsWith('.png'));
    for (const f of tmpFiles.sort()) {
      const imgBuf = fs.readFileSync(path.join(tmpDir, f));
      images.push(imgBuf.toString('base64'));
      fs.unlinkSync(path.join(tmpDir, f));
    }
    try { fs.unlinkSync(tmpPdf); } catch {}
    
    if (images.length > 0) return images;
  } catch (e) {
    console.log(`   node-poppler no disponible: ${e.message}`);
  }

  // Method 2: Try pdf2pic
  try {
    const { fromBuffer } = require('pdf2pic');
    const converter = fromBuffer(pdfBuffer, {
      density: 150, format: 'png', width: 1200, height: 1600,
      savePath: path.join(__dirname, '..', '..', 'uploads', 'tmp'),
    });
    
    // Get page count (try up to 20 pages)
    for (let page = 1; page <= 20; page++) {
      try {
        const result = await converter(page, { responseType: 'base64' });
        if (result?.base64) {
          images.push(result.base64);
        } else break;
      } catch { break; }
    }
    if (images.length > 0) return images;
  } catch (e) {
    console.log(`   pdf2pic no disponible: ${e.message}`);
  }

  // Method 3: No converter available — try a basic approach
  // Just return empty, the caller will handle the fallback message
  console.log(`   ⚠️ No se pudo convertir "${fileName}" a imágenes. Instale: npm install pdf2pic graphicsmagick`);
  return images;
}

async function extractPDFText(filePath) {
  const buffer = fs.readFileSync(filePath);

  // Method 1: pdf-parse
  try {
    const pdfModule = require('pdf-parse');
    let data = null;
    if (typeof pdfModule === 'function') {
      data = await pdfModule(buffer);
    } else if (typeof pdfModule.PDFParse === 'function') {
      try { data = await pdfModule.PDFParse(buffer); } catch {
        try { const p = new pdfModule.PDFParse(buffer); data = await (p.parse ? p.parse() : p); } catch {}
      }
    } else if (pdfModule.default && typeof pdfModule.default === 'function') {
      data = await pdfModule.default(buffer);
    }
    if (data?.text?.trim().length > 50) {
      console.log(`   pdf-parse OK: ${data.numpages || '?'} pág, ${data.text.trim().length} chars`);
      return { text: data.text.trim(), method: 'pdf-parse' };
    }
  } catch (e) { console.log(`   pdf-parse error: ${e.message}`); }

  // Method 2: Raw BT/ET extraction
  try {
    const pdfText = buffer.toString('latin1');
    const chunks = [];
    const btEt = /BT[\s\S]*?ET/g;
    let m;
    while ((m = btEt.exec(pdfText)) !== null) {
      const tj = /\(([^)]*)\)\s*Tj/g;
      let t;
      while ((t = tj.exec(m[0])) !== null) chunks.push(t[1]);
      const tjArr = /\[([^\]]*)\]\s*TJ/g;
      while ((t = tjArr.exec(m[0])) !== null) {
        const parts = t[1].match(/\(([^)]*)\)/g);
        if (parts) chunks.push(parts.map(p => p.slice(1, -1)).join(''));
      }
    }
    const raw = chunks.join(' ').replace(/\\n/g, '\n').replace(/\\r/g, '');
    if (raw.length > 100) {
      console.log(`   Raw BT/ET: ${raw.length} chars`);
      return { text: raw, method: 'raw-extract' };
    }
  } catch (e) { console.log(`   Raw extract error: ${e.message}`); }

  // Method 3: regex fallback
  try {
    const rawText = buffer.toString('utf-8');
    const chunks = [];
    const re = /\(([^)]+)\)/g;
    let m;
    while ((m = re.exec(rawText)) !== null) {
      if (m[1].length > 2 && /[a-záéíóúñA-ZÁÉÍÓÚÑ0-9\s.,;:]{3,}/i.test(m[1])) chunks.push(m[1]);
    }
    const extracted = chunks.join(' ').trim();
    if (extracted.length > 200) {
      console.log(`   Regex fallback: ${extracted.length} chars`);
      return { text: extracted, method: 'regex' };
    }
  } catch {}

  // Method 4: base64 for vision API
  console.log(`   Texto no extraíble — base64 para lectura visual (${(buffer.length/1024).toFixed(0)} KB)`);
  return { base64: buffer.toString('base64'), method: 'vision' };
}

// ═══════════════════════════════════════════
// POST /api/ai-populate/:projectId/analyze
// Analyze uploaded docs and return structured data preview
// ═══════════════════════════════════════════
router.post('/:projectId/analyze', [param('projectId').isInt()], async (req, res) => {
  try {
    const pid = req.params.projectId;
    const { provider, apiKey, model } = await getAIConfig(req);
    const { doc_ids, modules } = req.body; // modules: ['obligations','risks','team','schedule','budget']

    // Get documents
    let docs;
    if (doc_ids && doc_ids.length > 0) {
      const placeholders = doc_ids.map(() => '?').join(',');
      const [rows] = await pool.execute(`SELECT * FROM documents WHERE id IN (${placeholders}) AND project_id=?`, [...doc_ids, pid]);
      docs = rows;
    } else {
      // Use all project documents
      const [rows] = await pool.execute('SELECT * FROM documents WHERE project_id=? ORDER BY created_at', [pid]);
      docs = rows;
    }

    if (docs.length === 0) return res.status(400).json({ error: 'No hay documentos para analizar' });

    // Get project context
    const [project] = await pool.execute('SELECT * FROM projects WHERE id=?', [pid]);
    const p = project[0];

    // Read document contents
    let allText = '';
    const pdfBuffers = [];
    const readErrors = [];
    const UPLOAD_BASE = path.join(__dirname, '..', '..', 'uploads');

    for (const doc of docs) {
      // Try multiple possible file paths
      let filePath = null;
      const candidates = [
        doc.file_path,
        path.join(UPLOAD_BASE, 'projects', String(pid), doc.file_name),
        path.join(UPLOAD_BASE, 'projects', String(pid), path.basename(doc.file_path || '')),
        doc.file_path ? path.resolve(doc.file_path) : null,
      ].filter(Boolean);

      for (const c of candidates) {
        if (fs.existsSync(c)) { filePath = c; break; }
      }

      if (!filePath) {
        console.log(`⚠️ Doc "${doc.file_name}" (id:${doc.id}) — archivo no encontrado. Intenté:`, candidates);
        readErrors.push(`${doc.file_name}: archivo no encontrado en disco`);
        continue;
      }

      console.log(`✅ Doc "${doc.file_name}" — leyendo de ${filePath} (${(fs.statSync(filePath).size / 1024).toFixed(0)} KB)`);
      
      const ext = path.extname(doc.file_name || '').toLowerCase();
      if (ext === '.pdf') {
        try {
          const result = await extractPDFText(filePath);
          if (result.method === 'vision' && result.base64) {
            // Text extraction failed — send full PDF as base64
            const sizeMB = result.base64.length * 0.75 / (1024 * 1024);
            if (sizeMB > 20) {
              readErrors.push(`${doc.file_name}: PDF demasiado grande (${sizeMB.toFixed(1)}MB)`);
            } else {
              pdfBuffers.push({ name: doc.file_name, base64: result.base64 });
              console.log(`   → base64 para lectura visual (${sizeMB.toFixed(1)}MB)`);
            }
          } else if (result.text && result.text.length > 50) {
            allText += `\n\n=== DOCUMENTO: ${doc.file_name} ===\n${result.text}`;
            console.log(`   → Texto OK: ${result.text.length} chars (${result.method})`);
          } else {
            // Fallback: send as base64
            const buffer = fs.readFileSync(filePath);
            pdfBuffers.push({ name: doc.file_name, base64: buffer.toString('base64') });
            console.log(`   → Poco texto, base64 fallback`);
          }
        } catch (pdfErr) {
          console.log(`   PDF error: ${pdfErr.message}`);
          try {
            const buffer = fs.readFileSync(filePath);
            pdfBuffers.push({ name: doc.file_name, base64: buffer.toString('base64') });
          } catch {}
        }
      } else if (['.txt', '.md', '.csv'].includes(ext)) {
        const text = fs.readFileSync(filePath, 'utf-8');
        allText += `\n\n=== DOCUMENTO: ${doc.file_name} ===\n${text}`;
      } else if (['.xls', '.xlsx'].includes(ext)) {
        try {
          const XLSX = require('xlsx');
          const wb = XLSX.readFile(filePath);
          let excelText = `=== DOCUMENTO EXCEL: ${doc.file_name} ===\n`;
          for (const sheetName of wb.SheetNames) {
            const ws = wb.Sheets[sheetName];
            const csv = XLSX.utils.sheet_to_csv(ws, { blankrows: false });
            if (csv.trim().length > 10) {
              excelText += `\n--- Hoja: ${sheetName} ---\n${csv}\n`;
            }
          }
          if (excelText.length > 100) {
            allText += `\n\n${excelText}`;
            console.log(`   → Excel OK: ${wb.SheetNames.length} hojas, ${excelText.length} chars`);
          } else {
            readErrors.push(`${doc.file_name}: Excel sin contenido legible`);
          }
        } catch (xlsErr) {
          console.log(`   Excel error: ${xlsErr.message}`);
          readErrors.push(`${doc.file_name}: error leyendo Excel — ${xlsErr.message}`);
        }
      } else if (['.doc', '.docx'].includes(ext)) {
        try {
          const AdmZip = require('adm-zip');
          const zip = new AdmZip(filePath);
          const entry = zip.getEntry('word/document.xml');
          if (entry) {
            const xml = entry.getData().toString('utf-8');
            const text = xml
              .replace(/<w:br[^>]*\/>/gi, '\n')
              .replace(/<w:p[ >][^]*?<\/w:p>/gi, m => {
                const inner = m.replace(/<[^>]+>/g, '');
                return inner.trim() ? inner.trim() + '\n' : '\n';
              })
              .replace(/<[^>]+>/g, '')
              .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
              .replace(/\n{3,}/g, '\n\n').trim();
            if (text.length > 50) {
              allText += `\n\n=== DOCUMENTO: ${doc.file_name} ===\n${text}`;
              console.log(`   → DOCX OK: ${text.length} chars`);
            } else {
              readErrors.push(`${doc.file_name}: .docx sin texto extraíble, convierta a PDF`);
            }
          }
        } catch {
          readErrors.push(`${doc.file_name}: formato .docx no soportado, convierta a PDF`);
        }
      }
    }

    console.log(`📊 Resultado lectura: ${allText.length} chars texto, ${pdfBuffers.length} PDFs base64, ${readErrors.length} errores`);

    if (!allText && pdfBuffers.length === 0) {
      return res.status(400).json({ 
        error: 'No se pudo leer el contenido de ningún documento', 
        details: readErrors,
        hint: 'Verifique que los archivos PDF estén subidos correctamente. Los .docx deben convertirse a PDF.'
      });
    }

    const targetModules = modules || ['obligations', 'risks', 'team', 'schedule', 'budget'];

    const systemPrompt = `Eres un asistente experto en gestión de proyectos de infraestructura y contratación pública colombiana.
Analizas documentos contractuales (contratos, anexos técnicos, pliegos) y extraes información estructurada.
Responde ÚNICAMENTE con JSON válido, sin texto adicional ni backticks markdown.`;

    const userPrompt = `Analiza los siguientes documentos del proyecto "${p?.name || ''}" (Contrato: ${p?.code || ''}) y extrae la información para los módulos solicitados.

CONTEXTO DEL PROYECTO:
- Nombre: ${p?.name || 'N/A'}
- Código: ${p?.code || 'N/A'}
- Valor del contrato: ${p?.contract_value || 'N/A'}
- Plazo: ${p?.execution_term || 'N/A'} ${p?.execution_term_unit || 'meses'}

DOCUMENTOS:
${allText}

MÓDULOS A EXTRAER: ${targetModules.join(', ')}

Responde con un JSON con esta estructura exacta (incluye SOLO los módulos solicitados):

{
  ${targetModules.includes('obligations') ? `"obligations": [
    { "description": "descripción de la obligación", "type": "general|especifica|tecnica|administrativa", "priority": "alta|media|baja" }
  ],` : ''}
  ${targetModules.includes('risks') ? `"risks": [
    { "description": "descripción del riesgo", "category": "tecnico|financiero|legal|ambiental|social|operacional", "probability": "alta|media|baja", "impact": "alto|medio|bajo", "mitigation": "estrategia de mitigación sugerida" }
  ],` : ''}
  ${targetModules.includes('team') ? `"team": [
    { "role": "cargo/rol", "quantity": número, "dedication": "tiempo_completo|medio_tiempo|por_horas", "profile": "perfil requerido", "estimated_salary": número_o_null }
  ],` : ''}
  ${targetModules.includes('schedule') ? `"schedule": [
    { "activity": "nombre de la actividad/fase", "start_month": número, "end_month": número, "deliverable": "entregable asociado" }
  ],` : ''}
  ${targetModules.includes('budget') ? `"budget": {
    "income": { "contract_value": número, "payment_scheme": "mensual|hitos|unico", "payments": [{ "month": número, "description": "desc", "value": número }] },
    "expenses": [{ "category": "nomina|contratistas|arriendo|seguros|servicios|otros", "item": "descripción", "monthly_value": número, "months": número }]
  },` : ''}
  "summary": "resumen ejecutivo del contrato en 2-3 párrafos",
  "warnings": ["alertas o inconsistencias detectadas en los documentos"],
  "confidence": { "obligations": 0.0-1.0, "risks": 0.0-1.0, "team": 0.0-1.0, "schedule": 0.0-1.0, "budget": 0.0-1.0 }
}

IMPORTANTE:
- Extrae TODAS las obligaciones del contratista mencionadas
- Identifica riesgos reales basados en el tipo de proyecto y las cláusulas
- Si hay anexo técnico con especificaciones de personal, extrae los cargos exactos
- Para cronograma, basa las fases en el objeto del contrato y el plazo
- Para presupuesto, extrae o estima basado en el valor del contrato y los items mencionados
- Si no hay información suficiente para un módulo, devuelve array vacío pero incluye advertencia`;

    let result;
    if (pdfBuffers.length > 0) {
      result = await callLLMWithDocs(provider, apiKey, model, systemPrompt, userPrompt, pdfBuffers, 8192);
    } else {
      result = await callLLM(provider, apiKey, model, systemPrompt, userPrompt, 8192);
    }

    // Parse JSON
    let parsed;
    try {
      const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsed = JSON.parse(cleaned);
    } catch (e) {
      return res.status(500).json({ error: 'Error parseando respuesta IA', raw: result.substring(0, 500) });
    }

    // Log
    await pool.execute(
      'INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
      [req.user.id, 'ai_auto_populate_analyze', 'project', pid, JSON.stringify({ provider, docs: docs.length, modules: targetModules })]
    );

    res.json({ data: parsed, docs_analyzed: docs.length, modules: targetModules, text_chars: allText.length, pdf_buffers: pdfBuffers.length, read_errors: readErrors });
  } catch (err) {
    console.error('AI Analyze error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// ═══════════════════════════════════════════
// POST /api/ai-populate/:projectId/apply
// Apply extracted data to actual modules
// ═══════════════════════════════════════════
router.post('/:projectId/apply', [param('projectId').isInt()], async (req, res) => {
  try {
    const pid = parseInt(req.params.projectId);
    const uid = req.user.id;
    const { data, modules } = req.body;
    const results = { applied: {}, errors: {} };

    console.log(`\n🔧 AI Apply — Proyecto ${pid}, módulos: ${modules?.join(', ')}`);
    console.log(`   Datos recibidos:`, Object.keys(data || {}).map(k => `${k}: ${Array.isArray(data[k]) ? data[k].length + ' items' : typeof data[k]}`).join(', '));

    // Apply obligations
    if (modules.includes('obligations') && data.obligations?.length > 0) {
      let count = 0; const errs = [];
      // Get max existing AI code to avoid duplicates
      const [maxRow] = await pool.execute(
        `SELECT code FROM obligations WHERE project_id=? AND code LIKE 'OB-AI-%' ORDER BY code DESC LIMIT 1`, [pid]
      );
      let nextNum = 1;
      if (maxRow.length > 0) {
        const match = maxRow[0].code.match(/OB-AI-(\d+)/);
        if (match) nextNum = parseInt(match[1]) + 1;
      }
      for (const ob of data.obligations) {
        try {
          const code = `OB-AI-${String(nextNum).padStart(3, '0')}`;
          nextNum++;
          const obType = ['hacer','entregar','no_hacer','condicion'].includes(ob.type) ? ob.type : 'hacer';
          const riskLevel = ['alto','medio','bajo'].includes(ob.priority) ? ob.priority : 'medio';
          await pool.execute(
            `INSERT INTO obligations (project_id, code, description, obligation_type, risk_level, status, notes)
             VALUES (?,?,?,?,?,?,?)`,
            [pid, code, ob.description, obType, riskLevel, 'pendiente', 'Auto-generado por IA']
          );
          count++;
        } catch (e) { errs.push(e.message); console.log(`   ❌ Obligación: ${e.message}`); }
      }
      results.applied.obligations = count;
      if (errs.length) results.errors.obligations = errs;
      console.log(`   ✅ Obligaciones: ${count}/${data.obligations.length} insertadas`);
    }

    // Apply risks
    if (modules.includes('risks') && data.risks?.length > 0) {
      let count = 0; const errs = [];
      const [maxRisk] = await pool.execute(
        `SELECT risk_code FROM risks WHERE project_id=? AND risk_code LIKE 'R-AI-%' ORDER BY risk_code DESC LIMIT 1`, [pid]
      );
      let nextRiskNum = 1;
      if (maxRisk.length > 0) {
        const match = maxRisk[0].risk_code.match(/R-AI-(\d+)/);
        if (match) nextRiskNum = parseInt(match[1]) + 1;
      }
      const catMap = { tecnico:'tecnico', financiero:'financiero', legal:'legal', ambiental:'ambiental', social:'social', operacional:'operativo', operativo:'operativo', externo:'externo' };
      const probMap = { alta:'alta', media:'media', baja:'baja', muy_alta:'muy_alta', muy_baja:'muy_baja' };
      const impMap = { alto:'alto', medio:'medio', bajo:'bajo', muy_alto:'muy_alto', muy_bajo:'muy_bajo' };
      for (const r of data.risks) {
        try {
          const code = `R-AI-${String(nextRiskNum).padStart(3, '0')}`;
          nextRiskNum++;
          await pool.execute(
            `INSERT INTO risks (project_id, risk_code, description, category, probability, impact, mitigation_plan, status, created_by)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [pid, code, r.description, catMap[r.category] || 'operativo', probMap[r.probability] || 'media', impMap[r.impact] || 'medio', r.mitigation || '', 'identificado', uid]
          );
          count++;
        } catch (e) { errs.push(e.message); console.log(`   ❌ Riesgo: ${e.message}`); }
      }
      results.applied.risks = count;
      if (errs.length) results.errors.risks = errs;
      console.log(`   ✅ Riesgos: ${count}/${data.risks.length} insertados`);
    }

    // Apply team
    if (modules.includes('team') && data.team?.length > 0) {
      let count = 0; const errs = [];
      for (const t of data.team) {
        try {
          const salary = parseFloat(t.estimated_salary) || 0;
          const qty = parseInt(t.quantity) || 1;
          const dedPct = t.dedication === 'tiempo_completo' ? 100 : t.dedication === 'medio_tiempo' ? 50 : 100;

          // 1. Insert into team_members (visible in Equipo tab)
          for (let i = 0; i < qty; i++) {
            const memberName = qty > 1 ? `${t.role} ${i + 1} (por asignar)` : `${t.role} (por asignar)`;
            const profession = (t.profile || '').substring(0, 250);
            await pool.execute(
              `INSERT INTO team_members (project_id, full_name, role_in_project, required_profession, dedication_pct, status, compliance_notes)
               VALUES (?,?,?,?,?,?,?)`,
              [pid, memberName, t.role, profession, dedPct, 'activo', 'Auto-generado por IA']
            );
          }

          // 2. Insert into budget (payroll or contractors)
          if (t.dedication === 'por_horas' || !salary) {
            await pool.execute(
              `INSERT INTO budget_contractors (project_id, cargo, cantidad, tipo_contrato, valor_mensual, mes_inicio, mes_fin, costo_mensual, meses_vinculacion, costo_total, notes, sort_order)
               VALUES (?,?,?,'mensual',?,1,NULL,?,0,0,'Auto-generado por IA',99)`,
              [pid, t.role, qty, salary, salary * qty]
            );
          } else {
            await pool.execute(
              `INSERT INTO budget_payroll (project_id, cargo, cantidad, salario_base, aux_transporte, mes_inicio, mes_fin,
                pct_prima, pct_vacaciones, pct_cesantias, pct_int_cesantias, pct_arl, pct_pension, pct_ccf, pct_icbf, pct_sena, pct_salud,
                costo_mensual, meses_vinculacion, costo_total, notes, sort_order)
               VALUES (?,?,?,?,0,1,NULL, 8.333,4.167,8.333,1.0,0.522,12.0,4.0,3.0,2.0,8.5, ?,0,0,'Auto-generado por IA',99)`,
              [pid, t.role, qty, salary, Math.round(salary * 1.52355 * 100) / 100]
            );
          }
          count++;
        } catch (e) { errs.push(`${t.role}: ${e.message}`); console.log(`   ❌ Team: ${e.message}`); }
      }
      results.applied.team = count;
      if (errs.length) results.errors.team = errs;
      console.log(`   ✅ Equipo: ${count}/${data.team.length} insertados (team_members + presupuesto)`);
    }

    // Apply schedule
    if (modules.includes('schedule') && data.schedule?.length > 0) {
      let count = 0; const errs = [];
      // Get project start date for calculating activity dates
      const [projDates] = await pool.execute('SELECT start_date, execution_term, execution_term_unit FROM projects WHERE id=?', [pid]);
      const pStart = projDates[0]?.start_date ? new Date(projDates[0].start_date) : new Date();
      
      for (const s of data.schedule) {
        try {
          const startMonth = parseInt(s.start_month) || 1;
          const endMonth = parseInt(s.end_month) || startMonth;
          // Convert months to dates
          const sDate = new Date(pStart);
          sDate.setMonth(sDate.getMonth() + startMonth - 1);
          const eDate = new Date(pStart);
          eDate.setMonth(eDate.getMonth() + endMonth);
          eDate.setDate(eDate.getDate() - 1);
          
          await pool.execute(
            `INSERT INTO schedule_activities (project_id, name, description, activity_type, start_date, end_date, progress_pct, status, sort_order)
             VALUES (?,?,?,'task',?,?,0,'no_iniciada',?)`,
            [pid, s.activity, s.deliverable || '', sDate.toISOString().split('T')[0], eDate.toISOString().split('T')[0], count]
          );
          count++;
        } catch (e) { errs.push(`${s.activity}: ${e.message}`); console.log(`   ❌ Schedule: ${e.message}`); }
      }
      results.applied.schedule = count;
      if (errs.length) results.errors.schedule = errs;
      console.log(`   ✅ Cronograma: ${count}/${data.schedule.length} insertados`);
    }

    // Apply budget expenses
    if (modules.includes('budget') && data.budget?.expenses?.length > 0) {
      let count = 0; const errs = [];
      const catMap = { 
        nomina: 'otros', contratistas: 'otros', arriendo: 'arriendo_equipos', 
        seguros: 'gastos_legales', servicios: 'servicios_publicos', viaje: 'gastos_viaje',
        equipos: 'activos_fijos', legal: 'gastos_legales', otros: 'otros',
        arriendo_equipos: 'arriendo_equipos', gastos_legales: 'gastos_legales',
        servicios_publicos: 'servicios_publicos', gastos_viaje: 'gastos_viaje', activos_fijos: 'activos_fijos'
      };
      for (const e of data.budget.expenses) {
        try {
          const rawCat = (e.category || 'otros').toLowerCase().trim();
          const cat = catMap[rawCat] || 'otros';
          const months = e.months || 12;
          const monthly = parseFloat(e.monthly_value) || 0;
          await pool.execute(
            `INSERT INTO budget_expenses (project_id, category, label, cantidad, valor_unitario, mes_inicio, mes_fin, meses, valor_mensual, valor_total, notes, sort_order)
             VALUES (?,?,?,1,?,1,?,?,?,?,'Auto-generado por IA',99)`,
            [pid, cat, e.item, monthly, months, months, monthly, monthly * months]
          );
          count++;
        } catch (err) { errs.push(`${e.item}: ${err.message}`); console.log(`   ❌ Gasto: ${err.message}`); }
      }
      results.applied.budget = count;
      if (errs.length) results.errors.budget = errs;
      console.log(`   ✅ Gastos: ${count}/${data.budget.expenses.length} insertados`);
    }

    console.log(`\n✅ Apply completado:`, JSON.stringify(results.applied));
    if (Object.keys(results.errors).length > 0) console.log(`⚠️ Errores:`, JSON.stringify(results.errors));

    // Log
    await pool.execute(
      'INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
      [uid, 'ai_auto_populate_apply', 'project', pid, JSON.stringify(results)]
    );

    res.json({ message: 'Datos aplicados exitosamente', results });
  } catch (err) {
    console.error('AI Apply error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
