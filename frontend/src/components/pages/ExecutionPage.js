import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { projectsAPI } from '../../services/api';
import { usePermissions } from '../../hooks/usePermissions';
import SchedulePanel from '../execution/SchedulePanel';
import ProgressPanel from '../execution/ProgressPanel';
import BudgetTrackingPanel from '../execution/BudgetTrackingPanel';
import PaymentsPanel from '../execution/PaymentsPanel';
import MinutesPanel from '../execution/MinutesPanel';
import ChangesPanel from '../execution/ChangesPanel';
import RisksPanel from '../execution/RisksPanel';
import CorrespondencePanel from '../execution/CorrespondencePanel';
import {
  Calendar, TrendingUp, BarChart3, DollarSign, FileText, GitBranch, AlertTriangle,
  FolderKanban, ChevronDown, Mail,
} from 'lucide-react';

const TABS = [
  { id: 'schedule', label: 'Cronograma', icon: Calendar },
  { id: 'progress', label: 'Avance', icon: TrendingUp },
  { id: 'budget_tracking', label: 'Seg. Presupuestal', icon: BarChart3 },
  { id: 'payments', label: 'Pagos', icon: DollarSign },
  { id: 'minutes', label: 'Actas', icon: FileText },
  { id: 'changes',          label: 'Cambios',          icon: GitBranch },
  { id: 'risks',            label: 'Riesgos',           icon: AlertTriangle },
  { id: 'correspondence',   label: 'Correspondencia',   icon: Mail },
];

const STATUS_C = {
  adjudicado: { label: 'Adjudicado', bg: 'bg-blue-100', text: 'text-blue-700' },
  en_arranque: { label: 'En Arranque', bg: 'bg-amber-100', text: 'text-amber-700' },
  en_ejecucion: { label: 'En Ejecución', bg: 'bg-emerald-100', text: 'text-emerald-700' },
  suspendido: { label: 'Suspendido', bg: 'bg-red-100', text: 'text-red-700' },
};

function fmtMoney(v) { return v ? new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v) : '—'; }

