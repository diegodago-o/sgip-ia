/**
 * SPCoveragePanel — cobertura documental SharePoint por proyecto
 *
 * Muestra % de entregables, pólizas y actas que tienen documento SP vinculado.
 * Permite vincular rápidamente desde el panel sin salir del tab SharePoint.
 * Lee solo de DB (no llama a Graph API) → rápido y sin rate-limit.
 *
 * Props:
 *   projectId  {number}
 */

import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, Flag, FileText, CheckCircle2, AlertCircle,
  RefreshCw, Loader2, Link2,
} from 'lucide-react';
import { sharepointAPI, policiesAPI, deliverablesAPI, minutesAPI } from '../../services/api';
import SharePointPicker from './SharePointPicker';

// ── Module-level TTL cache — evita recargar en cada apertura del tab ──────────
const _coverageCache = new Map(); // key: projectId → { data, expiresAt }
const COVERAGE_TTL_MS = 2 * 60 * 1000; // 2 minutos

// ── Quick-link: opens SP picker and saves link to entity ──────────────────
function QuickLinkModal({ entity, entityType, projectId, onLinked, onClose }) {
  const handleSelect = async (item) => {
    try {
      const payload = { sp_item_id: item.id, sp_file_url: item.webUrl };
      if (entityType === 'policy')      await policiesAPI.update(projectId, entity.id, payload);
      if (entityType === 'deliverable') await deliverablesAPI.update(projectId, entity.id, payload);
      if (entityType === 'minute')      await minutesAPI.update(projectId, entity.id, payload);
      onLinked();
    } catch (err) {
      alert(err.response?.data?.error || 'Error al vincular el documento');
    }
    onClose();
  };

  return (
    <SharePointPicker
      projectId={projectId}
      onSelect={handleSelect}
      onClose={onClose}
    />
  );
}

