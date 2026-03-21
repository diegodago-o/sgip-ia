import React, { useState, useEffect } from 'react';
import { adminAPI, projectsAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import {
  Users, UserPlus, Edit3, ToggleLeft, ToggleRight, Shield, Search,
  X, Check, FolderOpen, ChevronDown, ChevronUp, Loader2, Plus, Trash2, Link,
} from 'lucide-react';

const SSO_PROVIDER_LABEL = {
  google:    { label: 'Google', bg: 'bg-red-50 text-red-600 border-red-200' },
  microsoft: { label: 'Microsoft', bg: 'bg-blue-50 text-blue-600 border-blue-200' },
};

const ROLE_INFO = {
  admin:            { label: 'Administrador',       color: 'bg-red-100 text-red-700', desc: 'Acceso total al sistema' },
  gerente_proyecto: { label: 'Gerente de Proyecto',  color: 'bg-blue-100 text-blue-700', desc: 'Gestiona proyectos asignados' },
  director_pmo:     { label: 'Director PMO',         color: 'bg-purple-100 text-purple-700', desc: 'Lectura de todos los proyectos' },
  ceo:              { label: 'Dirección General',     color: 'bg-amber-100 text-amber-700', desc: 'Consulta ejecutiva' },
  apoyo:            { label: 'Apoyo / Seguimiento',   color: 'bg-emerald-100 text-emerald-700', desc: 'Apoyo en proyectos asignados' },
};

export default function AdminUsersPage() {
  const { user: currentUser } = useAuth();
  const [users, setUsers] = useState([]);
  const [search, setSearch] = useState('');
  const [showModal, setShowModal] = useState(false);
  const [editUser, setEditUser] = useState(null);
  const [expandedUser, setExpandedUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => { loadUsers(); }, []);

  const loadUsers = async () => {
    try {
      const res = await adminAPI.listUsers();
      setUsers(res.data.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleToggle = async (id) => {
    try {
      await adminAPI.toggleUser(id);
      loadUsers();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const filtered = users.filter(u =>
    u.full_name.toLowerCase().includes(search.toLowerCase()) ||
    u.email.toLowerCase().includes(search.toLowerCase()) ||
    (ROLE_INFO[u.role]?.label || '').toLowerCase().includes(search.toLowerCase())
  );

  if (currentUser?.role !== 'admin') {
    return <div className="p-8 text-center text-surface-500">No tiene permisos para esta sección</div>;
  }

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-display font-bold text-brand-900 flex items-center gap-2">
            <Shield className="w-6 h-6 text-brand-600" /> Usuarios y Roles
          </h1>
          <p className="text-sm text-surface-500 mt-1">{users.length} usuarios registrados</p>
        </div>
        <button onClick={() => { setEditUser(null); setShowModal(true); }} className="btn-primary flex items-center gap-2 text-sm">
          <UserPlus className="w-4 h-4" /> Nuevo Usuario
        </button>
      </div>

      {/* Role cards summary */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {Object.entries(ROLE_INFO).map(([key, info]) => {
          const count = users.filter(u => u.role === key).length;
          return (
            <div key={key} className="bg-white rounded-xl border border-surface-100 p-3 text-center">
              <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold ${info.color}`}>{info.label}</span>
              <p className="text-2xl font-bold text-brand-900 mt-1">{count}</p>
            </div>
          );
        })}
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
        <input value={search} onChange={e => setSearch(e.target.value)} className="input-field pl-9 text-sm" placeholder="Buscar por nombre, email o rol..." />
      </div>

      {/* Users list */}
      {loading ? (
        <div className="flex justify-center py-12"><Loader2 className="w-6 h-6 animate-spin text-brand-500" /></div>
      ) : (
        <div className="space-y-2">
          {filtered.map(u => (
            <UserCard key={u.id} user={u} isExpanded={expandedUser === u.id}
              onExpand={() => setExpandedUser(expandedUser === u.id ? null : u.id)}
              onEdit={() => { setEditUser(u); setShowModal(true); }}
              onToggle={() => handleToggle(u.id)}
              isSelf={u.id === currentUser.id} />
          ))}
          {filtered.length === 0 && <p className="text-center py-8 text-surface-400 text-sm">No se encontraron usuarios</p>}
        </div>
      )}

      {/* Modal */}
      {showModal && <UserModal user={editUser} onClose={() => setShowModal(false)} onSaved={() => { setShowModal(false); loadUsers(); }} />}
    </div>
  );
}

function UserCard({ user, isExpanded, onExpand, onEdit, onToggle, isSelf }) {
  const info = ROLE_INFO[user.role] || { label: user.role, color: 'bg-gray-100 text-gray-700' };
  return (
    <div className={`bg-white rounded-xl border border-surface-100 transition-all ${!user.is_active ? 'opacity-60' : ''}`}>
      <div className="flex items-center gap-4 p-4 cursor-pointer" onClick={onExpand}>
        <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
          <span className="text-sm font-bold text-brand-700">{user.full_name.charAt(0).toUpperCase()}</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <p className="text-sm font-semibold text-brand-900 truncate">{user.full_name}</p>
            {!user.is_active && <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-100 text-red-600">Inactivo</span>}
            {user.oauth_provider && (() => {
              const sso = SSO_PROVIDER_LABEL[user.oauth_provider] || { label: user.oauth_provider, bg: 'bg-gray-50 text-gray-500 border-gray-200' };
              return (
                <span className={`inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded border font-medium ${sso.bg}`}>
                  <Link className="w-2.5 h-2.5" /> SSO · {sso.label}
                </span>
              );
            })()}
          </div>
          <p className="text-xs text-surface-500 truncate">{user.email}{user.position ? ` · ${user.position}` : ''}</p>
        </div>
        <span className={`px-2 py-1 rounded-full text-[11px] font-semibold ${info.color}`}>{info.label}</span>
        <div className="flex items-center gap-1">
          <span className="text-xs text-surface-400">{user.project_count} proy.</span>
          {isExpanded ? <ChevronUp className="w-4 h-4 text-surface-400" /> : <ChevronDown className="w-4 h-4 text-surface-400" />}
        </div>
      </div>

      {isExpanded && (
        <div className="border-t border-surface-100 p-4 space-y-3 animate-fade-in">
          <div className="flex gap-2">
            <button onClick={onEdit} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-brand-50 text-brand-700 text-xs hover:bg-brand-100">
              <Edit3 className="w-3 h-3" /> Editar
            </button>
            {!isSelf && (
              <button onClick={onToggle} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-surface-50 text-surface-600 text-xs hover:bg-surface-100">
                {user.is_active ? <ToggleRight className="w-3 h-3" /> : <ToggleLeft className="w-3 h-3" />}
                {user.is_active ? 'Desactivar' : 'Activar'}
              </button>
            )}
          </div>
          <div className="text-xs text-surface-500 space-y-1">
            <p>Último acceso: {user.last_login ? new Date(user.last_login).toLocaleString('es-CO') : 'Nunca'}</p>
            <p>Creado: {new Date(user.created_at).toLocaleString('es-CO')}</p>
            <p>Autenticación: {user.oauth_provider
              ? <span className="font-medium text-brand-600">SSO — {SSO_PROVIDER_LABEL[user.oauth_provider]?.label || user.oauth_provider} (sin contraseña local)</span>
              : 'Contraseña local'}
            </p>
          </div>
          {user.role !== 'admin' && (
            <ProjectAssignments userId={user.id} userName={user.full_name} userRole={user.role} />
          )}
        </div>
      )}
    </div>
  );
}

function ProjectAssignments({ userId, userName, userRole }) {
  const [assignments, setAssignments] = useState([]);
  const [allProjects, setAllProjects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [selectedProject, setSelectedProject] = useState('');
  const [assignRole, setAssignRole] = useState(userRole === 'gerente_proyecto' ? 'gerente_proyecto' : 'apoyo');
  const [saving, setSaving] = useState(false);

  useEffect(() => { loadData(); }, [userId]);

  const loadData = async () => {
    setLoading(true);
    try {
      const [aRes, pRes] = await Promise.all([
        adminAPI.getUserAssignments(userId),
        projectsAPI.list({ limit: 200 }),
      ]);
      setAssignments(aRes.data.data || []);
      setAllProjects(pRes.data.data || []);
    } catch (err) { console.error('Error loading assignments:', err); }
    finally { setLoading(false); }
  };

  const handleAssign = async () => {
    if (!selectedProject) return;
    setSaving(true);
    try {
      await adminAPI.assignUser(selectedProject, { user_id: userId, role_in_project: assignRole });
      setSelectedProject('');
      setShowAdd(false);
      loadData();
    } catch (err) { alert(err.response?.data?.error || 'Error al asignar'); }
    finally { setSaving(false); }
  };

  const handleRemove = async (projectId) => {
    if (!window.confirm('¿Remover de este proyecto?')) return;
    try {
      await adminAPI.removeAssignment(projectId, userId);
      loadData();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  const assignedProjectIds = assignments.map(a => a.project_id);
  const unassignedProjects = allProjects.filter(p => !assignedProjectIds.includes(p.id));
  const isReadOnlyRole = userRole === 'director_pmo' || userRole === 'ceo';

  return (
    <div className="bg-surface-50 rounded-lg p-3 space-y-2">
      <div className="flex items-center justify-between">
        <p className="text-xs font-semibold text-brand-800 flex items-center gap-1">
          <FolderOpen className="w-3 h-3" /> Proyectos asignados ({assignments.length})
        </p>
        <button onClick={() => setShowAdd(!showAdd)}
          className="flex items-center gap-1 text-[10px] px-2 py-1 rounded bg-brand-600 text-white hover:bg-brand-700">
          <Plus className="w-3 h-3" /> Asignar proyecto
        </button>
      </div>

      {isReadOnlyRole && (
        <p className="text-[10px] text-amber-600 bg-amber-50 rounded px-2 py-1">
          ℹ️ Este rol ({ROLE_INFO[userRole]?.label}) ya puede ver todos los proyectos por defecto (solo lectura).
          Las asignaciones son opcionales para seguimiento.
        </p>
      )}

      {showAdd && (
        <div className="bg-white rounded-lg p-3 border border-brand-200 space-y-2">
          <p className="text-xs font-medium text-brand-700">Asignar a un proyecto:</p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <select value={selectedProject} onChange={e => setSelectedProject(e.target.value)} className="input-field text-xs w-full">
                <option value="">Seleccionar proyecto...</option>
                {unassignedProjects.map(p => (
                  <option key={p.id} value={p.id}>{p.code} — {p.name}</option>
                ))}
              </select>
            </div>
            <select value={assignRole} onChange={e => setAssignRole(e.target.value)} className="input-field text-xs w-36">
              <option value="apoyo">Apoyo</option>
              <option value="gerente_proyecto">Gerente Proyecto</option>
            </select>
            <button onClick={handleAssign} disabled={!selectedProject || saving}
              className="btn-primary text-xs px-3 whitespace-nowrap flex items-center gap-1">
              {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />} Asignar
            </button>
          </div>
          {unassignedProjects.length === 0 && (
            <p className="text-[10px] text-surface-400">Ya está asignado a todos los proyectos disponibles</p>
          )}
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-2"><Loader2 className="w-4 h-4 animate-spin text-surface-400" /></div>
      ) : assignments.length === 0 ? (
        <p className="text-[11px] text-surface-400 py-1">Sin proyectos asignados — use el botón para asignar</p>
      ) : (
        <div className="space-y-1">
          {assignments.map(a => (
            <div key={a.project_id} className="flex items-center justify-between bg-white rounded-lg px-3 py-2 text-xs">
              <div className="flex-1 min-w-0">
                <span className="font-semibold text-brand-800">{a.project_code}</span>
                <span className="text-surface-500 ml-2">{a.project_name}</span>
              </div>
              <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium mx-2 ${
                a.role_in_project === 'gerente_proyecto' ? 'bg-blue-100 text-blue-700' : 'bg-emerald-100 text-emerald-700'
              }`}>{a.role_in_project === 'gerente_proyecto' ? 'GP' : 'Apoyo'}</span>
              <button onClick={() => handleRemove(a.project_id)} className="text-red-400 hover:text-red-600">
                <Trash2 className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function UserModal({ user, onClose, onSaved }) {
  const [form, setForm] = useState({
    email: user?.email || '',
    full_name: user?.full_name || '',
    role: user?.role || 'apoyo',
    phone: user?.phone || '',
    position: user?.position || '',
    password: '',
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleSubmit = async () => {
    if (!form.email || !form.full_name) return setError('Email y nombre son requeridos');
    if (!user && form.password.length < 6) return setError('La contraseña debe tener al menos 6 caracteres');
    setLoading(true); setError(null);
    try {
      if (user) {
        await adminAPI.updateUser(user.id, form);
      } else {
        await adminAPI.createUser(form);
      }
      onSaved();
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 animate-fade-in" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md p-6 space-y-4" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between">
          <h3 className="font-display font-bold text-brand-900">{user ? 'Editar Usuario' : 'Nuevo Usuario'}</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-surface-400" /></button>
        </div>

        {error && <div className="p-2 bg-red-50 text-red-700 text-xs rounded-lg">{error}</div>}

        <div className="space-y-3">
          <div>
            <label className="text-xs font-medium text-brand-800">Nombre completo *</label>
            <input value={form.full_name} onChange={e => setForm({...form, full_name: e.target.value})} className="input-field text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-brand-800">Email *</label>
            <input type="email" value={form.email} onChange={e => setForm({...form, email: e.target.value})} className="input-field text-sm" />
          </div>
          <div>
            <label className="text-xs font-medium text-brand-800">Rol *</label>
            <select value={form.role} onChange={e => setForm({...form, role: e.target.value})} className="input-field text-sm">
              {Object.entries(ROLE_INFO).map(([k, v]) => (
                <option key={k} value={k}>{v.label} — {v.desc}</option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs font-medium text-brand-800">Teléfono</label>
              <input value={form.phone} onChange={e => setForm({...form, phone: e.target.value})} className="input-field text-sm" />
            </div>
            <div>
              <label className="text-xs font-medium text-brand-800">Cargo</label>
              <input value={form.position} onChange={e => setForm({...form, position: e.target.value})} className="input-field text-sm" />
            </div>
          </div>
          <div>
            <label className="text-xs font-medium text-brand-800">{user ? 'Nueva contraseña (dejar vacío para no cambiar)' : 'Contraseña *'}</label>
            <input type="password" value={form.password} onChange={e => setForm({...form, password: e.target.value})} className="input-field text-sm" placeholder={user ? '••••••' : 'Mínimo 6 caracteres'} />
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-surface-600 hover:bg-surface-100">Cancelar</button>
          <button onClick={handleSubmit} disabled={loading} className="btn-primary text-sm flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />}
            {user ? 'Actualizar' : 'Crear Usuario'}
          </button>
        </div>
      </div>
    </div>
  );
}
