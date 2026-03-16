import React, { useState, useEffect, useCallback } from 'react';
import { budgetAPI } from '../../services/api';
import {
  Loader2, ChevronDown, ChevronRight, Save, AlertTriangle,
  TrendingUp, TrendingDown, CheckCircle2, X, BarChart3, ArrowLeft, Plus, Trash2,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

function fm(v) { return v != null ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v) : '$0'; }
function fmShort(v) {
  if (Math.abs(v) >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (Math.abs(v) >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (Math.abs(v) >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return fm(v);
}

const devColor = (v) => { if (!v || Math.abs(v) < 1) return 'text-surface-400'; return v > 0 ? 'text-red-600' : 'text-emerald-600'; };
const devBg = (v) => { if (!v || Math.abs(v) < 1) return 'bg-surface-50'; return v > 0 ? 'bg-red-50' : 'bg-emerald-50'; };
const CAT_COLORS = { payroll: 'blue', contractors: 'purple', expenses: 'amber', puc: 'slate' };
const CAT_LABELS = { payroll: 'Nómina', contractors: 'Contratistas', expenses: 'Gastos Op.', puc: 'PUC' };

export default function BudgetTrackingPanel({ projectId, perms = {} }) {
  const [overview, setOverview] = useState(null);
  const [loading, setLoading] = useState(true);
  const [selectedMonth, setSelectedMonth] = useState(null); // null = overview, number = detail
  const [viewMode, setViewMode] = useState('table');
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try { const r = await budgetAPI.tracking(projectId); setOverview(r.data); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>;
  if (!overview) return <p className="text-sm text-surface-400 text-center py-8">No hay datos de seguimiento. Configure el presupuesto primero.</p>;

  const months = overview.data || overview.months || [];
  const totals = overview.totals || { planeado: 0, ejecutado: 0, desviacion: 0, desviacion_pct: 0 };
  const project_months = overview.project_months || months.length || 12;

  // If a month is selected, show detail
  if (selectedMonth !== null) {
    return <MonthDetail projectId={projectId} mes={selectedMonth} perms={perms}
      onBack={() => { setSelectedMonth(null); load(); }}
      toast={toast} setToast={setToast} />;
  }

  // Handle both flat numbers and nested objects (backward compat)
  const getVal = (m, field) => {
    const v = m[field];
    if (v === null || v === undefined) return 0;
    if (typeof v === 'object') return v.total || 0;
    return parseFloat(v) || 0;
  };

  const chartData = months.map(m => ({ name: m.label, Planeado: getVal(m, 'planeado'), Ejecutado: getVal(m, 'ejecutado') }));

  return (
    <div className="space-y-4">
      {toast && <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>{toast.msg}</div>}

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
          <p className="text-[10px] text-blue-600 font-semibold uppercase">Total Planeado</p>
          <p className="text-lg font-display font-bold text-blue-700">{fm(totals.planeado)}</p>
        </div>
        <div className="p-3 bg-purple-50 rounded-lg border border-purple-100">
          <p className="text-[10px] text-purple-600 font-semibold uppercase">Total Ejecutado</p>
          <p className="text-lg font-display font-bold text-purple-700">{fm(totals.ejecutado)}</p>
        </div>
        <div className={`p-3 rounded-lg border ${devBg(totals.desviacion)} ${totals.desviacion > 0 ? 'border-red-200' : totals.desviacion < 0 ? 'border-emerald-200' : 'border-surface-100'}`}>
          <p className={`text-[10px] font-semibold uppercase ${devColor(totals.desviacion)}`}>
            {totals.desviacion > 0 ? 'Sobrecosto' : totals.desviacion < 0 ? 'Ahorro + ¨Pend ejecución' : 'Desviación'}
          </p>
          <p className={`text-lg font-display font-bold ${devColor(totals.desviacion)}`}>{fm(totals.desviacion)}</p>
          {totals.desviacion_pct !== 0 && <p className={`text-[10px] ${devColor(totals.desviacion)}`}>{totals.desviacion_pct > 0 ? '+' : ''}{totals.desviacion_pct.toFixed(1)}%</p>}
        </div>
        <div className="p-3 bg-surface-50 rounded-lg border border-surface-100">
          <p className="text-[10px] text-surface-500 font-semibold uppercase">Progreso</p>
          <p className="text-lg font-display font-bold text-brand-900">{months.filter(m => m.tiene_datos).length}/{project_months} meses</p>
        </div>
      </div>

      {/* View toggle */}
      <div className="flex items-center justify-between">
        <p className="text-xs text-surface-400">Haga clic en un mes para ver y registrar el detalle por ítem</p>
        <div className="flex gap-1 bg-surface-100 rounded-lg p-0.5">
          <button onClick={() => setViewMode('table')} className={`px-3 py-1 text-xs rounded-md transition-all ${viewMode === 'table' ? 'bg-white shadow text-brand-700 font-medium' : 'text-surface-500'}`}>Tabla</button>
          <button onClick={() => setViewMode('chart')} className={`px-3 py-1 text-xs rounded-md transition-all ${viewMode === 'chart' ? 'bg-white shadow text-brand-700 font-medium' : 'text-surface-500'}`}>Gráfico</button>
        </div>
      </div>

      {viewMode === 'chart' && (
        <div className="bg-white rounded-xl border border-surface-100 p-4">
          <ResponsiveContainer width="100%" height={300}>
            <BarChart data={chartData} margin={{ top: 5, right: 10, left: 10, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} />
              <YAxis tick={{ fontSize: 10 }} tickFormatter={fmShort} />
              <Tooltip formatter={v => fm(v)} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="Planeado" fill="#3b82f6" radius={[4, 4, 0, 0]} />
              <Bar dataKey="Ejecutado" fill="#8b5cf6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {viewMode === 'table' && (
        <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
          <div className="grid grid-cols-12 text-[10px] font-semibold uppercase text-surface-500 bg-surface-50 border-b">
            <div className="col-span-2 px-3 py-2">Mes</div>
            <div className="col-span-2 px-2 py-2 text-right">Planeado</div>
            <div className="col-span-2 px-2 py-2 text-right">Ejecutado</div>
            <div className="col-span-2 px-2 py-2 text-right">Desviación</div>
            <div className="col-span-2 px-2 py-2 text-right">Acumulado</div>
            <div className="col-span-2 px-2 py-2 text-center">Avance</div>
          </div>
          {months.map(m => (
            <div key={m.mes} onClick={() => setSelectedMonth(m.mes)}
              className="grid grid-cols-12 items-center border-b border-surface-50 text-sm cursor-pointer hover:bg-brand-50/50 transition-colors group">
              <div className="col-span-2 px-3 py-2.5 flex items-center gap-2">
                <ChevronRight className="w-3 h-3 text-surface-300 group-hover:text-brand-500 transition-colors" />
                <span className="font-medium text-brand-800">{m.label}</span>
              </div>
              <div className="col-span-2 px-2 py-2.5 text-right text-blue-600 font-mono text-xs">{fm(getVal(m, 'planeado'))}</div>
              <div className="col-span-2 px-2 py-2.5 text-right font-mono text-xs">
                {m.tiene_datos ? <span className="text-purple-600">{fm(getVal(m, 'ejecutado'))}</span> : <span className="text-surface-300 italic">Sin datos</span>}
              </div>
              <div className={`col-span-2 px-2 py-2.5 text-right font-mono text-xs flex items-center justify-end gap-1 ${devColor(getVal(m, 'desviacion'))}`}>
                {m.tiene_datos ? <>{getVal(m, 'desviacion') > 0 ? <TrendingUp className="w-3 h-3" /> : getVal(m, 'desviacion') < 0 ? <TrendingDown className="w-3 h-3" /> : null}{fm(getVal(m, 'desviacion'))}</> : '—'}
              </div>
              <div className={`col-span-2 px-2 py-2.5 text-right font-mono text-xs ${devColor(m.acum_desviacion)}`}>
                {m.tiene_datos ? fm(m.acum_desviacion) : '—'}
              </div>
              <div className="col-span-2 px-2 py-2.5 text-center">
                {m.tiene_datos ? (
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium ${
                    Math.abs(getVal(m, 'desviacion')) < getVal(m, 'planeado') * 0.05 ? 'bg-emerald-100 text-emerald-700' :
                    getVal(m, 'desviacion') > 0 ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
                  }`}>
                    {m.items_diligenciados}/{m.items_total} ítems
                  </span>
                ) : (
                  <span className="text-[10px] text-surface-300">Pendiente</span>
                )}
              </div>
            </div>
          ))}
          {/* Totals */}
          <div className="grid grid-cols-12 items-center bg-surface-100 font-bold border-t-2 border-surface-200">
            <div className="col-span-2 px-3 py-3 text-brand-800 text-sm">TOTAL</div>
            <div className="col-span-2 px-2 py-3 text-right text-blue-700 font-mono text-xs">{fm(totals.planeado)}</div>
            <div className="col-span-2 px-2 py-3 text-right text-purple-700 font-mono text-xs">{fm(totals.ejecutado)}</div>
            <div className={`col-span-2 px-2 py-3 text-right font-mono text-xs ${devColor(totals.desviacion)}`}>{fm(totals.desviacion)}</div>
            <div className={`col-span-2 px-2 py-3 text-right font-mono text-xs ${devColor(totals.desviacion)}`}>{totals.desviacion_pct.toFixed(1)}%</div>
            <div className="col-span-2"></div>
          </div>
        </div>
      )}

      {totals.desviacion > 0 && totals.desviacion_pct > 10 && (
        <div className="flex items-center gap-3 p-3 bg-red-50 border border-red-200 rounded-xl">
          <AlertTriangle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <div>
            <p className="text-sm font-medium text-red-800">Alerta de Sobrecosto ({totals.desviacion_pct.toFixed(1)}%)</p>
            <p className="text-xs text-red-600">Ingrese al detalle de cada mes para identificar los ítems con mayor desviación.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// MONTH DETAIL VIEW (Item-level)
// ═══════════════════════════════════════════
function MonthDetail({ projectId, mes, perms, onBack, toast, setToast }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(false);
  const [editItems, setEditItems] = useState({});
  const [saving, setSaving] = useState(false);
  const [collapsed, setCollapsed] = useState({});
  const [showExtraForm, setShowExtraForm] = useState(false);
  const [extraLabel, setExtraLabel] = useState('');
  const [extraValor, setExtraValor] = useState('');
  const [extraNotas, setExtraNotas] = useState('');

  useEffect(() => { loadDetail(); }, [projectId, mes]);

  const loadDetail = async () => {
    try { const r = await budgetAPI.trackingMonth(projectId, mes); setDetail(r.data.data || r.data); }
    catch (e) { console.error(e); }
    finally { setLoading(false); }
  };

  const startEditing = () => {
    const vals = {};
    for (const cat of (detail.categories || [])) {
      for (const item of (cat.items || [])) {
        vals[`${item.fuente}-${item.id}`] = {
          ...item,
          ejecutado: item.ejecutado !== null ? item.ejecutado : item.planeado,
          notas: item.notas || '',
        };
      }
    }
    setEditItems(vals);
    setEditing(true);
  };

  const updateItem = (key, field, value) => {
    setEditItems(prev => ({ ...prev, [key]: { ...prev[key], [field]: value } }));
  };

  const saveAll = async () => {
    setSaving(true);
    try {
      const items = Object.values(editItems).map(it => ({
        fuente: it.fuente, id: it.id, label: it.label,
        planeado: it.planeado, ejecutado: parseFloat(it.ejecutado) || 0,
        notas: it.notas || '',
      }));
      await budgetAPI.trackingSave(projectId, mes, { items });
      setToast({ msg: `${detail.label}: ${items.length} ítems guardados`, type: 'success' });
      setTimeout(() => setToast(null), 3000);
      setEditing(false);
      loadDetail();
    } catch (e) {
      setToast({ msg: 'Error guardando', type: 'error' });
      setTimeout(() => setToast(null), 3000);
    }
    finally { setSaving(false); }
  };

  const addExtra = async () => {
    if (!extraLabel || !extraValor) return;
    try {
      await budgetAPI.trackingAddExtra(projectId, mes, { label: extraLabel, valor: parseFloat(extraValor), notas: extraNotas });
      setToast({ msg: 'Gasto adicional registrado', type: 'success' });
      setTimeout(() => setToast(null), 3000);
      setShowExtraForm(false); setExtraLabel(''); setExtraValor(''); setExtraNotas('');
      loadDetail();
    } catch (e) { setToast({ msg: 'Error agregando gasto', type: 'error' }); setTimeout(() => setToast(null), 3000); }
  };

  const deleteExtra = async (id) => {
    if (!window.confirm('¿Eliminar este gasto adicional?')) return;
    try {
      await budgetAPI.trackingDeleteExtra(projectId, id);
      setToast({ msg: 'Gasto eliminado', type: 'success' });
      setTimeout(() => setToast(null), 3000);
      loadDetail();
    } catch (e) { setToast({ msg: 'Error eliminando', type: 'error' }); setTimeout(() => setToast(null), 3000); }
  };

  if (loading) return <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>;
  if (!detail || !detail.categories) return <p className="text-sm text-surface-400">Error cargando detalle</p>;

  const canEdit = perms.canEdit;
  const totalPlan = (detail.categories || []).reduce((s, c) => s + (c.items || []).reduce((s2, i) => s2 + i.planeado, 0), 0);
  const totalExec = (detail.categories || []).reduce((s, c) => s + (c.items || []).reduce((s2, i) => s2 + (i.ejecutado || 0), 0), 0);
  const totalDev = totalExec - totalPlan;

  return (
    <div className="space-y-4">
      {toast && <div className={`fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>{toast.msg}</div>}

      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button onClick={onBack} className="w-8 h-8 rounded-lg bg-surface-100 hover:bg-surface-200 flex items-center justify-center transition-colors">
            <ArrowLeft className="w-4 h-4 text-surface-600" />
          </button>
          <div>
            <h3 className="font-display font-bold text-brand-900 text-lg">{detail.label}</h3>
            <p className="text-xs text-surface-400">Seguimiento ítem por ítem — Mes {mes}</p>
          </div>
        </div>
        <div className="flex gap-2">
          {canEdit && !editing && (
            <button onClick={startEditing} className="btn-primary text-xs flex items-center gap-1.5">
              <BarChart3 className="w-3.5 h-3.5" /> Registrar Ejecutado
            </button>
          )}
          {editing && (
            <>
              <button onClick={() => setEditing(false)} className="btn-ghost text-xs">Cancelar</button>
              <button onClick={saveAll} disabled={saving} className="btn-primary text-xs flex items-center gap-1.5">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />} Guardar Todo
              </button>
            </>
          )}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-3 gap-3">
        <div className="p-3 bg-blue-50 rounded-lg border border-blue-100 text-center">
          <p className="text-[10px] text-blue-600 font-semibold uppercase">Planeado</p>
          <p className="text-lg font-display font-bold text-blue-700">{fm(totalPlan)}</p>
        </div>
        <div className="p-3 bg-purple-50 rounded-lg border border-purple-100 text-center">
          <p className="text-[10px] text-purple-600 font-semibold uppercase">Ejecutado</p>
          <p className="text-lg font-display font-bold text-purple-700">{fm(totalExec)}</p>
        </div>
        <div className={`p-3 rounded-lg border text-center ${devBg(totalDev)} ${totalDev > 0 ? 'border-red-200' : totalDev < 0 ? 'border-emerald-200' : 'border-surface-100'}`}>
          <p className={`text-[10px] font-semibold uppercase ${devColor(totalDev)}`}>
            {totalDev > 0 ? 'Sobrecosto' : totalDev < 0 ? 'Ahorro' : 'Desviación'}
          </p>
          <p className={`text-lg font-display font-bold ${devColor(totalDev)}`}>{fm(totalDev)}</p>
        </div>
      </div>

      {/* Categories with items */}
      {(detail.categories || []).map(cat => {
        const isCollapsed = collapsed[cat.key];
        const catPlan = cat.items.reduce((s, i) => s + i.planeado, 0);
        const catExec = cat.items.reduce((s, i) => s + (i.ejecutado || 0), 0);
        const catDev = catExec - catPlan;
        const color = CAT_COLORS[cat.key] || 'slate';

        return (
          <div key={cat.key} className="bg-white rounded-xl border border-surface-100 overflow-hidden">
            {/* Category header */}
            <div
              className={`flex items-center justify-between px-4 py-3 bg-${color}-50 border-b border-${color}-100 cursor-pointer`}
              onClick={() => setCollapsed(p => ({ ...p, [cat.key]: !p[cat.key] }))}
            >
              <div className="flex items-center gap-2">
                {isCollapsed ? <ChevronRight className="w-4 h-4 text-surface-400" /> : <ChevronDown className="w-4 h-4 text-surface-400" />}
                <span className="font-bold text-sm text-surface-800">{cat.label}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-white/60 text-surface-500">{cat.items.length} ítems</span>
              </div>
              <div className="flex items-center gap-4 text-xs">
                <span className="text-blue-600">Plan: {fm(catPlan)}</span>
                <span className="text-purple-600">Ejec: {fm(catExec)}</span>
                <span className={`font-bold ${devColor(catDev)}`}>
                  {catDev > 0 ? '+' : ''}{fm(catDev)}
                </span>
              </div>
            </div>

            {!isCollapsed && (
              <>
                {/* Items header */}
                <div className="grid grid-cols-12 text-[10px] font-semibold uppercase text-surface-400 px-4 py-1.5 border-b bg-surface-50/50">
                  <div className="col-span-4">Ítem</div>
                  <div className="col-span-2 text-right">Planeado</div>
                  <div className="col-span-2 text-right">Ejecutado</div>
                  <div className="col-span-2 text-right">Desviación</div>
                  <div className="col-span-2">Notas</div>
                </div>

                {/* Items */}
                {cat.items.map((item, idx) => {
                  const key = `${item.fuente}-${item.id}`;
                  const editItem = editItems[key];

                  return (
                    <div key={key} className={`grid grid-cols-12 items-center px-4 py-2 border-b border-surface-50 text-sm ${idx % 2 === 1 ? 'bg-surface-50/30' : ''}`}>
                      <div className="col-span-4 text-surface-700 text-xs pr-2 truncate" title={item.label}>
                        {item.label}
                      </div>
                      <div className="col-span-2 text-right text-blue-600 font-mono text-xs">{fm(item.planeado)}</div>

                      {editing ? (
                        <>
                          <div className="col-span-2 px-1">
                            <input type="number" value={editItem?.ejecutado ?? ''} onChange={e => updateItem(key, 'ejecutado', e.target.value)}
                              className="w-full text-right text-xs border border-purple-200 rounded px-2 py-1 focus:border-purple-400 focus:ring-1 focus:ring-purple-200 outline-none font-mono" />
                          </div>
                          <div className={`col-span-2 text-right font-mono text-xs ${devColor((parseFloat(editItem?.ejecutado) || 0) - item.planeado)}`}>
                            {fm((parseFloat(editItem?.ejecutado) || 0) - item.planeado)}
                          </div>
                          <div className="col-span-2 px-1">
                            <input value={editItem?.notas ?? ''} onChange={e => updateItem(key, 'notas', e.target.value)}
                              className="w-full text-xs border border-surface-200 rounded px-2 py-1 focus:border-brand-300 outline-none" placeholder="Nota..." />
                          </div>
                        </>
                      ) : (
                        <>
                          <div className="col-span-2 text-right font-mono text-xs">
                            {item.ejecutado !== null ? <span className="text-purple-600">{fm(item.ejecutado)}</span> : <span className="text-surface-300">—</span>}
                          </div>
                          <div className={`col-span-2 text-right font-mono text-xs flex items-center justify-end gap-1 ${devColor(item.desviacion)}`}>
                            {item.desviacion !== null ? (
                              <>{item.desviacion > 0 ? <TrendingUp className="w-3 h-3" /> : item.desviacion < -1 ? <TrendingDown className="w-3 h-3" /> : null}{fm(item.desviacion)}</>
                            ) : '—'}
                          </div>
                          <div className="col-span-2 text-xs text-surface-400 truncate flex items-center gap-1" title={item.notas}>
                            {item.notas || ''}
                            {item.fuente === 'extra' && canEdit && !editing && (
                              <button onClick={() => deleteExtra(item.id)} className="ml-auto w-5 h-5 rounded hover:bg-red-50 flex items-center justify-center flex-shrink-0">
                                <Trash2 className="w-3 h-3 text-red-400" />
                              </button>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  );
                })}

                {/* Category total */}
                <div className="grid grid-cols-12 items-center px-4 py-2 bg-surface-100 font-bold text-xs">
                  <div className="col-span-4 text-surface-700">Subtotal {cat.label}</div>
                  <div className="col-span-2 text-right text-blue-700 font-mono">{fm(catPlan)}</div>
                  <div className="col-span-2 text-right text-purple-700 font-mono">{fm(catExec)}</div>
                  <div className={`col-span-2 text-right font-mono ${devColor(catDev)}`}>{fm(catDev)}</div>
                  <div className="col-span-2"></div>
                </div>
              </>
            )}
          </div>
        );
      })}

      {/* Total */}
      <div className="bg-surface-800 text-white rounded-xl p-4 flex items-center justify-between">
        <span className="font-bold text-sm">TOTAL MES {mes}</span>
        <div className="flex items-center gap-6 text-xs">
          <span>Planeado: <span className="font-mono font-bold">{fm(totalPlan)}</span></span>
          <span>Ejecutado: <span className="font-mono font-bold">{fm(totalExec)}</span></span>
          <span className={totalDev > 0 ? 'text-red-300' : totalDev < 0 ? 'text-emerald-300' : ''}>
            Desviación: <span className="font-mono font-bold">{fm(totalDev)}</span>
          </span>
        </div>
      </div>

      {/* Extra Expenses Section */}
      {canEdit && (
        <div className="space-y-2">
          {!showExtraForm ? (
            <button onClick={() => setShowExtraForm(true)}
              className="btn-ghost text-xs flex items-center gap-1.5 text-amber-600 hover:text-amber-700">
              <Plus className="w-3.5 h-3.5" /> Agregar gasto adicional (no presupuestado)
            </button>
          ) : (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 space-y-3 animate-slide-up">
              <div className="flex items-center justify-between">
                <h4 className="font-bold text-sm text-amber-800">Nuevo Gasto Adicional</h4>
                <button onClick={() => setShowExtraForm(false)}><X className="w-4 h-4 text-surface-400" /></button>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-[10px] font-medium text-amber-700 mb-1">Concepto *</label>
                  <input value={extraLabel} onChange={e => setExtraLabel(e.target.value)}
                    placeholder="Ej: Arrendamiento adicional" className="input-field text-xs" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-amber-700 mb-1">Valor ejecutado *</label>
                  <input type="number" value={extraValor} onChange={e => setExtraValor(e.target.value)}
                    placeholder="0" className="input-field text-xs font-mono" />
                </div>
                <div>
                  <label className="block text-[10px] font-medium text-amber-700 mb-1">Notas</label>
                  <input value={extraNotas} onChange={e => setExtraNotas(e.target.value)}
                    placeholder="Justificación..." className="input-field text-xs" />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button onClick={() => setShowExtraForm(false)} className="btn-ghost text-xs">Cancelar</button>
                <button onClick={addExtra} disabled={!extraLabel || !extraValor}
                  className="bg-amber-600 text-white px-3 py-1.5 rounded-lg text-xs font-medium hover:bg-amber-700 disabled:opacity-50">
                  <Plus className="w-3 h-3 inline mr-1" />Agregar
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
