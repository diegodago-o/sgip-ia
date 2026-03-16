import React, { useState, useEffect, useCallback } from 'react';
import { liquidationAPI, exportsAPI } from '../../services/api';
import { Save, Loader2, FileSignature, AlertTriangle, CheckCircle2, DollarSign, Download, FileText } from 'lucide-react';

const LT = { bilateral: 'Bilateral', unilateral: 'Unilateral', judicial: 'Judicial' };
const LS = { borrador: { l: 'Borrador', bg: 'bg-amber-100', t: 'text-amber-700' }, en_revision: { l: 'En revisión', bg: 'bg-blue-100', t: 'text-blue-700' }, firmada: { l: 'Firmada', bg: 'bg-emerald-100', t: 'text-emerald-700' }, archivada: { l: 'Archivada', bg: 'bg-slate-100', t: 'text-slate-600' } };
const BF = { contratista: 'A favor del contratista', entidad: 'A favor de la entidad', equilibrio: 'En equilibrio' };

function fmtM(v) { return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v || 0); }
function fmtD(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' }) : '—'; }

export default function LiquidationPanel({ projectId, perms = {} }) {
  const [data, setData] = useState(null);
  const [form, setForm] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const r = await liquidationAPI.get(projectId);
      setData(r.data.data);
      setForm(r.data.data);
    } catch {} finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const set = f => e => {
    const v = e.target.value;
    setForm(d => {
      const n = { ...d, [f]: v };
      if (['final_contract_value', 'total_paid', 'retention_release'].includes(f)) {
        const fv = parseFloat(n.final_contract_value) || 0;
        const tp = parseFloat(n.total_paid) || 0;
        const rr = parseFloat(n.retention_release) || 0;
        const bal = fv - tp - rr;
        n.balance_amount = Math.abs(bal);
        n.balance_in_favor_of = bal > 0 ? 'contratista' : bal < 0 ? 'entidad' : 'equilibrio';
      }
      return n;
    });
  };

  const handleSave = async () => {
    if (form.status === 'firmada' && !window.confirm('¿Está seguro de firmar el acta? Esto cambiará el proyecto a estado "Liquidado".')) return;
    setSaving(true);
    try {
      await liquidationAPI.save(projectId, form);
      setToast('Acta de liquidación guardada');
      setTimeout(() => setToast(null), 2500);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Error al guardar'); }
    finally { setSaving(false); }
  };

  const handleExport = async () => {
    setExporting(true);
    try {
      const r = await exportsAPI.liquidationToWord(projectId);
      const url = URL.createObjectURL(new Blob([r.data]));
      const a = document.createElement('a'); a.href = url;
      a.download = `Acta_Liquidacion.docx`; a.click();
      URL.revokeObjectURL(url);
    } catch (err) { alert('Error exportando: ' + (err.response?.data?.error || err.message)); }
    finally { setExporting(false); }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;
  if (!data) return <p className="text-center py-8 text-surface-400 text-sm">Error cargando datos</p>;

  // CRITICAL FIX: use SAVED state (data.status) for disabling fields, not form.status
  // This prevents the save button from disappearing when user selects 'firmada' in dropdown
  const savedIsSigned = data.status === 'firmada' || data.status === 'archivada';
  const st = LS[form.status] || LS.borrador;

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up bg-emerald-600 text-white">{toast}</div>}

      {/* Status banner */}
      <div className={`flex items-center justify-between p-3 rounded-lg ${savedIsSigned ? 'bg-emerald-50 border border-emerald-200' : 'bg-amber-50 border border-amber-200'}`}>
        <div className="flex items-center gap-2">
          {savedIsSigned ? <CheckCircle2 className="w-5 h-5 text-emerald-600" /> : <FileSignature className="w-5 h-5 text-amber-600" />}
          <span className={`text-sm font-medium ${savedIsSigned ? 'text-emerald-800' : 'text-amber-800'}`}>
            {savedIsSigned ? 'Acta de liquidación firmada' : data._is_draft ? 'Datos auto-calculados. Revise y guarde.' : 'Acta en elaboración'}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <span className={`px-2 py-0.5 rounded text-xs font-medium ${st.bg} ${st.t}`}>{st.l}</span>
          {/* Export button — always visible when record exists */}
          {!data._is_draft && (
            <button onClick={handleExport} disabled={exporting}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-surface-200 rounded-lg text-xs font-medium text-brand-700 hover:bg-surface-50 hover:border-brand-300 transition-colors">
              {exporting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
              Exportar Word
            </button>
          )}
        </div>
      </div>

      {/* Financial summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-[10px] text-surface-400">Valor original</p><p className="text-sm font-bold text-brand-700">{fmtM(form.original_value)}</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-[10px] text-surface-400">Adiciones</p><p className="text-sm font-bold text-amber-600">{fmtM(form.additions_value)}</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-[10px] text-surface-400">Valor final</p><p className="text-sm font-bold text-brand-900">{fmtM(form.final_contract_value)}</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-[10px] text-surface-400">Total pagado</p><p className="text-sm font-bold text-emerald-600">{fmtM(form.total_paid)}</p></div>
      </div>

      {/* Form sections */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Financial balance */}
        <div className="bg-white border border-surface-100 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-brand-900 flex items-center gap-2"><DollarSign className="w-4 h-4" /> Balance Financiero</h4>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Valor original contrato</label><input type="number" value={form.original_value || 0} onChange={set('original_value')} className="input-field text-sm" disabled={savedIsSigned} /></div>
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Valor adiciones</label><input type="number" value={form.additions_value || 0} onChange={set('additions_value')} className="input-field text-sm" disabled={savedIsSigned} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Valor final contrato</label><input type="number" value={form.final_contract_value || 0} onChange={set('final_contract_value')} className="input-field text-sm font-semibold" disabled={savedIsSigned} /></div>
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Total pagado</label><input type="number" value={form.total_paid || 0} onChange={set('total_paid')} className="input-field text-sm" disabled={savedIsSigned} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Retenciones acumuladas</label><input type="number" value={form.total_retained || 0} onChange={set('total_retained')} className="input-field text-sm" disabled={savedIsSigned} /></div>
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Liberación retenciones</label><input type="number" value={form.retention_release || 0} onChange={set('retention_release')} className="input-field text-sm" disabled={savedIsSigned} /></div>
          </div>
          <div className={`p-3 rounded-lg ${form.balance_in_favor_of === 'equilibrio' ? 'bg-emerald-50' : form.balance_in_favor_of === 'entidad' ? 'bg-red-50' : 'bg-amber-50'}`}>
            <p className="text-xs font-medium text-surface-500">Saldo</p>
            <p className="text-lg font-display font-bold text-brand-900">{fmtM(form.balance_amount)}</p>
            <p className="text-xs text-surface-400">{BF[form.balance_in_favor_of] || 'En equilibrio'}</p>
          </div>
        </div>

        {/* Dates & execution */}
        <div className="bg-white border border-surface-100 rounded-lg p-4 space-y-3">
          <h4 className="text-sm font-semibold text-brand-900">Plazos y Ejecución</h4>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Tipo liquidación</label><select value={form.liquidation_type || 'bilateral'} onChange={set('liquidation_type')} className="input-field text-sm" disabled={savedIsSigned}>{Object.entries(LT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Fecha liquidación</label><input type="date" value={form.liquidation_date?.split('T')[0] || ''} onChange={set('liquidation_date')} className="input-field text-sm" disabled={savedIsSigned} /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Inicio original</label><input type="date" value={form.original_start_date?.split('T')[0] || ''} onChange={set('original_start_date')} className="input-field text-sm" disabled={savedIsSigned} /></div>
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Fin original</label><input type="date" value={form.original_end_date?.split('T')[0] || ''} onChange={set('original_end_date')} className="input-field text-sm" disabled={savedIsSigned} /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Fecha fin real</label><input type="date" value={form.actual_end_date?.split('T')[0] || ''} onChange={set('actual_end_date')} className="input-field text-sm" disabled={savedIsSigned} /></div>
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Días adición</label><input type="number" value={form.total_additions_days || 0} onChange={set('total_additions_days')} className="input-field text-sm" disabled={savedIsSigned} /></div>
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Días suspensión</label><input type="number" value={form.total_suspension_days || 0} onChange={set('total_suspension_days')} className="input-field text-sm" disabled={savedIsSigned} /></div>
          </div>
          <div><label className="block text-[10px] font-medium text-brand-800 mb-1">% Ejecución física</label><input type="number" min="0" max="100" step="0.1" value={form.physical_completion_pct || 0} onChange={set('physical_completion_pct')} className="input-field text-sm" disabled={savedIsSigned} /></div>
          <div className="grid grid-cols-2 gap-3 pt-2 border-t border-surface-100">
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Firma contratista</label><input value={form.signed_by_contractor || ''} onChange={set('signed_by_contractor')} className="input-field text-sm" disabled={savedIsSigned} placeholder="Nombre completo" /></div>
            <div><label className="block text-[10px] font-medium text-brand-800 mb-1">Firma entidad</label><input value={form.signed_by_entity || ''} onChange={set('signed_by_entity')} className="input-field text-sm" disabled={savedIsSigned} placeholder="Nombre completo" /></div>
          </div>
        </div>
      </div>

      {/* Observations */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div><label className="block text-xs font-medium text-brand-800 mb-1">Obligaciones pendientes</label><textarea value={form.pending_obligations || ''} onChange={set('pending_obligations')} className="input-field text-sm min-h-[60px] resize-y" disabled={savedIsSigned} /></div>
        <div><label className="block text-xs font-medium text-brand-800 mb-1">Observaciones del contratista</label><textarea value={form.contractor_observations || ''} onChange={set('contractor_observations')} className="input-field text-sm min-h-[60px] resize-y" disabled={savedIsSigned} /></div>
      </div>
      <div><label className="block text-xs font-medium text-brand-800 mb-1">Observaciones de la entidad</label><textarea value={form.entity_observations || ''} onChange={set('entity_observations')} className="input-field text-sm min-h-[60px] resize-y" disabled={savedIsSigned} /></div>

      {/* Status + Save — always visible if not signed in DB */}
      {!savedIsSigned && perms.canEdit && (
        <div className="flex items-center justify-between pt-4 border-t border-surface-100">
          <div className="flex items-center gap-3">
            <label className="text-xs font-medium text-brand-800">Estado:</label>
            <select value={form.status || 'borrador'} onChange={set('status')} className="input-field text-sm w-40">
              {Object.entries(LS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
            </select>
            {form.status === 'firmada' && <span className="flex items-center gap-1 text-xs text-amber-600"><AlertTriangle className="w-3 h-3" /> Firmar cambiará el proyecto a "Liquidado"</span>}
          </div>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar Acta
          </button>
        </div>
      )}

      {/* If already signed, show read-only info + export */}
      {savedIsSigned && (
        <div className="flex items-center justify-between pt-4 border-t border-surface-100">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-600" />
            <span className="text-sm text-emerald-700 font-medium">Acta {data.status === 'firmada' ? 'firmada' : 'archivada'} — Solo lectura</span>
          </div>
          <button onClick={handleExport} disabled={exporting} className="btn-primary text-sm flex items-center gap-2 bg-brand-700 hover:bg-brand-800">
            {exporting ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />} Descargar Acta Word
          </button>
        </div>
      )}
    </div>
  );
}
