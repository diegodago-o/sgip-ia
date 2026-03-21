import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Loader2, ArrowLeft, RefreshCw, Maximize2, Minimize2, Download,
  AlertTriangle, CheckCircle2, Clock, TrendingUp, TrendingDown,
  DollarSign, Shield, Users, CalendarRange, ClipboardList, FileText,
  ChevronDown, ChevronRight, AlertCircle, Target, Eye, BarChart3, Sparkles,
  Calendar,
} from 'lucide-react';
import { committeeAPI, aiAPI } from '../../services/api';
import CommitteeCommitmentsPanel from './CommitteeCommitmentsPanel';

const COP = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
const PCT = v => `${(parseFloat(v) || 0).toFixed(1)}%`;
const DATE = d => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const SEMAFORO_COLORS = {
  verde: { bg: 'bg-emerald-500', text: 'text-emerald-700', bgLight: 'bg-emerald-50', border: 'border-emerald-200', label: 'En orden' },
  amarillo: { bg: 'bg-amber-400', text: 'text-amber-700', bgLight: 'bg-amber-50', border: 'border-amber-200', label: 'Requiere atención' },
  rojo: { bg: 'bg-red-500', text: 'text-red-700', bgLight: 'bg-red-50', border: 'border-red-200', label: 'Crítico' },
};

function SemaforoLight({ color, size = 'md' }) {
  const c = SEMAFORO_COLORS[color] || SEMAFORO_COLORS.verde;
  const sz = size === 'lg' ? 'w-5 h-5' : size === 'sm' ? 'w-2.5 h-2.5' : 'w-3.5 h-3.5';
  return <span className={`inline-block rounded-full ${c.bg} ${sz}`} title={c.label} />;
}

function ProgressBar({ value, max = 100, color = 'brand', height = 'h-2', showLabel = false }) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const barColor = pct >= 80 ? 'bg-emerald-500' : pct >= 50 ? 'bg-amber-400' : 'bg-red-500';
  return (
    <div className="w-full">
      <div className={`w-full bg-surface-100 rounded-full ${height} overflow-hidden`}>
        <div className={`${barColor} ${height} rounded-full transition-all`} style={{ width: `${pct}%` }} />
      </div>
      {showLabel && <span className="text-[10px] text-surface-500 mt-0.5">{PCT(pct)}</span>}
    </div>
  );
}

