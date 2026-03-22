/**
 * AIProjectCreatorModal
 *
 * Flujo de 3 pasos:
 *   1. Subir contrato (PDF / DOCX) o pegar texto
 *   2. IA extrae los campos → preview editable
 *   3. Navegar a ProjectFormPage con datos pre-llenados
 */

import React, { useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  X, Sparkles, Upload, FileText, Loader2,
  CheckCircle2, AlertCircle, ChevronRight,
  ArrowLeft, ClipboardPaste,
} from 'lucide-react';
import { aiAPI } from '../../services/api';

// ── helpers ──────────────────────────────────────────────────────────────────
const FIELD_LABELS = {
  name:               'Nombre del proyecto',
  project_type:       'Tipo',
  sector:             'Sector',
  client_name:        'Contratante',
  client_nit:         'NIT contratante',
  contract_number:    'N° contrato',
  contract_object:    'Objeto del contrato',
  contract_value:     'Valor (COP)',
  sign_date:          'Fecha firma',
  start_date:         'Fecha inicio',
  execution_term:     'Plazo',
  execution_term_unit:'Unidad plazo',
  supervisor:         'Supervisor',
  location:           'Lugar ejecución',
  selection_process:  'Proceso de selección',
  secop_number:       'N° SECOP',
  cdp_number:         'N° CDP',
  rp_number:          'N° RP',
};

const TYPE_LABELS = {
  obra_civil: 'Obra Civil', ti: 'TI', consultoria: 'Consultoría',
  interventoria: 'Interventoría', asesoria: 'Asesoría', mixto: 'Mixto', otro: 'Otro',
};
const TERM_LABELS = {
  dias_calendario: 'Días calendario', dias_habiles: 'Días hábiles',
  meses: 'Meses', anos: 'Años',
};
const PROC_LABELS = {
  licitacion: 'Licitación Pública', concurso_meritos: 'Concurso de Méritos',
  minima_cuantia: 'Mínima Cuantía', contratacion_directa: 'Contratación Directa', otro: 'Otro',
};

function fmtValue(key, val) {
  if (val == null || val === '') return <span className="text-surface-300 italic text-xs">No encontrado</span>;
  if (key === 'project_type') return TYPE_LABELS[val] || val;
  if (key === 'sector') return val === 'publico' ? 'Público' : 'Privado';
  if (key === 'execution_term_unit') return TERM_LABELS[val] || val;
  if (key === 'selection_process') return PROC_LABELS[val] || val;
  if (key === 'contract_value') return new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(val);
  return String(val);
}

