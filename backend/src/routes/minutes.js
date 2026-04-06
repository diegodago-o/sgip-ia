const express = require('express');
const { param, body, validationResult } = require('express-validator');
const pool = require('../config/database');
const { authMiddleware, roleMiddleware, projectAccessMiddleware } = require('../middleware/auth');
const notifier = require('../services/notifier');
const multer = require('multer');
const path = require('path');
const fs = require('fs');

const { resolveAIConfig } = require('../services/aiConfig');

const router = express.Router();
router.use(authMiddleware);
// Verify user has access to the project
router.param('projectId', async (req, res, next, val) => {
  try { await projectAccessMiddleware()(req, res, next); } catch(e) { next(e); }
});
function validate(req, res) { const e = validationResult(req); if (!e.isEmpty()) { res.status(400).json({ errors: e.array() }); return false; } return true; }

// ═══════════════════════════════════════
// SAFE JSON HELPER
// mysql2/promise auto-parses JSON columns → value may already be an array/object
// JSON.parse(alreadyParsedArray) fails → catch → returns []
// This helper handles BOTH cases safely
// ═══════════════════════════════════════
function safeJSON(val) {
  if (Array.isArray(val)) return val;                     // already parsed by mysql2
  if (val && typeof val === 'object') return val;         // already an object
  if (!val) return [];                                     // null/undefined/empty
  if (typeof val === 'string') {
    try { const p = JSON.parse(val); return Array.isArray(p) ? p : (p || []); }
    catch { return []; }
  }
  return [];
}

function parseMinuteRow(r) {
  r.attendees = safeJSON(r.attendees);
  r.agreements = safeJSON(r.agreements);
  r.action_items = safeJSON(r.action_items);
  return r;
}

