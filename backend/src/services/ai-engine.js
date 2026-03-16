/**
 * SGIP-IA · Motor de Inteligencia Artificial
 * Soporta: Anthropic Claude + OpenAI GPT
 * Capacidades: Extracción de docs, Generación de docs, Análisis inteligente, Chat
 */

const pool = require('../config/database');

// ─── Provider Abstraction ───

// Approximate token count (1 token ≈ 4 chars in Spanish)
function estimateTokens(text) { return Math.ceil((text || '').length / 4); }

// Truncate text to fit within token limits, keeping start and end
function truncateText(text, maxTokens = 20000) {
  const estimated = estimateTokens(text);
  if (estimated <= maxTokens) return text;
  const maxChars = maxTokens * 4;
  const keepStart = Math.floor(maxChars * 0.7); // 70% from beginning (most important in contracts)
  const keepEnd = Math.floor(maxChars * 0.25);   // 25% from end (signatures, clauses)
  const start = text.slice(0, keepStart);
  const end = text.slice(-keepEnd);
  return `${start}\n\n[... DOCUMENTO TRUNCADO: se omitieron ~${estimated - maxTokens} tokens del medio para cumplir límites de la API ...]\n\n${end}`;
}

// Max input tokens per provider (conservative to leave room for response)
const MAX_INPUT_TOKENS = {
  anthropic: 90000,  // Claude supports 200K context
  openai: 15000,     // Conservative: many orgs have 30K TPM limit
};
async function callLLM(provider, apiKey, model, systemPrompt, userMessage, options = {}) {
  if (provider === 'anthropic') {
    return callAnthropic(apiKey, model, systemPrompt, userMessage, options);
  } else {
    return callOpenAI(apiKey, model, systemPrompt, userMessage, options);
  }
}