// ── Step 1: Upload ────────────────────────────────────────────────────────────
function StepUpload({ onAnalyze, onClose }) {
  const [mode, setMode]       = useState('file'); // 'file' | 'text'
  const [file, setFile]       = useState(null);
  const [text, setText]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState('');
  const inputRef = useRef(null);

  const canSubmit = mode === 'file' ? !!file : text.trim().length > 50;

  const handleSubmit = async () => {
    setError('');
    setLoading(true);
    try {
      const fd = new FormData();
      if (mode === 'file') {
        fd.append('file', file);
      } else {
        fd.append('text', text.trim());
      }
      const { data } = await aiAPI.extractProject(fd);
      onAnalyze(data.data);
    } catch (err) {
      setError(err.response?.data?.error || 'Error al analizar el documento. Intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Mode tabs */}
      <div className="flex gap-1 p-1 bg-surface-100 rounded-lg w-fit">
        <button
          type="button"
          onClick={() => setMode('file')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors
            ${mode === 'file' ? 'bg-white shadow-sm text-brand-700' : 'text-surface-500 hover:text-surface-700'}`}
        >
          <Upload className="w-3.5 h-3.5" /> Subir archivo
        </button>
        <button
          type="button"
          onClick={() => setMode('text')}
          className={`flex items-center gap-1.5 px-4 py-1.5 rounded-md text-sm font-medium transition-colors
            ${mode === 'text' ? 'bg-white shadow-sm text-brand-700' : 'text-surface-500 hover:text-surface-700'}`}
        >
          <ClipboardPaste className="w-3.5 h-3.5" /> Pegar texto
        </button>
      </div>

      {mode === 'file' ? (
        <div>
          <label
            className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl p-8 cursor-pointer transition-colors
              ${file ? 'border-brand-300 bg-brand-50' : 'border-surface-200 hover:border-brand-300 hover:bg-brand-50/40'}`}
            onClick={() => inputRef.current?.click()}
          >
            {file ? (
              <>
                <FileText className="w-8 h-8 text-brand-500" />
                <div className="text-center">
                  <p className="text-sm font-medium text-brand-700">{file.name}</p>
                  <p className="text-xs text-surface-400">{(file.size / 1024).toFixed(0)} KB</p>
                </div>
                <button
                  type="button"
                  onClick={e => { e.stopPropagation(); setFile(null); }}
                  className="text-xs text-red-500 hover:text-red-700"
                >
                  Cambiar archivo
                </button>
              </>
            ) : (
              <>
                <div className="w-12 h-12 rounded-full bg-brand-100 flex items-center justify-center">
                  <Upload className="w-6 h-6 text-brand-500" />
                </div>
                <div className="text-center">
                  <p className="text-sm font-semibold text-brand-700">Haga clic para seleccionar</p>
                  <p className="text-xs text-surface-400 mt-0.5">PDF o DOCX — máx. 15 MB</p>
                </div>
              </>
            )}
          </label>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.docx,.doc"
            className="hidden"
            onChange={e => setFile(e.target.files?.[0] || null)}
          />
        </div>
      ) : (
        <div>
          <textarea
            value={text}
            onChange={e => setText(e.target.value)}
            placeholder="Pegue aquí el texto del contrato o la minuta..."
            className="input-field w-full h-48 text-sm resize-none"
          />
          <p className="text-xs text-surface-400 mt-1">{text.length} caracteres</p>
        </div>
      )}

      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          {error}
        </div>
      )}

      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={onClose} className="btn-secondary text-sm">
          Cancelar
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={!canSubmit || loading}
          className="btn-primary flex items-center gap-2 text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <><Loader2 className="w-4 h-4 animate-spin" /> Analizando contrato...</>
          ) : (
            <><Sparkles className="w-4 h-4" /> Analizar con IA</>
          )}
        </button>
      </div>
    </div>
  );
}

