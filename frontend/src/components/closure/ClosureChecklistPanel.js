import React, { useState, useEffect, useCallback } from 'react';
import { closureAPI } from '../../services/api';
import { Plus, CheckCircle2, Circle, Trash2, X, Save, Loader2, ListChecks, ChevronDown, ChevronRight } from 'lucide-react';

const CATS = { contractual: 'Contractual', financiero: 'Financiero', tecnico: 'Técnico', documental: 'Documental', administrativo: 'Administrativo', ambiental: 'Ambiental' };
const CAT_COLORS = { contractual: 'bg-blue-500', financiero: 'bg-emerald-500', tecnico: 'bg-violet-500', documental: 'bg-amber-500', administrativo: 'bg-pink-500', ambiental: 'bg-teal-500' };

function AddItemModal({ projectId, onClose, onSaved }) {
  const [form, setForm] = useState({ description: '', category: 'contractual', responsible: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const set = f => e => setForm(d => ({ ...d, [f]: e.target.value }));
  const handle = async e => { e.preventDefault(); setSaving(true); try { await closureAPI.create(projectId, form); onSaved(); } catch (err) { alert(err.response?.data?.error || 'Error'); } finally { setSaving(false); } };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900">Nuevo Item</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400" /></button>
        </div>
        <form onSubmit={handle} className="p-5 space-y-3">
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Descripción *</label><input value={form.description} onChange={set('description')} required className="input-field text-sm" /></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Categoría</label><select value={form.category} onChange={set('category')} className="input-field text-sm">{Object.entries(CATS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Responsable</label><input value={form.responsible} onChange={set('responsible')} className="input-field text-sm" /></div>
          </div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Notas</label><textarea value={form.notes} onChange={set('notes')} className="input-field text-sm min-h-[40px] resize-y" /></div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-2">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}Agregar</button>
          </div>
        </form>
      </div>
    </div>
  );
}

function CategoryGroup({ category, items, perms, onToggle, onDelete }) {
  const [expanded, setExpanded] = useState(true);
  const done = items.filter(i => i.is_completed).length;
  const pct = items.length > 0 ? ((done / items.length) * 100).toFixed(0) : 0;
  const color = CAT_COLORS[category] || 'bg-surface-400';
  return (
    <div className="border border-surface-100 rounded-lg overflow-hidden">
      <button onClick={() => setExpanded(!expanded)} className="w-full flex items-center justify-between px-4 py-3 bg-surface-50 hover:bg-surface-100 transition-colors">
        <div className="flex items-center gap-3">
          {expanded ? <ChevronDown className="w-4 h-4 text-surface-400" /> : <ChevronRight className="w-4 h-4 text-surface-400" />}
          <div className={`w-2.5 h-2.5 rounded-full ${color}`} />
          <span className="text-sm font-semibold text-brand-900">{CATS[category] || category}</span>
          <span className="text-xs text-surface-400">{done}/{items.length}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-20 h-1.5 bg-surface-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className={`text-xs font-bold ${pct >= 100 ? 'text-emerald-600' : 'text-surface-400'}`}>{pct}%</span>
        </div>
      </button>
      {expanded && (
        <div className="divide-y divide-surface-50">
          {items.map(item => (
            <div key={item.id} className={`group flex items-start gap-3 px-4 py-2.5 hover:bg-surface-50/50 transition-colors ${item.is_completed ? 'bg-emerald-50/30' : ''}`}>
              <button onClick={() => onToggle(item.id)} className="mt-0.5 flex-shrink-0">
                {item.is_completed
                  ? <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                  : <Circle className="w-5 h-5 text-surface-300 hover:text-brand-400 transition-colors" />}
              </button>
              <div className="flex-1 min-w-0">
                <p className={`text-sm ${item.is_completed ? 'text-surface-400 line-through' : 'text-brand-900'}`}>{item.description}</p>
                <div className="flex gap-3 mt-0.5">
                  {item.responsible && <span className="text-[10px] text-surface-400">Resp: {item.responsible}</span>}
                  {item.completed_by_name && <span className="text-[10px] text-emerald-600">✓ {item.completed_by_name} · {new Date(item.completed_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</span>}
                  {item.notes && <span className="text-[10px] text-surface-400 italic">{item.notes}</span>}
                </div>
              </div>
              {perms.canDelete && (
                <button onClick={() => onDelete(item.id)} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                  <Trash2 className="w-3 h-3 text-red-400" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function ClosureChecklistPanel({ projectId, perms = {} }) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const [lr, sr] = await Promise.all([closureAPI.list(projectId), closureAPI.stats(projectId)]);
      setItems(lr.data.data); setStats(sr.data.data);
    } catch {} finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const handleInit = async () => {
    if (!window.confirm('¿Inicializar checklist con la plantilla estándar de cierre para proyectos colombianos?')) return;
    try { await closureAPI.initTemplate(projectId); showToast('Checklist inicializado'); load(); }
    catch (err) { alert(err.response?.data?.error || 'Error'); }
  };
  const handleToggle = async (id) => { await closureAPI.toggle(projectId, id); load(); };
  const handleDelete = async (id) => { if (!window.confirm('¿Eliminar item?')) return; await closureAPI.delete(projectId, id); showToast('Eliminado'); load(); };

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;

  // Group items by category
  const groups = {};
  items.forEach(i => { if (!groups[i.category]) groups[i.category] = []; groups[i.category].push(i); });
  const catOrder = ['contractual', 'financiero', 'tecnico', 'documental', 'administrativo', 'ambiental'];

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up bg-emerald-600 text-white">{toast}</div>}

      {/* Summary */}
      {stats && items.length > 0 && (
        <div className="p-4 bg-surface-50 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <ListChecks className="w-5 h-5 text-brand-600" />
              <span className="text-sm font-semibold text-brand-900">Progreso de Cierre</span>
            </div>
            <span className={`text-2xl font-display font-bold ${parseInt(stats.pct) >= 100 ? 'text-emerald-600' : 'text-brand-700'}`}>{stats.pct}%</span>
          </div>
          <div className="w-full h-3 bg-surface-200 rounded-full overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-700 ${parseInt(stats.pct) >= 100 ? 'bg-emerald-500' : 'bg-brand-500'}`} style={{ width: `${stats.pct}%` }} />
          </div>
          <p className="text-xs text-surface-400 mt-1">{stats.completed} de {stats.total} items completados</p>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <span className="text-xs text-surface-400">{items.length} item{items.length !== 1 ? 's' : ''}</span>
        <div className="flex gap-2">
          {perms.canCreate && items.length === 0 && (
            <button onClick={handleInit} className="btn-primary text-sm flex items-center gap-1.5">
              <ListChecks className="w-4 h-4" /> Inicializar Plantilla
            </button>
          )}
          {perms.canCreate && (
            <button onClick={() => setModal(true)} className="btn-ghost text-sm flex items-center gap-1.5">
              <Plus className="w-4 h-4" /> Agregar Item
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {items.length === 0 ? (
        <div className="text-center py-12">
          <ListChecks className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-surface-400 text-sm mb-3">Sin checklist de cierre</p>
          {perms.canCreate && <p className="text-xs text-surface-400">Use "Inicializar Plantilla" para cargar el checklist estándar con 25+ items predefinidos.</p>}
        </div>
      ) : (
        <div className="space-y-3">
          {catOrder.filter(c => groups[c]?.length > 0).map(cat => (
            <CategoryGroup key={cat} category={cat} items={groups[cat]} perms={perms} onToggle={handleToggle} onDelete={handleDelete} />
          ))}
        </div>
      )}

      {modal && <AddItemModal projectId={projectId} onClose={() => setModal(false)} onSaved={() => { setModal(false); showToast('Item agregado'); load(); }} />}
    </div>
  );
}
