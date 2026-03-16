import React, { useState, useEffect, useCallback } from 'react';
import { scheduleAPI } from '../../services/api';
import { Plus, Edit2, Trash2, X, Save, Loader2, ChevronRight, ChevronDown, Flag, Clock, Target, Bookmark, BookmarkCheck, CheckCircle2, Hash } from 'lucide-react';

const ST = {
  no_iniciada: { l: 'No iniciada', bg: 'bg-slate-100', t: 'text-slate-600' },
  en_progreso: { l: 'En progreso', bg: 'bg-blue-100', t: 'text-blue-700' },
  completada:  { l: 'Completada',  bg: 'bg-emerald-100', t: 'text-emerald-700' },
  atrasada:    { l: 'Atrasada',    bg: 'bg-red-100', t: 'text-red-700' },
  suspendida:  { l: 'Suspendida',  bg: 'bg-amber-100', t: 'text-amber-700' },
};
const TYPE_I = { summary: <Target className="w-3.5 h-3.5"/>, task: <Clock className="w-3.5 h-3.5"/>, milestone: <Flag className="w-3.5 h-3.5"/> };
function fmtD(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' }) : ''; }

// ═══ MODAL ═══
function ActivityModal({ item, projectId, activities, onClose, onSaved }) {
  const isEdit = Boolean(item?.id);
  const [form, setForm] = useState({
    name: item?.name || '', description: item?.description || '',
    activity_type: item?.activity_type || 'task', wbs_code: item?.wbs_code || '',
    start_date: item?.start_date?.split('T')[0] || '', end_date: item?.end_date?.split('T')[0] || '',
    weight_pct: item?.weight_pct || 0, assigned_to: item?.assigned_to || '',
    parent_id: item?.parent_id || '', progress_pct: item?.progress_pct || 0,
    status: item?.status || 'no_iniciada',
  });
  const [saving, setSaving] = useState(false);
  const set = f => e => setForm(d => ({ ...d, [f]: e.target.value }));
  const handle = async e => {
    e.preventDefault(); setSaving(true);
    try {
      const data = { ...form, parent_id: form.parent_id || null, weight_pct: parseFloat(form.weight_pct) || 0, progress_pct: parseFloat(form.progress_pct) || 0 };
      if (isEdit) await scheduleAPI.update(projectId, item.id, data);
      else await scheduleAPI.create(projectId, data);
      onSaved();
    } catch (err) { alert(err.response?.data?.error || 'Error'); } finally { setSaving(false); }
  };
  const summaries = activities.filter(a => a.activity_type === 'summary' && a.id !== item?.id);
  const isMilestone = form.activity_type === 'milestone';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900">{isEdit ? 'Editar' : 'Nueva'} Actividad</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400" /></button>
        </div>
        <form onSubmit={handle} className="p-5 space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className="block text-xs font-medium text-brand-800 mb-1">Nombre *</label><input value={form.name} onChange={set('name')} required className="input-field text-sm" /></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">WBS <span className="text-surface-300">(auto)</span></label><input value={form.wbs_code} onChange={set('wbs_code')} className="input-field text-sm font-mono" placeholder="Auto" /></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Tipo</label><select value={form.activity_type} onChange={set('activity_type')} className="input-field text-sm"><option value="task">Tarea</option><option value="summary">Resumen (grupo)</option><option value="milestone">Hito</option></select></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Grupo padre</label><select value={form.parent_id} onChange={set('parent_id')} className="input-field text-sm"><option value="">— Raíz —</option>{summaries.map(s => <option key={s.id} value={s.id}>{s.wbs_code ? s.wbs_code + ' ' : ''}{s.name}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Peso %</label><input type="number" min="0" max="100" step="0.1" value={form.weight_pct} onChange={set('weight_pct')} className="input-field text-sm" /></div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">{isMilestone ? 'Fecha del hito' : 'Inicio'}</label><input type="date" value={form.start_date} onChange={set('start_date')} className="input-field text-sm" /></div>
            {!isMilestone && <div><label className="block text-xs font-medium text-brand-800 mb-1">Fin</label><input type="date" value={form.end_date} onChange={set('end_date')} className="input-field text-sm" /></div>}
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Responsable</label><input value={form.assigned_to} onChange={set('assigned_to')} className="input-field text-sm" /></div>
            <div>
              <label className="block text-xs font-medium text-brand-800 mb-1">Estado</label>
              <select value={form.status} onChange={e => {
                const ns = e.target.value;
                setForm(d => ({ ...d, status: ns, progress_pct: ns === 'completada' ? 100 : ns === 'no_iniciada' ? 0 : d.progress_pct }));
              }} className="input-field text-sm">
                {Object.entries(ST).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}
              </select>
            </div>
            {!isMilestone && <div>
              <label className="block text-xs font-medium text-brand-800 mb-1">Avance %</label>
              <input type="number" min="0" max="100" step="1" value={form.progress_pct}
                onChange={e => { const v = parseFloat(e.target.value) || 0; setForm(d => ({ ...d, progress_pct: v, status: v >= 100 ? 'completada' : v > 0 ? 'en_progreso' : d.status === 'completada' ? 'no_iniciada' : d.status })); }}
                className="input-field text-sm" />
            </div>}
          </div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Descripción</label><textarea value={form.description} onChange={set('description')} className="input-field text-sm min-h-[50px] resize-y" /></div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-2">{saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}{isEdit ? 'Guardar' : 'Crear'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══ ROW ═══
function ActivityRow({ act, depth = 0, perms, onEdit, onDelete, onQuickProgress, onToggleMilestone }) {
  const [expanded, setExpanded] = useState(true);
  const s = ST[act.status] || ST.no_iniciada;
  const hasChildren = act.children?.length > 0;
  const prog = parseFloat(act.progress_pct) || 0;
  const barColor = act.status === 'atrasada' ? 'bg-red-500' : act.status === 'completada' ? 'bg-emerald-500' : 'bg-brand-500';
  const isMilestone = act.activity_type === 'milestone';
  const hasBaseline = act.baseline_start || act.baseline_end;
  const baselineDeviation = hasBaseline && act.end_date && act.baseline_end
    ? Math.round((new Date(act.end_date) - new Date(act.baseline_end)) / 86400000) : 0;

  return (
    <>
      <tr className={`group border-b border-surface-50 hover:bg-surface-50/50 transition-colors ${act.is_late ? 'bg-red-50/30' : ''}`}>
        <td className="px-2 py-2 w-8">{hasChildren && <button onClick={() => setExpanded(!expanded)} className="w-5 h-5 rounded hover:bg-surface-200 flex items-center justify-center">{expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}</button>}</td>
        <td className="px-2 py-2 text-[11px] font-mono text-brand-500 font-semibold w-16">{act.wbs_code || ''}</td>
        <td className="px-2 py-2">
          <div className="flex items-center gap-1.5" style={{ paddingLeft: depth * 16 + 'px' }}>
            <span className={s.t}>{TYPE_I[act.activity_type] || TYPE_I.task}</span>
            <span className={`text-sm ${act.activity_type === 'summary' ? 'font-semibold' : ''} text-brand-900`}>{act.name}</span>
            {isMilestone && <span className="text-[9px] px-1 py-0.5 rounded bg-violet-50 text-violet-600 font-medium ml-1">HITO</span>}
          </div>
        </td>
        <td className="px-2 py-2 text-xs text-surface-400 w-20">
          <div>{fmtD(act.start_date)}</div>
          {hasBaseline && act.baseline_start && act.baseline_start.split('T')[0] !== (act.start_date||'').split('T')[0] && (
            <div className="text-[9px] text-amber-500 line-through">{fmtD(act.baseline_start)}</div>
          )}
        </td>
        <td className="px-2 py-2 text-xs text-surface-400 w-20">
          <div>{fmtD(act.end_date)}</div>
          {hasBaseline && act.baseline_end && act.baseline_end.split('T')[0] !== (act.end_date||'').split('T')[0] && (
            <div className="text-[9px] text-amber-500 line-through">{fmtD(act.baseline_end)}</div>
          )}
        </td>
        <td className="px-2 py-2 w-12 text-xs text-center text-surface-400">{isMilestone ? '—' : (act.duration_days || act.calc_duration || '—') + 'd'}</td>
        <td className="px-2 py-2 w-32">
          {isMilestone ? (
            <div className="flex items-center gap-1">
              {act.status === 'completada' ? <CheckCircle2 className="w-4 h-4 text-emerald-500" /> : <div className="w-4 h-4 rounded-full border-2 border-surface-200" />}
              <span className="text-xs text-surface-400">{act.status === 'completada' ? 'Cumplido' : 'Pendiente'}</span>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="flex-1 h-1.5 bg-surface-100 rounded-full overflow-hidden"><div className={`h-full ${barColor} rounded-full transition-all`} style={{ width: prog + '%' }} /></div>
              <span className={`text-xs font-semibold w-8 text-right ${act.status === 'atrasada' ? 'text-red-600' : 'text-surface-500'}`}>{prog.toFixed(0)}%</span>
            </div>
          )}
        </td>
        <td className="px-2 py-2 w-24">
          <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.bg} ${s.t}`}>{s.l}</span>
          {baselineDeviation > 0 && <span className="ml-1 text-[9px] text-red-500 font-medium">+{baselineDeviation}d</span>}
        </td>
        <td className="px-2 py-2 text-xs text-surface-400 truncate max-w-[80px]">{act.assigned_to || ''}</td>
        <td className="px-2 py-2 w-20">
          <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
            {perms.canEdit && act.activity_type === 'task' && prog < 100 && (
              <button onClick={() => onQuickProgress(act.id, Math.min(100, prog + 25))} className="w-6 h-6 rounded hover:bg-brand-50 flex items-center justify-center" title="+25%"><TrendingUp className="w-3 h-3 text-brand-500" /></button>
            )}
            {perms.canEdit && isMilestone && (
              <button onClick={() => onToggleMilestone(act.id, act.status === 'completada' ? 'no_iniciada' : 'completada')}
                className="w-6 h-6 rounded hover:bg-emerald-50 flex items-center justify-center" title={act.status === 'completada' ? 'Desmarcar' : 'Completar hito'}>
                <CheckCircle2 className={`w-3.5 h-3.5 ${act.status === 'completada' ? 'text-emerald-500' : 'text-surface-300'}`} />
              </button>
            )}
            {perms.canEdit && <button onClick={() => onEdit(act)} className="w-6 h-6 rounded hover:bg-surface-100 flex items-center justify-center"><Edit2 className="w-3 h-3 text-surface-400" /></button>}
            {perms.canDelete && <button onClick={() => onDelete(act.id, act.name)} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-3 h-3 text-red-400" /></button>}
          </div>
        </td>
      </tr>
      {expanded && hasChildren && act.children.map(c => (
        <ActivityRow key={c.id} act={c} depth={depth + 1} perms={perms} onEdit={onEdit} onDelete={onDelete} onQuickProgress={onQuickProgress} onToggleMilestone={onToggleMilestone} />
      ))}
    </>
  );
}

function TrendingUp(props) { return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}><polyline points="22 7 13.5 15.5 8.5 10.5 2 17" /><polyline points="16 7 22 7 22 13" /></svg>; }

// ═══ MAIN PANEL ═══
export default function SchedulePanel({ projectId, perms = {} }) {
  const [tree, setTree] = useState([]);
  const [flat, setFlat] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const [lr, sr] = await Promise.all([scheduleAPI.list(projectId), scheduleAPI.stats(projectId)]);
      setTree(lr.data.data); setFlat(lr.data.flat); setStats(sr.data.data);
    } catch {} finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const handleDelete = async (id, name) => { if (!window.confirm('¿Eliminar "' + name + '" y sub-actividades?')) return; try { await scheduleAPI.delete(projectId, id); showToast('Eliminada'); load(); } catch {} };
  const handleQuickProgress = async (id, val) => { try { await scheduleAPI.update(projectId, id, { progress_pct: val }); load(); } catch {} };
  const handleToggleMilestone = async (id, newStatus) => { try { await scheduleAPI.update(projectId, id, { status: newStatus }); load(); } catch {} };
  const handleSetBaseline = async () => {
    if (stats?.baseline_set && !window.confirm('Ya existe una línea base. ¿Reemplazar?')) return;
    try { await scheduleAPI.setBaseline(projectId); showToast('Línea base establecida'); load(); } catch {}
  };
  const handleClearBaseline = async () => {
    if (!window.confirm('¿Eliminar la línea base?')) return;
    try { await scheduleAPI.clearBaseline(projectId); showToast('Línea base eliminada'); load(); } catch {}
  };
  const handleRegenerateWBS = async () => {
    try { await scheduleAPI.regenerateWBS(projectId); showToast('Códigos WBS regenerados'); load(); } catch {}
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up bg-emerald-600 text-white">{toast}</div>}
      {stats && <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-sm font-bold text-brand-700">{stats.total || 0}</p><p className="text-[10px] text-surface-400">Actividades</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-sm font-bold text-emerald-600">{stats.completada || 0}</p><p className="text-[10px] text-surface-400">Completadas</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className={`text-sm font-bold ${(stats.atrasada || 0) > 0 ? 'text-red-600 animate-pulse' : 'text-surface-400'}`}>{stats.atrasada || 0}</p><p className="text-[10px] text-surface-400">Atrasadas</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-sm font-bold text-blue-600">{stats.avg_progress}%</p><p className="text-[10px] text-surface-400">Avance prom.</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className={`text-sm font-bold ${(stats.critical_path || 0) > 0 ? 'text-orange-600' : 'text-surface-400'}`}>{stats.critical_path || 0}</p><p className="text-[10px] text-surface-400">Ruta crítica</p></div>
      </div>}

      {/* Toolbar */}
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div className="flex items-center gap-3">
          <span className="text-xs text-surface-400">{flat.length} actividad{flat.length !== 1 ? 'es' : ''}</span>
          {stats?.baseline_set && <span className="flex items-center gap-1 text-[10px] font-medium text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full"><BookmarkCheck className="w-3 h-3" /> Línea base activa</span>}
        </div>
        <div className="flex gap-2 flex-wrap">
          {perms.canCreate && flat.length > 0 && <button onClick={handleRegenerateWBS} className="btn-ghost text-xs flex items-center gap-1"><Hash className="w-3.5 h-3.5" /> Regenerar WBS</button>}
          {perms.canCreate && flat.length > 0 && (
            <div className="flex items-center">
              <button onClick={handleSetBaseline} className="btn-ghost text-xs flex items-center gap-1"><Bookmark className="w-3.5 h-3.5" /> {stats?.baseline_set ? 'Actualizar' : 'Fijar'} línea base</button>
              {stats?.baseline_set && <button onClick={handleClearBaseline} className="btn-ghost text-xs text-red-500 hover:bg-red-50 ml-1"><X className="w-3 h-3" /></button>}
            </div>
          )}
          {perms.canCreate && <button onClick={() => setModal({})} className="btn-primary text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" /> Nueva Actividad</button>}
        </div>
      </div>

      {/* Table */}
      {flat.length === 0 ? (
        <div className="text-center py-12 space-y-3">
          <Target className="w-10 h-10 text-surface-200 mx-auto" />
          <p className="text-surface-400 text-sm">Sin actividades registradas.</p>
          <p className="text-surface-300 text-xs">Los códigos WBS se generan automáticamente.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-surface-100">
          <table className="w-full text-sm">
            <thead><tr className="bg-surface-50 border-b border-surface-100">
              <th className="w-8" /><th className="px-2 py-2 text-left text-[10px] font-semibold text-surface-400 uppercase">WBS</th>
              <th className="px-2 py-2 text-left text-[10px] font-semibold text-surface-400 uppercase">Actividad</th>
              <th className="px-2 py-2 text-left text-[10px] font-semibold text-surface-400 uppercase">Inicio</th>
              <th className="px-2 py-2 text-left text-[10px] font-semibold text-surface-400 uppercase">Fin</th>
              <th className="px-2 py-2 text-center text-[10px] font-semibold text-surface-400 uppercase">Dur.</th>
              <th className="px-2 py-2 text-left text-[10px] font-semibold text-surface-400 uppercase">Avance</th>
              <th className="px-2 py-2 text-left text-[10px] font-semibold text-surface-400 uppercase">Estado</th>
              <th className="px-2 py-2 text-left text-[10px] font-semibold text-surface-400 uppercase">Resp.</th>
              <th className="w-20" />
            </tr></thead>
            <tbody>{tree.map(a => <ActivityRow key={a.id} act={a} perms={perms} onEdit={a => setModal(a)} onDelete={handleDelete} onQuickProgress={handleQuickProgress} onToggleMilestone={handleToggleMilestone} />)}</tbody>
          </table>
        </div>
      )}
      {modal && <ActivityModal item={modal.id ? modal : null} projectId={projectId} activities={flat} onClose={() => setModal(null)} onSaved={() => { setModal(null); showToast(modal.id ? 'Actualizada' : 'Creada'); load(); }} />}
    </div>
  );
}
