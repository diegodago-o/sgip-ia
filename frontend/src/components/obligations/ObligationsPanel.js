import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { obligationsAPI, documentsAPI, projectsAPI } from '../../services/api';
import {
  Plus, Search, Filter, X, Edit2, Trash2, AlertTriangle,
  Clock, CheckCircle2, Circle, Ban, Loader2, Save,
  FileText, ChevronDown, ChevronRight, ClipboardList, ListChecks,
} from 'lucide-react';

// ── Constants ──
const STATUS_C = {
  pendiente: { label: 'Pendiente',  icon: Circle,        bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  en_curso:  { label: 'En curso',   icon: Clock,         bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  cumplida:  { label: 'Cumplida',   icon: CheckCircle2,  bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  vencida:   { label: 'Vencida',    icon: AlertTriangle, bg: 'bg-red-100',     text: 'text-red-700',     dot: 'bg-red-500' },
  no_aplica: { label: 'No aplica',  icon: Ban,           bg: 'bg-gray-100',    text: 'text-gray-500',    dot: 'bg-gray-400' },
};

const STATUS_ORDER = ['vencida', 'pendiente', 'en_curso', 'cumplida', 'no_aplica'];

const RISK_C = {
  alto:  { label: 'Alto',  bg: 'bg-red-100',    text: 'text-red-700',    dot: 'bg-red-500' },
  medio: { label: 'Medio', bg: 'bg-amber-100',  text: 'text-amber-700',  dot: 'bg-amber-500' },
  bajo:  { label: 'Bajo',  bg: 'bg-green-100',  text: 'text-green-700',  dot: 'bg-green-500' },
};

const TYPE_C = {
  hacer:     { label: 'Hacer',     color: 'text-blue-600' },
  entregar:  { label: 'Entregar',  color: 'text-emerald-600' },
  no_hacer:  { label: 'No hacer',  color: 'text-orange-600' },
  condicion: { label: 'Condición', color: 'text-violet-600' },
};

const PERIOD_OPTS = [
  { value: 'unica', label: 'Única' }, { value: 'diaria', label: 'Diaria' },
  { value: 'semanal', label: 'Semanal' }, { value: 'quincenal', label: 'Quincenal' },
  { value: 'mensual', label: 'Mensual' }, { value: 'bimestral', label: 'Bimestral' },
  { value: 'trimestral', label: 'Trimestral' }, { value: 'semestral', label: 'Semestral' },
  { value: 'anual', label: 'Anual' }, { value: 'al_cierre', label: 'Al cierre' },
];

const ALERT_STYLES = {
  overdue: 'border-l-4 border-l-red-500 bg-red-50/50',
  urgent:  'border-l-4 border-l-amber-500 bg-amber-50/30',
  upcoming:'border-l-4 border-l-blue-400',
  ok:      'border-l-4 border-l-emerald-400',
  normal:  '',
};

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' }) : '\u2014'; }

// ── Stats Bar ──
function StatsBar({ stats }) {
  if (!stats) return null;
  const items = [
    { label: 'Total', value: stats.total || 0, color: 'text-brand-600' },
    { label: 'Pendientes', value: stats.pendiente || 0, color: 'text-blue-600' },
    { label: 'En curso', value: stats.en_curso || 0, color: 'text-amber-600' },
    { label: 'Cumplidas', value: stats.cumplida || 0, color: 'text-emerald-600' },
    { label: 'Vencidas', value: stats.vencida || 0, color: 'text-red-600', bold: (stats.vencida || 0) > 0 },
    { label: 'Próx. 7 días', value: stats.due_this_week || 0, color: 'text-orange-600' },
    { label: 'Riesgo alto', value: stats.riesgo_alto || 0, color: 'text-red-600' },
  ];
  return (
    <div className="flex flex-wrap gap-4 p-3 bg-surface-50 rounded-lg">
      {items.map(i => (
        <div key={i.label} className="text-center">
          <p className={`text-lg font-display font-bold ${i.color} ${i.bold ? 'animate-pulse' : ''}`}>{i.value}</p>
          <p className="text-[10px] text-surface-400 uppercase tracking-wide">{i.label}</p>
        </div>
      ))}
    </div>
  );
}

// ── Modal Form ──
function ObligationModal({ obligation, projectId, documents, directors, onClose, onSaved }) {
  const isEdit = Boolean(obligation?.id);
  const [form, setForm] = useState({
    description: obligation?.description || '',
    obligation_type: obligation?.obligation_type || 'hacer',
    periodicity: obligation?.periodicity || 'unica',
    due_date: obligation?.due_date ? obligation.due_date.split('T')[0] : '',
    due_date_rule: obligation?.due_date_rule || '',
    risk_level: obligation?.risk_level || 'medio',
    responsible_user_id: obligation?.responsible_user_id || '',
    responsible_role: obligation?.responsible_role || '',
    source_document_id: obligation?.source_document_id || '',
    source_clause: obligation?.source_clause || '',
    status: obligation?.status || 'pendiente',
    notes: obligation?.notes || '',
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
      if (!payload.responsible_user_id) delete payload.responsible_user_id;
      if (!payload.source_document_id) delete payload.source_document_id;
      if (isEdit) { await obligationsAPI.update(projectId, obligation.id, payload); }
      else { await obligationsAPI.create(projectId, payload); }
      onSaved();
    } catch (err) { setError(err.response?.data?.error || 'Error guardando'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900 text-lg">{isEdit ? 'Editar Obligación' : 'Nueva Obligación'}</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-100 flex items-center justify-center"><X className="w-4 h-4 text-surface-400" /></button>
        </div>
        {error && <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">{error}</div>}
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-brand-800 mb-1">Descripción <span className="text-red-400">*</span></label>
            <textarea value={form.description} onChange={set('description')} required className="input-field min-h-[80px] resize-y" placeholder="Describa la obligación contractual..." />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Tipo <span className="text-red-400">*</span></label>
              <select value={form.obligation_type} onChange={set('obligation_type')} className="input-field">{Object.entries(TYPE_C).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Periodicidad</label>
              <select value={form.periodicity} onChange={set('periodicity')} className="input-field">{PERIOD_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Fecha límite</label>
              <input type="date" value={form.due_date} onChange={set('due_date')} className="input-field" /></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Regla de fecha</label>
              <input value={form.due_date_rule} onChange={set('due_date_rule')} className="input-field" placeholder="Ej: 5 días hábiles después del corte" /></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Nivel de riesgo</label>
              <select value={form.risk_level} onChange={set('risk_level')} className="input-field"><option value="alto">Alto</option><option value="medio">Medio</option><option value="bajo">Bajo</option></select></div>
            {isEdit && <div><label className="block text-sm font-medium text-brand-800 mb-1">Estado</label>
              <select value={form.status} onChange={set('status')} className="input-field">{Object.entries(STATUS_C).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}</select></div>}
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Responsable</label>
              <select value={form.responsible_user_id} onChange={set('responsible_user_id')} className="input-field"><option value="">Sin asignar</option>{directors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Rol responsable</label>
              <input value={form.responsible_role} onChange={set('responsible_role')} className="input-field" placeholder="Ej: Director del Proyecto" /></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Documento fuente</label>
              <select value={form.source_document_id} onChange={set('source_document_id')} className="input-field"><option value="">Ninguno</option>{documents.map(d => <option key={d.id} value={d.id}>{d.file_name}</option>)}</select></div>
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Cláusula fuente</label>
              <input value={form.source_clause} onChange={set('source_clause')} className="input-field" placeholder="Ej: Cláusula 5.3.2" /></div>
          </div>
          <div><label className="block text-sm font-medium text-brand-800 mb-1">Notas</label>
            <textarea value={form.notes} onChange={set('notes')} className="input-field min-h-[60px] resize-y" placeholder="Notas adicionales..." /></div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{isEdit ? 'Guardar' : 'Crear Obligación'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ── Obligation Row ──
function ObligationRow({ obl, selected, onToggle, onEdit, onDelete, onQuickStatus, perms }) {
  const st = STATUS_C[obl.status] || STATUS_C.pendiente;
  const rk = RISK_C[obl.risk_level] || RISK_C.medio;
  const tp = TYPE_C[obl.obligation_type] || TYPE_C.hacer;
  const alertStyle = ALERT_STYLES[obl.alert_level] || '';
  const StIcon = st.icon;

  return (
    <div className={`group bg-white rounded-lg border border-surface-100 p-3 hover:shadow-card transition-all ${alertStyle}`}>
      <div className="flex items-start gap-2.5">
        <input type="checkbox" checked={selected} onChange={onToggle}
          className="mt-1 w-4 h-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500 flex-shrink-0 cursor-pointer" />
        <div className="mt-0.5 flex-shrink-0"><StIcon className={`w-4 h-4 ${st.text}`} /></div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <span className="font-mono text-[11px] text-brand-500 font-semibold">{obl.code}</span>
            <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${rk.bg} ${rk.text}`}>{rk.label}</span>
            <span className={`text-[10px] font-medium ${tp.color}`}>{tp.label}</span>
          </div>
          <p className="text-sm text-brand-900 leading-relaxed">{obl.description}</p>
          <div className="flex items-center gap-3 mt-1.5 flex-wrap">
            {obl.due_date && (
              <span className={`text-[11px] flex items-center gap-1 ${obl.alert_level === 'overdue' ? 'text-red-600 font-semibold' : obl.alert_level === 'urgent' ? 'text-amber-600 font-medium' : 'text-surface-400'}`}>
                <Clock className="w-3 h-3" /> {fmtDate(obl.due_date)}
                {obl.days_remaining !== null && <span>({obl.days_remaining >= 0 ? `${obl.days_remaining}d` : `${Math.abs(obl.days_remaining)}d atraso`})</span>}
              </span>
            )}
            {obl.periodicity && obl.periodicity !== 'unica' && <span className="text-[11px] text-surface-400 capitalize">{obl.periodicity}</span>}
            {obl.responsible_name && <span className="text-[11px] text-surface-400">{obl.responsible_name}</span>}
            {obl.source_document_name && (
              <span className="text-[11px] text-surface-400 flex items-center gap-1"><FileText className="w-3 h-3" /> {obl.source_clause || obl.source_document_name}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-0.5 flex-shrink-0">
          {obl.status !== 'cumplida' && obl.status !== 'no_aplica' && (
            <button onClick={() => onQuickStatus(obl.id, 'cumplida')} className="w-7 h-7 rounded hover:bg-emerald-50 flex items-center justify-center" title="Marcar cumplida">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" /></button>
          )}
          <button onClick={() => onEdit(obl)} className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Editar">
            <Edit2 className="w-3.5 h-3.5 text-surface-400" /></button>
          {perms.canDelete && (
            <button onClick={() => onDelete(obl.id, obl.code)} className="w-7 h-7 rounded hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Eliminar">
              <Trash2 className="w-3.5 h-3.5 text-red-400" /></button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Accordion Group ──
function AccordionGroup({ statusKey, items, selected, onToggleItem, onToggleAll, onEdit, onDelete, onQuickStatus, perms }) {
  const st = STATUS_C[statusKey];
  const [open, setOpen] = useState(statusKey !== 'cumplida' && statusKey !== 'no_aplica');
  const groupIds = items.map(o => o.id);
  const allSelected = groupIds.length > 0 && groupIds.every(id => selected.has(id));
  const someSelected = groupIds.some(id => selected.has(id));
  const StIcon = st.icon;

  return (
    <div className="rounded-xl border border-surface-100 overflow-hidden">
      <div className={`flex items-center gap-2 px-4 py-2.5 cursor-pointer select-none transition-colors hover:brightness-95 ${st.bg}`}
        onClick={() => setOpen(!open)}>
        {open ? <ChevronDown className="w-4 h-4 text-surface-500" /> : <ChevronRight className="w-4 h-4 text-surface-500" />}
        <input type="checkbox" checked={allSelected}
          ref={el => { if (el) el.indeterminate = someSelected && !allSelected; }}
          onChange={() => onToggleAll(groupIds, !allSelected)}
          onClick={e => e.stopPropagation()}
          className="w-4 h-4 rounded border-surface-300 text-brand-600 focus:ring-brand-500 cursor-pointer" />
        <StIcon className={`w-4 h-4 ${st.text}`} />
        <span className={`font-display font-bold text-sm ${st.text}`}>{st.label}</span>
        <span className={`ml-1 px-2 py-0.5 rounded-full text-[11px] font-bold ${st.bg} ${st.text} border ${st.text.replace('text-','border-')}`}>{items.length}</span>
      </div>
      {open && (
        <div className="p-2 space-y-1.5 bg-white">
          {items.map(obl => (
            <ObligationRow key={obl.id} obl={obl} selected={selected.has(obl.id)}
              onToggle={() => onToggleItem(obl.id)}
              onEdit={onEdit} onDelete={onDelete} onQuickStatus={onQuickStatus} perms={perms} />
          ))}
        </div>
      )}
    </div>
  );
}

// ═══ Main Panel ═══
export default function ObligationsPanel({ projectId, perms = {} }) {
  const [obligations, setObligations] = useState([]);
  const [stats, setStats] = useState(null);
  const [documents, setDocuments] = useState([]);
  const [directors, setDirectors] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', risk_level: '', obligation_type: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [selected, setSelected] = useState(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const load = useCallback(async () => {
    try {
      const params = { search: search || undefined };
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const [oblRes, statsRes] = await Promise.all([
        obligationsAPI.list(projectId, params),
        obligationsAPI.stats(projectId),
      ]);
      setObligations(oblRes.data.data);
      setStats(statsRes.data.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [projectId, search, filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    documentsAPI.list(projectId).then(({ data }) => setDocuments(data.data)).catch(() => {});
    projectsAPI.directors().then(({ data }) => setDirectors(data.data)).catch(() => {});
  }, [projectId]);

  const grouped = useMemo(() => {
    const groups = {};
    STATUS_ORDER.forEach(s => { groups[s] = []; });
    obligations.forEach(o => {
      const key = o.status || 'pendiente';
      if (!groups[key]) groups[key] = [];
      groups[key].push(o);
    });
    return groups;
  }, [obligations]);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const handleDelete = async (id, code) => {
    if (!window.confirm(`¿Eliminar obligación ${code}?`)) return;
    try {
      await obligationsAPI.delete(projectId, id);
      showToast('Obligación eliminada');
      setSelected(prev => { const n = new Set(prev); n.delete(id); return n; });
      load();
    } catch { showToast('Error eliminando', 'error'); }
  };

  const handleQuickStatus = async (id, newStatus) => {
    try { await obligationsAPI.update(projectId, id, { status: newStatus }); load(); }
    catch { showToast('Error actualizando', 'error'); }
  };

  const toggleItem = (id) => { setSelected(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; }); };
  const toggleAll = (ids, checked) => { setSelected(prev => { const n = new Set(prev); ids.forEach(id => checked ? n.add(id) : n.delete(id)); return n; }); };
  const selectAll = () => setSelected(new Set(obligations.map(o => o.id)));
  const clearSelection = () => setSelected(new Set());

  const handleBulk = async (action, value) => {
    if (selected.size === 0) return;
    if (action === 'delete' && !window.confirm(`¿Eliminar ${selected.size} obligaciones seleccionadas?`)) return;
    setBulkLoading(true);
    try {
      await obligationsAPI.bulk(projectId, { ids: [...selected], action, value });
      showToast(`${selected.size} obligaciones ${action === 'delete' ? 'eliminadas' : 'actualizadas'}`);
      setSelected(new Set());
      load();
    } catch (e) { showToast(e.response?.data?.error || 'Error en acción masiva', 'error'); }
    finally { setBulkLoading(false); }
  };

  const hasFilters = Object.values(filters).some(v => v) || search;
  const hasGroups = STATUS_ORDER.some(s => grouped[s]?.length > 0);

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up
          ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>{toast.msg}</div>
      )}

      <StatsBar stats={stats} />

      <div className="flex flex-col sm:flex-row gap-2">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar obligaciones..." className="input-field pl-10 py-2 text-sm" />
        </div>
        <button onClick={() => setShowFilters(!showFilters)}
          className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-1.5 transition-colors ${showFilters ? 'bg-brand-50 border-brand-200 text-brand-700' : 'border-surface-200 text-surface-400'}`}>
          <Filter className="w-4 h-4" /> Filtros
        </button>
        {hasFilters && (
          <button onClick={() => { setFilters({ status:'', risk_level:'', obligation_type:'' }); setSearch(''); }}
            className="px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 flex items-center gap-1"><X className="w-3.5 h-3.5" /> Limpiar</button>
        )}
        {perms.canCreate && <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4" /> Nueva Obligación</button>}
      </div>

      {showFilters && (
        <div className="grid grid-cols-3 gap-3 animate-slide-up">
          <select value={filters.status} onChange={e => setFilters(f => ({...f, status: e.target.value}))} className="input-field py-2 text-sm">
            <option value="">Todos los estados</option>
            {Object.entries(STATUS_C).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <select value={filters.risk_level} onChange={e => setFilters(f => ({...f, risk_level: e.target.value}))} className="input-field py-2 text-sm">
            <option value="">Todos los riesgos</option>
            <option value="alto">Alto</option><option value="medio">Medio</option><option value="bajo">Bajo</option>
          </select>
          <select value={filters.obligation_type} onChange={e => setFilters(f => ({...f, obligation_type: e.target.value}))} className="input-field py-2 text-sm">
            <option value="">Todos los tipos</option>
            {Object.entries(TYPE_C).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
        </div>
      )}

      {/* Bulk Actions Bar */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 p-3 bg-brand-50 border border-brand-200 rounded-xl animate-slide-up">
          <ListChecks className="w-4 h-4 text-brand-600" />
          <span className="text-sm font-semibold text-brand-800">{selected.size} seleccionadas</span>
          <span className="text-surface-300">|</span>
          <button onClick={selectAll} className="text-xs text-brand-600 hover:underline">Todas ({obligations.length})</button>
          <button onClick={clearSelection} className="text-xs text-surface-500 hover:underline">Limpiar</button>
          <div className="flex-1" />
          {bulkLoading ? <Loader2 className="w-4 h-4 animate-spin text-brand-500" /> : (
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-surface-400 font-medium">Estado:</span>
              {Object.entries(STATUS_C).map(([k, v]) => (
                <button key={k} onClick={() => handleBulk('status', k)}
                  className={`px-2 py-1 rounded text-[11px] font-medium ${v.bg} ${v.text} hover:opacity-80 transition-opacity`}>{v.label}</button>
              ))}
              <span className="text-surface-300 mx-1">|</span>
              <span className="text-[10px] text-surface-400 font-medium">Riesgo:</span>
              {Object.entries(RISK_C).map(([k, v]) => (
                <button key={k} onClick={() => handleBulk('risk_level', k)}
                  className={`px-2 py-1 rounded text-[11px] font-medium ${v.bg} ${v.text} hover:opacity-80 transition-opacity`}>{v.label}</button>
              ))}
              {perms.canDelete && (
                <>
                  <span className="text-surface-300 mx-1">|</span>
                  <button onClick={() => handleBulk('delete')}
                    className="px-2 py-1 rounded text-[11px] font-medium bg-red-100 text-red-700 hover:bg-red-200 transition-colors flex items-center gap-1">
                    <Trash2 className="w-3 h-3" /> Eliminar</button>
                </>
              )}
            </div>
          )}
        </div>
      )}

      {/* Obligations grouped by status */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : !hasGroups ? (
        <div className="text-center py-12">
          <ClipboardList className="w-10 h-10 text-surface-200 mx-auto mb-3" />
          <p className="text-sm text-surface-400 mb-4">No hay obligaciones registradas</p>
          <button onClick={() => setModal('new')} className="btn-primary text-sm">Crear primera obligación</button>
        </div>
      ) : (
        <div className="space-y-3">
          {STATUS_ORDER.map(statusKey => {
            const items = grouped[statusKey];
            if (!items || items.length === 0) return null;
            return (
              <AccordionGroup key={statusKey} statusKey={statusKey} items={items}
                selected={selected} onToggleItem={toggleItem} onToggleAll={toggleAll}
                onEdit={obl => setModal(obl)} onDelete={handleDelete}
                onQuickStatus={handleQuickStatus} perms={perms} />
            );
          })}
        </div>
      )}

      {modal && (
        <ObligationModal obligation={modal === 'new' ? null : modal} projectId={projectId}
          documents={documents} directors={directors} onClose={() => setModal(null)}
          onSaved={() => { setModal(null); showToast(modal === 'new' ? 'Obligación creada' : 'Obligación actualizada'); load(); }} />
      )}
    </div>
  );
}
