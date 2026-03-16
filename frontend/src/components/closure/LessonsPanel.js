import React, { useState, useEffect, useCallback } from 'react';
import { lessonsAPI } from '../../services/api';
import { Plus, Edit2, Trash2, X, Save, Loader2, Lightbulb, ThumbsUp, ThumbsDown, TrendingUp } from 'lucide-react';

const CAT = { tecnico: 'Técnico', gestion: 'Gestión', contractual: 'Contractual', financiero: 'Financiero', comunicacion: 'Comunicación', riesgos: 'Riesgos', calidad: 'Calidad', otro: 'Otro' };
const TYP = { positiva: { l: 'Buena práctica', icon: ThumbsUp, bg: 'bg-emerald-100', t: 'text-emerald-700' }, negativa: { l: 'Problema', icon: ThumbsDown, bg: 'bg-red-100', t: 'text-red-700' }, mejora: { l: 'Oportunidad de mejora', icon: TrendingUp, bg: 'bg-blue-100', t: 'text-blue-700' } };

function LessonModal({ item, projectId, onClose, onSaved }) {
  const isEdit = Boolean(item?.id);
  const [form, setForm] = useState({
    title: item?.title || '', category: item?.category || 'gestion', lesson_type: item?.lesson_type || 'mejora',
    situation: item?.situation || '', action_taken: item?.action_taken || '', result: item?.result || '',
    recommendation: item?.recommendation || '', impact_area: item?.impact_area || '',
  });
  const [saving, setSaving] = useState(false);
  const set = f => e => setForm(d => ({ ...d, [f]: e.target.value }));
  const handle = async e => {
    e.preventDefault(); setSaving(true);
    try { if (isEdit) await lessonsAPI.update(projectId, item.id, form); else await lessonsAPI.create(projectId, form); onSaved(); }
    catch (err) { alert(err.response?.data?.error || 'Error'); } finally { setSaving(false); }
  };
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900">{isEdit ? 'Editar' : 'Nueva'} Lección Aprendida</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400" /></button>
        </div>
        <form onSubmit={handle} className="p-5 space-y-3">
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Título *</label><input value={form.title} onChange={set('title')} required className="input-field text-sm" /></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Categoría</label><select value={form.category} onChange={set('category')} className="input-field text-sm">{Object.entries(CAT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Tipo</label><select value={form.lesson_type} onChange={set('lesson_type')} className="input-field text-sm">{Object.entries(TYP).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Área de impacto</label><input value={form.impact_area} onChange={set('impact_area')} className="input-field text-sm" placeholder="Ej: Cronograma" /></div>
          </div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Situación presentada *</label><textarea value={form.situation} onChange={set('situation')} required className="input-field text-sm min-h-[60px] resize-y" placeholder="¿Qué pasó? Describa el contexto..." /></div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Acción tomada</label><textarea value={form.action_taken} onChange={set('action_taken')} className="input-field text-sm min-h-[40px] resize-y" placeholder="¿Qué se hizo al respecto?" /></div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Resultado</label><textarea value={form.result} onChange={set('result')} className="input-field text-sm min-h-[40px] resize-y" placeholder="¿Cuál fue el resultado?" /></div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Recomendación para futuros proyectos</label><textarea value={form.recommendation} onChange={set('recommendation')} className="input-field text-sm min-h-[40px] resize-y" placeholder="¿Qué debería hacerse diferente?" /></div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-2">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{isEdit ? 'Guardar' : 'Registrar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LessonsPanel({ projectId, perms = {} }) {
  const [items, setItems] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [filter, setFilter] = useState('all');

  const load = useCallback(async () => {
    try {
      const [lr, sr] = await Promise.all([lessonsAPI.list(projectId), lessonsAPI.stats(projectId)]);
      setItems(lr.data.data); setStats(sr.data.data);
    } catch {} finally { setLoading(false); }
  }, [projectId]);
  useEffect(() => { setLoading(true); load(); }, [load]);

  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const del = async (id) => { if (!window.confirm('¿Eliminar lección?')) return; await lessonsAPI.delete(projectId, id); showToast('Eliminada'); load(); };

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;

  const filtered = filter === 'all' ? items : items.filter(i => i.lesson_type === filter);

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up bg-emerald-600 text-white">{toast}</div>}

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="p-3 bg-surface-50 rounded-lg"><p className="text-sm font-bold text-brand-700">{stats.total || 0}</p><p className="text-[10px] text-surface-400">Total lecciones</p></div>
          <div className="p-3 bg-emerald-50 rounded-lg cursor-pointer hover:bg-emerald-100 transition-colors" onClick={() => setFilter(f => f === 'positiva' ? 'all' : 'positiva')}>
            <p className="text-sm font-bold text-emerald-600">{stats.positivas || 0}</p><p className="text-[10px] text-emerald-500">Buenas prácticas</p>
          </div>
          <div className="p-3 bg-red-50 rounded-lg cursor-pointer hover:bg-red-100 transition-colors" onClick={() => setFilter(f => f === 'negativa' ? 'all' : 'negativa')}>
            <p className="text-sm font-bold text-red-600">{stats.negativas || 0}</p><p className="text-[10px] text-red-500">Problemas</p>
          </div>
          <div className="p-3 bg-blue-50 rounded-lg cursor-pointer hover:bg-blue-100 transition-colors" onClick={() => setFilter(f => f === 'mejora' ? 'all' : 'mejora')}>
            <p className="text-sm font-bold text-blue-600">{stats.mejoras || 0}</p><p className="text-[10px] text-blue-500">Mejoras</p>
          </div>
        </div>
      )}

      {/* Toolbar */}
      <div className="flex justify-between items-center">
        <div className="flex items-center gap-2">
          <span className="text-xs text-surface-400">{filtered.length} lección{filtered.length !== 1 ? 'es' : ''}</span>
          {filter !== 'all' && <button onClick={() => setFilter('all')} className="text-xs text-brand-600 hover:underline">Ver todas</button>}
        </div>
        {(perms.canCreate || perms.canAddEvidence) && <button onClick={() => setModal({})} className="btn-primary text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" /> Nueva Lección</button>}
      </div>

      {/* List */}
      {filtered.length === 0 ? (
        <div className="text-center py-12">
          <Lightbulb className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-surface-400 text-sm">Sin lecciones aprendidas registradas</p>
          <p className="text-xs text-surface-400 mt-1">Documente las experiencias del proyecto para mejorar futuros contratos.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(l => {
            const typ = TYP[l.lesson_type] || TYP.mejora;
            const Icon = typ.icon;
            return (
              <div key={l.id} className="group bg-white border border-surface-100 rounded-lg p-4 hover:border-surface-200 transition-colors">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${typ.bg} ${typ.t}`}>
                        <Icon className="w-3 h-3" />{typ.l}
                      </span>
                      <span className="text-[10px] text-surface-400 bg-surface-50 px-1.5 py-0.5 rounded">{CAT[l.category] || l.category}</span>
                      {l.impact_area && <span className="text-[10px] text-surface-400">→ {l.impact_area}</span>}
                    </div>
                    <h4 className="text-sm font-semibold text-brand-900">{l.title}</h4>
                    <p className="text-xs text-surface-500 mt-1">{l.situation}</p>
                    {l.recommendation && (
                      <div className="mt-2 p-2 bg-brand-50 rounded text-xs text-brand-700">
                        <span className="font-semibold">Recomendación:</span> {l.recommendation}
                      </div>
                    )}
                    <p className="text-[10px] text-surface-400 mt-2">
                      {l.reported_by_name && `Por ${l.reported_by_name} · `}
                      {new Date(l.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                    </p>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                    {(perms.canEdit || perms.canAddEvidence) && <button onClick={() => setModal(l)} className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center"><Edit2 className="w-3.5 h-3.5 text-surface-400" /></button>}
                    {perms.canDelete && <button onClick={() => del(l.id)} className="w-7 h-7 rounded hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {modal && <LessonModal item={modal.id ? modal : null} projectId={projectId} onClose={() => setModal(null)} onSaved={() => { setModal(null); showToast(modal.id ? 'Actualizada' : 'Registrada'); load(); }} />}
    </div>
  );
}
