import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import { projectsAPI } from '../../services/api';
import { usePermissions } from '../../hooks/usePermissions';
import DocumentsPanel from '../documents/DocumentsPanel';
import ObligationsPanel from '../obligations/ObligationsPanel';
import PoliciesPanel from '../policies/PoliciesPanel';
import BudgetPanel from '../budget/BudgetPanel';
import TeamPanel from '../team/TeamPanel';
import ProjectAssignmentsPanel from './ProjectAssignmentsPanel';
import MilestonesPanel from '../milestones/MilestonesPanel';
import {
  ArrowLeft, Edit2, FileText, ClipboardList, Package,
  Flag, Shield, DollarSign, Users, FolderOpen, Info as InfoIcon,
  ArrowRight, ChevronRight, AlertTriangle, CheckCircle2, X, Loader2,
  FolderKanban,
} from 'lucide-react';
import SharePointPanel from '../sharepoint/SharePointPanel';

const TYPE_L = { obra_civil:'Obra Civil', ti:'TI', consultoria:'Consultoría', interventoria:'Interventoría', asesoria:'Asesoría', mixto:'Mixto', otro:'Otro' };

// ═══ STATUS FLOW DEFINITION ═══
const STATUS_FLOW = [
  { key: 'adjudicado',    label: 'Adjudicado',    icon: '📋', color: 'blue',    desc: 'Contrato adjudicado, pendiente inicio' },
  { key: 'en_arranque',   label: 'En Arranque',   icon: '🚀', color: 'amber',   desc: 'Preparación: documentos, equipo, pólizas' },
  { key: 'en_ejecucion',  label: 'En Ejecución',  icon: '⚙️', color: 'emerald', desc: 'Ejecución activa del contrato' },
  { key: 'suspendido',    label: 'Suspendido',     icon: '⏸️', color: 'red',     desc: 'Ejecución temporalmente detenida' },
  { key: 'cerrado',       label: 'Cerrado',        icon: '✅', color: 'gray',    desc: 'Ejecución terminada, pendiente liquidar' },
  { key: 'liquidado',     label: 'Liquidado',      icon: '🏁', color: 'slate',   desc: 'Contrato liquidado y archivado' },
];

const STATUS_C = {
  adjudicado:   { label:'Adjudicado',    bg:'bg-blue-100',    text:'text-blue-700',    ring:'ring-blue-400',    fill:'bg-blue-500' },
  en_arranque:  { label:'En Arranque',   bg:'bg-amber-100',   text:'text-amber-700',   ring:'ring-amber-400',   fill:'bg-amber-500' },
  en_ejecucion: { label:'En Ejecución',  bg:'bg-brand-100',   text:'text-brand-700',  ring:'ring-brand-400',   fill:'bg-brand-500' },
  suspendido:   { label:'Suspendido',    bg:'bg-red-100',     text:'text-red-700',     ring:'ring-red-400',     fill:'bg-red-500' },
  cerrado:      { label:'Cerrado',       bg:'bg-gray-100',    text:'text-gray-700',    ring:'ring-gray-400',    fill:'bg-gray-500' },
  liquidado:    { label:'Liquidado',     bg:'bg-slate-100',   text:'text-slate-500',   ring:'ring-slate-400',   fill:'bg-slate-400' },
};

const PRIO_C = { alta:{ label:'Alta', dot:'bg-red-500' }, media:{ label:'Media', dot:'bg-amber-500' }, baja:{ label:'Baja', dot:'bg-green-500' } };

function fmtMoney(v) { return v ? new Intl.NumberFormat('es-CO',{style:'currency',currency:'COP',maximumFractionDigits:0}).format(v) : '\u2014'; }
function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO',{day:'2-digit',month:'long',year:'numeric'}) : '\u2014'; }