// ═══ List ═══
router.get('/:projectId/minutes', [param('projectId').isInt()], async (req, res) => {
  if (!validate(req, res)) return;
  try {
    const [rows] = await pool.execute(`
      SELECT m.*, u.full_name as created_by_name, d.file_name as doc_name
      FROM meeting_minutes m
      LEFT JOIN users u ON m.created_by = u.id
      LEFT JOIN documents d ON m.document_id = d.id
      WHERE m.project_id = ? ORDER BY m.meeting_date DESC`, [req.params.projectId]);
    rows.forEach(parseMinuteRow);
    res.json({ data: rows });
  } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Create ═══
router.post('/:projectId/minutes', roleMiddleware('admin','gerente_proyecto','apoyo'),
  [param('projectId').isInt(), body('title').trim().notEmpty(), body('meeting_date').isISO8601()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const b = req.body; const pid = req.params.projectId;
      const [mx] = await pool.execute('SELECT COALESCE(MAX(minute_number),0)+1 as n FROM meeting_minutes WHERE project_id=?', [pid]);
      
      // Ensure JSON fields are stringified for DB
      const attendeesJSON = (b.attendees && (Array.isArray(b.attendees) ? b.attendees.length : true))
        ? JSON.stringify(Array.isArray(b.attendees) ? b.attendees : []) : null;
      const agreementsJSON = (b.agreements && (Array.isArray(b.agreements) ? b.agreements.length : true))
        ? JSON.stringify(Array.isArray(b.agreements) ? b.agreements : []) : null;
      const actionItemsJSON = (b.action_items && (Array.isArray(b.action_items) ? b.action_items.length : true))
        ? JSON.stringify(Array.isArray(b.action_items) ? b.action_items : []) : null;

      const [r] = await pool.execute(
        `INSERT INTO meeting_minutes (project_id,minute_number,minute_type,title,meeting_date,location,
          attendees,agenda,discussions,agreements,action_items,next_meeting_date,status,document_id,created_by,sp_item_id,sp_file_url)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [pid, mx[0].n, b.minute_type||'comite_seguimiento', b.title, b.meeting_date, b.location||null,
          attendeesJSON, b.agenda||null, b.discussions||null, agreementsJSON, actionItemsJSON,
          b.next_meeting_date||null, 'borrador', b.document_id||null, req.user.id,
          b.sp_item_id||null, b.sp_file_url||null]);
      
      const [rows] = await pool.execute('SELECT * FROM meeting_minutes WHERE id=?', [r.insertId]);
      parseMinuteRow(rows[0]);
      // Notify (fire-and-forget)
      const [proj] = await pool.execute('SELECT code, name FROM projects WHERE id = ?', [pid]);
      notifier.notify('acta.created', {
        project_id: Number(pid),
        project_code: proj[0]?.code || '',
        project_name: proj[0]?.name || '',
        minute_type: b.minute_type || 'comite_seguimiento',
        title:       b.title || '',
        meeting_date: b.meeting_date || null,
      }).catch(() => {});

      res.status(201).json({ data: rows[0], message: `Acta #${mx[0].n} creada` });
    } catch (err) { console.error('Create minute error:', err); res.status(500).json({ error: err.message || 'Error creando acta' }); }
});

// ═══ Update ═══
router.put('/:projectId/minutes/:id', roleMiddleware('admin','gerente_proyecto','apoyo'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      const allowed = ['minute_type','title','meeting_date','location','attendees','agenda',
        'discussions','agreements','action_items','next_meeting_date','status','document_id',
        'sp_item_id','sp_file_url'];
      const updates = []; const values = [];
      allowed.forEach(f => {
        if (req.body[f] !== undefined) {
          updates.push(`${f}=?`);
          let v = req.body[f];
          if (['attendees','agreements','action_items'].includes(f)) {
            v = Array.isArray(v) ? JSON.stringify(v) : (typeof v === 'string' ? v : JSON.stringify(v || []));
          }
          values.push(v === '' ? null : v);
        }
      });
      if (updates.length === 0) return res.status(400).json({ error: 'Nada que actualizar' });
      values.push(req.params.id);
      values.push(req.params.projectId);
      await pool.execute(`UPDATE meeting_minutes SET ${updates.join(',')} WHERE id=? AND project_id=?`, values);
      const [rows] = await pool.execute('SELECT * FROM meeting_minutes WHERE id=?', [req.params.id]);
      parseMinuteRow(rows[0]);
      res.json({ data: rows[0], message: 'Acta actualizada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══ Delete ═══
router.delete('/:projectId/minutes/:id', roleMiddleware('admin','gerente_proyecto'),
  [param('projectId').isInt(), param('id').isInt()],
  async (req, res) => {
    if (!validate(req, res)) return;
    try {
      await pool.execute('DELETE FROM meeting_minutes WHERE id=? AND project_id=?', [req.params.id, req.params.projectId]);
      res.json({ message: 'Acta eliminada' });
    } catch (err) { console.error(err); res.status(500).json({ error: 'Error' }); }
});

// ═══════════════════════════════════════════════
// AUTO-GENERATE: Extract data from transcript with AI
// Supports: .vtt, .txt, .docx, pasted text
// Returns structured data to pre-fill form (no DB save)
// ═══════════════════════════════════════════════
const upload = multer({ dest: path.join(__dirname, '../../uploads/tmp'), limits: { fileSize: 15 * 1024 * 1024 } });

// Helper: extract text from different file types
async function extractText(filePath, originalName) {
  const ext = path.extname(originalName || '').toLowerCase();
  console.log(`[EXTRACT] File: ${originalName} (${ext})`);

  // VTT / TXT / plain text
  if (['.vtt', '.txt', '.md', '.csv', '.srt'].includes(ext)) {
    const text = fs.readFileSync(filePath, 'utf-8');
    console.log(`[EXTRACT] Plain text: ${text.length} chars`);
    return { text, method: ext };
  }

  // DOCX — try multiple methods
  if (ext === '.docx' || ext === '.doc') {
    // Method 1: pandoc (most reliable)
    try {
      const { execSync } = require('child_process');
      const text = execSync(`pandoc "${filePath}" -t plain --wrap=none 2>/dev/null`, { encoding: 'utf-8', timeout: 15000 });
      if (text.trim().length > 30) {
        console.log(`[EXTRACT] pandoc OK: ${text.length} chars`);
        return { text: text.trim(), method: 'pandoc' };
      }
    } catch (e) { console.log(`[EXTRACT] pandoc failed: ${e.message}`); }

    // Method 2: adm-zip (manual XML extraction)
    try {
      const AdmZip = require('adm-zip');
      const buf = fs.readFileSync(filePath);
      const zip = new AdmZip(buf);
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
          .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
          .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
          .replace(/\n{3,}/g, '\n\n').trim();
        if (text.length > 30) {
          console.log(`[EXTRACT] adm-zip OK: ${text.length} chars`);
          return { text, method: 'adm-zip' };
        }
      }
    } catch (e) { console.log(`[EXTRACT] adm-zip failed: ${e.message}`); }

    // Method 3: try reading raw (might be renamed .txt)
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      if (raw.length > 50 && !raw.startsWith('PK')) {
        console.log(`[EXTRACT] raw-text fallback: ${raw.length} chars`);
        return { text: raw, method: 'raw-text' };
      }
    } catch {}

    return { text: '', method: 'failed' };
  }

  // Unknown — try as text
  try {
    const text = fs.readFileSync(filePath, 'utf-8');
    return { text, method: 'unknown-text' };
  } catch { return { text: '', method: 'failed' }; }
}

// Helper: clean Teams transcript
function cleanTranscript(text) {
  return text
    .replace(/^WEBVTT\s*/m, '')
    .replace(/^Kind:.*$/gm, '')
    .replace(/^Language:.*$/gm, '')
    .replace(/^NOTE.*$/gm, '')
    .replace(/^\d{1,2}:\d{2}:\d{2}[\.,]\d{3}\s*-->\s*\d{1,2}:\d{2}:\d{2}[\.,]\d{3}.*$/gm, '')
    .replace(/<v\s+([^>]+)>/g, '$1: ')
    .replace(/<\/v>/g, '')
    .replace(/^\d+\s*$/gm, '')
    .replace(/^([A-ZÁÉÍÓÚÑ][a-záéíóúñ]+(?:\s+[A-ZÁÉÍÓÚÑA-Za-záéíóúñ]+)*)\s{2,}(\d{1,2}:\d{2})$/gm, '\n$1 ($2):')
    .replace(/^(Orador\s+\d+)\s{2,}(\d{1,2}:\d{2})$/gm, '\n$1 ($2):')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

router.post('/:projectId/minutes/auto-generate', roleMiddleware('admin','gerente_proyecto','apoyo'),
  upload.single('transcript'), async (req, res) => {
  try {
    const pid = parseInt(req.params.projectId);
    const aiEngine = require('../services/ai-engine');

    const [proj] = await pool.execute('SELECT name, code, client_name, contract_number FROM projects WHERE id=?', [pid]);
    if (!proj.length) return res.status(404).json({ error: 'Proyecto no encontrado' });
    const p = proj[0];

    // ── Step 1: Extract text ──
    let rawText = '';
    let sourceType = 'paste';

    if (req.file) {
      sourceType = path.extname(req.file.originalname || '').replace('.', '') || 'file';
      const result = await extractText(req.file.path, req.file.originalname);
      rawText = result.text;
      sourceType = result.method;
      try { fs.unlinkSync(req.file.path); } catch {}
    } else if (req.body.transcript_text) {
      rawText = req.body.transcript_text;
    }

    if (!rawText || rawText.trim().length < 30) {
      return res.status(400).json({
        error: `No se pudo extraer texto suficiente (${rawText?.length || 0} caracteres). Intente con otro formato o pegue el texto directamente.`,
        hint: sourceType === 'failed' ? 'El archivo .docx no pudo ser leído. Copie el texto del documento y péguelo directamente.' : undefined,
      });
    }

    // ── Step 2: Clean ──
    const cleanText = cleanTranscript(rawText);
    console.log(`[AUTO-MINUTE] Source: ${sourceType}, Raw: ${rawText.length}, Clean: ${cleanText.length} chars`);

    // ── Step 3: Call AI ──
    const { provider, apiKey, model } = await resolveAIConfig(req.body, req.query, req.user?.id);

    const systemPrompt = `Eres un asistente experto que genera actas de reunión a partir de transcripciones o notas.
Tu tarea es analizar el texto y extraer información estructurada para un acta profesional.

DEBES responder ÚNICAMENTE con un objeto JSON válido. Sin texto adicional, sin explicaciones, sin backticks de código.

El JSON debe tener EXACTAMENTE esta estructura:
{
  "title": "Título descriptivo de la reunión",
  "minute_type": "comite_seguimiento",
  "meeting_date": "YYYY-MM-DD",
  "location": "Virtual - Microsoft Teams",
  "attendees": ["Nombre Persona 1", "Nombre Persona 2"],
  "agenda": "Tema 1 tratado\\nTema 2 tratado\\nTema 3 tratado",
  "discussions": "1) Primer tema: Descripción detallada...\\n\\n2) Segundo tema: Descripción detallada...",
  "agreements": ["Acuerdo o decisión 1", "Acuerdo o decisión 2"],
  "action_items": [
    {"task": "Tarea asignada", "responsible": "Nombre responsable", "due_date": ""}
  ],
  "next_meeting_date": null
}

REGLAS:
- "attendees" es un array SIMPLE de strings (solo nombres)
- "agenda" es un string con temas separados por \\n
- "discussions" es un string largo con TODO el desarrollo, numerado por temas
- "agreements" es un array de strings
- "action_items" es un array de objetos con task, responsible, due_date
- "minute_type": "comite_seguimiento", "comite_obra", "reunion_tecnica", "reunion_financiera", o "otro"
- Si el texto es informal o breve, extrae lo que puedas y completa razonablemente
- Si no puedes determinar algo, usa string vacío (nunca inventar datos falsos)
- Usa la fecha de hoy si no se menciona fecha: ${new Date().toISOString().split('T')[0]}
- RESPONDE SOLO EL JSON`;

    const maxTokens = (aiEngine.MAX_INPUT_TOKENS?.[provider] || 15000) - 3000;
    const safeText = aiEngine.truncateText ? aiEngine.truncateText(cleanText, maxTokens) : cleanText.substring(0, 40000);
    
    const userPrompt = `TEXTO DE REUNIÓN del proyecto "${p.name}" (${p.code}):\n\n${safeText}\n\nGenera el JSON del acta.`;

    console.log(`[AUTO-MINUTE] Calling AI (${provider}, ${safeText.length} chars)...`);
    const aiResponse = await aiEngine.callLLM(provider, apiKey, model, systemPrompt, userPrompt, {
      temperature: 0.1, maxTokens: 4000,
    });
    console.log(`[AUTO-MINUTE] AI response length: ${aiResponse.length} chars`);
    console.log(`[AUTO-MINUTE] AI response starts: ${aiResponse.substring(0, 100)}`);

    // ── Step 4: Parse ──
    let parsed;
    const cleanResponse = aiResponse.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
    
    // Try 1: direct parse
    try { parsed = JSON.parse(cleanResponse); }
    catch (e1) {
      // Try 2: extract JSON object
      const match = cleanResponse.match(/\{[\s\S]*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); }
        catch (e2) {
          console.error(`[AUTO-MINUTE] Parse failed. Clean response:\n${cleanResponse.substring(0, 500)}`);
          return res.status(422).json({
            error: 'La IA no devolvió un JSON válido. Intente de nuevo o use un texto más largo.',
            raw_preview: cleanResponse.substring(0, 300),
          });
        }
      } else {
        console.error(`[AUTO-MINUTE] No JSON found in response:\n${cleanResponse.substring(0, 500)}`);
        return res.status(422).json({
          error: 'La IA no devolvió un JSON válido. Intente de nuevo.',
          raw_preview: cleanResponse.substring(0, 300),
        });
      }
    }

    // ── Step 5: Normalize ──
    const result = {
      title: parsed.title || `Acta - ${p.name}`,
      minute_type: parsed.minute_type || 'comite_seguimiento',
      meeting_date: parsed.meeting_date || new Date().toISOString().split('T')[0],
      location: parsed.location || 'Virtual - Microsoft Teams',
      next_meeting_date: parsed.next_meeting_date || '',
      attendees: (parsed.attendees || []).map(a => typeof a === 'string' ? a : (a.name || String(a))),
      agenda: typeof parsed.agenda === 'string' ? parsed.agenda
        : Array.isArray(parsed.agenda) ? parsed.agenda.join('\n') : '',
      discussions: typeof parsed.discussions === 'string' ? parsed.discussions
        : Array.isArray(parsed.discussions)
          ? parsed.discussions.map((d, i) => typeof d === 'string' ? `${i+1}. ${d}`
            : `${i+1}. ${d.topic || ''}${d.summary ? ': ' + d.summary : ''}`).join('\n\n')
          : '',
      agreements: (parsed.agreements || []).map(a => typeof a === 'string' ? a : (a.description || a.text || String(a))),
      action_items: (parsed.action_items || []).map(c => ({
        task: c.task || c.description || c.actividad || '',
        responsible: c.responsible || c.responsable || '',
        due_date: c.due_date || c.fecha || '',
      })).filter(c => c.task),
    };

    console.log(`[AUTO-MINUTE] ✅ Extracted: ${result.attendees.length} attendees, ${result.agreements.length} agreements, ${result.action_items.length} items`);

    await pool.execute(
      'INSERT INTO audit_log (user_id,action,entity_type,entity_id,details) VALUES (?,?,?,?,?)',
      [req.user.id, 'auto_extract_minute', 'meeting_minute', 0,
        JSON.stringify({ provider, model, source: sourceType, chars: cleanText.length })]
    ).catch(() => {});

    res.json({ data: result, message: 'Datos extraídos. Revise y guarde.' });

  } catch (err) {
    console.error('Auto-generate error:', err);
    res.status(500).json({ error: err.message || 'Error procesando transcripción' });
  }
});

// ═══════════════════════════════════════════
// COMMITMENTS (action_items) management
// Stored as JSON in meeting_minutes.action_items
// These endpoints allow individual item management
// ═══════════════════════════════════════════

// GET all commitments across all minutes for a project
router.get('/:projectId/commitments', [param('projectId').isInt()], async (req, res) => {
  try {
    const pid = req.params.projectId;
    const [minutes] = await pool.execute(
      'SELECT id, minute_number, meeting_date, action_items FROM meeting_minutes WHERE project_id=? ORDER BY meeting_date DESC',
      [pid]);

    console.log(`[COMMITMENTS] Project ${pid}: found ${minutes.length} minutes`);

    const allItems = [];
    for (const m of minutes) {
      let items = [];
      const raw = m.action_items;
      if (!raw) continue;

      try {
        if (typeof raw === 'string') {
          items = JSON.parse(raw);
        } else if (Array.isArray(raw)) {
          items = raw;
        } else if (typeof raw === 'object') {
          items = Array.isArray(raw) ? raw : [];
        }
      } catch (e) {
        console.warn(`[COMMITMENTS] Parse error for minute ${m.id}:`, e.message);
        continue;
      }

      if (!Array.isArray(items)) {
        console.warn(`[COMMITMENTS] minute ${m.id} action_items is not array:`, typeof items);
        continue;
      }

      console.log(`[COMMITMENTS] Minute #${m.minute_number} (id=${m.id}): ${items.length} items`);

      items.forEach((item, idx) => {
        allItems.push({
          minute_id: m.id,
          minute_number: m.minute_number,
          meeting_date: m.meeting_date,
          index: idx,
          task: item.task || item.description || item.text || '',
          responsible: item.responsible || item.responsable || '',
          due_date: item.due_date || item.fecha || null,
          status: item.status || (item.completed ? 'completado' : 'pendiente'),
          completed: item.completed || item.status === 'completado' || false,
          notes: item.notes || item.notas || '',
          completed_date: item.completed_date || null,
        });
      });
    }

    console.log(`[COMMITMENTS] Total items extracted: ${allItems.length}`);

    const stats = {
      total: allItems.length,
      completed: allItems.filter(i => i.status === 'completado' || i.completed).length,
      pending: allItems.filter(i => i.status !== 'completado' && !i.completed).length,
      overdue: allItems.filter(i => {
        if (i.completed || i.status === 'completado') return false;
        return i.due_date && new Date(i.due_date) < new Date();
      }).length,
    };

    res.json({ data: allItems, stats });
  } catch (err) { console.error('[COMMITMENTS] Error:', err); res.status(500).json({ error: err.message }); }
});

// PUT update a specific commitment (by minute_id + index)
router.put('/:projectId/commitments/:minuteId/:index', async (req, res) => {
  try {
    const { minuteId, index } = req.params;
    const idx = parseInt(index);
    const { status, notes, responsible, due_date } = req.body;

    const [rows] = await pool.execute('SELECT action_items FROM meeting_minutes WHERE id=? AND project_id=?', [minuteId, req.params.projectId]);
    if (!rows.length) return res.status(404).json({ error: 'Acta no encontrada' });

    let items = [];
    try { items = typeof rows[0].action_items === 'string' ? JSON.parse(rows[0].action_items) : (rows[0].action_items || []); } catch { items = []; }
    if (idx < 0 || idx >= items.length) return res.status(404).json({ error: 'Compromiso no encontrado' });

    // Update the specific item
    if (status !== undefined) {
      items[idx].status = status;
      items[idx].completed = (status === 'completado');
      if (status === 'completado') items[idx].completed_date = new Date().toISOString().split('T')[0];
    }
    if (notes !== undefined) items[idx].notes = notes;
    if (responsible !== undefined) items[idx].responsible = responsible;
    if (due_date !== undefined) items[idx].due_date = due_date;

    await pool.execute('UPDATE meeting_minutes SET action_items=? WHERE id=?', [JSON.stringify(items), minuteId]);

    res.json({ data: items[idx], message: 'Compromiso actualizado' });
  } catch (err) { console.error(err); res.status(500).json({ error: err.message }); }
});

module.exports = router;
