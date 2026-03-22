/**
 * SPUploadButton — sube un archivo a SharePoint y devuelve { id, name, url }
 *
 * Props:
 *   projectId  {number}               ID del proyecto
 *   value      {null|{id,name,url}}   archivo actualmente vinculado
 *   onChange   {fn}                   callback(item|null)
 *   destFolder {string}               subcarpeta destino en SP (ej. "Polizas")
 *   disabled   {bool}
 */

import React, { useState, useRef } from 'react';
import { Upload, FileText, X, Loader2, RefreshCw } from 'lucide-react';
import { sharepointAPI } from '../../services/api';

const MAX_BYTES = 100 * 1024 * 1024; // 100 MB

export default function SPUploadButton({
  projectId,
  value,
  onChange,
  destFolder = '',
  disabled = false,
}) {
  const [uploading, setUploading] = useState(false);
  const [error, setError]         = useState(null);
  const inputRef = useRef(null);

  const handleFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    // Reset so the same file can be re-selected after quitar
    e.target.value = '';

    if (file.size > MAX_BYTES) {
      setError('El archivo supera el límite de 100 MB');
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const r    = await sharepointAPI.upload(projectId, file, destFolder);
      const item = r.data?.data;
      onChange({ id: item.id, name: item.name, url: item.webUrl });
    } catch (err) {
      setError(err.response?.data?.error || 'Error al subir el archivo a SharePoint');
    } finally {
      setUploading(false);
    }
  };

  // ── File linked ──────────────────────────────────────────────────────────
  if (value) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-brand-50 border border-brand-200 rounded-lg">
        <FileText className="w-3.5 h-3.5 text-brand-500 flex-shrink-0" />
        <span className="text-xs text-brand-700 flex-1 min-w-0 truncate">{value.name}</span>

        {/* Replace */}
        <label className={`flex items-center gap-1 text-xs text-surface-500 hover:text-brand-600 cursor-pointer border-l border-brand-200 pl-2 transition-colors ${disabled || uploading ? 'pointer-events-none opacity-40' : ''}`}>
          {uploading
            ? <><Loader2 className="w-3 h-3 animate-spin" /> Subiendo...</>
            : <><RefreshCw className="w-3 h-3" /> Reemplazar</>}
          <input
            type="file"
            className="hidden"
            onChange={handleFile}
            disabled={disabled || uploading}
            ref={inputRef}
          />
        </label>

        {/* Clear */}
        <button
          type="button"
          onClick={() => onChange(null)}
          disabled={disabled || uploading}
          className="text-red-400 hover:text-red-600 disabled:opacity-40 border-l border-brand-200 pl-2 transition-colors"
          title="Quitar vínculo"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    );
  }

  // ── No file ──────────────────────────────────────────────────────────────
  return (
    <div>
      <label className={`inline-flex items-center gap-1.5 text-xs border border-dashed rounded-lg px-3 py-1.5 transition-colors cursor-pointer
        ${disabled || uploading
          ? 'border-surface-200 text-surface-300 pointer-events-none'
          : 'border-surface-300 text-surface-500 hover:border-brand-400 hover:text-brand-600'}`}>
        {uploading
          ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Subiendo...</>
          : <><Upload className="w-3.5 h-3.5" /> Subir a SharePoint</>}
        <input
          type="file"
          className="hidden"
          onChange={handleFile}
          disabled={disabled || uploading}
        />
      </label>
      {error && <p className="text-[11px] text-red-500 mt-1">{error}</p>}
    </div>
  );
}
