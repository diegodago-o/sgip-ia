import React, { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { dashboardAPI, projectsAPI } from '../../services/api';
import {
  FolderKanban, PlayCircle, CheckCircle2, AlertTriangle, DollarSign, Users,
  ShieldAlert, Clock, Plus, TrendingUp, TrendingDown, Filter, X, Download,
  RefreshCw, Loader2, ChevronRight, Eye, Target, Shield, AlertCircle,
  FileText, Activity, Zap, BarChart3,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, Legend, RadarChart, Radar, PolarGrid,
  PolarAngleAxis, PolarRadiusAxis, Treemap,
} from 'recharts';

const COP = v => new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0);
const PCT = v => `${(parseFloat(v) || 0).toFixed(1)}%`;
const DATE = d => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmt = v => { if (v >= 1e12) return `$${(v/1e12).toFixed(1)} Bill`; if (v >= 1e9) return `$${(v/1e9).toFixed(1)} MM`; if (v >= 1e6) return `$${(v/1e6).toFixed(0)} M`; if (v >= 1e3) return `$${(v/1e3).toFixed(0)} K`; return `$${v}`; };

const COLORS = ['#1B5FAA','#059669','#D97706','#DC2626','#7C3AED','#2563EB','#0891B2','#E11D48','#4F46E5','#16A34A'];
const STATUS_L = { adjudicado:'Adjudicado', en_arranque:'En Arranque', en_ejecucion:'En Ejecución', suspendido:'Suspendido', cerrado:'Cerrado', liquidado:'Liquidado' };
const TYPE_L = { obra_civil:'Obra Civil', ti:'TI', consultoria:'Consultoría', interventoria:'Interventoría', asesoria:'Asesoría', mixto:'Mixto', otro:'Otro' };
const PRIORITY_L = { alta:'Alta', media:'Media', baja:'Baja' };
const STATUS_COLORS = { adjudicado:'bg-blue-100 text-blue-700', en_arranque:'bg-amber-100 text-amber-700', en_ejecucion:'bg-emerald-100 text-emerald-700', suspendido:'bg-red-100 text-red-700', cerrado:'bg-surface-100 text-surface-600', liquidado:'bg-surface-200 text-surface-700' };