export default function ExecutionPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(() => {
    const s = localStorage.getItem('sgip_selected_project');
    return s ? parseInt(s, 10) : null;
  });
  const [selectedProject, setSelectedProject] = useState(null);
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    return t && TABS.find(tab => tab.id === t) ? t : 'schedule';
  });
  const [loading, setLoading] = useState(true);
  const [dropOpen, setDropOpen] = useState(false);
  const perms = usePermissions('ejecucion');

  // Sync tab from URL when location changes (e.g. back/forward or direct link)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const t = params.get('tab');
    if (t && TABS.find(tab => tab.id === t)) setActiveTab(t);
  }, [location.search]);

  // Persist selected project across modules
  useEffect(() => { if (selectedId) localStorage.setItem('sgip_selected_project', selectedId); }, [selectedId]);

  const loadProjects = useCallback(() => {
    projectsAPI.list({ limit: 100, status: '' })
      .then(({ data }) => {
        const active = data.data.filter(p => ['en_ejecucion','en_arranque','adjudicado'].includes(p.status));
        setProjects(active);
        if (active.length === 0) return;
        const stored = parseInt(localStorage.getItem('sgip_selected_project'), 10);
        const preferred = active.find(p => p.id === stored) || active[0];
        setSelectedId(preferred.id);
        setSelectedProject(preferred);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => { loadProjects(); }, []); // eslint-disable-line

  // Reload just the selected project (used when changes affect contract_value)
  const reloadSelectedProject = useCallback(() => {
    if (!selectedId) return;
    projectsAPI.get(selectedId)
      .then(({ data }) => {
        setSelectedProject(data.data);
        // Also update in the list
        setProjects(prev => prev.map(p => p.id === selectedId ? { ...p, ...data.data } : p));
      })
      .catch(() => {});
  }, [selectedId]);

  useEffect(() => {
    if (selectedId) {
      const p = projects.find(p => p.id === selectedId);
      if (p) setSelectedProject(p);
    }
  }, [selectedId, projects]);

  if (loading) {
    return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;
  }

  if (projects.length === 0) {
    return (
      <div className="flex items-center justify-center min-h-[50vh]">
        <div className="text-center">
          <FolderKanban className="w-12 h-12 text-surface-300 mx-auto mb-4" />
          <h3 className="text-lg font-display font-bold text-brand-900 mb-2">Sin proyectos activos</h3>
          <p className="text-sm text-surface-400">Cree un proyecto en el Módulo 1 y cámbielo a estado "En Ejecución" para comenzar.</p>
        </div>
      </div>
    );
  }

  const sp = selectedProject;
  const st = STATUS_C[sp?.status] || {};

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header: Project Selector */}
      <div className="bg-white rounded-xl shadow-card p-4">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-brand-500 font-semibold bg-brand-50 px-2 py-0.5 rounded">{sp?.code}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>{st.label}</span>
            </div>
            <h2 className="text-lg font-display font-bold text-brand-900 truncate">{sp?.name}</h2>
            <p className="text-xs text-surface-400 mt-0.5">{sp?.client_name} · {fmtMoney(sp?.contract_value)}</p>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2">
            <button onClick={() => selectedId && navigate(`/ejecucion/${selectedId}/comite`)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium text-brand-700 bg-brand-50 hover:bg-brand-100 border border-brand-200 rounded-lg transition-colors">
              <BarChart3 className="w-4 h-4" /> Comité
            </button>

          {/* Project dropdown */}
          <div className="relative">
            <button onClick={() => setDropOpen(!dropOpen)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-surface-200 text-sm text-brand-800 hover:bg-surface-50 transition-colors">
              <FolderKanban className="w-4 h-4 text-surface-400" />
              Cambiar proyecto
              <ChevronDown className={`w-3.5 h-3.5 transition-transform ${dropOpen ? 'rotate-180' : ''}`} />
            </button>
            {dropOpen && (
              <div className="absolute right-0 top-full mt-1 w-80 bg-white border border-surface-100 rounded-xl shadow-xl z-50 max-h-64 overflow-y-auto animate-slide-up">
                {projects.map(p => {
                  const pst = STATUS_C[p.status] || {};
                  return (
                    <button key={p.id} onClick={() => { setSelectedId(p.id); setDropOpen(false); setActiveTab('schedule'); }}
                      className={`w-full text-left px-4 py-3 hover:bg-surface-50 transition-colors border-b border-surface-50 last:border-0
                        ${p.id === selectedId ? 'bg-brand-50' : ''}`}>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] text-brand-500">{p.code}</span>
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${pst.bg} ${pst.text}`}>{pst.label}</span>
                      </div>
                      <p className="text-sm font-medium text-brand-900 truncate mt-0.5">{p.name}</p>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          </div>
        </div>

        {/* Progress bar */}
        <div className="mt-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-surface-400">Avance General</span>
            <span className="text-xs font-semibold text-brand-600">{sp?.progress_pct || 0}%</span>
          </div>
          <div className="w-full h-2 bg-surface-100 rounded-full overflow-hidden">
            <div className="h-full bg-gradient-to-r from-brand-500 to-brand-400 rounded-full transition-all duration-500" style={{ width: `${sp?.progress_pct || 0}%` }} />
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <div className="flex border-b border-surface-100 overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-4 py-3 text-sm font-medium whitespace-nowrap border-b-2 transition-colors
                  ${isActive ? 'border-brand-600 text-brand-700 bg-brand-50/50' : 'border-transparent text-surface-400 hover:text-surface-600'}`}>
                <Icon className="w-4 h-4" />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="p-4">
          {activeTab === 'schedule' && <SchedulePanel projectId={selectedId} perms={perms} />}
          {activeTab === 'progress' && <ProgressPanel projectId={selectedId} perms={perms} />}
          {activeTab === 'budget_tracking' && <BudgetTrackingPanel projectId={selectedId} perms={perms} />}
          {activeTab === 'payments' && <PaymentsPanel projectId={selectedId} perms={perms} />}
          {activeTab === 'minutes' && <MinutesPanel projectId={selectedId} perms={perms} />}
          {activeTab === 'changes' && <ChangesPanel projectId={selectedId} perms={perms} onProjectChanged={reloadSelectedProject} />}
          {activeTab === 'risks'           && <RisksPanel           projectId={selectedId} perms={perms} />}
          {activeTab === 'correspondence'  && <CorrespondencePanel  projectId={selectedId} perms={perms} />}
        </div>
      </div>
    </div>
  );
}
