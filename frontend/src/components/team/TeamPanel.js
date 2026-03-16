import React, { useState, useEffect, useCallback } from 'react';
import { teamAPI } from '../../services/api';
import {
  Plus, Edit2, Trash2, X, Save, Loader2, Users, UserCheck, UserX,
  AlertTriangle, CheckCircle2, Clock, Shield, Briefcase,
} from 'lucide-react';

const STATUS_C = {
  activo:         { label: 'Activo',         bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  inactivo:       { label: 'Inactivo',       bg: 'bg-gray-100',    text: 'text-gray-500',    dot: 'bg-gray-400' },
  por_reemplazar: { label: 'Por Reemplazar', bg: 'bg-red-100',     text: 'text-red-700',     dot: 'bg-red-500' },
};

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO', { day:'2-digit', month:'short', year:'numeric' }) : null; }

function StatsBar({ stats }) {
  if (!stats) return null;
  const items = [
    { label: 'Total', value: stats.total, color: 'text-brand-600', icon: Users },
    { label: 'Activos', value: stats.activos, color: 'text-emerald-600', icon: UserCheck },
    { label: 'Por reemplazar', value: stats.por_reemplazar, color: 'text-red-600', icon: UserX, pulse: stats.por_reemplazar > 0 },
    { label: 'Cumplen perfil', value: stats.compliant, color: 'text-emerald-600', icon: CheckCircle2 },
    { label: 'No cumplen', value: stats.non_compliant, color: 'text-amber-600', icon: AlertTriangle, pulse: stats.non_compliant > 0 },
    { label: 'Dedicación prom.', value: `${stats.avg_dedication || 0}%`, color: 'text-brand-600', icon: Clock },
  ];
  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
      {items.map(i => { const I = i.icon; return (
        <div key={i.label} className="flex items-center gap-2 p-3 bg-surface-50 rounded-lg">
          <I className={`w-4 h-4 ${i.color} ${i.pulse ? 'animate-pulse' : ''}`} />
          <div><p className={`text-sm font-display font-bold ${i.color}`}>{i.value ?? 0}</p><p className="text-[10px] text-surface-400 uppercase tracking-wide">{i.label}</p></div>
        </div>
      );})}
    </div>
  );
}

