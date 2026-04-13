import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { projectsAPI, indicatorsAPI } from '../../services/api';
import {
  BarChart3, DollarSign, Calendar, AlertTriangle, Shield, Users,
  FileText, Mail, GitBranch, Target, ClipboardList, Flag, TrendingUp,
  TrendingDown, ChevronDown, RefreshCw, Loader2, ArrowRight,
  CheckCircle2, XCircle, Clock, AlertCircle, Activity,
  Briefcase, LayoutGrid,
} from 'lucide-react';

// ── Helpers ──────────────────────────────────────────────────────────────────
const COP = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
const fmt = v => {
  if (v == null) return '—';
  if (Math.abs(v) >= 1e12) return `$${(v / 1e12).toFixed(1)} Bill`;
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)} MM`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(0)} M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)} K`;
  return `$${Math.round(v)}`;
};
const pct = v => v != null ? `${parseFloat(v).toFixed(1)}%` : '—';
const idx = v => v != null ? parseFloat(v).toFixed(2) : '—';
const DATE = d => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

const STATUS_LABEL = {
  adjudicado: { label: 'Adjudicado', cls: 'bg-blue-100 text-blue-700' },
  en_arranque: { label: 'En Arranque', cls: 'bg-amber-100 text-amber-700' },
  en_ejecucion: { label: 'En Ejecución', cls: 'bg-emerald-100 text-emerald-700' },
  suspendido: { label: 'Suspendido', cls: 'bg-red-100 text-red-700' },
  cerrado: { label: 'Cerrado', cls: 'bg-surface-100 text-surface-600' },
};