async function callAnthropic(apiKey, model, systemPrompt, userMessage, options = {}) {
  const body = {
    model: model || 'claude-sonnet-4-20250514',
    max_tokens: options.maxTokens || 4096,
    system: systemPrompt,
    messages: Array.isArray(userMessage) ? userMessage : [{ role: 'user', content: userMessage }],
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Anthropic API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.content.map(b => b.text || '').join('');
}

async function callOpenAI(apiKey, model, systemPrompt, userMessage, options = {}) {
  const messages = [{ role: 'system', content: systemPrompt }];
  if (Array.isArray(userMessage)) {
    userMessage.forEach(m => messages.push(m));
  } else {
    messages.push({ role: 'user', content: userMessage });
  }

  const body = {
    model: model || 'gpt-5',
    messages,
    max_completion_tokens: options.maxTokens || 4096,
  };
  if (options.temperature !== undefined) body.temperature = options.temperature;
  if (options.response_format) body.response_format = options.response_format;

  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// ─── Context Assembly: gather all project data for AI ───
async function getProjectContext(projectId, sections = 'all') {
  const ctx = {};

  // Base project info
  const [proj] = await pool.execute('SELECT * FROM projects WHERE id=?', [projectId]);
  if (proj.length === 0) throw new Error('Proyecto no encontrado');
  ctx.project = proj[0];

  if (sections === 'all' || sections.includes('obligations')) {
    const [obls] = await pool.execute('SELECT * FROM obligations WHERE project_id=?', [projectId]);
    ctx.obligations = obls;
  }
  if (sections === 'all' || sections.includes('schedule')) {
    const [acts] = await pool.execute('SELECT * FROM schedule_activities WHERE project_id=? ORDER BY sort_order', [projectId]);
    ctx.schedule = acts;
  }
  if (sections === 'all' || sections.includes('progress')) {
    const [prog] = await pool.execute('SELECT * FROM progress_records WHERE project_id=? ORDER BY period_date DESC LIMIT 6', [projectId]);
    ctx.progress = prog;
  }
  if (sections === 'all' || sections.includes('payments')) {
    const [pay] = await pool.execute('SELECT * FROM payments WHERE project_id=? ORDER BY payment_number', [projectId]);
    ctx.payments = pay;
  }
  if (sections === 'all' || sections.includes('risks')) {
    const [risks] = await pool.execute('SELECT * FROM risks WHERE project_id=? AND status != "cerrado"', [projectId]);
    ctx.risks = risks;
  }
  if (sections === 'all' || sections.includes('changes')) {
    const [changes] = await pool.execute('SELECT * FROM change_orders WHERE project_id=?', [projectId]);
    ctx.changes = changes;
  }
  if (sections === 'all' || sections.includes('team')) {
    const [team] = await pool.execute('SELECT * FROM team_members WHERE project_id=?', [projectId]);
    ctx.team = team;
  }
  if (sections === 'all' || sections.includes('milestones')) {
    const [ms] = await pool.execute('SELECT * FROM milestones WHERE project_id=?', [projectId]);
    ctx.milestones = ms;
  }
  if (sections === 'all' || sections.includes('policies')) {
    const [pol] = await pool.execute('SELECT * FROM policies WHERE project_id=?', [projectId]);
    ctx.policies = pol;
  }
  if (sections === 'all' || sections.includes('minutes')) {
    const [min] = await pool.execute('SELECT * FROM meeting_minutes WHERE project_id=? ORDER BY meeting_date DESC LIMIT 5', [projectId]);
    ctx.minutes = min;
  }
  if (sections === 'all' || sections.includes('lessons')) {
    const [les] = await pool.execute('SELECT * FROM lessons_learned WHERE project_id=?', [projectId]);
    ctx.lessons = les;
  }

  return ctx;
}

function contextToText(ctx) {
  const p = ctx.project;
  let text = `PROYECTO: ${p.code} - ${p.name}
Estado: ${p.status} | Avance: ${p.progress_pct}%
Contratista: ${p.contractor_name || 'N/A'} | Cliente: ${p.client_name || 'N/A'}
Valor contrato: $${Number(p.contract_value || 0).toLocaleString('es-CO')}
Fechas: ${p.start_date || 'N/A'} al ${p.estimated_end_date || 'N/A'}
Objeto: ${p.description || 'N/A'}
`;

  if (ctx.obligations?.length) {
    text += `\nOBLIGACIONES (${ctx.obligations.length}):\n`;
    ctx.obligations.forEach(o => { text += `- [${o.compliance_status}] ${o.obligation_type}: ${o.description}\n`; });
  }
  if (ctx.schedule?.length) {
    text += `\nCRONOGRAMA (${ctx.schedule.length} actividades):\n`;
    ctx.schedule.slice(0, 30).forEach(a => { text += `- ${a.wbs_code || ''} ${a.name} | ${a.status} | ${a.progress_pct}% | ${a.start_date} → ${a.end_date}\n`; });
  }
  if (ctx.progress?.length) {
    text += `\nAVANCE RECIENTE:\n`;
    ctx.progress.forEach(r => { text += `- ${r.period_label}: Físico ${r.physical_actual}% (prog: ${r.physical_planned}%) | Financiero $${Number(r.financial_actual).toLocaleString('es-CO')}\n`; });
  }
  if (ctx.payments?.length) {
    text += `\nPAGOS (${ctx.payments.length}):\n`;
    ctx.payments.forEach(p => { text += `- #${p.payment_number} ${p.concept}: $${Number(p.net_value).toLocaleString('es-CO')} [${p.status}]\n`; });
  }
  if (ctx.risks?.length) {
    text += `\nRIESGOS ACTIVOS (${ctx.risks.length}):\n`;
    ctx.risks.forEach(r => { text += `- ${r.risk_code} [${r.risk_level}/${r.risk_score}] ${r.description}\n`; });
  }
  if (ctx.changes?.length) {
    text += `\nCAMBIOS/ADICIONES (${ctx.changes.length}):\n`;
    ctx.changes.forEach(c => { text += `- #${c.change_number} ${c.title} [${c.status}] Costo: $${Number(c.impact_cost).toLocaleString('es-CO')} Plazo: ${c.impact_days}d\n`; });
  }
  if (ctx.team?.length) {
    text += `\nEQUIPO (${ctx.team.length}):\n`;
    ctx.team.forEach(t => { text += `- ${t.full_name} | ${t.role} | ${t.dedication_pct}%\n`; });
  }
  if (ctx.milestones?.length) {
    text += `\nHITOS (${ctx.milestones.length}):\n`;
    ctx.milestones.forEach(m => { text += `- ${m.name} [${m.status}] ${m.due_date}\n`; });
  }
  if (ctx.policies?.length) {
    text += `\nPÓLIZAS (${ctx.policies.length}):\n`;
    ctx.policies.forEach(p => { text += `- ${p.policy_type}: ${p.insurer} | Vigente: ${p.start_date} → ${p.end_date} [${p.status}]\n`; });
  }
  if (ctx.minutes?.length) {
    text += `\nÚLTIMAS ACTAS (${ctx.minutes.length}):\n`;
    ctx.minutes.forEach(m => { text += `- Acta #${m.minute_number}: ${m.title} [${m.meeting_date}]\n`; });
  }

  return text;
}

// ─── System Prompts ───
const SYSTEM_PROMPTS = {
  extract: `Eres un experto en contratación pública colombiana y gestión de proyectos.
Tu tarea es extraer datos estructurados de documentos de contratación (contratos, pliegos de condiciones, actas, resoluciones).

REGLAS:
- Extrae SOLO datos que encuentres explícitamente en el texto
- Si un campo no se encuentra, usa null
- Valores monetarios en números sin formato (ej: 150000000, no $150.000.000)
- Fechas en formato YYYY-MM-DD
- Responde SIEMPRE en JSON válido, sin texto adicional ni backticks markdown`,

  generate: `Eres un experto en contratación pública colombiana. Generas documentos profesionales de gestión de proyectos.

REGLAS:
- Usa lenguaje formal técnico apropiado para contratación estatal colombiana
- Incluye referencias a cláusulas contractuales cuando aplique
- Usa formato profesional con encabezados, numeración y estructura clara
- Fechas en formato colombiano (día de mes de año)
- Valores monetarios en formato colombiano ($XXX.XXX.XXX)
- Sé preciso con los datos del proyecto proporcionados`,

  analyze: `Eres un analista experto en gestión de proyectos de contratación colombiana con enfoque en PMI/PMBOK.

Tu tarea es analizar datos del proyecto y generar insights accionables.

REGLAS:
- Basa tu análisis SOLO en los datos proporcionados
- Usa indicadores como SPI (Schedule Performance Index), CPI (Cost Performance Index)
- Identifica riesgos emergentes y tendencias
- Prioriza alertas por criticidad (CRÍTICO > ALTO > MEDIO > BAJO)
- Da recomendaciones específicas y accionables, no genéricas
- Responde en JSON con la estructura solicitada`,

  chat: `Eres el asistente IA del SGIP-IA (Sistema de Gestión Integral de Proyectos con IA).
Tienes acceso a todos los datos del proyecto que se te proporcionan.

REGLAS:
- Responde en español colombiano profesional
- Sé conciso pero completo
- Cita datos específicos del proyecto cuando respondes
- Si no tienes información suficiente, dilo claramente
- Puedes sugerir acciones basadas en el estado actual del proyecto
- Formatea con markdown cuando mejore la legibilidad`,
};

// ─── Specific Functions ───

async function extractFromDocument(provider, apiKey, model, documentText, extractionType) {
  // Truncate document to fit provider limits
  const maxTokens = MAX_INPUT_TOKENS[provider] || 20000;
  const safeText = truncateText(documentText, maxTokens - 2000); // reserve 2K for prompt+response
  
  const schemas = {
    contract: `Extrae los siguientes campos del contrato:
{
  "contract_number": "número del contrato",
  "contract_type": "tipo de contrato (obra, consultoría, suministro, interventoría, prestación_servicios)",
  "object": "objeto del contrato",
  "contractor_name": "nombre del contratista",
  "contractor_nit": "NIT o cédula del contratista",
  "client_name": "nombre de la entidad contratante",
  "contract_value": número sin formato,
  "start_date": "YYYY-MM-DD",
  "end_date": "YYYY-MM-DD",
  "duration_months": número,
  "supervisor_name": "nombre del supervisor/interventor",
  "obligations": ["lista de obligaciones específicas del contratista"],
  "deliverables": ["lista de entregables/productos"],
  "payment_conditions": "condiciones de pago",
  "advance_pct": porcentaje de anticipo o null,
  "guarantees": [{"type": "tipo de garantía", "coverage_pct": porcentaje, "duration": "vigencia"}],
  "penalties": "cláusula penal",
  "additional_clauses": ["cláusulas relevantes"]
}`,
    invoice: `Extrae los datos de la factura/cuenta de cobro:
{
  "invoice_number": "número de factura",
  "invoice_date": "YYYY-MM-DD",
  "period_from": "YYYY-MM-DD",
  "period_to": "YYYY-MM-DD",
  "concept": "concepto del pago",
  "gross_value": número,
  "retention_pct": porcentaje,
  "taxes": número,
  "net_value": número,
  "activities_executed": ["actividades ejecutadas en el periodo"]
}`,
    minutes: `Extrae los datos del acta de reunión:
{
  "meeting_date": "YYYY-MM-DD",
  "meeting_type": "tipo de reunión",
  "title": "título del acta",
  "location": "lugar",
  "attendees": ["lista de asistentes"],
  "agenda": "orden del día",
  "agreements": ["lista de acuerdos"],
  "action_items": [{"task": "tarea", "responsible": "responsable", "due_date": "YYYY-MM-DD"}],
  "next_meeting_date": "YYYY-MM-DD"
}`,
    general: `Extrae toda la información relevante del documento para un proyecto de contratación:
{
  "document_type": "tipo de documento identificado",
  "key_dates": [{"label": "descripción", "date": "YYYY-MM-DD"}],
  "key_values": [{"label": "descripción", "value": número}],
  "key_people": [{"name": "nombre", "role": "cargo/rol"}],
  "key_obligations": ["obligaciones identificadas"],
  "key_findings": ["hallazgos o puntos importantes"],
  "summary": "resumen ejecutivo del documento en 2-3 párrafos"
}`,
  };

  const schema = schemas[extractionType] || schemas.general;
  const userMsg = `DOCUMENTO A ANALIZAR:\n\n${safeText}\n\nEXTRAE los datos según esta estructura:\n${schema}`;

  const result = await callLLM(provider, apiKey, model, SYSTEM_PROMPTS.extract, userMsg, {
    temperature: 0.1,
    maxTokens: 4096,
  });

  // Parse JSON response
  try {
    const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { raw_response: result, parse_error: true };
  }
}

async function generateDocument(provider, apiKey, model, projectId, documentType, additionalInstructions) {
  const ctx = await getProjectContext(projectId);
  let ctxText = contextToText(ctx);
  // Truncate context for provider limits
  const maxTokens = MAX_INPUT_TOKENS[provider] || 20000;
  ctxText = truncateText(ctxText, maxTokens - 3000);

  const templates = {
    informe_mensual: 'Genera un INFORME MENSUAL DE GESTIÓN del proyecto con: 1) Resumen ejecutivo 2) Avance físico y financiero 3) Actividades ejecutadas en el periodo 4) Novedades y dificultades 5) Estado de riesgos 6) Próximas actividades 7) Conclusiones y recomendaciones',
    acta_comite: 'Genera un borrador de ACTA DE COMITÉ DE SEGUIMIENTO con: 1) Encabezado con datos del proyecto 2) Orden del día sugerido 3) Resumen de estado actual 4) Temas a tratar basados en alertas detectadas 5) Sección de compromisos',
    oficio_supervisor: 'Genera un OFICIO DEL SUPERVISOR/INTERVENTOR informando sobre el estado del proyecto. Incluye: datos del contrato, avance actual, novedades relevantes, requerimientos al contratista si aplica',
    informe_cierre: 'Genera un INFORME FINAL DE GESTIÓN para cierre del proyecto con: 1) Datos generales del contrato 2) Resumen de ejecución 3) Balance financiero 4) Cumplimiento de obligaciones 5) Novedades presentadas 6) Lecciones aprendidas 7) Conclusiones',
    balance_financiero: 'Genera un BALANCE FINANCIERO DETALLADO con: 1) Valor inicial vs valor final 2) Detalle de adiciones 3) Pagos realizados 4) Retenciones 5) Saldo pendiente 6) Cuadro resumen',
    acta_inicio: 'Genera un borrador de ACTA DE INICIO del contrato con: datos generales, objeto, valor, plazo, obligaciones principales, cronograma resumido, equipo de trabajo',
    requerimiento: 'Genera un REQUERIMIENTO AL CONTRATISTA basado en las novedades detectadas (atrasos, incumplimientos, riesgos materializados). Usa tono formal institucional colombiano.',
  };

  const template = templates[documentType] || `Genera un documento de tipo "${documentType}" para el proyecto.`;
  const userMsg = `DATOS DEL PROYECTO:\n${ctxText}\n\nINSTRUCCIÓN: ${template}\n${additionalInstructions ? `\nNOTAS ADICIONALES: ${additionalInstructions}` : ''}`;

  return await callLLM(provider, apiKey, model, SYSTEM_PROMPTS.generate, userMsg, {
    temperature: 0.3,
    maxTokens: 8000,
  });
}

async function analyzeProject(provider, apiKey, model, projectId) {
  const ctx = await getProjectContext(projectId);
  let ctxText = contextToText(ctx);
  const maxTokens = MAX_INPUT_TOKENS[provider] || 20000;
  ctxText = truncateText(ctxText, maxTokens - 3000);

  const userMsg = `DATOS DEL PROYECTO:\n${ctxText}\n\nRealiza un ANÁLISIS INTEGRAL del proyecto. Responde en JSON con esta estructura:
{
  "executive_summary": "resumen ejecutivo de 2-3 oraciones sobre el estado general",
  "health_score": número de 0 a 100 representando la salud del proyecto,
  "health_label": "crítico|en_riesgo|precaución|saludable|excelente",
  "spi": número o null (Schedule Performance Index si hay datos suficientes),
  "cpi": número o null (Cost Performance Index si hay datos suficientes),
  "alerts": [
    {"level": "critico|alto|medio|bajo", "category": "cronograma|financiero|contractual|riesgos|calidad", "title": "título corto", "description": "descripción detallada", "recommendation": "acción recomendada"}
  ],
  "predictions": [
    {"metric": "nombre de la métrica", "current": "valor actual", "predicted": "valor proyectado", "confidence": "alta|media|baja", "explanation": "explicación"}
  ],
  "recommendations": [
    {"priority": "alta|media|baja", "area": "área", "action": "acción concreta recomendada", "expected_impact": "impacto esperado"}
  ],
  "risk_assessment": "evaluación general de riesgos en 2-3 oraciones",
  "next_actions": ["top 5 acciones inmediatas recomendadas"]
}`;

  const result = await callLLM(provider, apiKey, model, SYSTEM_PROMPTS.analyze, userMsg, {
    temperature: 0.2,
    maxTokens: 6000,
  });

  try {
    const cleaned = result.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { raw_response: result, parse_error: true };
  }
}

async function chatWithProject(provider, apiKey, model, projectId, messages) {
  const ctx = await getProjectContext(projectId);
  let ctxText = contextToText(ctx);
  const maxTokens = MAX_INPUT_TOKENS[provider] || 20000;
  ctxText = truncateText(ctxText, maxTokens - 4000); // leave more room for chat history

  const systemWithContext = `${SYSTEM_PROMPTS.chat}\n\n--- DATOS DEL PROYECTO ---\n${ctxText}`;

  return await callLLM(provider, apiKey, model, systemWithContext, messages, {
    temperature: 0.4,
    maxTokens: 4096,
  });
}

module.exports = {
  callLLM,
  estimateTokens,
  truncateText,
  MAX_INPUT_TOKENS,
  getProjectContext,
  contextToText,
  extractFromDocument,
  generateDocument,
  analyzeProject,
  chatWithProject,
  SYSTEM_PROMPTS,
};