function KPI({ label, value, sub, icon: Icon, color, onClick, trend }) {
  return (
    <div onClick={onClick} className={`bg-white rounded-xl p-4 shadow-card hover:shadow-card-hover transition-all duration-300 ${onClick ? 'cursor-pointer hover:scale-[1.02]' : ''}`}>
      <div className="flex items-start justify-between">
        <div className={`w-9 h-9 rounded-lg ${color} flex items-center justify-center`}>
          <Icon className="w-4.5 h-4.5 text-white" />
        </div>
        {trend !== undefined && (
          <span className={`text-[10px] font-medium flex items-center gap-0.5 ${trend >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
            {trend >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
            {trend >= 0 ? '+' : ''}{trend}%
          </span>
        )}
      </div>
      <p className="text-2xl font-display font-bold text-brand-900 mt-2">{value}</p>
      <p className="text-[11px] text-surface-600 font-medium mt-0.5">{label}</p>
      {sub && <p className="text-[10px] text-surface-500 mt-0.5">{sub}</p>}
    </div>
  );
}

/* ── PMO Indicators Panel ─────────────────────────────── */
function PMOPanel({ pmo, projects }) {
  const [sel, setSel] = useState('all');
  if (!pmo) return null;
  const d = sel === 'all' ? pmo.aggregate : pmo.by_project?.find(p => String(p.project_id) === sel);
  if (!d) return null;

  const ColIndicator = ({ label, val, format }) => (
    <div className="text-center">
      <p className="text-[10px] font-medium mb-1 opacity-70">{label}</p>
      <p className={`font-bold leading-tight ${format === 'currency' ? 'text-sm' : 'text-xl'}`}>
        {val == null ? '—' : format === 'currency' ? COP(val) : format === 'pct' ? `${val}%` : val}
      </p>
    </div>
  );

  const SideCard = ({ title, data, colorClass, headerClass, note }) => (
    <div className={`flex-1 ${colorClass} rounded-xl p-4 border`}>
      <p className={`text-xs font-bold text-center uppercase tracking-widest mb-1 ${headerClass}`}>{title}</p>
      {note && <p className="text-[9px] text-center opacity-60 mb-3">{note}</p>}
      {!data ? (
        <p className="text-center text-xs opacity-50 py-4">Sin datos suficientes</p>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            <ColIndicator label="Rentabilidad" val={data.rentabilidad} format="pct" />
            <ColIndicator label="TIR anual" val={data.tir} format="pct" />
            <ColIndicator label="VPN" val={data.vpn} format="currency" />
          </div>
          <div className="mt-3 pt-3 border-t border-current/10 grid grid-cols-2 gap-2">
            <ColIndicator label="Margen Neto" val={data.margen} format="pct" />
            <ColIndicator label="Costos" val={data.costs} format="currency" />
          </div>
        </>
      )}
    </div>
  );

  // ─ Desempeño operativo ─
  const spi      = d.spi;
  const spiColor = spi == null ? 'text-surface-400'
    : spi >= 0.95 ? 'text-emerald-600' : spi >= 0.80 ? 'text-amber-500' : 'text-red-600';
  const spiLabel = spi == null ? '—'
    : spi >= 1.00 ? 'Adelantado' : spi >= 0.95 ? 'En tiempo' : spi >= 0.80 ? 'Leve atraso' : 'Atrasado';

  const cpi      = d.cpi;
  const cpiColor = cpi == null ? 'text-surface-400'
    : cpi >= 0.95 ? 'text-emerald-600' : cpi >= 0.80 ? 'text-amber-500' : 'text-red-600';
  const cpiLabel = cpi == null ? '—'
    : cpi >= 1.00 ? 'Bajo presupuesto' : cpi >= 0.95 ? 'En presupuesto' : cpi >= 0.80 ? 'Leve sobrecoste' : 'Sobrecoste';

  const rag  = d.rag  || { verde: 0, amarillo: 0, rojo: 0, total: 0 };
  const ragTotal = rag.total || 1;

  return (
    <div className="bg-white rounded-xl shadow-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-surface-100">
        <div className="flex items-center gap-2">
          <BarChart3 className="w-4 h-4 text-brand-600" />
          <h3 className="font-display font-semibold text-brand-900 text-sm">Indicadores PMO</h3>
          <span className="text-[10px] bg-surface-100 text-surface-500 px-2 py-0.5 rounded-full">Tasa de descuento: 10%</span>
        </div>
        <select value={sel} onChange={e => setSel(e.target.value)} className="input-field text-xs w-52">
          <option value="all">Todos los proyectos</option>
          {projects.map(p => <option key={p.id} value={String(p.id)}>{p.code} — {p.name}</option>)}
        </select>
      </div>

      {/* Financiero LB vs SEG */}
      <div className="px-5 pt-4 pb-3 flex gap-4">
        <SideCard
          title="Línea Base"
          data={d.lb}
          note="Valor contrato vs presupuesto planificado"
          colorClass="bg-blue-50 border-blue-100 text-blue-900"
          headerClass="text-blue-700"
        />
        <SideCard
          title="Seguimiento"
          data={d.seg}
          note="Ingresos facturados/pagados · costos reales ejecutados"
          colorClass="bg-emerald-50 border-emerald-100 text-emerald-900"
          headerClass="text-emerald-700"
        />
      </div>

      {/* Desempeño Operativo */}
      <div className="border-t border-surface-100 px-5 py-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-surface-400 mb-3">Desempeño Operativo</p>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4">
          {/* SPI */}
          <div className="bg-surface-50 rounded-xl p-3 border border-surface-100">
            <p className="text-[10px] text-surface-500 font-medium mb-1">SPI · Cronograma</p>
            <p className={`text-2xl font-bold font-display ${spiColor}`}>
              {spi == null ? '—' : spi.toFixed(2)}
            </p>
            <p className={`text-[10px] font-medium mt-0.5 ${spiColor}`}>{spiLabel}</p>
            <p className="text-[9px] text-surface-400 mt-1">avance real ÷ avance planificado</p>
          </div>

          {/* CPI */}
          <div className="bg-surface-50 rounded-xl p-3 border border-surface-100">
            <p className="text-[10px] text-surface-500 font-medium mb-1">CPI · Costos</p>
            <p className={`text-2xl font-bold font-display ${cpiColor}`}>
              {cpi == null ? '—' : cpi.toFixed(2)}
            </p>
            <p className={`text-[10px] font-medium mt-0.5 ${cpiColor}`}>{cpiLabel}</p>
            <p className="text-[9px] text-surface-400 mt-1">valor ganado ÷ costo real</p>
          </div>

          {/* Actividades atrasadas */}
          <div className="bg-surface-50 rounded-xl p-3 border border-surface-100">
            <p className="text-[10px] text-surface-500 font-medium mb-1">Actividades Atrasadas</p>
            <p className={`text-2xl font-bold font-display ${
              (d.pct_atrasadas || 0) === 0 ? 'text-emerald-600'
              : (d.pct_atrasadas || 0) <= 15 ? 'text-amber-500' : 'text-red-600'
            }`}>
              {d.pct_atrasadas != null ? `${d.pct_atrasadas}%` : '—'}
            </p>
            <p className="text-[9px] text-surface-400 mt-1">vencidas sin completar / total</p>
          </div>

          {/* Recaudo */}
          <div className="bg-surface-50 rounded-xl p-3 border border-surface-100">
            <p className="text-[10px] text-surface-500 font-medium mb-1">Recaudo vs Contrato</p>
            <p className={`text-2xl font-bold font-display ${
              d.recaudo_pct == null ? 'text-surface-400'
              : d.recaudo_pct >= 80 ? 'text-emerald-600'
              : d.recaudo_pct >= 50 ? 'text-amber-500' : 'text-red-600'
            }`}>
              {d.recaudo_pct != null ? `${d.recaudo_pct}%` : '—'}
            </p>
            <p className="text-[9px] text-surface-400 mt-1">pagos recibidos / valor contrato</p>
          </div>
        </div>

        {/* RAG Salud del portafolio */}
        {sel === 'all' && rag.total > 0 && (
          <div>
            <p className="text-[10px] text-surface-500 font-medium mb-2">
              Salud del Portafolio
              <span className="ml-2 text-surface-400 font-normal">{rag.total} proyecto{rag.total !== 1 ? 's' : ''}</span>
            </p>
            {/* Barra RAG */}
            <div className="flex rounded-full overflow-hidden h-4 mb-2">
              {rag.verde    > 0 && <div title={`Verde: ${rag.verde}`}    style={{ width: `${rag.verde/ragTotal*100}%`    }} className="bg-emerald-500 flex items-center justify-center text-[8px] text-white font-bold">{rag.verde}</div>}
              {rag.amarillo > 0 && <div title={`Amarillo: ${rag.amarillo}`} style={{ width: `${rag.amarillo/ragTotal*100}%` }} className="bg-amber-400 flex items-center justify-center text-[8px] text-white font-bold">{rag.amarillo}</div>}
              {rag.rojo     > 0 && <div title={`Rojo: ${rag.rojo}`}      style={{ width: `${rag.rojo/ragTotal*100}%`     }} className="bg-red-500 flex items-center justify-center text-[8px] text-white font-bold">{rag.rojo}</div>}
            </div>
            <div className="flex items-center gap-4 text-[10px] text-surface-600">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> Verde {rag.verde} ({Math.round(rag.verde/ragTotal*100)}%)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" /> Amarillo {rag.amarillo} ({Math.round(rag.amarillo/ragTotal*100)}%)</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> Rojo {rag.rojo} ({Math.round(rag.rojo/ragTotal*100)}%)</span>
            </div>
          </div>
        )}
        {sel !== 'all' && (
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-[10px] text-surface-500 font-medium">Salud del proyecto:</span>
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
              d.rag === 'verde' ? 'bg-emerald-100 text-emerald-700'
              : d.rag === 'amarillo' ? 'bg-amber-100 text-amber-700'
              : d.rag === 'rojo' ? 'bg-red-100 text-red-700'
              : 'bg-surface-100 text-surface-500'
            }`}>
              {d.rag === 'verde' ? '● Verde' : d.rag === 'amarillo' ? '● Amarillo' : d.rag === 'rojo' ? '● Rojo' : '—'}
            </span>
            <span className="text-[9px] text-surface-400">
              {d.rag === 'verde' ? 'SPI ≥ 0.95 y CPI ≥ 0.95'
               : d.rag === 'amarillo' ? 'SPI o CPI entre 0.80 y 0.95'
               : d.rag === 'rojo' ? 'SPI < 0.80 o CPI < 0.80'
               : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}

function ChartCard({ title, children, className = '', onExport, extra }) {
  return (
    <div className={`bg-white rounded-xl shadow-card overflow-hidden ${className}`}>
      <div className="flex items-center justify-between px-5 pt-4 pb-2">
        <h3 className="font-display font-semibold text-brand-900 text-sm">{title}</h3>
        <div className="flex items-center gap-2">
          {extra}
          {onExport && (
            <button onClick={onExport} className="text-surface-400 hover:text-brand-600 transition-colors" title="Exportar">
              <Download className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
      <div className="px-5 pb-4">{children}</div>
    </div>
  );
}

function FilterBadge({ label, onRemove }) {
  return (
    <span className="inline-flex items-center gap-1 bg-brand-100 text-brand-700 px-2 py-0.5 rounded-full text-[10px] font-medium">
      {label}
      <X className="w-3 h-3 cursor-pointer hover:text-red-600" onClick={onRemove} />
    </span>
  );
}

const TOOLTIP_STYLE = { backgroundColor: '#fff', border: '1px solid #E2E8F0', borderRadius: '8px', boxShadow: '0 4px 16px rgba(0,0,0,0.10)', fontSize: '12px', padding: '8px 12px' };
const TOOLTIP_LABEL_STYLE = { color: '#0F172A', fontWeight: 600, marginBottom: 2 };
const TOOLTIP_ITEM_STYLE = { color: '#475569' };

function ChartTooltip({ active, payload, label, formatter, unit }) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div style={{
      backgroundColor: '#1e293b',
      border: 'none',
      borderRadius: '8px',
      boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
      padding: '8px 12px',
      fontSize: '12px',
      minWidth: 100,
    }}>
      {label !== undefined && label !== '' && (
        <p style={{ color: '#ffffff', fontWeight: 700, marginBottom: 4, marginTop: 0 }}>{label}</p>
      )}
      {payload.map((entry, i) => {
        const val = formatter ? formatter(entry.value, entry.name) : entry.value;
        const displayVal = Array.isArray(val) ? val[0] : val;
        const displayName = Array.isArray(val) ? val[1] : (entry.name || '');
        return (
          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: i < payload.length - 1 ? 3 : 0 }}>
            <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', backgroundColor: entry.color || entry.fill || '#60A5FA', flexShrink: 0 }} />
            {displayName && <span style={{ color: '#94a3b8' }}>{displayName}:</span>}
            <span style={{ color: '#ffffff', fontWeight: 600 }}>{displayVal}{unit || ''}</span>
          </div>
        );
      })}
    </div>
  );
}

export default function DashboardPage() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ status: null, type: null, priority: null, project: null });
  const [showFilters, setShowFilters] = useState(false);
  const [drillView, setDrillView] = useState(null); // { type, data }
  const navigate = useNavigate();

  const load = () => {
    setLoading(true);
    dashboardAPI.bi()
      .then(({ data: r }) => setData(r.data))
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  };
  useEffect(() => { load(); }, []);

  // Filtered projects
  const filtered = useMemo(() => {
    if (!data) return [];
    return data.projects.filter(p => {
      if (filters.status && p.status !== filters.status) return false;
      if (filters.type && p.project_type !== filters.type) return false;
      if (filters.priority && p.priority !== filters.priority) return false;
      if (filters.project && p.id !== filters.project) return false;
      return true;
    });
  }, [data, filters]);

  const filteredIds = useMemo(() => new Set(filtered.map(p => p.id)), [filtered]);
  const isFiltered = filters.status || filters.type || filters.priority || filters.project;

  // Filter helper for sub-data
  const filterByProject = arr => isFiltered ? arr.filter(r => filteredIds.has(r.project_id)) : arr;

  const clearFilters = () => setFilters({ status: null, type: null, priority: null, project: null });

  const exportCSV = (rows, filename) => {
    if (!rows?.length) return;
    const keys = Object.keys(rows[0]);
    const csv = [keys.join(','), ...rows.map(r => keys.map(k => `"${r[k] ?? ''}"`).join(','))].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = `${filename}.csv`; a.click();
  };

  if (loading && !data) return (
    <div className="flex items-center justify-center h-64">
      <Loader2 className="w-6 h-6 text-brand-500 animate-spin" />
      <span className="ml-2 text-surface-400">Cargando inteligencia de negocio...</span>
    </div>
  );

  if (!data) return <div className="p-6 bg-red-50 rounded-xl text-red-700">Error cargando datos</div>;

  const sm = data.summary;
  const fProjects = filtered;
  const totalValue = fProjects.reduce((s, p) => s + p.contract_value, 0);
  const avgProgress = fProjects.length > 0 ? fProjects.reduce((s, p) => s + p.progress_pct, 0) / fProjects.length : 0;

  // Chart data
  const statusData = sm.by_status.map(r => ({ ...r, name: STATUS_L[r.name] || r.name, fill: COLORS[sm.by_status.indexOf(r) % COLORS.length] }));
  const typeData = sm.by_type.map(r => ({ ...r, name: TYPE_L[r.name] || r.name }));
  const priorityData = sm.by_priority.map(r => ({ ...r, name: PRIORITY_L[r.name] || r.name }));

  // Financial chart
  const finData = filterByProject(data.financial).map(f => ({
    name: f.project_code, ingreso: f.income, gasto: f.expenses, margen: f.margin,
    margen_pct: f.margin_pct, project_id: f.project_id,
  }));

  // Progress comparison
  const progressData = fProjects.map(p => {
    const timePct = p.total_days_est > 0 ? Math.min(100, (p.elapsed_days / p.total_days_est) * 100) : 0;
    return { name: p.code, avance: p.progress_pct, tiempo: Math.round(timePct), project_id: p.id };
  });

  // Obligations distribution
  const obData = filterByProject(data.obligations.by_project);
  const obChartData = obData.map(o => ({
    name: o.project_code, cumplidas: parseInt(o.cumplidas||0), pendientes: parseInt(o.pendientes||0),
    en_curso: parseInt(o.en_curso||0), vencidas: parseInt(o.vencidas||0), project_id: o.project_id,
  }));

  // Risk radar
  const riskCatData = (data.risks.by_category || []).map(r => ({
    category: r.category, total: parseInt(r.total), criticos: parseInt(r.criticos || 0),
    score: parseFloat(r.avg_score || 0),
  }));

  // Drill-down modal
  const DrillDown = () => {
    if (!drillView) return null;
    return (
      <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={() => setDrillView(null)}>
        <div className="bg-white rounded-2xl shadow-xl max-w-4xl w-full max-h-[80vh] overflow-auto p-6" onClick={e => e.stopPropagation()}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-display font-bold text-brand-900 text-lg">{drillView.title}</h2>
            <div className="flex items-center gap-2">
              <button onClick={() => exportCSV(drillView.rows, drillView.title)} className="btn-ghost text-xs flex items-center gap-1">
                <Download className="w-3.5 h-3.5" /> Exportar CSV
              </button>
              <button onClick={() => setDrillView(null)} className="p-1.5 hover:bg-surface-100 rounded-lg"><X className="w-5 h-5" /></button>
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead><tr className="border-b border-surface-200">
                {drillView.columns.map(c => <th key={c.key} className="text-left py-2 px-3 font-semibold text-surface-500">{c.label}</th>)}
              </tr></thead>
              <tbody>
                {drillView.rows.map((row, i) => (
                  <tr key={i} className="border-b border-surface-50 hover:bg-surface-50 cursor-pointer"
                    onClick={() => { if (row.project_id) navigate(`/adjudicacion/${row.project_id}`); }}>
                    {drillView.columns.map(c => (
                      <td key={c.key} className="py-2 px-3">
                        {c.format === 'currency' ? COP(row[c.key]) : c.format === 'pct' ? PCT(row[c.key]) : c.format === 'date' ? DATE(row[c.key]) : row[c.key]}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-5">
      <DrillDown />

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-display font-bold text-brand-900">Inteligencia de Negocio</h2>
          <p className="text-xs text-surface-400 mt-0.5">
            Dashboard ejecutivo en tiempo real • {new Date().toLocaleDateString('es-CO', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setShowFilters(!showFilters)} className={`btn-ghost text-xs flex items-center gap-1.5 ${isFiltered ? 'bg-brand-100 text-brand-700' : ''}`}>
            <Filter className="w-3.5 h-3.5" /> Filtros {isFiltered && `(${fProjects.length})`}
          </button>
          <button onClick={load} disabled={loading} className="btn-ghost text-xs"><RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} /></button>
          <button onClick={() => navigate('/adjudicacion/nuevo')} className="btn-primary flex items-center gap-1.5 text-xs">
            <Plus className="w-3.5 h-3.5" /> Nuevo Proyecto
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="bg-white rounded-xl shadow-card p-4 animate-slide-up">
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs font-semibold text-brand-800">Filtrar datos</span>
            {isFiltered && <button onClick={clearFilters} className="text-[10px] text-red-500 hover:underline">Limpiar filtros</button>}
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div>
              <label className="text-[10px] text-surface-400 font-medium">Estado</label>
              <select value={filters.status||''} onChange={e => setFilters(f => ({...f, status: e.target.value||null}))} className="input-field text-xs mt-0.5">
                <option value="">Todos</option>
                {Object.entries(STATUS_L).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-surface-400 font-medium">Tipo</label>
              <select value={filters.type||''} onChange={e => setFilters(f => ({...f, type: e.target.value||null}))} className="input-field text-xs mt-0.5">
                <option value="">Todos</option>
                {Object.entries(TYPE_L).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-surface-400 font-medium">Prioridad</label>
              <select value={filters.priority||''} onChange={e => setFilters(f => ({...f, priority: e.target.value||null}))} className="input-field text-xs mt-0.5">
                <option value="">Todas</option>
                {Object.entries(PRIORITY_L).map(([k,v]) => <option key={k} value={k}>{v}</option>)}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-surface-400 font-medium">Proyecto</label>
              <select value={filters.project||''} onChange={e => setFilters(f => ({...f, project: e.target.value ? parseInt(e.target.value) : null}))} className="input-field text-xs mt-0.5">
                <option value="">Todos</option>
                {data.projects.map(p => <option key={p.id} value={p.id}>{p.code} — {p.name}</option>)}
              </select>
            </div>
          </div>
          {isFiltered && (
            <div className="flex gap-1 mt-2">
              {filters.status && <FilterBadge label={STATUS_L[filters.status]} onRemove={() => setFilters(f => ({...f, status:null}))} />}
              {filters.type && <FilterBadge label={TYPE_L[filters.type]} onRemove={() => setFilters(f => ({...f, type:null}))} />}
              {filters.priority && <FilterBadge label={PRIORITY_L[filters.priority]} onRemove={() => setFilters(f => ({...f, priority:null}))} />}
              {filters.project && <FilterBadge label={data.projects.find(p=>p.id===filters.project)?.code} onRemove={() => setFilters(f => ({...f, project:null}))} />}
            </div>
          )}
        </div>
      )}

      {/* KPI Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-3">
        <KPI label="Total Proyectos" value={fProjects.length} icon={FolderKanban} color="bg-brand-600"
          onClick={() => setDrillView({ title:'Todos los Proyectos', rows: fProjects,
            columns: [{ key:'code', label:'Código' },{ key:'name', label:'Nombre' },{ key:'status', label:'Estado' },{ key:'contract_value', label:'Valor', format:'currency' },{ key:'progress_pct', label:'Avance', format:'pct' }] })} />
        <KPI label="En Ejecución" value={fProjects.filter(p=>p.status==='en_ejecucion').length} icon={PlayCircle} color="bg-emerald-500" />
        <KPI label="Valor Total" value={fmt(totalValue)} icon={DollarSign} color="bg-teal-600" />
        <KPI label="Avance Promedio" value={PCT(avgProgress)} icon={TrendingUp} color="bg-blue-500" />
        <KPI label="Oblig. Vencidas" value={sm.total_overdue} icon={AlertTriangle} color="bg-red-500"
          onClick={() => setDrillView({ title:'Obligaciones Vencidas', rows: data.obligations.overdue,
            columns: [{ key:'project_code', label:'Proyecto' },{ key:'code', label:'Código' },{ key:'description', label:'Descripción' },{ key:'days_overdue', label:'Días atraso' },{ key:'risk_level', label:'Riesgo' }] })} />
        <KPI label="Riesgos Críticos" value={sm.total_critical_risks} icon={Shield} color="bg-orange-500"
          onClick={() => setDrillView({ title:'Riesgos Críticos', rows: data.risks.top.filter(r=>r.risk_level==='critico'),
            columns: [{ key:'project_code', label:'Proyecto' },{ key:'risk_code', label:'Código' },{ key:'description', label:'Descripción' },{ key:'risk_score', label:'Score' },{ key:'category', label:'Categoría' }] })} />
        <KPI label="Pólizas x Vencer" value={data.policies.expiring?.length || 0} icon={ShieldAlert} color="bg-amber-500"
          onClick={() => setDrillView({ title:'Pólizas por Vencer', rows: data.policies.expiring,
            columns: [{ key:'project_code', label:'Proyecto' },{ key:'policy_type', label:'Tipo' },{ key:'insurer', label:'Aseguradora' },{ key:'expiry_date', label:'Vence', format:'date' },{ key:'days_to_expire', label:'Días' }] })} />
        <KPI label="Equipo Activo" value={filterByProject(data.team).reduce((s,t)=>s+parseInt(t.activos||0),0)} icon={Users} color="bg-purple-500" />
      </div>

      {/* PMO Indicators */}
      {data.pmo && <PMOPanel pmo={data.pmo} projects={data.projects} />}

      {/* Row 1: Status + Type + Priority */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <ChartCard title="Por Estado" onExport={() => exportCSV(statusData, 'proyectos_estado')}>
          <ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={statusData} cx="50%" cy="50%" innerRadius={40} outerRadius={75} paddingAngle={3} dataKey="value"
                onClick={(_, idx) => setFilters(f => ({...f, status: sm.by_status[idx]?.name}))}>
                {statusData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} className="cursor-pointer hover:opacity-80" />)}
              </Pie>
              <Tooltip content={<ChartTooltip />} wrapperStyle={{ outline: 'none' }} />
            </PieChart>
          </ResponsiveContainer>
          <div className="space-y-1">
            {statusData.map((item, i) => (
              <div key={item.name} className="flex items-center justify-between text-xs cursor-pointer hover:bg-surface-50 rounded px-1 py-0.5"
                onClick={() => setFilters(f => ({...f, status: sm.by_status[i]?.name}))}>
                <div className="flex items-center gap-1.5">
                  <div className="w-2 h-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-surface-700">{item.name}</span>
                </div>
                <span className="font-semibold text-brand-900">{item.value}</span>
              </div>
            ))}
          </div>
        </ChartCard>

        <ChartCard title="Por Tipo" onExport={() => exportCSV(typeData, 'proyectos_tipo')}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={typeData} layout="vertical">
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis type="number" tick={{ fontSize: 10, fill: '#475569' }} allowDecimals={false} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#475569' }} width={80} />
              <Tooltip content={<ChartTooltip />} wrapperStyle={{ outline: 'none' }} />
              <Bar dataKey="value" fill="#1B5FAA" radius={[0,4,4,0]} name="Proyectos"
                onClick={(d) => setFilters(f => ({...f, type: sm.by_type.find(t => (TYPE_L[t.name]||t.name) === d.name)?.name}))} className="cursor-pointer" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Valor por Proyecto" onExport={() => exportCSV(finData, 'financiero')}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={finData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 9, fill: '#475569' }} tickFormatter={v => fmt(v)} />
              <Tooltip content={(p) => <ChartTooltip {...p} formatter={(v) => COP(v)} />} wrapperStyle={{ outline: 'none' }} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#334155' }} />
              <Bar dataKey="ingreso" fill="#059669" name="Ingreso" radius={[2,2,0,0]}
                onClick={(d) => { if (d.project_id) navigate(`/adjudicacion/${d.project_id}`); }} className="cursor-pointer" />
              <Bar dataKey="gasto" fill="#DC2626" name="Gasto" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 2: Progress Comparison + Obligations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Avance Físico vs Tiempo" onExport={() => exportCSV(progressData, 'avance')}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={progressData} barGap={0}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 9, fill: '#475569' }} domain={[0, 100]} tickFormatter={v => `${v}%`} />
              <Tooltip content={(p) => <ChartTooltip {...p} formatter={(v) => `${v}%`} />} wrapperStyle={{ outline: 'none' }} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#334155' }} />
              <Bar dataKey="avance" fill="#059669" name="Avance Físico" radius={[2,2,0,0]}
                onClick={d => { if (d.project_id) navigate(`/adjudicacion/${d.project_id}`); }} className="cursor-pointer" />
              <Bar dataKey="tiempo" fill="#94A3B8" name="Tiempo Transcurrido" radius={[2,2,0,0]} />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>

        <ChartCard title="Obligaciones por Proyecto" onExport={() => exportCSV(obChartData, 'obligaciones')}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={obChartData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 9, fill: '#475569' }} allowDecimals={false} />
              <Tooltip content={<ChartTooltip />} wrapperStyle={{ outline: 'none' }} />
              <Legend wrapperStyle={{ fontSize: 10, color: '#334155' }} />
              <Bar dataKey="cumplidas" stackId="a" fill="#059669" name="Cumplidas" />
              <Bar dataKey="en_curso" stackId="a" fill="#3B82F6" name="En curso" />
              <Bar dataKey="pendientes" stackId="a" fill="#F59E0B" name="Pendientes" />
              <Bar dataKey="vencidas" stackId="a" fill="#EF4444" name="Vencidas" radius={[2,2,0,0]}
                onClick={d => { if (d.project_id) navigate(`/adjudicacion/${d.project_id}`); }} className="cursor-pointer" />
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Row 3: Risks + Margin */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Riesgos por Categoría" onExport={() => exportCSV(riskCatData, 'riesgos_cat')}>
          {riskCatData.length > 0 ? (
            <ResponsiveContainer width="100%" height={250}>
              <RadarChart data={riskCatData}>
                <PolarGrid stroke="#E2E8F0" />
                <PolarAngleAxis dataKey="category" tick={{ fontSize: 10, fill: '#334155' }} />
                <PolarRadiusAxis tick={{ fontSize: 9 }} />
                <Radar name="Total" dataKey="total" stroke="#3B82F6" fill="#3B82F6" fillOpacity={0.3} />
                <Radar name="Críticos" dataKey="criticos" stroke="#EF4444" fill="#EF4444" fillOpacity={0.3} />
                <Tooltip content={<ChartTooltip />} wrapperStyle={{ outline: 'none' }} />
                <Legend wrapperStyle={{ fontSize: 10, color: '#334155' }} />
              </RadarChart>
            </ResponsiveContainer>
          ) : <p className="text-center text-surface-400 text-sm py-12">Sin datos de riesgos</p>}
        </ChartCard>

        <ChartCard title="Margen por Proyecto" onExport={() => exportCSV(finData, 'margenes')}>
          <ResponsiveContainer width="100%" height={250}>
            <BarChart data={finData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
              <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#475569' }} />
              <YAxis tick={{ fontSize: 9, fill: '#475569' }} tickFormatter={v => `${v.toFixed(0)}%`} />
              <Tooltip content={(p) => <ChartTooltip {...p} formatter={(v) => `${v.toFixed(1)}%`} />} wrapperStyle={{ outline: 'none' }} />
              <Bar dataKey="margen_pct" name="Margen %" radius={[4,4,0,0]}>
                {finData.map((d, i) => <Cell key={i} fill={d.margen_pct >= 15 ? '#059669' : d.margen_pct >= 0 ? '#F59E0B' : '#EF4444'} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </ChartCard>
      </div>

      {/* Projects Table */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <div className="flex items-center justify-between px-5 pt-4 pb-2">
          <h3 className="font-display font-semibold text-brand-900 text-sm">Proyectos {isFiltered && `(${fProjects.length} filtrados)`}</h3>
          <button onClick={() => exportCSV(fProjects.map(p => ({ codigo:p.code, nombre:p.name, estado:STATUS_L[p.status], tipo:TYPE_L[p.project_type], valor:p.contract_value, avance:p.progress_pct, dias_restantes:p.days_remaining })), 'proyectos')}
            className="text-surface-400 hover:text-brand-600"><Download className="w-3.5 h-3.5" /></button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead><tr className="border-b border-surface-200 bg-surface-50">
              <th className="text-left py-2 px-4 font-semibold text-surface-500">Proyecto</th>
              <th className="text-left py-2 px-3 font-semibold text-surface-500">Estado</th>
              <th className="text-right py-2 px-3 font-semibold text-surface-500">Valor</th>
              <th className="text-center py-2 px-3 font-semibold text-surface-500">Avance</th>
              <th className="text-center py-2 px-3 font-semibold text-surface-500">Días rest.</th>
              <th className="text-center py-2 px-3 font-semibold text-surface-500">Prioridad</th>
              <th className="text-center py-2 px-3 font-semibold text-surface-500">Acciones</th>
            </tr></thead>
            <tbody>
              {fProjects.map(p => (
                <tr key={p.id} className="border-b border-surface-50 hover:bg-brand-50/30 transition-colors">
                  <td className="py-2.5 px-4">
                    <p className="font-medium text-brand-800 truncate max-w-[200px]">{p.name}</p>
                    <p className="text-[10px] text-surface-400">{p.code} • {p.client_name}</p>
                  </td>
                  <td className="py-2 px-3">
                    <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ${STATUS_COLORS[p.status] || 'bg-surface-100'}`}>
                      {STATUS_L[p.status] || p.status}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-right font-mono text-brand-800">{fmt(p.contract_value)}</td>
                  <td className="py-2 px-3">
                    <div className="flex items-center gap-1.5 justify-center">
                      <div className="w-16 bg-surface-100 rounded-full h-1.5">
                        <div className={`h-1.5 rounded-full ${p.progress_pct >= 80 ? 'bg-emerald-500' : p.progress_pct >= 40 ? 'bg-amber-400' : 'bg-red-400'}`}
                          style={{ width: `${Math.min(100, p.progress_pct)}%` }} />
                      </div>
                      <span className="text-[10px] font-medium w-8 text-right">{PCT(p.progress_pct)}</span>
                    </div>
                  </td>
                  <td className={`py-2 px-3 text-center font-medium ${p.days_remaining < 0 ? 'text-red-600' : p.days_remaining < 30 ? 'text-amber-600' : 'text-surface-600'}`}>
                    {p.days_remaining ?? '—'}
                  </td>
                  <td className="py-2 px-3 text-center">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded ${p.priority === 'alta' ? 'bg-red-100 text-red-700' : p.priority === 'media' ? 'bg-amber-100 text-amber-700' : 'bg-green-100 text-green-700'}`}>
                      {PRIORITY_L[p.priority] || p.priority}
                    </span>
                  </td>
                  <td className="py-2 px-3 text-center">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => navigate(`/adjudicacion/${p.id}`)} className="p-1 hover:bg-brand-100 rounded" title="Ver detalle">
                        <Eye className="w-3.5 h-3.5 text-brand-500" />
                      </button>
                      <button onClick={() => navigate(`/adjudicacion/${p.id}/comite`)} className="p-1 hover:bg-brand-100 rounded" title="Comité">
                        <BarChart3 className="w-3.5 h-3.5 text-violet-500" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Timeline */}
      {data.timeline?.length > 0 && (
        <ChartCard title="Actividad Reciente (30 días)" onExport={() => exportCSV(data.timeline, 'actividad')}>
          <div className="space-y-1.5 max-h-60 overflow-y-auto">
            {data.timeline.map((t, i) => (
              <div key={i} className="flex items-center gap-3 text-xs py-1.5 border-b border-surface-50 cursor-pointer hover:bg-surface-50 rounded"
                onClick={() => navigate(`/adjudicacion/${t.project_id}`)}>
                <span className={`w-2 h-2 rounded-full flex-shrink-0 ${t.type === 'payment' ? 'bg-emerald-400' : t.type === 'risk' ? 'bg-red-400' : 'bg-blue-400'}`} />
                <span className="text-surface-400 w-14 flex-shrink-0">{DATE(t.date)}</span>
                <span className="font-mono text-[9px] text-brand-500 w-16 flex-shrink-0">{t.project_code}</span>
                <span className="text-brand-800 flex-1 truncate">{t.detail}</span>
                <span className={`px-1.5 py-0.5 rounded text-[9px] ${t.status === 'pagado' || t.status === 'cumplida' || t.status === 'cerrado' ? 'bg-emerald-100 text-emerald-700' : t.status === 'vencida' || t.status === 'materializado' ? 'bg-red-100 text-red-700' : 'bg-surface-100 text-surface-600'}`}>
                  {t.status}
                </span>
              </div>
            ))}
          </div>
        </ChartCard>
      )}

      <p className="text-center text-[10px] text-surface-300 pb-4">
        SGIP-IA • Inteligencia de Negocio • Generado: {new Date().toLocaleString('es-CO')}
      </p>
    </div>
  );
}
