/**
 * SharePointPanel — Explorador de archivos de SharePoint dentro de un proyecto.
 * Mounted at: ProjectDetailPage → tab 'sharepoint'
 *
 * Props:
 *   projectId  {number}  — ID del proyecto
 *   folderPath {string}  — Ruta raíz del proyecto en SharePoint
 *   pickerMode {bool}    — Si es true, muestra botón "Seleccionar" en vez de Descargar
 *   onSelect   {fn}      — Callback(item) cuando pickerMode=true y el usuario selecciona un archivo
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderKanban, FolderOpen, FileText, Upload, Download,
  ChevronRight, Home, Loader2, AlertTriangle, X, ExternalLink,
  RefreshCw, File,
} from 'lucide-react';
import { sharepointAPI } from '../../services/api';
import SPCoveragePanel from './SPCoveragePanel';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getFileIcon(item) {
  if (item.type === 'folder') return FolderOpen;
  const ext = (item.name || '').split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return FileText;
  return File;
}

function getFileColor(item) {
  if (item.type === 'folder') return 'text-amber-500';
  const ext = (item.name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'text-red-500';
  if (['doc', 'docx'].includes(ext)) return 'text-blue-600';
  if (['xls', 'xlsx'].includes(ext)) return 'text-green-600';
  if (['ppt', 'pptx'].includes(ext)) return 'text-orange-500';
  if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return 'text-violet-500';
  return 'text-surface-400';
}

// ─────────────────────────────────────────────
// Helper: open download
// ─────────────────────────────────────────────
async function openDownload(projectId, itemId) {
  try {
    const r = await sharepointAPI.getDownloadUrl(projectId, itemId);
    window.open(r.data?.url || r.data, '_blank', 'noopener,noreferrer');
  } catch {
    // fallback: webUrl if available
  }
}

// ─────────────────────────────────────────────
// Preview Modal
// SharePoint blocks direct iframe embed (X-Frame-Options).
// Strategy:
//   • Office files  → Office Online Viewer (embed.aspx?src=downloadUrl)
//   • PDF           → embed download URL directly in <iframe>
//   • Others        → show actions only (open in SP + download)
// ─────────────────────────────────────────────
const OFFICE_EXTS = ['doc','docx','xls','xlsx','ppt','pptx','odt','ods','odp'];

function getPreviewStrategy(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (OFFICE_EXTS.includes(ext)) return 'office';
  if (ext === 'pdf') return 'pdf';
  return 'none';
}

function PreviewModal({ item, projectId, onClose }) {
  const [downloadUrl, setDownloadUrl] = useState(null);
  const [blobUrl,     setBlobUrl]     = useState(null);  // for PDF blob rendering
  const [loading, setLoading]         = useState(true);
  const [iframeError, setIframeError] = useState(false);
  const blobRef = useRef(null);

  const strategy = getPreviewStrategy(item.name);

  // Step 1: get the pre-authenticated download URL from backend
  useEffect(() => {
    sharepointAPI.getDownloadUrl(projectId, item.id)
      .then(r => setDownloadUrl(r.data?.url || r.data))
      .catch(() => setDownloadUrl(null));
  }, [projectId, item.id]);

  // Step 2: for PDFs, fetch the file as a blob and create a local object URL
  // (iframes can't embed pre-auth URLs directly due to CORS/redirect restrictions)
  useEffect(() => {
    if (strategy !== 'pdf' || !downloadUrl) {
      setLoading(false);
      return;
    }
    setLoading(true);
    fetch(downloadUrl)
      .then(r => r.blob())
      .then(blob => {
        const url = URL.createObjectURL(blob);
        blobRef.current = url;
        setBlobUrl(url);
      })
      .catch(() => setIframeError(true))
      .finally(() => setLoading(false));
    return () => {
      if (blobRef.current) URL.revokeObjectURL(blobRef.current);
    };
  }, [downloadUrl, strategy]);

  // For Office files, mark loading done once downloadUrl is ready
  useEffect(() => {
    if (strategy === 'office' && downloadUrl !== null) setLoading(false);
  }, [downloadUrl, strategy]);

  // Office Online embed URL
  const officeEmbedUrl = downloadUrl
    ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(downloadUrl)}`
    : null;

  const iframeSrc = strategy === 'office' ? officeEmbedUrl : blobUrl;
  const showIframe = !iframeError && !loading && !!iframeSrc;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl h-[80vh] flex flex-col overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-brand-500 flex-shrink-0" />
            <span className="font-medium text-brand-900 truncate text-sm">{item.name}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a href={item.webUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-brand-600 border border-brand-200 rounded-lg hover:bg-brand-50 transition-colors">
              <ExternalLink className="w-3.5 h-3.5" /> Abrir en SharePoint
            </a>
            <button onClick={() => openDownload(projectId, item.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">
              <Download className="w-3.5 h-3.5" /> Descargar
            </button>
            <button onClick={onClose} className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-100 transition-colors">
              <X className="w-4 h-4 text-surface-400" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-hidden bg-surface-50 relative">
          {loading && (
            <div className="flex items-center justify-center h-full gap-2 text-surface-400">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Cargando vista previa...</span>
            </div>
          )}

          {/* Office Online / PDF embed */}
          {showIframe && (
            <iframe
              key={iframeSrc}
              src={iframeSrc}
              title={item.name}
              className="w-full h-full border-0"
              onError={() => setIframeError(true)}
            />
          )}

          {/* No preview available */}
          {!loading && (strategy === 'none' || iframeError || !downloadUrl) && (
            <div className="flex flex-col items-center justify-center h-full gap-4 text-surface-400">
              <File className="w-12 h-12 text-surface-300" />
              <div className="text-center">
                <p className="text-sm font-medium text-surface-600">Vista previa no disponible</p>
                <p className="text-xs text-surface-400 mt-1">Usa los botones de arriba para abrir o descargar el archivo</p>
              </div>
              <div className="flex gap-3">
                <a href={item.webUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-brand-600 border border-brand-200 rounded-xl hover:bg-brand-50 transition-colors">
                  <ExternalLink className="w-4 h-4" /> Abrir en SharePoint
                </a>
                <button onClick={() => openDownload(projectId, item.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors">
                  <Download className="w-4 h-4" /> Descargar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export default function SharePointPanel({ projectId, folderPath, pickerMode = false, onSelect }) {
  const [files,        setFiles]        = useState([]);
  const [currentPath,  setCurrentPath]  = useState('');  // relative to folderPath
  const [breadcrumb,   setBreadcrumb]   = useState([]);  // [{ label, path }]
  const [loading,      setLoading]      = useState(true);
  const [uploading,    setUploading]    = useState(false);
  const [error,        setError]        = useState(null);
  const [previewItem,  setPreviewItem]  = useState(null);

  const fileInputRef = useRef(null);

  // Quick-access subfolders derived from first load (top-level folders)
  const [quickFolders, setQuickFolders] = useState([]);

  // ── Load current folder ──────────────────────────────────────────
  const loadFolder = useCallback(async (subpath) => {
    setLoading(true);
    setError(null);
    try {
      const res = await sharepointAPI.listFiles(projectId, subpath);
      const items = res.data?.data || [];
      setFiles(items);
      if (!subpath) {
        // Store quick-access folders from root
        setQuickFolders(items.filter(i => i.type === 'folder'));
      }
    } catch (e) {
      setError(e.response?.data?.error || e.message || 'Error cargando archivos');
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadFolder(currentPath);
  }, [loadFolder, currentPath]);

  // ── Navigation ───────────────────────────────────────────────────
  const navigateInto = (folder) => {
    const newPath = currentPath ? `${currentPath}/${folder.name}` : folder.name;
    setBreadcrumb(prev => [...prev, { label: folder.name, path: newPath }]);
    setCurrentPath(newPath);
  };

  const navigateTo = (path, idx) => {
    // idx=-1 → root, idx>=0 → breadcrumb item
    if (idx === -1) {
      setBreadcrumb([]);
      setCurrentPath('');
    } else {
      setBreadcrumb(prev => prev.slice(0, idx + 1));
      setCurrentPath(path);
    }
  };

  // ── Upload ───────────────────────────────────────────────────────
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await sharepointAPI.upload(projectId, file, currentPath);
      await loadFolder(currentPath);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error subiendo archivo');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Item click ───────────────────────────────────────────────────
  const handleItemClick = (item) => {
    if (item.type === 'folder') {
      navigateInto(item);
    } else if (pickerMode) {
      // picker mode: do nothing on click, only "Select" button acts
    } else {
      setPreviewItem(item);
    }
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Coverage panel — only in explorer mode (not picker) */}
      {!pickerMode && <SPCoveragePanel projectId={projectId} />}

      {/* Quick-access folders */}
      {!currentPath && quickFolders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickFolders.map(f => (
            <button key={f.id} onClick={() => navigateInto(f)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium rounded-lg hover:bg-amber-100 transition-colors">
              <FolderOpen className="w-3.5 h-3.5" />
              {f.name}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar: breadcrumb + upload */}
      <div className="flex items-center justify-between bg-surface-50 border border-surface-200 rounded-xl px-4 py-2.5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          <button onClick={() => navigateTo('', -1)}
            className="flex items-center gap-1 text-brand-600 hover:text-brand-800 text-xs font-medium flex-shrink-0">
            <Home className="w-3.5 h-3.5" />
          </button>
          {breadcrumb.map((crumb, idx) => (
            <React.Fragment key={crumb.path}>
              <ChevronRight className="w-3 h-3 text-surface-300 flex-shrink-0" />
              <button onClick={() => navigateTo(crumb.path, idx)}
                className="text-xs text-brand-600 hover:text-brand-800 hover:underline whitespace-nowrap">
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <button onClick={() => loadFolder(currentPath)} title="Actualizar"
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-200 transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 text-surface-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {!pickerMode && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
              />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                {uploading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Upload className="w-3.5 h-3.5" />}
                {uploading ? 'Subiendo...' : 'Subir'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-xs">{error}</p>
        </div>
      )}

      {/* File list */}
      <div className="bg-white border border-surface-200 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-surface-300">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Cargando archivos...</span>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-surface-300">
            <FolderKanban className="w-10 h-10" />
            <p className="text-sm">Esta carpeta está vacía</p>
            {!pickerMode && (
              <button onClick={() => fileInputRef.current?.click()}
                className="mt-2 flex items-center gap-1.5 px-4 py-2 text-sm text-brand-600 border border-brand-200 rounded-xl hover:bg-brand-50 transition-colors">
                <Upload className="w-4 h-4" /> Subir el primer archivo
              </button>
            )}
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-surface-100">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-surface-400 w-auto">Nombre</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-surface-400 w-24 hidden sm:table-cell">Tamaño</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-surface-400 w-32 hidden md:table-cell">Modificado</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50">
              {files.map(item => {
                const Icon = getFileIcon(item);
                const color = getFileColor(item);
                return (
                  <tr key={item.id}
                    className="hover:bg-surface-50 transition-colors cursor-pointer group"
                    onClick={() => handleItemClick(item)}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={`w-4 h-4 flex-shrink-0 ${color}`} />
                        <span className="truncate text-sm text-brand-900 group-hover:text-brand-600">{item.name}</span>
                        {item.type === 'folder' && <ChevronRight className="w-3 h-3 text-surface-300 flex-shrink-0 ml-auto" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-surface-400 hidden sm:table-cell">
                      {item.type === 'folder' ? '—' : formatSize(item.size)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-surface-400 hidden md:table-cell">
                      {formatDate(item.lastModified)}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {item.type === 'file' && (
                          pickerMode ? (
                            <button
                              onClick={() => onSelect && onSelect(item)}
                              className="px-2.5 py-1 text-xs bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">
                              Seleccionar
                            </button>
                          ) : (
                            <button
                              onClick={async (e) => { e.stopPropagation(); await openDownload(projectId, item.id); }}
                              className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 transition-colors"
                              title="Descargar">
                              <Download className="w-3.5 h-3.5" />
                            </button>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Preview Modal */}
      {previewItem && (
        <PreviewModal
          item={previewItem}
          projectId={projectId}
          onClose={() => setPreviewItem(null)}
        />
      )}
    </div>
  );
}
