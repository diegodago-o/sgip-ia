/**
 * CommitteeCommitmentsPanel
 * Gestiona los compromisos generados en sesiones de comité.
 * - Muestra compromisos ABIERTOS de comités anteriores para validar
 * - Permite agregar nuevos compromisos surgidos en el comité actual
 * - Actualiza estados inline (pendiente → en progreso → cumplido)
 */
import React, { useState, useEffect, useCallback } from 'react';
import {
  Plus, Loader2, CheckCircle2, Clock, AlertTriangle, Target,
  ChevronDown, ChevronRight, X, Save, Edit2, Trash2, CalendarRange,
} from 'lucide-react';
import { committeeCommitmentsAPI } from '../../services/api';

const DATE = d => {
  if (!d) return '—';
  const s = String(d).substring(0, 10); // Handle both "YYYY-MM-DD" and "YYYY-MM-DDTHH:mm:ss.000Z"
  return new Date(s + 'T00:00:00').toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
};

const PRIORITY_CFG = {
  alta:  { label: 'Alta',  bg: 'bg-red-100',    text: 'text-red-700'   },
  media: { label: 'Media', bg: 'bg-amber-100',   text: 'text-amber-700' },
  baja:  { label: 'Baja',  bg: 'bg-surface-100', text: 'text-surface-500' },
};

