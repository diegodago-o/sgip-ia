import React, { useState, useEffect, useCallback, useRef } from 'react';
import { documentsAPI } from '../../services/api';
import {
  Upload, FileText, FileSpreadsheet, FileImage, File, Presentation,
  Download, Trash2, Tag, X, Loader2, CheckCircle2, AlertCircle,
  Filter,
} from 'lucide-react';

const DOC_TYPES = [
  { value: 'pliego',              label: 'Pliego de Condiciones',  color: 'bg-blue-100 text-blue-700' },
  { value: 'anexo_tecnico',       label: 'Anexo Técnico',          color: 'bg-cyan-100 text-cyan-700' },
  { value: 'propuesta_tecnica',   label: 'Propuesta Técnica',      color: 'bg-indigo-100 text-indigo-700' },
  { value: 'propuesta_economica', label: 'Propuesta Económica',    color: 'bg-violet-100 text-violet-700' },
  { value: 'contrato',            label: 'Contrato',               color: 'bg-emerald-100 text-emerald-700' },
  { value: 'adicion_otrosi',      label: 'Adición / Otro sí',     color: 'bg-teal-100 text-teal-700' },
  { value: 'acta_inicio',         label: 'Acta de Inicio',         color: 'bg-green-100 text-green-700' },
  { value: 'poliza',              label: 'Póliza',                 color: 'bg-orange-100 text-orange-700' },
  { value: 'presupuesto',         label: 'Presupuesto',            color: 'bg-amber-100 text-amber-700' },
  { value: 'otro',                label: 'Otro',                   color: 'bg-gray-100 text-gray-600' },
];

const DOC_TYPE_MAP = Object.fromEntries(DOC_TYPES.map(d => [d.value, d]));

const ICON_MAP = {
  pdf:   { icon: FileText,        color: 'text-red-500' },
  word:  { icon: FileText,        color: 'text-blue-500' },
  excel: { icon: FileSpreadsheet, color: 'text-green-500' },
  image: { icon: FileImage,       color: 'text-purple-500' },
  pptx:  { icon: Presentation,    color: 'text-orange-500' },
  file:  { icon: File,            color: 'text-surface-400' },
};

