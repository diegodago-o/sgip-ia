/**
 * SharePointPicker — Modal para seleccionar un archivo de SharePoint.
 * Reutiliza SharePointPanel en modo picker (pickerMode=true).
 *
 * Props:
 *   projectId  {number}    — ID del proyecto
 *   folderPath {string}    — Ruta raíz del proyecto en SharePoint (opcional, se lee del proyecto si no se pasa)
 *   onSelect   {fn(item)}  — Callback cuando el usuario selecciona un archivo: item = { id, name, webUrl, size }
 *   onClose    {fn}        — Callback para cerrar el modal
 */

import React from 'react';
import { X, FolderKanban } from 'lucide-react';
import SharePointPanel from './SharePointPanel';

export default function SharePointPicker({ projectId, onSelect, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-200 flex-shrink-0">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center">
              <FolderKanban className="w-4 h-4 text-brand-600" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-brand-900">Seleccionar archivo de SharePoint</h3>
              <p className="text-[11px] text-surface-400">Navega y selecciona el documento a vincular</p>
            </div>
          </div>
          <button onClick={onClose}
            className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-100 transition-colors">
            <X className="w-4 h-4 text-surface-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-4">
          <SharePointPanel
            projectId={projectId}
            folderPath=""
            pickerMode={true}
            onSelect={(item) => {
              onSelect(item);
              onClose();
            }}
          />
        </div>

      </div>
    </div>
  );
}
