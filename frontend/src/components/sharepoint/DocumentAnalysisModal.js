/**
 * DocumentAnalysisModal
 * Analiza cualquier documento de SharePoint con IA (sin descargarlo al cliente).
 * Flujo: Clasificar → Análisis profundo → Acciones post-análisis
 */
import React, { useState, useEffect } from 'react';
import {
  X, Loader2, Brain, CheckCircle2, AlertTriangle, ChevronRight,
  FileText, Edit3, Shield, ClipboardList, Target, TrendingDown,
  Download, RefreshCw, Copy, Check,
} from 'lucide-react';
import { sharepointAPI, exportsAPI } from '../../services/api';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Convierte markdown simple (**bold**, *italic*) a HTML */
function mdToHtml(text) {
  if (!text) return '';
  return text
    .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/g, '<em>$1</em>')
    .split('\n')
    .map(line => line.trim() === '' ? '<br/>' : `<p style="margin:0 0 6px 0">${line}</p>`)
    .join('');
}

/** Solo acepta fechas YYYY-MM-DD o DD/MM/YYYY; cualquier texto descriptivo → null */
function sanitizeDate(val) {
  if (!val) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const m = String(val).match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  return null; // "No aplica...", "SLA por ticket..." etc → null
}

/** Convierte el objeto de análisis a texto markdown para exportar a Word */
function analysisToMarkdown(ar = {}, docLabel = 'Análisis', filename = '') {
  const today = new Date().toLocaleDateString('es-CO', { dateStyle: 'long' });
  const lines = [];
  lines.push(`# ${docLabel}`);
  lines.push(`**Documento:** ${filename}   |   **Fecha:** ${today}`);
  lines.push('---');

  const kv = [
    ['Avance Físico', ar.avance_fisico], ['Avance Financiero', ar.avance_financiero],
    ['Valor', ar.valor], ['Plazo', ar.plazo],
    ['Fecha Inicio', ar.fecha_inicio], ['Fecha Fin', ar.fecha_fin],
    ['Fecha', ar.fecha], ['Lugar', ar.lugar], ['Tipo', ar.tipo], ['Radicado', ar.radicado],
  ].filter(([, v]) => v);
  if (kv.length) { kv.forEach(([k, v]) => lines.push(`**${k}:** ${v}`)); lines.push(''); }

  if (ar.resumen_ejecutivo || ar.summary)  { lines.push('## Resumen Ejecutivo'); lines.push(ar.resumen_ejecutivo || ar.summary); lines.push(''); }
  if (ar.objeto)                           { lines.push('## Objeto'); lines.push(ar.objeto); lines.push(''); }
  if (ar.accion_requerida)                 { lines.push('## Acción Requerida'); lines.push(ar.accion_requerida); lines.push(''); }

  const section = (title, items) => {
    if (!items?.length) return;
    lines.push(`## ${title}`);
    items.forEach(it => {
      const txt = typeof it === 'string' ? it : (it.descripcion || it.description || JSON.stringify(it));
      const extra = typeof it === 'object' ? [
        it.responsable || it.responsible ? `Responsable: ${it.responsable || it.responsible}` : null,
        it.fecha_limite || it.due_date    ? `Fecha límite: ${it.fecha_limite || it.due_date}` : null,
        it.prioridad                      ? `Prioridad: ${it.prioridad}` : null,
        it.mitigacion                     ? `Mitigación: ${it.mitigacion}` : null,
        it.nivel                          ? `Nivel: ${it.nivel}` : null,
        it.categoria                      ? `Categoría: ${it.categoria}` : null,
      ].filter(Boolean) : [];
      lines.push(`- ${txt}`);
      extra.forEach(e => lines.push(`  - ${e}`));
    });
    lines.push('');
  };

  section('Compromisos', ar.compromisos);
  section('Logros del Período', ar.logros);
  section('Alertas', ar.alertas);
  section('Próximas Actividades', ar.proximas_actividades);
  section('Puntos Clave', ar.puntos_clave);
  section('Obligaciones del Contratista', ar.obligaciones_contratista);
  section('Cláusulas de Riesgo', ar.clausulas_riesgo);
  section('Referencias Legales', ar.referencias_legales);
  section('Recomendaciones', ar.recomendaciones);
  section('Inconsistencias', ar.inconsistencias);
  section('Riesgos', ar.riesgos);

  if (ar.conclusion) { lines.push('## Conclusión'); lines.push(ar.conclusion); lines.push(''); }

  lines.push('---');
  lines.push(`*Generado por SGIP-IA · ${today}*`);
  return lines.join('\n');
}