// ── Coverage card for one entity type ────────────────────────────────────
function CoverageCard({ icon: Icon, label, color, data, entityType, projectId, onRefresh }) {
  const [expanded,  setExpanded]  = useState(false);
  const [quickLink, setQuickLink] = useState(null);

  if (!data) return null;

  const pct     = data.total === 0 ? 100 : Math.round((data.linked / data.total) * 100);
  const allGood = data.missing.length === 0;

  const barColor = allGood ? 'bg-emerald-500' : pct >= 60 ? 'bg-amber-400' : 'bg-red-400';
  const pctColor = allGood ? 'text-emerald-600' : pct >= 60 ? 'text-amber-600' : 'text-red-500';

  return (
    <>
      <div className={`bg-white border rounded-xl p-4 space-y-3 ${allGood ? 'border-emerald-200' : 'border-surface-200'}`}>
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className={`w-7 h-7 rounded-lg flex items-center justify-center ${color.bg}`}>
              <Icon className={`w-3.5 h-3.5 ${color.icon}`} />
            </div>
            <span className="text-sm font-semibold text-brand-900">{label}</span>
          </div>
          {allGood
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            : <AlertCircle  className="w-4 h-4 text-amber-400" />}
        </div>

        {/* Progress */}
        <div>
          <div className="flex justify-between text-[11px] text-surface-500 mb-1">
            <span>{data.linked}/{data.total} documentados</span>
            <span className={`font-bold ${pctColor}`}>{pct}%</span>
          </div>
          <div className="h-1.5 bg-surface-100 rounded-full overflow-hidden">
            <div
              className={`h-full rounded-full transition-all duration-500 ${barColor}`}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>

        {/* Missing list */}
        {data.missing.length > 0 && (
          <div>
            <button
              type="button"
              onClick={() => setExpanded(v => !v)}
              className="text-[11px] text-brand-500 hover:text-brand-700 font-medium transition-colors"
            >
              {expanded ? '▲ Ocultar' : `▼ ${data.missing.length} sin documento`}
            </button>
            {expanded && (
              <ul className="mt-2 space-y-0.5 max-h-40 overflow-y-auto">
                {data.missing.map(m => (
                  <li key={m.id} className="flex items-center justify-between gap-2 py-1 px-2 rounded-lg hover:bg-surface-50 group">
                    <span className="text-[11px] text-surface-600 truncate flex-1">{m.name}</span>
                    <button
                      type="button"
                      onClick={() => setQuickLink(m)}
                      className="flex items-center gap-1 text-[10px] text-brand-500 hover:text-brand-700 border border-brand-200 hover:border-brand-400 rounded px-1.5 py-0.5 flex-shrink-0 transition-colors opacity-0 group-hover:opacity-100"
                      title="Vincular documento SP"
                    >
                      <Link2 className="w-2.5 h-2.5" /> Vincular
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        {/* All good message */}
        {allGood && data.total > 0 && (
          <p className="text-[11px] text-emerald-600 font-medium">
            ✓ Todos documentados
          </p>
        )}
        {data.total === 0 && (
          <p className="text-[11px] text-surface-400">Sin registros</p>
        )}
      </div>

      {quickLink && (
        <QuickLinkModal
          entity={quickLink}
          entityType={entityType}
          projectId={projectId}
          onLinked={() => { setQuickLink(null); onRefresh(); }}
          onClose={() => setQuickLink(null)}
        />
      )}
    </>
  );
}

// ── Main ─────────────────────────────────────────────────────────────────
const CARDS = [
  {
    key:        'deliverables',
    label:      'Entregables',
    icon:       Flag,
    entityType: 'deliverable',
    color:      { bg: 'bg-violet-100', icon: 'text-violet-600' },
  },
  {
    key:        'policies',
    label:      'Pólizas',
    icon:       Shield,
    entityType: 'policy',
    color:      { bg: 'bg-blue-100', icon: 'text-blue-600' },
  },
  {
    key:        'minutes',
    label:      'Actas',
    icon:       FileText,
    entityType: 'minute',
    color:      { bg: 'bg-amber-100', icon: 'text-amber-600' },
  },
];

export default function SPCoveragePanel({ projectId }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState(null);

  const load = useCallback((forceRefresh = false) => {
    // Servir desde cache si está fresco y no se fuerza refresco
    if (!forceRefresh) {
      const entry = _coverageCache.get(projectId);
      if (entry && entry.expiresAt > Date.now()) {
        setData(entry.data);
        setLoading(false);
        setError(null);
        return;
      }
    }
    setLoading(true);
    setError(null);
    sharepointAPI.coverage(projectId)
      .then(r => {
        _coverageCache.set(projectId, { data: r.data, expiresAt: Date.now() + COVERAGE_TTL_MS });
        setData(r.data);
      })
      .catch(e => setError(e.response?.data?.error || 'Error cargando cobertura'))
      .finally(() => setLoading(false));
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  if (loading) return (
    <div className="flex items-center gap-2 text-surface-400 py-3">
      <Loader2 className="w-4 h-4 animate-spin" />
      <span className="text-sm">Calculando cobertura documental...</span>
    </div>
  );

  if (error) return (
    <p className="text-sm text-red-500 py-2">{error}</p>
  );

  // Overall %
  const totals = CARDS.reduce((acc, c) => {
    acc.total  += data[c.key]?.total  || 0;
    acc.linked += data[c.key]?.linked || 0;
    return acc;
  }, { total: 0, linked: 0 });
  const overallPct = totals.total === 0 ? 100 : Math.round((totals.linked / totals.total) * 100);
  const overallBadge = overallPct === 100
    ? 'bg-emerald-100 text-emerald-700'
    : overallPct >= 60
      ? 'bg-amber-100 text-amber-700'
      : 'bg-red-100 text-red-600';

  return (
    <div className="bg-surface-50 border border-surface-200 rounded-xl p-4 mb-5">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-brand-900">Cobertura documental</span>
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${overallBadge}`}>
            {overallPct}% documentado
          </span>
        </div>
        <button
          type="button"
          onClick={() => load(true)}
          className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-200 transition-colors text-surface-400 hover:text-surface-600"
          title="Actualizar cobertura"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {CARDS.map(c => (
          <CoverageCard
            key={c.key}
            icon={c.icon}
            label={c.label}
            color={c.color}
            data={data[c.key]}
            entityType={c.entityType}
            projectId={projectId}
            onRefresh={() => load(true)}
          />
        ))}
      </div>
    </div>
  );
}
