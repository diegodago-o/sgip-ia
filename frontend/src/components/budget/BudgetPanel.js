import React, { useState, useEffect, useCallback } from 'react';
import { budgetAPI, exportsAPI } from '../../services/api';
import {
  Plus, Trash2, Edit2, Save, Loader2, X, DollarSign, Users, Briefcase,
  Building, Car, Settings, AlertCircle, CheckCircle2, BarChart3, ChevronDown, Download, RefreshCw,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts';

function fm(v) { return v != null ? new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v) : '$0'; }

const EXP_CATS = [
  { key:'arriendo_equipos', label:'Arriendo y Equipos', icon:'🏢' },
  { key:'gastos_legales', label:'Gastos Legales y Seguros', icon:'⚖️' },
  { key:'servicios_publicos', label:'Servicios Públicos', icon:'💡' },
  { key:'gastos_viaje', label:'Gastos de Viaje', icon:'✈️' },
  { key:'activos_fijos', label:'Activos Fijos', icon:'🖥️' },
  { key:'otros', label:'Otros Gastos', icon:'📦' },
];
const EXP_CAT_MAP = Object.fromEntries(EXP_CATS.map(c=>[c.key,c]));

const ARL_LEVELS = [{v:'I',l:'I - 0.522%',p:0.522},{v:'II',l:'II - 1.044%',p:1.044},{v:'III',l:'III - 2.436%',p:2.436},{v:'IV',l:'IV - 4.350%',p:4.350},{v:'V',l:'V - 6.960%',p:6.960}];

const SUB_TABS = [
  { id:'resultado', label:'Estado de Resultados', icon: BarChart3 },
  { id:'ingresos', label:'Ingresos', icon: DollarSign },
  { id:'payroll', label:'Nómina', icon: Users },
  { id:'contractors', label:'Honorarios', icon: Briefcase },
  { id:'expenses', label:'Gastos Oper.', icon: Building },
  { id:'puc', label:'Cuentas PUC', icon: Settings },
  { id:'monthly', label:'Mensual', icon: BarChart3 },
];

// ═══ Reusable inline editor ═══
function InlineField({ value, onChange, type='text', placeholder='', className='' }) {
  return <input type={type} value={value ?? ''} onChange={e=>onChange(e.target.value)} placeholder={placeholder}
    className={`px-2 py-1 text-sm border border-surface-200 rounded bg-white focus:border-brand-400 focus:ring-1 focus:ring-brand-200 ${className}`} />;
}