const ANALYZABLE_EXTS = ['pdf', 'docx', 'doc', 'xlsx', 'xls', 'txt', 'csv'];

export function canAnalyze(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  return ANALYZABLE_EXTS.includes(ext);
}

const DOC_TYPE_LABELS = {
  informe_gestion: 'Informe de Gestión',
  acta:            'Acta de Comité/Reunión',
  contrato:        'Contrato/Otrosí',
  entregable:      'Entregable Técnico',
  correspondencia: 'Correspondencia/Oficio',
  poliza:          'Póliza de Seguros',
  presupuesto:     'Presupuesto/Cotización',
  estudio:         'Estudio Técnico',
  otro:            'Otro documento',
};

const RISK_COLORS = {
  critico: 'text-red-700 bg-red-100',
  alto:    'text-red-600 bg-red-50',
  medio:   'text-amber-600 bg-amber-50',
  bajo:    'text-green-600 bg-green-50',
};

const CONFIDENCE_CFG = {
  alta:  { label: 'Alta confianza',  color: 'text-emerald-600' },
  media: { label: 'Confianza media', color: 'text-amber-600'   },
  baja:  { label: 'Baja confianza',  color: 'text-red-500'     },
};

function Badge({ children, className = '' }) {
  return <span className={`inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold ${className}`}>{children}</span>;
}

function Section({ title, icon: Icon, children, color = 'text-brand-700' }) {
  return (
    <div className="bg-white border border-surface-100 rounded-xl p-4 space-y-2">
      <div className={`flex items-center gap-1.5 font-semibold text-xs uppercase tracking-wide ${color}`}>
        {Icon && <Icon className="w-3.5 h-3.5" />} {title}
      </div>
      {children}
    </div>
  );
}

