import React, { useState, useEffect, useCallback } from 'react';
import { progressAPI } from '../../services/api';
import { Loader2, TrendingUp, TrendingDown, AlertTriangle, Save, MessageSquare, RefreshCw, ChevronDown, ChevronRight } from 'lucide-react';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, Area, ComposedChart, Bar } from 'recharts';

function fm(v) { return v != null ? new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v) : '$0'; }
function fmShort(v) {
  if (Math.abs(v) >= 1e9) return `$${(v/1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v/1e6).toFixed(1)}M`;
  return fm(v);
}

export default function ProgressPanel({ projectId, perms = {} }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [chartView, setChartView] = useState('physical'); // physical | financial | combined
  const [expandedMonth, setExpandedMonth] = useState(null);
  const [obsText, setObsText] = useState('');
  const [savingObs, setSavingObs] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await progressAPI.list(projectId);
      setData(r.data);
    } catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { setLoading(true); load(); }, [load]);

  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const saveObservation = async (month) => {
    if (!obsText.trim()) return;
    setSavingObs(true);
    try {
      await progressAPI.create(projectId, {
        period_label: month.label,
        period_date: new Date().toISOString().split('T')[0],
        physical_planned: month.physical_planned,
        physical_actual: month.physical_actual,
        financial_planned: month.financial_planned,
        financial_actual: month.financial_actual,
        observations: obsText,
      });
      showToast('Observación guardada');
      setObsText('');
      setExpandedMonth(null);
      load();
    } catch (e) { showToast('Error guardando'); }
    finally { setSavingObs(false); }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>;
  if (!data || !data.data) return <p className="text-sm text-surface-400 text-center py-8">Configure el cronograma y presupuesto para ver la Curva S.</p>;

  const months = data.data || [];
  const summary = data.summary || {};
  const pastMonths = months.filter(m => !m.isFuture);
  const devPhys = summary.physical_deviation || 0;
  const devFin = summary.financial_deviation || 0;

  // Chart data
  const chartData = months.map(m => ({
    name: m.label,
    mes: m.mes,
    // Physical (%)
    'Fís. Programado': m.physical_planned,
    'Fís. Real': m.isFuture ? null : m.physical_actual,
    // Financial cumulative ($)
    'Fin. Programado': m.acum_financial_planned,
    'Fin. Real': m.isFuture ? null : m.acum_financial_actual,
    // Monthly financial ($)
    'Plan Mensual': m.financial_planned,
    'Ejec Mensual': m.isFuture ? null : m.financial_actual,
    isCurrent: m.isCurrent,
  }));

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up bg-emerald-600 text-white">{toast}</div>}

      {/* Header with auto-refresh indicator */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <RefreshCw className="w-3.5 h-3.5 text-emerald-500" />
          <span className="text-[10px] text-surface-400">Auto-calculado desde Cronograma y Seg. Presupuestal</span>
        </div>
        <button onClick={() => { setLoading(true); load(); }} className="text-xs text-brand-600 hover:underline flex items-center gap-1">
          <RefreshCw className="w-3 h-3" /> Actualizar
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
          <p className="text-[10px] text-blue-600 font-semibold uppercase">Avance Físico</p>
          <p className="text-lg font-display font-bold text-blue-700">{summary.physical_actual || 0}%</p>
          <p className="text-[10px] text-blue-500">{summary.activities_completed || 0}/{summary.activities_total || 0} actividades</p>
        </div>
        <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
          <p className="text-[10px] text-purple-600 font-semibold uppercase">Ejecución Financiera</p>
          <p className="text-lg font-display font-bold text-purple-700">{fm(summary.total_executed)}</p>
          <p className="text-[10px] text-purple-500">{summary.execution_pct}% del contrato</p>
        </div>
        <div className={`p-3 rounded-lg border ${devPhys >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <p className={`text-[10px] font-semibold uppercase ${devPhys >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>Desv. Física</p>
          <p className={`text-lg font-display font-bold ${devPhys >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{devPhys > 0 ? '+' : ''}{devPhys}%</p>
          <p className={`text-[10px] ${devPhys >= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{devPhys >= 0 ? 'Adelanto' : 'Atraso'}</p>
        </div>
        <div className={`p-3 rounded-lg border ${devFin <= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <p className={`text-[10px] font-semibold uppercase ${devFin <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>Desv. Financiera</p>
          <p className={`text-lg font-display font-bold ${devFin <= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fm(devFin)}</p>
          <p className={`text-[10px] ${devFin <= 0 ? 'text-emerald-500' : 'text-red-500'}`}>{devFin <= 0 ? 'Ahorro' : 'Sobrecosto'}</p>
        </div>
      </div>

      {/* Chart View Toggle */}
      <div className="flex gap-1 bg-surface-100 rounded-lg p-0.5 w-fit">
        {[
          { id: 'physical', label: 'Avance Físico' },
          { id: 'financial', label: 'Ejecución Financiera' },
          { id: 'combined', label: 'Combinado' },
        ].map(v => (
          <button key={v.id} onClick={() => setChartView(v.id)}
            className={`px-3 py-1.5 text-xs rounded-md transition-all ${chartView === v.id ? 'bg-white shadow text-brand-700 font-medium' : 'text-surface-500'}`}>
            {v.label}
          </button>
        ))}
      </div>

      {/* Curva S Chart */}
      {pastMonths.length > 0 && (
        <div className="bg-white border border-surface-100 rounded-xl p-4">
          <h4 className="text-sm font-semibold text-brand-900 mb-3">
            Curva S — {chartView === 'physical' ? 'Avance Físico (%)' : chartView === 'financial' ? 'Ejecución Financiera ($)' : 'Físico + Financiero'}
          </h4>
          <ResponsiveContainer width="100%" height={300}>
            {chartView === 'physical' ? (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} domain={[0, 100]} unit="%" />
                <Tooltip contentStyle={{ backgroundColor: '#0A1F3A', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line type="monotone" dataKey="Fís. Programado" stroke="#94A3B8" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Fís. Real" stroke="#1B5FAA" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
              </LineChart>
            ) : chartView === 'financial' ? (
              <ComposedChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} />
                <YAxis tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={fmShort} />
                <Tooltip contentStyle={{ backgroundColor: '#0A1F3A', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px' }} formatter={v => v ? fm(v) : '—'} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Bar dataKey="Plan Mensual" fill="#CBD5E1" radius={[4, 4, 0, 0]} />
                <Bar dataKey="Ejec Mensual" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
                <Line type="monotone" dataKey="Fin. Programado" stroke="#94A3B8" strokeDasharray="5 5" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="Fin. Real" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
              </ComposedChart>
            ) : (
              <LineChart data={chartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#94A3B8' }} />
                <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#94A3B8' }} domain={[0, 100]} unit="%" />
                <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#94A3B8' }} tickFormatter={fmShort} />
                <Tooltip contentStyle={{ backgroundColor: '#0A1F3A', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '12px' }} />
                <Legend wrapperStyle={{ fontSize: '11px' }} />
                <Line yAxisId="left" type="monotone" dataKey="Fís. Programado" stroke="#94A3B8" strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
                <Line yAxisId="left" type="monotone" dataKey="Fís. Real" stroke="#1B5FAA" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
                <Line yAxisId="right" type="monotone" dataKey="Fin. Programado" stroke="#d4d4d8" strokeDasharray="5 5" strokeWidth={1.5} dot={false} />
                <Line yAxisId="right" type="monotone" dataKey="Fin. Real" stroke="#7c3aed" strokeWidth={2.5} dot={{ r: 3 }} connectNulls={false} />
              </LineChart>
            )}
          </ResponsiveContainer>
        </div>
      )}

      {/* Monthly Detail Table */}
      <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
        <div className="grid grid-cols-12 text-[10px] font-semibold uppercase text-surface-500 bg-surface-50 border-b px-3 py-2">
          <div className="col-span-2">Periodo</div>
          <div className="col-span-2 text-center">Fís. Prog.</div>
          <div className="col-span-2 text-center">Fís. Real</div>
          <div className="col-span-2 text-right">Fin. Programado</div>
          <div className="col-span-2 text-right">Fin. Ejecutado</div>
          <div className="col-span-2 text-center">Estado</div>
        </div>

        {months.map(m => {
          const isExpanded = expandedMonth === m.mes;
          const physDev = m.physical_deviation;
          const finDev = m.financial_deviation;

          return (
            <div key={m.mes}>
              <div onClick={() => { setExpandedMonth(isExpanded ? null : m.mes); setObsText(m.observations || ''); }}
                className={`grid grid-cols-12 items-center px-3 py-2.5 text-sm border-b border-surface-50 cursor-pointer transition-colors
                  ${m.isCurrent ? 'bg-brand-50/50 border-l-2 border-l-brand-500' : m.isFuture ? 'opacity-50' : 'hover:bg-surface-50'}`}>
                <div className="col-span-2 flex items-center gap-1.5">
                  {isExpanded ? <ChevronDown className="w-3 h-3 text-surface-400" /> : <ChevronRight className="w-3 h-3 text-surface-300" />}
                  <span className={`font-medium ${m.isCurrent ? 'text-brand-700' : 'text-brand-800'}`}>{m.label}</span>
                  {m.isCurrent && <span className="text-[9px] bg-brand-100 text-brand-600 px-1 py-0.5 rounded">Actual</span>}
                </div>
                <div className="col-span-2 text-center text-surface-400 text-xs">{m.physical_planned}%</div>
                <div className="col-span-2 text-center text-xs font-medium">
                  {m.isFuture ? <span className="text-surface-300">—</span> :
                    <span className={physDev >= 0 ? 'text-emerald-600' : 'text-red-600'}>{m.physical_actual}%</span>}
                </div>
                <div className="col-span-2 text-right text-surface-400 font-mono text-xs">{fm(m.financial_planned)}</div>
                <div className="col-span-2 text-right font-mono text-xs">
                  {m.isFuture ? <span className="text-surface-300">—</span> :
                    <span className="text-purple-600">{fm(m.financial_actual)}</span>}
                </div>
                <div className="col-span-2 text-center">
                  {m.isFuture ? <span className="text-[10px] text-surface-300">Pendiente</span> : (
                    <div className="flex items-center justify-center gap-1">
                      {physDev >= 0 ?
                        <TrendingUp className="w-3 h-3 text-emerald-500" /> :
                        <TrendingDown className="w-3 h-3 text-red-500" />}
                      <span className={`text-[10px] font-semibold ${physDev >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {physDev > 0 ? '+' : ''}{physDev}%
                      </span>
                      {m.observations && <MessageSquare className="w-3 h-3 text-amber-400" />}
                    </div>
                  )}
                </div>
              </div>

              {/* Expanded: observation + detail */}
              {isExpanded && !m.isFuture && (
                <div className="px-6 py-3 bg-surface-50/50 border-b space-y-2 animate-slide-up">
                  <div className="grid grid-cols-2 gap-4 text-xs">
                    <div>
                      <span className="text-surface-400">Desv. Física:</span>
                      <span className={`ml-1 font-semibold ${physDev >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {physDev > 0 ? '+' : ''}{physDev}% — {physDev >= 0 ? 'Adelanto' : 'Atraso'}
                      </span>
                    </div>
                    <div>
                      <span className="text-surface-400">Desv. Financiera:</span>
                      <span className={`ml-1 font-semibold ${finDev <= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {fm(finDev)} — {finDev <= 0 ? 'Ahorro' : 'Sobrecosto'}
                      </span>
                    </div>
                  </div>
                  {perms.canEdit && (
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="block text-[10px] text-surface-400 mb-1">Observación del periodo</label>
                        <textarea value={obsText} onChange={e => setObsText(e.target.value)}
                          className="input-field text-xs min-h-[40px] resize-y w-full"
                          placeholder="Justificar desviaciones, hitos alcanzados, riesgos materializados..." />
                      </div>
                      <button onClick={() => saveObservation(m)} disabled={savingObs}
                        className="btn-primary text-xs flex items-center gap-1 flex-shrink-0 h-8">
                        {savingObs ? <Loader2 className="w-3 h-3 animate-spin" /> : <Save className="w-3 h-3" />} Guardar
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Alerts */}
      {devPhys < -10 && (
        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">Alerta: Atraso significativo ({devPhys}%)</p>
            <p className="text-xs text-red-600">El avance físico está {Math.abs(devPhys)}% por debajo de lo programado. Revise el cronograma.</p>
          </div>
        </div>
      )}
    </div>
  );
}