// ═══ INCOME TAB ═══
function IncomeTab({ projectId, onUpdate }) {
  const [schedule, setSchedule] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showGenerate, setShowGenerate] = useState(false);
  const [genType, setGenType] = useState('mensual');
  const [genVal, setGenVal] = useState('');
  const [genAplicaIva, setGenAplicaIva] = useState(true);
  const [genRetefuente, setGenRetefuente] = useState('');
  const [genReteica, setGenReteica] = useState('');
  const [genReteiva, setGenReteiva] = useState('');
  const [genGmf, setGenGmf] = useState('');
  const [addingSched, setAddingSched] = useState(false);
  const [newSched, setNewSched] = useState({ tipo_pago:'hito', mes:'', descripcion:'', valor_sin_iva:'', aplica_iva: true, retefuente_pct:'', reteica_pct:'', reteiva_pct:'', gmf_pct:'' });
  const [editSchedId, setEditSchedId] = useState(null);
  const [editSchedData, setEditSchedData] = useState({});

  const load = useCallback(async () => {
    try {
      const [sched] = await Promise.all([budgetAPI.incomeScheduleList(projectId)]);
      setSchedule(sched.data.data || []);
    } catch {} finally { setLoading(false); }
  }, [projectId]);
  useEffect(()=>{load();},[load]);

  const handleGenerate = async () => { if (!genVal) return; try { await budgetAPI.incomeScheduleGenerate(projectId, { tipo_pago: genType, valor_mensual_sin_iva: parseFloat(genVal)||0, aplica_iva: genAplicaIva, retefuente_pct: parseFloat(genRetefuente)||0, reteica_pct: parseFloat(genReteica)||0, reteiva_pct: parseFloat(genReteiva)||0, gmf_pct: parseFloat(genGmf)||0 }); setShowGenerate(false); load(); } catch(e) { alert(e.response?.data?.error||'Error'); } };
  const handleAddSched = async () => { if (!newSched.valor_sin_iva) return; try { await budgetAPI.incomeScheduleAdd(projectId, newSched); setNewSched({ tipo_pago:'hito', mes:'', descripcion:'', valor_sin_iva:'' }); setAddingSched(false); load(); } catch(e) { alert(e.response?.data?.error||'Error'); } };
  const handleSaveSched = async (id) => { try { await budgetAPI.incomeScheduleUpdate(projectId, id, { ...editSchedData, valor_sin_iva: parseFloat(editSchedData.valor_sin_iva)||0, aplica_iva: editSchedData.aplica_iva !== false }); setEditSchedId(null); load(); } catch {} };
  const handleDeleteSched = async (id) => { await budgetAPI.incomeScheduleDelete(projectId, id); load(); };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-500" /></div>;

  const schedTotal = schedule.reduce((s,r)=>s+parseFloat(r.valor_sin_iva||0),0);
  const schedIva = schedule.reduce((s,r)=>s+parseFloat(r.valor_iva||0),0);

  return (
    <div className="space-y-6">
      {/* Flujo de Ingresos */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <div>
            <h4 className="text-sm font-bold text-brand-900">Flujo de Ingresos (Forma de Pago)</h4>
            <p className="text-xs text-surface-400">Defina cómo se recibirán los pagos durante la ejecución. El IVA (19%) es opcional por pago.</p>
          </div>
          <div className="flex gap-2">
            <button onClick={()=>setShowGenerate(!showGenerate)} className="text-xs px-2 py-1 rounded bg-blue-100 text-blue-700 hover:bg-blue-200 flex items-center gap-1"><Settings className="w-3 h-3"/> Generar flujo</button>
            <button onClick={()=>setAddingSched(!addingSched)} className="text-xs px-2 py-1 rounded bg-emerald-100 text-emerald-700 hover:bg-emerald-200 flex items-center gap-1"><Plus className="w-3 h-3"/> Agregar pago</button>
          </div>
        </div>

        {/* Generate form */}
        {showGenerate && (
          <div className="bg-blue-50 rounded-lg p-4 mb-3 space-y-3 border border-blue-200">
            <p className="text-xs font-bold text-blue-800">Generar flujo de ingresos</p>
            <div className="flex items-end gap-3 flex-wrap">
              <div>
                <label className="text-[10px] text-blue-700 font-semibold block mb-1">Tipo de pago</label>
                <select value={genType} onChange={e=>setGenType(e.target.value)} className="input-field text-xs">
                  <option value="mensual">Mensual (mismo valor cada mes)</option>
                  <option value="unico">Pago único al final</option>
                </select>
              </div>
              <div>
                <label className="text-[10px] text-blue-700 font-semibold block mb-1">{genType==='mensual' ? 'Valor mensual sin IVA' : 'Valor total sin IVA'}</label>
                <input type="number" value={genVal} onChange={e=>setGenVal(e.target.value)} className="input-field text-xs w-40 text-right" placeholder="0"/>
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-blue-700 font-semibold">Aplica IVA (19%)</label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input type="checkbox" checked={genAplicaIva} onChange={e=>setGenAplicaIva(e.target.checked)} className="w-4 h-4 accent-blue-600 rounded"/>
                  <span className="text-xs text-blue-800">{genAplicaIva ? 'Sí' : 'No'}</span>
                </label>
              </div>
            </div>
            {/* Tax rates */}
            <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
              <p className="text-[10px] font-bold text-amber-800 mb-2">Tasas de retención (se guardan en cada pago del flujo)</p>
              <div className="grid grid-cols-4 gap-2">
                <div>
                  <label className="text-[10px] text-amber-700 font-semibold block mb-1">RETEFUENTE %</label>
                  <input type="number" min="0" max="100" step="0.01" value={genRetefuente} onChange={e=>setGenRetefuente(e.target.value)} className="input-field text-xs text-right" placeholder="3.5"/>
                </div>
                <div>
                  <label className="text-[10px] text-amber-700 font-semibold block mb-1">RETEICA %</label>
                  <input type="number" min="0" max="100" step="0.001" value={genReteica} onChange={e=>setGenReteica(e.target.value)} className="input-field text-xs text-right" placeholder="0.8"/>
                </div>
                <div>
                  <label className="text-[10px] text-amber-700 font-semibold block mb-1">RETEIVA %</label>
                  <input type="number" min="0" max="100" step="0.01" value={genReteiva} onChange={e=>setGenReteiva(e.target.value)} className="input-field text-xs text-right" placeholder="15"/>
                  <p className="text-[9px] text-amber-500 mt-0.5">% del IVA</p>
                </div>
                <div>
                  <label className="text-[10px] text-amber-700 font-semibold block mb-1">GMF ‰</label>
                  <input type="number" min="0" max="1" step="0.001" value={genGmf} onChange={e=>setGenGmf(e.target.value)} className="input-field text-xs text-right" placeholder="0.4"/>
                  <p className="text-[9px] text-amber-500 mt-0.5">% del bruto</p>
                </div>
              </div>
            </div>
            {parseFloat(genVal) > 0 && (
              <div className="text-[10px] text-blue-700 font-mono bg-blue-100 rounded px-2 py-1">
                {genAplicaIva
                  ? <>Sin IVA: <b>{(parseFloat(genVal)||0).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0})}</b> → Con IVA: <b>{((parseFloat(genVal)||0)*1.19).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0})}</b></>
                  : <>Total: <b>{(parseFloat(genVal)||0).toLocaleString('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0})}</b> (sin IVA)</>
                }
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={handleGenerate} className="btn-primary text-xs">Generar</button>
              <button onClick={()=>setShowGenerate(false)} className="text-xs text-surface-400 hover:text-surface-600">Cancelar</button>
            </div>
          </div>
        )}

        {/* Add payment — modal */}
        {addingSched && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={()=>setAddingSched(false)}>
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e=>e.stopPropagation()}>
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100 bg-emerald-50">
                <div className="flex items-center gap-2">
                  <div className="w-7 h-7 rounded-lg bg-emerald-100 flex items-center justify-center">
                    <Plus className="w-4 h-4 text-emerald-600"/>
                  </div>
                  <h3 className="text-sm font-bold text-emerald-900">Agregar pago al flujo</h3>
                </div>
                <button onClick={()=>setAddingSched(false)} className="text-surface-400 hover:text-surface-600 transition-colors"><X className="w-4 h-4"/></button>
              </div>
              {/* Body */}
              <div className="px-6 py-5 space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-brand-800 mb-1.5">Tipo de pago</label>
                    <select value={newSched.tipo_pago} onChange={e=>setNewSched(d=>({...d,tipo_pago:e.target.value}))} className="input-field text-sm w-full">
                      <option value="mensual">Mensual</option>
                      <option value="hito">Hito / Entregable</option>
                      <option value="unico">Pago único</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-brand-800 mb-1.5">Mes</label>
                    <input type="number" value={newSched.mes} onChange={e=>setNewSched(d=>({...d,mes:e.target.value}))} className="input-field text-sm w-full text-center" min="1" placeholder="1"/>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-brand-800 mb-1.5">Descripción</label>
                  <input value={newSched.descripcion} onChange={e=>setNewSched(d=>({...d,descripcion:e.target.value}))} className="input-field text-sm w-full" placeholder="Ej: Entrega fase 1 — Hito de inicio"/>
                </div>
                <div>
                  <div className="flex items-center justify-between mb-1.5">
                    <label className="text-xs font-semibold text-brand-800">Valor sin IVA</label>
                    <label className="flex items-center gap-1.5 cursor-pointer select-none">
                      <input type="checkbox" checked={newSched.aplica_iva} onChange={e=>setNewSched(d=>({...d,aplica_iva:e.target.checked}))} className="w-3.5 h-3.5 accent-emerald-600 rounded"/>
                      <span className="text-[11px] text-surface-500 font-medium">Aplica IVA 19%</span>
                    </label>
                  </div>
                  <input type="number" value={newSched.valor_sin_iva} onChange={e=>setNewSched(d=>({...d,valor_sin_iva:e.target.value}))} className="input-field text-sm w-full text-right font-mono" step="1" placeholder="0"/>
                  {parseFloat(newSched.valor_sin_iva) > 0 && (
                    <div className="mt-2 flex gap-3 text-xs text-surface-500 justify-end font-mono">
                      {newSched.aplica_iva ? (
                        <>
                          <span>IVA 19%: <b className="text-surface-700">{fm((parseFloat(newSched.valor_sin_iva)||0)*0.19)}</b></span>
                          <span className="text-brand-600 font-semibold">Con IVA: {fm((parseFloat(newSched.valor_sin_iva)||0)*1.19)}</span>
                        </>
                      ) : (
                        <span className="text-amber-600 font-medium">Sin IVA — Total: {fm(parseFloat(newSched.valor_sin_iva)||0)}</span>
                      )}
                    </div>
                  )}
                </div>
              </div>
              {/* Tax rates */}
              <div className="bg-amber-50 rounded-lg p-3 border border-amber-200">
                <p className="text-[10px] font-bold text-amber-800 mb-2">Tasas de retención</p>
                <div className="grid grid-cols-4 gap-2">
                  <div><label className="text-[10px] text-amber-700 font-semibold block mb-1">RETEFUENTE %</label><input type="number" min="0" max="100" step="0.01" value={newSched.retefuente_pct} onChange={e=>setNewSched(d=>({...d,retefuente_pct:e.target.value}))} className="input-field text-xs text-right" placeholder="3.5"/></div>
                  <div><label className="text-[10px] text-amber-700 font-semibold block mb-1">RETEICA %</label><input type="number" min="0" max="100" step="0.001" value={newSched.reteica_pct} onChange={e=>setNewSched(d=>({...d,reteica_pct:e.target.value}))} className="input-field text-xs text-right" placeholder="0.8"/></div>
                  <div><label className="text-[10px] text-amber-700 font-semibold block mb-1">RETEIVA %</label><input type="number" min="0" max="100" step="0.01" value={newSched.reteiva_pct} onChange={e=>setNewSched(d=>({...d,reteiva_pct:e.target.value}))} className="input-field text-xs text-right" placeholder="15"/><p className="text-[9px] text-amber-500 mt-0.5">% del IVA</p></div>
                  <div><label className="text-[10px] text-amber-700 font-semibold block mb-1">GMF ‰</label><input type="number" min="0" max="1" step="0.001" value={newSched.gmf_pct} onChange={e=>setNewSched(d=>({...d,gmf_pct:e.target.value}))} className="input-field text-xs text-right" placeholder="0.4"/><p className="text-[9px] text-amber-500 mt-0.5">% del bruto</p></div>
                </div>
              </div>
              {/* Footer */}
              <div className="flex justify-end gap-3 px-6 py-4 border-t border-surface-100 bg-surface-50">
                <button onClick={()=>setAddingSched(false)} className="px-4 py-2 text-sm font-medium text-surface-600 hover:text-surface-800 bg-white hover:bg-surface-100 rounded-lg border border-surface-200 transition-colors">
                  Cancelar
                </button>
                <button onClick={handleAddSched} className="flex items-center gap-1.5 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors">
                  <Plus className="w-4 h-4"/> Agregar pago
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Schedule table */}
        {schedule.length > 0 ? (
          <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
            <table className="w-full text-sm">
              <thead><tr className="bg-surface-50 text-[10px] font-semibold text-surface-400 uppercase">
                <th className="px-3 py-2 text-left">Tipo</th><th className="px-3 py-2 text-center w-16">Mes</th><th className="px-3 py-2 text-left">Descripción</th>
                <th className="px-3 py-2 text-right">Sin IVA</th><th className="px-3 py-2 text-right">IVA</th><th className="px-3 py-2 text-right">Con IVA</th>
                <th className="px-3 py-2 text-right text-amber-500">RF%</th><th className="px-3 py-2 text-right text-amber-500">ICA%</th>
                <th className="px-3 py-2 text-center w-20">Estado</th><th className="w-12"></th>
              </tr></thead>
              <tbody>
                {schedule.map((s, idx) => editSchedId === s.id ? (
                  <tr key={s.id} className="border-y-2 border-brand-200">
                    <td colSpan={8} className="p-0">
                      <div className="bg-brand-50 px-5 py-4 space-y-3">
                        {/* Fila 1: Tipo · Mes · Descripción */}
                        <div className="grid grid-cols-8 gap-3">
                          <div className="col-span-2">
                            <label className="block text-[10px] font-semibold text-brand-600 uppercase tracking-wide mb-1">Tipo de pago</label>
                            <select value={editSchedData.tipo_pago} onChange={e=>setEditSchedData(d=>({...d,tipo_pago:e.target.value}))} className="input-field text-sm w-full">
                              <option value="mensual">Mensual</option>
                              <option value="hito">Hito / Entregable</option>
                              <option value="unico">Pago único</option>
                            </select>
                          </div>
                          <div className="col-span-1">
                            <label className="block text-[10px] font-semibold text-brand-600 uppercase tracking-wide mb-1">Mes</label>
                            <input type="number" value={editSchedData.mes||''} onChange={e=>setEditSchedData(d=>({...d,mes:e.target.value}))} className="input-field text-sm w-full text-center" min="1" placeholder="—"/>
                          </div>
                          <div className="col-span-5">
                            <label className="block text-[10px] font-semibold text-brand-600 uppercase tracking-wide mb-1">Descripción</label>
                            <input value={editSchedData.descripcion||''} onChange={e=>setEditSchedData(d=>({...d,descripcion:e.target.value}))} className="input-field text-sm w-full" placeholder="Ej: Pago mensual — Mes 1"/>
                          </div>
                        </div>
                        {/* Fila 2: Valores · Estado */}
                        <div className="grid grid-cols-4 gap-3">
                          <div>
                            <label className="block text-[10px] font-semibold text-brand-600 uppercase tracking-wide mb-1">Valor sin IVA</label>
                            <input type="number" value={editSchedData.valor_sin_iva} onChange={e=>setEditSchedData(d=>({...d,valor_sin_iva:e.target.value}))} className="input-field text-sm w-full text-right font-mono" step="1" placeholder="0"/>
                          </div>
                          <div>
                            <div className="flex items-center justify-between mb-1">
                              <label className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide">IVA</label>
                              <label className="flex items-center gap-1 cursor-pointer">
                                <input type="checkbox" checked={editSchedData.aplica_iva !== false} onChange={e=>setEditSchedData(d=>({...d,aplica_iva:e.target.checked}))} className="w-3 h-3 accent-brand-600"/>
                                <span className="text-[10px] text-surface-500">19%</span>
                              </label>
                            </div>
                            <div className="input-field text-sm w-full text-right font-mono bg-surface-50 text-surface-500 cursor-default select-none">
                              {editSchedData.aplica_iva !== false ? fm((parseFloat(editSchedData.valor_sin_iva)||0)*0.19) : fm(0)}
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-brand-600 uppercase tracking-wide mb-1">Con IVA</label>
                            <div className="input-field text-sm w-full text-right font-mono font-semibold text-brand-700 bg-brand-50 cursor-default select-none">
                              {editSchedData.aplica_iva !== false ? fm((parseFloat(editSchedData.valor_sin_iva)||0)*1.19) : fm(parseFloat(editSchedData.valor_sin_iva)||0)}
                            </div>
                          </div>
                          <div>
                            <label className="block text-[10px] font-semibold text-brand-600 uppercase tracking-wide mb-1">Estado</label>
                            <select value={editSchedData.estado} onChange={e=>setEditSchedData(d=>({...d,estado:e.target.value}))} className="input-field text-sm w-full">
                              <option value="pendiente">Pendiente</option>
                              <option value="facturado">Facturado</option>
                              <option value="pagado">Pagado</option>
                            </select>
                          </div>
                        </div>
                        {/* Fila 3: Tasas de retención */}
                        <div className="bg-amber-50 rounded-lg p-2 border border-amber-200">
                          <p className="text-[9px] font-bold text-amber-700 uppercase tracking-wide mb-2">Tasas de retención</p>
                          <div className="grid grid-cols-4 gap-2">
                            <div><label className="block text-[9px] text-amber-600 mb-0.5">RETEFUENTE %</label><input type="number" min="0" max="100" step="0.01" value={editSchedData.retefuente_pct||''} onChange={e=>setEditSchedData(d=>({...d,retefuente_pct:e.target.value}))} className="input-field text-xs text-right" placeholder="0"/></div>
                            <div><label className="block text-[9px] text-amber-600 mb-0.5">RETEICA %</label><input type="number" min="0" max="100" step="0.001" value={editSchedData.reteica_pct||''} onChange={e=>setEditSchedData(d=>({...d,reteica_pct:e.target.value}))} className="input-field text-xs text-right" placeholder="0"/></div>
                            <div><label className="block text-[9px] text-amber-600 mb-0.5">RETEIVA % <span className="text-amber-400">(del IVA)</span></label><input type="number" min="0" max="100" step="0.01" value={editSchedData.reteiva_pct||''} onChange={e=>setEditSchedData(d=>({...d,reteiva_pct:e.target.value}))} className="input-field text-xs text-right" placeholder="0"/></div>
                            <div><label className="block text-[9px] text-amber-600 mb-0.5">GMF ‰ <span className="text-amber-400">(del bruto)</span></label><input type="number" min="0" max="1" step="0.001" value={editSchedData.gmf_pct||''} onChange={e=>setEditSchedData(d=>({...d,gmf_pct:e.target.value}))} className="input-field text-xs text-right" placeholder="0"/></div>
                          </div>
                        </div>
                        {/* Fila 4: Botones alineados a la derecha */}
                        <div className="flex justify-end gap-2 pt-1">
                          <button onClick={()=>setEditSchedId(null)} className="px-4 py-2 text-xs font-medium text-surface-600 hover:text-surface-800 bg-white hover:bg-surface-50 rounded-lg border border-surface-200 transition-colors">
                            Cancelar
                          </button>
                          <button onClick={()=>handleSaveSched(s.id)} className="flex items-center gap-1.5 px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg shadow-sm transition-colors">
                            <Save className="w-3.5 h-3.5"/> Guardar
                          </button>
                        </div>
                      </div>
                    </td>
                  </tr>
                ) : (
                  <tr key={s.id} className={`group border-b border-surface-50 hover:bg-surface-50 cursor-pointer ${idx%2===1?'bg-surface-50/30':''}`}
                    onClick={()=>{setEditSchedId(s.id);setEditSchedData({tipo_pago:s.tipo_pago,mes:s.mes,descripcion:s.descripcion||'',valor_sin_iva:parseFloat(s.valor_sin_iva)||0,estado:s.estado||'pendiente',aplica_iva:parseFloat(s.valor_iva||0)>0,retefuente_pct:s.retefuente_pct||0,reteica_pct:s.reteica_pct||0,reteiva_pct:s.reteiva_pct||0,gmf_pct:s.gmf_pct||0});}}>
                    <td className="px-3 py-2"><span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${s.tipo_pago==='mensual'?'bg-blue-100 text-blue-700':s.tipo_pago==='hito'?'bg-amber-100 text-amber-700':'bg-purple-100 text-purple-700'}`}>{s.tipo_pago==='mensual'?'Mensual':s.tipo_pago==='hito'?'Hito':'Único'}</span></td>
                    <td className="px-3 py-2 text-center font-mono text-xs text-surface-600">{s.mes||'—'}</td>
                    <td className="px-3 py-2 text-surface-700 text-xs">{s.descripcion||`Pago mes ${s.mes}`}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs">{fm(s.valor_sin_iva)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs text-surface-400">{fm(s.valor_iva)}</td>
                    <td className="px-3 py-2 text-right font-mono text-xs font-semibold text-brand-700">{fm(s.valor_con_iva)}</td>
                    <td className="px-3 py-2 text-right font-mono text-[10px] text-amber-600">{parseFloat(s.retefuente_pct||0)>0?`${parseFloat(s.retefuente_pct)}%`:'—'}</td>
                    <td className="px-3 py-2 text-right font-mono text-[10px] text-amber-600">{parseFloat(s.reteica_pct||0)>0?`${parseFloat(s.reteica_pct)}%`:'—'}</td>
                    <td className="px-3 py-2 text-center">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded ${s.estado==='pagado'?'bg-emerald-100 text-emerald-700':s.estado==='facturado'?'bg-blue-100 text-blue-700':'bg-surface-100 text-surface-500'}`}>
                        {s.estado==='pagado'?'✅ Pagado':s.estado==='facturado'?'🔗 Facturado':'Pendiente'}
                      </span>
                    </td>
                    <td className="px-1" onClick={e=>e.stopPropagation()}><button onClick={()=>handleDeleteSched(s.id)} className="w-5 h-5 rounded hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3 text-red-400"/></button></td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="bg-surface-100 font-bold text-xs border-t-2 border-surface-200">
                <td colSpan={3} className="px-3 py-2 text-brand-800">TOTAL FLUJO ({schedule.length} pagos)</td>
                <td className="px-3 py-2 text-right font-mono">{fm(schedTotal)}</td>
                <td className="px-3 py-2 text-right font-mono text-surface-500">{fm(schedIva)}</td>
                <td className="px-3 py-2 text-right font-mono text-brand-700">{fm(schedTotal + schedIva)}</td>
                <td colSpan={4}></td>
              </tr></tfoot>
            </table>
          </div>
        ) : (
          <div className="text-center py-6 bg-surface-50 rounded-xl border border-dashed border-surface-200">
            <p className="text-sm text-surface-400 mb-2">No hay flujo de ingresos definido</p>
            <p className="text-xs text-surface-300">Use "Generar flujo" para crear pagos mensuales automáticos o "Agregar pago" para hitos individuales</p>
          </div>
        )}
      </div>
    </div>
  );
}

// ═══ PAYROLL TAB ═══
function PayrollTab({ projectId, projectMonths, onUpdate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => { try { const {data} = await budgetAPI.payrollList(projectId); setItems(data.data); } catch{} finally{setLoading(false);} }, [projectId]);
  useEffect(()=>{load();},[load]);

  const handleDelete = async(id)=>{ if(!window.confirm('¿Eliminar?'))return; await budgetAPI.payrollDelete(projectId,id); load(); onUpdate(); };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-500" /></div>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-surface-50">
            <th className="px-3 py-2 text-left text-xs font-semibold text-surface-400 uppercase">Cargo</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-surface-400 uppercase w-12">Cant.</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-surface-400 uppercase">Salario Base</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-surface-400 uppercase">Aux. Trans.</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-surface-400 uppercase">Mensual s/Prest.</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-surface-400 uppercase">Mensual c/Prest.</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-surface-400 uppercase">Meses</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-surface-400 uppercase">Total</th>
            <th className="w-16"></th>
          </tr></thead>
          <tbody>
            {items.map(item=>{
              const base = parseFloat(item.salario_base)||0;
              const aux = parseFloat(item.aux_transporte)||0;
              const sinPrest = base + aux;
              const conPrest = parseFloat(item.costo_mensual)||0;
              return (
              <tr key={item.id} className="group border-b border-surface-50 hover:bg-surface-50">
                <td className="px-3 py-2.5">
                  <p className="font-medium text-brand-900">{item.cargo}</p>
                  <p className="text-[10px] text-surface-400">Mes {item.mes_inicio} a {item.mes_fin||projectMonths} | Prestaciones: {((parseFloat(item.pct_prima)+parseFloat(item.pct_vacaciones)+parseFloat(item.pct_cesantias)+parseFloat(item.pct_int_cesantias)+parseFloat(item.pct_arl)+parseFloat(item.pct_pension)+parseFloat(item.pct_ccf)+parseFloat(item.pct_icbf)+parseFloat(item.pct_sena)+parseFloat(item.pct_salud))).toFixed(1)}%</p>
                </td>
                <td className="px-3 py-2.5 text-center">{item.cantidad}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">{fm(base)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs">{fm(aux)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs text-surface-600">{fm(sinPrest)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-brand-700">{fm(conPrest)}</td>
                <td className="px-3 py-2.5 text-center">{item.meses_vinculacion}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-brand-900">{fm(item.costo_total)}</td>
                <td className="px-2 flex gap-1">
                  <button onClick={()=>setModal(item)} className="w-6 h-6 rounded hover:bg-surface-100 flex items-center justify-center opacity-0 group-hover:opacity-100"><Edit2 className="w-3 h-3 text-surface-400"/></button>
                  <button onClick={()=>handleDelete(item.id)} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3 text-red-400"/></button>
                </td>
              </tr>
              );})}
            {items.length===0 && <tr><td colSpan={9} className="text-center py-6 text-surface-400 text-sm">Sin personal de nómina</td></tr>}
          </tbody>
          {items.length > 0 && (
          <tfoot><tr className="bg-surface-100 font-bold text-xs border-t-2 border-surface-200">
            <td className="px-3 py-2 text-brand-800">TOTALES ({items.length})</td>
            <td className="px-3 py-2 text-center">{items.reduce((s,i)=>s+(parseInt(i.cantidad)||1),0)}</td>
            <td colSpan={2}></td>
            <td className="px-3 py-2 text-right font-mono text-surface-700">{fm(items.reduce((s,i)=>s+((parseFloat(i.salario_base)||0)+(parseFloat(i.aux_transporte)||0))*(parseInt(i.cantidad)||1),0))}</td>
            <td className="px-3 py-2 text-right font-mono text-brand-700">{fm(items.reduce((s,i)=>s+(parseFloat(i.costo_mensual)||0)*(parseInt(i.cantidad)||1),0))}</td>
            <td></td>
            <td className="px-3 py-2 text-right font-mono text-brand-900">{fm(items.reduce((s,i)=>s+parseFloat(i.costo_total||0),0))}</td>
            <td></td>
          </tr></tfoot>
          )}
        </table>
      </div>
      <div className="p-3"><button onClick={()=>setModal('new')} className="btn-primary text-sm flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/> Agregar empleado</button></div>

      {modal && <PayrollModal entry={modal==='new'?null:modal} projectId={projectId} projectMonths={projectMonths} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();onUpdate();}} />}
    </div>
  );
}