const STATUS_CFG = {
  pendiente:   { label: 'Pendiente',   bg: 'bg-amber-50',   text: 'text-amber-700',   dot: 'bg-amber-400'   },
  en_progreso: { label: 'En progreso', bg: 'bg-blue-50',    text: 'text-blue-700',    dot: 'bg-blue-400'    },
  cumplido:    { label: 'Cumplido',    bg: 'bg-emerald-50', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  cancelado:   { label: 'Cancelado',   bg: 'bg-surface-50', text: 'text-surface-500', dot: 'bg-surface-300' },
  vencido:     { label: 'Vencido',     bg: 'bg-red-50',     text: 'text-red-700',     dot: 'bg-red-500'     },
};

const URGENCY_CFG = {
  vencido:    { label: 'Vencidos',     border: 'border-red-200',    header: 'bg-red-50 text-red-800'    },
  vence_hoy:  { label: 'Vence hoy',   border: 'border-amber-200',  header: 'bg-amber-50 text-amber-800' },
  por_vencer: { label: 'Por vencer (7 días)', border: 'border-amber-100', header: 'bg-amber-50/60 text-amber-700' },
  vigente:    { label: 'Vigentes',     border: 'border-surface-100',header: 'bg-surface-50 text-surface-700' },
};

const EMPTY_FORM = {
  description: '',
  responsible: '',
  due_date: '',
  priority: 'media',
  committee_type: 'comite_seguimiento',
  notes: '',
};

// ─────────────────────────────────────────────────────────────
// Modal para crear / editar compromiso
// ─────────────────────────────────────────────────────────────
function CommitmentModal({ projectId, originDate, editItem, onClose, onSaved }) {
  const [form, setForm] = useState(editItem ? {
    description:    editItem.description || '',
    responsible:    editItem.responsible || '',
    due_date:       editItem.due_date ? editItem.due_date.substring(0, 10) : '',
    priority:       editItem.priority || 'media',
    committee_type: editItem.committee_type || 'comite_seguimiento',
    notes:          editItem.notes || '',
  } : { ...EMPTY_FORM });
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState(null);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.description.trim()) return setError('La descripción es requerida');
    setSaving(true); setError(null);
    try {
      if (editItem) {
        await committeeCommitmentsAPI.update(projectId, editItem.id, form);
      } else {
        await committeeCommitmentsAPI.create(projectId, {
          ...form,
          origin_date: originDate,
        });
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100">
          <div className="flex items-center gap-2">
            <Target className="w-5 h-5 text-brand-500" />
            <h3 className="font-display font-bold text-brand-900">
              {editItem ? 'Editar compromiso' : 'Nuevo compromiso de comité'}
            </h3>
          </div>
          <button onClick={onClose} className="text-surface-400 hover:text-surface-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-4 space-y-4">
          {error && (
            <div className="bg-red-50 border border-red-100 text-red-700 text-xs px-3 py-2 rounded-lg">{error}</div>
          )}

          {/* Descripción */}
          <div>
            <label className="block text-xs font-semibold text-brand-800 mb-1">Descripción del compromiso *</label>
            <textarea
              rows={3}
              className="w-full border border-surface-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
              placeholder="Describe el compromiso generado en el comité..."
              value={form.description}
              onChange={e => set('description', e.target.value)}
            />
          </div>

          {/* Responsible + due_date */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-brand-800 mb-1">Responsable</label>
              <input
                type="text"
                className="w-full border border-surface-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300"
                placeholder="Nombre o cargo..."
                value={form.responsible}
                onChange={e => set('responsible', e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-800 mb-1">Fecha límite</label>
              <input
                type="date"
                className="w-full border border-surface-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300"
                value={form.due_date}
                onChange={e => set('due_date', e.target.value)}
              />
            </div>
          </div>

          {/* Priority + committee type */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-brand-800 mb-1">Prioridad</label>
              <select
                className="w-full border border-surface-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300"
                value={form.priority}
                onChange={e => set('priority', e.target.value)}
              >
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-brand-800 mb-1">Tipo de comité</label>
              <select
                className="w-full border border-surface-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300"
                value={form.committee_type}
                onChange={e => set('committee_type', e.target.value)}
              >
                <option value="comite_seguimiento">Comité de seguimiento</option>
                <option value="comite_obra">Comité de obra</option>
                <option value="reunion_tecnica">Reunión técnica</option>
                <option value="reunion_financiera">Reunión financiera</option>
                <option value="otro">Otro</option>
              </select>
            </div>
          </div>

          {/* Notes */}
          <div>
            <label className="block text-xs font-semibold text-brand-800 mb-1">Observaciones / contexto</label>
            <input
              type="text"
              className="w-full border border-surface-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300"
              placeholder="Contexto adicional o acuerdo relacionado..."
              value={form.notes}
              onChange={e => set('notes', e.target.value)}
            />
          </div>
        </div>

        {/* Footer */}
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-100 bg-surface-50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-brand-600 text-white rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors font-medium"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {editItem ? 'Guardar cambios' : 'Registrar compromiso'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Modal para registrar avance/acción (sin cerrar el compromiso)
// ─────────────────────────────────────────────────────────────
function ProgressModal({ projectId, item, onClose, onSaved }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const handleSave = async () => {
    if (!notes.trim()) return setError('Describe la acción realizada');
    setSaving(true); setError(null);
    try {
      await committeeCommitmentsAPI.update(projectId, item.id, {
        status: 'en_progreso',
        notes,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-blue-500" />
            <h3 className="font-display font-bold text-brand-900">Registrar avance</h3>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-surface-400" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {error && <div className="bg-red-50 border border-red-100 text-red-700 text-xs px-3 py-2 rounded-lg">{error}</div>}
          <div className="bg-surface-50 rounded-lg px-3 py-2 text-sm text-brand-800 font-medium">{item.description}</div>
          <div>
            <label className="block text-xs font-semibold text-brand-800 mb-1">Acción realizada *</label>
            <textarea
              rows={3}
              autoFocus
              className="w-full border border-surface-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
              placeholder="Describe qué se hizo, acuerdo alcanzado, próximo paso..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-100 bg-surface-50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 rounded-lg">Cancelar</button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 font-medium"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Guardar avance
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Modal de evidencia / cierre de compromiso
// ─────────────────────────────────────────────────────────────
function CloseModal({ projectId, item, onClose, onSaved }) {
  const [evidence, setEvidence] = useState(item.evidence || '');
  const [notes,    setNotes]    = useState(item.notes    || '');
  const [saving, setSaving] = useState(false);
  const [error,  setError]  = useState(null);

  const handleClose = async () => {
    setSaving(true); setError(null);
    try {
      await committeeCommitmentsAPI.update(projectId, item.id, {
        status: 'cumplido',
        evidence,
        notes,
        completed_date: new Date().toISOString().split('T')[0],
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40">
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100">
          <div className="flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-emerald-500" />
            <h3 className="font-display font-bold text-brand-900">Marcar como cumplido</h3>
          </div>
          <button onClick={onClose}><X className="w-5 h-5 text-surface-400" /></button>
        </div>
        <div className="px-5 py-4 space-y-4">
          {error && <div className="bg-red-50 border border-red-100 text-red-700 text-xs px-3 py-2 rounded-lg">{error}</div>}
          <div className="bg-surface-50 rounded-lg px-3 py-2 text-sm text-brand-800 font-medium">{item.description}</div>
          <div>
            <label className="block text-xs font-semibold text-brand-800 mb-1">Evidencia de cumplimiento</label>
            <textarea
              rows={3}
              className="w-full border border-surface-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300 resize-none"
              placeholder="Describe qué se hizo, adjuntos relacionados, etc..."
              value={evidence}
              onChange={e => setEvidence(e.target.value)}
            />
          </div>
          <div>
            <label className="block text-xs font-semibold text-brand-800 mb-1">Notas adicionales</label>
            <input
              type="text"
              className="w-full border border-surface-200 rounded-lg text-sm px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-300"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>
        </div>
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-surface-100 bg-surface-50">
          <button onClick={onClose} className="px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 rounded-lg">Cancelar</button>
          <button
            onClick={handleClose}
            disabled={saving}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 font-medium"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
            Confirmar cumplimiento
          </button>
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
// Panel principal
// ─────────────────────────────────────────────────────────────
export default function CommitteeCommitmentsPanel({ projectId, readOnly = false }) {
  const [items,   setItems]   = useState([]);
  const [stats,   setStats]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);
  const [open,    setOpen]    = useState(true);
  const [filter,  setFilter]  = useState('abiertos');  // abiertos | todos | cumplidos
  const [toast,   setToast]   = useState(null);

  // Modals
  const [showNewModal,   setShowNewModal]   = useState(false);
  const [editItem,       setEditItem]       = useState(null);
  const [closeItem,      setCloseItem]      = useState(null);
  const [progressItem,   setProgressItem]   = useState(null);
  const [updatingId,     setUpdatingId]     = useState(null);
  const [deletingId,     setDeletingId]     = useState(null);

  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const showToast = msg => {
    setToast(msg);
    setTimeout(() => setToast(null), 3000);
  };

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const r = await committeeCommitmentsAPI.list(projectId, {
        status: filter === 'cumplidos' ? 'cumplido' : filter === 'todos' ? 'todos' : 'abiertos',
      });
      setItems(r.data.data);
      setStats(r.data.stats);
    } catch (e) {
      setError(e.response?.data?.error || e.message);
    } finally { setLoading(false); }
  }, [projectId, filter]);

  useEffect(() => { load(); }, [load]);

  // Cambio rápido de estado
  const quickStatus = async (id, status) => {
    setUpdatingId(id);
    try {
      await committeeCommitmentsAPI.update(projectId, id, { status });
      showToast(status === 'en_progreso' ? 'Marcado en progreso' : 'Estado actualizado');
      load();
    } catch (e) {
      showToast('Error: ' + (e.response?.data?.error || e.message));
    } finally { setUpdatingId(null); }
  };

  const handleDelete = async id => {
    if (!window.confirm('¿Eliminar este compromiso?')) return;
    setDeletingId(id);
    try {
      await committeeCommitmentsAPI.remove(projectId, id);
      showToast('Compromiso eliminado');
      load();
    } catch (e) {
      showToast('Error: ' + (e.response?.data?.error || e.message));
    } finally { setDeletingId(null); }
  };

  // ── Agrupar por urgencia (solo para abiertos) ──
  const groups = (() => {
    if (filter !== 'abiertos') return null;
    const g = { vencido: [], vence_hoy: [], por_vencer: [], vigente: [] };
    items.forEach(c => {
      const u = c.urgencia || 'vigente';
      if (g[u]) g[u].push(c); else g.vigente.push(c);
    });
    return g;
  })();

  const semaforo = stats
    ? (stats.vencidos > 0 ? 'rojo' : stats.abiertos > 0 ? 'amarillo' : 'verde')
    : 'verde';

  const semaforoColors = {
    rojo:     'bg-red-500',
    amarillo: 'bg-amber-400',
    verde:    'bg-emerald-500',
  };

  return (
    <>
      {/* Modals */}
      {showNewModal && (
        <CommitmentModal
          projectId={projectId}
          originDate={today}
          editItem={null}
          onClose={() => setShowNewModal(false)}
          onSaved={() => { load(); showToast('✓ Compromiso registrado'); }}
        />
      )}
      {editItem && (
        <CommitmentModal
          projectId={projectId}
          originDate={today}
          editItem={editItem}
          onClose={() => setEditItem(null)}
          onSaved={() => { load(); showToast('✓ Compromiso actualizado'); }}
        />
      )}
      {closeItem && (
        <CloseModal
          projectId={projectId}
          item={closeItem}
          onClose={() => setCloseItem(null)}
          onSaved={() => { load(); showToast('✓ Compromiso marcado como cumplido'); }}
        />
      )}
      {progressItem && (
        <ProgressModal
          projectId={projectId}
          item={progressItem}
          onClose={() => setProgressItem(null)}
          onSaved={() => { load(); showToast('✓ Avance registrado'); }}
        />
      )}

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 z-50 bg-brand-800 text-white text-sm px-4 py-2.5 rounded-xl shadow-lg animate-fade-in">
          {toast}
        </div>
      )}

      {/* Panel */}
      <div className="bg-white rounded-xl border border-surface-100 overflow-hidden">
        {/* Header */}
        <div
          className="flex items-center justify-between px-5 py-3 cursor-pointer hover:bg-surface-50 transition-colors"
          onClick={() => setOpen(!open)}
        >
          <div className="flex items-center gap-2.5">
            {open ? <ChevronDown className="w-4 h-4 text-surface-400" /> : <ChevronRight className="w-4 h-4 text-surface-400" />}
            <Target className="w-4 h-4 text-brand-500" />
            <h3 className="font-display font-bold text-brand-900 text-sm">Compromisos de Comité</h3>
            {stats && (
              <span className={`inline-block rounded-full w-3 h-3 ${semaforoColors[semaforo]}`} title={semaforo} />
            )}
            {stats?.abiertos > 0 && (
              <span className="text-[10px] font-semibold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full">
                {stats.abiertos} abierto{stats.abiertos !== 1 ? 's' : ''}
              </span>
            )}
          </div>
          <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
            {!readOnly && (
              <button
                onClick={() => setShowNewModal(true)}
                className="flex items-center gap-1 text-[11px] font-semibold text-white bg-brand-600 hover:bg-brand-700 px-2.5 py-1.5 rounded-lg transition-colors"
              >
                <Plus className="w-3.5 h-3.5" /> Nuevo compromiso
              </button>
            )}
          </div>
        </div>

        {open && (
          <div className="border-t border-surface-50 px-5 pb-5">
            {/* Stats */}
            {stats && (
              <div className="mt-3 grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                {[
                  { label: 'Total',        val: stats.total,       bg: 'bg-surface-50',  txt: 'text-brand-800' },
                  { label: 'Pendientes',   val: stats.pendientes,  bg: 'bg-amber-50',    txt: 'text-amber-700' },
                  { label: 'En progreso',  val: stats.en_progreso, bg: 'bg-blue-50',     txt: 'text-blue-700'  },
                  { label: 'Cumplidos',    val: stats.cumplidos,   bg: 'bg-emerald-50',  txt: 'text-emerald-700'},
                  { label: 'Vencidos',     val: stats.vencidos,    bg: 'bg-red-50',      txt: 'text-red-700'   },
                ].map((s, i) => (
                  <div key={i} className={`rounded-lg p-2 ${s.bg}`}>
                    <p className={`text-xl font-bold ${s.txt}`}>{s.val || 0}</p>
                    <p className="text-[10px] text-surface-500">{s.label}</p>
                  </div>
                ))}
              </div>
            )}

            {/* Filtros */}
            <div className="flex gap-1.5 mt-3">
              {[
                { key: 'abiertos',  label: 'Para validar' },
                { key: 'todos',     label: 'Todos'        },
                { key: 'cumplidos', label: 'Cumplidos'    },
              ].map(f => (
                <button
                  key={f.key}
                  onClick={() => setFilter(f.key)}
                  className={`text-[11px] font-medium px-3 py-1.5 rounded-lg transition-colors ${
                    filter === f.key
                      ? 'bg-brand-600 text-white'
                      : 'bg-surface-100 text-surface-600 hover:bg-surface-200'
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {/* Contenido */}
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="w-6 h-6 text-brand-400 animate-spin" />
              </div>
            ) : error ? (
              <div className="bg-red-50 text-red-700 text-xs px-3 py-2 rounded-lg mt-3">{error}</div>
            ) : items.length === 0 ? (
              <div className="text-center py-8">
                {filter === 'abiertos' ? (
                  <>
                    <CheckCircle2 className="w-10 h-10 text-emerald-300 mx-auto mb-2" />
                    <p className="text-sm text-emerald-600 font-medium">¡Sin compromisos pendientes!</p>
                    <p className="text-xs text-surface-400 mt-1">Todos los compromisos del comité han sido cumplidos</p>
                  </>
                ) : (
                  <>
                    <Target className="w-10 h-10 text-surface-200 mx-auto mb-2" />
                    <p className="text-sm text-surface-400">Sin compromisos registrados</p>
                    {!readOnly && (
                      <button
                        onClick={() => setShowNewModal(true)}
                        className="mt-3 text-xs text-brand-500 hover:underline"
                      >
                        + Registrar el primer compromiso
                      </button>
                    )}
                  </>
                )}
              </div>
            ) : filter === 'abiertos' && groups ? (
              // Vista agrupada por urgencia
              <div className="mt-3 space-y-3">
                {Object.entries(groups).map(([urgencia, groupItems]) => {
                  if (!groupItems.length) return null;
                  const cfg = URGENCY_CFG[urgencia];
                  return (
                    <div key={urgencia} className={`border ${cfg.border} rounded-xl overflow-hidden`}>
                      <div className={`flex items-center gap-2 px-3 py-1.5 ${cfg.header}`}>
                        {urgencia === 'vencido'    && <AlertTriangle className="w-3.5 h-3.5" />}
                        {urgencia === 'vence_hoy'  && <Clock className="w-3.5 h-3.5" />}
                        {urgencia === 'por_vencer' && <Clock className="w-3.5 h-3.5" />}
                        {urgencia === 'vigente'    && <CalendarRange className="w-3.5 h-3.5" />}
                        <span className="text-[11px] font-bold">{cfg.label}</span>
                        <span className="ml-auto text-[10px] font-medium opacity-75">{groupItems.length} compromiso{groupItems.length !== 1 ? 's' : ''}</span>
                      </div>
                      <div className="divide-y divide-surface-50">
                        {groupItems.map(c => (
                          <CommitmentRow
                            key={c.id}
                            item={c}
                            updatingId={updatingId}
                            deletingId={deletingId}
                            readOnly={readOnly}
                            onProgress={() => setProgressItem(c)}
                            onClose={() => setCloseItem(c)}
                            onEdit={() => setEditItem(c)}
                            onDelete={() => handleDelete(c.id)}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              // Vista plana (todos / cumplidos)
              <div className="mt-3 border border-surface-100 rounded-xl overflow-hidden divide-y divide-surface-50">
                {items.map(c => (
                  <CommitmentRow
                    key={c.id}
                    item={c}
                    updatingId={updatingId}
                    deletingId={deletingId}
                    readOnly={readOnly}
                    onProgress={() => setProgressItem(c)}
                    onClose={() => setCloseItem(c)}
                    onEdit={() => setEditItem(c)}
                    onDelete={() => handleDelete(c.id)}
                  />
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────
// Fila individual de compromiso
// ─────────────────────────────────────────────────────────────
function CommitmentRow({ item: c, updatingId, deletingId, readOnly, onProgress, onClose, onEdit, onDelete }) {
  const statusCfg   = STATUS_CFG[c.status_real] || STATUS_CFG[c.status] || STATUS_CFG.pendiente;
  const priorityCfg = PRIORITY_CFG[c.priority]  || PRIORITY_CFG.media;
  const isUpdating  = updatingId === c.id;
  const isDeleting  = deletingId === c.id;
  const isClosed    = c.status === 'cumplido' || c.status === 'cancelado';

  return (
    <div className={`px-3 py-3 ${c.status_real === 'vencido' ? 'bg-red-50/30' : 'bg-white'}`}>
      <div className="flex items-start gap-2">
        {/* Status dot */}
        <span className={`mt-1.5 w-2 h-2 rounded-full flex-shrink-0 ${statusCfg.dot}`} />

        {/* Content */}
        <div className="flex-1 min-w-0">
          <p className={`text-sm text-brand-900 ${isClosed ? 'line-through text-surface-400' : ''}`}>
            {c.description}
          </p>
          <div className="flex flex-wrap items-center gap-1.5 mt-1">
            {/* Priority */}
            <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded ${priorityCfg.bg} ${priorityCfg.text}`}>
              {priorityCfg.label}
            </span>
            {/* Status */}
            <span className={`text-[10px] px-1.5 py-0.5 rounded ${statusCfg.bg} ${statusCfg.text}`}>
              {statusCfg.label}
            </span>
            {/* Responsible */}
            {c.responsible && (
              <span className="text-[10px] text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded font-medium">
                → {c.responsible}
              </span>
            )}
            {/* Due date */}
            {c.due_date && (
              <span className={`text-[10px] px-1.5 py-0.5 rounded flex items-center gap-0.5 ${
                c.status_real === 'vencido' ? 'bg-red-100 text-red-700 font-semibold' :
                c.status_real === 'vence_hoy' ? 'bg-amber-100 text-amber-700 font-semibold' :
                'bg-surface-100 text-surface-500'
              }`}>
                📅 {DATE(c.due_date)}
                {c.status_real === 'vencido' && c.days_remaining !== null && (
                  <> · {Math.abs(c.days_remaining)}d vencido</>
                )}
                {c.status_real === 'por_vencer' && c.days_remaining !== null && (
                  <> · {c.days_remaining}d</>
                )}
              </span>
            )}
            {/* Origin date */}
            <span className="text-[10px] text-surface-400">
              Comité {DATE(c.origin_date)}
            </span>
            {/* Completed date */}
            {c.completed_date && (
              <span className="text-[10px] text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">
                ✓ {DATE(c.completed_date)}
              </span>
            )}
          </div>
          {c.notes && (
            <p className="text-[10px] text-surface-400 mt-1 italic truncate">💬 {c.notes}</p>
          )}
          {c.evidence && (
            <p className="text-[10px] text-emerald-600 mt-1 truncate">📎 {c.evidence}</p>
          )}
        </div>

        {/* Actions */}
        {!readOnly && !isClosed && (
          <div className="flex items-center gap-1 flex-shrink-0">
            {isUpdating || isDeleting ? (
              <Loader2 className="w-4 h-4 animate-spin text-brand-400" />
            ) : (
              <>
                <button
                  onClick={onProgress}
                  className="text-[10px] px-2 py-1 rounded bg-blue-50 text-blue-600 hover:bg-blue-100 font-medium whitespace-nowrap transition-colors"
                  title="Registrar una acción realizada"
                >
                  + Avance
                </button>
                <button
                  onClick={onClose}
                  className="text-[10px] px-2 py-1 rounded bg-emerald-50 text-emerald-700 hover:bg-emerald-100 font-semibold whitespace-nowrap transition-colors"
                  title="Marcar cumplido"
                >
                  ✓ Cumplido
                </button>
                <button onClick={onEdit}   title="Editar" className="p-1 rounded hover:bg-surface-100 text-surface-400 hover:text-brand-600 transition-colors">
                  <Edit2 className="w-3.5 h-3.5" />
                </button>
                <button onClick={onDelete} title="Eliminar" className="p-1 rounded hover:bg-red-50 text-surface-400 hover:text-red-500 transition-colors">
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
