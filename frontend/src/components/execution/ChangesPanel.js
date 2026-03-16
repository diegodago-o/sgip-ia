import React, { useState, useEffect, useCallback } from 'react';
import { changesAPI } from '../../services/api';
import { Plus, Edit2, Trash2, X, Save, Loader2, ArrowUpRight, ArrowDownRight, Clock, AlertTriangle, CheckCircle2, Zap } from 'lucide-react';

const CT = { adicion_presupuestal:'Adición presupuestal', adicion_plazo:'Adición de plazo', modificacion_alcance:'Modificación alcance', otro_si:'Otrosí', suspension:'Suspensión', reinicio:'Reinicio' };
const CS = {
  solicitado:   { l:'Solicitado',    bg:'bg-blue-100',    t:'text-blue-700' },
  en_revision:  { l:'En revisión',   bg:'bg-amber-100',   t:'text-amber-700' },
  aprobado:     { l:'Aprobado',      bg:'bg-emerald-100', t:'text-emerald-700' },
  rechazado:    { l:'Rechazado',     bg:'bg-red-100',     t:'text-red-700' },
  implementado: { l:'Implementado',  bg:'bg-green-100',   t:'text-green-700' },
};
function fmtM(v) { return v ? new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v) : '$0'; }

function ChangeModal({ item, projectId, onClose, onSaved }) {
  const isEdit = Boolean(item?.id);
  const [form, setForm] = useState({
    title: item?.title || '', change_type: item?.change_type || 'otro_si',
    justification: item?.justification || '',
    requested_date: item?.requested_date?.split('T')[0] || new Date().toISOString().split('T')[0],
    impact_cost: item?.impact_cost || 0, impact_days: item?.impact_days || 0,
    notes: item?.notes || '', status: item?.status || 'solicitado',
  });
  const [saving, setSaving] = useState(false);
  const set = f => e => setForm(d => ({ ...d, [f]: e.target.value }));

  const handle = async e => {
    e.preventDefault();

    // Confirmation when implementing
    if (isEdit && form.status === 'implementado' && item?.status !== 'implementado') {
      const cost = parseFloat(form.impact_cost || item?.impact_cost || 0);
      const days = parseInt(form.impact_days || item?.impact_days || 0);
      let msg = '¿Implementar este cambio?\n\nEsto actualizará automáticamente:';
      if (cost) msg += '\n• Valor del contrato (' + (cost > 0 ? '+' : '') + fmtM(cost) + ')';
      if (days) msg += '\n• Fecha fin del proyecto (+' + days + ' días)';
      msg += '\n• Presupuesto de ingresos';
      msg += '\n• Flujo mensual de ingresos';
      if (!window.confirm(msg)) return;
    }

    setSaving(true);
    try {
      if (isEdit) await changesAPI.update(projectId, item.id, form);
      else await changesAPI.create(projectId, form);
      onSaved();
    } catch (err) { alert(err.response?.data?.error || 'Error'); } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900">{isEdit ? 'Editar' : 'Nuevo'} Cambio</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400" /></button>
        </div>
        <form onSubmit={handle} className="p-5 space-y-3">
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Título *</label><input value={form.title} onChange={set('title')} required className="input-field text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Tipo</label><select value={form.change_type} onChange={set('change_type')} className="input-field text-sm">{Object.entries(CT).map(([k,v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Fecha solicitud</label><input type="date" value={form.requested_date} onChange={set('requested_date')} className="input-field text-sm" /></div>
          </div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Justificación *</label><textarea value={form.justification} onChange={set('justification')} required className="input-field text-sm min-h-[60px] resize-y" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Impacto en costo ($)</label><input type="number" step="1000" value={form.impact_cost} onChange={set('impact_cost')} className="input-field text-sm" /></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Impacto en plazo (días)</label><input type="number" step="1" value={form.impact_days} onChange={set('impact_days')} className="input-field text-sm" /></div>
          </div>
          {isEdit && (
            <div>
              <label className="block text-xs font-medium text-brand-800 mb-1">Estado</label>
              <select value={form.status} onChange={set('status')} className="input-field text-sm">
                {Object.entries(CS).map(([k,v]) => <option key={k} value={k}>{v.l}</option>)}
              </select>
              {form.status === 'implementado' && item?.status !== 'implementado' && (
                <p className="text-[10px] text-amber-600 mt-1 flex items-center gap-1">
                  <AlertTriangle className="w-3 h-3" /> Al implementar se propagará el cambio al valor del contrato, presupuesto y flujo de ingresos.
                </p>
              )}
            </div>
          )}
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Notas</label><textarea value={form.notes} onChange={set('notes')} className="input-field text-sm min-h-[40px] resize-y" /></div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEdit ? 'Guardar' : 'Registrar'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function ChangesPanel({ projectId, perms = {}, onProjectChanged }) {
  const [items, setItems] = useState([]);
  const [summary, setSummary] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const [lr, sr] = await Promise.all([changesAPI.list(projectId), changesAPI.summary(projectId)]);
      setItems(lr.data.data); setSummary(sr.data.data);
    } catch {} finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 3000); };

  const del = async (id, title, status) => {
    const msg = status === 'implementado'
      ? '¿Eliminar "' + title + '"?\n\nEste cambio está implementado. Al eliminarlo se REVERTIRÁN los valores del contrato y presupuesto.'
      : '¿Eliminar "' + title + '"?';
    if (!window.confirm(msg)) return;
    await changesAPI.delete(projectId, id);
    showToast('Eliminado' + (status === 'implementado' ? ' (valores revertidos)' : ''));
    load();
    if (status === 'implementado' && onProjectChanged) onProjectChanged();
  };

  const handleSaved = () => {
    setModal(null);
    showToast(modal?.id ? 'Actualizado' : 'Registrado');
    load();
    if (onProjectChanged) onProjectChanged();
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;

  const hasImpact = summary && (parseFloat(summary.total_cost_impact) !== 0 || parseInt(summary.total_days_impact) !== 0);

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up bg-emerald-600 text-white">{toast}</div>}

      {/* Summary stats */}
      {summary && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-surface-50 rounded-lg"><p className="text-xs text-surface-400">Total cambios</p><p className="text-sm font-bold text-brand-700">{summary.total || 0}</p></div>
          <div className="p-3 bg-surface-50 rounded-lg"><p className="text-xs text-surface-400">Aprobados</p><p className="text-sm font-bold text-emerald-600">{summary.approved || 0}</p></div>
          <div className="p-3 bg-surface-50 rounded-lg"><p className="text-xs text-surface-400">Impacto en costo</p><p className={`text-sm font-bold ${parseFloat(summary.total_cost_impact) > 0 ? 'text-amber-600' : 'text-surface-400'}`}>{fmtM(summary.total_cost_impact)}</p></div>
          <div className="p-3 bg-surface-50 rounded-lg"><p className="text-xs text-surface-400">Impacto en plazo</p><p className={`text-sm font-bold ${parseInt(summary.total_days_impact) > 0 ? 'text-amber-600' : 'text-surface-400'}`}>{summary.total_days_impact || 0} días</p></div>
        </div>
      )}

      {/* Contract value impact banner */}
      {hasImpact && summary.original_contract_value > 0 && (
        <div className="flex items-center gap-3 px-4 py-3 bg-amber-50 border border-amber-200 rounded-lg">
          <Zap className="w-4 h-4 text-amber-500 flex-shrink-0" />
          <div className="text-xs text-amber-800">
            <span className="font-medium">Valor original:</span> {fmtM(summary.original_contract_value)}
            <span className="mx-2">→</span>
            <span className="font-bold">Valor actual:</span> {fmtM(summary.current_contract_value)}
            <span className="ml-2 text-amber-600">({parseFloat(summary.total_cost_impact) > 0 ? '+' : ''}{fmtM(summary.total_cost_impact)})</span>
          </div>
        </div>
      )}

      <div className="flex justify-between items-center">
        <span className="text-xs text-surface-400">{items.length} cambio{items.length !== 1 ? 's' : ''}</span>
        {perms.canCreate && <button onClick={() => setModal({})} className="btn-primary text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" /> Nuevo Cambio</button>}
      </div>

      {items.length === 0 ? <p className="text-center py-8 text-surface-400 text-sm">Sin cambios registrados</p> :
        <div className="space-y-2">{items.map(c => {
          const s = CS[c.status] || CS.solicitado;
          const cost = parseFloat(c.impact_cost) || 0;
          const days = parseInt(c.impact_days) || 0;
          return (
            <div key={c.id} className="group bg-white border border-surface-100 rounded-lg p-4 hover:border-surface-200 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-mono text-xs text-brand-500 font-semibold">#{c.change_number}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.bg} ${s.t}`}>{s.l}</span>
                    <span className="text-[10px] text-surface-400">{CT[c.change_type] || c.change_type}</span>
                    {c.status === 'implementado' && <CheckCircle2 className="w-3 h-3 text-green-500" />}
                  </div>
                  <p className="text-sm font-medium text-brand-900">{c.title}</p>
                  <p className="text-xs text-surface-400 mt-0.5 line-clamp-2">{c.justification}</p>
                </div>
                <div className="flex flex-col items-end gap-1 flex-shrink-0">
                  {cost !== 0 && <span className={`flex items-center gap-0.5 text-xs font-semibold ${cost > 0 ? 'text-amber-600' : 'text-emerald-600'}`}>{cost > 0 ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}{fmtM(Math.abs(cost))}</span>}
                  {days !== 0 && <span className="flex items-center gap-0.5 text-xs text-surface-400"><Clock className="w-3 h-3" />{days > 0 ? '+' : ''}{days} días</span>}
                  {c.new_contract_value && <span className="text-[10px] text-surface-300">Nuevo: {fmtM(c.new_contract_value)}</span>}
                </div>
              </div>
              <div className="flex items-center justify-between mt-2 pt-2 border-t border-surface-50">
                <span className="text-[10px] text-surface-400">
                  {new Date(c.requested_date).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'})}
                  {c.approved_by_name ? ' · Aprobado por ' + c.approved_by_name : ''}
                </span>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  {perms.canEdit && <button onClick={() => setModal(c)} className="w-6 h-6 rounded hover:bg-surface-100 flex items-center justify-center"><Edit2 className="w-3 h-3 text-surface-400" /></button>}
                  {perms.canDelete && <button onClick={() => del(c.id, c.title, c.status)} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-3 h-3 text-red-400" /></button>}
                </div>
              </div>
            </div>
          );
        })}</div>}

      {modal && <ChangeModal item={modal.id ? modal : null} projectId={projectId} onClose={() => setModal(null)} onSaved={handleSaved} />}
    </div>
  );
}