function InfoRow({ label, value }) {
  return (
    <div className="py-2.5 px-1 border-b border-surface-50 last:border-0 flex flex-col sm:flex-row sm:items-center gap-1">
      <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide sm:w-44 flex-shrink-0">{label}</span>
      <span className="text-sm text-brand-900">{value || '\u2014'}</span>
    </div>
  );
}

function CountCard({ icon: Icon, label, count, color, active, onClick }) {
  return (
    <button onClick={onClick}
      className={`flex items-center gap-3 p-3 rounded-lg transition-all text-left w-full
        ${active ? 'bg-brand-50 ring-2 ring-brand-300' : 'bg-surface-50 hover:bg-surface-100'}`}>
      <div className={`w-8 h-8 rounded-lg ${color} flex items-center justify-center`}>
        <Icon className="w-4 h-4 text-white" />
      </div>
      <div>
        <p className="text-lg font-display font-bold text-brand-900">{count}</p>
        <p className="text-xs text-surface-400">{label}</p>
      </div>
    </button>
  );
}

// ═══════════════════════════════════════
// STATUS FLOW COMPONENT
// Visual pipeline + change button
// ═══════════════════════════════════════
function StatusFlowBar({ project, perms, onStatusChanged }) {
  const [transitions, setTransitions] = useState([]);
  const [showModal, setShowModal] = useState(false);
  const [changing, setChanging] = useState(false);
  const [selectedTarget, setSelectedTarget] = useState(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');

  const current = project.status;
  const currentIdx = STATUS_FLOW.findIndex(s => s.key === current);

  // Load allowed transitions
  useEffect(() => {
    projectsAPI.statusInfo(project.id)
      .then(r => setTransitions(r.data.data.transitions || []))
      .catch(() => setTransitions([]));
  }, [project.id, project.status]);

  const handleChange = async () => {
    if (!selectedTarget) return;
    setChanging(true); setError('');
    try {
      await projectsAPI.changeStatus(project.id, { new_status: selectedTarget, reason });
      setShowModal(false); setSelectedTarget(null); setReason('');
      onStatusChanged();
    } catch (err) {
      setError(err.response?.data?.error || 'Error cambiando estado');
    } finally { setChanging(false); }
  };

  // Determine step state: completed / current / future / detour
  const getStepState = (stepKey, stepIdx) => {
    if (stepKey === current) return 'current';
    if (stepKey === 'suspendido' && current !== 'suspendido') return 'detour';
    if (stepIdx < currentIdx) return 'completed';
    return 'future';
  };

  // Main flow (without suspendido — shown separately if active)
  const mainFlow = STATUS_FLOW.filter(s => s.key !== 'suspendido');

  return (
    <div className="bg-white rounded-xl shadow-card p-4 space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-semibold text-brand-900">Estado del Proyecto</h4>
        {perms.canEdit && transitions.length > 0 && (
          <button onClick={() => setShowModal(true)}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 text-white rounded-lg text-xs font-medium hover:bg-brand-700 transition-colors">
            <ArrowRight className="w-3.5 h-3.5" /> Cambiar Estado
          </button>
        )}
      </div>

      {/* Visual flow pipeline */}
      <div className="flex items-center gap-0 overflow-x-auto py-2">
        {mainFlow.map((step, i) => {
          const state = getStepState(step.key, STATUS_FLOW.findIndex(s => s.key === step.key));
          const sc = STATUS_C[step.key] || {};
          const isLast = i === mainFlow.length - 1;

          return (
            <React.Fragment key={step.key}>
              <div className="flex flex-col items-center min-w-[90px] relative">
                {/* Circle */}
                <div className={`w-9 h-9 rounded-full flex items-center justify-center text-sm transition-all
                  ${state === 'current' ? `${sc.fill} text-white ring-4 ${sc.ring} ring-opacity-30 shadow-md` :
                    state === 'completed' ? 'bg-brand-500 text-white' :
                    'bg-surface-100 text-surface-300'}`}>
                  {state === 'completed' ? <CheckCircle2 className="w-4 h-4" /> : step.icon}
                </div>
                {/* Label */}
                <span className={`mt-1.5 text-[10px] font-medium text-center leading-tight
                  ${state === 'current' ? sc.text + ' font-bold' :
                    state === 'completed' ? 'text-brand-600' : 'text-surface-300'}`}>
                  {step.label}
                </span>
              </div>
              {/* Connector */}
              {!isLast && (
                <div className="flex-shrink-0 w-6 sm:w-10 flex items-center -mt-4">
                  <div className={`h-0.5 w-full rounded ${
                    state === 'completed' || state === 'current' ? 'bg-brand-300' : 'bg-surface-100'}`} />
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>

      {/* Suspended indicator (shown if currently suspended) */}
      {current === 'suspendido' && (
        <div className="flex items-center gap-2 px-3 py-2 bg-red-50 border border-red-200 rounded-lg">
          <span className="text-base">⏸️</span>
          <span className="text-xs font-medium text-red-700">Proyecto suspendido temporalmente</span>
        </div>
      )}

      {/* Current status detail */}
      <div className={`flex items-center gap-3 px-3 py-2 rounded-lg ${STATUS_C[current]?.bg}`}>
        <span className={`text-xs font-medium ${STATUS_C[current]?.text}`}>
          Estado actual: <strong>{STATUS_C[current]?.label}</strong>
          {' — '}{STATUS_FLOW.find(s => s.key === current)?.desc}
        </span>
      </div>

      {/* Auto-transition hints */}
      {current === 'adjudicado' && (
        <p className="text-[10px] text-surface-400 italic px-1">
          💡 Al subir el primer documento, el proyecto pasa automáticamente a "En Arranque".
          También puede hacerlo manualmente.
        </p>
      )}

      {/* Change Status Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={() => setShowModal(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between p-5 border-b border-surface-100">
              <h3 className="font-display font-bold text-brand-900">Cambiar Estado del Proyecto</h3>
              <button onClick={() => setShowModal(false)}><X className="w-4 h-4 text-surface-400" /></button>
            </div>
            <div className="p-5 space-y-4">
              {/* Current */}
              <div className="flex items-center gap-3">
                <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${STATUS_C[current]?.bg} ${STATUS_C[current]?.text}`}>
                  {STATUS_C[current]?.label}
                </span>
                <ChevronRight className="w-4 h-4 text-surface-300" />
                <span className="text-sm text-surface-400">Seleccione el nuevo estado:</span>
              </div>

              {/* Target options */}
              <div className="space-y-2">
                {transitions.map(t => {
                  const sc = STATUS_C[t.value] || {};
                  const flow = STATUS_FLOW.find(s => s.key === t.value);
                  const isSelected = selectedTarget === t.value;
                  return (
                    <button key={t.value} onClick={() => setSelectedTarget(t.value)}
                      className={`w-full flex items-center gap-3 p-3 rounded-lg border-2 text-left transition-all
                        ${isSelected ? `border-brand-400 ${sc.bg}` : 'border-surface-100 hover:border-surface-200'}`}>
                      <div className={`w-8 h-8 rounded-full ${sc.fill} text-white flex items-center justify-center text-sm`}>
                        {flow?.icon}
                      </div>
                      <div>
                        <p className={`text-sm font-medium ${isSelected ? sc.text : 'text-brand-900'}`}>{t.label}</p>
                        <p className="text-[10px] text-surface-400">{flow?.desc}</p>
                      </div>
                      {isSelected && <CheckCircle2 className="w-5 h-5 text-brand-600 ml-auto" />}
                    </button>
                  );
                })}
              </div>

              {/* Warning for critical transitions */}
              {(selectedTarget === 'suspendido' || selectedTarget === 'cerrado') && (
                <div className="flex items-start gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-amber-700">
                    {selectedTarget === 'suspendido'
                      ? 'Suspender el proyecto detendrá todas las actividades. Podrá reactivarse después.'
                      : 'Cerrar el proyecto indica que la ejecución terminó. Debe procederse con la liquidación.'}
                  </p>
                </div>
              )}

              {/* Reason */}
              <div>
                <label className="block text-xs font-medium text-brand-800 mb-1">
                  Motivo del cambio {(selectedTarget === 'suspendido' || selectedTarget === 'cerrado') ? '*' : '(opcional)'}
                </label>
                <textarea value={reason} onChange={e => setReason(e.target.value)}
                  placeholder="Ej: Se completa fase de arranque y se inicia ejecución..."
                  className="input-field text-sm min-h-[60px] resize-y" />
              </div>

              {error && <p className="text-xs text-red-600 bg-red-50 p-2 rounded">{error}</p>}

              <div className="flex justify-end gap-3 pt-2">
                <button onClick={() => setShowModal(false)} className="btn-ghost text-sm">Cancelar</button>
                <button onClick={handleChange}
                  disabled={!selectedTarget || changing || ((selectedTarget === 'suspendido' || selectedTarget === 'cerrado') && !reason.trim())}
                  className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50">
                  {changing ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
                  Confirmar Cambio
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════
// TABS
// ═══════════════════════════════════════
const ALL_TABS = [
  { id: 'info',        label: 'Información',  icon: InfoIcon },
  { id: 'documents',   label: 'Documentos',   icon: FolderOpen },
  { id: 'obligations', label: 'Obligaciones', icon: ClipboardList },
  { id: 'milestones',  label: 'Hitos',        icon: Flag },
  { id: 'policies',    label: 'Pólizas',      icon: Shield },
  { id: 'budget',      label: 'Presupuesto',  icon: DollarSign },
  { id: 'team',        label: 'Equipo',       icon: Users },
  { id: 'assignments', label: 'Asignaciones', icon: Shield },
  { id: 'sharepoint',  label: 'SharePoint',   icon: FolderKanban, spOnly: true },
];

// ═══════════════════════════════════════
// MAIN PAGE
// ═══════════════════════════════════════
export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const perms = usePermissions('adjudicacion');
  const [project, setProject] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('tab');
    return t && ALL_TABS.find(tab => tab.id === t) ? t : 'info';
  });

  // Sync tab when URL changes (e.g. navigating from committee dashboard)
  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const t = params.get('tab');
    if (t && ALL_TABS.find(tab => tab.id === t)) setActiveTab(t);
  }, [location.search]);

  const loadProject = useCallback(() => {
    projectsAPI.get(id)
      .then(({ data }) => {
        setProject(data.data);
        // Keep cross-module project selection in sync
        localStorage.setItem('sgip_selected_project', data.data.id);
      })
      .catch(() => navigate('/adjudicacion'))
      .finally(() => setLoading(false));
  }, [id, navigate]);

  useEffect(() => { loadProject(); }, [loadProject]);

  if (loading || !project) {
    return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;
  }

  const st = STATUS_C[project.status] || {};
  const pr = PRIO_C[project.priority] || {};
  const c = project.counts || {};

  // Show SharePoint tab if project has a connection or a folder configured
  const spEnabled = !!(project.sharepoint_connection_id || project.sharepoint_folder);
  const TABS = ALL_TABS.filter(tab => !tab.spOnly || spEnabled);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Header */}
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-3">
          <button onClick={() => navigate('/adjudicacion')} className="w-9 h-9 rounded-lg hover:bg-surface-100 flex items-center justify-center">
            <ArrowLeft className="w-4 h-4 text-surface-400" />
          </button>
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="font-mono text-xs text-brand-500 font-semibold bg-brand-50 px-2 py-0.5 rounded">{project.code}</span>
              <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>{st.label}</span>
              <div className="flex items-center gap-1">
                <div className={`w-2 h-2 rounded-full ${pr.dot}`} />
                <span className="text-xs text-surface-400">{pr.label}</span>
              </div>
            </div>
            <h2 className="text-xl font-display font-bold text-brand-900">{project.name}</h2>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {perms.canEdit && (
            <button onClick={() => navigate(`/adjudicacion/${id}/editar`)} className="btn-primary flex items-center gap-2 text-sm">
              <Edit2 className="w-3.5 h-3.5" /> Editar
            </button>
          )}
        </div>
      </div>

      {/* ═══ STATUS FLOW BAR ═══ */}
      <StatusFlowBar project={project} perms={perms} onStatusChanged={loadProject} />

      {/* Progress */}
      <div className="bg-white rounded-xl shadow-card p-4">
        <div className="flex items-center justify-between mb-2">
          <span className="text-sm font-medium text-brand-900">Avance General</span>
          <span className="text-sm font-display font-bold text-brand-600">{project.progress_pct || 0}%</span>
        </div>
        <div className="w-full h-2.5 bg-surface-100 rounded-full overflow-hidden">
          <div className="h-full bg-gradient-to-r from-brand-500 to-brand-400 rounded-full transition-all duration-500" style={{ width: `${project.progress_pct || 0}%` }} />
        </div>
      </div>

      {/* Entity counts */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-2">
        <CountCard icon={FileText}      label="Documentos"    count={c.documents || 0}     color="bg-brand-500"   active={activeTab==='documents'}   onClick={() => setActiveTab('documents')} />
        <CountCard icon={ClipboardList} label="Obligaciones"  count={c.obligations || 0}   color="bg-amber-500"   active={activeTab==='obligations'} onClick={() => setActiveTab('obligations')} />
        <CountCard icon={Package}       label="Entregables"   count={c.deliverables || 0}  color="bg-emerald-500" active={activeTab==='milestones'}   onClick={() => setActiveTab('milestones')} />
        <CountCard icon={Flag}          label="Hitos"         count={c.milestones || 0}    color="bg-violet-500"  active={activeTab==='milestones'}   onClick={() => setActiveTab('milestones')} />
        <CountCard icon={Shield}        label="Pólizas"       count={c.policies || 0}      color="bg-orange-500"  active={activeTab==='policies'}    onClick={() => setActiveTab('policies')} />
        <CountCard icon={DollarSign}    label="Presupuesto"   count={c.budget_items || 0}  color="bg-teal-500"    active={activeTab==='budget'}      onClick={() => setActiveTab('budget')} />
        <CountCard icon={Users}         label="Equipo"        count={c.team_members || 0}  color="bg-pink-500"    active={activeTab==='team'}        onClick={() => setActiveTab('team')} />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <div className="border-b border-surface-100 flex overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button key={tab.id}
                onClick={() => !tab.soon && setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-all whitespace-nowrap
                  ${isActive
                    ? 'border-brand-600 text-brand-700 bg-brand-50/50'
                    : tab.soon
                      ? 'border-transparent text-surface-300 cursor-default'
                      : 'border-transparent text-surface-400 hover:text-brand-600 hover:border-surface-200'
                  }`}>
                <Icon className="w-4 h-4" />
                {tab.label}
                {tab.soon && <span className="text-[10px] px-1.5 py-0.5 rounded bg-surface-100 text-surface-300 font-mono">Soon</span>}
              </button>
            );
          })}
        </div>

        <div className="p-5">
          {activeTab === 'info' && (
            <div className="space-y-5 animate-fade-in">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div>
                  <h3 className="font-display font-semibold text-brand-900 mb-3 pb-2 border-b border-surface-100">Información General</h3>
                  <InfoRow label="Tipo" value={TYPE_L[project.project_type]} />
                  <InfoRow label="Sector" value={project.sector === 'publico' ? 'Público' : 'Privado'} />
                  <InfoRow label="Cliente" value={project.client_name} />
                  <InfoRow label="NIT" value={project.client_nit} />
                  <InfoRow label="Director" value={project.director_name} />
                  <InfoRow label="Ubicación" value={project.location} />
                </div>
                <div>
                  <h3 className="font-display font-semibold text-brand-900 mb-3 pb-2 border-b border-surface-100">Información Contractual</h3>
                  <InfoRow label="No. Contrato" value={project.contract_number} />
                  <InfoRow label="Valor" value={fmtMoney(project.contract_value)} />
                  <InfoRow label="Fecha Firma" value={fmtDate(project.sign_date)} />
                  <InfoRow label="Fecha Inicio" value={fmtDate(project.start_date)} />
                  <InfoRow label="Plazo" value={project.execution_term ? `${project.execution_term} ${(project.execution_term_unit || '').replace('_', ' ')}` : '\u2014'} />
                  <InfoRow label="Fecha Fin Est." value={fmtDate(project.estimated_end_date)} />
                  <InfoRow label="Supervisor" value={project.supervisor} />
                </div>
              </div>

              {project.contract_object && (
                <div>
                  <h3 className="font-display font-semibold text-brand-900 mb-3 pb-2 border-b border-surface-100">Objeto del Contrato</h3>
                  <p className="text-sm text-brand-800 leading-relaxed">{project.contract_object}</p>
                </div>
              )}

              {project.sector === 'publico' && (project.selection_process || project.secop_number) && (
                <div>
                  <h3 className="font-display font-semibold text-brand-900 mb-3 pb-2 border-b border-surface-100">Sector Público</h3>
                  <InfoRow label="Proceso" value={project.selection_process?.replace('_', ' ')} />
                  <InfoRow label="SECOP" value={project.secop_number} />
                  <InfoRow label="CDP" value={project.cdp_number} />
                  <InfoRow label="RP" value={project.rp_number} />
                </div>
              )}

              {spEnabled && (
                <div className="flex items-center gap-2 py-2 px-3 bg-brand-50 rounded-lg border border-brand-100">
                  <FolderKanban className="w-4 h-4 text-brand-500 flex-shrink-0" />
                  <span className="text-xs text-brand-700 font-medium">SharePoint:</span>
                  <button onClick={() => setActiveTab('sharepoint')}
                    className="text-xs text-brand-600 hover:underline truncate">
                    {project.sharepoint_folder || 'Biblioteca configurada'}
                  </button>
                </div>
              )}

              {project.tags && project.tags.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {project.tags.map(t => (
                    <span key={t} className="px-3 py-1 bg-brand-50 text-brand-700 rounded-full text-sm font-medium">{t}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {activeTab === 'documents' && <div className="animate-fade-in"><DocumentsPanel projectId={parseInt(id)} perms={perms} onUpdate={loadProject} /></div>}
          {activeTab === 'obligations' && <div className="animate-fade-in"><ObligationsPanel projectId={parseInt(id)} perms={perms} /></div>}
          {activeTab === 'milestones' && <div className="animate-fade-in"><MilestonesPanel projectId={parseInt(id)} spFolder={spEnabled || null} perms={perms} /></div>}
          {activeTab === 'policies' && <div className="animate-fade-in"><PoliciesPanel projectId={parseInt(id)} spFolder={spEnabled || null} perms={perms} /></div>}
          {activeTab === 'budget' && <div className="animate-fade-in"><BudgetPanel projectId={parseInt(id)} perms={perms} /></div>}
          {activeTab === 'team' && <div className="animate-fade-in"><TeamPanel projectId={parseInt(id)} perms={perms} /></div>}
          {activeTab === 'assignments' && <div className="animate-fade-in"><ProjectAssignmentsPanel projectId={parseInt(id)} /></div>}
          {activeTab === 'sharepoint' && spEnabled && (
            <div className="animate-fade-in">
              <SharePointPanel projectId={parseInt(id)} folderPath={project.sharepoint_folder || ''} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
