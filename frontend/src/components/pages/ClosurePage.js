import React, { useState, useEffect } from 'react';
import { projectsAPI } from '../../services/api';
import { usePermissions } from '../../hooks/usePermissions';
import ClosureChecklistPanel from '../closure/ClosureChecklistPanel';
import LiquidationPanel from '../closure/LiquidationPanel';
import LessonsPanel from '../closure/LessonsPanel';
import { CheckSquare, FileSignature, Lightbulb, ChevronDown, FolderKanban } from 'lucide-react';

const TABS = [
  { id: 'checklist', label: 'Checklist de Cierre', icon: CheckSquare },
  { id: 'liquidation', label: 'Acta de Liquidación', icon: FileSignature },
  { id: 'lessons', label: 'Lecciones Aprendidas', icon: Lightbulb },
];

const STATUS_C = {
  en_ejecucion: { label: 'En Ejecución', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  en_arranque: { label: 'En Arranque', bg: 'bg-amber-100', text: 'text-amber-700' },
  adjudicado: { label: 'Adjudicado', bg: 'bg-blue-100', text: 'text-blue-700' },
  suspendido: { label: 'Suspendido', bg: 'bg-red-100', text: 'text-red-700' },
  cerrado: { label: 'Cerrado', bg: 'bg-gray-100', text: 'text-gray-700' },
  liquidado: { label: 'Liquidado', bg: 'bg-green-100', text: 'text-green-700' },
};

export default function ClosurePage() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(null);
  const [selectedProject, setSelectedProject] = useState(null);
  const [activeTab, setActiveTab] = useState('checklist');
  const [loading, setLoading] = useState(true);
  const [dropOpen, setDropOpen] = useState(false);
  const perms = usePermissions('cierre');

  useEffect(() => {
    projectsAPI.list({ limit: 100 })
      .then(({ data }) => {
        const all = data.data;
        setProjects(all);
        if (all.length > 0) { setSelectedId(all[0].id); setSelectedProject(all[0]); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    if (selectedId) { const p = projects.find(p => p.id === selectedId); if (p) setSelectedProject(p); }
  }, [selectedId, projects]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;
  if (projects.length === 0) return (
    <div className="flex items-center justify-center min-h-[50vh]">
      <div className="text-center"><FolderKanban className="w-12 h-12 text-surface-300 mx-auto mb-4" /><h3 className="text-lg font-display font-bold text-brand-900 mb-2">Sin proyectos</h3><p className="text-sm text-surface-400">Cree un proyecto en M1 primero.</p></div>
    </div>
  );

  const sp = selectedProject;
  const st = STATUS_C[sp?.status] || {};

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-card p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-brand-500 font-semibold bg-brand-50 px-2 py-0.5 rounded">{sp?.code}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>{st.label}</span>
              {sp?.status === 'liquidado' && <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-600 text-white">Liquidado</span>}
            </div>
            <h2 className="text-lg font-display font-bold text-brand-900 truncate">{sp?.name}</h2>
            <p className="text-xs text-surface-400 mt-0.5">{sp?.client_name}</p>
          </div>
          <div className="relative">
            <button onClick={() => setDropOpen(!dropOpen)} className="flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-200 text-sm text-brand-800 hover:bg-surface-50">
              <FolderKanban className="w-4 h-4 text-surface-400" /> Cambiar proyecto <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropOpen && (
              <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-surface-100 rounded-xl shadow-xl z-50 max-h-64 overflow-y-auto animate-slide-up">
                {projects.map(p => {
                  const pst = STATUS_C[p.status] || {};
                  return (
                    <button key={p.id} onClick={() => { setSelectedId(p.id); setDropOpen(false); }}
                      className={`w-full text-left px-4 py-3 hover:bg-surface-50 border-b border-surface-50 last:border-0 ${p.id === selectedId ? 'bg-brand-50' : ''}`}>
                      <div className="flex items-center gap-2"><span className="font-mono text-[10px] text-brand-500">{p.code}</span><span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${pst.bg} ${pst.text}`}>{pst.label}</span></div>
                      <p className="text-sm font-medium text-brand-900 truncate mt-0.5">{p.name}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <div className="flex border-b border-surface-100">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors
                  ${isActive ? 'border-brand-600 text-brand-700 bg-brand-50/50' : 'border-transparent text-surface-400 hover:text-surface-600'}`}>
                <Icon className="w-4 h-4" />{tab.label}
              </button>
            );
          })}
        </div>
        <div className="p-4">
          {activeTab === 'checklist' && <ClosureChecklistPanel projectId={selectedId} perms={perms} />}
          {activeTab === 'liquidation' && <LiquidationPanel projectId={selectedId} perms={perms} />}
          {activeTab === 'lessons' && <LessonsPanel projectId={selectedId} perms={perms} />}
        </div>
      </div>
    </div>
  );
}
