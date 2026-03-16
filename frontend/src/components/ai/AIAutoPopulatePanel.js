import React, { useState, useEffect } from 'react';
import { aiAPI, documentsAPI } from '../../services/api';
import {
  Loader2, Sparkles, FileText, CheckCircle2, AlertTriangle, ChevronDown,
  ChevronRight, Shield, Users, CalendarRange, DollarSign, ClipboardList, Settings,
} from 'lucide-react';

const MODULE_CONFIG = {
  obligations: { label: 'Obligaciones', icon: ClipboardList, color: 'blue' },
  risks: { label: 'Riesgos', icon: Shield, color: 'red' },
  team: { label: 'Equipo/Personal', icon: Users, color: 'purple' },
  schedule: { label: 'Cronograma', icon: CalendarRange, color: 'amber' },
  budget: { label: 'Presupuesto (gastos)', icon: DollarSign, color: 'emerald' },
};

export default function AIAutoPopulatePanel({ projectId, provider, apiKey, model }) {
  const [docs, setDocs] = useState([]);
  const [selectedDocs, setSelectedDocs] = useState([]);
  const [selectedModules, setSelectedModules] = useState(['obligations', 'risks', 'team', 'schedule', 'budget']);
  const [step, setStep] = useState('config'); // config | analyzing | review | applying | done
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState(null);
  const [expanded, setExpanded] = useState({});
  const [selected, setSelected] = useState({}); // track selected items: { "obligations-0": true, ... }
  const [applyResult, setApplyResult] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const r = await documentsAPI.list(projectId);
        setDocs(r.data.data || []);
      } catch {} finally { setLoading(false); }
    })();
  }, [projectId]);

  const toggleDoc = (id) => setSelectedDocs(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleModule = (m) => setSelectedModules(prev => prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]);
  const toggleAll = () => setSelectedDocs(selectedDocs.length === docs.length ? [] : docs.map(d => d.id));

  const analyze = async () => {
    setStep('analyzing'); setError(null);
    try {
      const r = await aiAPI.autoAnalyze(projectId, {
        doc_ids: selectedDocs.length > 0 ? selectedDocs : undefined,
        modules: selectedModules,
        provider: provider || undefined,
        api_key: apiKey || undefined,
        model: model || undefined,
      });
      setPreview(r.data.data);
      // Store meta for diagnostics
      setPreview(prev => ({ ...prev, _meta: { text_chars: r.data.text_chars, pdf_buffers: r.data.pdf_buffers, read_errors: r.data.read_errors } }));
      // Auto-select all items
      const sel = {};
      for (const m of selectedModules) {
        const items = m === 'budget' ? (r.data.data.budget?.expenses || []) : (r.data.data[m] || []);
        items.forEach((_, i) => { sel[`${m}-${i}`] = true; });
      }
      setSelected(sel);
      setStep('review');
      // Auto-expand modules with data
      const exp = {};
      for (const m of selectedModules) {
        if (m === 'budget') { if (r.data.data.budget?.expenses?.length) exp[m] = true; }
        else if (r.data.data[m]?.length) exp[m] = true;
      }
      setExpanded(exp);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      setStep('config');
    }
  };

  const toggleItem = (module, index) => {
    setSelected(prev => ({ ...prev, [`${module}-${index}`]: !prev[`${module}-${index}`] }));
  };
  const selectAll = (mod, items) => {
    const upd = {};
    items.forEach((_, i) => { upd[`${mod}-${i}`] = true; });
    setSelected(prev => ({ ...prev, ...upd }));
  };
  const selectNone = (mod, items) => {
    const upd = {};
    items.forEach((_, i) => { upd[`${mod}-${i}`] = false; });
    setSelected(prev => ({ ...prev, ...upd }));
  };

  const apply = async () => {
    setStep('applying');
    try {
      // Filter to only selected items
      const filteredData = { ...preview };
      for (const m of selectedModules) {
        if (m === 'budget') {
          if (filteredData.budget?.expenses) {
            filteredData.budget.expenses = filteredData.budget.expenses.filter((_, i) => selected[`budget-${i}`]);
          }
        } else if (filteredData[m]) {
          filteredData[m] = filteredData[m].filter((_, i) => selected[`${m}-${i}`]);
        }
      }
      const r = await aiAPI.autoApply(projectId, { data: filteredData, modules: selectedModules });
      setApplyResult(r.data.results);
      setStep('done');
    } catch (e) {
      setError(e.response?.data?.error || e.message);
      console.error('Apply error details:', e.response?.data);
      setStep('review');
    }
  };

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-500" /></div>;

  // ─── STEP: Config ───
  if (step === 'config') return (
    <div className="space-y-6">
      <div className="bg-gradient-to-r from-purple-50 to-blue-50 rounded-xl p-5 border border-purple-100">
        <div className="flex items-center gap-3 mb-2">
          <div className="w-10 h-10 rounded-lg bg-purple-600 flex items-center justify-center"><Sparkles className="w-5 h-5 text-white" /></div>
          <div>
            <h3 className="font-display font-bold text-purple-900 text-lg">Auto-Poblar con IA</h3>
            <p className="text-sm text-purple-600">Analiza los documentos del contrato y pre-llena los módulos del proyecto automáticamente</p>
          </div>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {/* Select documents */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <h4 className="text-sm font-bold text-brand-900">1. Seleccione documentos a analizar</h4>
          <button onClick={toggleAll} className="text-xs text-brand-600 hover:underline">{selectedDocs.length === docs.length ? 'Deseleccionar todo' : 'Seleccionar todo'}</button>
        </div>
        {docs.length === 0 ? (
          <div className="text-center py-6 bg-surface-50 rounded-xl border border-dashed border-surface-200">
            <FileText className="w-8 h-8 text-surface-300 mx-auto mb-2" />
            <p className="text-sm text-surface-400">No hay documentos subidos al proyecto</p>
            <p className="text-xs text-surface-300">Suba el contrato y anexos técnicos en el módulo de Documentos</p>
          </div>
        ) : (
          <div className="bg-white rounded-xl border border-surface-100 overflow-hidden max-h-60 overflow-y-auto">
            {docs.map(d => (
              <label key={d.id} className="flex items-center gap-3 px-4 py-2.5 border-b border-surface-50 hover:bg-surface-50 cursor-pointer">
                <input type="checkbox" checked={selectedDocs.includes(d.id)} onChange={() => toggleDoc(d.id)} className="rounded border-surface-300 text-brand-600" />
                <FileText className="w-4 h-4 text-surface-400 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-brand-900 truncate">{d.file_name}</p>
                  <p className="text-[10px] text-surface-400">{d.file_size_human} · {d.doc_type || 'Sin clasificar'}</p>
                </div>
              </label>
            ))}
          </div>
        )}
      </div>

      {/* Select modules */}
      <div>
        <h4 className="text-sm font-bold text-brand-900 mb-2">2. Seleccione módulos a poblar</h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {Object.entries(MODULE_CONFIG).map(([key, cfg]) => {
            const Icon = cfg.icon;
            const isSelected = selectedModules.includes(key);
            return (
              <button key={key} onClick={() => toggleModule(key)}
                className={`flex items-center gap-2 px-3 py-2.5 rounded-lg border text-sm font-medium transition-all ${
                  isSelected ? `bg-${cfg.color}-50 border-${cfg.color}-200 text-${cfg.color}-700` : 'bg-white border-surface-200 text-surface-400'
                }`}>
                <Icon className="w-4 h-4" />
                <span>{cfg.label}</span>
                {isSelected && <CheckCircle2 className="w-3.5 h-3.5 ml-auto" />}
              </button>
            );
          })}
        </div>
      </div>

      {/* Analyze button */}
      <button onClick={analyze} disabled={docs.length === 0 || selectedModules.length === 0}
        className="w-full btn-primary py-3 text-sm flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed bg-purple-600 hover:bg-purple-700">
        <Sparkles className="w-4 h-4" /> Analizar Documentos con IA
      </button>
    </div>
  );

  // ─── STEP: Analyzing ───
  if (step === 'analyzing') return (
    <div className="flex flex-col items-center justify-center py-16">
      <div className="relative">
        <div className="w-16 h-16 rounded-full bg-purple-100 flex items-center justify-center animate-pulse">
          <Sparkles className="w-8 h-8 text-purple-600" />
        </div>
        <Loader2 className="w-6 h-6 text-purple-500 animate-spin absolute -bottom-1 -right-1" />
      </div>
      <p className="mt-4 text-sm font-medium text-brand-900">Analizando documentos con IA...</p>
      <p className="text-xs text-surface-400 mt-1">Esto puede tomar 30-60 segundos dependiendo del tamaño</p>
    </div>
  );

  // ─── STEP: Review ───
  if (step === 'review') return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="font-display font-bold text-brand-900">Revisión de Datos Extraídos</h3>
          <p className="text-xs text-surface-400">Revise y elimine ítems incorrectos antes de aplicar</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => { setStep('config'); setPreview(null); setSelected({}); }} className="btn-ghost text-xs">Volver</button>
          <button onClick={apply} className="btn-primary text-xs bg-emerald-600 hover:bg-emerald-700 flex items-center gap-1.5">
            <CheckCircle2 className="w-3.5 h-3.5" /> Aplicar al Proyecto
          </button>
        </div>
      </div>

      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {/* Summary */}
      {preview?.summary && (
        <div className="bg-blue-50 rounded-xl p-4 border border-blue-100">
          <h4 className="text-xs font-semibold text-blue-700 uppercase mb-1">Resumen del Contrato</h4>
          <p className="text-sm text-blue-900">{preview.summary}</p>
        </div>
      )}

      {/* Warnings */}
      {preview?.warnings?.length > 0 && (
        <div className="bg-amber-50 rounded-xl p-3 border border-amber-200">
          <div className="flex items-center gap-2 mb-1"><AlertTriangle className="w-4 h-4 text-amber-600" /><span className="text-xs font-semibold text-amber-700">Advertencias</span></div>
          {preview.warnings.map((w, i) => <p key={i} className="text-xs text-amber-800 ml-6">• {w}</p>)}
        </div>
      )}

      {/* Read diagnostics */}
      {preview?._meta && (
        <div className="bg-surface-50 rounded-lg p-3 text-xs text-surface-500">
          <span className="font-semibold">Lectura:</span> {preview._meta.text_chars || 0} caracteres de texto extraído, {preview._meta.pdf_buffers || 0} PDFs como imagen
          {preview._meta.read_errors?.length > 0 && (
            <div className="mt-1 text-red-600">
              {preview._meta.read_errors.map((e, i) => <p key={i}>⚠ {e}</p>)}
            </div>
          )}
        </div>
      )}

      {/* Module previews */}
      {selectedModules.map(mod => {
        const cfg = MODULE_CONFIG[mod];
        const Icon = cfg.icon;
        const items = mod === 'budget' ? (preview?.budget?.expenses || []) : (preview?.[mod] || []);
        const isExp = expanded[mod];
        const selectedCount = items.filter((_, i) => selected[`${mod}-${i}`]).length;
        const confidence = preview?.confidence?.[mod];

        return (
          <div key={mod} className="bg-white rounded-xl border border-surface-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 cursor-pointer hover:bg-surface-50" onClick={() => setExpanded(p => ({ ...p, [mod]: !p[mod] }))}>
              <div className="flex items-center gap-2">
                {isExp ? <ChevronDown className="w-4 h-4 text-surface-400" /> : <ChevronRight className="w-4 h-4 text-surface-400" />}
                <Icon className={`w-4 h-4 text-${cfg.color}-500`} />
                <span className="font-medium text-sm text-brand-900">{cfg.label}</span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${selectedCount > 0 ? `bg-${cfg.color}-100 text-${cfg.color}-700` : 'bg-surface-100 text-surface-400'}`}>
                  {selectedCount}/{items.length} seleccionados
                </span>
              </div>
              {confidence !== undefined && (
                <span className={`text-[10px] px-2 py-0.5 rounded font-medium ${confidence >= 0.7 ? 'bg-emerald-100 text-emerald-700' : confidence >= 0.4 ? 'bg-amber-100 text-amber-700' : 'bg-red-100 text-red-700'}`}>
                  Confianza: {Math.round(confidence * 100)}%
                </span>
              )}
            </div>

            {isExp && (
              <div className="border-t border-surface-100">
                {items.length === 0 ? (
                  <p className="text-xs text-surface-400 text-center py-4">No se encontraron datos para este módulo</p>
                ) : (
                  <>
                    <div className="flex items-center gap-3 px-4 py-1.5 bg-surface-50 border-b border-surface-100" onClick={e => e.stopPropagation()}>
                      <button onClick={() => selectAll(mod, items)} className="text-[10px] text-brand-600 hover:underline font-medium">Seleccionar todo</button>
                      <span className="text-surface-300">|</span>
                      <button onClick={() => selectNone(mod, items)} className="text-[10px] text-surface-400 hover:underline">Ninguno</button>
                    </div>
                    {items.map((item, idx) => {
                      const isSelected = !!selected[`${mod}-${idx}`];
                      return (
                        <label key={idx} className={`flex items-start gap-3 px-4 py-2.5 border-b border-surface-50 text-xs cursor-pointer hover:bg-surface-50 ${!isSelected ? 'opacity-40' : ''}`}>
                          <input type="checkbox" checked={isSelected} onChange={() => toggleItem(mod, idx)}
                            className="mt-0.5 rounded border-surface-300 text-brand-600 flex-shrink-0" />
                          <div className="flex-1 min-w-0">
                            {mod === 'obligations' && <p className="text-surface-800">{item.description} <span className={`ml-1 px-1 py-0.5 rounded text-[9px] ${item.priority === 'alta' ? 'bg-red-100 text-red-600' : item.priority === 'baja' ? 'bg-surface-100 text-surface-400' : 'bg-amber-100 text-amber-600'}`}>{item.priority}</span> <span className="px-1 py-0.5 rounded text-[9px] bg-surface-100 text-surface-500">{item.type}</span></p>}
                            {mod === 'risks' && <><p className="text-surface-800 font-medium">{item.description}</p><p className="text-surface-400 mt-0.5">Prob: {item.probability} | Impacto: {item.impact} | Mitigación: {item.mitigation}</p></>}
                            {mod === 'team' && <p className="text-surface-800">{item.role} <span className="text-surface-400">x{item.quantity} — {item.dedication} {item.estimated_salary ? `— ${new Intl.NumberFormat('es-CO', {style:'currency',currency:'COP',maximumFractionDigits:0}).format(item.estimated_salary)}/mes` : ''}</span></p>}
                            {mod === 'schedule' && <p className="text-surface-800">{item.activity} <span className="text-surface-400">Mes {item.start_month}-{item.end_month} → {item.deliverable}</span></p>}
                            {mod === 'budget' && <p className="text-surface-800">{item.item} <span className="text-surface-400">[{item.category}] — {new Intl.NumberFormat('es-CO', {style:'currency',currency:'COP',maximumFractionDigits:0}).format(item.monthly_value)}/mes x {item.months}m</span></p>}
                          </div>
                        </label>
                      );
                    })}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Apply button */}
      {(() => {
        const totalSelected = Object.values(selected).filter(Boolean).length;
        return (
          <button onClick={apply} disabled={totalSelected === 0}
            className="w-full btn-primary py-3 text-sm flex items-center justify-center gap-2 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed">
            <CheckCircle2 className="w-4 h-4" /> Aplicar {totalSelected} ítems seleccionados al Proyecto
          </button>
        );
      })()}
    </div>
  );

  // ─── STEP: Applying ───
  if (step === 'applying') return (
    <div className="flex flex-col items-center justify-center py-16">
      <Loader2 className="w-10 h-10 text-emerald-500 animate-spin" />
      <p className="mt-4 text-sm font-medium text-brand-900">Aplicando datos al proyecto...</p>
    </div>
  );

  // ─── STEP: Done ───
  if (step === 'done') return (
    <div className="space-y-4">
      <div className="bg-emerald-50 rounded-xl p-6 border border-emerald-200 text-center">
        <CheckCircle2 className="w-12 h-12 text-emerald-500 mx-auto mb-3" />
        <h3 className="font-display font-bold text-emerald-900 text-lg mb-1">¡Datos Aplicados Exitosamente!</h3>
        <p className="text-sm text-emerald-700">Los módulos han sido poblados. Revise cada pestaña para ajustar los detalles.</p>
      </div>

      {applyResult?.applied && (
        <div className="bg-white rounded-xl border border-surface-100 p-4">
          <h4 className="text-sm font-bold text-brand-900 mb-3">Resumen de Aplicación</h4>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {Object.entries(applyResult.applied).map(([mod, count]) => {
              const cfg = MODULE_CONFIG[mod];
              if (!cfg) return null;
              const Icon = cfg.icon;
              return (
                <div key={mod} className={`flex items-center gap-2 p-3 rounded-lg bg-${cfg.color}-50 border border-${cfg.color}-100`}>
                  <Icon className={`w-4 h-4 text-${cfg.color}-600`} />
                  <div>
                    <p className={`text-xs font-semibold text-${cfg.color}-700`}>{cfg.label}</p>
                    <p className={`text-lg font-display font-bold text-${cfg.color}-800`}>{count}</p>
                  </div>
                </div>
              );
            })}
          </div>
          {applyResult.errors && Object.keys(applyResult.errors).length > 0 && (
            <div className="mt-3 bg-amber-50 rounded-lg p-3 border border-amber-200">
              <p className="text-xs font-semibold text-amber-700 mb-1">Algunos ítems no se insertaron:</p>
              {Object.entries(applyResult.errors).map(([mod, errs]) => (
                <div key={mod} className="text-xs text-amber-800">
                  <span className="font-medium">{MODULE_CONFIG[mod]?.label || mod}:</span> {Array.isArray(errs) ? errs.slice(0, 3).join('; ') : errs}
                  {Array.isArray(errs) && errs.length > 3 && <span className="text-amber-500"> +{errs.length - 3} más</span>}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <button onClick={() => { setStep('config'); setPreview(null); setApplyResult(null); setSelected({}); }}
        className="btn-ghost text-sm mx-auto block">Analizar más documentos</button>
    </div>
  );
}