function PayrollModal({ entry, projectId, projectMonths, onClose, onSaved }) {
  const isEdit = entry?.id;
  const [form, setForm] = useState({
    cargo: entry?.cargo||'', cantidad: entry?.cantidad||1, salario_base: entry?.salario_base||'', aux_transporte: entry?.aux_transporte||0,
    mes_inicio: entry?.mes_inicio||1, mes_fin: entry?.mes_fin||'',
    pct_prima:entry?.pct_prima??8.333, pct_vacaciones:entry?.pct_vacaciones??4.167, pct_cesantias:entry?.pct_cesantias??8.333,
    pct_int_cesantias:entry?.pct_int_cesantias??1.0, pct_arl:entry?.pct_arl??0.522, pct_pension:entry?.pct_pension??12.0,
    pct_ccf:entry?.pct_ccf??4.0, pct_icbf:entry?.pct_icbf??3.0, pct_sena:entry?.pct_sena??2.0, pct_salud:entry?.pct_salud??8.5,
  });
  const [saving, setSaving] = useState(false);
  const [showPrest, setShowPrest] = useState(false);
  const set = f => e => setForm(d=>({...d,[f]:e.target.value}));

  const handleSubmit = async(e)=>{ e.preventDefault(); setSaving(true);
    try { if(isEdit) await budgetAPI.payrollUpdate(projectId,entry.id,form); else await budgetAPI.payrollAdd(projectId,form); onSaved(); } catch{} finally{setSaving(false);}
  };

  const prestLabels = [['pct_prima','Prima'],['pct_vacaciones','Vacaciones'],['pct_cesantias','Cesantías'],['pct_int_cesantias','Int. Cesantías'],['pct_arl','ARL'],['pct_pension','Pensión'],['pct_ccf','CCF'],['pct_icbf','ICBF'],['pct_sena','SENA'],['pct_salud','Salud']];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900">{isEdit?'Editar':'Agregar'} Empleado Nómina</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-100 flex items-center justify-center"><X className="w-4 h-4 text-surface-400"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="block text-sm font-medium text-brand-800 mb-1">Cargo *</label><input value={form.cargo} onChange={set('cargo')} required className="input-field" placeholder="Director, Ingeniero..."/></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Cantidad</label><input type="number" value={form.cantidad} onChange={set('cantidad')} min="1" className="input-field"/></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Salario Base *</label><input type="number" value={form.salario_base} onChange={set('salario_base')} required className="input-field"/></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Aux. Transporte</label><input type="number" value={form.aux_transporte} onChange={set('aux_transporte')} className="input-field"/></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Mes inicio</label><input type="number" value={form.mes_inicio} onChange={set('mes_inicio')} min="1" max={projectMonths} className="input-field"/></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Mes fin <span className="text-surface-400 text-xs">(vacío = todo)</span></label><input type="number" value={form.mes_fin} onChange={set('mes_fin')} min="1" max={projectMonths} className="input-field" placeholder={projectMonths}/></div>
          </div>

          <div>
            <button type="button" onClick={()=>setShowPrest(!showPrest)} className="flex items-center gap-2 text-sm text-brand-600 font-medium">
              <ChevronDown className={`w-4 h-4 transition-transform ${showPrest?'rotate-180':''}`}/> Prestaciones sociales (%)
            </button>
            {showPrest && (
              <div className="grid grid-cols-2 gap-2 mt-3 p-3 bg-surface-50 rounded-lg animate-slide-up">
                {prestLabels.map(([key,label])=>(
                  <div key={key} className="flex items-center justify-between">
                    <label className="text-xs text-surface-500">{label}</label>
                    <input type="number" step="0.001" value={form[key]} onChange={set(key)} className="w-20 px-2 py-1 text-xs text-right border border-surface-200 rounded"/>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
              {saving?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>} {isEdit?'Guardar':'Agregar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══ CONTRACTORS TAB ═══
function ContractorsTab({ projectId, projectMonths, onUpdate }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);

  const load = useCallback(async()=>{try{const{data}=await budgetAPI.contractorsList(projectId);setItems(data.data);}catch{}finally{setLoading(false);}}, [projectId]);
  useEffect(()=>{load();},[load]);

  const handleDelete = async(id)=>{if(!window.confirm('¿Eliminar?'))return; await budgetAPI.contractorsDelete(projectId,id); load(); onUpdate();};
  const TC = {mensual:'Mensual',por_horas:'Por Horas',por_productos:'Por Productos'};

  if(loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-500"/></div>;

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead><tr className="bg-surface-50">
            <th className="px-3 py-2 text-left text-xs font-semibold text-surface-400 uppercase">Cargo</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-surface-400 uppercase w-12">Cant.</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-surface-400 uppercase">Tipo</th>
            <th className="px-3 py-2 text-left text-xs font-semibold text-surface-400 uppercase">ARL</th>
            <th className="px-3 py-2 text-center text-xs font-semibold text-surface-400 uppercase">Meses</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-surface-400 uppercase">Costo Mensual</th>
            <th className="px-3 py-2 text-right text-xs font-semibold text-surface-400 uppercase">Costo Total</th>
            <th className="w-16"></th>
          </tr></thead>
          <tbody>
            {items.map(item=>(
              <tr key={item.id} className="group border-b border-surface-50 hover:bg-surface-50">
                <td className="px-3 py-2.5"><p className="font-medium text-brand-900">{item.cargo}</p><p className="text-[10px] text-surface-400">Mes {item.mes_inicio} a {item.mes_fin||projectMonths}</p></td>
                <td className="px-3 py-2.5 text-center">{item.cantidad}</td>
                <td className="px-3 py-2.5 text-xs text-surface-500">{TC[item.tipo_contrato]||item.tipo_contrato}</td>
                <td className="px-3 py-2.5 text-xs text-surface-500">{item.arl_nivel} ({item.arl_pct}%)</td>
                <td className="px-3 py-2.5 text-center">{item.meses_vinculacion}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-brand-700">{fm(item.costo_mensual)}</td>
                <td className="px-3 py-2.5 text-right font-mono text-xs font-bold text-brand-900">{fm(item.costo_total)}</td>
                <td className="px-2 flex gap-1"><button onClick={()=>setModal(item)} className="w-6 h-6 rounded hover:bg-surface-100 flex items-center justify-center opacity-0 group-hover:opacity-100"><Edit2 className="w-3 h-3 text-surface-400"/></button><button onClick={()=>handleDelete(item.id)} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100"><Trash2 className="w-3 h-3 text-red-400"/></button></td>
              </tr>
            ))}
            {items.length===0 && <tr><td colSpan={8} className="text-center py-6 text-surface-400 text-sm">Sin personal por honorarios</td></tr>}
          </tbody>
          {items.length > 0 && (
          <tfoot><tr className="bg-surface-100 font-bold text-xs border-t-2 border-surface-200">
            <td className="px-3 py-2 text-brand-800">TOTALES ({items.length})</td>
            <td className="px-3 py-2 text-center">{items.reduce((s,i)=>s+(parseInt(i.cantidad)||1),0)}</td>
            <td colSpan={3}></td>
            <td className="px-3 py-2 text-right font-mono text-brand-700">{fm(items.reduce((s,i)=>s+(parseFloat(i.costo_mensual)||0)*(parseInt(i.cantidad)||1),0))}</td>
            <td className="px-3 py-2 text-right font-mono text-brand-900">{fm(items.reduce((s,i)=>s+(parseFloat(i.costo_total)||0),0))}</td>
            <td></td>
          </tr></tfoot>
          )}
        </table>
      </div>
      <div className="p-3"><button onClick={()=>setModal('new')} className="btn-primary text-sm flex items-center gap-1.5"><Plus className="w-3.5 h-3.5"/> Agregar contratista</button></div>

      {modal && <ContractorModal entry={modal==='new'?null:modal} projectId={projectId} projectMonths={projectMonths} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);load();onUpdate();}} />}
    </div>
  );
}

function ContractorModal({ entry, projectId, projectMonths, onClose, onSaved }) {
  const isEdit = entry?.id;
  const [form, setForm] = useState({
    cargo: entry?.cargo||'', cantidad: entry?.cantidad||1, tipo_contrato: entry?.tipo_contrato||'mensual',
    valor_mensual: entry?.valor_mensual||'', valor_hora: entry?.valor_hora||'', horas_mes: entry?.horas_mes||'',
    valor_producto: entry?.valor_producto||'', cantidad_productos: entry?.cantidad_productos||'',
    arl_nivel: entry?.arl_nivel||'I', mes_inicio: entry?.mes_inicio||1, mes_fin: entry?.mes_fin||'',
  });
  const [saving, setSaving] = useState(false);
  const set = f => e => setForm(d=>({...d,[f]:e.target.value}));

  const handleSubmit = async(e)=>{ e.preventDefault(); setSaving(true);
    try { if(isEdit) await budgetAPI.contractorsUpdate(projectId,entry.id,form); else await budgetAPI.contractorsAdd(projectId,form); onSaved(); } catch{} finally{setSaving(false);}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900">{isEdit?'Editar':'Agregar'} Contratista</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="col-span-2"><label className="block text-sm font-medium text-brand-800 mb-1">Cargo *</label><input value={form.cargo} onChange={set('cargo')} required className="input-field"/></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Cantidad</label><input type="number" value={form.cantidad} onChange={set('cantidad')} min="1" className="input-field"/></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Tipo de Contrato *</label>
              <select value={form.tipo_contrato} onChange={set('tipo_contrato')} className="input-field">
                <option value="mensual">Pago Mensual</option><option value="por_horas">Pago por Horas</option><option value="por_productos">Por Productos</option>
              </select>
            </div>
          </div>
          {form.tipo_contrato==='mensual' && <div><label className="block text-sm font-medium text-brand-800 mb-1">Valor Mensual</label><input type="number" value={form.valor_mensual} onChange={set('valor_mensual')} className="input-field"/></div>}
          {form.tipo_contrato==='por_horas' && <div className="grid grid-cols-2 gap-3"><div><label className="block text-sm font-medium text-brand-800 mb-1">Valor Hora</label><input type="number" value={form.valor_hora} onChange={set('valor_hora')} className="input-field"/></div><div><label className="block text-sm font-medium text-brand-800 mb-1">Horas/Mes</label><input type="number" value={form.horas_mes} onChange={set('horas_mes')} className="input-field"/></div></div>}
          {form.tipo_contrato==='por_productos' && <div className="grid grid-cols-2 gap-3"><div><label className="block text-sm font-medium text-brand-800 mb-1">Valor Producto</label><input type="number" value={form.valor_producto} onChange={set('valor_producto')} className="input-field"/></div><div><label className="block text-sm font-medium text-brand-800 mb-1">Cant. Productos</label><input type="number" value={form.cantidad_productos} onChange={set('cantidad_productos')} className="input-field"/></div></div>}
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-sm font-medium text-brand-800 mb-1">ARL Nivel</label><select value={form.arl_nivel} onChange={set('arl_nivel')} className="input-field">{ARL_LEVELS.map(a=><option key={a.v} value={a.v}>{a.l}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Mes inicio</label><input type="number" value={form.mes_inicio} onChange={set('mes_inicio')} min="1" max={projectMonths} className="input-field"/></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Mes fin</label><input type="number" value={form.mes_fin} onChange={set('mes_fin')} min="1" max={projectMonths} className="input-field" placeholder={projectMonths}/></div>
          </div>
          <div className="flex justify-end gap-3 pt-2"><button type="button" onClick={onClose} className="btn-ghost">Cancelar</button><button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">{saving?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>} {isEdit?'Guardar':'Agregar'}</button></div>
        </form>
      </div>
    </div>
  );
}

// ═══ MODAL DE GASTO ═══
function ExpenseModal({ projectId, projectMonths, category, item, onSave, onClose }) {
  const isEdit = !!item;
  const EMPTY = { label:'', cantidad:1, valor_unitario:'', mes_inicio:1, mes_fin:'' };
  const [form, setForm] = useState(isEdit ? {
    label: item.label, cantidad: item.cantidad,
    valor_unitario: item.valor_unitario, mes_inicio: item.mes_inicio, mes_fin: item.mes_fin||''
  } : EMPTY);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  const set = k => v => setForm(f => ({ ...f, [k]: v }));

  // Cálculo en tiempo real
  const cant    = parseFloat(form.cantidad) || 0;
  const vu      = parseFloat(form.valor_unitario) || 0;
  const mIni    = parseInt(form.mes_inicio) || 1;
  const mFin    = parseInt(form.mes_fin)    || projectMonths;
  const meses   = Math.max(0, mFin - mIni + 1);
  const vMensual = cant * vu;
  const vTotal   = vMensual * meses;

  const handleSubmit = async e => {
    e.preventDefault();
    if (!form.label.trim()) { setErr('El concepto es obligatorio'); return; }
    setSaving(true);
    try {
      const payload = { ...form, category, cantidad: cant, valor_unitario: vu };
      if (isEdit) await budgetAPI.expensesUpdate(projectId, item.id, payload);
      else        await budgetAPI.expensesAdd(projectId, payload);
      onSave();
    } catch { setErr('Error al guardar'); }
    finally   { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100">
          <div>
            <h3 className="text-sm font-semibold text-brand-900">{isEdit ? 'Editar gasto' : 'Agregar gasto'}</h3>
            <p className="text-xs text-surface-400 mt-0.5">{category}</p>
          </div>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-100 flex items-center justify-center">
            <X className="w-4 h-4 text-surface-400"/>
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {err && <p className="text-xs text-red-600 bg-red-50 rounded-lg px-3 py-2">{err}</p>}

          {/* Concepto */}
          <div>
            <label className="block text-xs font-semibold text-brand-700 mb-1.5 uppercase tracking-wide">Concepto *</label>
            <input
              autoFocus
              value={form.label}
              onChange={e => set('label')(e.target.value)}
              placeholder="Ej: Licencias Microsoft 365, Arriendo oficina..."
              className="w-full px-3 py-2.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 placeholder-surface-300"
            />
          </div>

          {/* Cantidad + Valor unitario */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-brand-700 mb-1.5 uppercase tracking-wide">Cantidad</label>
              <input
                type="number" min="0" step="any"
                value={form.cantidad}
                onChange={e => set('cantidad')(e.target.value)}
                className="w-full px-3 py-2.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 text-right font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-700 mb-1.5 uppercase tracking-wide">Valor unitario</label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-surface-400 text-xs font-mono">$</span>
                <input
                  type="number" min="0" step="any"
                  value={form.valor_unitario}
                  onChange={e => set('valor_unitario')(e.target.value)}
                  placeholder="0"
                  className="w-full pl-6 pr-3 py-2.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 text-right font-mono"
                />
              </div>
            </div>
          </div>

          {/* Meses */}
          <div>
            <label className="block text-xs font-semibold text-brand-700 mb-1.5 uppercase tracking-wide">
              Período de aplicación
              <span className="ml-2 text-[10px] normal-case font-normal text-surface-400">(proyecto: {projectMonths} meses)</span>
            </label>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] text-surface-400 mb-1">Mes inicio</label>
                <input
                  type="number" min="1" max={projectMonths}
                  value={form.mes_inicio}
                  onChange={e => set('mes_inicio')(e.target.value)}
                  className="w-full px-3 py-2.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 text-center font-mono"
                />
              </div>
              <div>
                <label className="block text-[10px] text-surface-400 mb-1">Mes fin <span className="text-surface-300">(vacío = último mes)</span></label>
                <input
                  type="number" min="1" max={projectMonths}
                  value={form.mes_fin}
                  onChange={e => set('mes_fin')(e.target.value)}
                  placeholder={String(projectMonths)}
                  className="w-full px-3 py-2.5 text-sm border border-surface-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-brand-300 focus:border-brand-400 text-center font-mono"
                />
              </div>
            </div>
          </div>

          {/* Preview de cálculo */}
          {(cant > 0 && vu > 0) && (
            <div className="bg-brand-50 rounded-xl p-4 grid grid-cols-3 gap-3 text-center">
              <div>
                <p className="text-[10px] text-brand-400 uppercase tracking-wide mb-1">Meses activo</p>
                <p className="text-base font-bold font-mono text-brand-700">{meses}</p>
              </div>
              <div>
                <p className="text-[10px] text-brand-400 uppercase tracking-wide mb-1">V. Mensual</p>
                <p className="text-base font-bold font-mono text-brand-700">{fm(vMensual)}</p>
              </div>
              <div>
                <p className="text-[10px] text-brand-400 uppercase tracking-wide mb-1">V. Total</p>
                <p className="text-base font-bold font-mono text-brand-900">{fm(vTotal)}</p>
              </div>
            </div>
          )}

          {/* Acciones */}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose}
              className="px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 rounded-lg transition-colors">
              Cancelar
            </button>
            <button type="submit" disabled={saving}
              className="flex items-center gap-2 px-5 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-60">
              {saving ? <Loader2 className="w-4 h-4 animate-spin"/> : <Save className="w-4 h-4"/>}
              {isEdit ? 'Guardar cambios' : 'Agregar gasto'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══ EXPENSES TAB ═══
function ExpensesTab({ projectId, projectMonths, onUpdate }) {
  const [items,   setItems]   = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal,   setModal]   = useState(null); // null | { category, item? }

  const load = useCallback(async () => {
    try { const { data } = await budgetAPI.expensesList(projectId); setItems(data.data); }
    catch {} finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id, e) => {
    e.stopPropagation();
    if (!window.confirm('¿Eliminar este gasto?')) return;
    await budgetAPI.expensesDelete(projectId, id);
    load(); onUpdate();
  };

  const handleSave = () => { setModal(null); load(); onUpdate(); };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-500"/></div>;

  return (
    <>
      <div className="space-y-3">
        {EXP_CATS.map(cat => {
          const catItems = items.filter(i => i.category === cat.key);
          const catTotal = catItems.reduce((s, i) => s + (parseFloat(i.valor_total) || 0), 0);
          return (
            <div key={cat.key} className="border border-surface-100 rounded-xl overflow-hidden">
              {/* Cabecera categoría */}
              <div className="flex items-center justify-between px-4 py-3 bg-surface-50 border-b border-surface-100">
                <span className="flex items-center gap-2 text-sm font-semibold text-brand-900">{cat.icon} {cat.label}</span>
                <div className="flex items-center gap-3">
                  <span className="font-mono text-sm font-bold text-brand-700">{fm(catTotal)}</span>
                  <button
                    onClick={() => setModal({ category: cat.key })}
                    className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-medium rounded-lg transition-colors">
                    <Plus className="w-3 h-3"/> Agregar
                  </button>
                </div>
              </div>

              {/* Tabla de ítems */}
              {catItems.length === 0 ? (
                <p className="text-xs text-surface-300 text-center py-4">Sin gastos registrados</p>
              ) : (
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-[10px] text-surface-400 uppercase bg-white border-b border-surface-50">
                      <th className="px-4 py-2 text-left">Concepto</th>
                      <th className="px-3 py-2 text-right w-16">Cant.</th>
                      <th className="px-3 py-2 text-right w-32">Valor Unit.</th>
                      <th className="px-3 py-2 text-center w-28">Período</th>
                      <th className="px-3 py-2 text-right w-28">V. Mensual</th>
                      <th className="px-3 py-2 text-right w-32">V. Total</th>
                      <th className="w-10"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {catItems.map(item => (
                      <tr key={item.id}
                        className="group border-b border-surface-50 hover:bg-brand-50/30 cursor-pointer transition-colors"
                        onClick={() => setModal({ category: cat.key, item })}>
                        <td className="px-4 py-2.5 text-brand-900 text-sm">{item.label}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-surface-500">{item.cantidad}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-surface-600">{fm(item.valor_unitario)}</td>
                        <td className="px-3 py-2.5 text-center">
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-surface-100 rounded-full text-[10px] text-surface-500 font-mono">
                            M{item.mes_inicio}–M{item.mes_fin || projectMonths}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs text-brand-600">{fm(item.valor_mensual)}</td>
                        <td className="px-3 py-2.5 text-right font-mono text-xs font-semibold text-brand-900">{fm(item.valor_total)}</td>
                        <td className="px-2" onClick={e => handleDelete(item.id, e)}>
                          <button className="w-7 h-7 rounded-lg hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <Trash2 className="w-3.5 h-3.5 text-red-400"/>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          );
        })}
      </div>

      {/* Modal */}
      {modal && (
        <ExpenseModal
          projectId={projectId}
          projectMonths={projectMonths}
          category={modal.category}
          item={modal.item || null}
          onSave={handleSave}
          onClose={() => setModal(null)}
        />
      )}
    </>
  );
}

// ═══ MONTHLY TAB ═══
function MonthlyTab({ projectId }) {
  const [data, setData] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(()=>{
    budgetAPI.monthly(projectId).then(({data})=>setData(data.data)).catch(()=>{}).finally(()=>setLoading(false));
  }, [projectId]);

  if(loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-500"/></div>;
  if(data.length===0) return <p className="text-center py-8 text-surface-400 text-sm">Agregue personal o gastos para ver la proyección mensual</p>;

  const chartData = data.map(m=>({name:`M${m.month}`, Nómina:m.payroll, Honorarios:m.contractors, Gastos:m.expenses, Total:m.total}));
  const grandTotal = data.reduce((s,m)=>s+m.total,0);

  return (
    <div className="space-y-4">
      <div className="p-3 bg-surface-50 rounded-lg text-center">
        <p className="text-xs text-surface-400 uppercase tracking-wide mb-1">Total Proyectado ({data.length} meses)</p>
        <p className="text-2xl font-display font-bold text-brand-900">{fm(grandTotal)}</p>
      </div>

      <ResponsiveContainer width="100%" height={280}>
        <BarChart data={chartData}>
          <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0"/>
          <XAxis dataKey="name" tick={{fontSize:11, fill:'#94A3B8'}}/>
          <YAxis tick={{fontSize:11, fill:'#94A3B8'}} tickFormatter={v=>v>=1e6?`${(v/1e6).toFixed(0)}M`:`${(v/1e3).toFixed(0)}K`}/>
          <Tooltip formatter={v=>fm(v)} contentStyle={{backgroundColor:'#0A1F3A',border:'none',borderRadius:'8px',color:'#fff',fontSize:'12px'}}/>
          <Legend wrapperStyle={{fontSize:'12px'}}/>
          <Bar dataKey="Nómina" fill="#3B82F6" stackId="a" radius={[0,0,0,0]}/>
          <Bar dataKey="Honorarios" fill="#8B5CF6" stackId="a"/>
          <Bar dataKey="Gastos" fill="#F59E0B" stackId="a" radius={[4,4,0,0]}/>
        </BarChart>
      </ResponsiveContainer>

      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead><tr className="bg-surface-50"><th className="px-2 py-1.5 text-left">Mes</th><th className="px-2 py-1.5 text-right">Nómina</th><th className="px-2 py-1.5 text-right">Honorarios</th><th className="px-2 py-1.5 text-right">Gastos</th><th className="px-2 py-1.5 text-right font-bold">Total</th></tr></thead>
          <tbody>{data.map(m=>(
            <tr key={m.month} className="border-b border-surface-50"><td className="px-2 py-1.5 font-medium">Mes {m.month}</td><td className="px-2 py-1.5 text-right font-mono">{fm(m.payroll)}</td><td className="px-2 py-1.5 text-right font-mono">{fm(m.contractors)}</td><td className="px-2 py-1.5 text-right font-mono">{fm(m.expenses)}</td><td className="px-2 py-1.5 text-right font-mono font-bold">{fm(m.total)}</td></tr>
          ))}</tbody>
        </table>
      </div>
    </div>
  );
}

// ═══ MAIN PANEL ═══
export default function BudgetPanel({ projectId, perms = {} }) {
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [subTab, setSubTab] = useState('resultado');
  const [initializing, setInitializing] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async()=>{try{const{data}=await budgetAPI.summary(projectId);setSummary(data.data);}catch{}finally{setLoading(false);}}, [projectId]);
  useEffect(()=>{load();},[load]);

  const handleInit = async()=>{setInitializing(true);try{await budgetAPI.init(projectId);await budgetAPI.pucInit(projectId).catch(()=>{});await budgetAPI.deductionsInit(projectId).catch(()=>{});setToast({msg:'Presupuesto inicializado',type:'success'});setTimeout(()=>setToast(null),3000);load();}catch{}finally{setInitializing(false);}};

  if(loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-500"/></div>;

  if(!summary?.initialized) {
    return (
      <div className="text-center py-12">
        <DollarSign className="w-10 h-10 text-surface-200 mx-auto mb-3"/>
        <p className="text-sm text-surface-400 mb-6">Inicialice el presupuesto para comenzar</p>
        <button onClick={handleInit} disabled={initializing} className="btn-primary flex items-center gap-2 mx-auto">
          {initializing?<Loader2 className="w-4 h-4 animate-spin"/>:<Settings className="w-4 h-4"/>} Inicializar Presupuesto
        </button>
      </div>
    );
  }

  const s = summary;
  const margenColor = s.margen >= 0 ? 'text-blue-700' : 'text-red-700';
  const pm = s.project_months || 12;

  return (
    <div className="space-y-4">
      {toast && <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up ${toast.type==='error'?'bg-red-600 text-white':'bg-emerald-600 text-white'}`}>{toast.msg}</div>}

      {/* Export & Sync */}
      <div className="flex justify-end gap-2">
        <button onClick={async()=>{try{await budgetAPI.syncValue(projectId);setToast({msg:'Valor del contrato sincronizado con presupuesto',type:'success'});setTimeout(()=>setToast(null),3000);load();}catch(e){setToast({msg:e.response?.data?.error||'Error sincronizando',type:'error'});setTimeout(()=>setToast(null),4000);}}}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 border border-blue-200 transition-colors"
          title="Actualiza las filas base de Ingresos (contrato sin IVA, IVA, total) con el valor actual del contrato. No modifica el flujo de pagos ni los montos ingresados manualmente.">
          <RefreshCw className="w-3.5 h-3.5"/> Sincronizar Valor
        </button>
        <button onClick={async()=>{try{const r=await exportsAPI.budgetToExcel(projectId);const url=URL.createObjectURL(new Blob([r.data]));const a=document.createElement('a');a.href=url;a.download=`Presupuesto_${projectId}.xlsx`;a.click();URL.revokeObjectURL(url);}catch(e){alert('Error: '+e.message)}}}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-50 text-emerald-700 text-xs font-medium hover:bg-emerald-100 border border-emerald-200 transition-colors">
          <Download className="w-3.5 h-3.5"/> Exportar Excel
        </button>
      </div>

      {/* Summary */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-emerald-50 rounded-lg border border-emerald-100"><p className="text-[10px] text-emerald-600 font-semibold uppercase mb-0.5">Ingresos</p><p className="text-lg font-display font-bold text-emerald-700">{fm(s.total_ingresos)}</p></div>
        <div className="p-3 bg-red-50 rounded-lg border border-red-100"><p className="text-[10px] text-red-600 font-semibold uppercase mb-0.5">Egresos</p><p className="text-lg font-display font-bold text-red-700">{fm(s.total_egresos)}</p></div>
        <div className={`p-3 rounded-lg border ${s.margen>=0?'bg-blue-50 border-blue-100':'bg-red-50 border-red-200'}`}><p className={`text-[10px] font-semibold uppercase mb-0.5 ${margenColor}`}>Margen ({s.margen_pct.toFixed(1)}%)</p><p className={`text-lg font-display font-bold ${margenColor}`}>{fm(s.margen)}</p></div>
        <div className="p-3 bg-surface-50 rounded-lg border border-surface-100"><p className="text-[10px] text-surface-500 font-semibold uppercase mb-0.5">Plazo</p><p className="text-lg font-display font-bold text-brand-900">{pm} meses</p></div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-surface-100 overflow-x-auto">
        {SUB_TABS.map(t=>{const I=t.icon;return(
          <button key={t.id} onClick={()=>setSubTab(t.id)} className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 transition-all whitespace-nowrap ${subTab===t.id?'border-brand-600 text-brand-700':'border-transparent text-surface-400 hover:text-brand-600'}`}><I className="w-3.5 h-3.5"/>{t.label}</button>
        );})}
      </div>

      {/* Tab content */}
      <div>
        {subTab==='resultado' && <FinancialSummaryTab projectId={projectId} perms={perms}/>}
        {subTab==='ingresos' && <IncomeTab projectId={projectId} onUpdate={load}/>}
        {subTab==='payroll' && <PayrollTab projectId={projectId} projectMonths={pm} onUpdate={load}/>}
        {subTab==='contractors' && <ContractorsTab projectId={projectId} projectMonths={pm} onUpdate={load}/>}
        {subTab==='expenses' && <ExpensesTab projectId={projectId} projectMonths={pm} onUpdate={load}/>}
        {subTab==='puc' && <PUCTab projectId={projectId} perms={perms}/>}
        {subTab==='monthly' && <MonthlyTab projectId={projectId}/>}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// FINANCIAL SUMMARY TAB (Estado de Resultados)
// ═══════════════════════════════════════════
function DesvBadge({ val }) {
  if (val === 0) return <span className="text-xs text-surface-400">—</span>;
  const pos = val > 0;
  return (
    <span className={`text-xs font-semibold ${pos ? 'text-emerald-600' : 'text-red-600'}`}>
      {pos ? '▲' : '▼'} {fm(Math.abs(val))}
    </span>
  );
}

function FinancialSummaryTab({ projectId, perms }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState('presupuesto'); // 'presupuesto' | 'real' | 'comparacion'
  const [gncEdit, setGncEdit] = useState(null); // {id, valor}
  const [addingGnc, setAddingGnc] = useState(false);
  const [newGnc, setNewGnc] = useState({ nombre: '', valor: '' });

  const load = async () => {
    try { const r = await budgetAPI.financialSummary(projectId); setData(r.data.data); } catch (e) { console.error(e); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, [projectId]);

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-500"/></div>;
  if (!data) return <p className="text-sm text-surface-400 text-center py-8">No hay datos. Inicialice el presupuesto primero.</p>;
  const d = data;
  const ej = d.ejecucion || {};
  const tieneEjecucion = (ej.egresos_ejecutados || 0) > 0;
  const rp = d.retenciones_pres || {};
  const rr = ej.retenciones_real || {};

  const saveGnc = async (id, valor) => {
    try { await budgetAPI.deductionsUpdate(projectId, id, { valor: parseFloat(valor)||0 }); setGncEdit(null); load(); } catch {}
  };
  const addGnc = async () => {
    if (!newGnc.nombre) return;
    try {
      await budgetAPI.deductionsAdd(projectId, { codigo:'GNC', nombre: newGnc.nombre, tipo:'gnc', valor: parseFloat(newGnc.valor)||0 });
      setNewGnc({ nombre:'', valor:'' }); setAddingGnc(false); load();
    } catch {}
  };

  return (
    <div className="space-y-4">
      {/* Header + toggle */}
      <div className="bg-brand-50 rounded-xl p-4 border border-brand-100">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-display font-bold text-brand-900 text-sm mb-0.5">Estado de Resultados del Proyecto</h3>
            <p className="text-xs text-brand-600">Cálculo automático basado en ingresos, cuentas PUC, nómina, contratistas, gastos y deducciones</p>
          </div>
          <div className="flex rounded-lg border border-brand-200 overflow-hidden text-xs font-semibold">
            {[['presupuesto','Presupuestado'],['real','Real Ejecutado'],['comparacion','Comparación']].map(([id,label])=>(
              <button key={id} onClick={()=>setView(id)}
                className={`px-3 py-1.5 transition-colors ${view===id ? 'bg-brand-600 text-white' : 'text-brand-700 hover:bg-brand-100'}`}>
                {label}
              </button>
            ))}
          </div>
        </div>
      </div>
      {/* ── VISTA: PRESUPUESTADO ─────────────────────────────── */}
      {view === 'presupuesto' && (
        <>
          <div className="bg-white rounded-xl border border-surface-100 overflow-hidden text-sm">
            <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 font-bold">
              <div className="flex items-center gap-3"><span className="text-xs font-mono text-emerald-600 w-12">4</span><span className="text-emerald-800">INGRESOS</span></div>
              <span className="text-emerald-800 font-display">{fm(d.total_con_iva)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-1.5 bg-emerald-50/50 border-b font-medium">
              <div className="flex items-center gap-3"><span className="text-xs font-mono text-surface-400 w-12">41</span><span className="text-surface-700">Operacionales</span></div>
              <span className="text-surface-700">{fm(d.total_con_iva)}</span>
            </div>
            {d.income_rows?.filter(r => r.tipo === 'ingreso' && !r.es_iva && !r.es_total_con_iva).map(r => (
              <div key={r.id} className="flex items-center justify-between px-4 py-1 pl-12 text-xs border-b border-surface-50">
                <span className="text-surface-500">{r.label}</span><span className="text-surface-600">{fm(r.value)}</span>
              </div>
            ))}
            <div className="h-2 bg-surface-50"/>
            <div className="flex items-center justify-between px-4 py-2.5 bg-red-50 border-b border-red-200 font-bold">
              <div className="flex items-center gap-3"><span className="text-xs font-mono text-red-600 w-12">5</span><span className="text-red-800">GASTOS</span></div>
              <span className="text-red-800 font-display">{fm(d.total_gastos)}</span>
            </div>
            <div className="flex items-center justify-between px-4 py-1.5 bg-surface-50 font-medium border-b">
              <div className="flex items-center gap-3"><span className="text-xs font-mono text-surface-400 w-14">5105</span><span className="text-surface-700">Gastos de personal</span></div>
              <span className="text-surface-700">{fm((d.total_payroll||0)+(d.total_contractors||0))}</span>
            </div>
            {d.total_payroll > 0 && <div className="flex items-center justify-between px-4 py-1.5 pl-12 text-xs border-b border-surface-50"><span className="text-surface-600">Nómina</span><span className="text-surface-700 font-medium">{fm(d.total_payroll)}</span></div>}
            {d.total_contractors > 0 && <div className="flex items-center justify-between px-4 py-1.5 pl-12 text-xs border-b border-surface-50"><span className="text-surface-600">Contratistas / Honorarios</span><span className="text-surface-700 font-medium">{fm(d.total_contractors)}</span></div>}
            {d.puc_accounts?.filter(a => a.cuenta.startsWith('5') && a.cuenta !== '5' && a.cuenta !== '5105' && parseFloat(a.valor||0) > 0).map(a => (
              <div key={a.id} className="flex items-center justify-between px-4 py-1.5 border-b border-surface-50 pl-8">
                <div className="flex items-center gap-3"><span className="text-xs font-mono text-surface-400 w-14">{a.cuenta}</span><span className="text-surface-600 text-xs">{a.nombre}</span></div>
                <span className="text-surface-700 text-xs">{fm(a.valor)}</span>
              </div>
            ))}
            {d.total_expenses > 0 && <div className="flex items-center justify-between px-4 py-1.5 pl-8 text-xs border-b border-surface-50"><span className="text-surface-600">Gastos operativos</span><span className="text-surface-700 font-medium">{fm(d.total_expenses)}</span></div>}
            {d.puc_accounts?.filter(a => a.cuenta.startsWith('5') && a.cuenta !== '5' && a.cuenta !== '5105' && parseFloat(a.valor||0) === 0).length > 0 && (
              <details className="border-b border-surface-50">
                <summary className="px-4 py-1 pl-8 text-[10px] text-surface-300 cursor-pointer hover:text-surface-500">Cuentas PUC sin valor ({d.puc_accounts.filter(a => a.cuenta.startsWith('5') && a.cuenta !== '5' && a.cuenta !== '5105' && parseFloat(a.valor||0) === 0).length})</summary>
                {d.puc_accounts?.filter(a => a.cuenta.startsWith('5') && a.cuenta !== '5' && a.cuenta !== '5105' && parseFloat(a.valor||0) === 0).map(a => (
                  <div key={a.id} className="flex items-center justify-between px-4 py-1 pl-12 text-xs text-surface-300"><span>{a.cuenta} — {a.nombre}</span><span>-</span></div>
                ))}
              </details>
            )}
            <div className="h-2 bg-surface-50"/>
            {/* UC */}
            <div className={`flex items-center justify-between px-4 py-3 font-bold ${d.ganancia_contable >= 0 ? 'bg-yellow-50 border-y-2 border-yellow-300' : 'bg-red-50 border-y-2 border-red-300'}`}>
              <div className="flex items-center gap-3"><span className="text-xs font-mono w-12">UC</span><span>GANANCIA CONTABLE (4-5)</span></div>
              <span className={`font-display text-lg ${d.ganancia_contable >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fm(d.ganancia_contable)}</span>
            </div>
            {/* R = solo RETEFUENTE del flujo de ingresos */}
            {rp.retefuente > 0 && (
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-surface-50 text-xs">
                <div className="flex items-center gap-3"><span className="font-mono text-surface-400 w-12">R</span><span className="text-surface-600">Retención en la Fuente</span></div>
                <span className="text-red-600 font-medium">{fm(rp.retefuente)}</span>
              </div>
            )}
            {/* AF = Activos Fijos de deducciones */}
            {d.deductions?.filter(x => x.tipo === 'activo_fijo').map(x => (
              <div key={x.id} className="flex items-center justify-between px-4 py-1.5 border-b border-surface-50 text-xs">
                <div className="flex items-center gap-3"><span className="font-mono text-surface-400 w-12">AF</span><span className="text-surface-600">{x.nombre}</span></div>
                <span className="text-red-600 font-medium">{fm(x.valor_final)}</span>
              </div>
            ))}
            <div className="h-1 bg-surface-50"/>
            {/* UD */}
            <div className={`flex items-center justify-between px-4 py-3 font-bold ${d.ganancia_distribuible >= 0 ? 'bg-yellow-50 border-y-2 border-yellow-300' : 'bg-red-50 border-y-2 border-red-300'}`}>
              <div className="flex items-center gap-3"><span className="text-xs font-mono w-12">UD</span><span>GANANCIA DISTRIBUIBLE (4-5-R-AF)</span></div>
              <span className={`font-display text-lg ${d.ganancia_distribuible >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fm(d.ganancia_distribuible)}</span>
            </div>
            {/* GNC — editable inline */}
            {d.deductions?.filter(x => x.tipo === 'gnc').map(x => (
              <div key={x.id} className="flex items-center justify-between px-4 py-1.5 border-b border-surface-50 text-xs">
                <div className="flex items-center gap-3"><span className="font-mono text-surface-400 w-12">GNC</span><span className="text-surface-600">{x.nombre}</span></div>
                {gncEdit?.id === x.id
                  ? <div className="flex items-center gap-1">
                      <input type="number" value={gncEdit.valor} onChange={e=>setGncEdit({...gncEdit,valor:e.target.value})} className="w-28 px-2 py-0.5 border border-brand-300 rounded text-xs"/>
                      <button onClick={()=>saveGnc(x.id,gncEdit.valor)} className="text-brand-600 hover:text-brand-800 font-semibold px-1">✓</button>
                      <button onClick={()=>setGncEdit(null)} className="text-surface-400 hover:text-surface-600 px-1">✕</button>
                    </div>
                  : <div className="flex items-center gap-2">
                      <span className="text-red-600 font-medium">{fm(x.valor_final)}</span>
                      <button onClick={()=>setGncEdit({id:x.id,valor:x.valor_final})} className="text-surface-300 hover:text-brand-500"><Edit2 className="w-3 h-3"/></button>
                    </div>
                }
              </div>
            ))}
            {addingGnc
              ? <div className="flex items-center gap-2 px-4 py-2 border-b border-surface-50 text-xs">
                  <span className="font-mono text-surface-400 w-12">GNC</span>
                  <input placeholder="Concepto" value={newGnc.nombre} onChange={e=>setNewGnc({...newGnc,nombre:e.target.value})} className="flex-1 px-2 py-0.5 border border-brand-300 rounded text-xs"/>
                  <input type="number" placeholder="Valor" value={newGnc.valor} onChange={e=>setNewGnc({...newGnc,valor:e.target.value})} className="w-28 px-2 py-0.5 border border-brand-300 rounded text-xs"/>
                  <button onClick={addGnc} className="text-brand-600 hover:text-brand-800 font-semibold px-1">✓</button>
                  <button onClick={()=>{setAddingGnc(false);setNewGnc({nombre:'',valor:''}); }} className="text-surface-400 hover:text-surface-600 px-1">✕</button>
                </div>
              : <button onClick={()=>setAddingGnc(true)} className="w-full text-left px-4 py-1.5 text-xs text-surface-400 hover:text-brand-500 hover:bg-brand-50 border-b border-surface-50 flex items-center gap-2">
                  <Plus className="w-3 h-3"/> Agregar gasto no contabilizado (GNC)
                </button>
            }
            {/* Retenciones informativas (RETEICA, GMF, RETEIVA no afectan UD) */}
            {(rp.reteica > 0 || rp.gmf > 0 || rp.reteiva > 0) && (
              <details className="border-b border-surface-50">
                <summary className="px-4 py-1 pl-8 text-[10px] text-surface-300 cursor-pointer hover:text-surface-500">
                  Otras retenciones informativas (no reducen UD): RETEICA {fm(rp.reteica)} · GMF {fm(rp.gmf)}{rp.reteiva > 0 ? ` · RETEIVA ${fm(rp.reteiva)}` : ''}
                </summary>
              </details>
            )}
            <div className="h-1 bg-surface-50"/>
            {/* UR */}
            <div className={`flex items-center justify-between px-4 py-3 font-bold ${d.ganancia_real >= 0 ? 'bg-green-100 border-y-2 border-green-400' : 'bg-red-100 border-y-2 border-red-400'}`}>
              <div className="flex items-center gap-3"><span className="text-xs font-mono w-12">UR</span><span>GANANCIA REAL (4-5-R-AF-GNC)</span></div>
              <span className={`font-display text-lg ${d.ganancia_real >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fm(d.ganancia_real)}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['G. Contable (UC)', d.ganancia_contable_pct],
              ['G. Distribuible (UD)', d.ganancia_distribuible_pct],
              ['G. Real (UR)', d.ganancia_real_pct],
            ].map(([label, pct])=>(
              <div key={label} className={`p-3 rounded-lg border text-center ${(pct||0) >= 0 ? 'bg-yellow-50 border-yellow-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-[10px] font-semibold text-surface-500 uppercase">{label}</p>
                <p className={`text-xl font-display font-bold ${(pct||0) >= 0 ? 'text-yellow-700' : 'text-red-700'}`}>{(pct||0).toFixed(2)}%</p>
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── VISTA: REAL EJECUTADO ────────────────────────────── */}
      {view === 'real' && (
        <>
          {!tieneEjecucion && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              ⚠️ Aún no hay datos de ejecución registrados en el seguimiento presupuestal. Los valores mostrados corresponden al presupuesto planeado.
            </div>
          )}
          <div className="bg-white rounded-xl border border-surface-100 overflow-hidden text-sm">
            {/* 4 — INGRESOS REALES (gross cobrado) */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-emerald-50 border-b border-emerald-200 font-bold">
              <div className="flex items-center gap-3"><span className="text-xs font-mono text-emerald-600 w-12">4</span><span className="text-emerald-800">INGRESOS REALES (cobrado)</span></div>
              <span className="text-emerald-800 font-display">{fm(ej.ingresos_cobrados || 0)}</span>
            </div>
            {ej.tiene_pagos ? (
              <>
                <div className="flex items-center justify-between px-4 py-1.5 pl-12 text-xs border-b border-surface-50">
                  <span className="text-surface-600 font-medium">✅ Gross cobrado (pagado)</span>
                  <span className="text-emerald-700 font-semibold">{fm(ej.ingresos_cobrados)}</span>
                </div>
                {ej.ingresos_pendientes > 0 && (
                  <div className="flex items-center justify-between px-4 py-1.5 pl-12 text-xs border-b border-surface-50">
                    <span className="text-surface-500">⏳ Facturado pendiente cobro</span>
                    <span className="text-amber-600 font-medium">{fm(ej.ingresos_pendientes)}</span>
                  </div>
                )}
              </>
            ) : (
              <div className="px-4 py-2 pl-12 text-xs text-surface-400 border-b">Sin pagos marcados como pagados — registre pagos para ver datos reales</div>
            )}
            <div className="h-2 bg-surface-50"/>
            {/* 5 — EGRESOS EJECUTADOS */}
            <div className="flex items-center justify-between px-4 py-2.5 bg-red-50 border-b border-red-200 font-bold">
              <div className="flex items-center gap-3"><span className="text-xs font-mono text-red-600 w-12">5</span><span className="text-red-800">EGRESOS EJECUTADOS</span></div>
              <span className="text-red-800 font-display">{fm(ej.egresos_ejecutados)}</span>
            </div>
            {ej.egresos_by_fuente?.payroll > 0 && <div className="flex items-center justify-between px-4 py-1.5 pl-12 text-xs border-b border-surface-50"><span className="text-surface-600">Nómina ejecutada</span><span className="text-surface-700 font-medium">{fm(ej.egresos_by_fuente.payroll)}</span></div>}
            {ej.egresos_by_fuente?.contractors > 0 && <div className="flex items-center justify-between px-4 py-1.5 pl-12 text-xs border-b border-surface-50"><span className="text-surface-600">Honorarios ejecutados</span><span className="text-surface-700 font-medium">{fm(ej.egresos_by_fuente.contractors)}</span></div>}
            {ej.egresos_by_fuente?.expenses > 0 && <div className="flex items-center justify-between px-4 py-1.5 pl-12 text-xs border-b border-surface-50"><span className="text-surface-600">Gastos operativos ejecutados</span><span className="text-surface-700 font-medium">{fm(ej.egresos_by_fuente.expenses)}</span></div>}
            {ej.egresos_by_fuente?.extra > 0 && <div className="flex items-center justify-between px-4 py-1.5 pl-12 text-xs border-b border-surface-50"><span className="text-surface-600">Gastos adicionales (extra)</span><span className="text-surface-700 font-medium">{fm(ej.egresos_by_fuente.extra)}</span></div>}
            <div className="h-2 bg-surface-50"/>
            {/* UC real */}
            <div className={`flex items-center justify-between px-4 py-3 font-bold ${(ej.uc_real||0) >= 0 ? 'bg-yellow-50 border-y-2 border-yellow-300' : 'bg-red-50 border-y-2 border-red-300'}`}>
              <div className="flex items-center gap-3"><span className="text-xs font-mono w-12">UC</span><span>GANANCIA CONTABLE (4-5)</span></div>
              <span className={`font-display text-lg ${(ej.uc_real||0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fm(ej.uc_real||0)}</span>
            </div>
            {/* R real = RETEFUENTE */}
            {rr.retefuente > 0 && (
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-surface-50 text-xs">
                <div className="flex items-center gap-3"><span className="font-mono text-surface-400 w-12">R</span><span className="text-surface-600">Retención en la Fuente</span></div>
                <span className="text-red-600 font-medium">{fm(rr.retefuente)}</span>
              </div>
            )}
            {/* AF — mismo valor del presupuesto */}
            {d.activos_fijos > 0 && (
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-surface-50 text-xs">
                <div className="flex items-center gap-3"><span className="font-mono text-surface-400 w-12">AF</span><span className="text-surface-600">Activos Fijos (presupuestado)</span></div>
                <span className="text-red-600 font-medium">{fm(d.activos_fijos)}</span>
              </div>
            )}
            <div className="h-1 bg-surface-50"/>
            {/* UD real */}
            <div className={`flex items-center justify-between px-4 py-3 font-bold ${(ej.ud_real||0) >= 0 ? 'bg-yellow-50 border-y-2 border-yellow-300' : 'bg-red-50 border-y-2 border-red-300'}`}>
              <div className="flex items-center gap-3"><span className="text-xs font-mono w-12">UD</span><span>GANANCIA DISTRIBUIBLE (4-5-R-AF)</span></div>
              <span className={`font-display text-lg ${(ej.ud_real||0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fm(ej.ud_real||0)}</span>
            </div>
            {/* GNC — mismo del presupuesto */}
            {d.gnc > 0 && (
              <div className="flex items-center justify-between px-4 py-1.5 border-b border-surface-50 text-xs">
                <div className="flex items-center gap-3"><span className="font-mono text-surface-400 w-12">GNC</span><span className="text-surface-600">Gastos No Contabilizados (presupuestado)</span></div>
                <span className="text-red-600 font-medium">{fm(d.gnc)}</span>
              </div>
            )}
            {/* Retenciones informativas */}
            {(rr.reteica > 0 || rr.gmf > 0 || rr.reteiva > 0) && (
              <details className="border-b border-surface-50">
                <summary className="px-4 py-1 pl-8 text-[10px] text-surface-300 cursor-pointer hover:text-surface-500">
                  Otras retenciones informativas: RETEICA {fm(rr.reteica)} · GMF {fm(rr.gmf)}{rr.reteiva > 0 ? ` · RETEIVA ${fm(rr.reteiva)}` : ''}
                </summary>
              </details>
            )}
            <div className="h-1 bg-surface-50"/>
            {/* UR real */}
            <div className={`flex items-center justify-between px-4 py-3 font-bold ${(ej.ur_real||0) >= 0 ? 'bg-green-100 border-y-2 border-green-400' : 'bg-red-100 border-y-2 border-red-400'}`}>
              <div className="flex items-center gap-3"><span className="text-xs font-mono w-12">UR</span><span>GANANCIA REAL (4-5-R-AF-GNC)</span></div>
              <span className={`font-display text-xl ${(ej.ur_real||0) >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{fm(ej.ur_real||0)}</span>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            {[
              ['G. Contable Real (UC)', ej.margen_uc_real||0],
              ['G. Distribuible Real (UD)', ej.margen_ud_real||0],
              ['Base de cálculo', ej.ingresos_cobrados > 0 ? 100 : 0],
            ].map(([label, pct], i)=>(
              <div key={label} className={`p-3 rounded-xl border text-center ${pct >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
                <p className="text-[10px] font-semibold text-surface-500 uppercase mb-1">{label}</p>
                {i < 2
                  ? <p className={`text-xl font-display font-bold ${pct >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>{pct.toFixed(1)}%</p>
                  : <p className="text-xs text-surface-400 mt-1">{fm(ej.ingresos_cobrados||0)}<br/>ingresos cobrados</p>
                }
              </div>
            ))}
          </div>
        </>
      )}

      {/* ── VISTA: COMPARACIÓN ──────────────────────────────── */}
      {view === 'comparacion' && (
        <div className="space-y-3">
          {!tieneEjecucion && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 text-sm text-amber-800">
              ⚠️ Sin datos de ejecución registrados. Registre valores en el seguimiento presupuestal para ver la comparación real.
            </div>
          )}
          <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
            {/* Header tabla */}
            <div className="grid grid-cols-4 gap-0 text-[10px] font-bold uppercase text-surface-500 border-b bg-surface-50">
              <div className="px-4 py-2.5">Concepto</div>
              <div className="px-4 py-2.5 text-right">Presupuestado</div>
              <div className="px-4 py-2.5 text-right">Real Ejecutado</div>
              <div className="px-4 py-2.5 text-right">Desviación</div>
            </div>
            {/* Ingresos */}
            {[
              { label:'INGRESOS', pres: d.total_con_iva, real: ej.tiene_pagos ? ej.ingresos_facturados : d.total_con_iva, bold:true, green:true },
              { label:'  Cobrado', pres: d.total_con_iva, real: ej.ingresos_cobrados||0, indent:true },
            ].map((row, i) => {
              const desv = (row.real||0) - (row.pres||0);
              return (
                <div key={i} className={`grid grid-cols-4 gap-0 border-b text-sm ${row.bold ? 'font-bold bg-emerald-50' : 'text-surface-700'}`}>
                  <div className={`px-4 py-2 ${row.indent ? 'pl-10 text-xs text-surface-500' : 'text-emerald-800'}`}>{row.label}</div>
                  <div className="px-4 py-2 text-right">{fm(row.pres)}</div>
                  <div className={`px-4 py-2 text-right ${row.bold ? 'text-emerald-700' : ''}`}>{fm(row.real)}</div>
                  <div className="px-4 py-2 text-right"><DesvBadge val={desv}/></div>
                </div>
              );
            })}
            {/* Egresos */}
            {[
              { label:'EGRESOS TOTALES', pres: d.total_gastos, real: ej.egresos_ejecutados||0, bold:true, red:true },
              { label:'  Nómina', pres: d.total_payroll||0, real: ej.egresos_by_fuente?.payroll||0, indent:true },
              { label:'  Honorarios', pres: d.total_contractors||0, real: ej.egresos_by_fuente?.contractors||0, indent:true },
              { label:'  Gastos Operativos', pres: d.total_expenses||0, real: ej.egresos_by_fuente?.expenses||0, indent:true },
              ...(ej.egresos_by_fuente?.extra > 0 ? [{ label:'  Gastos adicionales', pres: 0, real: ej.egresos_by_fuente.extra||0, indent:true }] : []),
            ].map((row, i) => {
              // For egresos, positive deviation means over-spent (bad) → invert sign for color
              const desv = (row.real||0) - (row.pres||0);
              return (
                <div key={i} className={`grid grid-cols-4 gap-0 border-b text-sm ${row.bold ? 'font-bold bg-red-50' : 'text-surface-700'}`}>
                  <div className={`px-4 py-2 ${row.indent ? 'pl-10 text-xs text-surface-500' : 'text-red-800'}`}>{row.label}</div>
                  <div className="px-4 py-2 text-right">{fm(row.pres)}</div>
                  <div className={`px-4 py-2 text-right ${row.bold ? 'text-red-700' : ''}`}>{fm(row.real)}</div>
                  <div className="px-4 py-2 text-right"><DesvBadge val={-desv}/></div>
                </div>
              );
            })}
            {/* Resultado — basado en UD (Ganancia Distribuible) */}
            {[
              { label:'GANANCIA CONTABLE PRESUP. (UC)', val: d.ganancia_contable, sub:'4 − 5' },
              { label:'GANANCIA DISTRIBUIBLE PRESUP. (UD)', val: d.ganancia_distribuible, sub:'UC − RETEFUENTE − AF', bold2:true },
              { label:'RESULTADO REAL EJECUCIÓN (UD)', val: ej.ud_real||0, highlight:true, sub:'4real − 5real − RF − AF' },
              { label:'DIFERENCIA (Real − Presup.)', val: (ej.ud_real||0) - (d.ganancia_distribuible||0), diff:true },
            ].map((row, i) => (
              <div key={i} className={`grid grid-cols-4 gap-0 border-b text-sm font-bold ${row.highlight ? ((row.val||0)>=0?'bg-emerald-100':'bg-red-100') : row.diff ? 'bg-blue-50' : row.bold2 ? 'bg-amber-50' : 'bg-surface-50'}`}>
                <div className="px-4 py-2.5 col-span-3">
                  <div>{row.label}</div>
                  {row.sub && <div className="text-[10px] font-normal text-surface-400">{row.sub}</div>}
                </div>
                <div className={`px-4 py-2.5 text-right text-base font-display ${(row.val||0)>=0?'text-emerald-700':'text-red-700'}`}>{fm(row.val||0)}</div>
              </div>
            ))}
          </div>
          {/* Resumen visual márgenes */}
          <div className="grid grid-cols-3 gap-3">
            <div className={`p-3 rounded-xl border text-center ${(d.ganancia_distribuible||0)>=0?'bg-amber-50 border-amber-200':'bg-red-50 border-red-200'}`}>
              <p className="text-[10px] font-semibold text-surface-400 uppercase">Margen Presupuestado (UD)</p>
              <p className={`text-xl font-display font-bold ${(d.ganancia_distribuible||0)>=0?'text-amber-700':'text-red-700'}`}>{(d.ganancia_distribuible_pct||0).toFixed(1)}%</p>
              <p className="text-[10px] text-surface-400 mt-0.5">UD / Ingresos pres.</p>
            </div>
            <div className={`p-3 rounded-xl border text-center ${(ej.margen_ud_real||0)>=0?'bg-emerald-50 border-emerald-200':'bg-red-50 border-red-200'}`}>
              <p className="text-[10px] font-semibold text-surface-400 uppercase">Margen Real (UD)</p>
              <p className={`text-xl font-display font-bold ${(ej.margen_ud_real||0)>=0?'text-emerald-700':'text-red-700'}`}>{(ej.margen_ud_real||0).toFixed(1)}%</p>
              <p className="text-[10px] text-surface-400 mt-0.5">UD real / Cobrado</p>
            </div>
            <div className="p-3 rounded-xl border text-center bg-blue-50 border-blue-200">
              <p className="text-[10px] font-semibold text-surface-400 uppercase">Diferencia Margen</p>
              <p className={`text-xl font-display font-bold ${(ej.margen_ud_real||0)-(d.ganancia_distribuible_pct||0)>=0?'text-emerald-700':'text-red-700'}`}>
                {((ej.margen_ud_real||0) - (d.ganancia_distribuible_pct||0)).toFixed(1)}pp
              </p>
              <p className="text-[10px] text-surface-400 mt-0.5">Real − Presup.</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════
// PUC TAB (Editable accounts + Deductions)
// ═══════════════════════════════════════════
function PUCTab({ projectId, perms }) {
  const [accounts, setAccounts] = useState([]);
  const [deductions, setDeductions] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAddAcct, setShowAddAcct] = useState(false);
  const [showAddDed, setShowAddDed] = useState(false);
  const [newAcct, setNewAcct] = useState({ cuenta:'', nombre:'', parent_cuenta:'5', valor:0 });
  const [newDed, setNewDed] = useState({ codigo:'', nombre:'', tipo:'otro', valor:0 });
  const [editId, setEditId] = useState(null);
  const [editVal, setEditVal] = useState('');

  useEffect(() => { load(); }, [projectId]);
  const load = async () => { try { const [a,d] = await Promise.all([budgetAPI.pucList(projectId),budgetAPI.deductionsList(projectId)]); setAccounts(a.data.data||[]); setDeductions(d.data.data||[]); } catch {} finally { setLoading(false); } };

  const savePuc = async (id, val) => { try { await budgetAPI.pucUpdate(projectId, id, { valor: parseFloat(val)||0 }); setEditId(null); load(); } catch {} };
  const saveDed = async (id, val) => { try { await budgetAPI.deductionsUpdate(projectId, id, { valor: parseFloat(val)||0 }); setEditId(null); load(); } catch {} };

  const addAcct = async () => { if (!newAcct.cuenta||!newAcct.nombre) return; try { await budgetAPI.pucAdd(projectId,newAcct); setNewAcct({cuenta:'',nombre:'',parent_cuenta:'5',valor:0}); setShowAddAcct(false); load(); } catch(e) { alert(e.response?.data?.error||'Error'); } };
  const addDed = async () => { if (!newDed.codigo||!newDed.nombre) return; try { await budgetAPI.deductionsAdd(projectId,newDed); setNewDed({codigo:'',nombre:'',tipo:'otro',valor:0}); setShowAddDed(false); load(); } catch(e) { alert(e.response?.data?.error||'Error'); } };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-500"/></div>;
  if (accounts.length === 0) return (
    <div className="text-center py-8">
      <Settings className="w-8 h-8 text-surface-300 mx-auto mb-2"/>
      <p className="text-sm text-surface-400 mb-4">Cuentas PUC no inicializadas</p>
      <button onClick={async()=>{await budgetAPI.pucInit(projectId);await budgetAPI.deductionsInit(projectId);load();}} className="btn-primary text-sm">Inicializar PUC y Deducciones</button>
    </div>
  );

  const ce = perms.canEdit;
  return (
    <div className="space-y-6">
      {/* PUC */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-brand-900">Cuentas Contables PUC (Gastos)</h4>
          {ce && <button onClick={()=>setShowAddAcct(!showAddAcct)} className="text-xs px-2 py-1 rounded bg-brand-100 text-brand-700 hover:bg-brand-200 flex items-center gap-1"><Plus className="w-3 h-3"/> Agregar</button>}
        </div>
        <p className="text-xs text-surface-400 mb-3">Ingrese valores directos en las cuentas PUC. Los gastos de nómina, contratistas y operativos se suman automáticamente desde sus pestañas.</p>
        {showAddAcct && (
          <div className="bg-brand-50 rounded-lg p-3 mb-3 grid grid-cols-5 gap-2 items-end">
            <div><label className="text-[10px] text-brand-700">Nº Cuenta</label><input value={newAcct.cuenta} onChange={e=>setNewAcct({...newAcct,cuenta:e.target.value})} className="input-field text-xs" placeholder="5160"/></div>
            <div className="col-span-2"><label className="text-[10px] text-brand-700">Nombre</label><input value={newAcct.nombre} onChange={e=>setNewAcct({...newAcct,nombre:e.target.value})} className="input-field text-xs"/></div>
            <div><label className="text-[10px] text-brand-700">Valor</label><input type="number" value={newAcct.valor} onChange={e=>setNewAcct({...newAcct,valor:e.target.value})} className="input-field text-xs"/></div>
            <button onClick={addAcct} className="btn-primary text-xs">Agregar</button>
          </div>
        )}
        <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
          {accounts.map(a => (
            <div key={a.id} className={`flex items-center justify-between px-4 py-2 border-b border-surface-50 group ${a.es_subtotal?'bg-surface-50 font-medium':''}`}>
              <div className="flex items-center gap-3">
                <span className="text-xs font-mono text-surface-400 w-14">{a.cuenta}</span>
                <span className={`${a.es_subtotal?'text-brand-800 font-semibold':'text-surface-700'} text-sm`}>{a.nombre}</span>
                {!a.es_predefinida && <span className="text-[9px] px-1 rounded bg-brand-100 text-brand-600">Personalizada</span>}
              </div>
              <div className="flex items-center gap-2">
                {!a.es_subtotal && editId===`p${a.id}` ? (
                  <div className="flex gap-1"><input type="number" value={editVal} onChange={e=>setEditVal(e.target.value)} className="input-field text-xs w-32 text-right" autoFocus onKeyDown={e=>e.key==='Enter'&&savePuc(a.id,editVal)}/><button onClick={()=>savePuc(a.id,editVal)} className="text-emerald-500"><CheckCircle2 className="w-4 h-4"/></button><button onClick={()=>setEditId(null)} className="text-surface-400"><X className="w-3 h-3"/></button></div>
                ) : (
                  <><span className={`text-sm ${parseFloat(a.valor)>0?'text-surface-800':'text-surface-300'}`}>{parseFloat(a.valor)>0?fm(a.valor):'-'}</span>
                  {ce&&!a.es_subtotal&&<button onClick={()=>{setEditId(`p${a.id}`);setEditVal(a.valor||'0');}} className="opacity-0 group-hover:opacity-100 text-surface-300 hover:text-brand-500"><Edit2 className="w-3 h-3"/></button>}</>
                )}
                {ce&&!a.es_predefinida&&<button onClick={async()=>{if(window.confirm('¿Eliminar?')){await budgetAPI.pucDelete(projectId,a.id);load();}}} className="opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500"><Trash2 className="w-3 h-3"/></button>}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Deducciones */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-brand-900">Deducciones (R, AF, GNC)</h4>
          {ce && <button onClick={()=>setShowAddDed(!showAddDed)} className="text-xs px-2 py-1 rounded bg-amber-100 text-amber-700 hover:bg-amber-200 flex items-center gap-1"><Plus className="w-3 h-3"/> Agregar</button>}
        </div>
        <p className="text-xs text-surface-400 mb-3">Retenciones, activos fijos y gastos no contabilizados. Haga clic en el valor para editar.</p>
        {showAddDed && (
          <div className="bg-amber-50 rounded-lg p-3 mb-3 grid grid-cols-5 gap-2 items-end">
            <div><label className="text-[10px]">Código</label><input value={newDed.codigo} onChange={e=>setNewDed({...newDed,codigo:e.target.value})} className="input-field text-xs" placeholder="XX"/></div>
            <div className="col-span-2"><label className="text-[10px]">Nombre</label><input value={newDed.nombre} onChange={e=>setNewDed({...newDed,nombre:e.target.value})} className="input-field text-xs"/></div>
            <div><label className="text-[10px]">Tipo</label><select value={newDed.tipo} onChange={e=>setNewDed({...newDed,tipo:e.target.value})} className="input-field text-xs"><option value="retencion">Retención</option><option value="activo_fijo">Activo Fijo</option><option value="gnc">GNC</option><option value="otro">Otro</option></select></div>
            <button onClick={addDed} className="btn-primary text-xs bg-amber-600 hover:bg-amber-700">Agregar</button>
          </div>
        )}
        <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
          {deductions.map(d => (
            <div key={d.id} className="flex items-center justify-between px-4 py-2 border-b border-surface-50 text-sm group">
              <div className="flex items-center gap-3 flex-1">
                <span className="text-xs font-mono text-surface-400 w-10">{d.codigo}</span>
                <span className="text-surface-700">{d.nombre}</span>
                <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 text-surface-500">{d.tipo}</span>
                {d.porcentaje && <span className="text-[10px] text-amber-600">{d.porcentaje}% s/{d.base_calculo}</span>}
              </div>
              {editId===`d${d.id}` ? (
                <div className="flex gap-1"><input type="number" value={editVal} onChange={e=>setEditVal(e.target.value)} className="input-field text-xs w-32 text-right" autoFocus onKeyDown={e=>e.key==='Enter'&&saveDed(d.id,editVal)}/><button onClick={()=>saveDed(d.id,editVal)} className="text-emerald-500"><CheckCircle2 className="w-4 h-4"/></button></div>
              ) : (
                <span className="text-surface-700 cursor-pointer hover:text-brand-600" onClick={()=>{if(ce){setEditId(`d${d.id}`);setEditVal(d.valor||'0');}}}>
                  {fm(d.valor)}
                </span>
              )}
              {ce&&<button onClick={async()=>{if(window.confirm('¿Eliminar?')){await budgetAPI.deductionsDelete(projectId,d.id);load();}}} className="ml-2 opacity-0 group-hover:opacity-100 text-red-300 hover:text-red-500"><Trash2 className="w-3 h-3"/></button>}
            </div>
          ))}
          {deductions.length === 0 && <div className="text-center py-4 text-xs text-surface-400">Sin deducciones — <button onClick={async()=>{await budgetAPI.deductionsInit(projectId);load();}} className="text-brand-600 underline">Inicializar</button></div>}
        </div>
      </div>
    </div>
  );
}
