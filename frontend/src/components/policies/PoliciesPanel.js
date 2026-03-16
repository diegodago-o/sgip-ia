import React, { useState, useEffect, useCallback } from 'react';
import { policiesAPI, documentsAPI } from '../../services/api';
import {
  Plus, X, Edit2, Trash2, Shield, ShieldAlert, ShieldCheck, ShieldX,
  Clock, Loader2, Save, AlertTriangle, CheckCircle2, FileText,
} from 'lucide-react';

const POLICY_TYPES = [
  { value: 'cumplimiento',         label: 'Cumplimiento' },
  { value: 'calidad',              label: 'Calidad / Estabilidad' },
  { value: 'pago_salarios',        label: 'Pago Salarios y Prestaciones' },
  { value: 'responsabilidad_civil',label: 'Responsabilidad Civil' },
  { value: 'estabilidad_obra',     label: 'Estabilidad de la Obra' },
  { value: 'todo_riesgo',          label: 'Todo Riesgo' },
  { value: 'otra',                 label: 'Otra' },
];
const PTYPE_MAP = Object.fromEntries(POLICY_TYPES.map(p => [p.value, p.label]));

const STATUS_C = {
  vigente:       { label: 'Vigente',        icon: ShieldCheck,  bg: 'bg-emerald-100', text: 'text-emerald-700', ring: 'ring-emerald-300' },
  por_vencer:    { label: 'Por vencer',     icon: ShieldAlert,  bg: 'bg-amber-100',   text: 'text-amber-700',   ring: 'ring-amber-300' },
  vencida:       { label: 'Vencida',        icon: ShieldX,      bg: 'bg-red-100',     text: 'text-red-700',     ring: 'ring-red-300' },
  en_renovacion: { label: 'En renovación',  icon: Shield,       bg: 'bg-blue-100',    text: 'text-blue-700',    ring: 'ring-blue-300' },
  pendiente:     { label: 'Pendiente',      icon: Shield,       bg: 'bg-gray-100',    text: 'text-gray-600',    ring: 'ring-gray-300' },
};

const ALERT_BORDER = {
  expired:  'border-l-4 border-l-red-500',
  critical: 'border-l-4 border-l-red-400',
  warning:  'border-l-4 border-l-amber-400',
  caution:  'border-l-4 border-l-yellow-300',
  notice:   'border-l-4 border-l-blue-300',
  ok:       'border-l-4 border-l-emerald-300',
};

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' }) : '\u2014'; }
function fmtMoney(v) { return v ? new Intl.NumberFormat('es-CO', { style:'currency', currency:'COP', maximumFractionDigits:0 }).format(v) : '\u2014'; }