function StatCard({ label, value, sub, icon: Icon, color = 'brand', semaforo }) {
  return (
    <div className={`bg-white rounded-xl border border-surface-100 p-4 flex items-start gap-3`}>
      <div className={`w-10 h-10 rounded-lg bg-${color}-50 flex items-center justify-center flex-shrink-0`}>
        <Icon className={`w-5 h-5 text-${color}-500`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-surface-400 font-medium uppercase tracking-wide">{label}</p>
        <div className="flex items-center gap-2">
          <p className="text-xl font-display font-bold text-brand-900">{value}</p>
          {semaforo && <SemaforoLight color={semaforo} />}
        </div>
        {sub && <p className="text-[11px] text-surface-500 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function Section({ title, icon: Icon, color = 'brand', semaforo, children, defaultOpen = true, extra }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
      <div className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-surface-50 transition-colors" onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-2.5">
          {open ? <ChevronDown className="w-4 h-4 text-surface-400" /> : <ChevronRight className="w-4 h-4 text-surface-400" />}
          <Icon className={`w-4.5 h-4.5 text-${color}-500`} />
          <h3 className="font-display font-bold text-brand-900 text-sm">{title}</h3>
          {semaforo && <SemaforoLight color={semaforo} size="sm" />}
        </div>
        {extra && <div onClick={e => e.stopPropagation()}>{extra}</div>}
      </div>
      {open && <div className="px-5 pb-4 border-t border-surface-50">{children}</div>}
    </div>
  );
}

export default function CommitteeDashboard() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fullscreen, setFullscreen] = useState(false);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [committeeType, setCommitteeType] = useState('mensual');
  const today = new Date().toISOString().split('T')[0];
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().split('T')[0];
  const [dateFrom, setDateFrom] = useState(monthAgo);
  const [dateTo, setDateTo] = useState(today);
  const [aiAnalysis, setAiAnalysis] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [pmiAnalysis, setPmiAnalysis] = useState(null);
  const [pmiLoading, setPmiLoading] = useState(false);
  const [aiView, setAiView] = useState('gerente'); // 'gerente' | 'ceo' | 'operativo'
  const [commitmentUpdating, setCommitmentUpdating] = useState(null);
  const [commitmentToast, setCommitmentToast] = useState(null);

  // loadTrigger is the ONLY thing that causes a fetch.
  // Changing committeeType (non-custom) or clicking Aplicar/Refresh updates it.
  const [loadTrigger, setLoadTrigger] = useState({ type: 'mensual', from: monthAgo, to: today, rev: 0 });

  useEffect(() => {
    let cancelled = false;
    const doLoad = async () => {
      setLoading(true); setError(null); setAiAnalysis(null);
      try {
        const { type, from, to } = loadTrigger;
        const r = await committeeAPI.dashboard(
          id, type,
          type === 'custom' ? from : undefined,
          type === 'custom' ? to   : undefined,
        );
        if (!cancelled) { setData(r.data.data); setLastRefresh(new Date()); }
      } catch (e) {
        if (!cancelled) setError(e.response?.data?.error || e.message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    doLoad();
    return () => { cancelled = true; };
  }, [id, loadTrigger]);

  const handleTypeChange = (t) => {
    setCommitteeType(t);
    if (t !== 'custom') setLoadTrigger(p => ({ type: t, from: dateFrom, to: dateTo, rev: p.rev }));
  };
  const handleApply   = () => setLoadTrigger(p => ({ type: 'custom', from: dateFrom, to: dateTo, rev: p.rev }));
  const handleRefresh = () => setLoadTrigger(p => ({ ...p, rev: p.rev + 1 }));

  const toggleFullscreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen();
      setFullscreen(true);
    } else {
      document.exitFullscreen();
      setFullscreen(false);
    }
  };

  const updateCommitmentInline = async (minuteId, itemIndex, newStatus) => {
    const key = `${minuteId}-${itemIndex}`;
    setCommitmentUpdating(key);
    try {
      await committeeAPI.updateCommitment(id, minuteId, itemIndex, { status: newStatus });
      setCommitmentToast(newStatus === 'completado' ? '✓ Compromiso completado' : 'Compromiso actualizado');
      setTimeout(() => setCommitmentToast(null), 2500);
      handleRefresh();
    } catch (e) {
      setCommitmentToast('Error: ' + (e.response?.data?.error || e.message));
      setTimeout(() => setCommitmentToast(null), 3000);
    } finally { setCommitmentUpdating(null); }
  };

  if (loading && !data) return (
    <div className="flex items-center justify-center py-32">
      <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
      <p className="ml-3 text-surface-500">Cargando dashboard del comité...</p>
    </div>
  );

  if (error && !data) return (
    <div className="p-6 bg-red-50 rounded-xl text-red-700">{error}</div>
  );

  const d = data;
  const p = d.project;
  const s = d.semaforos;
  const genColor = SEMAFORO_COLORS[s.general];
  const pa = d.period_activity || {};
  const period = d.period || {};

  const requestAIAnalysis = async () => {
    setAiLoading(true);
    setPmiAnalysis(null);
    try {
      const provider = localStorage.getItem('sgip_ai_provider') || 'openai';
      const apiKey = localStorage.getItem('sgip_ai_key') || '';
      const model = localStorage.getItem('sgip_ai_model') || '';

      // Build comprehensive data summary for AI
      const lateActs = d.schedule.late_activities || [];
      const topRisks = d.risks.top || [];
      const expPolicies = d.policies.expiring || [];
      const pendCommits = d.commitments.items || [];
      const overdueObs = d.obligations.overdue || [];

      const summary = `DATOS COMPLETOS DEL PROYECTO PARA ANÁLISIS DE COMITÉ DE SEGUIMIENTO

═══ INFORMACIÓN GENERAL ═══
Proyecto: ${p.name} (${p.code})
Cliente: ${p.client_name}
Valor contrato: ${COP(p.contract_value)}
Estado: ${p.status}
Inicio: ${DATE(p.start_date)} | Plazo: ${p.execution_term} ${p.execution_term_unit}
Días transcurridos: ${p.elapsed_days} de ${p.total_days} (${PCT(p.time_pct)})
Días restantes: ${p.days_remaining}

═══ PERÍODO ACTUAL: ${period.label} (${DATE(period.start)} — ${DATE(period.end)}, ${period.days} días) ═══
Actividades completadas en período: ${pa.activities_completed || 0}
Obligaciones cumplidas en período: ${pa.obligations_completed || 0}
Pagos recibidos en período: ${pa.payments_count || 0} por ${COP(pa.payments_value || 0)}
Riesgos nuevos en período: ${pa.risks_new || 0}
Riesgos cerrados en período: ${pa.risks_closed || 0}

═══ AVANCE FÍSICO (CRONOGRAMA) ═══
Avance físico real: ${PCT(d.schedule.physical_progress)}
Tiempo transcurrido: ${PCT(d.schedule.time_progress)}
Desviación: ${d.schedule.deviation > 0 ? '+' : ''}${d.schedule.deviation}% ${d.schedule.deviation >= 0 ? '(ADELANTO)' : '(ATRASO)'}
Actividades totales: ${d.schedule.stats?.total || 0}
Completadas: ${d.schedule.stats?.completada || 0}
En progreso: ${d.schedule.stats?.en_progreso || 0}
No iniciadas: ${d.schedule.stats?.no_iniciada || 0}
Atrasadas: ${d.schedule.stats?.atrasada || 0}
${lateActs.length > 0 ? `\nACTIVIDADES ATRASADAS:\n${lateActs.map(a => `- ${a.name} (debía terminar ${DATE(a.end_date)}, avance: ${PCT(a.progress_pct)})`).join('\n')}` : 'Sin actividades atrasadas'}
${d.schedule.upcoming_milestones?.length > 0 ? `\nHITOS PRÓXIMOS:\n${d.schedule.upcoming_milestones.map(m => `- ${m.name} (en ${m.days_until} días, avance: ${PCT(m.progress_pct)})`).join('\n')}` : ''}

═══ EJECUCIÓN FINANCIERA ═══
Ingreso total (con IVA): ${COP(d.financial.total_income)}
Presupuesto total egresos: ${COP(d.financial.total_budgeted)}
Total ejecutado: ${COP(d.financial.total_executed)} (${PCT(d.financial.execution_pct)} del ingreso)
Desviación presupuesto: ${COP(d.financial.total_executed - d.financial.total_budgeted)}
Desglose: Nómina=${COP(d.financial.breakdown?.payroll)}, Contratistas=${COP(d.financial.breakdown?.contractors)}, Gastos=${COP(d.financial.breakdown?.expenses)}
Pagos: ${d.financial.payments?.total_paid ? COP(d.financial.payments.total_paid) + ' pagados' : 'Sin pagos'}, ${d.financial.payments?.pending ? COP(d.financial.payments.pending) + ' pendientes' : ''}

═══ OBLIGACIONES CONTRACTUALES ═══
Total: ${d.obligations.total || 0}
Cumplidas: ${d.obligations.cumplidas || 0}
En curso: ${d.obligations.en_curso || 0}
Pendientes: ${d.obligations.pendientes || 0}
Vencidas: ${d.obligations.vencidas || 0}
${overdueObs.length > 0 ? `OBLIGACIONES VENCIDAS:\n${overdueObs.map(o => `- ${o.description?.substring(0, 100)} (vencida ${DATE(o.due_date)})`).join('\n')}` : ''}

═══ RIESGOS ═══
Total: ${d.risks.total || 0}
Críticos: ${d.risks.criticos || 0}
Altos: ${d.risks.altos || 0}
Materializados: ${d.risks.materializados || 0}
${topRisks.length > 0 ? `TOP RIESGOS:\n${topRisks.map(r => `- [${r.risk_level}] ${r.description} (prob: ${r.probability}, impacto: ${r.impact})`).join('\n')}` : ''}

═══ EQUIPO ═══
Miembros: ${d.team.total || 0}
Por reemplazar: ${d.team.por_reemplazar || 0}
Dedicación promedio: ${d.team.avg_dedication || 0}%

═══ PÓLIZAS ═══
Vigentes: ${d.policies.vigentes || 0}
Vencidas: ${d.policies.vencidas || 0}
${expPolicies.length > 0 ? `POR VENCER:\n${expPolicies.map(p => `- ${p.policy_type}: vence ${DATE(p.expiry_date)}`).join('\n')}` : ''}

═══ COMPROMISOS (de actas de seguimiento) ═══
Total: ${d.commitments.total || 0}
Completados: ${d.commitments.completed || 0}
Pendientes: ${d.commitments.pending || 0}
Vencidos: ${d.commitments.overdue || 0}
${pendCommits.length > 0 ? `COMPROMISOS PENDIENTES:\n${pendCommits.slice(0, 10).map(c => `- ${c.description?.substring(0, 100)} → ${c.responsible || 'Sin asignar'}`).join('\n')}` : ''}

═══ SEMÁFOROS ═══
General: ${s.general} | Cronograma: ${s.cronograma} | Financiero: ${s.financiero}
Obligaciones: ${s.obligaciones} | Riesgos: ${s.riesgos} | Pólizas: ${s.polizas}
Equipo: ${s.equipo} | Compromisos: ${s.compromisos}`;

      const fd = new FormData();
      fd.append('text', summary);
      fd.append('extraction_type', 'analyze');
      fd.append('analysis_prompt', `Eres un director de PMO senior con 20+ años de experiencia en gestión de proyectos de infraestructura y TI en Colombia (contratación pública). Estás preparando el análisis para presentar al comité de seguimiento ${period.label}.

Analiza los datos proporcionados y genera un diagnóstico PROFUNDO y ACCIONABLE. No seas genérico — sé específico con los números, fechas y nombres del proyecto.

Responde EXCLUSIVAMENTE con un JSON válido (sin markdown, sin backticks) con esta estructura:
{
  "health_score": <0-100 basado en datos reales>,
  "health_label": "<critico|en_riesgo|precaucion|saludable|excelente>",
  "executive_summary": "<diagnóstico ejecutivo en 3-4 oraciones que un gerente pueda presentar al comité>",
  "period_analysis": "<análisis específico de lo que pasó en el período ${period.label}: qué se logró, qué no se logró, velocidad de ejecución>",
  "critical_issues": [
    { "issue": "<problema concreto>", "impact": "<impacto real en el proyecto>", "urgency": "<inmediata|esta_semana|este_mes>", "owner": "<quién debe resolverlo>" }
  ],
  "alerts": [
    { "level": "<critico|alto|medio|bajo>", "category": "<cronograma|financiero|riesgos|obligaciones|equipo|polizas|compromisos>", "title": "<título corto>", "description": "<explicación detallada con datos>", "recommendation": "<acción concreta con plazo>" }
  ],
  "achievements": [
    { "description": "<logro específico del período>", "impact": "<alto|medio|bajo>" }
  ],
  "kpi_analysis": {
    "spi": <valor SPI: avance_real/avance_planeado>,
    "cpi": <valor CPI: valor_ganado/costo_real>,
    "spi_interpretation": "<interpretación del SPI>",
    "cpi_interpretation": "<interpretación del CPI>",
    "eac": <estimación al completar>,
    "etc": <estimación para completar>,
    "variance_at_completion": <variación al completar>
  },
  "risks_assessment": "<análisis de la exposición actual a riesgos y si las mitigaciones son suficientes>",
  "financial_analysis": "<análisis de flujo de caja: si la ejecución financiera va acorde al avance físico, si hay riesgo de desfinanciamiento>",
  "recommendations": [
    { "priority": "<alta|media|baja>", "action": "<acción concreta y medible>", "responsible": "<rol responsable>", "deadline": "<plazo sugerido>", "expected_impact": "<resultado esperado>" }
  ],
  "next_actions": ["<acción inmediata 1 con responsable y fecha>", "<acción 2>", "<acción 3>", "<acción 4>", "<acción 5>"],
  "committee_decisions_needed": ["<decisión que debe tomar el comité 1>", "<decisión 2>"],
  "productivity": { "score": "<buena|aceptable|baja|critica>", "analysis": "<análisis de velocidad: actividades/mes, gasto/mes, tendencia>" },
  "forecast": "<pronóstico: a este ritmo, ¿terminará a tiempo? ¿dentro del presupuesto? ¿qué debe cambiar?>"
}

REGLAS:
- health_score DEBE reflejar los semáforos reales (rojo=0-35, amarillo=36-65, verde=66-100)
- Genera mínimo 4 alertas y 4 recomendaciones basadas en datos reales
- SPI y CPI deben calcularse con los datos proporcionados
- Las recomendaciones deben incluir responsable y plazo concreto
- Los critical_issues son los que necesitan acción INMEDIATA del comité
- El forecast debe ser realista basado en tendencias
- committee_decisions_needed son las decisiones que el comité debe tomar HOY
- Los estados (verde/amarillo/rojo) deben ser coherentes con los semáforos calculados
- SOLO JSON válido, nada más`);
      fd.append('provider', provider);
      if (apiKey) fd.append('api_key', apiKey);
      if (model) fd.append('model', model);
      
      const res = await aiAPI.extract(fd);
      const raw = res.data.data.analysis || res.data.data.raw_response || JSON.stringify(res.data.data);
      
      // Try parsing JSON from response
      try {
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        setAiAnalysis({ structured: true, ...parsed });
        requestPMIAnalysis(summary, provider, apiKey, model);
      } catch {
        // Fallback: try to find JSON in the text
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            setAiAnalysis({ structured: true, ...parsed });
            requestPMIAnalysis(summary, provider, apiKey, model);
          } catch { setAiAnalysis({ structured: false, text: raw }); }
        } else {
          setAiAnalysis({ structured: false, text: raw });
        }
      }
    } catch (e) {
      setAiAnalysis({ structured: false, text: `Error: ${e.response?.data?.error || e.message}` });
    } finally { setAiLoading(false); }
  };

  const requestPMIAnalysis = async (summary, provider, apiKey, model) => {
    setPmiLoading(true);
    try {
      const fd = new FormData();
      fd.append('text', summary);
      fd.append('extraction_type', 'analyze');
      fd.append('analysis_prompt', `Eres un experto certificado PMP/PgMP en gestión de proyectos PMBoK 7. Con base en los datos reales del proyecto proporcionados, analiza y completa TODOS los indicadores. Usa cifras y datos concretos del proyecto — NUNCA valores genéricos ni placeholders. Infiere valores razonables basados en los semáforos y métricas cuando no haya dato exacto disponible.

Responde EXCLUSIVAMENTE con un JSON válido (sin markdown, sin backticks) con esta estructura:
{
  "pmi_gerente": [
    {
      "grupo": "Cronograma",
      "emoji": "📅",
      "indicadores": [
        { "nombre": "SPI – Índice desempeño cronograma", "valor": "<valor numérico calculado: avance_real/tiempo_transcurrido>", "estado": "<verde|amarillo|rojo>", "nota": "<interpretación concreta con datos>" },
        { "nombre": "Desviación del cronograma", "valor": "<+/- días o %>", "estado": "<verde|amarillo|rojo>", "nota": "<breve con cifra real>" },
        { "nombre": "Actividades críticas vencidas", "valor": "<N actividades>", "estado": "<verde|amarillo|rojo>", "nota": "<breve>" },
        { "nombre": "Probabilidad de cumplir fecha final", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<breve basado en tendencia>" }
      ]
    },
    {
      "grupo": "Costo y Control Financiero",
      "emoji": "💰",
      "indicadores": [
        { "nombre": "CPI – Índice desempeño del costo", "valor": "<valor numérico>", "estado": "<verde|amarillo|rojo>", "nota": "<interpretación>" },
        { "nombre": "Presupuesto ejecutado vs aprobado", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<breve con cifras>" },
        { "nombre": "EAC – Estimado al cierre", "valor": "<COP>", "estado": "<verde|amarillo|rojo>", "nota": "<vs presupuesto base>" },
        { "nombre": "Variación presupuestal proyectada", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<anticipa sobrecosto o ahorro>" }
      ]
    },
    {
      "grupo": "Riesgos e Incidentes",
      "emoji": "🛡",
      "indicadores": [
        { "nombre": "Top riesgos abiertos", "valor": "<N críticos, N altos>", "estado": "<verde|amarillo|rojo>", "nota": "<principales riesgos vigentes>" },
        { "nombre": "Riesgos materializados en el período", "valor": "<N>", "estado": "<verde|amarillo|rojo>", "nota": "<breve>" },
        { "nombre": "Issues o bloqueos críticos abiertos", "valor": "<N>", "estado": "<verde|amarillo|rojo>", "nota": "<breve>" },
        { "nombre": "Tiempo promedio resolución bloqueos", "valor": "<N días>", "estado": "<verde|amarillo|rojo>", "nota": "<capacidad de respuesta>" }
      ]
    },
    {
      "grupo": "Calidad y Control Técnico",
      "emoji": "✅",
      "indicadores": [
        { "nombre": "Entregables aceptados a la primera", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<calidad inicial>" },
        { "nombre": "Retrabajo", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<esfuerzo en correcciones>" },
        { "nombre": "No conformidades o defectos críticos", "valor": "<N>", "estado": "<verde|amarillo|rojo>", "nota": "<breve>" },
        { "nombre": "Cumplimiento criterios de aceptación", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<calidad funcional y contractual>" }
      ]
    },
    {
      "grupo": "Recursos y Capacidad",
      "emoji": "👥",
      "indicadores": [
        { "nombre": "Disponibilidad de recursos críticos", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<roles clave disponibles>" },
        { "nombre": "Sobrecarga de capacidad por rol", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<saturación>" },
        { "nombre": "Rotación de personal clave", "valor": "<N personas>", "estado": "<verde|amarillo|rojo>", "nota": "<riesgo continuidad>" },
        { "nombre": "Dependencias externas vencidas", "valor": "<N>", "estado": "<verde|amarillo|rojo>", "nota": "<pendientes de terceros>" }
      ]
    },
    {
      "grupo": "Stakeholders y Gobernanza",
      "emoji": "🤝",
      "indicadores": [
        { "nombre": "Decisiones pendientes de comité", "valor": "<N decisiones>", "estado": "<verde|amarillo|rojo>", "nota": "<decisiones ejecutivas abiertas>" },
        { "nombre": "Compromisos vencidos de áreas", "valor": "<N>", "estado": "<verde|amarillo|rojo>", "nota": "<para escalar>" },
        { "nombre": "Involucramiento de stakeholders", "valor": "<escala 1-5>", "estado": "<verde|amarillo|rojo>", "nota": "<breve>" },
        { "nombre": "Cumplimiento plan de comunicaciones", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<alineación>" }
      ]
    },
    {
      "grupo": "Beneficios y Valor",
      "emoji": "🎯",
      "indicadores": [
        { "nombre": "Beneficios planificados vs capturados", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<valor ya materializado>" },
        { "nombre": "Valor entregado por etapa", "valor": "<descripción corta>", "estado": "<verde|amarillo|rojo>", "nota": "<resultados utilizables>" },
        { "nombre": "Funcionalidades/servicios operativos", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<entrega usable>" },
        { "nombre": "Alineación con objetivos estratégicos", "valor": "<Alta|Media|Baja>", "estado": "<verde|amarillo|rojo>", "nota": "<contribución>" }
      ]
    },
    {
      "grupo": "Cambio y Adopción",
      "emoji": "🔄",
      "indicadores": [
        { "nombre": "Nivel de adopción del entregable", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<qué tanto se usa>" },
        { "nombre": "Usuarios impactados vs activos", "valor": "<N/N>", "estado": "<verde|amarillo|rojo>", "nota": "<transformación digital>" },
        { "nombre": "Cumplimiento gestión del cambio", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<formación, comunicaciones>" },
        { "nombre": "Resistencia/incidentes de adopción", "valor": "<N incidentes>", "estado": "<verde|amarillo|rojo>", "nota": "<anticipar fracaso>" }
      ]
    },
    {
      "grupo": "Obligaciones y Cumplimiento",
      "emoji": "📋",
      "indicadores": [
        { "nombre": "Cumplimiento obligaciones contractuales", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<obligaciones cumplidas vs total>" },
        { "nombre": "Obligaciones vencidas sin atender", "valor": "<N>", "estado": "<verde|amarillo|rojo>", "nota": "<riesgo legal>" },
        { "nombre": "Pólizas vigentes vs requeridas", "valor": "<N/N>", "estado": "<verde|amarillo|rojo>", "nota": "<cobertura>" },
        { "nombre": "Índice de cumplimiento contractual", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<salud contractual general>" }
      ]
    }
  ],
  "pmi_ceo": [
    {
      "grupo": "Salud Ejecutiva",
      "emoji": "🚦",
      "indicadores": [
        { "nombre": "Estado general del proyecto (RAG)", "valor": "<Verde|Amarillo|Rojo>", "estado": "<verde|amarillo|rojo>", "nota": "<resumen ejecutivo en una línea>" },
        { "nombre": "Estado de alcance", "valor": "<Verde|Amarillo|Rojo>", "estado": "<verde|amarillo|rojo>", "nota": "<breve>" },
        { "nombre": "Estado de tiempo", "valor": "<Verde|Amarillo|Rojo>", "estado": "<verde|amarillo|rojo>", "nota": "<breve con días de desviación>" },
        { "nombre": "Estado de costo", "valor": "<Verde|Amarillo|Rojo>", "estado": "<verde|amarillo|rojo>", "nota": "<breve con cifra>" }
      ]
    },
    {
      "grupo": "Valor y Beneficios",
      "emoji": "💎",
      "indicadores": [
        { "nombre": "Beneficio esperado del proyecto", "valor": "<descripción: ingreso/ahorro/eficiencia>", "estado": "<verde|amarillo|rojo>", "nota": "<breve>" },
        { "nombre": "Beneficio capturado a la fecha", "valor": "<%> del esperado", "estado": "<verde|amarillo|rojo>", "nota": "<valor ya materializado>" },
        { "nombre": "ROI actualizado / esperado", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<fundamental para inversión>" },
        { "nombre": "Valor en riesgo", "valor": "<COP o %>", "estado": "<verde|amarillo|rojo>", "nota": "<si el proyecto falla>" }
      ]
    },
    {
      "grupo": "Tiempo y Costo Ejecutivo",
      "emoji": "📊",
      "indicadores": [
        { "nombre": "Fecha compromiso vs estimada cierre", "valor": "<fecha1 vs fecha2>", "estado": "<verde|amarillo|rojo>", "nota": "<solo dato ejecutivo>" },
        { "nombre": "Presupuesto aprobado vs ejecutado", "valor": "<COP aprobado | COP ejecutado>", "estado": "<verde|amarillo|rojo>", "nota": "<vistazo financiero>" },
        { "nombre": "Sobrecosto esperado", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<solo si es material>" },
        { "nombre": "Necesidad de presupuesto adicional", "valor": "<Sí / No>", "estado": "<verde|amarillo|rojo>", "nota": "<para decisión inmediata>" }
      ]
    },
    {
      "grupo": "Riesgo Corporativo",
      "emoji": "⚠️",
      "indicadores": [
        { "nombre": "Top 3 riesgos corporativos", "valor": "<riesgo 1 | riesgo 2 | riesgo 3>", "estado": "<verde|amarillo|rojo>", "nota": "<legales, reputacionales, financieros>" },
        { "nombre": "Probabilidad de no lograr beneficios", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<más importante que retraso>" },
        { "nombre": "Exposición residual del proyecto", "valor": "<Alta|Media|Baja>", "estado": "<verde|amarillo|rojo>", "nota": "<tras controles>" },
        { "nombre": "Impacto organizacional ante falla", "valor": "<descripción>", "estado": "<verde|amarillo|rojo>", "nota": "<criticidad para operación>" }
      ]
    },
    {
      "grupo": "Gobernanza y Decisiones",
      "emoji": "🗳",
      "indicadores": [
        { "nombre": "Decisiones que requiere el comité hoy", "valor": "<N decisiones pendientes>", "estado": "<verde|amarillo|rojo>", "nota": "<el comité debe decidir, no solo escuchar>" },
        { "nombre": "Escalamientos abiertos", "valor": "<N>", "estado": "<verde|amarillo|rojo>", "nota": "<obstáculos que necesitan intervención>" },
        { "nombre": "Compromisos comité anterior cumplidos", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<disciplina de gobernanza>" },
        { "nombre": "Desviaciones fuera de tolerancia", "valor": "<N>", "estado": "<verde|amarillo|rojo>", "nota": "<ya excedieron umbrales>" }
      ]
    },
    {
      "grupo": "Adopción y Sostenibilidad",
      "emoji": "🌱",
      "indicadores": [
        { "nombre": "Adopción ejecutiva / organizacional", "valor": "<%>", "estado": "<verde|amarillo|rojo>", "nota": "<si el cambio está entrando en operación>" },
        { "nombre": "Preparación operativa", "valor": "<Alta|Media|Baja>", "estado": "<verde|amarillo|rojo>", "nota": "<para recibir el entregable>" },
        { "nombre": "Satisfacción del cliente", "valor": "<X/10>", "estado": "<verde|amarillo|rojo>", "nota": "<percepción resumida>" },
        { "nombre": "Sostenibilidad del beneficio", "valor": "<Temporal|Permanente>", "estado": "<verde|amarillo|rojo>", "nota": "<si el valor será perdurable>" }
      ]
    }
  ]
}

REGLAS:
- Todos los valores deben ser CONCRETOS y basados en los datos reales del proyecto
- Los estados (verde/amarillo/rojo): verde=bueno/dentro de tolerancia, amarillo=requiere atención, rojo=crítico
- Si un dato no está disponible directamente, infiere un valor razonable con base en semáforos y tendencias
- Para SPI: usar avance_físico / tiempo_transcurrido (ambos en porcentaje)
- Para CPI: usar valor_ganado / costo_real (estimar si no disponible)
- SOLO JSON válido, nada más`);
      fd.append('provider', provider);
      if (apiKey) fd.append('api_key', apiKey);
      if (model) fd.append('model', model);

      const res = await aiAPI.extract(fd);
      const raw = res.data.data.analysis || res.data.data.raw_response || JSON.stringify(res.data.data);

      try {
        const clean = raw.replace(/```json|```/g, '').trim();
        const parsed = JSON.parse(clean);
        if (parsed.pmi_gerente || parsed.pmi_ceo) setPmiAnalysis(parsed);
      } catch {
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          try {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.pmi_gerente || parsed.pmi_ceo) setPmiAnalysis(parsed);
          } catch {}
        }
      }
    } catch (e) {
      console.error('PMI analysis failed:', e.message);
    } finally {
      setPmiLoading(false);
    }
  };

  return (
    <div className={`min-h-screen ${fullscreen ? 'bg-surface-50 p-4' : ''}`}>
      {/* Header */}
      <div className={`${genColor.bgLight} ${genColor.border} border rounded-xl p-5 mb-5`}>
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(-1)} className="p-1.5 rounded-lg hover:bg-white/50">
              <ArrowLeft className="w-5 h-5 text-surface-600" />
            </button>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs font-mono bg-white/70 px-2 py-0.5 rounded">{p.code}</span>
                <span className={`text-xs px-2 py-0.5 rounded font-medium ${genColor.bg} text-white`}>{genColor.label}</span>
              </div>
              <h1 className="text-xl font-display font-bold text-brand-900">{p.name}</h1>
              <p className="text-xs text-surface-500 mt-0.5">{p.client_name} • {p.contract_type} • Valor: {COP(p.contract_value)}</p>
            </div>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="flex items-center gap-2">
              {/* Committee type selector */}
              <div className="flex items-center gap-2">
                <div className="flex bg-white/70 rounded-lg border border-surface-200 text-xs overflow-hidden">
                  {[
                    { id: 'quincenal',      label: 'Quincenal' },
                    { id: 'mensual',        label: 'Mensual' },
                    { id: 'extraordinario', label: 'Extraordinario' },
                    { id: 'custom',         label: <span className="flex items-center gap-1"><Calendar className="w-3 h-3"/>Personalizado</span> },
                  ].map(({ id: t, label }) => (
                    <button key={t} onClick={() => handleTypeChange(t)}
                      className={`px-3 py-1.5 transition-colors whitespace-nowrap ${committeeType === t ? 'bg-brand-600 text-white' : 'text-surface-600 hover:bg-white'}`}>
                      {label}
                    </button>
                  ))}
                </div>
                {committeeType === 'custom' && (
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1.5 bg-white/80 border border-brand-200 rounded-lg px-2 py-1">
                      <input type="date" value={dateFrom} max={dateTo}
                        onChange={e => setDateFrom(e.target.value)}
                        className="text-xs text-brand-800 bg-transparent border-none outline-none cursor-pointer"/>
                      <span className="text-[10px] text-surface-400">→</span>
                      <input type="date" value={dateTo} min={dateFrom} max={today}
                        onChange={e => setDateTo(e.target.value)}
                        className="text-xs text-brand-800 bg-transparent border-none outline-none cursor-pointer"/>
                    </div>
                    <button onClick={handleApply} disabled={loading}
                      className="px-3 py-1.5 text-xs font-semibold bg-brand-600 hover:bg-brand-700 text-white rounded-lg transition-colors disabled:opacity-50">
                      Aplicar
                    </button>
                  </div>
                )}
              </div>
              <button onClick={handleRefresh} disabled={loading} className="btn-ghost text-xs flex items-center gap-1">
                <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              </button>
              <button onClick={toggleFullscreen} className="btn-ghost text-xs flex items-center gap-1">
                {fullscreen ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
              </button>
            </div>
            <span className="text-[10px] text-surface-400">
              Período: {DATE(period.start)} — {DATE(period.end)} ({period.days} días)
            </span>
          </div>
        </div>

        {/* Semáforos resumen */}
        <div className="grid grid-cols-4 sm:grid-cols-8 gap-2 mt-4">
          {[
            { label: 'General', key: 'general', icon: Eye },
            { label: 'Cronograma', key: 'cronograma', icon: CalendarRange },
            { label: 'Financiero', key: 'financiero', icon: DollarSign },
            { label: 'Obligaciones', key: 'obligaciones', icon: ClipboardList },
            { label: 'Riesgos', key: 'riesgos', icon: Shield },
            { label: 'Pólizas', key: 'polizas', icon: FileText },
            { label: 'Equipo', key: 'equipo', icon: Users },
            { label: 'Compromisos', key: 'compromisos', icon: Target },
          ].map(({ label, key, icon: I }) => (
            <div key={key} className="bg-white/70 rounded-lg p-2 text-center">
              <SemaforoLight color={s[key]} size="md" />
              <p className="text-[9px] text-surface-500 mt-1 font-medium">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Time bar */}
      <div className="bg-white rounded-xl border border-surface-100 p-4 mb-4">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <Clock className="w-4 h-4 text-surface-400" />
            <span className="text-xs font-medium text-brand-800">Tiempo del Proyecto</span>
          </div>
          <span className="text-xs text-surface-500">
            Inicio: {DATE(p.start_date)} • Plazo: {p.execution_term} {p.execution_term_unit === 'dias' ? 'días' : 'meses'}
            • Faltan: <b className={p.days_remaining < 30 ? 'text-red-600' : ''}>{p.days_remaining} días</b>
          </span>
        </div>
        <div className="relative">
          <div className="w-full bg-surface-100 rounded-full h-3 overflow-hidden">
            <div className="bg-blue-500 h-3 rounded-full transition-all relative" style={{ width: `${p.time_pct}%` }}>
              <span className="absolute right-1 top-0 text-[8px] text-white font-bold leading-3">{PCT(p.time_pct)}</span>
            </div>
          </div>
          {/* Physical progress marker */}
          <div className="absolute top-0 h-3 border-l-2 border-emerald-600 border-dashed"
            style={{ left: `${Math.min(100, d.schedule.physical_progress)}%` }}
            title={`Avance físico: ${PCT(d.schedule.physical_progress)}`}>
            <span className="absolute -top-4 -translate-x-1/2 text-[8px] bg-emerald-100 text-emerald-700 px-1 rounded">
              Físico {PCT(d.schedule.physical_progress)}
            </span>
          </div>
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] text-surface-400">{p.elapsed_days} días transcurridos</span>
          <span className={`text-[9px] font-medium ${d.schedule.deviation >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {d.schedule.deviation >= 0 ? '↑' : '↓'} Desviación: {d.schedule.deviation}%
          </span>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
        <StatCard label="Avance Físico" value={PCT(d.schedule.physical_progress)} icon={TrendingUp} color="emerald" semaforo={s.cronograma}
          sub={`${d.schedule.stats.completada || 0}/${d.schedule.stats.total || 0} actividades`} />
        <StatCard label="Ejecución Financiera" value={PCT(d.financial.execution_pct)} icon={DollarSign} color="blue" semaforo={s.financiero}
          sub={`${COP(d.financial.total_executed)} de ${COP(d.financial.total_income)}`} />
        <StatCard label="Obligaciones" value={`${d.obligations.cumplidas || 0}/${d.obligations.total || 0}`} icon={ClipboardList} color="violet" semaforo={s.obligaciones}
          sub={`${d.obligations.vencidas || 0} vencidas, ${d.obligations.pendientes || 0} pendientes`} />
        <StatCard label="Compromisos" value={`${d.commitments.completed}/${d.commitments.total}`} icon={Target} color="amber" semaforo={s.compromisos}
          sub={`${d.commitments.overdue} vencidos, ${d.commitments.pending} pendientes`} />
      </div>

      {/* Period Activity Summary */}
      <div className="bg-gradient-to-r from-brand-50 to-blue-50 rounded-xl border border-brand-100 p-4 mb-4">
        <p className="text-xs font-bold text-brand-800 mb-2">
          📋 Resumen del Período ({period.label}: {DATE(period.start)} — {DATE(period.end)})
        </p>
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2 text-center">
          {[
            { label: 'Actividades completadas', val: pa.activities_completed || 0, color: 'emerald' },
            { label: 'Obligaciones cumplidas', val: pa.obligations_completed || 0, color: 'blue' },
            { label: 'Riesgos nuevos', val: pa.risks_new || 0, color: pa.risks_new > 0 ? 'red' : 'surface' },
            { label: 'Riesgos cerrados', val: pa.risks_closed || 0, color: 'emerald' },
            { label: 'Pagos recibidos', val: pa.payments_count || 0, color: 'green' },
            { label: 'Valor pagos', val: COP(pa.payments_value || 0), color: 'green', small: true },
          ].map((item, i) => (
            <div key={i} className="bg-white/70 rounded-lg p-2">
              <p className={`${item.small ? 'text-xs' : 'text-lg'} font-bold text-${item.color}-700`}>{item.val}</p>
              <p className="text-[9px] text-surface-500">{item.label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* AI Analysis */}
      <div className="bg-white rounded-xl border border-surface-100 p-4 mb-4">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Sparkles className="w-4.5 h-4.5 text-violet-500" />
            <h3 className="font-display font-bold text-brand-900 text-sm">Análisis IA del Comité</h3>
          </div>
          <button onClick={requestAIAnalysis} disabled={aiLoading || pmiLoading}
            className="btn-primary text-xs flex items-center gap-1.5 px-3 py-1.5">
            {(aiLoading || pmiLoading) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" />}
            {aiLoading ? 'Analizando diagnóstico...' : pmiLoading ? 'Calculando PMBoK...' : aiAnalysis ? 'Regenerar análisis' : 'Generar análisis IA'}
          </button>
        </div>
        {aiAnalysis?.structured ? (() => {
          const ai = aiAnalysis;
          const hColors = { critico:'text-red-700 bg-red-50', en_riesgo:'text-orange-700 bg-orange-50', precaucion:'text-amber-700 bg-amber-50', saludable:'text-emerald-700 bg-emerald-50', excelente:'text-green-700 bg-green-50' };
          const aColors = { critico:'bg-red-50 border-red-200 text-red-800', alto:'bg-orange-50 border-orange-200 text-orange-800', medio:'bg-amber-50 border-amber-200 text-amber-800', bajo:'bg-blue-50 border-blue-200 text-blue-800' };
          const aIcons = { critico: <AlertCircle className="w-4 h-4 text-red-500" />, alto: <AlertTriangle className="w-4 h-4 text-orange-500" />, medio: <Clock className="w-4 h-4 text-amber-500" />, bajo: <CheckCircle2 className="w-4 h-4 text-blue-500" /> };
          const hLabel = { critico:'Crítico', en_riesgo:'En Riesgo', precaucion:'Precaución', saludable:'Saludable', excelente:'Excelente' };
          const pColors = { buena:'text-emerald-700 bg-emerald-50', aceptable:'text-blue-700 bg-blue-50', baja:'text-amber-700 bg-amber-50', critica:'text-red-700 bg-red-50' };

          // RAG helpers
          const ragDot = (estado) => {
            const c = { verde:'bg-emerald-500', amarillo:'bg-amber-400', rojo:'bg-red-500' };
            const t = { verde:'bg-emerald-50 border-emerald-200 text-emerald-800', amarillo:'bg-amber-50 border-amber-200 text-amber-800', rojo:'bg-red-50 border-red-200 text-red-800' };
            return { dot: c[estado] || 'bg-surface-300', card: t[estado] || 'bg-surface-50 border-surface-200 text-surface-700' };
          };

          const PmiIndicatorCard = ({ ind }) => {
            const rag = ragDot(ind.estado);
            return (
              <div className={`p-3 rounded-lg border ${rag.card} flex flex-col gap-1`}>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-semibold leading-tight flex-1">{ind.nombre}</p>
                  <span className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5 ${rag.dot}`} />
                </div>
                <p className="text-sm font-bold leading-tight">{ind.valor}</p>
                {ind.nota && <p className="text-[10px] opacity-60 leading-tight italic">{ind.nota}</p>}
              </div>
            );
          };

          const PmiGroupSection = ({ grupo }) => (
            <div>
              <h5 className="text-xs font-bold text-brand-700 mb-2 flex items-center gap-1.5">
                <span>{grupo.emoji}</span> {grupo.grupo}
              </h5>
              <div className="grid grid-cols-2 gap-2">
                {(grupo.indicadores || []).map((ind, i) => <PmiIndicatorCard key={i} ind={ind} />)}
              </div>
            </div>
          );

          return (
            <div className="space-y-4 animate-slide-up">
              {/* Health Score */}
              <div className={`p-4 rounded-xl ${hColors[ai.health_label] || 'bg-surface-50'}`}>
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-medium opacity-70">Salud del Proyecto</p>
                    <p className="text-3xl font-display font-bold">{ai.health_score}/100</p>
                    <p className="text-xs mt-1 capitalize font-semibold">{hLabel[ai.health_label] || ai.health_label}</p>
                  </div>
                  {ai.productivity && (
                    <div className={`text-right px-3 py-2 rounded-lg ${pColors[ai.productivity.score] || 'bg-surface-50'}`}>
                      <p className="text-[10px] font-medium opacity-70">Productividad</p>
                      <p className="text-sm font-bold capitalize">{ai.productivity.score}</p>
                    </div>
                  )}
                </div>
                <p className="text-sm mt-3 opacity-80 leading-relaxed">{ai.executive_summary}</p>
                {ai.productivity?.analysis && <p className="text-xs mt-2 opacity-60 italic">{ai.productivity.analysis}</p>}
              </div>

              {/* ── Vista switcher ── */}
              <div className="flex items-center gap-1 p-1 bg-surface-100 rounded-xl">
                {[
                  { id: 'gerente', label: '🎯 Gerente de Programa' },
                  { id: 'ceo',     label: '👔 CEO / Dirección' },
                  { id: 'operativo', label: '📋 Diagnóstico Operativo' },
                ].map(v => (
                  <button key={v.id} onClick={() => setAiView(v.id)}
                    className={`flex-1 text-[11px] font-semibold py-1.5 px-2 rounded-lg transition-all duration-150 ${aiView === v.id ? 'bg-white text-brand-700 shadow-sm' : 'text-surface-500 hover:text-brand-600'}`}>
                    {v.label}
                  </button>
                ))}
              </div>

              {/* ── Vista Gerente de Programa ── */}
              {aiView === 'gerente' && (
                pmiLoading ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-surface-400">
                    <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
                    <span className="text-xs font-medium">Analizando 36 indicadores PMBoK...</span>
                    <span className="text-[10px] text-surface-300">Esto puede tomar unos segundos</span>
                  </div>
                ) : pmiAnalysis?.pmi_gerente?.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 py-1">
                      <span className="text-xs font-bold text-brand-800">Indicadores PMBoK — Gerente de Programa</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-100 text-brand-600 font-medium">{pmiAnalysis.pmi_gerente.length} grupos · {pmiAnalysis.pmi_gerente.reduce((s, g) => s + (g.indicadores?.length || 0), 0)} indicadores</span>
                    </div>
                    {pmiAnalysis.pmi_gerente.map((grupo, gi) => <PmiGroupSection key={gi} grupo={grupo} />)}
                  </div>
                ) : (
                  <p className="text-xs text-surface-400 italic text-center py-6">Los indicadores PMBoK se generarán automáticamente al hacer clic en "Generar análisis IA".</p>
                )
              )}

              {/* ── Vista CEO ── */}
              {aiView === 'ceo' && (
                pmiLoading ? (
                  <div className="flex flex-col items-center justify-center gap-2 py-10 text-surface-400">
                    <Loader2 className="w-5 h-5 animate-spin text-violet-400" />
                    <span className="text-xs font-medium">Analizando indicadores ejecutivos PMBoK...</span>
                    <span className="text-[10px] text-surface-300">Esto puede tomar unos segundos</span>
                  </div>
                ) : pmiAnalysis?.pmi_ceo?.length > 0 ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 py-1">
                      <span className="text-xs font-bold text-brand-800">Indicadores PMBoK — CEO / Dirección General</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-violet-100 text-violet-600 font-medium">{pmiAnalysis.pmi_ceo.length} grupos · {pmiAnalysis.pmi_ceo.reduce((s, g) => s + (g.indicadores?.length || 0), 0)} indicadores</span>
                    </div>
                    {pmiAnalysis.pmi_ceo.map((grupo, gi) => <PmiGroupSection key={gi} grupo={grupo} />)}
                  </div>
                ) : (
                  <p className="text-xs text-surface-400 italic text-center py-6">Los indicadores ejecutivos PMBoK se generarán automáticamente al hacer clic en "Generar análisis IA".</p>
                )
              )}

              {/* ── Vista Operativo (diagnóstico original) ── */}
              {aiView === 'operativo' && (
                <div className="space-y-4">

              {/* Period Analysis */}
              {ai.period_analysis && (
                <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
                  <h4 className="text-xs font-bold text-blue-800 mb-1">📊 Análisis del Período</h4>
                  <p className="text-sm text-blue-900 leading-relaxed">{ai.period_analysis}</p>
                </div>
              )}

              {/* KPI Analysis (SPI, CPI) */}
              {ai.kpi_analysis && (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  <div className={`p-3 rounded-lg text-center ${ai.kpi_analysis.spi >= 1 ? 'bg-emerald-50 border border-emerald-200' : ai.kpi_analysis.spi >= 0.9 ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
                    <p className="text-[10px] font-semibold opacity-60">SPI (Schedule)</p>
                    <p className="text-xl font-display font-bold">{(ai.kpi_analysis.spi || 0).toFixed(2)}</p>
                    <p className="text-[9px] opacity-50">{ai.kpi_analysis.spi >= 1 ? 'Adelantado' : 'Atrasado'}</p>
                  </div>
                  <div className={`p-3 rounded-lg text-center ${ai.kpi_analysis.cpi >= 1 ? 'bg-emerald-50 border border-emerald-200' : ai.kpi_analysis.cpi >= 0.9 ? 'bg-amber-50 border border-amber-200' : 'bg-red-50 border border-red-200'}`}>
                    <p className="text-[10px] font-semibold opacity-60">CPI (Cost)</p>
                    <p className="text-xl font-display font-bold">{(ai.kpi_analysis.cpi || 0).toFixed(2)}</p>
                    <p className="text-[9px] opacity-50">{ai.kpi_analysis.cpi >= 1 ? 'Bajo presup.' : 'Sobre presup.'}</p>
                  </div>
                  {ai.kpi_analysis.eac && (
                    <div className="p-3 rounded-lg text-center bg-surface-50 border border-surface-200">
                      <p className="text-[10px] font-semibold text-surface-500">EAC (Est. al completar)</p>
                      <p className="text-sm font-display font-bold text-brand-900">{COP(ai.kpi_analysis.eac)}</p>
                    </div>
                  )}
                  {ai.kpi_analysis.variance_at_completion && (
                    <div className={`p-3 rounded-lg text-center ${ai.kpi_analysis.variance_at_completion >= 0 ? 'bg-emerald-50 border border-emerald-200' : 'bg-red-50 border border-red-200'}`}>
                      <p className="text-[10px] font-semibold opacity-60">Variación final</p>
                      <p className="text-sm font-display font-bold">{COP(ai.kpi_analysis.variance_at_completion)}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Critical Issues (need committee action) */}
              {ai.critical_issues?.length > 0 && (
                <div className="bg-red-50 border-2 border-red-200 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-red-800 mb-2 flex items-center gap-2">
                    <AlertCircle className="w-4 h-4" /> Temas Críticos para el Comité ({ai.critical_issues.length})
                  </h4>
                  <div className="space-y-2">
                    {ai.critical_issues.map((ci, i) => (
                      <div key={i} className="bg-white rounded-lg p-3 border border-red-100">
                        <p className="text-sm font-medium text-red-900">{ci.issue}</p>
                        <p className="text-xs text-red-700 mt-1">Impacto: {ci.impact}</p>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${ci.urgency === 'inmediata' ? 'bg-red-200 text-red-800' : ci.urgency === 'esta_semana' ? 'bg-amber-200 text-amber-800' : 'bg-blue-100 text-blue-700'}`}>{ci.urgency}</span>
                          {ci.owner && <span className="text-[10px] text-red-600">→ {ci.owner}</span>}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Committee Decisions Needed */}
              {ai.committee_decisions_needed?.length > 0 && (
                <div className="bg-violet-50 border border-violet-200 rounded-xl p-4">
                  <h4 className="text-sm font-bold text-violet-800 mb-2">🗳 Decisiones Requeridas del Comité</h4>
                  <div className="space-y-1.5">
                    {ai.committee_decisions_needed.map((dec, i) => (
                      <div key={i} className="flex items-start gap-2 text-sm text-violet-900">
                        <span className="w-5 h-5 rounded-full bg-violet-600 text-white text-[10px] flex items-center justify-center flex-shrink-0 font-bold mt-0.5">{i + 1}</span>
                        <p>{dec}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Alerts */}
              {ai.alerts?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-brand-900 mb-2">Alertas ({ai.alerts.length})</h4>
                  <div className="space-y-2">
                    {ai.alerts.map((a, i) => (
                      <div key={i} className={`p-3 rounded-lg border ${aColors[a.level] || aColors.bajo}`}>
                        <div className="flex items-start gap-2">
                          <span className="mt-0.5 flex-shrink-0">{aIcons[a.level] || aIcons.bajo}</span>
                          <div className="flex-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="text-xs font-bold uppercase">{a.level}</span>
                              <span className="text-xs opacity-60">{a.category}</span>
                            </div>
                            <p className="text-sm font-medium mt-0.5">{a.title}</p>
                            <p className="text-xs mt-1 opacity-80 leading-relaxed">{a.description}</p>
                            {a.recommendation && <p className="text-xs mt-1.5 font-medium">→ {a.recommendation}</p>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Achievements */}
              {ai.achievements?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-brand-900 mb-2">Logros del Período</h4>
                  <div className="space-y-1.5">
                    {ai.achievements.map((a, i) => (
                      <div key={i} className="flex items-start gap-2.5 p-2.5 bg-emerald-50/50 rounded-lg border border-emerald-100">
                        <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 flex-shrink-0" />
                        <div className="flex-1">
                          <p className="text-sm text-brand-900">{a.description}</p>
                        </div>
                        <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${a.impact === 'alto' ? 'bg-emerald-200 text-emerald-800' : a.impact === 'medio' ? 'bg-blue-100 text-blue-700' : 'bg-surface-100 text-surface-600'}`}>{a.impact}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recommendations */}
              {ai.recommendations?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-brand-900 mb-2">Recomendaciones</h4>
                  <div className="space-y-2">
                    {ai.recommendations.map((r, i) => (
                      <div key={i} className="flex items-start gap-3 p-3 bg-surface-50 rounded-lg">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold flex-shrink-0 ${r.priority === 'alta' ? 'bg-red-100 text-red-700' : r.priority === 'media' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{r.priority}</span>
                        <div className="flex-1">
                          <p className="text-sm text-brand-900">{r.action}</p>
                          <div className="flex items-center gap-3 mt-1 text-[10px] text-surface-400">
                            {r.responsible && <span>👤 {r.responsible}</span>}
                            {r.deadline && <span>📅 {r.deadline}</span>}
                            {(r.area || r.expected_impact) && <span>📌 {r.area}{r.expected_impact ? ` · ${r.expected_impact}` : ''}</span>}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Next Actions */}
              {ai.next_actions?.length > 0 && (
                <div className="p-4 bg-brand-50 rounded-lg">
                  <h4 className="text-sm font-semibold text-brand-900 mb-2">Próximos Pasos</h4>
                  <div className="space-y-1.5">
                    {ai.next_actions.map((a, i) => (
                      <div key={i} className="flex items-center gap-2 text-sm text-brand-800">
                        <span className="w-5 h-5 rounded-full bg-brand-600 text-white text-[10px] flex items-center justify-center flex-shrink-0 font-bold">{i + 1}</span>
                        {a}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Forecast */}
              {ai.forecast && (
                <div className="p-4 bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl border border-indigo-200">
                  <h4 className="text-xs font-bold text-indigo-800 mb-1 flex items-center gap-1.5">
                    <TrendingUp className="w-3.5 h-3.5" /> Pronóstico
                  </h4>
                  <p className="text-sm text-indigo-900 leading-relaxed">{ai.forecast}</p>
                </div>
              )}

              {/* Risks Assessment */}
              {ai.risks_assessment && (
                <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <h4 className="text-xs font-bold text-amber-800 mb-1">🛡 Evaluación de Riesgos</h4>
                  <p className="text-xs text-amber-900 leading-relaxed">{ai.risks_assessment}</p>
                </div>
              )}

              {/* Financial Analysis */}
              {ai.financial_analysis && (
                <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                  <h4 className="text-xs font-bold text-emerald-800 mb-1">💰 Análisis Financiero</h4>
                  <p className="text-xs text-emerald-900 leading-relaxed">{ai.financial_analysis}</p>
                </div>
              )}

                </div>
              )}

            </div>
          );
        })() : aiAnalysis?.text ? (
          <div className="bg-violet-50 border border-violet-100 rounded-lg p-4 prose prose-sm max-w-none text-brand-800 leading-relaxed whitespace-pre-wrap text-xs">
            {aiAnalysis.text}
          </div>
        ) : (
          <p className="text-xs text-surface-400 italic">
            Haz clic en "Generar análisis IA" para obtener diagnóstico, alertas, recomendaciones y próximos pasos basados en los datos actuales del proyecto.
          </p>
        )}
      </div>

      {/* Main sections */}
      <div className="space-y-4">
        {/* CRONOGRAMA */}
        <Section title="Cronograma y Avance Físico" icon={CalendarRange} color="blue" semaforo={s.cronograma}
          extra={<button onClick={() => navigate('/ejecucion')} className="text-[10px] text-brand-500 hover:underline">Ver cronograma completo →</button>}>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            {[
              { label: 'Total', val: d.schedule.stats.total, color: 'surface' },
              { label: 'No iniciadas', val: d.schedule.stats.no_iniciada, color: 'surface' },
              { label: 'En progreso', val: d.schedule.stats.en_progreso, color: 'blue' },
              { label: 'Completadas', val: d.schedule.stats.completada, color: 'emerald' },
              { label: 'Atrasadas', val: d.schedule.stats.atrasada, color: 'red' },
            ].map((s, i) => (
              <div key={i} className={`rounded-lg p-2 bg-${s.color}-50`}>
                <p className={`text-lg font-bold text-${s.color}-700`}>{s.val || 0}</p>
                <p className="text-[10px] text-surface-500">{s.label}</p>
              </div>
            ))}
          </div>

          {d.schedule.late_activities?.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-red-700 mb-2 flex items-center gap-1">
                <AlertTriangle className="w-3.5 h-3.5" /> Actividades atrasadas
              </p>
              <div className="space-y-1">
                {d.schedule.late_activities.map((a, i) => (
                  <div key={i} className="flex items-center justify-between bg-red-50 rounded-lg px-3 py-1.5 text-xs">
                    <span className="text-red-900 font-medium flex-1 truncate">{a.name}</span>
                    <span className="text-red-600 ml-2">{a.days_late}d atraso • {PCT(a.progress_pct)} avance</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {d.schedule.upcoming_milestones?.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-blue-700 mb-2">Próximos hitos</p>
              <div className="space-y-1">
                {d.schedule.upcoming_milestones.map((m, i) => (
                  <div key={i} className="flex items-center justify-between bg-blue-50 rounded-lg px-3 py-1.5 text-xs">
                    <span className="text-blue-900 font-medium flex-1 truncate">{m.name}</span>
                    <span className="text-blue-600 ml-2">{DATE(m.end_date)} • {m.days_until}d restantes</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* ─── COMPROMISOS NATIVOS DE COMITÉ ─── */}
        <CommitteeCommitmentsPanel projectId={id} />

        {/* COMPROMISOS DE ACTAS (legado) */}
        <Section title="Compromisos de Actas" icon={Target} color="amber" semaforo={s.compromisos}
          extra={<button onClick={() => navigate('/ejecucion')} className="text-[10px] text-brand-500 hover:underline">Ver actas completas →</button>}>

          {/* Stats */}
          <div className="mt-3 grid grid-cols-4 gap-3 text-center">
            <div className="rounded-lg p-2 bg-surface-50"><p className="text-lg font-bold">{d.commitments.total}</p><p className="text-[10px] text-surface-500">Total</p></div>
            <div className="rounded-lg p-2 bg-emerald-50"><p className="text-lg font-bold text-emerald-700">{d.commitments.completed}</p><p className="text-[10px] text-surface-500">Completados</p></div>
            <div className="rounded-lg p-2 bg-amber-50"><p className="text-lg font-bold text-amber-700">{d.commitments.pending}</p><p className="text-[10px] text-surface-500">Pendientes</p></div>
            <div className="rounded-lg p-2 bg-red-50"><p className="text-lg font-bold text-red-700">{d.commitments.overdue}</p><p className="text-[10px] text-surface-500">Vencidos</p></div>
          </div>

          {d.commitments.items?.length === 0 && d.commitments.total > 0 && (
            <p className="text-xs text-emerald-600 font-medium mt-3 text-center">✓ Todos los compromisos están completados</p>
          )}

          {d.commitments.items?.length === 0 && d.commitments.total === 0 && (
            <p className="text-xs text-surface-400 mt-3 text-center">Sin compromisos registrados en actas de comité</p>
          )}

          {/* Pending commitments grouped by session */}
          {d.commitments.items?.length > 0 && (() => {
            const now = new Date();
            // Group by session
            const bySession = {};
            d.commitments.items.forEach(c => {
              const key = `${c.minute_id}`;
              if (!bySession[key]) bySession[key] = { minute_number: c.minute_number, meeting_date: c.meeting_date, items: [] };
              bySession[key].items.push(c);
            });

            return (
              <div className="mt-3 space-y-3">
                <p className="text-xs font-semibold text-brand-800">Pendientes para validar en este comité</p>
                {Object.values(bySession).map(session => (
                  <div key={session.minute_number} className="border border-amber-100 rounded-lg overflow-hidden">
                    {/* Session header */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-b border-amber-100">
                      <span className="text-[10px] font-bold text-amber-700 bg-amber-200 px-1.5 py-0.5 rounded">Acta #{session.minute_number}</span>
                      <span className="text-[10px] text-amber-600">{DATE(session.meeting_date)}</span>
                      <span className="text-[10px] text-amber-500 ml-auto">{session.items.length} compromiso{session.items.length !== 1 ? 's' : ''} pendiente{session.items.length !== 1 ? 's' : ''}</span>
                    </div>
                    {/* Items */}
                    <div className="divide-y divide-surface-50">
                      {session.items.map((c, i) => {
                        const isOverdue = c.due_date && new Date(c.due_date) < now;
                        const daysLeft = c.due_date ? Math.ceil((new Date(c.due_date) - now) / 86400000) : null;
                        const key = `${c.minute_id}-${c.item_index}`;
                        const isUpdating = commitmentUpdating === key;
                        return (
                          <div key={i} className={`px-3 py-2.5 ${isOverdue ? 'bg-red-50/40' : 'bg-white'}`}>
                            <div className="flex items-start gap-2">
                              <div className="flex-1 min-w-0">
                                <p className="text-xs text-brand-900">{c.task || c.description || 'Sin descripción'}</p>
                                <div className="flex flex-wrap items-center gap-1.5 mt-1">
                                  {c.responsible && (
                                    <span className="text-[10px] text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded font-medium">→ {c.responsible}</span>
                                  )}
                                  {c.due_date && (
                                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${isOverdue ? 'bg-red-100 text-red-700 font-semibold' : daysLeft !== null && daysLeft <= 7 ? 'bg-amber-100 text-amber-700' : 'bg-surface-100 text-surface-500'}`}>
                                      📅 {DATE(c.due_date)}{isOverdue ? ` · ${Math.abs(daysLeft)}d vencido` : daysLeft !== null && daysLeft <= 7 && daysLeft > 0 ? ` · ${daysLeft}d` : ''}
                                    </span>
                                  )}
                                  {c.notes && <span className="text-[10px] text-surface-400 italic truncate max-w-[140px]">💬 {c.notes}</span>}
                                </div>
                              </div>
                              {/* Inline status actions */}
                              <div className="flex items-center gap-1 flex-shrink-0">
                                {isUpdating ? (
                                  <Loader2 className="w-3.5 h-3.5 animate-spin text-brand-400" />
                                ) : (
                                  <>
                                    {c.status !== 'en_progreso' && (
                                      <button
                                        onClick={() => updateCommitmentInline(c.minute_id, c.item_index, 'en_progreso')}
                                        className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium whitespace-nowrap"
                                        title="Marcar en progreso">
                                        En progreso
                                      </button>
                                    )}
                                    {c.status === 'en_progreso' && (
                                      <span className="text-[10px] px-2 py-1 rounded bg-blue-100 text-blue-700 font-semibold">En progreso</span>
                                    )}
                                    <button
                                      onClick={() => updateCommitmentInline(c.minute_id, c.item_index, 'completado')}
                                      className="text-[10px] px-2 py-1 rounded bg-emerald-50 text-emerald-600 hover:bg-emerald-100 font-medium"
                                      title="Marcar completado">
                                      ✓ Cumplido
                                    </button>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}
        </Section>

        {/* FINANCIERO */}
        <Section title="Control Económico" icon={DollarSign} color="emerald" semaforo={s.financiero}
          extra={<button onClick={() => navigate('/ejecucion')} className="text-[10px] text-brand-500 hover:underline">Ver presupuesto detallado →</button>}>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="rounded-lg p-3 bg-blue-50 border border-blue-100">
              <p className="text-[10px] text-blue-600 font-medium">Valor Contrato</p>
              <p className="text-sm font-bold text-blue-800">{COP(d.financial.total_income)}</p>
            </div>
            <div className="rounded-lg p-3 bg-surface-50 border border-surface-100">
              <p className="text-[10px] text-surface-500 font-medium">Presupuesto Gastos</p>
              <p className="text-sm font-bold text-brand-800">{COP(d.financial.total_budgeted)}</p>
            </div>
            <div className="rounded-lg p-3 bg-emerald-50 border border-emerald-100">
              <p className="text-[10px] text-emerald-600 font-medium">Ejecutado</p>
              <p className="text-sm font-bold text-emerald-800">{COP(d.financial.total_executed)}</p>
              <p className="text-[9px] text-emerald-600">{PCT(d.financial.execution_pct)} del contrato</p>
            </div>
            <div className="rounded-lg p-3 bg-amber-50 border border-amber-100">
              <p className="text-[10px] text-amber-600 font-medium">Por Ejecutar</p>
              <p className="text-sm font-bold text-amber-800">{COP(d.financial.total_income - d.financial.total_executed)}</p>
            </div>
          </div>
          <div className="mt-3">
            <p className="text-[10px] text-surface-500 mb-1">Ejecución presupuestal</p>
            <ProgressBar value={d.financial.execution_pct} height="h-3" showLabel />
          </div>
          {d.financial.payments?.payments?.length > 0 && (
            <div className="mt-3">
              <p className="text-xs font-semibold text-brand-800 mb-2">Últimas facturas/pagos</p>
              <div className="space-y-1">
                {d.financial.payments.payments.map((p, i) => (
                  <div key={i} className="flex items-center justify-between bg-surface-50 rounded-lg px-3 py-1.5 text-xs">
                    <span className="font-medium text-brand-800">Factura #{p.payment_number}</span>
                    <span className="text-surface-500">{p.concept?.substring(0, 40)}</span>
                    <span className="font-mono text-brand-800">{COP(p.net_value)}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-medium ${p.status === 'pagado' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'}`}>{p.status}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>

        {/* RIESGOS */}
        <Section title="Riesgos" icon={Shield} color="red" semaforo={s.riesgos}
          extra={<button onClick={() => navigate('/ejecucion')} className="text-[10px] text-brand-500 hover:underline">Ver matriz de riesgos →</button>}>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <div className="rounded-lg p-2 bg-surface-50"><p className="text-lg font-bold">{d.risks.total || 0}</p><p className="text-[10px] text-surface-500">Total</p></div>
            <div className="rounded-lg p-2 bg-red-50"><p className="text-lg font-bold text-red-700">{d.risks.criticos || 0}</p><p className="text-[10px] text-surface-500">Críticos</p></div>
            <div className="rounded-lg p-2 bg-amber-50"><p className="text-lg font-bold text-amber-700">{d.risks.altos || 0}</p><p className="text-[10px] text-surface-500">Altos</p></div>
            <div className="rounded-lg p-2 bg-orange-50"><p className="text-lg font-bold text-orange-700">{d.risks.materializados || 0}</p><p className="text-[10px] text-surface-500">Materializados</p></div>
            <div className="rounded-lg p-2 bg-emerald-50"><p className="text-lg font-bold text-emerald-700">{d.risks.cerrados || 0}</p><p className="text-[10px] text-surface-500">Cerrados</p></div>
          </div>
          {d.risks.top?.length > 0 && (
            <div className="mt-3 space-y-1">
              {d.risks.top.map((r, i) => (
                <div key={i} className={`rounded-lg px-3 py-2 text-xs border ${r.risk_level === 'critico' ? 'bg-red-50 border-red-100' : r.risk_level === 'alto' ? 'bg-amber-50 border-amber-100' : 'bg-surface-50 border-surface-100'}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[9px] text-surface-400">{r.risk_code}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[9px] font-bold ${r.risk_level === 'critico' ? 'bg-red-200 text-red-800' : r.risk_level === 'alto' ? 'bg-amber-200 text-amber-800' : 'bg-surface-200 text-surface-600'}`}>{r.risk_score}pts</span>
                    <span className="font-medium text-brand-800 flex-1 truncate">{r.description}</span>
                  </div>
                  {r.mitigation_plan && <p className="text-surface-500 mt-1 ml-16 truncate">Mitigación: {r.mitigation_plan}</p>}
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* OBLIGACIONES */}
        <Section title="Obligaciones Contractuales" icon={ClipboardList} color="violet" semaforo={s.obligaciones} defaultOpen={false}
          extra={<button onClick={() => navigate(`/adjudicacion/${id}`)} className="text-[10px] text-brand-500 hover:underline">Ver obligaciones →</button>}>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
            <div className="rounded-lg p-2 bg-surface-50"><p className="text-lg font-bold">{d.obligations.total || 0}</p><p className="text-[10px] text-surface-500">Total</p></div>
            <div className="rounded-lg p-2 bg-amber-50"><p className="text-lg font-bold text-amber-700">{d.obligations.pendientes || 0}</p><p className="text-[10px] text-surface-500">Pendientes</p></div>
            <div className="rounded-lg p-2 bg-blue-50"><p className="text-lg font-bold text-blue-700">{d.obligations.en_curso || 0}</p><p className="text-[10px] text-surface-500">En curso</p></div>
            <div className="rounded-lg p-2 bg-emerald-50"><p className="text-lg font-bold text-emerald-700">{d.obligations.cumplidas || 0}</p><p className="text-[10px] text-surface-500">Cumplidas</p></div>
            <div className="rounded-lg p-2 bg-red-50"><p className="text-lg font-bold text-red-700">{d.obligations.vencidas || 0}</p><p className="text-[10px] text-surface-500">Vencidas</p></div>
          </div>
          {d.obligations.overdue?.length > 0 && (
            <div className="mt-3 space-y-1">
              <p className="text-xs font-semibold text-red-700">Obligaciones vencidas</p>
              {d.obligations.overdue.map((o, i) => (
                <div key={i} className="flex items-center gap-2 bg-red-50 rounded-lg px-3 py-1.5 text-xs border border-red-100">
                  <span className="font-mono text-[9px] text-red-400">{o.code}</span>
                  <span className="flex-1 text-red-900 truncate">{o.description}</span>
                  <span className="text-red-600">{DATE(o.due_date)}</span>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* EQUIPO, PÓLIZAS, HITOS — compact row */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          {/* Equipo */}
          <div className="bg-white rounded-xl border border-surface-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Users className="w-4 h-4 text-purple-500" />
              <h3 className="font-display font-bold text-brand-900 text-sm">Equipo</h3>
              <SemaforoLight color={s.equipo} size="sm" />
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="bg-surface-50 rounded p-2"><p className="font-bold text-lg">{d.team.total || 0}</p><p className="text-[10px] text-surface-500">Total</p></div>
              <div className="bg-emerald-50 rounded p-2"><p className="font-bold text-lg text-emerald-700">{d.team.activos || 0}</p><p className="text-[10px] text-surface-500">Activos</p></div>
              <div className="bg-red-50 rounded p-2"><p className="font-bold text-red-700">{d.team.por_reemplazar || 0}</p><p className="text-[10px] text-surface-500">Por reemplazar</p></div>
              <div className="bg-blue-50 rounded p-2"><p className="font-bold text-blue-700">{PCT(d.team.avg_dedication)}</p><p className="text-[10px] text-surface-500">Dedicación prom.</p></div>
            </div>
          </div>

          {/* Pólizas */}
          <div className="bg-white rounded-xl border border-surface-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <FileText className="w-4 h-4 text-orange-500" />
              <h3 className="font-display font-bold text-brand-900 text-sm">Pólizas</h3>
              <SemaforoLight color={s.polizas} size="sm" />
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="bg-surface-50 rounded p-2"><p className="font-bold text-lg">{d.policies.total || 0}</p><p className="text-[10px] text-surface-500">Total</p></div>
              <div className="bg-emerald-50 rounded p-2"><p className="font-bold text-lg text-emerald-700">{d.policies.vigentes || 0}</p><p className="text-[10px] text-surface-500">Vigentes</p></div>
              <div className="bg-amber-50 rounded p-2"><p className="font-bold text-amber-700">{d.policies.por_vencer || 0}</p><p className="text-[10px] text-surface-500">Por vencer</p></div>
              <div className="bg-red-50 rounded p-2"><p className="font-bold text-red-700">{d.policies.vencidas || 0}</p><p className="text-[10px] text-surface-500">Vencidas</p></div>
            </div>
          </div>

          {/* Hitos y Entregables */}
          <div className="bg-white rounded-xl border border-surface-100 p-4">
            <div className="flex items-center gap-2 mb-3">
              <Target className="w-4 h-4 text-cyan-500" />
              <h3 className="font-display font-bold text-brand-900 text-sm">Hitos y Entregables</h3>
            </div>
            <div className="grid grid-cols-2 gap-2 text-center text-xs">
              <div className="bg-surface-50 rounded p-2"><p className="font-bold text-lg">{d.milestones.total || 0}</p><p className="text-[10px] text-surface-500">Hitos</p></div>
              <div className="bg-emerald-50 rounded p-2"><p className="font-bold text-lg text-emerald-700">{d.milestones.completados || 0}</p><p className="text-[10px] text-surface-500">Completados</p></div>
              <div className="bg-surface-50 rounded p-2"><p className="font-bold text-lg">{d.deliverables.total || 0}</p><p className="text-[10px] text-surface-500">Entregables</p></div>
              <div className="bg-emerald-50 rounded p-2"><p className="font-bold text-lg text-emerald-700">{d.deliverables.aprobados || 0}</p><p className="text-[10px] text-surface-500">Aprobados</p></div>
            </div>
          </div>
        </div>

        {/* Adiciones */}
        {(d.changes.total > 0) && (
          <div className="bg-white rounded-xl border border-surface-100 p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-orange-500" />
              <h3 className="font-display font-bold text-brand-900 text-sm">Cambios / Adiciones</h3>
            </div>
            <div className="flex gap-4 text-xs">
              <span>Total: <b>{d.changes.total}</b></span>
              <span>Aprobados: <b className="text-emerald-600">{d.changes.approved || 0}</b></span>
              <span>Pendientes: <b className="text-amber-600">{d.changes.pending || 0}</b></span>
              <span>Valor adiciones: <b>{COP(d.changes.total_value)}</b></span>
            </div>
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="mt-6 text-center text-[10px] text-surface-400">
        SGIP-IA • Dashboard de Comité • Generado: {new Date().toLocaleString('es-CO')} • Proyecto {p.code}
      </div>
    </div>
  );
}
