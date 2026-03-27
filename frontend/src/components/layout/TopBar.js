import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Bell, Search, HelpCircle, X, AlertTriangle, CreditCard,
  ChevronRight, Loader2, CheckCircle2, FolderOpen, Clock,
  Keyboard, BookOpen, MessageCircle, ExternalLink, Zap,
  Shield, FileText, Flag,
} from 'lucide-react';
import api from '../../services/api';

// ─── Page title map ───────────────────────────────────────────────────────────
const PAGE_TITLES = {
  '/':               'Dashboard',
  '/adjudicacion':   'Adjudicación y Arranque',
  '/planificacion':  'Planificación',
  '/ejecucion':      'Ejecución y Seguimiento',
  '/control':        'Control y Cambios',
  '/cierre':         'Cierre y Liquidación',
  '/indicadores':    'Indicadores y KPIs',
  '/ia':             'Motor de IA',
  '/configuracion':  'Configuración',
  '/admin/usuarios': 'Usuarios y Roles',
};

// ─── Formatting helpers ───────────────────────────────────────────────────────
const COP = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });

function relDate(dateStr) {
  if (!dateStr) return '';
  const d = new Date(dateStr);
  const diff = Math.floor((Date.now() - d) / 86400000);
  if (diff === 0) return 'Hoy';
  if (diff === 1) return 'Ayer';
  if (diff < 0)  return `En ${Math.abs(diff)}d`;
  return `Hace ${diff}d`;
}

