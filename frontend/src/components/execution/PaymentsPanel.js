import React, { useState, useEffect, useCallback } from 'react';
import { paymentsAPI } from '../../services/api';
import { Plus, Edit2, Trash2, X, Save, Loader2, DollarSign, Calculator } from 'lucide-react';

const ST = { borrador: { l: 'Borrador', bg: 'bg-slate-100', t: 'text-slate-600' }, presentado: { l: 'Presentado', bg: 'bg-blue-100', t: 'text-blue-700' }, en_revision: { l: 'En revisión', bg: 'bg-amber-100', t: 'text-amber-700' }, aprobado: { l: 'Aprobado', bg: 'bg-emerald-100', t: 'text-emerald-700' }, pagado: { l: 'Pagado', bg: 'bg-green-100', t: 'text-green-700' }, rechazado: { l: 'Rechazado', bg: 'bg-red-100', t: 'text-red-700' } };
const TYPES = { anticipo: 'Anticipo', corte_mensual: 'Corte mensual', corte_parcial: 'Corte parcial', pago_final: 'Pago final', otro: 'Otro' };
function fmtM(v) { return v ? new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(v) : '$0'; }

function PayModal({ item, projectId, onClose, onSaved }) {
  const isEdit = Boolean(item?.id);
  const [form, setForm] = useState({
    concept: item?.concept || '',
    payment_type: item?.payment_type || 'corte_mensual',
    period_from: item?.period_from?.split('T')[0] || '',
    period_to: item?.period_to?.split('T')[0] || '',
    base_value: item?.base_value || 0,
    iva_pct: item?.iva_pct ?? 19,
    amortization: item?.amortization || 0,
    reteiva_pct: item?.reteiva_pct || 0,
    retefuente_pct: item?.retefuente_pct || 0,
    reteica_pct: item?.reteica_pct || 0,
    invoice_number: item?.invoice_number || '',
    invoice_date: item?.invoice_date?.split('T')[0] || '',
    paid_date: item?.paid_date?.split('T')[0] || '',
    notes: item?.notes || '',
    status: item?.status || 'borrador',
  });
  const [saving, setSaving] = useState(false);
  const set = f => e => setForm(d => ({ ...d, [f]: e.target.value }));

  // Live calculation — mirrors backend calcPayment exactly
  const base = parseFloat(form.base_value) || 0;
  const ivaPct = parseFloat(form.iva_pct) || 0;
  const amort = parseFloat(form.amortization) || 0;
  const reteivaPct = parseFloat(form.reteiva_pct) || 0;
  const retefuentePct = parseFloat(form.retefuente_pct) || 0;
  const reteicaPct = parseFloat(form.reteica_pct) || 0;

  const ivaValue = Math.round(base * ivaPct / 100);
  const gross = base + ivaValue;
  const reteivaValue = Math.round(ivaValue * reteivaPct / 100);
  const retefuenteValue = Math.round(base * retefuentePct / 100);
  const reteicaValue = Math.round(base * reteicaPct / 100);
  const totalRetentions = reteivaValue + retefuenteValue + reteicaValue;
  const net = gross - totalRetentions - amort;

  const handle = async e => {
    e.preventDefault(); setSaving(true);
    try {
      if (isEdit) await paymentsAPI.update(projectId, item.id, form);
      else await paymentsAPI.create(projectId, form);
      onSaved();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900">{isEdit ? 'Editar' : 'Nuevo'} Pago</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400" /></button>
        </div>
        <form onSubmit={handle} className="p-5 space-y-3">
          {/* Concepto y Tipo */}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className="block text-xs font-medium text-brand-800 mb-1">Concepto *</label><input value={form.concept} onChange={set('concept')} required className="input-field text-sm" /></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Tipo</label><select value={form.payment_type} onChange={set('payment_type')} className="input-field text-sm">{Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>

          {/* Periodo */}
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Periodo desde</label><input type="date" value={form.period_from} onChange={set('period_from')} className="input-field text-sm" /></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Periodo hasta</label><input type="date" value={form.period_to} onChange={set('period_to')} className="input-field text-sm" /></div>
          </div>

          {/* Base e IVA */}
          <div className="p-3 bg-blue-50 rounded-lg space-y-2">
            <p className="text-xs font-semibold text-blue-800 flex items-center gap-1"><Calculator className="w-3 h-3" /> Base e IVA</p>
            <div className="grid grid-cols-3 gap-2">
              <div className="col-span-2"><label className="block text-[10px] text-blue-700 mb-0.5">Base (sin IVA)</label><input type="number" min="0" step="1" value={form.base_value} onChange={set('base_value')} className="input-field text-sm" /></div>
              <div><label className="block text-[10px] text-blue-700 mb-0.5">IVA %</label><input type="number" min="0" max="100" step="0.01" value={form.iva_pct} onChange={set('iva_pct')} className="input-field text-sm" /></div>
            </div>
            <div className="flex justify-between text-xs text-blue-700 pt-1 border-t border-blue-100">
              <span>IVA ({ivaPct}%): <strong>{fmtM(ivaValue)}</strong></span>
              <span>Factura: <strong className="text-blue-900">{fmtM(gross)}</strong></span>
            </div>
          </div>

          {/* Amortización */}
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Amortización (anticipo)</label><input type="number" min="0" step="1" value={form.amortization} onChange={set('amortization')} className="input-field text-sm" /></div>

          {/* Retenciones */}
          <div className="p-3 bg-amber-50 rounded-lg space-y-2">
            <p className="text-xs font-semibold text-amber-800">Retenciones (% variable por servicio)</p>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="block text-[10px] text-amber-700 mb-0.5">RETEIVA %</label>
                <input type="number" min="0" max="100" step="0.01" value={form.reteiva_pct} onChange={set('reteiva_pct')} className="input-field text-xs" />
                <p className="text-[10px] text-amber-600 mt-0.5">= {fmtM(reteivaValue)}</p>
              </div>
              <div>
                <label className="block text-[10px] text-amber-700 mb-0.5">RETEFUENTE %</label>
                <input type="number" min="0" max="100" step="0.01" value={form.retefuente_pct} onChange={set('retefuente_pct')} className="input-field text-xs" />
                <p className="text-[10px] text-amber-600 mt-0.5">= {fmtM(retefuenteValue)}</p>
              </div>
              <div>
                <label className="block text-[10px] text-amber-700 mb-0.5">RETEICA %</label>
                <input type="number" min="0" max="100" step="0.001" value={form.reteica_pct} onChange={set('reteica_pct')} className="input-field text-xs" />
                <p className="text-[10px] text-amber-600 mt-0.5">= {fmtM(reteicaValue)}</p>
              </div>
            </div>
            <div className="flex justify-between text-xs text-amber-800 pt-1 border-t border-amber-100">
              <span>Total retenciones:</span>
              <strong>{fmtM(totalRetentions)}</strong>
            </div>
          </div>

          {/* Total a Consignar */}
          <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs text-emerald-700">Total a Consignar</p>
                <p className="text-[10px] text-emerald-500">Factura − Retenciones − Amortización</p>
              </div>
              <span className="text-xl font-display font-bold text-emerald-700">{fmtM(net)}</span>
            </div>
          </div>

          {/* Factura info */}
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">No. Factura</label><input value={form.invoice_number} onChange={set('invoice_number')} className="input-field text-sm" /></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Fecha factura</label><input type="date" value={form.invoice_date} onChange={set('invoice_date')} className="input-field text-sm" /></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Fecha pago</label><input type="date" value={form.paid_date} onChange={set('paid_date')} className="input-field text-sm" /></div>
          </div>

          {isEdit && <div><label className="block text-xs font-medium text-brand-800 mb-1">Estado</label><select value={form.status} onChange={set('status')} className="input-field text-sm">{Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</select></div>}
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Notas</label><textarea value={form.notes} onChange={set('notes')} className="input-field text-sm min-h-[40px] resize-y" /></div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-2">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{isEdit ? 'Guardar' : 'Crear'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function PaymentsPanel({ projectId, perms = {} }) {
  const [items, setItems] = useState([]); const [summary, setSummary] = useState(null); const [loading, setLoading] = useState(true); const [modal, setModal] = useState(null); const [toast, setToast] = useState(null);
  const load = useCallback(async () => { try { const [lr, sr] = await Promise.all([paymentsAPI.list(projectId), paymentsAPI.summary(projectId)]); setItems(lr.data.data); setSummary(sr.data.data); } catch {} finally { setLoading(false); }; }, [projectId]);
  useEffect(() => { setLoading(true); load(); }, [load]);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const del = async (id) => { if (!window.confirm('¿Eliminar pago?')) return; await paymentsAPI.delete(projectId, id); showToast('Eliminado'); load(); };
  const quickStatus = async (id, st) => { await paymentsAPI.update(projectId, id, { status: st }); load(); };

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up bg-emerald-600 text-white">{toast}</div>}
      {summary && <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-xs text-surface-400">Total consignado</p><p className="text-sm font-bold text-emerald-600">{fmtM(summary.total_paid)}</p><p className="text-[10px] text-surface-400">{summary.payment_pct}% del contrato</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-xs text-surface-400">Saldo pendiente</p><p className="text-sm font-bold text-brand-700">{fmtM(summary.remaining)}</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-xs text-surface-400">Retenciones acum.</p><p className="text-sm font-bold text-amber-600">{fmtM(summary.total_retained)}</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-xs text-surface-400">Pagos</p><p className="text-sm font-bold text-brand-700">{summary.pagados || 0} / {summary.total || 0}</p></div>
      </div>}

      <div className="flex justify-between items-center">
        <span className="text-xs text-surface-400">{items.length} pago{items.length !== 1 ? 's' : ''}</span>
        {perms.canCreate && <button onClick={() => setModal({})} className="btn-primary text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" /> Nuevo Pago</button>}
      </div>

      {items.length === 0 ? <p className="text-center py-8 text-surface-400 text-sm">Sin pagos registrados</p> :
        <div className="space-y-2">{items.map(p => {
          const s = ST[p.status] || ST.borrador;
          return (
            <div key={p.id} className="group bg-white border border-surface-100 rounded-lg p-4 hover:border-surface-200 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-brand-500 font-semibold">#{p.payment_number}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.bg} ${s.t}`}>{s.l}</span>
                    <span className="text-[10px] text-surface-400">{TYPES[p.payment_type] || p.payment_type}</span>
                  </div>
                  <p className="text-sm font-medium text-brand-900">{p.concept}</p>
                  {p.invoice_number && <p className="text-xs text-surface-400 mt-0.5">Factura: {p.invoice_number}</p>}
                </div>
                <div className="text-right flex-shrink-0">
                  <p className="text-lg font-display font-bold text-emerald-700">{fmtM(p.net_value)}</p>
                  <p className="text-[10px] text-surface-400">Factura: {fmtM(p.gross_value)}</p>
                </div>
              </div>
              <div className="flex items-center justify-between mt-3 pt-2 border-t border-surface-50">
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-surface-400">
                  <span>Base: {fmtM(p.base_value)}</span>
                  <span>IVA: {fmtM(p.iva_value)}</span>
                  {parseFloat(p.reteiva_value) > 0 && <span>RteIVA: {fmtM(p.reteiva_value)}</span>}
                  {parseFloat(p.retefuente_value) > 0 && <span>RteFte: {fmtM(p.retefuente_value)}</span>}
                  {parseFloat(p.reteica_value) > 0 && <span>RteICA: {fmtM(p.reteica_value)}</span>}
                  {parseFloat(p.amortization) > 0 && <span>Amort: {fmtM(p.amortization)}</span>}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {perms.canEdit && p.status === 'borrador' && <button onClick={() => quickStatus(p.id, 'presentado')} className="px-2 py-1 rounded text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100">Presentar</button>}
                  {perms.canEdit && p.status === 'en_revision' && <button onClick={() => quickStatus(p.id, 'aprobado')} className="px-2 py-1 rounded text-[10px] bg-emerald-50 text-emerald-600 hover:bg-emerald-100">Aprobar</button>}
                  {perms.canEdit && p.status === 'aprobado' && <button onClick={() => quickStatus(p.id, 'pagado')} className="px-2 py-1 rounded text-[10px] bg-green-50 text-green-600 hover:bg-green-100">Marcar pagado</button>}
                  {perms.canEdit && <button onClick={() => setModal(p)} className="w-6 h-6 rounded hover:bg-surface-100 flex items-center justify-center"><Edit2 className="w-3 h-3 text-surface-400" /></button>}
                  {perms.canDelete && <button onClick={() => del(p.id)} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-3 h-3 text-red-400" /></button>}
                </div>
              </div>
            </div>
          );
        })}</div>}
      {modal && <PayModal item={modal.id ? modal : null} projectId={projectId} onClose={() => setModal(null)} onSaved={() => { setModal(null); showToast(modal.id ? 'Actualizado' : 'Creado'); load(); }} />}
    </div>
  );
}
