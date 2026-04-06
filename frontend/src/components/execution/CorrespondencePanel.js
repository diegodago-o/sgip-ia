import React, { useState, useEffect, useCallback, useRef } from 'react';
import DOMPurify from 'dompurify';
import api, { corrSignaturesAPI, freeSignaturesAPI, aiAPI } from '../../services/api';
import {
  Mail, Plus, Sparkles, Download, Eye, Pencil, Trash2, X,
  ChevronRight, Search, Filter, FileText, Clock,
  CheckCircle, Send, Archive, RotateCcw, AlertCircle, PenLine,
  Shield, Loader2, Ban, Activity,
} from 'lucide-react';
import CorrSignatureModal from './CorrSignatureModal';
import FirmaLibreModal from './FirmaLibreModal';

// ─── Constantes ──────────────────────────────────────────────────────────────
const TYPES = [
  { value: 'oficio',           label: 'Oficio' },
  { value: 'circular',         label: 'Circular' },
  { value: 'memorando',        label: 'Memorando' },
  { value: 'comunicado',       label: 'Comunicado' },
  { value: 'carta',            label: 'Carta' },
  { value: 'radicado',         label: 'Radicado' },
  { value: 'derecho_peticion', label: 'Derecho de Petición' },
];

const STATUS_CONFIG = {
  borrador:    { label: 'Borrador',   color: 'bg-surface-100 text-surface-600', icon: FileText },
  radicado:    { label: 'Radicado',   color: 'bg-blue-100 text-blue-700',       icon: CheckCircle },
  enviado:     { label: 'Enviado',    color: 'bg-brand-100 text-brand-700',     icon: Send },
  recibido:    { label: 'Recibido',   color: 'bg-teal-100 text-teal-700',       icon: RotateCcw },
  respondido:  { label: 'Respondido', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  archivado:   { label: 'Archivado',  color: 'bg-purple-100 text-purple-700',   icon: Archive },
};

const EMPTY_FORM = {
  correspondence_type: 'oficio',
  subject: '',
  reference_date: new Date().toISOString().split('T')[0],
  recipient_name: '',
  recipient_title: '',
  recipient_entity: '',
  recipient_address: '',
  recipient_city: 'Bogotá D.C.',
  sender_name: '',
  sender_title: '',
  sender_entity: '',
  body: '',
  closing: 'Cordialmente,',
  contract_reference: '',
  project_entity: '',
  project_start_date: '',
  project_object: '',
  status: 'borrador',
  radicado_number: '',
  sent_date: '',
  response_date: '',
  notes: '',
};

// Parse YYYY-MM-DD as LOCAL midnight to avoid UTC-offset shifting the date one day back
function parseLocalDate(d) {
  if (!d) return new Date(NaN);
  const s = String(d).substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return new Date(d);
  const [y, m, day] = s.split('-').map(Number);
  return new Date(y, m - 1, day);
}

function fmtDate(d) {
  if (!d) return '—';
  return parseLocalDate(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

// ─── Badge de estado ─────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || STATUS_CONFIG.borrador;
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

// ─── Helpers fecha ────────────────────────────────────────────────────────────
function fmtDateLong(d) {
  if (!d) return '';
  const dt = parseLocalDate(d);
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio',
                  'agosto','septiembre','octubre','noviembre','diciembre'];
  return `${dt.getDate()} de ${months[dt.getMonth()]} de ${dt.getFullYear()}`;
}

const TYPE_LABEL_MAP = {
  oficio: 'OFICIO', circular: 'CIRCULAR', memorando: 'MEMORANDO',
  comunicado: 'COMUNICADO', carta: 'CARTA', radicado: 'RADICADO',
  derecho_peticion: 'DERECHO DE PETICIÓN',
};

// ─── Modal de vista previa / descarga Word ───────────────────────────────────
function PreviewModal({ projectId, record, onClose }) {
  const [downloading, setDownloading] = useState(false);

  const handleDownloadDocx = async () => {
    setDownloading(true);
    try {
      const token = localStorage.getItem('sgip_token') || '';
      const response = await fetch(
        `${process.env.REACT_APP_API_URL || 'http://localhost:4000/api'}/exec/${projectId}/correspondence/${record.id}/download`,
        { headers: { Authorization: `Bearer ${token}` } }
      );
      if (!response.ok) throw new Error('Error al generar el documento');
      const blob = await response.blob();
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href = url; a.download = `${record.consecutive_code}.docx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) {
      alert('Error al descargar: ' + e.message);
    } finally { setDownloading(false); }
  };

  const typeLabel   = TYPE_LABEL_MAP[record.correspondence_type] || 'COMUNICACIÓN';
  const firstName = (record.recipient_name || '').split(' ')[0] || 'señor(a)';
  // Convertir body a HTML seguro (soporta plain text y HTML enriquecido)
  const bodyHtml = (() => {
    const b = record.body || '';
    if (!b) return '';
    if (/<[a-zA-Z]/.test(b)) return DOMPurify.sanitize(b, { ADD_ATTR: ['target'] });
    return b.split('\n').map(l => `<p>${l || ''}</p>`).join('');
  })();

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">

        {/* ── Barra superior modal ── */}
        <div className="flex items-center justify-between px-6 py-3 bg-[#1E3A5F] text-white flex-shrink-0">
          <div className="flex items-center gap-3">
            <FileText className="w-4 h-4 text-blue-200" />
            <div>
              <span className="text-[11px] text-blue-300 font-mono block">{record.consecutive_code}</span>
              <span className="text-sm font-semibold leading-tight line-clamp-1">{record.subject}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={handleDownloadDocx} disabled={downloading}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2E86AB] hover:bg-[#257696] disabled:opacity-60 text-white text-xs font-semibold rounded-lg transition-colors">
              {downloading
                ? <><span className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block mr-1"/>Generando...</>
                : <><Download className="w-3.5 h-3.5"/>Descargar Word (.docx)</>}
            </button>
            <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* ── Hoja de carta simulada ── */}
        <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
          <div className="bg-white shadow-lg mx-auto max-w-2xl" style={{ fontFamily: 'Calibri, sans-serif' }}>

            {/* Encabezado corporativo */}
            <div className="flex">
              <div className="flex-1 bg-[#1E3A5F] px-6 py-5">
                {record.correspondence_logo && (
                  <img
                    src={record.correspondence_logo}
                    alt="Logo"
                    className="h-10 mb-2 object-contain"
                    style={{ maxWidth: '160px' }}
                  />
                )}
                <p className="text-white font-bold text-base leading-tight">
                  {record.correspondence_sender_name || record.project_entity || record.project_name || 'Entidad'}
                </p>
                {record.project_name && <p className="text-blue-200 text-xs mt-1">Proyecto: {record.project_name}</p>}
                {record.project_code && <p className="text-blue-200 text-xs">Código: {record.project_code}</p>}
              </div>
              <div className="bg-[#2E86AB] px-5 py-5 text-center flex flex-col justify-center min-w-[160px]">
                <p className="text-white font-bold text-sm tracking-widest">{typeLabel}</p>
                <p className="text-blue-100 text-xs font-mono mt-1">{record.consecutive_code}</p>
                <p className="text-blue-200 text-xs mt-1">{fmtDateLong(record.reference_date)}</p>
              </div>
            </div>

            {/* Línea azul */}
            <div className="h-1 bg-[#2E86AB]" />

            {/* Cuerpo de la carta */}
            <div className="px-8 py-6 space-y-4 text-sm text-gray-800">

              {/* Lugar y fecha */}
              <p className="text-right text-gray-500 text-xs">
                {record.recipient_city || 'Bogotá D.C.'}, {fmtDateLong(record.reference_date)}
              </p>

              {/* Destinatario */}
              <div className="space-y-0.5">
                {record.recipient_name  && <p className="font-semibold text-[#1E3A5F]">{record.recipient_name}</p>}
                {record.recipient_title && <p className="text-gray-600 text-xs">{record.recipient_title}</p>}
                {record.recipient_entity&& <p className="text-gray-600 text-xs">{record.recipient_entity}</p>}
                {record.recipient_address&&<p className="text-gray-500 text-xs">{record.recipient_address}</p>}
                <p className="text-gray-500 text-xs">{record.recipient_city || 'Bogotá D.C.'}</p>
              </div>

              {/* Asunto */}
              <div className="flex gap-2 bg-gray-50 border-l-4 border-[#2E86AB] px-3 py-2 rounded-r">
                <span className="font-bold text-[#1E3A5F] text-xs whitespace-nowrap">ASUNTO:</span>
                <span className="font-semibold text-xs">{record.subject}</span>
              </div>

              {/* Referencia contrato */}
              {record.contract_reference && (
                <div className="flex gap-2 text-xs text-gray-600">
                  <span className="font-semibold text-[#1E3A5F]">REF:</span>
                  <span>Contrato No. {record.contract_reference}</span>
                </div>
              )}

              {/* Saludo */}
              <p>Respetado(a) señor(a) <strong>{firstName}</strong>:</p>

              {/* Cuerpo — rich text con soporte de enlaces */}
              <div
                dangerouslySetInnerHTML={{ __html: bodyHtml }}
                className="space-y-2 text-justify leading-relaxed
                  [&_a]:text-blue-600 [&_a]:underline
                  [&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5
                  [&_p]:mb-1"
              />

              {/* Cierre */}
              <p className="pt-2">{record.closing || 'Cordialmente,'}</p>

              {/* Firma — pt-20: espacio para imagen, mb-6: espacio bajo línea para metadata corrSig */}
              <div className="pt-20 space-y-1">
                <div className="w-44 border-b border-gray-500 mb-6" />
                {record.sender_name   && <p className="font-bold text-[#1E3A5F]">{record.sender_name}</p>}
                {record.sender_title  && <p className="text-gray-600 text-xs">{record.sender_title}</p>}
                {record.sender_entity && <p className="text-gray-500 text-xs">{record.sender_entity}</p>}
              </div>
            </div>

            {/* Footer */}
            <div className="bg-gray-50 border-t border-gray-200 px-8 py-2 flex justify-between items-center">
              <span className="text-[10px] text-gray-400">{typeLabel} No. {record.consecutive_code}</span>
              <span className="text-[10px] text-gray-400">Generado por SGIP-IA · {fmtDateLong(new Date().toISOString())}</span>
            </div>
          </div>
        </div>

        <div className="px-6 py-2 bg-gray-50 border-t border-gray-100 flex-shrink-0">
          <p className="text-[11px] text-gray-400 text-center">
            Vista previa aproximada — el Word descargado incluirá formato corporativo completo con tipografía y colores oficiales
          </p>
        </div>
      </div>
    </div>
  );
}

// Extrae YYYY-MM-DD de cualquier valor de fecha
function toInputDate(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

// ─── Sub-componentes del formulario — DEBEN estar fuera de FormModal
// para que React no los re-cree en cada render y pierda el foco al tipear.
function FieldInput({ label, field, form, set, type = 'text', required, placeholder, className = '' }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-surface-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input
        type={type}
        value={form[field] || ''}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-400 outline-none transition-all"
      />
    </div>
  );
}

function FieldTextarea({ label, field, form, set, rows = 4, placeholder, className = '' }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-surface-600">{label}</label>
      <textarea
        rows={rows}
        value={form[field] || ''}
        onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-400 outline-none transition-all resize-y"
      />
    </div>
  );
}

// ─── Editor de texto enriquecido ─────────────────────────────────────────────
// Usa contenteditable + execCommand. Debe estar fuera de cualquier componente
// padre para que React no lo re-cree y pierda el foco al tipear.
function RichTextEditor({ value, onChange }) {
  const ref    = useRef(null);
  const inited = useRef(false);

  // Inicializar contenido solo una vez
  useEffect(() => {
    if (!ref.current || inited.current) return;
    inited.current = true;
    const v = value || '';
    // Texto plano → envolver en <p>
    if (v && !/<[a-zA-Z]/.test(v)) {
      ref.current.innerHTML = v.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('');
    } else {
      ref.current.innerHTML = v;
    }
  }, []); // eslint-disable-line

  const emit = () => ref.current && onChange(ref.current.innerHTML);

  const exec = (cmd, val) => {
    document.execCommand(cmd, false, val || null);
    ref.current?.focus();
    emit();
  };

  const insertLink = e => {
    e.preventDefault();
    const sel = window.getSelection()?.toString() || '';
    const url = window.prompt('URL del enlace (ej: https://...):');
    if (!url) return;
    ref.current?.focus();
    if (sel) {
      document.execCommand('createLink', false, url);
    } else {
      const txt = window.prompt('Texto que se mostrará:', url);
      if (txt) document.execCommand('insertHTML', false,
        `<a href="${url}" target="_blank">${txt}</a>`);
    }
    // Asegurar target="_blank" en todos los links
    ref.current?.querySelectorAll('a').forEach(a => a.setAttribute('target', '_blank'));
    emit();
  };

  const B = 'px-2 py-1 rounded text-xs text-surface-700 hover:bg-surface-200 transition-colors select-none cursor-pointer';

  return (
    <div className="border border-surface-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-brand-400 transition-all">
      {/* Barra de herramientas */}
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-surface-50 border-b border-surface-100 flex-wrap">
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('bold'); }}
          className={`${B} font-bold`} title="Negrita (Ctrl+B)">N</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('italic'); }}
          className={`${B} italic`} title="Cursiva (Ctrl+I)">K</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('underline'); }}
          className={`${B} underline`} title="Subrayado (Ctrl+U)">S</button>
        <div className="w-px h-4 bg-surface-200 mx-1" />
        <button type="button" onMouseDown={insertLink}
          className={`${B} text-brand-600 font-medium`} title="Insertar enlace">🔗 Enlace</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('unlink'); }}
          className={`${B} text-surface-400`} title="Quitar enlace">✕🔗</button>
        <div className="w-px h-4 bg-surface-200 mx-1" />
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertOrderedList'); }}
          className={B} title="Lista numerada">1.</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }}
          className={B} title="Lista con viñetas">•</button>
      </div>
      {/* Área editable */}
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        className="px-3 py-2.5 text-sm text-gray-800 outline-none overflow-y-auto
          [&_a]:text-brand-600 [&_a]:underline
          [&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5
          [&_p]:mb-1"
        style={{ minHeight: '14rem' }}
      />
    </div>
  );
}

// ─── Modal de formulario (crear / editar) ────────────────────────────────────
function FormModal({ projectId, initial, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    if (!initial) return { ...EMPTY_FORM };
    return {
      ...EMPTY_FORM,
      ...initial,
      reference_date:     toInputDate(initial.reference_date),
      project_start_date: toInputDate(initial.project_start_date),
      sent_date:          toInputDate(initial.sent_date),
      response_date:      toInputDate(initial.response_date),
      // Pre-llenar radicado con el consecutivo si aún no tiene uno
      radicado_number: initial.radicado_number || initial.consecutive_code || '',
    };
  });
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSettings, setAiSettings] = useState(null);
  const [saving, setSaving]   = useState(false);
  const [error, setError]     = useState('');
  const [aiPanel, setAiPanel] = useState(false);
  const isEdit = !!initial?.id;

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    aiAPI.settings().then(r => setAiSettings(r.data?.data || r.data || {})).catch(() => setAiSettings({}));
  }, []); // eslint-disable-line

  const aiConfigured = aiSettings && (aiSettings.anthropic_configured || aiSettings.openai_configured);
  const aiProvider   = aiSettings?.default_provider || (aiSettings?.openai_configured ? 'openai' : 'anthropic');
  const aiModel      = aiProvider === 'anthropic' ? aiSettings?.anthropic_model : aiSettings?.openai_model;

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true);
    setError('');
    try {
      // El backend resuelve el key globalmente (env > DB > body)
      const { data } = await api.post(`/exec/${projectId}/correspondence/ai-generate`, {
        prompt: aiPrompt,
      });
      const g = data.data;
      // Mezclar campos generados con el formulario
      setForm(f => ({
        ...f,
        correspondence_type: g.correspondence_type || f.correspondence_type,
        subject:             g.subject             || f.subject,
        reference_date:      g.reference_date      || f.reference_date,
        recipient_name:      g.recipient_name      || f.recipient_name,
        recipient_title:     g.recipient_title     || f.recipient_title,
        recipient_entity:    g.recipient_entity    || f.recipient_entity,
        recipient_city:      g.recipient_city      || f.recipient_city,
        sender_name:         g.sender_name         || f.sender_name,
        sender_title:        g.sender_title        || f.sender_title,
        sender_entity:       g.sender_entity       || f.sender_entity,
        body:                g.body                || f.body,
        closing:             g.closing             || f.closing,
        contract_reference:  g.contract_reference  || f.contract_reference,
        project_entity:      g.project_entity      || f.project_entity,
        notes:               g.notes               || f.notes,
        ai_prompt:           aiPrompt,
      }));
      setAiPanel(false);
    } catch (e) {
      setError(e.response?.data?.error || 'Error al generar con IA');
    } finally {
      setAiLoading(false);
    }
  };

  const handleSave = async () => {
    if (!form.subject.trim()) { setError('El asunto es requerido'); return; }
    if (!form.reference_date)  { setError('La fecha es requerida'); return; }
    setSaving(true); setError('');
    try {
      if (isEdit) {
        await api.put(`/exec/${projectId}/correspondence/${initial.id}`, form);
      } else {
        await api.post(`/exec/${projectId}/correspondence`, form);
      }
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-brand-600" />
            <h2 className="text-base font-semibold text-brand-900">
              {isEdit ? 'Editar Correspondencia' : 'Nueva Correspondencia'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-surface-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Botón IA */}
          <div className="bg-gradient-to-r from-brand-50 to-violet-50 border border-brand-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-600" />
                <span className="text-sm font-semibold text-brand-800">Generar con IA</span>
              </div>
              <button onClick={() => setAiPanel(!aiPanel)}
                className="text-xs text-brand-600 hover:text-brand-800 font-medium">
                {aiPanel ? 'Ocultar' : 'Expandir'}
              </button>
            </div>
            {/* Motor IA status */}
            {aiSettings === null
              ? <div className="h-5 bg-white/50 rounded animate-pulse mb-2" />
              : aiConfigured
                ? <p className="text-[10px] text-emerald-700 mb-2 flex items-center gap-1">
                    <Sparkles className="w-3 h-3" />
                    <strong>Motor de IA configurado</strong>&nbsp;· {aiModel}&nbsp;· <span className="capitalize">{aiProvider}</span>
                  </p>
                : <p className="text-[10px] text-red-600 mb-2">
                    ⚠ Motor de IA no configurado. Ve a <strong>Configuración → Motor de IA</strong>.
                  </p>
            }
            {aiPanel && (
              <div className="space-y-2 mt-2">
                <p className="text-xs text-surface-500">
                  Describe en lenguaje natural qué necesitas comunicar. La IA llenará los campos automáticamente.
                </p>
                <textarea
                  rows={3}
                  value={aiPrompt}
                  onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Ej: Necesito un oficio informando al Ministerio que el contrato lleva un 65% de avance y solicitando aprobación del informe mensual..."
                  className="w-full px-3 py-2 text-sm border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none resize-none"
                />
                <button
                  onClick={handleAiGenerate}
                  disabled={aiLoading || !aiPrompt.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">
                  {aiLoading
                    ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />Generando...</>
                    : <><Sparkles className="w-3.5 h-3.5" />Generar campos</>}
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          {/* Tipo, fecha y estado */}
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-surface-600">Tipo<span className="text-red-500 ml-0.5">*</span></label>
              <select value={form.correspondence_type} onChange={e => set('correspondence_type', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none">
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <FieldInput form={form} set={set} label="Fecha" field="reference_date" type="date" required />
            <div className="space-y-1">
              <label className="block text-xs font-medium text-surface-600">Estado</label>
              <select value={form.status} onChange={e => set('status', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none">
                {Object.entries(STATUS_CONFIG).map(([v, c]) =>
                  <option key={v} value={v}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <FieldInput form={form} set={set} label="Asunto" field="subject" required placeholder="Asunto de la comunicación" />

          {/* Separador Destinatario */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-surface-100" />
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Destinatario</span>
            <div className="flex-1 h-px bg-surface-100" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldInput form={form} set={set} label="Nombre completo"  field="recipient_name"   placeholder="Nombre del destinatario" />
            <FieldInput form={form} set={set} label="Cargo"            field="recipient_title"  placeholder="Cargo / Función" />
            <FieldInput form={form} set={set} label="Entidad"          field="recipient_entity" placeholder="Nombre de la entidad" />
            <FieldInput form={form} set={set} label="Ciudad"           field="recipient_city"   placeholder="Ciudad" />
            <FieldInput form={form} set={set} label="Dirección"        field="recipient_address" placeholder="Dirección (opcional)" className="col-span-2" />
          </div>

          {/* Separador Remitente */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-surface-100" />
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Remitente</span>
            <div className="flex-1 h-px bg-surface-100" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldInput form={form} set={set} label="Nombre del remitente" field="sender_name"   placeholder="Ej: Germán Medina Wilches" />
            <FieldInput form={form} set={set} label="Cargo del remitente"  field="sender_title"  placeholder="Ej: Gerente de Proyecto" />
            <FieldInput form={form} set={set} label="Empresa del remitente" field="sender_entity" placeholder="Ej: Consorcio Fondo Colombia en Paz" className="col-span-2" />
          </div>

          {/* Separador Referencia contrato */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-surface-100" />
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Referencia del Contrato</span>
            <div className="flex-1 h-px bg-surface-100" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <FieldInput form={form} set={set} label="N° de Contrato"       field="contract_reference"  placeholder="Ej: 001-2025" />
            <FieldInput form={form} set={set} label="Entidad contratante"  field="project_entity"      placeholder="Nombre de la entidad" />
            <FieldInput form={form} set={set} label="Fecha de inicio"      field="project_start_date"  type="date" />
          </div>
          <FieldTextarea form={form} set={set} label="Objeto del contrato (referencia)" field="project_object" rows={2}
            placeholder="Resumen del objeto del contrato" />

          {/* Separador Cuerpo */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-surface-100" />
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Contenido</span>
            <div className="flex-1 h-px bg-surface-100" />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-surface-600">Cuerpo de la comunicación</label>
            <RichTextEditor value={form.body} onChange={v => set('body', v)} />
          </div>
          <FieldInput form={form} set={set} label="Cierre" field="closing" placeholder="Ej: Cordialmente," />

          {/* Separador Seguimiento */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-surface-100" />
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Seguimiento</span>
            <div className="flex-1 h-px bg-surface-100" />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <FieldInput form={form} set={set} label="N° de radicado"    field="radicado_number" placeholder="RAD-2026-001" />
            <FieldInput form={form} set={set} label="Fecha de envío"    field="sent_date"       type="date" />
            <FieldInput form={form} set={set} label="Fecha de respuesta" field="response_date"  type="date" />
          </div>
          <FieldTextarea form={form} set={set} label="Observaciones internas" field="notes" rows={2}
            placeholder="Notas de seguimiento..." />
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-surface-100 flex-shrink-0 bg-surface-50 rounded-b-2xl">
          <button onClick={onClose}
            className="px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 rounded-lg transition-colors">
            Cancelar
          </button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
            {saving
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />Guardando...</>
              : <>{isEdit ? 'Guardar cambios' : 'Crear correspondencia'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Panel principal ─────────────────────────────────────────────────────────
export default function CorrespondencePanel({ projectId, perms }) {
  const [activeTab, setActiveTab]     = useState('correspondencia'); // 'correspondencia' | 'firmas'
  const [items, setItems]             = useState([]);
  const [loading, setLoading]         = useState(true);
  const [search, setSearch]           = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterType, setFilterType]   = useState('');
  const [showForm, setShowForm]       = useState(false);
  const [editItem, setEditItem]       = useState(null);
  const [previewItem, setPreviewItem] = useState(null);
  const [deleting, setDeleting]       = useState(null);
  const [sigModal, setSigModal]       = useState(null); // correspondence item | null
  const [corrSigStatuses, setCorrSigStatuses] = useState({}); // { corrId: requestObj }
  // Free signatures tab
  const [freeRequests, setFreeRequests]     = useState([]);
  const [freeLoading, setFreeLoading]       = useState(false);
  const [freeError, setFreeError]           = useState('');
  const [showFirmaModal, setShowFirmaModal] = useState(false);
  const [traceReq, setTraceReq]             = useState(null); // { req, detail } for trazabilidad panel

  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const r = await api.get(`/exec/${projectId}/correspondence`);
      const data = r.data.data || [];
      setItems(data);
      if (data.length > 0) {
        const statuses = await corrSignaturesAPI.batchStatus(projectId, data.map(c => c.id));
        setCorrSigStatuses(statuses);
      }
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const loadFreeRequests = useCallback(async () => {
    if (!projectId) return;
    setFreeLoading(true);
    setFreeError('');
    try {
      const r = await freeSignaturesAPI.list(projectId);
      setFreeRequests(r.data || []);
    } catch (e) {
      console.error('[loadFreeRequests]', e);
      setFreeError(e.response?.data?.error || e.message || 'Error al cargar procesos de firma');
      setFreeRequests([]);
    }
    finally { setFreeLoading(false); }
  }, [projectId]);

  useEffect(() => { if (activeTab === 'firmas') loadFreeRequests(); }, [activeTab, loadFreeRequests]);

  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar esta correspondencia?')) return;
    setDeleting(id);
    try {
      await api.delete(`/exec/${projectId}/correspondence/${id}`);
      load();
    } catch { /* ignore */ }
    finally { setDeleting(null); }
  };

  // Filtros
  const filtered = items.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.consecutive_code?.toLowerCase().includes(q)
      || c.subject?.toLowerCase().includes(q)
      || c.recipient_entity?.toLowerCase().includes(q)
      || c.recipient_name?.toLowerCase().includes(q);
    const matchStatus = !filterStatus || c.status === filterStatus;
    const matchType   = !filterType   || c.correspondence_type === filterType;
    return matchSearch && matchStatus && matchType;
  });

  // Conteo por estado
  const counts = items.reduce((acc, c) => { acc[c.status] = (acc[c.status] || 0) + 1; return acc; }, {});

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* Tab switcher */}
      <div className="flex gap-1 p-1 bg-surface-100 rounded-xl w-fit">
        {[
          { id: 'correspondencia', label: 'Correspondencia', icon: Mail },
          { id: 'firmas',          label: 'Firma de documentos', icon: Shield },
        ].map(({ id, label, icon: Icon }) => (
          <button key={id} onClick={() => setActiveTab(id)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${activeTab === id ? 'bg-white shadow-sm text-brand-700' : 'text-surface-500 hover:text-surface-700'}`}>
            <Icon className="w-4 h-4" />{label}
          </button>
        ))}
      </div>

      {/* ═══ TAB: Firmas libres ═══ */}
      {activeTab === 'firmas' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-brand-900 flex items-center gap-2">
                <Shield className="w-5 h-5 text-brand-600" />Firma de documentos
              </h3>
              <p className="text-xs text-surface-400 mt-0.5">Firma cualquier PDF con proceso secuencial y validez jurídica</p>
            </div>
            {perms?.canEdit && (
              <button onClick={() => setShowFirmaModal(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 shadow-sm transition-colors">
                <Plus className="w-4 h-4" />Nuevo proceso
              </button>
            )}
          </div>

          {/* Estadísticas */}
          {!freeLoading && freeRequests.length > 0 && (() => {
            const fc = freeRequests.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
            return (
              <div className="grid grid-cols-4 gap-3">
                {[
                  { key: 'in_progress', label: 'En proceso', cls: 'text-blue-600' },
                  { key: 'completed',   label: 'Completados', cls: 'text-emerald-600' },
                  { key: 'rejected',    label: 'Rechazados',  cls: 'text-red-500' },
                  { key: 'cancelled',   label: 'Cancelados',  cls: 'text-surface-400' },
                ].map(({ key, label, cls }) => (
                  <div key={key} className="bg-white border border-surface-100 rounded-xl p-3 text-center shadow-sm">
                    <p className={`text-2xl font-bold ${cls}`}>{fc[key] || 0}</p>
                    <p className="text-xs text-surface-400 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          {freeLoading ? (
            <div className="flex items-center justify-center h-32">
              <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
            </div>
          ) : freeError ? (
            <div className="flex flex-col items-center justify-center h-40 gap-2">
              <AlertCircle className="w-8 h-8 text-red-400" />
              <p className="text-sm text-red-600 font-medium">{freeError}</p>
              <button onClick={loadFreeRequests} className="text-xs text-brand-600 hover:underline">Reintentar</button>
            </div>
          ) : freeRequests.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-40 text-surface-400 gap-2">
              <Shield className="w-10 h-10 text-surface-200" />
              <p className="text-sm">No hay procesos de firma. Crea el primero.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {freeRequests.map(req => {
                const statusCfg = {
                  in_progress: { label: 'En proceso', cls: 'bg-blue-100 text-blue-700' },
                  completed:   { label: 'Completado', cls: 'bg-emerald-100 text-emerald-700' },
                  rejected:    { label: 'Rechazado',  cls: 'bg-red-100 text-red-700' },
                  cancelled:   { label: 'Cancelado',  cls: 'bg-surface-100 text-surface-500' },
                }[req.status] || { label: req.status, cls: 'bg-surface-100 text-surface-500' };

                return (
                  <div key={req.id} className="flex items-center gap-3 p-4 bg-white rounded-xl border border-surface-100 shadow-sm">
                    <div className="w-9 h-9 bg-brand-50 rounded-lg flex items-center justify-center flex-shrink-0">
                      <Shield className="w-4 h-4 text-brand-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-surface-900 text-sm truncate">{req.title}</p>
                      <p className="text-xs text-surface-400 truncate">{req.file_name} · Por {req.created_by_name}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusCfg.cls}`}>
                          {statusCfg.label}
                        </span>
                        <span className="text-xs text-surface-400">
                          {req.signed_count}/{req.total_signers} firmantes
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      {/* Trazabilidad */}
                      <button
                        onClick={async () => {
                          try {
                            const r = await freeSignaturesAPI.get(projectId, req.id);
                            setTraceReq({ req, detail: r.data });
                          } catch { /* ignore */ }
                        }}
                        className="flex items-center gap-1 px-2 py-1 bg-surface-50 text-surface-600 border border-surface-200 rounded-lg text-xs font-medium hover:bg-surface-100 transition-colors">
                        <Activity className="w-3 h-3" />Trazabilidad
                      </button>
                      {req.status === 'completed' && (
                        <button
                          onClick={async () => {
                            try {
                              const r = await freeSignaturesAPI.downloadPdf(projectId, req.id);
                              const blob = new Blob([r.data], { type: 'application/pdf' });
                              const url = URL.createObjectURL(blob);
                              const a = document.createElement('a');
                              a.href = url; a.download = `firmado_${req.file_name || req.title}.pdf`;
                              a.click(); URL.revokeObjectURL(url);
                            } catch { alert('Error al descargar el PDF'); }
                          }}
                          className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium hover:bg-emerald-100 transition-colors">
                          <Download className="w-3 h-3" />PDF firmado
                        </button>
                      )}
                      {req.status === 'in_progress' && perms?.canEdit && (
                        <button
                          title="Cancelar firma"
                          onClick={async () => {
                            if (!window.confirm('¿Cancelar este proceso de firma?')) return;
                            await freeSignaturesAPI.cancel(projectId, req.id);
                            loadFreeRequests();
                          }}
                          className="p-1.5 hover:bg-red-50 text-surface-400 hover:text-red-500 rounded-lg transition-colors">
                          <Ban className="w-4 h-4" />
                        </button>
                      )}
                      {perms?.canEdit && (
                        <button
                          title="Eliminar permanentemente"
                          onClick={async () => {
                            if (!window.confirm('¿Eliminar permanentemente este proceso de firma? Esta acción no se puede deshacer.')) return;
                            try {
                              await freeSignaturesAPI.eliminate(projectId, req.id);
                              loadFreeRequests();
                            } catch { alert('Error al eliminar'); }
                          }}
                          className="p-1.5 hover:bg-red-50 text-surface-400 hover:text-red-600 rounded-lg transition-colors">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ═══ TAB: Correspondencia ═══ */}
      {activeTab === 'correspondencia' && <>
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-brand-900 flex items-center gap-2">
            <Mail className="w-5 h-5 text-brand-600" />Correspondencia del Proyecto
          </h3>
          <p className="text-xs text-surface-400 mt-0.5">{items.length} comunicación{items.length !== 1 ? 'es' : ''} registrada{items.length !== 1 ? 's' : ''}</p>
        </div>
        {perms?.canEdit && (
          <button onClick={() => { setEditItem(null); setShowForm(true); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 shadow-sm transition-colors">
            <Plus className="w-4 h-4" />Nueva
          </button>
        )}
      </div>

      {/* Resumen de estados */}
      {items.length > 0 && (
        <div className="grid grid-cols-3 sm:grid-cols-6 gap-2">
          {Object.entries(STATUS_CONFIG).map(([status, cfg]) => {
            const Icon = cfg.icon;
            return (
              <button key={status}
                onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
                className={`flex flex-col items-center p-2 rounded-xl border transition-all text-center
                  ${filterStatus === status ? 'border-brand-400 bg-brand-50' : 'border-surface-100 bg-white hover:bg-surface-50'}`}>
                <Icon className={`w-4 h-4 mb-1 ${filterStatus === status ? 'text-brand-600' : 'text-surface-400'}`} />
                <span className="text-lg font-bold text-brand-900">{counts[status] || 0}</span>
                <span className="text-[10px] text-surface-500">{cfg.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Barra de búsqueda y filtros */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-300" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por asunto, código, entidad..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none" />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-surface-400" />
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            className="text-sm border border-surface-200 rounded-xl px-3 py-2 focus:ring-2 focus:ring-brand-500 outline-none">
            <option value="">Todos los tipos</option>
            {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
        </div>
      </div>

      {/* Lista */}
      {filtered.length === 0
        ? (
          <div className="text-center py-16 bg-surface-50 rounded-2xl border-2 border-dashed border-surface-200">
            <Mail className="w-10 h-10 text-surface-300 mx-auto mb-3" />
            <p className="text-sm font-medium text-surface-400">
              {items.length === 0 ? 'No hay correspondencia registrada' : 'No hay resultados para los filtros aplicados'}
            </p>
            {items.length === 0 && perms?.canEdit && (
              <button onClick={() => { setEditItem(null); setShowForm(true); }}
                className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 mx-auto transition-colors">
                <Plus className="w-4 h-4" />Crear primera comunicación
              </button>
            )}
          </div>
        )
        : (
          <div className="space-y-2">
            {filtered.map(item => {
              const typeLabel = TYPES.find(t => t.value === item.correspondence_type)?.label || item.correspondence_type;
              return (
                <div key={item.id}
                  className="group bg-white border border-surface-100 rounded-xl hover:border-brand-200 hover:shadow-sm transition-all">
                  <div className="flex items-start gap-4 p-4">
                    {/* Ícono tipo */}
                    <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0 mt-0.5">
                      <FileText className="w-4 h-4 text-brand-600" />
                    </div>

                    {/* Contenido principal */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap mb-1">
                        <span className="font-mono text-xs text-brand-600 font-semibold bg-brand-50 px-2 py-0.5 rounded">
                          {item.consecutive_code}
                        </span>
                        <span className="text-xs text-surface-400 bg-surface-50 px-2 py-0.5 rounded">{typeLabel}</span>
                        <StatusBadge status={item.status} />
                      </div>
                      <p className="text-sm font-semibold text-brand-900 truncate">{item.subject}</p>
                      <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-surface-400">
                        {item.recipient_entity && (
                          <span className="flex items-center gap-1">
                            <ChevronRight className="w-3 h-3" />{item.recipient_entity}
                          </span>
                        )}
                        {item.recipient_name && <span>{item.recipient_name}</span>}
                        <span className="flex items-center gap-1">
                          <Clock className="w-3 h-3" />{fmtDate(item.reference_date)}
                        </span>
                        {item.radicado_number && (
                          <span className="text-blue-600 font-medium">Rad: {item.radicado_number}</span>
                        )}
                        {item.contract_reference && (
                          <span>Contrato: {item.contract_reference}</span>
                        )}
                      </div>
                    </div>

                    {/* Acciones */}
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                      {/* Firmar button — always visible on hover */}
                      {perms?.canEdit && (() => {
                        const sigStatus = corrSigStatuses[item.id]?.status;
                        const label = sigStatus === 'completed' ? 'Firmado'
                          : sigStatus === 'in_progress' ? 'En proceso' : 'Firmar';
                        const cls = sigStatus === 'completed'
                          ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                          : sigStatus === 'in_progress'
                          ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                          : 'bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100';
                        return (
                          <button
                            onClick={() => setSigModal(item)}
                            title="Firmas digitales"
                            className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-colors ${cls}`}>
                            <PenLine className="w-3 h-3" />{label}
                          </button>
                        );
                      })()}
                      <button onClick={() => setPreviewItem(item)} title="Vista previa"
                        className="p-1.5 hover:bg-brand-50 rounded-lg transition-colors text-surface-400 hover:text-brand-600">
                        <Eye className="w-4 h-4" />
                      </button>
                      {perms?.canEdit && (
                        <button onClick={() => { setEditItem(item); setShowForm(true); }} title="Editar"
                          className="p-1.5 hover:bg-brand-50 rounded-lg transition-colors text-surface-400 hover:text-brand-600">
                          <Pencil className="w-4 h-4" />
                        </button>
                      )}
                      {perms?.canEdit && (
                        <button onClick={() => handleDelete(item.id)} disabled={deleting === item.id} title="Eliminar"
                          className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-surface-400 hover:text-red-500 disabled:opacity-50">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )
      }

      {/* Modales correspondencia */}
      {showForm && (
        <FormModal
          projectId={projectId}
          initial={editItem}
          onClose={() => { setShowForm(false); setEditItem(null); }}
          onSaved={() => { setShowForm(false); setEditItem(null); load(); }}
        />
      )}
      {previewItem && (
        <PreviewModal
          projectId={projectId}
          record={previewItem}
          onClose={() => setPreviewItem(null)}
        />
      )}
      {sigModal && (
        <CorrSignatureModal
          projectId={projectId}
          corrItem={sigModal}
          existingRequest={corrSigStatuses[sigModal.id] || null}
          onClose={() => setSigModal(null)}
          onChanged={() => { setSigModal(null); load(); }}
        />
      )}
      </>}

      {/* ── Panel trazabilidad firma libre ── */}
      {traceReq && (() => {
        const { req, detail } = traceReq;
        const signers = detail?.signers || [];
        const fmtDate = (d) => d ? new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;

        // Build timeline
        const events = [];
        events.push({ icon: '🚀', label: 'Proceso de firmas iniciado', sub: `por ${detail?.created_by_name || 'Sistema'}`, time: fmtDate(detail?.created_at), color: 'blue' });
        for (const s of signers) {
          if (['notified','viewed','signed','rejected'].includes(s.status))
            events.push({ icon: '✉️', label: `Correo enviado a ${s.signer_name}`, sub: s.signer_email, time: fmtDate(s.created_at), color: 'indigo' });
          if (['viewed','signed','rejected'].includes(s.status))
            events.push({ icon: '👁️', label: `Enlace abierto por ${s.signer_name}`, sub: null, time: null, color: 'yellow' });
          if (s.status === 'signed')
            events.push({ icon: '✍️', label: `Documento firmado por ${s.signer_name}`, sub: `${s.signer_email} · IP: ${s.ip_address || '—'}`, time: fmtDate(s.signed_at), color: 'green' });
          if (s.status === 'rejected')
            events.push({ icon: '✗', label: `Firma rechazada por ${s.signer_name}`, sub: s.rejection_reason || '—', time: fmtDate(s.signed_at), color: 'red' });
        }
        if (req.status === 'completed')
          events.push({ icon: '✅', label: 'Proceso completado — todos firmaron', sub: null, time: fmtDate(detail?.completed_at), color: 'emerald' });

        const colorMap = { blue:'bg-blue-100 text-blue-600', indigo:'bg-indigo-100 text-indigo-600', yellow:'bg-amber-100 text-amber-600', green:'bg-emerald-100 text-emerald-600', red:'bg-red-100 text-red-600', emerald:'bg-emerald-500 text-white' };

        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]">
              {/* Header */}
              <div className="flex items-center justify-between p-5 border-b border-surface-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-brand-100 rounded-xl flex items-center justify-center">
                    <Shield className="w-4 h-4 text-brand-600" />
                  </div>
                  <div>
                    <p className="font-semibold text-surface-900 text-sm">Firmas Digitales</p>
                    <p className="text-xs text-surface-400 truncate max-w-56">{req.title}</p>
                  </div>
                </div>
                <button onClick={() => setTraceReq(null)} className="p-2 hover:bg-surface-100 rounded-lg transition-colors">
                  <X className="w-4 h-4 text-surface-400" />
                </button>
              </div>
              {/* Progress */}
              <div className="px-5 pt-4">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mb-3
                  ${{ in_progress:'bg-blue-100 text-blue-700', completed:'bg-emerald-100 text-emerald-700', rejected:'bg-red-100 text-red-700', cancelled:'bg-surface-100 text-surface-500' }[req.status]}`}>
                  {req.status === 'completed' ? '✓ Completado' : req.status === 'in_progress' ? '● En proceso' : req.status}
                  <span className="ml-1 opacity-70">{req.signed_count}/{req.total_signers} firmantes</span>
                </div>
                {req.total_signers > 0 && (
                  <div className="w-full h-1.5 bg-surface-100 rounded-full mb-1 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(req.signed_count / req.total_signers) * 100}%` }} />
                  </div>
                )}
              </div>
              {/* Timeline */}
              <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
                {events.map((ev, i) => (
                  <div key={i} className="flex items-start gap-3">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-sm flex-shrink-0 mt-0.5 ${colorMap[ev.color] || 'bg-surface-100 text-surface-600'}`}>
                      {ev.icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-surface-800 leading-snug">{ev.label}</p>
                      {ev.sub && <p className="text-xs text-surface-400 truncate mt-0.5">{ev.sub}</p>}
                      {ev.time && <p className="text-xs text-surface-300 mt-0.5">{ev.time}</p>}
                    </div>
                  </div>
                ))}
              </div>
              {/* Footer */}
              <div className="px-5 py-4 border-t border-surface-100 space-y-2">
                {req.status === 'completed' && (
                  <button
                    onClick={async () => {
                      try {
                        const r = await freeSignaturesAPI.downloadPdf(projectId, req.id);
                        const blob = new Blob([r.data], { type: 'application/pdf' });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url; a.download = `firmado_${req.file_name || req.title}.pdf`;
                        a.click(); URL.revokeObjectURL(url);
                      } catch { alert('Error al descargar el PDF'); }
                    }}
                    className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-medium rounded-xl transition-colors">
                    <Download className="w-4 h-4" />Descargar PDF firmado + auditoría
                  </button>
                )}
                <button onClick={() => setTraceReq(null)}
                  className="w-full px-4 py-2 text-sm text-surface-500 hover:bg-surface-50 rounded-xl transition-colors">
                  Cerrar
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Modal firma libre */}
      {showFirmaModal && (
        <FirmaLibreModal
          projectId={projectId}
          onClose={() => setShowFirmaModal(false)}
          onCreated={() => { setShowFirmaModal(false); loadFreeRequests(); }}
        />
      )}
    </div>
  );
}
