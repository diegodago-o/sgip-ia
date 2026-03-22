import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { projectsAPI } from '../../services/api';
import {
  Plus, Search, Filter, ChevronLeft, ChevronRight,
  Eye, Edit2, Trash2, X, Sparkles,
} from 'lucide-react';
import AIProjectCreatorModal from '../ai/AIProjectCreatorModal';

const TYPE_LABELS = {
  obra_civil: 'Obra Civil', ti: 'TI', consultoria: 'Consultoría',
  interventoria: 'Interventoría', asesoria: 'Asesoría', mixto: 'Mixto', otro: 'Otro',
};

const STATUS_CONFIG = {
  adjudicado:    { label: 'Adjudicado',    bg: 'bg-blue-100',    text: 'text-blue-700' },
  en_arranque:   { label: 'En Arranque',   bg: 'bg-amber-100',   text: 'text-amber-700' },
  en_ejecucion:  { label: 'En Ejecución',  bg: 'bg-emerald-100', text: 'text-emerald-700' },
  suspendido:    { label: 'Suspendido',    bg: 'bg-red-100',     text: 'text-red-700' },
  cerrado:       { label: 'Cerrado',       bg: 'bg-gray-100',    text: 'text-gray-700' },
  liquidado:     { label: 'Liquidado',     bg: 'bg-gray-100',    text: 'text-gray-500' },
};

const PRIORITY_CONFIG = {
  alta:  { label: 'Alta',  dot: 'bg-red-500' },
  media: { label: 'Media', dot: 'bg-amber-500' },
  baja:  { label: 'Baja',  dot: 'bg-green-500' },
};

function fmtMoney(val) {
  if (!val) return '—';
  return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val);
}

function fmtDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