// ── Step 2: Preview ───────────────────────────────────────────────────────────
function StepPreview({ extracted, onBack, onConfirm }) {
  const confidence = extracted.confidence || 0;
  const missing    = extracted.missing_fields || [];

  const mainFields = [
    'name', 'project_type', 'sector', 'client_name', 'client_nit',
    'contract_number', 'contract_value', 'sign_date', 'start_date',
    'execution_term', 'execution_term_unit', 'supervisor', 'location',
  ];
  const publicFields = ['selection_process', 'secop_number', 'cdp_number', 'rp_number'];
  const isPublic = extracted.sector === 'publico';

  const confColor = confidence >= 75 ? 'text-emerald-600' : confidence >= 50 ? 'text-amber-600' : 'text-red-500';
  const confBg    = confidence >= 75 ? 'bg-emerald-50 border-emerald-200' : confidence >= 50 ? 'bg-amber-50 border-amber-200' : 'bg-red-50 border-red-200';

  return (
    <div className="space-y-4">
      {/* Confidence banner */}
      <div className={`flex items-center justify-between p-3 rounded-lg border ${confBg}`}>
        <div className="flex items-center gap-2">
          {confidence >= 75
            ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
            : <AlertCircle  className="w-4 h-4 text-amber-500" />}
          <span className="text-sm font-medium text-surface-700">
            Confianza de extracción: <span className={`font-bold ${confColor}`}>{confidence}%</span>
          </span>
        </div>
        {missing.length > 0 && (
          <span className="text-xs text-surface-400">
            {missing.length} campo{missing.length !== 1 ? 's' : ''} no encontrado{missing.length !== 1 ? 's' : ''}
          </span>
        )}
      </div>

      {/* Contract object (wide) */}
      {extracted.contract_object && (
        <div className="p-3 bg-surface-50 border border-surface-200 rounded-lg">
          <p className="text-xs font-semibold text-surface-500 mb-1">OBJETO DEL CONTRATO</p>
          <p className="text-sm text-brand-900 leading-relaxed">{extracted.contract_object}</p>
        </div>
      )}

      {/* Main fields grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-2">
        {mainFields.map(key => (
          <div key={key} className="py-1.5 border-b border-surface-100 last:border-0">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400">{FIELD_LABELS[key]}</p>
            <p className="text-sm text-brand-900 mt-0.5">{fmtValue(key, extracted[key])}</p>
          </div>
        ))}
      </div>

      {/* Public sector fields */}
      {isPublic && (
        <div>
          <p className="text-xs font-semibold text-surface-400 uppercase tracking-wide mb-2">Datos sector público</p>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2">
            {publicFields.map(key => (
              <div key={key} className="py-1.5 border-b border-surface-100 last:border-0">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-surface-400">{FIELD_LABELS[key]}</p>
                <p className="text-sm text-brand-900 mt-0.5">{fmtValue(key, extracted[key])}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="text-xs text-surface-400">
        * Puedes revisar y corregir todos los campos en el formulario antes de guardar.
      </p>

      <div className="flex items-center justify-between pt-2">
        <button type="button" onClick={onBack} className="btn-secondary flex items-center gap-1.5 text-sm">
          <ArrowLeft className="w-4 h-4" /> Volver
        </button>
        <button
          type="button"
          onClick={() => onConfirm(extracted)}
          className="btn-primary flex items-center gap-2 text-sm"
        >
          Continuar al formulario <ChevronRight className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── Main modal ────────────────────────────────────────────────────────────────
export default function AIProjectCreatorModal({ onClose }) {
  const navigate = useNavigate();
  const [step, setStep]           = useState(1); // 1 | 2
  const [extracted, setExtracted] = useState(null);

  const handleAnalyzed = (data) => {
    setExtracted(data);
    setStep(2);
  };

  const handleConfirm = (data) => {
    // Strip meta-fields before passing to form
    const { confidence, missing_fields, ...formData } = data; // eslint-disable-line no-unused-vars
    navigate('/adjudicacion/nuevo', { state: { aiPrefilled: formData } });
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-brand-100 flex items-center justify-center">
              <Sparkles className="w-4 h-4 text-brand-600" />
            </div>
            <div>
              <h3 className="font-semibold text-brand-900">Crear proyecto con IA</h3>
              <p className="text-xs text-surface-400">
                {step === 1 ? 'Paso 1 de 2 — Sube el contrato' : 'Paso 2 de 2 — Revisa los datos extraídos'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-100 text-surface-400 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Steps indicator */}
        <div className="px-6 pt-4 pb-2 flex items-center gap-2">
          {[1, 2].map(n => (
            <React.Fragment key={n}>
              <div className={`flex items-center gap-1.5 text-xs font-medium
                ${step >= n ? 'text-brand-600' : 'text-surface-300'}`}>
                <div className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                  ${step > n ? 'bg-brand-500 text-white' : step === n ? 'bg-brand-100 text-brand-700 ring-1 ring-brand-300' : 'bg-surface-100 text-surface-400'}`}>
                  {step > n ? '✓' : n}
                </div>
                {n === 1 ? 'Documento' : 'Revisión'}
              </div>
              {n < 2 && <div className={`flex-1 h-px ${step > 1 ? 'bg-brand-300' : 'bg-surface-200'}`} />}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {step === 1 && (
            <StepUpload onAnalyze={handleAnalyzed} onClose={onClose} />
          )}
          {step === 2 && extracted && (
            <StepPreview
              extracted={extracted}
              onBack={() => setStep(1)}
              onConfirm={handleConfirm}
            />
          )}
        </div>
      </div>
    </div>
  );
}