const SEM_COLORS = {
  verde:    { bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500', label: 'Verde' },
  amarillo: { bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500',   label: 'Alerta' },
  rojo:     { bg: 'bg-red-100',     text: 'text-red-700',     dot: 'bg-red-500',     label: 'Crítico' },
};

const TYPE_ICONS = {
  obligation:    { icon: ClipboardList, color: 'text-amber-600', bg: 'bg-amber-50' },
  milestone:     { icon: Flag,          color: 'text-violet-600', bg: 'bg-violet-50' },
  payment:       { icon: DollarSign,    color: 'text-emerald-600', bg: 'bg-emerald-50' },
  minute:        { icon: FileText,      color: 'text-blue-600',   bg: 'bg-blue-50' },
  change:        { icon: GitBranch,     color: 'text-rose-600',   bg: 'bg-rose-50' },
  risk:          { icon: AlertTriangle, color: 'text-red-600',    bg: 'bg-red-50' },
  correspondence:{ icon: Mail,          color: 'text-indigo-600', bg: 'bg-indigo-50' },
};

// ── Subcomponents ─────────────────────────────────────────────────────────────

function Semaphore({ label, state }) {
  const c = SEM_COLORS[state] || SEM_COLORS.verde;
  return (
    <div className={`flex flex-col items-center gap-1 px-3 py-2 rounded-xl ${c.bg}`}>
      <div className={`w-3 h-3 rounded-full ${c.dot}`} />
      <span className={`text-[10px] font-semibold ${c.text} text-center leading-tight`}>{label}</span>
      <span className={`text-[9px] ${c.text} opacity-75`}>{c.label}</span>
    </div>
  );
}

function EVMCard({ label, value, sub, color, icon: Icon }) {
  return (
    <div className="bg-white rounded-xl border border-surface-100 p-3 flex-1 min-w-0">
      <div className="flex items-center gap-1.5 mb-1">
        {Icon && <Icon className={`w-3.5 h-3.5 ${color}`} />}
        <span className="text-[10px] text-surface-500 font-medium">{label}</span>
      </div>
      <p className={`text-lg font-bold font-display ${color}`}>{value}</p>
      {sub && <p className="text-[10px] text-surface-400 mt-0.5">{sub}</p>}
    </div>
  );
}

function ModuleCard({ title, icon: Icon, iconBg, iconColor, stats, semColor, onClick }) {
  const c = SEM_COLORS[semColor] || SEM_COLORS.verde;
  return (
    <button onClick={onClick}
      className="bg-white rounded-xl border border-surface-100 p-4 text-left hover:shadow-md hover:border-brand-200 transition-all group w-full">
      <div className="flex items-start justify-between mb-3">
        <div className={`w-9 h-9 rounded-lg ${iconBg} flex items-center justify-center`}>
          <Icon className={`w-4 h-4 ${iconColor}`} />
        </div>
        <div className="flex items-center gap-1">
          <div className={`w-2 h-2 rounded-full ${c.dot}`} />
          <span className={`text-[10px] font-medium ${c.text}`}>{c.label}</span>
        </div>
      </div>
      <p className="text-xs font-semibold text-brand-900 mb-2">{title}</p>
      <div className="space-y-1">
        {stats.map((s, i) => (
          <div key={i} className="flex items-center justify-between">
            <span className="text-[10px] text-surface-500">{s.label}</span>
            <span className={`text-[11px] font-semibold ${s.color || 'text-brand-800'}`}>{s.value}</span>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-1 mt-3 text-brand-500 group-hover:text-brand-700 transition-colors">
        <span className="text-[10px] font-medium">Ver módulo</span>
        <ArrowRight className="w-3 h-3" />
      </div>
    </button>
  );
}

function TimelineEvent({ event }) {
  const { icon: Icon, color, bg } = TYPE_ICONS[event.type] || TYPE_ICONS.obligation;
  const d     = new Date(event.date);
  const now   = new Date();
  const isPast   = d < now;
  const diffDays = Math.round((d - now) / (1000 * 60 * 60 * 24));
  const relLabel = diffDays === 0  ? 'Hoy'
    : diffDays === 1  ? 'Mañana'
    : diffDays === -1 ? 'Ayer'
    : diffDays > 0    ? `En ${diffDays}d`
    : `Hace ${-diffDays}d`;

  return (
    <div className={`flex gap-3 py-2.5 border-b border-surface-50 last:border-0 ${isPast ? 'opacity-60' : ''}`}>
      <div className={`w-7 h-7 rounded-lg ${bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <Icon className={`w-3.5 h-3.5 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-xs font-medium text-brand-900 truncate">{event.name || '—'}</p>
        <div className="flex items-center gap-2 mt-0.5">
          <span className="text-[10px] text-surface-400">{DATE(event.date)}</span>
          {event.ref && <span className="text-[10px] text-surface-300">#{event.ref}</span>}
        </div>
      </div>
      <div className="flex-shrink-0 text-right">
        <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${isPast ? 'bg-surface-100 text-surface-500' : 'bg-brand-50 text-brand-600'}`}>
          {relLabel}
        </span>
      </div>
    </div>
  );
}

function ActivityItem({ item }) {
  const { icon: Icon, color, bg } = TYPE_ICONS[item.type] || { icon: Activity, color: 'text-surface-500', bg: 'bg-surface-50' };
  const d = new Date(item.date);
  const now = new Date();
  const diffH = Math.round((now - d) / (1000 * 60 * 60));
  const rel = diffH < 1 ? 'Hace <1h' : diffH < 24 ? `Hace ${diffH}h` : diffH < 48 ? 'Ayer' : DATE(item.date);
  return (
    <div className="flex items-start gap-2.5 py-2 border-b border-surface-50 last:border-0">
      <div className={`w-6 h-6 rounded-md ${bg} flex items-center justify-center flex-shrink-0 mt-0.5`}>
        <Icon className={`w-3 h-3 ${color}`} />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-[11px] text-brand-900 truncate">{item.title}</p>
        <span className="text-[10px] text-surface-400">{rel}</span>
      </div>
    </div>
  );
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function IndicadoresPage() {
  const navigate  = useNavigate();
  const location  = useLocation();
  const [projects, setProjects]     = useState([]);
  const [selectedId, setSelectedId] = useState(() => {
    const s = localStorage.getItem('sgip_selected_project');
    return s ? parseInt(s, 10) : null;
  });
  const [data, setData]       = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState(null);
  const [dropOpen, setDropOpen] = useState(false);

  // Load projects list
  useEffect(() => {
    projectsAPI.list({ limit: 100, status: '' })
      .then(({ data: d }) => {
        const all = d.data || [];
        setProjects(all);
        if (!selectedId && all.length > 0) setSelectedId(all[0].id);
      })
      .catch(() => {});
  }, []);

  // Persist selectedId
  useEffect(() => {
    if (selectedId) localStorage.setItem('sgip_selected_project', selectedId);
  }, [selectedId]);

  // Load panel data
  const loadData = useCallback(() => {
    if (!selectedId) return;
    setLoading(true);
    setError(null);
    indicatorsAPI.panel(selectedId)
      .then(({ data: r }) => { setData(r.data); setError(null); })
      .catch((e) => { setData(null); setError(e?.response?.data?.error || 'Error cargando el panel'); })
      .finally(() => setLoading(false));
  }, [selectedId]);

  useEffect(() => { loadData(); }, [loadData]);

  // Navigate to exec module (sets project in localStorage)
  const goExec = (tab) => {
    if (selectedId) {
      localStorage.setItem('sgip_selected_project', selectedId);
      navigate(`/ejecucion?tab=${tab}`);
    }
  };
  // Navigate to adjudicacion module
  const goAdj = (tab) => {
    if (selectedId) navigate(`/adjudicacion/${selectedId}?tab=${tab}`);
  };

  const proj = data?.project;
  const evm  = data?.evm;
  const sem  = data?.semaphores || {};
  const mod  = data?.modules   || {};
  const selectedProj = projects.find(p => p.id === selectedId);

  // Project timeline bar
  const timeBarPct = evm ? Math.min(100, evm.timePct) : 0;
  const physBarPct = evm ? Math.min(100, evm.progress) : 0;

  return (
    <div className="space-y-5 animate-fade-in">

      {/* ── Header ── */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-display font-bold text-brand-900 flex items-center gap-2">
            <LayoutGrid className="w-5 h-5 text-brand-600" /> Panel de Control del Proyecto
          </h1>
          <p className="text-sm text-surface-500 mt-0.5">Vista integral para el Gerente de Proyecto</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={loadData} disabled={loading}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-400 transition-colors">
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {/* Project Selector */}
          <div className="relative">
            <button onClick={() => setDropOpen(o => !o)}
              className="flex items-center gap-2 pl-3 pr-2 py-2 bg-white border border-surface-200 rounded-xl text-sm font-medium text-brand-900 hover:border-brand-300 transition-colors min-w-[220px]">
              <Briefcase className="w-4 h-4 text-brand-500 flex-shrink-0" />
              <span className="truncate flex-1 text-left">
                {selectedProj ? `${selectedProj.code} — ${selectedProj.name}` : 'Seleccionar proyecto...'}
              </span>
              <ChevronDown className="w-4 h-4 text-surface-400 flex-shrink-0" />
            </button>
            {dropOpen && (
              <div className="absolute right-0 mt-1 w-80 bg-white border border-surface-200 rounded-xl shadow-xl z-30 max-h-64 overflow-y-auto">
                {projects.map(p => (
                  <button key={p.id}
                    onClick={() => { setSelectedId(p.id); setDropOpen(false); }}
                    className={`w-full flex items-start gap-3 px-4 py-2.5 hover:bg-surface-50 text-left transition-colors ${p.id === selectedId ? 'bg-brand-50' : ''}`}>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-semibold text-brand-900 truncate">{p.code}</p>
                      <p className="text-[10px] text-surface-500 truncate">{p.name}</p>
                    </div>
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0 mt-0.5 ${STATUS_LABEL[p.status]?.cls || 'bg-surface-100 text-surface-600'}`}>
                      {STATUS_LABEL[p.status]?.label || p.status}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Click away to close dropdown */}
      {dropOpen && <div className="fixed inset-0 z-20" onClick={() => setDropOpen(false)} />}

      {/* ── No project selected ── */}
      {!selectedId && (
        <div className="flex flex-col items-center justify-center py-20 text-surface-400">
          <LayoutGrid className="w-12 h-12 mb-3 opacity-40" />
          <p className="text-sm font-medium">Selecciona un proyecto para ver el panel de control</p>
        </div>
      )}

      {/* ── Loading ── */}
      {selectedId && loading && !data && (
        <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-brand-400" /></div>
      )}

      {/* ── Error ── */}
      {selectedId && !loading && !data && error && (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <div className="w-12 h-12 rounded-full bg-red-50 flex items-center justify-center mb-3">
            <AlertTriangle className="w-6 h-6 text-red-400" />
          </div>
          <p className="text-sm font-medium text-red-600 mb-1">Error cargando el panel</p>
          <p className="text-xs text-surface-400 mb-4">{error}</p>
          <button onClick={loadData} className="text-xs px-4 py-2 bg-brand-600 text-white rounded-lg hover:bg-brand-700">
            Reintentar
          </button>
        </div>
      )}

      {/* ── Panel content ── */}
      {selectedId && data && proj && (
        <div className="space-y-5">

          {/* Project info strip */}
          <div className="bg-white rounded-xl border border-surface-100 px-5 py-3 flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-bold text-brand-900">{proj.code}</span>
                <span className="text-sm text-surface-500">—</span>
                <span className="text-sm font-medium text-brand-800 truncate">{proj.name}</span>
                <span className={`px-2 py-0.5 rounded-full text-[10px] font-semibold ${STATUS_LABEL[proj.status]?.cls || 'bg-surface-100 text-surface-600'}`}>
                  {STATUS_LABEL[proj.status]?.label || proj.status}
                </span>
              </div>
              <p className="text-xs text-surface-400 mt-0.5">{proj.client_name} · {DATE(proj.start_date)} → {DATE(proj.end_date)}</p>
            </div>
            <div className="flex items-center gap-6 text-center">
              <div>
                <p className="text-[10px] text-surface-400">Contrato</p>
                <p className="text-sm font-bold text-brand-900">{fmt(proj.contract_value)}</p>
              </div>
              <div>
                <p className="text-[10px] text-surface-400">Avance físico</p>
                <p className="text-sm font-bold text-emerald-600">{pct(evm?.progress)}</p>
              </div>
              <div>
                <p className="text-[10px] text-surface-400">Tiempo consumido</p>
                <p className="text-sm font-bold text-brand-700">{pct(evm?.timePct)}</p>
              </div>
            </div>
          </div>

          {/* ── Alert banner ── */}
          {data.alerts && data.alerts.length > 0 && (
            <div className="space-y-1.5">
              {data.alerts.filter(a => a.level === 'rojo').map((a, i) => (
                <div key={i} className="flex items-center gap-3 bg-red-50 border border-red-200 rounded-xl px-4 py-2.5">
                  <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />
                  <p className="text-xs font-medium text-red-700 flex-1">{a.msg}</p>
                  <ArrowRight className="w-3.5 h-3.5 text-red-400" />
                </div>
              ))}
              {data.alerts.filter(a => a.level === 'amarillo').map((a, i) => (
                <div key={i} className="flex items-center gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-2.5">
                  <AlertCircle className="w-4 h-4 text-amber-500 flex-shrink-0" />
                  <p className="text-xs font-medium text-amber-700 flex-1">{a.msg}</p>
                  <ArrowRight className="w-3.5 h-3.5 text-amber-400" />
                </div>
              ))}
            </div>
          )}

          {/* ── EVM Strip ── */}
          <div className="bg-white rounded-xl border border-surface-100 p-4">
            <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide mb-3">Earned Value Management</p>
            <div className="flex gap-3 flex-wrap">
              {[
                { label: 'SPI · Cronograma', value: idx(evm?.spi), sub: evm?.spi == null ? '—' : evm.spi >= 1 ? 'Adelantado' : evm.spi >= 0.95 ? 'En tiempo' : 'Atrasado', color: !evm?.spi ? 'text-surface-500' : evm.spi >= 0.95 ? 'text-emerald-600' : evm.spi >= 0.80 ? 'text-amber-600' : 'text-red-600', icon: TrendingUp },
                { label: 'CPI · Costos',     value: idx(evm?.cpi), sub: evm?.cpi == null ? '—' : evm.cpi >= 1 ? 'Bajo presupuesto' : evm.cpi >= 0.95 ? 'En presupuesto' : 'Sobre presupuesto', color: !evm?.cpi ? 'text-surface-500' : evm.cpi >= 0.95 ? 'text-emerald-600' : evm.cpi >= 0.80 ? 'text-amber-600' : 'text-red-600', icon: DollarSign },
                { label: 'EAC · Costo final proyectado', value: fmt(evm?.eac), sub: `BAC: ${fmt(evm?.bac)}`, color: 'text-brand-700', icon: BarChart3 },
                { label: 'ETC · Por ejecutar', value: fmt(evm?.etc), sub: `AC: ${fmt(evm?.ac)}`, color: 'text-indigo-600', icon: Clock },
                { label: 'VAC · Variación al cierre', value: fmt(evm?.vac), sub: evm?.vac >= 0 ? 'Superávit' : 'Déficit', color: evm?.vac >= 0 ? 'text-emerald-600' : 'text-red-600', icon: evm?.vac >= 0 ? TrendingUp : TrendingDown },
                { label: 'TCPI · Eficiencia requerida', value: idx(evm?.tcpi), sub: evm?.tcpi == null ? '—' : evm.tcpi <= 1 ? 'Alcanzable' : 'Exigente', color: !evm?.tcpi ? 'text-surface-500' : evm.tcpi <= 1.05 ? 'text-emerald-600' : evm.tcpi <= 1.2 ? 'text-amber-600' : 'text-red-600', icon: Target },
              ].map(({ label, value, sub, color, icon }) => (
                <EVMCard key={label} label={label} value={value} sub={sub} color={color} icon={icon} />
              ))}
            </div>
          </div>

          {/* ── Semaphores ── */}
          <div className="bg-white rounded-xl border border-surface-100 p-4">
            <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide mb-3">Semáforos de Estado</p>
            <div className="flex gap-2 flex-wrap">
              <Semaphore label="Alcance / Obligaciones" state={sem.alcance} />
              <Semaphore label="Tiempo / Cronograma" state={sem.tiempo} />
              <Semaphore label="Costo / Presupuesto" state={sem.costo} />
              <Semaphore label="Calidad / Entregables" state={sem.calidad} />
              <Semaphore label="Riesgos" state={sem.riesgos} />
              <Semaphore label="Equipo" state={sem.equipo} />
              <Semaphore label="Pólizas" state={sem.polizas} />
              <Semaphore label="Correspondencia" state={sem.correspondencia} />
            </div>
          </div>

          {/* ── Module Grid ── */}
          <div>
            <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide mb-3">Módulos del Proyecto</p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">

              {/* Pagos */}
              <ModuleCard title="Pagos / Ingresos" icon={DollarSign} iconBg="bg-emerald-100" iconColor="text-emerald-600"
                semColor={sem.costo}
                onClick={() => goExec('payments')}
                stats={[
                  { label: 'Total pagado', value: fmt(mod.payments?.total_paid), color: 'text-emerald-600' },
                  { label: 'Recaudado vs contrato', value: proj.contract_value > 0 ? pct(parseFloat(mod.payments?.total_paid || 0) / proj.contract_value * 100) : '—' },
                  { label: `${mod.payments?.total || 0} pagos`, value: `${mod.payments?.pagados || 0} pagados · ${parseInt(mod.payments?.aprobados || 0) + parseInt(mod.payments?.pendientes || 0)} pendientes` },
                ].filter(Boolean)} />

              {/* Cronograma */}
              <ModuleCard title="Cronograma" icon={Calendar} iconBg="bg-blue-100" iconColor="text-blue-600"
                semColor={sem.tiempo}
                onClick={() => goExec('schedule')}
                stats={[
                  { label: 'Actividades completadas', value: `${mod.schedule?.completadas || 0} / ${mod.schedule?.total || 0}` },
                  { label: 'Atrasadas', value: `${mod.schedule?.atrasadas || 0}`, color: parseInt(mod.schedule?.atrasadas) > 0 ? 'text-red-600' : 'text-surface-500' },
                  { label: 'Avance promedio', value: pct(mod.schedule?.avg_progress) },
                ]} />

              {/* Riesgos */}
              <ModuleCard title="Riesgos" icon={AlertTriangle} iconBg="bg-red-100" iconColor="text-red-600"
                semColor={sem.riesgos}
                onClick={() => goExec('risks')}
                stats={[
                  { label: 'Críticos activos', value: `${mod.risks?.criticos || 0}`, color: parseInt(mod.risks?.criticos) > 0 ? 'text-red-600' : 'text-surface-500' },
                  { label: 'Altos', value: `${mod.risks?.altos || 0}`, color: parseInt(mod.risks?.altos) > 0 ? 'text-amber-600' : 'text-surface-500' },
                  { label: 'Total activos', value: `${mod.risks?.activos || 0} de ${mod.risks?.total || 0}` },
                ]} />

              {/* Obligaciones */}
              <ModuleCard title="Obligaciones" icon={ClipboardList} iconBg="bg-amber-100" iconColor="text-amber-600"
                semColor={sem.alcance}
                onClick={() => goAdj('obligations')}
                stats={[
                  { label: 'Cumplidas', value: `${mod.obligations?.cumplidas || 0} / ${mod.obligations?.total || 0}`, color: 'text-emerald-600' },
                  { label: 'Vencidas', value: `${mod.obligations?.vencidas || 0}`, color: parseInt(mod.obligations?.vencidas) > 0 ? 'text-red-600' : 'text-surface-500' },
                  { label: 'Vencen esta semana', value: `${mod.obligations?.due_week || 0}`, color: parseInt(mod.obligations?.due_week) > 0 ? 'text-amber-600' : 'text-surface-500' },
                ]} />

              {/* Equipo */}
              <ModuleCard title="Equipo" icon={Users} iconBg="bg-pink-100" iconColor="text-pink-600"
                semColor={sem.equipo}
                onClick={() => goAdj('team')}
                stats={[
                  { label: 'Miembros activos', value: `${mod.team?.activos || 0} / ${mod.team?.total || 0}` },
                  { label: 'Perfil conforme', value: `${mod.team?.conformes || 0}`, color: 'text-emerald-600' },
                  { label: 'No conformes', value: `${mod.team?.no_conformes || 0}`, color: parseInt(mod.team?.no_conformes) > 0 ? 'text-red-600' : 'text-surface-500' },
                ]} />

              {/* Pólizas */}
              <ModuleCard title="Pólizas" icon={Shield} iconBg="bg-orange-100" iconColor="text-orange-600"
                semColor={sem.polizas}
                onClick={() => goAdj('policies')}
                stats={[
                  { label: 'Vigentes', value: `${mod.policies?.vigentes || 0}`, color: 'text-emerald-600' },
                  { label: 'Por vencer (≤15d)', value: `${mod.policies?.alert_15 || 0}`, color: parseInt(mod.policies?.alert_15) > 0 ? 'text-amber-600' : 'text-surface-500' },
                  { label: 'Vencidas', value: `${mod.policies?.vencidas || 0}`, color: parseInt(mod.policies?.vencidas) > 0 ? 'text-red-600' : 'text-surface-500' },
                ]} />

              {/* Actas */}
              <ModuleCard title="Actas de Reunión" icon={FileText} iconBg="bg-indigo-100" iconColor="text-indigo-600"
                semColor="verde"
                onClick={() => goExec('minutes')}
                stats={[
                  { label: 'Actas registradas', value: `${mod.minutes?.total || 0}` },
                  { label: 'Firmadas', value: `${mod.minutes?.firmadas || 0}`, color: 'text-emerald-600' },
                  { label: 'Borrador', value: `${mod.minutes?.borrador || 0}`, color: parseInt(mod.minutes?.borrador) > 0 ? 'text-amber-600' : 'text-surface-500' },
                ]} />

              {/* Correspondencia */}
              <ModuleCard title="Correspondencia" icon={Mail} iconBg="bg-violet-100" iconColor="text-violet-600"
                semColor={sem.correspondencia}
                onClick={() => goExec('correspondence')}
                stats={[
                  { label: 'Total documentos', value: `${mod.correspondence?.total || 0}` },
                  { label: 'Sin respuesta', value: `${mod.correspondence?.sin_respuesta || 0}`, color: parseInt(mod.correspondence?.sin_respuesta) > 0 ? 'text-amber-600' : 'text-surface-500' },
                  { label: 'Vencidas (>7d)', value: `${mod.correspondence?.vencidas_respuesta || 0}`, color: parseInt(mod.correspondence?.vencidas_respuesta) > 0 ? 'text-red-600' : 'text-surface-500' },
                ]} />

              {/* Entregables */}
              <ModuleCard title="Hitos y Entregables" icon={Flag} iconBg="bg-teal-100" iconColor="text-teal-600"
                semColor={sem.calidad}
                onClick={() => goAdj('milestones')}
                stats={[
                  { label: 'Entregables aprobados', value: `${mod.deliverables?.aprobados || 0} / ${mod.deliverables?.total || 0}`, color: 'text-emerald-600' },
                  { label: 'Rechazados', value: `${mod.deliverables?.rechazados || 0}`, color: parseInt(mod.deliverables?.rechazados) > 0 ? 'text-red-600' : 'text-surface-500' },
                  { label: 'Pendientes / En elaboración', value: `${mod.deliverables?.pendientes || 0} / ${mod.deliverables?.en_elaboracion || 0}` },
                ]} />

              {/* Cambios */}
              <ModuleCard title="Cambios al Contrato" icon={GitBranch} iconBg="bg-rose-100" iconColor="text-rose-600"
                semColor={parseInt(mod.changes?.pendientes) > 0 ? 'amarillo' : 'verde'}
                onClick={() => goExec('changes')}
                stats={[
                  { label: 'Aprobados / Implementados', value: `${mod.changes?.aprobados || 0} / ${mod.changes?.implementados || 0}`, color: 'text-emerald-600' },
                  { label: 'En revisión', value: `${mod.changes?.pendientes || 0}`, color: parseInt(mod.changes?.pendientes) > 0 ? 'text-amber-600' : 'text-surface-500' },
                  { label: 'Impacto en días', value: `+${mod.changes?.total_impact_days || 0}d` },
                ]} />

              {/* Seguimiento Presupuestal */}
              <ModuleCard title="Seguimiento Presupuestal" icon={BarChart3} iconBg="bg-cyan-100" iconColor="text-cyan-600"
                semColor={sem.costo}
                onClick={() => goExec('budget_tracking')}
                stats={[
                  { label: 'Ejecutado real (AC)', value: fmt(mod.budget?.total_ejecutado), color: 'text-brand-700' },
                  { label: 'Planeado acumulado', value: fmt(mod.budget?.total_planeado) },
                  { label: 'Desviación', value: fmt((parseFloat(mod.budget?.total_ejecutado || 0)) - (parseFloat(mod.budget?.total_planeado || 0))), color: parseFloat(mod.budget?.total_ejecutado || 0) > parseFloat(mod.budget?.total_planeado || 0) ? 'text-red-600' : 'text-emerald-600' },
                ]} />

              {/* Avance (Curva S) */}
              <ModuleCard title="Avance del Proyecto" icon={TrendingUp} iconBg="bg-brand-100" iconColor="text-brand-600"
                semColor={sem.tiempo}
                onClick={() => goExec('progress')}
                stats={[
                  { label: 'Avance físico real', value: pct(evm?.progress), color: 'text-emerald-600' },
                  { label: '% Tiempo consumido', value: pct(evm?.timePct), color: 'text-brand-600' },
                  { label: 'Registros de avance', value: `${data.progress_records?.length || 0} períodos` },
                ]} />
            </div>
          </div>

          {/* ── Timeline + Recent Activity ── */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* Project timeline bar + events */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-surface-100 p-4">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide mb-4">Línea de Tiempo del Proyecto</p>

              {/* Timeline bar */}
              <div className="mb-5">
                <div className="flex justify-between text-[10px] text-surface-400 mb-1.5">
                  <span>{DATE(proj.start_date)}</span>
                  <span>Hoy</span>
                  <span>{DATE(proj.end_date)}</span>
                </div>
                {/* Time consumed bar */}
                <div className="relative h-5 bg-surface-100 rounded-full overflow-visible mb-2">
                  <div className="h-full bg-brand-200 rounded-full transition-all" style={{ width: `${timeBarPct}%` }} />
                  {/* Today marker */}
                  <div className="absolute top-1/2 -translate-y-1/2 w-0.5 h-8 bg-brand-700"
                    style={{ left: `${timeBarPct}%` }}>
                    <div className="absolute -top-4 -translate-x-1/2 text-[9px] font-bold text-brand-700 whitespace-nowrap">HOY</div>
                  </div>
                </div>
                {/* Physical progress bar */}
                <div className="h-2.5 bg-surface-100 rounded-full overflow-hidden">
                  <div className="h-full bg-emerald-400 rounded-full transition-all" style={{ width: `${physBarPct}%` }} />
                </div>
                <div className="flex items-center gap-4 mt-1.5">
                  <div className="flex items-center gap-1"><div className="w-2.5 h-1.5 rounded-full bg-brand-300" /><span className="text-[10px] text-surface-400">Tiempo {pct(timeBarPct)}</span></div>
                  <div className="flex items-center gap-1"><div className="w-2.5 h-1.5 rounded-full bg-emerald-400" /><span className="text-[10px] text-surface-400">Avance físico {pct(physBarPct)}</span></div>
                </div>
              </div>

              {/* Events list */}
              <div className="max-h-72 overflow-y-auto">
                {data.timeline && data.timeline.length > 0 ? (
                  data.timeline.map((ev, i) => <TimelineEvent key={i} event={ev} />)
                ) : (
                  <p className="text-xs text-surface-400 text-center py-6">Sin eventos en la línea de tiempo</p>
                )}
              </div>
            </div>

            {/* Recent activity feed */}
            <div className="bg-white rounded-xl border border-surface-100 p-4">
              <p className="text-xs font-semibold text-surface-500 uppercase tracking-wide mb-3">Actividad Reciente</p>
              <div className="max-h-80 overflow-y-auto">
                {data.recent_activity && data.recent_activity.length > 0 ? (
                  data.recent_activity.map((item, i) => <ActivityItem key={i} item={item} />)
                ) : (
                  <p className="text-xs text-surface-400 text-center py-6">Sin actividad reciente</p>
                )}
              </div>
            </div>
          </div>

        </div>
      )}
    </div>
  );
}