export default function ProjectListPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState({ status: '', sector: '', project_type: '', priority: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [showAICreator, setShowAICreator] = useState(false);

  const load = useCallback(async (page = 1) => {
    setLoading(true);
    try {
      const params = { page, limit: 15, search: search || undefined };
      Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
      const { data } = await projectsAPI.list(params);
      setProjects(data.data);
      setPagination(data.pagination);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [search, filters]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    if (!window.confirm('¿Está seguro de eliminar este proyecto? Esta acción no se puede deshacer.')) return;
    setDeleting(id);
    try {
      await projectsAPI.delete(id);
      load(pagination.page);
    } catch (err) {
      alert(err.response?.data?.error || 'Error eliminando');
    } finally {
      setDeleting(null);
    }
  };

  const clearFilters = () => {
    setFilters({ status: '', sector: '', project_type: '', priority: '' });
    setSearch('');
  };

  const hasFilters = Object.values(filters).some(v => v) || search;

  return (
    <>
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-xl font-display font-bold text-brand-900">Proyectos</h2>
          <p className="text-sm text-surface-400">{pagination.total} proyecto{pagination.total !== 1 ? 's' : ''} registrado{pagination.total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowAICreator(true)}
            className="btn-secondary flex items-center gap-2 text-sm border-brand-200 text-brand-600 hover:bg-brand-50"
          >
            <Sparkles className="w-4 h-4" /> Crear con IA
          </button>
          <button onClick={() => navigate('/adjudicacion/nuevo')} className="btn-primary flex items-center gap-2">
            <Plus className="w-4 h-4" /> Nuevo Proyecto
          </button>
        </div>
      </div>

      {/* Search & Filters */}
      <div className="bg-white rounded-xl shadow-card p-4 space-y-3">
        <div className="flex gap-2">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400" />
            <input
              type="text"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nombre, código, cliente o contrato..."
              className="input-field pl-10 py-2.5 text-sm"
            />
          </div>
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`px-3 py-2 rounded-lg border text-sm font-medium flex items-center gap-1.5 transition-colors
              ${showFilters ? 'bg-brand-50 border-brand-200 text-brand-700' : 'border-surface-200 text-surface-400 hover:border-surface-300'}`}
          >
            <Filter className="w-4 h-4" /> Filtros
          </button>
          {hasFilters && (
            <button onClick={clearFilters} className="px-3 py-2 rounded-lg text-sm text-red-600 hover:bg-red-50 flex items-center gap-1">
              <X className="w-3.5 h-3.5" /> Limpiar
            </button>
          )}
        </div>

        {showFilters && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 pt-2 border-t border-surface-100 animate-slide-up">
            <select value={filters.status} onChange={e => setFilters(f => ({...f, status: e.target.value}))}
              className="input-field py-2 text-sm">
              <option value="">Todos los estados</option>
              {Object.entries(STATUS_CONFIG).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
            <select value={filters.sector} onChange={e => setFilters(f => ({...f, sector: e.target.value}))}
              className="input-field py-2 text-sm">
              <option value="">Todos los sectores</option>
              <option value="publico">Público</option>
              <option value="privado">Privado</option>
            </select>
            <select value={filters.project_type} onChange={e => setFilters(f => ({...f, project_type: e.target.value}))}
              className="input-field py-2 text-sm">
              <option value="">Todos los tipos</option>
              {Object.entries(TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select value={filters.priority} onChange={e => setFilters(f => ({...f, priority: e.target.value}))}
              className="input-field py-2 text-sm">
              <option value="">Todas las prioridades</option>
              <option value="alta">Alta</option>
              <option value="media">Media</option>
              <option value="baja">Baja</option>
            </select>
          </div>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <div className="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-16">
            <p className="text-surface-400 mb-4">No se encontraron proyectos</p>
            <button onClick={() => navigate('/adjudicacion/nuevo')} className="btn-primary text-sm">
              Crear primer proyecto
            </button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-surface-100">
                  {['Código', 'Nombre', 'Tipo', 'Sector', 'Estado', 'Prioridad', 'Valor', 'Avance', 'Acciones'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-semibold text-surface-400 uppercase tracking-wider">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {projects.map((p) => {
                  const st = STATUS_CONFIG[p.status] || {};
                  const pr = PRIORITY_CONFIG[p.priority] || {};
                  return (
                    <tr key={p.id}
                      className="border-b border-surface-50 hover:bg-surface-50 transition-colors cursor-pointer"
                      onClick={() => navigate(`/adjudicacion/${p.id}`)}>
                      <td className="px-4 py-3 font-mono text-xs text-brand-600 font-semibold">{p.code}</td>
                      <td className="px-4 py-3">
                        <div className="max-w-[250px]">
                          <p className="font-medium text-brand-900 truncate">{p.name}</p>
                          <p className="text-xs text-surface-400 truncate">{p.client_name}</p>
                        </div>
                      </td>
                      <td className="px-4 py-3 text-surface-400">{TYPE_LABELS[p.project_type] || p.project_type}</td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-medium capitalize ${p.sector === 'publico' ? 'text-brand-600' : 'text-violet-600'}`}>
                          {p.sector === 'publico' ? 'Público' : 'Privado'}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${st.bg} ${st.text}`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-1.5">
                          <div className={`w-2 h-2 rounded-full ${pr.dot}`} />
                          <span className="text-xs">{pr.label}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs">{fmtMoney(p.contract_value)}</td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <div className="w-16 h-1.5 bg-surface-100 rounded-full overflow-hidden">
                            <div className="h-full bg-brand-500 rounded-full" style={{ width: `${p.progress_pct || 0}%` }} />
                          </div>
                          <span className="text-xs text-surface-400">{p.progress_pct || 0}%</span>
                        </div>
                      </td>
                      <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center gap-1">
                          <button onClick={() => navigate(`/adjudicacion/${p.id}`)}
                            className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center" title="Ver">
                            <Eye className="w-3.5 h-3.5 text-surface-400" />
                          </button>
                          <button onClick={() => navigate(`/adjudicacion/${p.id}/editar`)}
                            className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center" title="Editar">
                            <Edit2 className="w-3.5 h-3.5 text-surface-400" />
                          </button>
                          <button onClick={() => handleDelete(p.id)} disabled={deleting === p.id}
                            className="w-7 h-7 rounded hover:bg-red-50 flex items-center justify-center" title="Eliminar">
                            <Trash2 className="w-3.5 h-3.5 text-red-400" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination */}
        {pagination.pages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-surface-100">
            <p className="text-xs text-surface-400">
              Página {pagination.page} de {pagination.pages} · {pagination.total} registros
            </p>
            <div className="flex gap-1">
              <button onClick={() => load(pagination.page - 1)} disabled={pagination.page <= 1}
                className="w-8 h-8 rounded flex items-center justify-center hover:bg-surface-100 disabled:opacity-30">
                <ChevronLeft className="w-4 h-4" />
              </button>
              <button onClick={() => load(pagination.page + 1)} disabled={pagination.page >= pagination.pages}
                className="w-8 h-8 rounded flex items-center justify-center hover:bg-surface-100 disabled:opacity-30">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    {showAICreator && (
      <AIProjectCreatorModal onClose={() => setShowAICreator(false)} />
    )}
    </>
  );
}