export default function DocumentsPanel({ projectId, perms = {}, }) {
  const [documents, setDocuments] = useState([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [uploadType, setUploadType] = useState('');
  const [filterType, setFilterType] = useState('');
  const [classifyDoc, setClassifyDoc] = useState(null);
  const [toast, setToast] = useState(null);
  const fileInputRef = useRef(null);

  const load = useCallback(async () => {
    try {
      const params = filterType ? { doc_type: filterType } : {};
      const { data } = await documentsAPI.list(projectId, params);
      setDocuments(data.data);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [projectId, filterType]);

  useEffect(() => { load(); }, [load]);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Upload handler ──
  const handleUpload = async (files) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach(f => formData.append('files', f));
      if (uploadType) formData.append('doc_type', uploadType);

      const { data } = await documentsAPI.upload(projectId, formData);
      showToast(data.message);
      load();
    } catch (err) {
      showToast(err.response?.data?.error || 'Error subiendo archivos', 'error');
    } finally {
      setUploading(false);
    }
  };

  // ── Drag & Drop ──
  const onDragOver = (e) => { e.preventDefault(); setDragOver(true); };
  const onDragLeave = () => setDragOver(false);
  const onDrop = (e) => {
    e.preventDefault();
    setDragOver(false);
    handleUpload(e.dataTransfer.files);
  };

  // ── Classify document ──
  const handleClassify = async (docId, docType) => {
    try {
      await documentsAPI.update(projectId, docId, { doc_type: docType });
      setClassifyDoc(null);
      showToast('Documento clasificado');
      load();
    } catch (err) {
      showToast('Error clasificando', 'error');
    }
  };

  // ── Delete ──
  const handleDelete = async (docId, fileName) => {
    if (!window.confirm(`¿Eliminar "${fileName}"?`)) return;
    try {
      await documentsAPI.delete(projectId, docId);
      showToast('Documento eliminado');
      load();
    } catch (err) {
      showToast('Error eliminando', 'error');
    }
  };

  // ── Download ──
  const handleDownload = (docId) => {
    const token = localStorage.getItem('sgip_token');
    const url = documentsAPI.download(projectId, docId);
    // Create temp link with auth header via fetch
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then(res => res.blob())
      .then(blob => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        const doc = documents.find(d => d.id === docId);
        a.download = doc?.file_name || 'archivo';
        a.click();
        URL.revokeObjectURL(a.href);
      });
  };

  return (
    <div className="space-y-4">
      {/* Toast */}
      {toast && (
        <div className={`fixed top-4 right-4 z-50 flex items-center gap-2 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up
          ${toast.type === 'error' ? 'bg-red-600 text-white' : 'bg-emerald-600 text-white'}`}>
          {toast.type === 'error' ? <AlertCircle className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
          {toast.msg}
        </div>
      )}

      {/* Upload Zone */}
      <div
        onDragOver={onDragOver}
        onDragLeave={onDragLeave}
        onDrop={onDrop}
        onClick={() => fileInputRef.current?.click()}
        className={`relative border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-200
          ${dragOver
            ? 'border-brand-500 bg-brand-50 scale-[1.01]'
            : 'border-surface-200 hover:border-brand-300 hover:bg-surface-50'
          }
          ${uploading ? 'pointer-events-none opacity-60' : ''}`}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => handleUpload(e.target.files)}
        />

        {uploading ? (
          <div className="flex flex-col items-center gap-2">
            <Loader2 className="w-8 h-8 text-brand-500 animate-spin" />
            <p className="text-sm font-medium text-brand-700">Subiendo archivos...</p>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="w-12 h-12 rounded-xl bg-brand-50 border border-brand-100 flex items-center justify-center">
              <Upload className="w-5 h-5 text-brand-500" />
            </div>
            <p className="text-sm font-medium text-brand-900">
              Arrastre archivos aquí o <span className="text-brand-600 underline">seleccione</span>
            </p>
            <p className="text-xs text-surface-400">
              PDF, Word, Excel, PowerPoint, imágenes — Máx 50MB por archivo
            </p>
          </div>
        )}

        {/* Optional: pre-select type before upload */}
        <div className="mt-4 flex items-center justify-center gap-2" onClick={e => e.stopPropagation()}>
          <span className="text-xs text-surface-400">Tipo:</span>
          <select
            value={uploadType}
            onChange={e => setUploadType(e.target.value)}
            className="text-xs border border-surface-200 rounded-md px-2 py-1 bg-white"
          >
            <option value="">Sin clasificar</option>
            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Filter className="w-4 h-4 text-surface-400" />
          <select
            value={filterType}
            onChange={e => setFilterType(e.target.value)}
            className="text-sm border border-surface-200 rounded-lg px-3 py-1.5 bg-white"
          >
            <option value="">Todos los tipos</option>
            {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
        <span className="text-xs text-surface-400">
          {documents.length} documento{documents.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Document list */}
      {loading ? (
        <div className="flex items-center justify-center py-12">
          <div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
        </div>
      ) : documents.length === 0 ? (
        <div className="text-center py-12">
          <FileText className="w-10 h-10 text-surface-200 mx-auto mb-3" />
          <p className="text-sm text-surface-400">No hay documentos cargados</p>
          <p className="text-xs text-surface-300 mt-1">Arrastre archivos a la zona de carga</p>
        </div>
      ) : (
        <div className="space-y-2">
          {documents.map(doc => {
            const iconInfo = ICON_MAP[doc.icon] || ICON_MAP.file;
            const Icon = iconInfo.icon;
            const typeInfo = DOC_TYPE_MAP[doc.doc_type];

            return (
              <div key={doc.id}
                className="group bg-white rounded-lg border border-surface-100 p-3 flex items-center gap-3 hover:shadow-card transition-all">
                {/* File icon */}
                <div className="w-10 h-10 rounded-lg bg-surface-50 flex items-center justify-center flex-shrink-0">
                  <Icon className={`w-5 h-5 ${iconInfo.color}`} />
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-brand-900 truncate">{doc.file_name}</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <span className="text-xs text-surface-400">{doc.file_size_human}</span>
                    <span className="text-xs text-surface-300">·</span>
                    <span className="text-xs text-surface-400">
                      {new Date(doc.created_at).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}
                    </span>
                    {doc.uploaded_by_name && (
                      <>
                        <span className="text-xs text-surface-300">·</span>
                        <span className="text-xs text-surface-400">{doc.uploaded_by_name}</span>
                      </>
                    )}
                  </div>
                </div>

                {/* Type badge */}
                <div className="relative flex-shrink-0">
                  {typeInfo ? (
                    <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${typeInfo.color}`}>
                      {typeInfo.label}
                    </span>
                  ) : (
                    <button
                      onClick={() => setClassifyDoc(classifyDoc === doc.id ? null : doc.id)}
                      className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium bg-surface-100 text-surface-400 hover:bg-amber-50 hover:text-amber-600 transition-colors"
                    >
                      <Tag className="w-3 h-3" /> Clasificar
                    </button>
                  )}

                  {/* Classify dropdown — anclado al badge */}
                  {classifyDoc === doc.id && (
                    <div className="absolute top-full right-0 mt-1 z-30 bg-white rounded-lg shadow-lg border border-surface-200 p-2 w-56 animate-slide-up">
                      <div className="flex items-center justify-between mb-2 px-2">
                        <span className="text-xs font-semibold text-surface-400">Tipo de documento</span>
                        <button onClick={() => setClassifyDoc(null)}><X className="w-3.5 h-3.5 text-surface-400" /></button>
                      </div>
                      {DOC_TYPES.map(t => (
                        <button key={t.value}
                          onClick={() => handleClassify(doc.id, t.value)}
                          className="w-full text-left px-2 py-1.5 rounded text-sm hover:bg-surface-50 transition-colors">
                          <span className={`inline-flex px-1.5 py-0.5 rounded text-xs ${t.color}`}>{t.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                  <button onClick={() => handleDownload(doc.id)}
                    className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center" title="Descargar">
                    <Download className="w-3.5 h-3.5 text-surface-400" />
                  </button>
                  <button onClick={() => setClassifyDoc(classifyDoc === doc.id ? null : doc.id)}
                    className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center" title="Clasificar">
                    <Tag className="w-3.5 h-3.5 text-surface-400" />
                  </button>
                  <button onClick={() => handleDelete(doc.id, doc.file_name)}
                    className="w-7 h-7 rounded hover:bg-red-50 flex items-center justify-center" title="Eliminar">
                    <Trash2 className="w-3.5 h-3.5 text-red-400" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