// ── Classification display ────────────────────────────────────────────────────
function ClassifyResult({ result, onConfirm, onChangeType, loading }) {
  const [overrideType, setOverrideType] = useState('');
  const confCfg = CONFIDENCE_CFG[result.confidence] || CONFIDENCE_CFG.media;

  return (
    <div className="space-y-4 py-2">
      <div className="bg-brand-50 border border-brand-100 rounded-xl p-4 space-y-3">
        <div className="flex items-start gap-3">
          <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
            <Brain className="w-5 h-5 text-brand-600" />
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-bold text-brand-900 text-sm">
                {DOC_TYPE_LABELS[result.type] || result.type_label || result.type}
              </span>
              <span className={`text-[10px] font-medium ${confCfg.color}`}>• {confCfg.label}</span>
            </div>
            {result.period && <p className="text-xs text-surface-500 mt-0.5">📅 {result.period}</p>}
            {result.key_value && <p className="text-xs text-surface-500">💰 {result.key_value}</p>}
            <p className="text-sm text-surface-700 mt-2">{result.summary}</p>
            {result.parties?.length > 0 && (
              <div className="flex flex-wrap gap-1 mt-2">
                {result.parties.map((p, i) => (
                  <Badge key={i} className="bg-brand-100 text-brand-700">{p}</Badge>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Override type */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-surface-500 flex-shrink-0">¿No es correcto? Cambiar a:</span>
        <select
          value={overrideType}
          onChange={e => setOverrideType(e.target.value)}
          className="flex-1 text-xs border border-surface-200 rounded-lg px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-brand-300"
        >
          <option value="">— Confirmar tipo detectado —</option>
          {Object.entries(DOC_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
      </div>

      <button
        onClick={() => onConfirm(overrideType || result.type)}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl transition-colors disabled:opacity-60"
      >
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Brain className="w-4 h-4" />}
        {loading ? 'Analizando en profundidad...' : 'Continuar con análisis profundo'}
      </button>
    </div>
  );
}

// ── Deep analysis renderer ────────────────────────────────────────────────────
function AnalysisDisplay({ docType, analysis }) {
  const renderList = (items, emptyMsg = '—') => {
    if (!items || items.length === 0) return <p className="text-xs text-surface-400">{emptyMsg}</p>;
    return (
      <ul className="space-y-1">
        {items.map((item, i) => (
          <li key={i} className="text-xs text-surface-700 flex items-start gap-1.5">
            <span className="text-brand-400 mt-0.5 flex-shrink-0">•</span>
            <span>{typeof item === 'string' ? item : JSON.stringify(item)}</span>
          </li>
        ))}
      </ul>
    );
  };

  const renderCommitments = (items) => {
    if (!items || items.length === 0) return <p className="text-xs text-surface-400">Sin compromisos detectados</p>;
    return (
      <div className="space-y-2">
        {items.map((c, i) => (
          <div key={i} className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2">
            <p className="text-xs font-medium text-amber-900">{c.descripcion || c.description}</p>
            <div className="flex gap-3 mt-1">
              {(c.responsable || c.responsible) && <span className="text-[10px] text-amber-700">→ {c.responsable || c.responsible}</span>}
              {(c.fecha_limite || c.due_date) && <span className="text-[10px] text-amber-600">📅 {c.fecha_limite || c.due_date}</span>}
              {c.prioridad && <Badge className={c.prioridad === 'alta' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>{c.prioridad}</Badge>}
            </div>
          </div>
        ))}
      </div>
    );
  };

  // Common: executive summary always shown first
  const summary = analysis.resumen_ejecutivo || analysis.summary || analysis.conclusion;

  return (
    <div className="space-y-3">
      {summary && (
        <Section title="Resumen Ejecutivo" icon={FileText}>
          <p className="text-sm text-surface-700 leading-relaxed">{summary}</p>
        </Section>
      )}

      {/* Informe de gestión */}
      {docType === 'informe_gestion' && (
        <>
          <div className="grid grid-cols-2 gap-3">
            {analysis.avance_fisico && (
              <div className="bg-brand-50 rounded-xl p-3 text-center">
                <p className="text-xs text-brand-500 font-medium">Avance Físico</p>
                <p className="text-2xl font-bold text-brand-700">{analysis.avance_fisico}</p>
              </div>
            )}
            {analysis.avance_financiero && (
              <div className="bg-emerald-50 rounded-xl p-3 text-center">
                <p className="text-xs text-emerald-500 font-medium">Avance Financiero</p>
                <p className="text-2xl font-bold text-emerald-700">{analysis.avance_financiero}</p>
              </div>
            )}
          </div>
          {analysis.alertas?.length > 0 && (
            <Section title="Alertas" icon={AlertTriangle} color="text-red-600">
              {renderList(analysis.alertas)}
            </Section>
          )}
          {analysis.compromisos?.length > 0 && (
            <Section title="Compromisos Detectados" icon={ClipboardList} color="text-amber-700">
              {renderCommitments(analysis.compromisos)}
            </Section>
          )}
          {analysis.logros?.length > 0 && (
            <Section title="Logros del Período" icon={CheckCircle2} color="text-emerald-700">
              {renderList(analysis.logros)}
            </Section>
          )}
          {analysis.proximas_actividades?.length > 0 && (
            <Section title="Próximas Actividades">{renderList(analysis.proximas_actividades)}</Section>
          )}
          {analysis.inconsistencias?.length > 0 && (
            <Section title="Inconsistencias Detectadas" icon={AlertTriangle} color="text-orange-600">
              {renderList(analysis.inconsistencias)}
            </Section>
          )}
          {analysis.recomendaciones?.length > 0 && (
            <Section title="Recomendaciones">{renderList(analysis.recomendaciones)}</Section>
          )}
        </>
      )}

      {/* Acta */}
      {docType === 'acta' && (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {analysis.fecha && <div className="bg-surface-50 rounded-lg p-2"><span className="text-surface-400">Fecha:</span> <span className="font-medium">{analysis.fecha}</span></div>}
            {analysis.lugar && <div className="bg-surface-50 rounded-lg p-2"><span className="text-surface-400">Lugar:</span> <span className="font-medium">{analysis.lugar}</span></div>}
            {analysis.tipo_comite && <div className="bg-surface-50 rounded-lg p-2"><span className="text-surface-400">Comité:</span> <span className="font-medium">{analysis.tipo_comite}</span></div>}
            {analysis.proxima_reunion && <div className="bg-surface-50 rounded-lg p-2"><span className="text-surface-400">Próxima reunión:</span> <span className="font-medium">{analysis.proxima_reunion}</span></div>}
          </div>
          {analysis.asistentes?.length > 0 && (
            <Section title="Asistentes">
              <div className="flex flex-wrap gap-1.5">
                {analysis.asistentes.map((a, i) => (
                  <Badge key={i} className="bg-brand-50 text-brand-700">{a.nombre}{a.cargo ? ` — ${a.cargo}` : ''}</Badge>
                ))}
              </div>
            </Section>
          )}
          {analysis.compromisos?.length > 0 && (
            <Section title="Compromisos Generados" icon={ClipboardList} color="text-amber-700">
              {renderCommitments(analysis.compromisos)}
            </Section>
          )}
          {analysis.decisiones?.length > 0 && (
            <Section title="Decisiones Tomadas" icon={CheckCircle2} color="text-emerald-700">
              {renderList(analysis.decisiones)}
            </Section>
          )}
          {analysis.temas_pendientes?.length > 0 && (
            <Section title="Temas Pendientes">{renderList(analysis.temas_pendientes)}</Section>
          )}
        </>
      )}

      {/* Contrato */}
      {docType === 'contrato' && (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {analysis.valor && <div className="bg-emerald-50 rounded-lg p-2"><span className="text-surface-400">Valor:</span> <span className="font-bold text-emerald-700">{analysis.valor}</span></div>}
            {analysis.plazo && <div className="bg-brand-50 rounded-lg p-2"><span className="text-surface-400">Plazo:</span> <span className="font-bold text-brand-700">{analysis.plazo}</span></div>}
            {analysis.fecha_inicio && <div className="bg-surface-50 rounded-lg p-2"><span className="text-surface-400">Inicio:</span> <span className="font-medium">{analysis.fecha_inicio}</span></div>}
            {analysis.fecha_fin && <div className="bg-surface-50 rounded-lg p-2"><span className="text-surface-400">Fin:</span> <span className="font-medium">{analysis.fecha_fin}</span></div>}
          </div>
          {analysis.objeto && (
            <Section title="Objeto"><p className="text-xs text-surface-700">{analysis.objeto}</p></Section>
          )}
          {analysis.obligaciones_contratista?.length > 0 && (
            <Section title="Obligaciones del Contratista">{renderList(analysis.obligaciones_contratista)}</Section>
          )}
          {analysis.clausulas_riesgo?.length > 0 && (
            <Section title="Cláusulas de Riesgo" icon={AlertTriangle} color="text-red-600">{renderList(analysis.clausulas_riesgo)}</Section>
          )}
          {analysis.hitos_pago?.length > 0 && (
            <Section title="Hitos de Pago">
              {analysis.hitos_pago.map((h, i) => (
                <div key={i} className="text-xs text-surface-700 border-b border-surface-50 pb-1 last:border-0 last:pb-0">
                  <span className="font-medium">{h.descripcion}</span>
                  {h.porcentaje && <span className="ml-2 text-brand-600">{h.porcentaje}</span>}
                  {h.requisito && <span className="ml-2 text-surface-400">— {h.requisito}</span>}
                </div>
              ))}
            </Section>
          )}
          {analysis.alertas?.length > 0 && (
            <Section title="Alertas Contractuales" icon={AlertTriangle} color="text-red-600">{renderList(analysis.alertas)}</Section>
          )}
        </>
      )}

      {/* Correspondencia */}
      {docType === 'correspondencia' && (
        <>
          <div className="grid grid-cols-2 gap-2 text-xs">
            {analysis.tipo && <div className="bg-surface-50 rounded-lg p-2"><span className="text-surface-400">Tipo:</span> <span className="font-medium capitalize">{analysis.tipo}</span></div>}
            {analysis.fecha && <div className="bg-surface-50 rounded-lg p-2"><span className="text-surface-400">Fecha:</span> <span className="font-medium">{analysis.fecha}</span></div>}
            {analysis.radicado && <div className="bg-surface-50 rounded-lg p-2"><span className="text-surface-400">Radicado:</span> <span className="font-medium">{analysis.radicado}</span></div>}
            {analysis.plazo_respuesta && <div className="bg-amber-50 rounded-lg p-2"><span className="text-surface-400">Plazo:</span> <span className="font-bold text-amber-700">{analysis.plazo_respuesta}</span></div>}
          </div>
          {analysis.accion_requerida && (
            <Section title="Acción Requerida" icon={AlertTriangle} color="text-amber-700">
              <p className="text-sm text-surface-700 font-medium">{analysis.accion_requerida}</p>
            </Section>
          )}
          {analysis.referencias_legales?.length > 0 && (
            <Section title="Referencias Legales" icon={Shield}>{renderList(analysis.referencias_legales)}</Section>
          )}
          {analysis.riesgo_incumplimiento && (
            <Section title="Riesgo de Incumplimiento">
              <Badge className={RISK_COLORS[analysis.riesgo_incumplimiento] || 'bg-surface-100 text-surface-600'}>
                Riesgo {analysis.riesgo_incumplimiento}
              </Badge>
              {analysis.consecuencias_incumplimiento && (
                <p className="text-xs text-surface-600 mt-1">{analysis.consecuencias_incumplimiento}</p>
              )}
            </Section>
          )}
        </>
      )}

      {/* Genérico para otros tipos */}
      {!['informe_gestion','acta','contrato','correspondencia'].includes(docType) && (
        <>
          {analysis.puntos_clave?.length > 0 && (
            <Section title="Puntos Clave">{renderList(analysis.puntos_clave)}</Section>
          )}
          {analysis.compromisos?.length > 0 && (
            <Section title="Compromisos" icon={ClipboardList} color="text-amber-700">
              {renderCommitments(analysis.compromisos)}
            </Section>
          )}
          {analysis.alertas?.length > 0 && (
            <Section title="Alertas" icon={AlertTriangle} color="text-red-600">{renderList(analysis.alertas)}</Section>
          )}
          {analysis.recomendaciones?.length > 0 && (
            <Section title="Recomendaciones">{renderList(analysis.recomendaciones)}</Section>
          )}
        </>
      )}
    </div>
  );
}

// ── Commitments viewer panel ─────────────────────────────────────────────────
function CommitmentsPanel({ result }) {
  const { commitments = [] } = result;
  const [copied, setCopied] = useState(false);

  const copyAll = () => {
    const text = commitments.map((c, i) => {
      const desc  = c.descripcion || c.description || '';
      const resp  = c.responsable || c.responsible;
      const fecha = c.fecha_limite || c.due_date;
      const prio  = c.prioridad;
      const meta  = [resp && `Responsable: ${resp}`, fecha && `Fecha: ${fecha}`, prio && `Prioridad: ${prio}`]
        .filter(Boolean).join(' | ');
      return `${i + 1}. ${desc}${meta ? `\n   ${meta}` : ''}`;
    }).join('\n\n');
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  if (commitments.length === 0) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-surface-400">
        <ClipboardList className="w-8 h-8" />
        <p className="text-sm">No se detectaron compromisos en este documento.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-amber-900">
          {commitments.length} compromiso{commitments.length !== 1 ? 's' : ''} detectado{commitments.length !== 1 ? 's' : ''}
        </h4>
        <button
          onClick={copyAll}
          className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-800 border border-brand-200 rounded-lg px-2 py-1 hover:bg-brand-50 transition-colors"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          {copied ? 'Copiado' : 'Copiar lista'}
        </button>
      </div>

      <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
        {commitments.map((c, i) => (
          <div key={i} className="bg-amber-50 border border-amber-100 rounded-xl p-3">
            <p className="text-xs font-medium text-amber-900">{c.descripcion || c.description}</p>
            <div className="flex flex-wrap gap-3 mt-1.5">
              {(c.responsable || c.responsible) && (
                <span className="text-[10px] text-amber-700">👤 {c.responsable || c.responsible}</span>
              )}
              {(c.fecha_limite || c.due_date) && (
                <span className="text-[10px] text-amber-600">📅 {c.fecha_limite || c.due_date}</span>
              )}
              {c.prioridad && (
                <Badge className={c.prioridad === 'alta' ? 'bg-red-100 text-red-700' : c.prioridad === 'baja' ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}>
                  {c.prioridad}
                </Badge>
              )}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[10px] text-surface-400 text-center">
        Estos compromisos también se incluyen al exportar a Word.
      </p>
    </div>
  );
}

// ── Post-analysis actions ────────────────────────────────────────────────────
function ActionResult({ actionType, result }) {
  const [copied, setCopied] = useState(false);

  const copy = (text) => {
    navigator.clipboard.writeText(text).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); });
  };

  if (actionType === 'draft_response') {
    return (
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h4 className="text-sm font-semibold text-brand-900">Borrador de Respuesta</h4>
          <button onClick={() => copy(result.text)} className="flex items-center gap-1.5 text-xs text-brand-600 hover:text-brand-800 border border-brand-200 rounded-lg px-2 py-1 hover:bg-brand-50 transition-colors">
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {copied ? 'Copiado' : 'Copiar texto'}
          </button>
        </div>
        <div
          className="w-full border border-surface-200 rounded-xl text-xs p-4 bg-white leading-relaxed text-surface-800 overflow-y-auto"
          style={{ maxHeight: '26rem', fontFamily: 'Calibri, Arial, sans-serif', fontSize: '12.5px', lineHeight: '1.7' }}
          dangerouslySetInnerHTML={{ __html: mdToHtml(result.text || '') }}
        />
      </div>
    );
  }

  if (actionType === 'import_commitments') {
    return <CommitmentsPanel result={result} />;
  }

  if (actionType === 'validate_legal') {
    const d = result;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm text-brand-900">Concepto Legal:</span>
          <Badge className={d.concepto_general === 'favorable' ? 'bg-emerald-100 text-emerald-700' : d.concepto_general === 'desfavorable' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>
            {d.concepto_general}
          </Badge>
        </div>
        {d.cumplimientos?.length > 0 && (
          <div className="space-y-1.5">
            {d.cumplimientos.map((c, i) => (
              <div key={i} className={`flex items-start gap-2 p-2 rounded-lg text-xs ${c.estado === 'cumple' ? 'bg-emerald-50' : c.estado === 'incumple' ? 'bg-red-50' : 'bg-amber-50'}`}>
                <Badge className={c.estado === 'cumple' ? 'bg-emerald-100 text-emerald-700' : c.estado === 'incumple' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}>
                  {c.estado}
                </Badge>
                <div>
                  <p className="font-medium">{c.requisito}</p>
                  {c.observacion && <p className="text-surface-500 mt-0.5">{c.observacion}</p>}
                </div>
              </div>
            ))}
          </div>
        )}
        {d.incumplimientos_criticos?.length > 0 && (
          <Section title="Incumplimientos Críticos" icon={AlertTriangle} color="text-red-600">
            <ul className="space-y-1">{d.incumplimientos_criticos.map((ic, i) => <li key={i} className="text-xs text-red-700">• {ic}</li>)}</ul>
          </Section>
        )}
        {d.conclusion && <Section title="Conclusión"><p className="text-xs text-surface-700">{d.conclusion}</p></Section>}
      </div>
    );
  }

  if (actionType === 'risk_analysis') {
    const d = result;
    return (
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-sm">Riesgo General:</span>
          <Badge className={RISK_COLORS[d.riesgo_general] || 'bg-surface-100 text-surface-600'}>
            {d.riesgo_general}
          </Badge>
        </div>
        {d.resumen_riesgos && <p className="text-xs text-surface-700">{d.resumen_riesgos}</p>}
        {d.riesgos?.map((r, i) => (
          <div key={i} className={`border rounded-xl p-3 ${r.nivel === 'critico' ? 'border-red-200 bg-red-50' : r.nivel === 'importante' ? 'border-amber-200 bg-amber-50' : 'border-surface-200 bg-surface-50'}`}>
            <div className="flex items-center gap-2 mb-1">
              <Badge className={RISK_COLORS[r.nivel] || 'bg-surface-100 text-surface-600'}>{r.nivel}</Badge>
              <Badge className="bg-surface-100 text-surface-600">{r.categoria}</Badge>
              <span className="text-[10px] text-surface-400">P: {r.probabilidad} / I: {r.impacto}</span>
            </div>
            <p className="text-xs text-surface-800 font-medium">{r.descripcion}</p>
            {r.mitigacion && <p className="text-[10px] text-surface-500 mt-1">💡 {r.mitigacion}</p>}
          </div>
        ))}
        {d.acciones_inmediatas?.length > 0 && (
          <Section title="Acciones Inmediatas" icon={AlertTriangle} color="text-red-600">
            <ul className="space-y-1">{d.acciones_inmediatas.map((a, i) => <li key={i} className="text-xs text-red-700 font-medium">⚡ {a}</li>)}</ul>
          </Section>
        )}
      </div>
    );
  }

  return (
    <div className="text-xs text-surface-500 text-center py-6">
      Resultado procesado correctamente.
    </div>
  );
}

// ── Main Modal ────────────────────────────────────────────────────────────────
export default function DocumentAnalysisModal({ projectId, item, onClose }) {
  const [step, setStep]               = useState('classifying'); // classifying|confirming|analyzing|done|action
  const [classifyResult, setClassify] = useState(null);
  const [analysisResult, setAnalysis] = useState(null);
  const [docType, setDocType]         = useState(null);
  const [actionStep, setActionStep]   = useState(null); // null | { type, loading, result, error }
  const [error, setError]             = useState(null);

  // Step 1 — auto classify on mount
  useEffect(() => {
    (async () => {
      try {
        const r = await sharepointAPI.analyzeFile(projectId, item.id, { step: 'classify' }, item.name);
        setClassify(r.data.data);
        setStep('confirming');
      } catch (e) {
        setError(e.response?.data?.error || e.message);
        setStep('error');
      }
    })();
  }, [projectId, item]);

  // Step 2 — deep analysis after user confirms type
  const handleConfirmType = async (type) => {
    setDocType(type);
    setStep('analyzing');
    try {
      const r = await sharepointAPI.analyzeFile(projectId, item.id, { step: 'analyze', doc_type: type }, item.name);
      setAnalysis(r.data.data);
      setStep('done');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setStep('error');
    }
  };

  // Step 3 — post-analysis action
  const handleAction = async (type) => {
    if (type === 'import_commitments') {
      const commitments = analysisResult?.compromisos || [];
      if (commitments.length === 0) return alert('No se detectaron compromisos en este documento.');
      // Show import panel inside the modal
      setActionStep({ type, loading: false, result: { commitments }, error: null });
      return;
    }
    if (type === 'export') {
      setActionStep({ type, loading: true, result: null, error: null });
      try {
        const docLabel = DOC_TYPE_LABELS[docType] || docType || 'Documento';
        const content  = analysisToMarkdown(analysisResult, docLabel, item.name);
        const title    = `Análisis — ${item.name.replace(/\.[^.]+$/, '')}`;
        const resp     = await exportsAPI.aiDocToWord(projectId, { title, content });
        const blob     = new Blob([resp.data], {
          type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        });
        const url = URL.createObjectURL(blob);
        const a   = document.createElement('a');
        a.href    = url;
        a.download = `analisis_${item.name.replace(/\.[^.]+$/, '')}.docx`;
        a.click();
        URL.revokeObjectURL(url);
        setActionStep(null); // volver al análisis tras descargar
      } catch (e) {
        setActionStep({ type, loading: false, result: null, error: e.response?.data?.error || e.message });
      }
      return;
    }

    setActionStep({ type, loading: true, result: null, error: null });
    try {
      const r = await sharepointAPI.analyzeFile(projectId, item.id, {
        step: 'action', action_type: type, analysis: analysisResult,
      }, item.name);
      setActionStep({ type, loading: false, result: r.data.data, error: null });
    } catch (e) {
      setActionStep({ type, loading: false, result: null, error: e.response?.data?.error || e.message });
    }
  };

  const POST_ACTIONS = [
    { type: 'draft_response',      icon: Edit3,         label: 'Redactar respuesta',    color: 'bg-brand-50 text-brand-700 hover:bg-brand-100'   },
    { type: 'validate_legal',      icon: Shield,        label: 'Validar normativa',     color: 'bg-purple-50 text-purple-700 hover:bg-purple-100' },
    { type: 'import_commitments',  icon: ClipboardList, label: 'Ver compromisos',       color: 'bg-amber-50 text-amber-700 hover:bg-amber-100'   },
    { type: 'risk_analysis',       icon: TrendingDown,  label: 'Análisis de riesgos',   color: 'bg-red-50 text-red-700 hover:bg-red-100'         },
    { type: 'export',              icon: Download,      label: 'Exportar a Word',       color: 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 bg-black/50">
      <div className="bg-surface-50 rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 bg-white border-b border-surface-100 flex-shrink-0">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0">
              <Brain className="w-4 h-4 text-brand-600" />
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-brand-900 truncate">Análisis con IA</p>
              <p className="text-[10px] text-surface-400 truncate">{item.name}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {step === 'done' && !actionStep && (
              <button onClick={() => { setStep('classifying'); setClassify(null); setAnalysis(null); setDocType(null); }}
                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-400" title="Reanálisis">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
            <button onClick={onClose} className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-400">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">

          {/* LOADING: Classifying */}
          {step === 'classifying' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-brand-500">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="text-sm font-medium">Clasificando documento...</p>
              <p className="text-xs text-surface-400">La IA está leyendo el contenido</p>
            </div>
          )}

          {/* STEP: Confirm classification */}
          {step === 'confirming' && classifyResult && (
            <ClassifyResult
              result={classifyResult}
              onConfirm={handleConfirmType}
              loading={false}
            />
          )}

          {/* LOADING: Deep analysis */}
          {step === 'analyzing' && (
            <div className="flex flex-col items-center justify-center py-16 gap-3 text-brand-500">
              <Loader2 className="w-8 h-8 animate-spin" />
              <p className="text-sm font-medium">Analizando en profundidad...</p>
              <p className="text-xs text-surface-400">Extrayendo toda la información relevante</p>
            </div>
          )}

          {/* ERROR */}
          {step === 'error' && (
            <div className="flex flex-col items-center gap-3 py-10">
              <AlertTriangle className="w-8 h-8 text-red-400" />
              <p className="text-sm font-medium text-red-700">Error en el análisis</p>
              <p className="text-xs text-surface-500 text-center max-w-sm">{error}</p>
              <button onClick={onClose} className="btn-ghost text-sm">Cerrar</button>
            </div>
          )}

          {/* STEP: Analysis result */}
          {step === 'done' && analysisResult && !actionStep && (
            <>
              <div className="flex items-center gap-2">
                <Badge className="bg-brand-100 text-brand-700">{DOC_TYPE_LABELS[docType] || docType}</Badge>
                <span className="text-xs text-surface-400">Análisis completado</span>
              </div>
              <AnalysisDisplay docType={docType} analysis={analysisResult} />
            </>
          )}

          {/* STEP: Action result */}
          {step === 'done' && actionStep && (
            <div className="space-y-3">
              <button onClick={() => setActionStep(null)}
                className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-800">
                <ChevronRight className="w-3.5 h-3.5 rotate-180" /> Volver al análisis
              </button>
              {actionStep.loading && (
                <div className="flex items-center justify-center py-12 gap-2 text-brand-500">
                  <Loader2 className="w-6 h-6 animate-spin" />
                  <span className="text-sm">Procesando...</span>
                </div>
              )}
              {actionStep.error && (
                <div className="bg-red-50 border border-red-100 text-red-700 text-xs p-3 rounded-xl">{actionStep.error}</div>
              )}
              {actionStep.result && (
                <ActionResult actionType={actionStep.type} result={actionStep.result} projectId={projectId} />
              )}
            </div>
          )}
        </div>

        {/* Footer: post-analysis actions */}
        {step === 'done' && !actionStep && (
          <div className="px-5 py-3 bg-white border-t border-surface-100 flex-shrink-0">
            <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide mb-2">¿Qué deseas hacer?</p>
            <div className="flex flex-wrap gap-1.5">
              {POST_ACTIONS.map(a => {
                const Icon = a.icon;
                return (
                  <button key={a.type} onClick={() => handleAction(a.type)}
                    className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-colors ${a.color}`}>
                    <Icon className="w-3.5 h-3.5" /> {a.label}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