// ═══ Modal Form ═══
function TeamModal({ member, projectId, onClose, onSaved }) {
  const isEdit = Boolean(member?.id);
  const [form, setForm] = useState({
    full_name: member?.full_name || '',
    person_name: member?.person_name || '',
    role_in_project: member?.role_in_project || '',
    resource_type: member?.resource_type || '',
    participation_type: member?.participation_type || '',
    dedication_pct: member?.dedication_pct || 100,
    join_date: member?.join_date ? member.join_date.split('T')[0] : '',
    leave_date: member?.leave_date ? member.leave_date.split('T')[0] : '',
    status: member?.status || 'activo',
    required_profession: member?.required_profession || '',
    required_experience_years: member?.required_experience_years || '',
    required_certifications: member?.required_certifications || '',
    actual_profession: member?.actual_profession || '',
    actual_experience_years: member?.actual_experience_years || '',
    actual_certifications: member?.actual_certifications || '',
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const set = f => e => setForm(d => ({ ...d, [f]: e.target.value }));

  const handleSubmit = async (e) => {
    e.preventDefault(); setSaving(true); setError('');
    try {
      if (isEdit) await teamAPI.update(projectId, member.id, form);
      else await teamAPI.create(projectId, form);
      onSaved();
    } catch (err) { setError(err.response?.data?.error || 'Error guardando'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900 text-lg">{isEdit ? 'Editar' : 'Agregar'} Miembro</h3>
          <button onClick={onClose} className="w-8 h-8 rounded-lg hover:bg-surface-100 flex items-center justify-center"><X className="w-4 h-4 text-surface-400" /></button>
        </div>

        {error && <div className="mx-5 mt-4 p-3 bg-red-50 border border-red-100 rounded-lg text-red-700 text-sm">{error}</div>}

        <form onSubmit={handleSubmit} className="p-5 space-y-5">
          {/* Basic info */}
          <div>
            <h4 className="text-sm font-semibold text-brand-800 mb-3 flex items-center gap-2"><Users className="w-4 h-4" /> Información Básica</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="col-span-2 sm:col-span-1"><label className="block text-sm font-medium text-brand-800 mb-1">Cargo / Rol *</label><input value={form.full_name} onChange={set('full_name')} required className="input-field" placeholder="Ej: Director de Proyecto" /></div>
              <div><label className="block text-sm font-medium text-brand-800 mb-1">Nombre de la persona</label><input value={form.person_name} onChange={set('person_name')} className="input-field" placeholder="Nombre completo de quien ocupa el cargo" /></div>
              <div><label className="block text-sm font-medium text-brand-800 mb-1">Rol en el proyecto *</label><input value={form.role_in_project} onChange={set('role_in_project')} required className="input-field" placeholder="Director, Ingeniero residente..." /></div>
              <div><label className="block text-sm font-medium text-brand-800 mb-1">Tipo de recurso</label>
                <select value={form.resource_type} onChange={set('resource_type')} className="input-field">
                  <option value="">Sin definir</option>
                  <option value="interno">Interno (planta)</option>
                  <option value="externo">Externo (contratista)</option>
                </select>
              </div>
              <div><label className="block text-sm font-medium text-brand-800 mb-1">Participación</label>
                <select value={form.participation_type} onChange={set('participation_type')} className="input-field">
                  <option value="">Sin definir</option>
                  <option value="ejecuta">Ejecuta</option>
                  <option value="presentado">Solo presentado</option>
                  <option value="ambos">Ejecuta y presentado</option>
                </select>
              </div>
              <div><label className="block text-sm font-medium text-brand-800 mb-1">Dedicación %</label><input type="number" value={form.dedication_pct} onChange={set('dedication_pct')} min="0" max="100" className="input-field" /></div>
              <div><label className="block text-sm font-medium text-brand-800 mb-1">Fecha ingreso</label><input type="date" value={form.join_date} onChange={set('join_date')} className="input-field" /></div>
              <div><label className="block text-sm font-medium text-brand-800 mb-1">Fecha retiro</label><input type="date" value={form.leave_date} onChange={set('leave_date')} className="input-field" /></div>
              {isEdit && <div><label className="block text-sm font-medium text-brand-800 mb-1">Estado</label>
                <select value={form.status} onChange={set('status')} className="input-field">
                  {Object.entries(STATUS_C).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                </select>
              </div>}
            </div>
          </div>

          {/* Required vs Actual */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="p-4 bg-blue-50/50 rounded-lg border border-blue-100">
              <h4 className="text-sm font-semibold text-blue-800 mb-3 flex items-center gap-2"><Shield className="w-4 h-4" /> Perfil Requerido</h4>
              <div className="space-y-3">
                <div><label className="block text-xs font-medium text-blue-700 mb-1">Profesión</label><input value={form.required_profession} onChange={set('required_profession')} className="input-field text-sm" placeholder="Ej: Ingeniero Civil" /></div>
                <div><label className="block text-xs font-medium text-blue-700 mb-1">Años experiencia</label><input type="number" value={form.required_experience_years} onChange={set('required_experience_years')} className="input-field text-sm" min="0" /></div>
                <div><label className="block text-xs font-medium text-blue-700 mb-1">Certificaciones</label><input value={form.required_certifications} onChange={set('required_certifications')} className="input-field text-sm" placeholder="PMP, LEED (separar con comas)" /></div>
              </div>
            </div>

            <div className="p-4 bg-emerald-50/50 rounded-lg border border-emerald-100">
              <h4 className="text-sm font-semibold text-emerald-800 mb-3 flex items-center gap-2"><Briefcase className="w-4 h-4" /> Perfil Actual</h4>
              <div className="space-y-3">
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">Profesión</label><input value={form.actual_profession} onChange={set('actual_profession')} className="input-field text-sm" /></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">Años experiencia</label><input type="number" value={form.actual_experience_years} onChange={set('actual_experience_years')} className="input-field text-sm" min="0" /></div>
                <div><label className="block text-xs font-medium text-emerald-700 mb-1">Certificaciones</label><input value={form.actual_certifications} onChange={set('actual_certifications')} className="input-field text-sm" placeholder="PMP, LEED (separar con comas)" /></div>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEdit ? 'Guardar' : 'Agregar Miembro'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══ Main Panel ═══
export default function TeamPanel({ projectId, perms = {} }) {
  const [members, setMembers] = useState([]);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async () => {
    try {
      const [mRes, sRes] = await Promise.all([teamAPI.list(projectId), teamAPI.stats(projectId)]);
      setMembers(mRes.data.data);
      setStats(sRes.data.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg, type = 'success') => { setToast({ msg, type }); setTimeout(() => setToast(null), 3000); };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`¿Remover a ${name} del equipo?`)) return;
    try { await teamAPI.delete(projectId, id); showToast(`${name} removido`); load(); }
    catch { showToast('Error eliminando', 'error'); }
  };

  return (
    <div className="space-y-4">
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>{toast.msg}</div>
      )}

      <StatsBar stats={stats} />

      <div className="flex justify-between items-center">
        <span className="text-xs text-surface-400">{members.length} miembro{members.length !== 1 ? 's' : ''}</span>
        {perms.canCreate && <button onClick={() => setModal('new')} className="btn-primary flex items-center gap-2 text-sm"><Plus className="w-4 h-4" /> Agregar Miembro</button>}
      </div>

      {loading ? (
        <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>
      ) : members.length === 0 ? (
        <div className="text-center py-12">
          <Users className="w-10 h-10 text-surface-200 mx-auto mb-3" />
          <p className="text-sm text-surface-400 mb-4">No hay miembros registrados</p>
          <button onClick={() => setModal('new')} className="btn-primary text-sm">Agregar primer miembro</button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {members.map(m => {
            const st = STATUS_C[m.status] || STATUS_C.activo;
            const compliant = m.profile_compliant === 1;
            const nonCompliant = m.profile_compliant === 0;

            return (
              <div key={m.id} className={`group bg-white rounded-lg border p-4 hover:shadow-card transition-all
                ${nonCompliant ? 'border-amber-200 bg-amber-50/20' : m.status === 'por_reemplazar' ? 'border-red-200 bg-red-50/20' : 'border-surface-100'}`}>

                {/* Header */}
                <div className="flex items-start justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <div className={`w-10 h-10 rounded-full flex items-center justify-center text-white font-display font-bold text-sm
                      ${compliant ? 'bg-emerald-500' : nonCompliant ? 'bg-amber-500' : 'bg-surface-400'}`}>
                      {m.full_name.split(' ').map(w => w[0]).slice(0, 2).join('')}
                    </div>
                    <div>
                      <p className="font-semibold text-brand-900">{m.full_name}</p>
                      {m.person_name && <p className="text-xs text-brand-600 font-medium">{m.person_name}</p>}
                      <p className="text-xs text-surface-400">{m.role_in_project}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 flex-wrap">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                    {m.resource_type && <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${m.resource_type === 'interno' ? 'bg-blue-100 text-blue-700' : 'bg-purple-100 text-purple-700'}`}>{m.resource_type === 'interno' ? 'Interno' : 'Externo'}</span>}
                    {m.participation_type && <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold bg-surface-100 text-surface-600`}>{m.participation_type === 'ejecuta' ? 'Ejecuta' : m.participation_type === 'presentado' ? 'Presentado' : 'Ejecuta+Pres.'}</span>}
                    {perms.canEdit && <button onClick={() => setModal(m)} className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Edit2 className="w-3.5 h-3.5 text-surface-400" /></button>}
                    {perms.canDelete && <button onClick={() => handleDelete(m.id, m.full_name)} className="w-7 h-7 rounded hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"><Trash2 className="w-3.5 h-3.5 text-red-400" /></button>}
                  </div>
                </div>

                {/* Details */}
                <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs mb-3">
                  {m.actual_profession && <div><span className="text-surface-400">Profesión: </span><span className="text-brand-800">{m.actual_profession}</span></div>}
                  {m.actual_experience_years != null && <div><span className="text-surface-400">Experiencia: </span><span className="text-brand-800">{m.actual_experience_years} años</span></div>}
                  <div><span className="text-surface-400">Dedicación: </span><span className="text-brand-800">{m.dedication_pct}%</span></div>
                  {m.join_date && <div><span className="text-surface-400">Ingreso: </span><span className="text-brand-800">{fmtDate(m.join_date)}</span></div>}
                </div>

                {/* Compliance badge */}
                {compliant && (
                  <div className="flex items-center gap-1.5 text-xs text-emerald-700 bg-emerald-50 px-2 py-1.5 rounded-md">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Perfil cumple requisitos
                  </div>
                )}
                {nonCompliant && (
                  <div className="flex items-center gap-1.5 text-xs text-amber-700 bg-amber-50 px-2 py-1.5 rounded-md">
                    <AlertTriangle className="w-3.5 h-3.5" /> {m.compliance_notes}
                  </div>
                )}

                {/* Required profile preview */}
                {m.required_profession && (
                  <div className="mt-2 pt-2 border-t border-surface-100">
                    <p className="text-[10px] text-surface-400 uppercase tracking-wide mb-1">Perfil requerido</p>
                    <div className="flex flex-wrap gap-1">
                      {m.required_profession && <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">{m.required_profession}</span>}
                      {m.required_experience_years && <span className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">{m.required_experience_years}+ años</span>}
                      {m.required_certifications && m.required_certifications.split(',').map((c, i) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 bg-blue-50 text-blue-700 rounded">{c.trim()}</span>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {modal && (
        <TeamModal
          member={modal === 'new' ? null : modal}
          projectId={projectId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); showToast(modal === 'new' ? 'Miembro agregado' : 'Miembro actualizado'); load(); }}
        />
      )}
    </div>
  );
}