// ─── useClickOutside ─────────────────────────────────────────────────────────
function useClickOutside(ref, handler) {
  useEffect(() => {
    const listener = (e) => { if (ref.current && !ref.current.contains(e.target)) handler(); };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

// ══════════════════════════════════════════════════════════════════════════════
// SEARCH MODAL
// ══════════════════════════════════════════════════════════════════════════════
function SearchModal({ onClose }) {
  const [query, setQuery]         = useState('');
  const [projects, setProjects]   = useState([]);
  const [loading, setLoading]     = useState(false);
  const [allProjects, setAll]     = useState(null);
  const inputRef = useRef(null);
  const navigate = useNavigate();

  // Focus input on open
  useEffect(() => { inputRef.current?.focus(); }, []);

  // Keyboard: ESC closes
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // Load all projects once
  useEffect(() => {
    setLoading(true);
    api.get('/projects')
      .then(r => {
        const list = r.data?.data || r.data || [];
        setAll(Array.isArray(list) ? list : []);
      })
      .catch(() => setAll([]))
      .finally(() => setLoading(false));
  }, []);

  // Filter on query change
  useEffect(() => {
    if (!allProjects) return;
    const q = query.toLowerCase().trim();
    if (!q) { setProjects(allProjects.slice(0, 8)); return; }
    setProjects(
      allProjects.filter(p =>
        p.name?.toLowerCase().includes(q) ||
        p.code?.toLowerCase().includes(q) ||
        p.client_name?.toLowerCase().includes(q)
      ).slice(0, 8)
    );
  }, [query, allProjects]);

  const goTo = (id) => { navigate(`/adjudicacion/${id}`); onClose(); };

  const STATUS_COLOR = {
    'En Ejecución': 'bg-blue-100 text-blue-700',
    'Adjudicado':   'bg-emerald-100 text-emerald-700',
    'Cerrado':      'bg-surface-100 text-surface-500',
    'En Riesgo':    'bg-red-100 text-red-700',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[12vh]"
         style={{ background: 'rgba(15,23,42,0.45)', backdropFilter: 'blur(2px)' }}
         onClick={onClose}>
      <div className="w-full max-w-xl bg-white rounded-2xl shadow-2xl overflow-hidden mx-4"
           onClick={e => e.stopPropagation()}>
        {/* Input */}
        <div className="flex items-center gap-3 px-4 py-3.5 border-b border-surface-100">
          <Search className="w-4.5 h-4.5 text-surface-400 flex-shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Buscar proyecto por nombre, código o cliente..."
            className="flex-1 text-sm text-brand-900 placeholder:text-surface-400 outline-none bg-transparent"
          />
          {query && (
            <button onClick={() => setQuery('')} className="text-surface-400 hover:text-brand-600 transition-colors">
              <X className="w-4 h-4" />
            </button>
          )}
          <kbd className="hidden sm:flex items-center gap-0.5 px-1.5 py-0.5 bg-surface-100 rounded text-[10px] text-surface-400 font-mono">Esc</kbd>
        </div>

        {/* Results */}
        <div className="max-h-[360px] overflow-y-auto">
          {loading ? (
            <div className="flex items-center justify-center py-10 gap-2 text-surface-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">Cargando proyectos...</span>
            </div>
          ) : projects.length === 0 ? (
            <div className="text-center py-10">
              <FolderOpen className="w-8 h-8 mx-auto text-surface-200 mb-2" />
              <p className="text-sm text-surface-400">
                {query ? `Sin resultados para "${query}"` : 'No hay proyectos disponibles'}
              </p>
            </div>
          ) : (
            <ul>
              {projects.map(p => (
                <li key={p.id}>
                  <button onClick={() => goTo(p.id)}
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-brand-50 transition-colors text-left group">
                    <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center flex-shrink-0">
                      <FolderOpen className="w-3.5 h-3.5 text-brand-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-brand-900 truncate">{p.name}</p>
                      <p className="text-[11px] text-surface-400">{p.code}{p.client_name ? ` · ${p.client_name}` : ''}</p>
                    </div>
                    {p.status && (
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full flex-shrink-0 ${STATUS_COLOR[p.status] || 'bg-surface-100 text-surface-500'}`}>
                        {p.status}
                      </span>
                    )}
                    <ChevronRight className="w-3.5 h-3.5 text-surface-300 group-hover:text-brand-500 transition-colors flex-shrink-0" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Footer hint */}
        <div className="px-4 py-2.5 border-t border-surface-50 bg-surface-50 flex items-center justify-between">
          <span className="text-[10px] text-surface-400">
            {allProjects?.length ? `${allProjects.length} proyecto${allProjects.length !== 1 ? 's' : ''} disponibles` : ''}
          </span>
          <span className="text-[10px] text-surface-400 flex items-center gap-1">
            <kbd className="px-1 py-0.5 bg-white border border-surface-200 rounded text-[9px] font-mono">↑↓</kbd> navegar ·
            <kbd className="px-1 py-0.5 bg-white border border-surface-200 rounded text-[9px] font-mono">↵</kbd> abrir
          </span>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICATIONS DROPDOWN
// ══════════════════════════════════════════════════════════════════════════════
function NotificationsPanel({ onClose }) {
  const [items, setItems]     = useState([]);
  const [loading, setLoading] = useState(true);
  const ref = useRef(null);
  const navigate = useNavigate();
  useClickOutside(ref, onClose);

  useEffect(() => {
    api.get('/notifications')
      .then(r => setItems(r.data?.data || []))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);

  const commitments     = items.filter(i => i.type === 'commitment_overdue');
  const payments        = items.filter(i => i.type === 'payment_pending');
  const policiesExp     = items.filter(i => i.type === 'policy_expiring' || i.type === 'policy_expired');
  const contracts       = items.filter(i => i.type === 'contract_ending' || i.type === 'contract_overdue');
  const milestonesOver  = items.filter(i => i.type === 'milestone_overdue');

  const goProject = (id) => { navigate(`/adjudicacion/${id}`); onClose(); };

  const PRIORITY_COLOR = { alta: 'text-red-500', media: 'text-amber-500', baja: 'text-surface-400' };

  return (
    <div ref={ref}
      className="absolute right-0 top-full mt-2 w-96 bg-white rounded-2xl shadow-xl border border-surface-100 z-40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100">
        <div className="flex items-center gap-2">
          <Bell className="w-4 h-4 text-brand-600" />
          <span className="text-sm font-semibold text-brand-900">Notificaciones</span>
          {items.length > 0 && (
            <span className="px-1.5 py-0.5 bg-red-100 text-red-600 text-[10px] font-bold rounded-full">
              {items.length}
            </span>
          )}
        </div>
        <button onClick={onClose} className="text-surface-400 hover:text-brand-600 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Body */}
      <div className="max-h-[460px] overflow-y-auto divide-y divide-surface-50">
        {loading ? (
          <div className="flex items-center justify-center py-10 gap-2 text-surface-400">
            <Loader2 className="w-4 h-4 animate-spin" />
            <span className="text-sm">Cargando alertas...</span>
          </div>
        ) : items.length === 0 ? (
          <div className="text-center py-10">
            <CheckCircle2 className="w-8 h-8 mx-auto text-emerald-300 mb-2" />
            <p className="text-sm font-medium text-brand-800">Todo al día</p>
            <p className="text-xs text-surface-400 mt-0.5">No hay alertas pendientes</p>
          </div>
        ) : (
          <>
            {/* Overdue commitments */}
            {commitments.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-red-50 flex items-center gap-1.5">
                  <AlertTriangle className="w-3 h-3 text-red-500" />
                  <span className="text-[10px] font-semibold text-red-600 uppercase tracking-wide">
                    Compromisos vencidos ({commitments.length})
                  </span>
                </div>
                {commitments.map(item => (
                  <button key={item.id} onClick={() => goProject(item.project_id)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface-50 transition-colors text-left group">
                    <div className="w-7 h-7 rounded-lg bg-red-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <AlertTriangle className={`w-3.5 h-3.5 ${PRIORITY_COLOR[item.priority] || 'text-red-500'}`} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-brand-900 line-clamp-2">{item.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-surface-400 truncate">{item.project_code}</span>
                        <span className="w-1 h-1 rounded-full bg-surface-300 flex-shrink-0" />
                        <span className="text-[10px] text-red-500 font-medium flex-shrink-0 flex items-center gap-0.5">
                          <Clock className="w-2.5 h-2.5" />
                          {item.days_overdue === 1 ? '1 día' : `${item.days_overdue} días`} vencido
                        </span>
                      </div>
                      {item.responsible && (
                        <p className="text-[10px] text-surface-400 mt-0.5 truncate">Resp: {item.responsible}</p>
                      )}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-surface-300 group-hover:text-brand-500 mt-0.5 flex-shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            )}

            {/* Payments pending */}
            {payments.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-amber-50 flex items-center gap-1.5">
                  <CreditCard className="w-3 h-3 text-amber-600" />
                  <span className="text-[10px] font-semibold text-amber-700 uppercase tracking-wide">
                    Pagos pendientes ({payments.length})
                  </span>
                </div>
                {payments.map(item => (
                  <button key={item.id} onClick={() => goProject(item.project_id)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface-50 transition-colors text-left group">
                    <div className="w-7 h-7 rounded-lg bg-amber-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <CreditCard className="w-3.5 h-3.5 text-amber-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-brand-900 line-clamp-1">{item.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-surface-400 truncate">{item.project_code}</span>
                        <span className="w-1 h-1 rounded-full bg-surface-300 flex-shrink-0" />
                        <span className="text-[10px] font-medium text-amber-600 flex-shrink-0">{item.status_label}</span>
                      </div>
                      {item.net_value > 0 && (
                        <p className="text-[10px] text-surface-500 mt-0.5">{COP.format(item.net_value)}</p>
                      )}
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-surface-300 group-hover:text-brand-500 mt-0.5 flex-shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            )}

            {/* Policies expiring / expired */}
            {policiesExp.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-orange-50 flex items-center gap-1.5">
                  <Shield className="w-3 h-3 text-orange-600" />
                  <span className="text-[10px] font-semibold text-orange-700 uppercase tracking-wide">
                    Pólizas por vencer ({policiesExp.length})
                  </span>
                </div>
                {policiesExp.map(item => {
                  const expired = item.type === 'policy_expired';
                  const urgent  = !expired && item.days_until <= 7;
                  return (
                    <button key={item.id} onClick={() => goProject(item.project_id)}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface-50 transition-colors text-left group">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${expired ? 'bg-red-100' : urgent ? 'bg-orange-100' : 'bg-amber-50'}`}>
                        <Shield className={`w-3.5 h-3.5 ${expired ? 'text-red-500' : urgent ? 'text-orange-600' : 'text-amber-500'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-brand-900 line-clamp-1">{item.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-surface-400 truncate">{item.project_code}</span>
                          <span className="w-1 h-1 rounded-full bg-surface-300 flex-shrink-0" />
                          <span className={`text-[10px] font-medium flex-shrink-0 flex items-center gap-0.5 ${expired ? 'text-red-500' : 'text-orange-600'}`}>
                            <Clock className="w-2.5 h-2.5" />
                            {expired ? `Vencida` : item.days_until === 1 ? 'Vence mañana' : `Vence en ${item.days_until}d`}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-surface-300 group-hover:text-brand-500 mt-0.5 flex-shrink-0 transition-colors" />
                    </button>
                  );
                })}
              </div>
            )}

            {/* Contracts ending */}
            {contracts.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-blue-50 flex items-center gap-1.5">
                  <FileText className="w-3 h-3 text-blue-600" />
                  <span className="text-[10px] font-semibold text-blue-700 uppercase tracking-wide">
                    Contratos por terminar ({contracts.length})
                  </span>
                </div>
                {contracts.map(item => {
                  const overdue = item.type === 'contract_overdue';
                  return (
                    <button key={item.id} onClick={() => goProject(item.project_id)}
                      className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface-50 transition-colors text-left group">
                      <div className={`w-7 h-7 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5 ${overdue ? 'bg-red-100' : 'bg-blue-100'}`}>
                        <FileText className={`w-3.5 h-3.5 ${overdue ? 'text-red-500' : 'text-blue-600'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="text-xs font-medium text-brand-900 line-clamp-1">{item.title}</p>
                        <div className="flex items-center gap-2 mt-0.5">
                          <span className="text-[10px] text-surface-400 truncate">{item.project_code}</span>
                          <span className="w-1 h-1 rounded-full bg-surface-300 flex-shrink-0" />
                          <span className={`text-[10px] font-medium flex-shrink-0 flex items-center gap-0.5 ${overdue ? 'text-red-500' : 'text-blue-600'}`}>
                            <Clock className="w-2.5 h-2.5" />
                            {overdue ? `Plazo vencido` : item.days_until === 1 ? 'Termina mañana' : `Termina en ${item.days_until}d`}
                          </span>
                        </div>
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-surface-300 group-hover:text-brand-500 mt-0.5 flex-shrink-0 transition-colors" />
                    </button>
                  );
                })}
              </div>
            )}

            {/* Milestones overdue */}
            {milestonesOver.length > 0 && (
              <div>
                <div className="px-4 py-2 bg-violet-50 flex items-center gap-1.5">
                  <Flag className="w-3 h-3 text-violet-600" />
                  <span className="text-[10px] font-semibold text-violet-700 uppercase tracking-wide">
                    Hitos vencidos ({milestonesOver.length})
                  </span>
                </div>
                {milestonesOver.map(item => (
                  <button key={item.id} onClick={() => goProject(item.project_id)}
                    className="w-full flex items-start gap-3 px-4 py-3 hover:bg-surface-50 transition-colors text-left group">
                    <div className="w-7 h-7 rounded-lg bg-violet-100 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <Flag className="w-3.5 h-3.5 text-violet-600" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-xs font-medium text-brand-900 line-clamp-1">{item.title}</p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] text-surface-400 truncate">{item.project_code}</span>
                        <span className="w-1 h-1 rounded-full bg-surface-300 flex-shrink-0" />
                        <span className="text-[10px] font-medium text-violet-600 flex-shrink-0">
                          {item.done_del}/{item.total_del} entregables · {item.days_overdue}d vencido
                        </span>
                      </div>
                    </div>
                    <ChevronRight className="w-3.5 h-3.5 text-surface-300 group-hover:text-brand-500 mt-0.5 flex-shrink-0 transition-colors" />
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {/* Footer */}
      {!loading && items.length > 0 && (
        <div className="px-4 py-2.5 border-t border-surface-100 bg-surface-50">
          <p className="text-[10px] text-surface-400 text-center">
            Haz clic en un elemento para ir al proyecto
          </p>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// HELP DROPDOWN
// ══════════════════════════════════════════════════════════════════════════════
function HelpPanel({ onClose }) {
  const ref = useRef(null);
  const navigate = useNavigate();
  useClickOutside(ref, onClose);

  const SHORTCUTS = [
    { keys: ['Ctrl', 'K'], action: 'Búsqueda rápida' },
    { keys: ['Esc'],       action: 'Cerrar paneles / modales' },
  ];

  const LINKS = [
    { icon: FolderOpen,    label: 'Ir a Adjudicación',  action: () => { navigate('/adjudicacion'); onClose(); } },
    { icon: Zap,           label: 'Integraciones N8N',  action: () => { navigate('/configuracion'); onClose(); } },
    { icon: BookOpen,      label: 'Módulo IA',           action: () => { navigate('/ia'); onClose(); } },
    { icon: MessageCircle, label: 'Configuración',       action: () => { navigate('/configuracion'); onClose(); } },
  ];

  return (
    <div ref={ref}
      className="absolute right-0 top-full mt-2 w-72 bg-white rounded-2xl shadow-xl border border-surface-100 z-40 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100">
        <div className="flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-brand-600" />
          <span className="text-sm font-semibold text-brand-900">Ayuda rápida</span>
        </div>
        <button onClick={onClose} className="text-surface-400 hover:text-brand-600 transition-colors">
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="p-3 space-y-3">
        {/* Quick links */}
        <div>
          <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide px-1 mb-1.5">Accesos directos</p>
          <div className="space-y-0.5">
            {LINKS.map((l, i) => {
              const Icon = l.icon;
              return (
                <button key={i} onClick={l.action}
                  className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg hover:bg-brand-50 text-left transition-colors group">
                  <Icon className="w-3.5 h-3.5 text-brand-400 group-hover:text-brand-600 flex-shrink-0 transition-colors" />
                  <span className="text-xs text-brand-800">{l.label}</span>
                  <ChevronRight className="w-3 h-3 text-surface-300 ml-auto group-hover:text-brand-500 transition-colors" />
                </button>
              );
            })}
          </div>
        </div>

        {/* Keyboard shortcuts */}
        <div className="border-t border-surface-100 pt-3">
          <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide px-1 mb-1.5 flex items-center gap-1">
            <Keyboard className="w-3 h-3" /> Atajos de teclado
          </p>
          <div className="space-y-1.5 px-1">
            {SHORTCUTS.map((s, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-xs text-surface-500">{s.action}</span>
                <div className="flex items-center gap-1">
                  {s.keys.map((k, j) => (
                    <kbd key={j} className="px-1.5 py-0.5 bg-surface-100 border border-surface-200 rounded text-[10px] font-mono text-surface-600">
                      {k}
                    </kbd>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Version info */}
        <div className="border-t border-surface-100 pt-2.5 px-1">
          <div className="flex items-center justify-between text-[10px] text-surface-400">
            <span>SGIP-IA v1.0</span>
            <span className="flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Sistema operativo
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// TOP BAR
// ══════════════════════════════════════════════════════════════════════════════
export default function TopBar() {
  const location = useLocation();
  const title    = PAGE_TITLES[location.pathname] || 'SGIP-IA';

  const [showSearch, setShowSearch]  = useState(false);
  const [showNotifs, setShowNotifs]  = useState(false);
  const [showHelp,   setShowHelp]    = useState(false);
  const [notifCount, setNotifCount]  = useState(0);

  const notifBtnRef = useRef(null);
  const helpBtnRef  = useRef(null);

  // Load notification count on mount
  useEffect(() => {
    api.get('/notifications')
      .then(r => setNotifCount(r.data?.total || 0))
      .catch(() => {});
  }, [location.pathname]); // Refresh on navigation

  // Global Ctrl+K shortcut for search
  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(s => !s);
        setShowNotifs(false);
        setShowHelp(false);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, []);

  const toggleNotifs = useCallback(() => {
    setShowNotifs(s => !s);
    setShowHelp(false);
  }, []);

  const toggleHelp = useCallback(() => {
    setShowHelp(s => !s);
    setShowNotifs(false);
  }, []);

  const closeSearch = useCallback(() => setShowSearch(false), []);
  const closeNotifs = useCallback(() => setShowNotifs(false), []);
  const closeHelp   = useCallback(() => setShowHelp(false), []);

  return (
    <>
      <header className="h-16 bg-white border-b border-brand-500 flex items-center justify-between px-6 flex-shrink-0">
        {/* Left: Title */}
        <h1 className="text-lg font-display font-bold text-brand-900">{title}</h1>

        {/* Right: Actions */}
        <div className="flex items-center gap-1">
          {/* Search */}
          <button
            onClick={() => { setShowSearch(true); setShowNotifs(false); setShowHelp(false); }}
            title="Buscar (Ctrl+K)"
            className="w-9 h-9 rounded-lg hover:bg-surface-100 flex items-center justify-center transition-colors group">
            <Search className="w-4 h-4 text-surface-400 group-hover:text-brand-600 transition-colors" />
          </button>

          {/* Notifications */}
          <div className="relative" ref={notifBtnRef}>
            <button
              onClick={toggleNotifs}
              title="Notificaciones"
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors relative group ${showNotifs ? 'bg-brand-50' : 'hover:bg-surface-100'}`}>
              <Bell className={`w-4 h-4 transition-colors ${showNotifs ? 'text-brand-600' : 'text-surface-400 group-hover:text-brand-600'}`} />
              {notifCount > 0 && (
                <span className="absolute top-1.5 right-1.5 min-w-[14px] h-[14px] px-0.5 bg-red-500 rounded-full flex items-center justify-center text-[9px] font-bold text-white leading-none">
                  {notifCount > 9 ? '9+' : notifCount}
                </span>
              )}
            </button>
            {showNotifs && <NotificationsPanel onClose={closeNotifs} />}
          </div>

          {/* Help */}
          <div className="relative" ref={helpBtnRef}>
            <button
              onClick={toggleHelp}
              title="Ayuda"
              className={`w-9 h-9 rounded-lg flex items-center justify-center transition-colors group ${showHelp ? 'bg-brand-50' : 'hover:bg-surface-100'}`}>
              <HelpCircle className={`w-4 h-4 transition-colors ${showHelp ? 'text-brand-600' : 'text-surface-400 group-hover:text-brand-600'}`} />
            </button>
            {showHelp && <HelpPanel onClose={closeHelp} />}
          </div>
        </div>
      </header>

      {/* Search modal (portal-style overlay) */}
      {showSearch && <SearchModal onClose={closeSearch} />}
    </>
  );
}
