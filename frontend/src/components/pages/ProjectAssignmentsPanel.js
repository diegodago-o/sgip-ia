import React, { useState, useEffect } from 'react';
import { adminAPI } from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { UserPlus, Trash2, Loader2, Users, Shield, AlertCircle } from 'lucide-react';

const ROLE_LABELS = {
  gerente_proyecto: 'Gerente de Proyecto',
  apoyo: 'Apoyo / Seguimiento',
};

export default function ProjectAssignmentsPanel({ projectId }) {
  const { user } = useAuth();
  const [assignments, setAssignments] = useState([]);
  const [availableUsers, setAvailableUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [selectedRole, setSelectedRole] = useState('apoyo');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);

  const canManage = user?.role === 'admin' || user?.role === 'gerente_proyecto';

  useEffect(() => { load(); }, [projectId]);

  const load = async () => {
    try {
      const [aRes, uRes] = await Promise.all([
        adminAPI.getAssignments(projectId),
        adminAPI.assignableUsers(),
      ]);
      setAssignments(aRes.data.data.filter(a => a.is_active));
      setAvailableUsers(uRes.data.data);
    } catch (err) { console.error(err); }
    finally { setLoading(false); }
  };

  const handleAssign = async () => {
    if (!selectedUser) return;
    // Validate: only 1 GP per project
    if (selectedRole === 'gerente_proyecto') {
      const existingGP = assignments.find(a => a.role_in_project === 'gerente_proyecto');
      if (existingGP) {
        alert(`Ya existe un Gerente de Proyecto asignado (${existingGP.full_name}). Solo puede haber uno por proyecto. Remuévalo primero si desea cambiarlo.`);
        return;
      }
    }
    setAdding(true);
    try {
      await adminAPI.assignUser(projectId, { user_id: parseInt(selectedUser), role_in_project: selectedRole });
      setSelectedUser('');
      load();
    } catch (err) { alert(err.response?.data?.error || 'Error al asignar'); }
    finally { setAdding(false); }
  };

  const handleRemove = async (userId) => {
    if (!window.confirm('¿Remover esta persona del proyecto?')) return;
    try {
      await adminAPI.removeAssignment(projectId, userId);
      load();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
  };

  // Filter out already-assigned users
  const assignedIds = assignments.map(a => a.user_id);
  const unassigned = availableUsers.filter(u => !assignedIds.includes(u.id));

  if (loading) return <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-brand-400" /></div>;

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-display font-bold text-brand-900 flex items-center gap-2">
          <Shield className="w-4 h-4 text-brand-600" />
          Equipo asignado al proyecto ({assignments.length})
        </h3>
      </div>

      {/* Info card */}
      <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 flex items-start gap-2">
        <AlertCircle className="w-4 h-4 text-blue-500 mt-0.5 flex-shrink-0" />
        <p className="text-xs text-blue-700">
          Las personas asignadas aquí pueden acceder a este proyecto desde su cuenta.
          El <strong>Gerente de Proyecto</strong> tiene control total.
          El <strong>Apoyo</strong> puede registrar avances y datos operativos pero no aprobar ni firmar.
        </p>
      </div>

      {/* Add new assignment */}
      {canManage && unassigned.length > 0 && (
        <div className="bg-surface-50 rounded-xl p-4 space-y-3">
          <p className="text-xs font-semibold text-brand-800">Asignar persona al proyecto:</p>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <label className="text-[10px] text-surface-500">Usuario</label>
              <select value={selectedUser} onChange={e => setSelectedUser(e.target.value)} className="input-field text-sm">
                <option value="">Seleccionar persona...</option>
                {unassigned.map(u => (
                  <option key={u.id} value={u.id}>
                    {u.full_name} — {u.email} ({u.role === 'gerente_proyecto' ? 'GP' : 'Apoyo'})
                  </option>
                ))}
              </select>
            </div>
            <div className="w-48">
              <label className="text-[10px] text-surface-500">Rol en proyecto</label>
              <select value={selectedRole} onChange={e => setSelectedRole(e.target.value)} className="input-field text-sm">
                <option value="apoyo">Apoyo / Seguimiento</option>
                {!assignments.find(a => a.role_in_project === 'gerente_proyecto') && (
                  <option value="gerente_proyecto">Gerente de Proyecto</option>
                )}
              </select>
            </div>
            <button onClick={handleAssign} disabled={!selectedUser || adding}
              className="btn-primary text-sm px-4 py-2 flex items-center gap-1.5 whitespace-nowrap">
              {adding ? <Loader2 className="w-4 h-4 animate-spin" /> : <UserPlus className="w-4 h-4" />}
              Asignar
            </button>
          </div>
        </div>
      )}

      {/* Current assignments */}
      <div className="space-y-2">
        {assignments.length === 0 ? (
          <div className="text-center py-8">
            <Users className="w-8 h-8 text-surface-300 mx-auto mb-2" />
            <p className="text-sm text-surface-400">No hay personas asignadas a este proyecto</p>
            {canManage && <p className="text-xs text-surface-400 mt-1">Use el formulario de arriba para asignar</p>}
          </div>
        ) : (
          assignments.map(a => (
            <div key={a.user_id} className="bg-white border border-surface-100 rounded-xl p-4 flex items-center gap-4">
              <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center flex-shrink-0">
                <span className="text-sm font-bold text-brand-700">{a.full_name.charAt(0).toUpperCase()}</span>
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold text-brand-900">{a.full_name}</p>
                <p className="text-xs text-surface-500">{a.email}{a.position ? ` · ${a.position}` : ''}</p>
              </div>
              <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                a.role_in_project === 'gerente_proyecto'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-emerald-100 text-emerald-700'
              }`}>
                {ROLE_LABELS[a.role_in_project] || a.role_in_project}
              </span>
              <div className="text-xs text-surface-400">
                {a.assigned_by_name && <span>Asignó: {a.assigned_by_name}</span>}
              </div>
              {canManage && a.user_id !== user.id && (
                <button onClick={() => handleRemove(a.user_id)}
                  className="w-8 h-8 rounded-lg hover:bg-red-50 flex items-center justify-center text-surface-400 hover:text-red-500 transition-colors"
                  title="Remover del proyecto">
                  <Trash2 className="w-4 h-4" />
                </button>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