// ── Stats Bar ──
function StatsBar({ stats }) {
  if (!stats) return null;
  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
      {[
        { label: 'Total', value: stats.total, color: 'text-brand-600', icon: Shield },
        { label: 'Vigentes', value: stats.vigente, color: 'text-emerald-600', icon: ShieldCheck },
        { label: 'Por Vencer', value: stats.por_vencer, color: 'text-amber-600', icon: ShieldAlert, pulse: stats.por_vencer > 0 },
        { label: 'Vencidas', value: stats.vencida, color: 'text-red-600', icon: ShieldX, pulse: stats.vencida > 0 },
        { label: 'Pendientes', value: stats.pendiente, color: 'text-gray-500', icon: Shield },
        { label: 'Valor Asegurado', value: fmtMoney(stats.total_insured), color: 'text-teal-600', icon: Shield, small: true },
      ].map(i => {
        const Icon = i.icon;
        return (
          <div key={i.label} className="flex items-center gap-2 p-3 bg-surface-50 rounded-lg">
            <Icon className={`w-4 h-4 ${i.color} ${i.pulse ? 'animate-pulse' : ''}`} />
            <div>
              <p className={`text-sm font-display font-bold ${i.color}`}>{i.value ?? 0}</p>
              <p className="text-[10px] text-surface-400 uppercase tracking-wide">{i.label}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Modal Form ──
function PolicyModal({ policy, projectId, documents, onClose, onSaved }) {
  const isEdit = Boolean(policy?.id);
  const [form, setForm] = useState({
    policy_type: policy?.policy_type || 'cumplimiento',
    insurer: policy?.insurer || '',
    policy_number: policy?.policy_number || '',
    coverage_pct: policy?.coverage_pct || '',
    insured_value: policy?.insured_value || '',
    issue_date: policy?.issue_date ? policy.issue_date.split('T')[0] : '',
    expiry_date: policy?.expiry_date ? policy.expiry_date.split('T')[0] : '',
    status: policy?.status || 'pendiente',
    document_id: policy?.document_id || '',
    required_by_contract: policy?.required_by_contract ?? 1,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const set = (f) => (e) => setForm(prev => ({ ...prev, [f]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const payload = { ...form };
      if (payload.coverage_pct) payload.coverage_pct = parseFloat(payload.coverage_pct);
      if (payload.insured_value) payload.insured_value = parseFloat(payload.insured_value);
      if (!payload.document_id) delete payload.document_id;
      payload.required_by_contract = payload.required_by_contract ? 1 : 0;

      if (isEdit) {
        await policiesAPI.update(projectId, policy.id, payload);
      } else {
        await policiesAPI.create(projectId, payload);
      }
      onSaved();
    } catch (err) {
      setError(err.response?.data?.error || 'Error guardando');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900 text-lg">
            {isEdit ? 'Editar Póliza' : 'Registrar Póliza'}
          </h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-100 flex items-center justify-center">
            <X className="w-4 h-4 text-surface-400" />
          </button>
        </div>

        {error && <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-brand-800 mb-1">Tipo de Póliza <span className="text-red-400">*</span></label>
              <select value={form.policy_type} onChange={set('policy_type')} className="input-field">
                {POLICY_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">Aseguradora</label>
              <input value={form.insurer} onChange={set('insurer')} className="input-field" placeholder="Nombre de la aseguradora" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">No. Póliza</label>
              <input value={form.policy_number} onChange={set('policy_number')} className="input-field" placeholder="Número de la póliza" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">% Cobertura</label>
              <input type="number" value={form.coverage_pct} onChange={set('coverage_pct')} className="input-field" placeholder="Ej: 10" min="0" max="100" step="0.01" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">Valor Asegurado</label>
              <input type="number" value={form.insured_value} onChange={set('insured_value')} className="input-field" placeholder="Se calcula del %" min="0" step="0.01" />
              <p className="text-[10px] text-surface-400 mt-0.5">Dejar vacío para calcular automáticamente del %</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">Fecha Expedición</label>
              <input type="date" value={form.issue_date} onChange={set('issue_date')} className="input-field" />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">Fecha Vencimiento</label>
              <input type="date" value={form.expiry_date} onChange={set('expiry_date')} className="input-field" />
            </div>
            {isEdit && (
              <div>
                <label className="block text-sm font-medium text-brand-800 mb-1">Estado</label>
                <select value={form.status} onChange={set('status')} className="input-field">
                  {Object.entries(STATUS_C).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1">Documento adjunto</label>
              <select value={form.document_id} onChange={set('document_id')} className="input-field">
                <option value="">Ninguno</option>
                {documents.map(d => <option key={d.id} value={d.id}>{d.file_name}</option>)}
              </select>
            </div>
            <div className="flex items-center gap-2 col-span-2">
              <input type="checkbox" id="req_contract" checked={!!form.required_by_contract}
                onChange={e => setForm(f => ({...f, required_by_contract: e.target.checked ? 1 : 0}))}
                className="w-4 h-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
              <label htmlFor="req_contract" className="text-sm text-brand-800">Requerida por el contrato</label>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEdit ? 'Guardar' : 'Registrar Póliza'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══ Main Panel ═══
export default function PoliciesPanel({ projectId, perms = {} }) {
  const [policies, setPolicies] = useState([]);
  const [stats, setStats] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const [polRes, statsRes] = await Promise.all([
        policiesAPI.list(projectId),
        policiesAPI.stats(projectId),
      ]);
      setPolicies(polRes.data.data);
      setStats(statsRes.data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    documentsAPI.list(projectId).then(({ data }) => setDocuments(data.data)).catch(() => {});
  }, [projectId]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3000);
  };

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar esta póliza?')) return;
    try {
      await policiesAPI.delete(projectId, id);
      showToast('Póliza eliminada');
      load();
    } catch { showToast('Error eliminando', 'error'); }
  };

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up
          ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
          {toast.msg}
        </div>
      )}

      {/* Stats */}
      <StatsBar stats={stats} />

      {/* Toolbar */}
      <div className="flex justify-between items-center">
        <span className="text-xs text-surface-400">{policies.length} póliza{policies.length !== 1 ? 's' : ''}</span>
        {perms.canCreate && <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2 text-sm">
          <Plus className="w-4 h-4" /> Nueva Póliza
        </button>}
      </div>

      {/* Policies cards */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : policies.length === 0 ? (
        <div className="text-center py-12">
          <Shield className="w-10 h-10 text-surface-200 mx-auto mb-3" />
          <p className="text-sm text-surface-400 mb-4">No hay pólizas registradas</p>
          <button onClick={() => setModal('new')} className="btn-primary text-sm">Registrar primera póliza</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {policies.map(pol => {
            const st = STATUS_C[pol.status] || STATUS_C.pendiente;
            const StIcon = st.icon;
            const border = ALERT_BORDER[pol.alert_level] || '';
            const daysText = pol.days_to_expiry !== null
              ? pol.days_to_expiry >= 0
                ? `${pol.days_to_expiry} días restantes`
                : `Venció hace ${Math.abs(pol.days_to_expiry)} días`
              : null;

            return (
              <div key={pol.id}
                className={`group bg-white rounded-lg border border-surface-100 p-4 hover:shadow-card transition-all ${border}`}>
                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-2">
                    <div className={`w-9 h-9 rounded-lg ${st.bg} flex items-center justify-center`}>
                      <StIcon className={`w-4.5 h-4.5 ${st.text}`} />
                    </div>
                    <div>
                      <p className="text-sm font-semibold text-brand-900">{PTYPE_MAP[pol.policy_type] || pol.policy_type}</p>
                      <span className={`inline-flex px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.bg} ${st.text}`}>
                        {st.label}
                      </span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => setModal(pol)} className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center" title="Editar">
                      <Edit2 className="w-3.5 h-3.5 text-surface-400" />
                    </button>
                    <button onClick={() => handleDelete(pol.id)} className="w-7 h-7 rounded hover:bg-red-50 flex items-center justify-center" title="Eliminar">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  </div>
                </div>

                {/* Details */}
                <div className="space-y-1.5 text-sm">
                  {pol.insurer && (
                    <div className="flex justify-between">
                      <span className="text-surface-400">Aseguradora</span>
                      <span className="text-brand-900 font-medium">{pol.insurer}</span>
                    </div>
                  )}
                  {pol.policy_number && (
                    <div className="flex justify-between">
                      <span className="text-surface-400">No. Póliza</span>
                      <span className="text-brand-900 font-mono text-xs">{pol.policy_number}</span>
                    </div>
                  )}
                  {pol.coverage_pct && (
                    <div className="flex justify-between">
                      <span className="text-surface-400">Cobertura</span>
                      <span className="text-brand-900">{pol.coverage_pct}%</span>
                    </div>
                  )}
                  {pol.insured_value && (
                    <div className="flex justify-between">
                      <span className="text-surface-400">Valor</span>
                      <span className="text-brand-900 font-semibold">{fmtMoney(pol.insured_value)}</span>
                    </div>
                  )}
                  <div className="flex justify-between">
                    <span className="text-surface-400">Vigencia</span>
                    <span className="text-brand-900">{fmtDate(pol.issue_date)} — {fmtDate(pol.expiry_date)}</span>
                  </div>
                </div>

                {/* Expiry alert */}
                {daysText && (
                  <div className={`mt-3 flex items-center gap-1.5 text-xs font-medium rounded-md px-2 py-1.5
                    ${pol.alert_level === 'expired' || pol.alert_level === 'critical'
                      ? 'bg-red-50 text-red-700'
                      : pol.alert_level === 'warning'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-surface-50 text-surface-500'}`}>
                    {pol.days_to_expiry < 0 ? <AlertTriangle className="w-3.5 h-3.5" /> : <Clock className="w-3.5 h-3.5" />}
                    {daysText}
                  </div>
                )}

                {/* Document link */}
                {pol.document_name && (
                  <div className="mt-2 flex items-center gap-1 text-xs text-surface-400">
                    <FileText className="w-3 h-3" /> {pol.document_name}
                  </div>
                )}

                {/* Required badge */}
                {pol.required_by_contract === 1 && (
                  <div className="mt-2 text-[10px] text-brand-500 font-semibold uppercase tracking-wide">
                    Requerida por contrato
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Modal */}
      {modal && (
        <PolicyModal
          policy={modal === 'new' ? null : modal}
          projectId={projectId}
          documents={documents}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); showToast(modal === 'new' ? 'Póliza registrada' : 'Póliza actualizada'); load(); }}
        />
      )}
    </div>
  );
}
