import React, { useState, useEffect, useCallback, useRef } from 'react';
import DOMPurify from 'dompurify';
import api, { correspondenceAPI, corrSignaturesAPI, freeSignaturesAPI, aiAPI, emailInboxAPI } from '../../services/api';
import {
  Mail, Plus, Sparkles, Download, Eye, Pencil, Trash2, X,
  ChevronRight, Search, Filter, FileText, Clock,
  CheckCircle, Send, Archive, RotateCcw, AlertCircle, PenLine,
  Shield, Loader2, Ban, Activity, Inbox, ArrowUpRight, ArrowDownLeft,
  Link2, GitBranch, User, Paperclip, UserCheck, Reply,
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

// Estados de SALIDA
const STATUS_SALIDA = {
  borrador:   { label: 'Borrador',   color: 'bg-surface-100 text-surface-600', icon: FileText },
  radicado:   { label: 'Radicado',   color: 'bg-blue-100 text-blue-700',       icon: CheckCircle },
  enviado:    { label: 'Enviado',    color: 'bg-brand-100 text-brand-700',     icon: Send },
  respondido: { label: 'Respondido', color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  archivado:  { label: 'Archivado',  color: 'bg-purple-100 text-purple-700',   icon: Archive },
};

// Estados de ENTRADA
const STATUS_ENTRADA = {
  recibido:    { label: 'Recibido',    color: 'bg-teal-100 text-teal-700',       icon: Inbox },
  en_atencion: { label: 'En atención', color: 'bg-amber-100 text-amber-700',     icon: UserCheck },
  respondido:  { label: 'Respondido',  color: 'bg-emerald-100 text-emerald-700', icon: CheckCircle },
  archivado:   { label: 'Archivado',   color: 'bg-purple-100 text-purple-700',   icon: Archive },
};

// CONFIG unificado para StatusBadge (incluye todos)
const STATUS_CONFIG = { ...STATUS_SALIDA, ...STATUS_ENTRADA };

const EMPTY_SALIDA = {
  direction: 'salida',
  correspondence_type: 'oficio',
  subject: '', reference_date: new Date().toISOString().split('T')[0],
  recipient_name: '', recipient_title: '', recipient_entity: '',
  recipient_address: '', recipient_city: 'Bogotá D.C.',
  sender_name: '', sender_title: '', sender_entity: '',
  body: '', closing: 'Cordialmente,',
  contract_reference: '', project_entity: '', project_start_date: '', project_object: '',
  status: 'borrador', radicado_number: '', sent_date: '', response_date: '', notes: '',
};

const EMPTY_ENTRADA = {
  direction: 'entrada',
  correspondence_type: 'radicado',
  subject: '', reference_date: new Date().toISOString().split('T')[0],
  received_date: new Date().toISOString().split('T')[0],
  sender_entity_external: '', sender_name_external: '',
  recipient_entity: '', recipient_city: 'Bogotá D.C.',
  contract_reference: '', notes: '',
  status: 'recibido', assigned_to: '',
  parent_id: '',
};

// ─── Utilidades de fecha ──────────────────────────────────────────────────────
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
function fmtDateLong(d) {
  if (!d) return '';
  const dt = parseLocalDate(d);
  const months = ['enero','febrero','marzo','abril','mayo','junio','julio',
                  'agosto','septiembre','octubre','noviembre','diciembre'];
  return `${dt.getDate()} de ${months[dt.getMonth()]} de ${dt.getFullYear()}`;
}
function toInputDate(val) {
  if (!val) return '';
  if (typeof val === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(val)) return val;
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

const TYPE_LABEL_MAP = {
  oficio: 'OFICIO', circular: 'CIRCULAR', memorando: 'MEMORANDO',
  comunicado: 'COMUNICADO', carta: 'CARTA', radicado: 'RADICADO',
  derecho_peticion: 'DERECHO DE PETICIÓN',
};

// ─── Badge de estado ─────────────────────────────────────────────────────────
function StatusBadge({ status }) {
  const cfg = STATUS_CONFIG[status] || { label: status, color: 'bg-surface-100 text-surface-600', icon: FileText };
  const Icon = cfg.icon;
  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${cfg.color}`}>
      <Icon className="w-3 h-3" />{cfg.label}
    </span>
  );
}

// ─── Subcomponentes reutilizables del formulario ──────────────────────────────
function FieldInput({ label, field, form, set, type = 'text', required, placeholder, className = '' }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-surface-600">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      <input type={type} value={form[field] || ''} onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-400 outline-none transition-all" />
    </div>
  );
}
function FieldTextarea({ label, field, form, set, rows = 4, placeholder, className = '' }) {
  return (
    <div className={`space-y-1 ${className}`}>
      <label className="block text-xs font-medium text-surface-600">{label}</label>
      <textarea rows={rows} value={form[field] || ''} onChange={e => set(field, e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 focus:border-brand-400 outline-none transition-all resize-y" />
    </div>
  );
}

// ─── Editor de texto enriquecido ─────────────────────────────────────────────
function RichTextEditor({ value, onChange }) {
  const ref        = useRef(null);
  const inited     = useRef(false);
  const lastValue  = useRef(value);
  useEffect(() => {
    if (!ref.current || inited.current) return;
    inited.current = true;
    const v = value || '';
    if (v && !/<[a-zA-Z]/.test(v)) {
      ref.current.innerHTML = v.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('');
    } else { ref.current.innerHTML = v; }
    lastValue.current = value;
  }, []); // eslint-disable-line
  // Sync when value changes externally (e.g. AI generation)
  useEffect(() => {
    if (!ref.current || !inited.current) return;
    if (value === lastValue.current) return;
    lastValue.current = value;
    const v = value || '';
    if (v && !/<[a-zA-Z]/.test(v)) {
      ref.current.innerHTML = v.split('\n').map(l => `<p>${l || '<br>'}</p>`).join('');
    } else { ref.current.innerHTML = v; }
  }, [value]);
  const emit = () => ref.current && onChange(ref.current.innerHTML);
  const exec = (cmd, val) => { document.execCommand(cmd, false, val || null); ref.current?.focus(); emit(); };
  const insertLink = e => {
    e.preventDefault();
    const url = window.prompt('URL del enlace:');
    if (!url) return;
    ref.current?.focus();
    const sel = window.getSelection()?.toString() || '';
    if (sel) { document.execCommand('createLink', false, url); }
    else {
      const txt = window.prompt('Texto:', url);
      if (txt) document.execCommand('insertHTML', false, `<a href="${url}" target="_blank">${txt}</a>`);
    }
    ref.current?.querySelectorAll('a').forEach(a => a.setAttribute('target', '_blank'));
    emit();
  };
  const B = 'px-2 py-1 rounded text-xs text-surface-700 hover:bg-surface-200 transition-colors select-none cursor-pointer';
  return (
    <div className="border border-surface-200 rounded-lg overflow-hidden focus-within:ring-2 focus-within:ring-brand-500 focus-within:border-brand-400 transition-all">
      <div className="flex items-center gap-0.5 px-2 py-1.5 bg-surface-50 border-b border-surface-100 flex-wrap">
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('bold'); }} className={`${B} font-bold`}>N</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('italic'); }} className={`${B} italic`}>K</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('underline'); }} className={`${B} underline`}>S</button>
        <div className="w-px h-4 bg-surface-200 mx-1" />
        <button type="button" onMouseDown={insertLink} className={`${B} text-brand-600 font-medium`}>🔗 Enlace</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('unlink'); }} className={`${B} text-surface-400`}>✕🔗</button>
        <div className="w-px h-4 bg-surface-200 mx-1" />
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertOrderedList'); }} className={B}>1.</button>
        <button type="button" onMouseDown={e => { e.preventDefault(); exec('insertUnorderedList'); }} className={B}>•</button>
      </div>
      <div ref={ref} contentEditable suppressContentEditableWarning onInput={emit}
        className="px-3 py-2.5 text-sm text-gray-800 outline-none overflow-y-auto [&_a]:text-brand-600 [&_a]:underline [&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 [&_p]:mb-1"
        style={{ minHeight: '14rem' }} />
    </div>
  );
}

// ─── Modal vista previa SALIDA ────────────────────────────────────────────────
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
      const url = URL.createObjectURL(blob);
      const a   = document.createElement('a');
      a.href = url; a.download = `${record.consecutive_code}.docx`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { alert('Error al descargar: ' + e.message); }
    finally { setDownloading(false); }
  };
  const typeLabel  = TYPE_LABEL_MAP[record.correspondence_type] || 'COMUNICACIÓN';
  const firstName  = (record.recipient_name || '').split(' ')[0] || 'señor(a)';
  const bodyHtml = (() => {
    const b = record.body || '';
    if (!b) return '';
    if (/<[a-zA-Z]/.test(b)) return DOMPurify.sanitize(b, { ADD_ATTR: ['target'] });
    return b.split('\n').map(l => `<p>${l || ''}</p>`).join('');
  })();
  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col overflow-hidden">
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
        <div className="flex-1 overflow-y-auto bg-gray-100 p-6">
          <div className="bg-white shadow-lg mx-auto max-w-2xl" style={{ fontFamily: 'Calibri, sans-serif' }}>
            <div className="flex">
              <div className="flex-1 bg-[#1E3A5F] px-6 py-5">
                {record.correspondence_logo && <img src={record.correspondence_logo} alt="Logo" className="h-10 mb-2 object-contain" style={{ maxWidth: '160px' }} />}
                <p className="text-white font-bold text-base leading-tight">{record.correspondence_sender_name || record.project_entity || record.project_name || 'Entidad'}</p>
                {record.project_name && <p className="text-blue-200 text-xs mt-1">Proyecto: {record.project_name}</p>}
                {record.project_code && <p className="text-blue-200 text-xs">Código: {record.project_code}</p>}
              </div>
              <div className="bg-[#2E86AB] px-5 py-5 text-center flex flex-col justify-center min-w-[160px]">
                <p className="text-white font-bold text-sm tracking-widest">{typeLabel}</p>
                <p className="text-blue-100 text-xs font-mono mt-1">{record.consecutive_code}</p>
                <p className="text-blue-200 text-xs mt-1">{fmtDateLong(record.reference_date)}</p>
              </div>
            </div>
            <div className="h-1 bg-[#2E86AB]" />
            <div className="px-8 py-6 space-y-4 text-sm text-gray-800">
              <p className="text-right text-gray-500 text-xs">{record.recipient_city || 'Bogotá D.C.'}, {fmtDateLong(record.reference_date)}</p>
              <div className="space-y-0.5">
                {record.recipient_name   && <p className="font-semibold text-[#1E3A5F]">{record.recipient_name}</p>}
                {record.recipient_title  && <p className="text-gray-600 text-xs">{record.recipient_title}</p>}
                {record.recipient_entity && <p className="text-gray-600 text-xs">{record.recipient_entity}</p>}
                {record.recipient_address&& <p className="text-gray-500 text-xs">{record.recipient_address}</p>}
                <p className="text-gray-500 text-xs">{record.recipient_city || 'Bogotá D.C.'}</p>
              </div>
              <div className="flex gap-2 bg-gray-50 border-l-4 border-[#2E86AB] px-3 py-2 rounded-r">
                <span className="font-bold text-[#1E3A5F] text-xs whitespace-nowrap">ASUNTO:</span>
                <span className="font-semibold text-xs">{record.subject}</span>
              </div>
              {record.contract_reference && <div className="flex gap-2 text-xs text-gray-600"><span className="font-semibold text-[#1E3A5F]">REF:</span><span>Contrato No. {record.contract_reference}</span></div>}
              <p>Respetado(a) señor(a) <strong>{firstName}</strong>:</p>
              <div dangerouslySetInnerHTML={{ __html: bodyHtml }}
                className="space-y-2 text-justify leading-relaxed [&_a]:text-blue-600 [&_a]:underline [&_ul]:list-disc [&_ul]:ml-5 [&_ol]:list-decimal [&_ol]:ml-5 [&_p]:mb-1" />
              <p className="pt-2">{record.closing || 'Cordialmente,'}</p>
              <div className="pt-20 space-y-1">
                <div className="w-44 border-b border-gray-500 mb-6" />
                {record.sender_name   && <p className="font-bold text-[#1E3A5F]">{record.sender_name}</p>}
                {record.sender_title  && <p className="text-gray-600 text-xs">{record.sender_title}</p>}
                {record.sender_entity && <p className="text-gray-500 text-xs">{record.sender_entity}</p>}
              </div>
            </div>
            <div className="bg-gray-50 border-t border-gray-200 px-8 py-2 flex justify-between items-center">
              <span className="text-[10px] text-gray-400">{typeLabel} No. {record.consecutive_code}</span>
              <span className="text-[10px] text-gray-400">Generado por SGIP-IA · {fmtDateLong(new Date().toISOString())}</span>
            </div>
          </div>
        </div>
        <div className="px-6 py-2 bg-gray-50 border-t border-gray-100 flex-shrink-0">
          <p className="text-[11px] text-gray-400 text-center">Vista previa aproximada — el Word descargado incluirá formato corporativo completo</p>
        </div>
      </div>
    </div>
  );
}

// ─── Modal HILO de correspondencia ───────────────────────────────────────────
function ThreadModal({ projectId, item, onClose }) {
  const [thread, setThread]   = useState([]);
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    correspondenceAPI.thread(projectId, item.id)
      .then(r => setThread(r.data.data || []))
      .catch(() => setThread([item]))
      .finally(() => setLoading(false));
  }, [projectId, item.id]); // eslint-disable-line
  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[80vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-surface-100">
          <div className="flex items-center gap-2">
            <GitBranch className="w-4 h-4 text-brand-600" />
            <h3 className="font-semibold text-brand-900 text-sm">Hilo de correspondencia</h3>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-100 rounded-lg"><X className="w-4 h-4 text-surface-400" /></button>
        </div>
        <div className="flex-1 overflow-y-auto p-5">
          {loading ? (
            <div className="flex justify-center py-10"><Loader2 className="w-5 h-5 animate-spin text-brand-400" /></div>
          ) : (
            <div className="relative">
              {/* Línea vertical de conexión */}
              {thread.length > 1 && <div className="absolute left-5 top-8 bottom-8 w-px bg-surface-200" />}
              <div className="space-y-3">
                {thread.map((t, i) => {
                  const isEntrada = t.direction === 'entrada';
                  return (
                    <div key={t.id} className={`flex gap-3 ${t.id === item.id ? 'ring-2 ring-brand-300 rounded-xl' : ''}`}>
                      <div className={`w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 z-10 ${isEntrada ? 'bg-teal-100' : 'bg-brand-100'}`}>
                        {isEntrada
                          ? <ArrowDownLeft className="w-4 h-4 text-teal-600" />
                          : <ArrowUpRight className="w-4 h-4 text-brand-600" />}
                      </div>
                      <div className="flex-1 bg-surface-50 rounded-xl p-3 border border-surface-100">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <span className="font-mono text-xs text-brand-600 font-semibold">{t.consecutive_code}</span>
                          <StatusBadge status={t.status} />
                          {i === 0 && thread.length > 1 && <span className="text-[10px] text-surface-400 bg-surface-100 px-1.5 py-0.5 rounded">Origen</span>}
                        </div>
                        <p className="text-sm font-medium text-surface-800 leading-snug">{t.subject}</p>
                        <div className="flex items-center gap-2 mt-1 text-xs text-surface-400">
                          <span>{fmtDate(t.reference_date)}</span>
                          {isEntrada && t.sender_entity_external && <span className="flex items-center gap-1"><ArrowDownLeft className="w-3 h-3" />{t.sender_entity_external}</span>}
                          {!isEntrada && t.recipient_entity && <span className="flex items-center gap-1"><ArrowUpRight className="w-3 h-3" />{t.recipient_entity}</span>}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Modal radicar correspondencia ENTRADA ────────────────────────────────────
function RadicarModal({ projectId, initial, onClose, onSaved, teamMembers, replyTo }) {
  const [form, setForm] = useState(() => ({
    ...EMPTY_ENTRADA,
    ...(initial ? {
      ...initial,
      reference_date: toInputDate(initial.reference_date),
      received_date:  toInputDate(initial.received_date),
      assigned_to:    initial.assigned_to || '',
      parent_id:      initial.parent_id || '',
    } : {}),
    ...(replyTo ? { parent_id: replyTo.id } : {}),
  }));
  const [file, setFile]           = useState(null);
  const [saving, setSaving]       = useState(false);
  const [error, setError]         = useState('');
  const [allAtts, setAllAtts]     = useState([]);
  const [preview, setPreview]     = useState(null); // { url, name }
  const [aiPanel, setAiPanel]     = useState(false);
  const [aiPrompt, setAiPrompt]   = useState('');
  const [aiLoading, setAiLoading] = useState(false);
  const [aiSettings, setAiSettings] = useState(null);
  const isEdit = !!initial?.id;
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const aiConfigured = aiSettings && (aiSettings.anthropic_configured || aiSettings.openai_configured);
  const aiProvider   = aiSettings?.default_provider || (aiSettings?.openai_configured ? 'openai' : 'anthropic');
  const aiModel      = aiProvider === 'anthropic' ? aiSettings?.anthropic_model : aiSettings?.openai_model;

  useEffect(() => {
    aiAPI.settings().then(r => setAiSettings(r.data?.data || r.data || {})).catch(() => setAiSettings({}));
  }, []); // eslint-disable-line

  const handleAiGenerate = async () => {
    if (!aiPrompt.trim()) return;
    setAiLoading(true); setError('');
    try {
      const { data } = await correspondenceAPI.aiGenerate(projectId, { prompt: aiPrompt });
      const g = data.data;
      setForm(f => ({
        ...f,
        correspondence_type:    g.correspondence_type    || f.correspondence_type,
        subject:                g.subject                || f.subject,
        sender_entity_external: g.recipient_entity       || f.sender_entity_external,
        sender_name_external:   g.recipient_name         || f.sender_name_external,
        notes:                  g.body                   || f.notes,
      }));
      setAiPanel(false);
    } catch (e) {
      setError('Error al generar con IA');
    } finally { setAiLoading(false); }
  };

  useEffect(() => {
    if (isEdit && initial?.id) {
      correspondenceAPI.listAttachments(projectId, initial.id)
        .then(r => setAllAtts(r.data?.data || []))
        .catch(() => setAllAtts([]));
    }
  }, [isEdit, initial?.id, projectId]);

  const openPreview = (pid, cid, att) => {
    correspondenceAPI.downloadAttachmentById(pid, cid, att.id)
      .then(r => {
        const mime = att.mime_type || (att.original_name?.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream');
        const blob = new Blob([r.data], { type: mime });
        setPreview({ url: URL.createObjectURL(blob), name: att.original_name, mime });
      }).catch(() => {});
  };

  const handleSave = async () => {
    if (!form.subject.trim())   { setError('El asunto es requerido'); return; }
    if (!form.reference_date)   { setError('La fecha del documento es requerida'); return; }
    setSaving(true); setError('');
    try {
      let saved;
      if (isEdit) {
        const r = await correspondenceAPI.update(projectId, initial.id, form);
        saved = r.data.data;
      } else {
        const r = await correspondenceAPI.create(projectId, { ...form, direction: 'entrada' });
        saved = r.data.data;
      }
      // Subir adjunto si hay
      if (file && saved?.id) {
        await correspondenceAPI.uploadAttachment(projectId, saved.id, file);
      }
      onSaved();
    } catch (e) {
      setError(e.response?.data?.error || 'Error al guardar');
    } finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Inbox className="w-5 h-5 text-teal-600" />
            <h2 className="text-base font-semibold text-brand-900">
              {replyTo
                ? `Respuesta a ${replyTo.consecutive_code}`
                : isEdit ? 'Editar correspondencia recibida' : 'Radicar correspondencia recibida'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-surface-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {/* Vinculado a */}
          {replyTo && (
            <div className="flex items-start gap-3 p-3 bg-teal-50 border border-teal-100 rounded-xl">
              <Reply className="w-4 h-4 text-teal-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-teal-800">Respuesta vinculada a:</p>
                <p className="text-teal-700">{replyTo.consecutive_code} — {replyTo.subject}</p>
              </div>
            </div>
          )}

          {/* IA */}
          <div className="bg-gradient-to-r from-brand-50 to-violet-50 border border-brand-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-600" />
                <span className="text-sm font-semibold text-brand-800">Generar con IA</span>
              </div>
              <button type="button" onClick={() => setAiPanel(!aiPanel)} className="text-xs text-brand-600 hover:text-brand-800 font-medium">
                {aiPanel ? 'Ocultar' : 'Expandir'}
              </button>
            </div>
            {aiSettings === null
              ? <div className="h-5 bg-white/50 rounded animate-pulse mb-2" />
              : aiConfigured
                ? <p className="text-[10px] text-emerald-700 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /><strong>Motor de IA configurado</strong>&nbsp;· {aiModel}&nbsp;· <span className="capitalize">{aiProvider}</span></p>
                : <p className="text-[10px] text-red-600 mb-2">⚠ Motor de IA no configurado.</p>}
            {aiPanel && (
              <div className="space-y-2 mt-2">
                <textarea rows={3} value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Ej: Respuesta a nuestro oficio sobre radicación de factura, viene del contratista..."
                  className="w-full px-3 py-2 text-sm border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none resize-none" />
                <button type="button" onClick={handleAiGenerate} disabled={aiLoading || !aiPrompt.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
                  {aiLoading ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />Generando...</> : <><Sparkles className="w-3.5 h-3.5" />Generar campos</>}
                </button>
              </div>
            )}
          </div>

          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
              <AlertCircle className="w-4 h-4 flex-shrink-0" />{error}
            </div>
          )}

          {/* Remitente externo */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-surface-100" />
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Remitente (quien nos envió)</span>
            <div className="flex-1 h-px bg-surface-100" />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <FieldInput form={form} set={set} label="Entidad remitente" field="sender_entity_external" placeholder="Ej: Ministerio de Transporte" required />
            <FieldInput form={form} set={set} label="Persona de contacto" field="sender_name_external" placeholder="Nombre del firmante" />
          </div>

          {/* Datos del documento */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-surface-100" />
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Datos del documento</span>
            <div className="flex-1 h-px bg-surface-100" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-surface-600">Tipo<span className="text-red-500 ml-0.5">*</span></label>
              <select value={form.correspondence_type} onChange={e => set('correspondence_type', e.target.value)}
                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none">
                {TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <FieldInput form={form} set={set} label="Fecha del documento" field="reference_date" type="date" required />
            <FieldInput form={form} set={set} label="Fecha de recepción" field="received_date" type="date" />
          </div>
          <FieldInput form={form} set={set} label="Asunto" field="subject" required placeholder="Asunto de la comunicación recibida" />
          <div className="grid grid-cols-2 gap-3">
            <FieldInput form={form} set={set} label="N° de radicado (si viene en el doc.)" field="radicado_number" placeholder="RAD-2026-001" />
            <FieldInput form={form} set={set} label="N° de Contrato de referencia" field="contract_reference" placeholder="Ej: 001-2025" />
          </div>

          {/* Asignación */}
          {teamMembers && teamMembers.length > 0 && (
            <>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-px bg-surface-100" />
                <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Asignar responsable</span>
                <div className="flex-1 h-px bg-surface-100" />
              </div>
              <div className="space-y-1">
                <label className="block text-xs font-medium text-surface-600">Responsable de atender</label>
                <select value={form.assigned_to || ''} onChange={e => set('assigned_to', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none">
                  <option value="">Sin asignar</option>
                  {teamMembers.map(m => (
                    <option key={m.id} value={m.user_id || m.id}>{m.full_name || m.person_name}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          {/* Observaciones */}
          <FieldTextarea form={form} set={set} label="Observaciones / Cuerpo del correo" field="notes" rows={5}
            placeholder="Contexto, urgencia, acciones requeridas o cuerpo del correo recibido..." />

          {/* Adjuntos */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-surface-100" />
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Documento adjunto</span>
            <div className="flex-1 h-px bg-surface-100" />
          </div>
          <div className="space-y-2">
            {/* Adjuntos múltiples (tabla correspondence_attachments) */}
            {allAtts.length > 0 && (
              <div className="space-y-1">
                {allAtts.map(att => (
                  <div key={att.id} className="flex items-center gap-2 p-2 bg-surface-50 border border-surface-200 rounded-lg text-sm">
                    <Paperclip className="w-4 h-4 text-surface-400 flex-shrink-0" />
                    <span className="text-surface-600 truncate flex-1">{att.original_name}</span>
                    <button onClick={() => openPreview(projectId, initial.id, att)}
                      className="text-brand-600 hover:underline text-xs flex-shrink-0">
                      Ver
                    </button>
                  </div>
                ))}
              </div>
            )}
            {/* Adjunto legacy cuando no hay tabla */}
            {allAtts.length === 0 && initial?.attachment_original_name && !file && (
              <div className="flex items-center gap-2 p-2 bg-surface-50 border border-surface-200 rounded-lg text-sm">
                <Paperclip className="w-4 h-4 text-surface-400" />
                <span className="text-surface-600 truncate flex-1">{initial.attachment_original_name}</span>
                <button onClick={() => {
                  api.get(`/exec/${projectId}/correspondence/${initial.id}/attachment`, { responseType: 'blob' })
                    .then(r => {
                      const mime = initial.attachment_original_name?.endsWith('.pdf') ? 'application/pdf' : 'application/octet-stream';
                      setPreview({ url: URL.createObjectURL(new Blob([r.data], { type: mime })), name: initial.attachment_original_name, mime });
                    }).catch(() => {});
                }} className="text-brand-600 hover:underline text-xs flex-shrink-0">Ver</button>
              </div>
            )}
            <label className="flex items-center gap-2 px-4 py-2.5 border-2 border-dashed border-surface-200 rounded-xl cursor-pointer hover:border-brand-300 hover:bg-brand-50 transition-colors">
              <Paperclip className="w-4 h-4 text-surface-400" />
              <span className="text-sm text-surface-500">
                {file ? file.name : (isEdit ? 'Agregar adjunto...' : 'Adjuntar documento recibido (PDF, Word, imagen)')}
              </span>
              <input type="file" className="hidden" accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.tiff,.xlsx"
                onChange={e => setFile(e.target.files[0] || null)} />
            </label>
            {file && (
              <div className="flex items-center gap-2 p-2 bg-brand-50 border border-brand-100 rounded-lg text-sm">
                <Paperclip className="w-4 h-4 text-brand-500" />
                <span className="text-brand-700">{file.name}</span>
                <button onClick={() => setFile(null)} className="ml-auto text-surface-400 hover:text-red-500"><X className="w-3.5 h-3.5" /></button>
              </div>
            )}
          </div>

        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-surface-100 flex-shrink-0 bg-surface-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 rounded-lg transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors">
            {saving
              ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />Guardando...</>
              : <>{isEdit ? 'Guardar cambios' : 'Radicar'}</>}
          </button>
        </div>
      </div>
      <AttachmentPreviewModal preview={preview} onClose={() => { URL.revokeObjectURL(preview?.url); setPreview(null); }} />
    </div>
  );
}

// ─── Modal formulario SALIDA ──────────────────────────────────────────────────
function FormModal({ projectId, initial, replyTo, onClose, onSaved }) {
  const [form, setForm] = useState(() => {
    const base = initial ? {
      ...EMPTY_SALIDA, ...initial,
      reference_date:     toInputDate(initial.reference_date),
      project_start_date: toInputDate(initial.project_start_date),
      sent_date:          toInputDate(initial.sent_date),
      response_date:      toInputDate(initial.response_date),
      radicado_number: initial.radicado_number || initial.consecutive_code || '',
    } : { ...EMPTY_SALIDA };
    if (replyTo) base.parent_id = replyTo.id;
    return base;
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
    setAiLoading(true); setError('');
    try {
      const { data } = await correspondenceAPI.aiGenerate(projectId, { prompt: aiPrompt });
      const g = data.data;
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
    } catch (e) { setError(e.response?.data?.error || 'Error al generar con IA'); }
    finally { setAiLoading(false); }
  };

  const handleSave = async () => {
    if (!form.subject.trim()) { setError('El asunto es requerido'); return; }
    if (!form.reference_date)  { setError('La fecha es requerida'); return; }
    setSaving(true); setError('');
    try {
      if (isEdit) { await correspondenceAPI.update(projectId, initial.id, { ...form, direction: 'salida' }); }
      else         { await correspondenceAPI.create(projectId, { ...form, direction: 'salida' }); }
      onSaved();
    } catch (e) { setError(e.response?.data?.error || 'Error al guardar'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[95vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Mail className="w-5 h-5 text-brand-600" />
            <h2 className="text-base font-semibold text-brand-900">
              {replyTo ? `Respuesta a ${replyTo.consecutive_code}` : isEdit ? 'Editar correspondencia' : 'Nueva correspondencia de salida'}
            </h2>
          </div>
          <button onClick={onClose} className="p-1.5 hover:bg-surface-100 rounded-lg transition-colors">
            <X className="w-4 h-4 text-surface-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-5">
          {replyTo && (
            <div className="flex items-start gap-3 p-3 bg-brand-50 border border-brand-100 rounded-xl">
              <Reply className="w-4 h-4 text-brand-600 mt-0.5 flex-shrink-0" />
              <div className="text-sm">
                <p className="font-semibold text-brand-800">Respondiendo a correspondencia recibida:</p>
                <p className="text-brand-700">{replyTo.consecutive_code} — {replyTo.subject}</p>
              </div>
            </div>
          )}

          {/* IA */}
          <div className="bg-gradient-to-r from-brand-50 to-violet-50 border border-brand-100 rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-600" />
                <span className="text-sm font-semibold text-brand-800">Generar con IA</span>
              </div>
              <button onClick={() => setAiPanel(!aiPanel)} className="text-xs text-brand-600 hover:text-brand-800 font-medium">
                {aiPanel ? 'Ocultar' : 'Expandir'}
              </button>
            </div>
            {aiSettings === null
              ? <div className="h-5 bg-white/50 rounded animate-pulse mb-2" />
              : aiConfigured
                ? <p className="text-[10px] text-emerald-700 mb-2 flex items-center gap-1"><Sparkles className="w-3 h-3" /><strong>Motor de IA configurado</strong>&nbsp;· {aiModel}&nbsp;· <span className="capitalize">{aiProvider}</span></p>
                : <p className="text-[10px] text-red-600 mb-2">⚠ Motor de IA no configurado.</p>}
            {aiPanel && (
              <div className="space-y-2 mt-2">
                <textarea rows={3} value={aiPrompt} onChange={e => setAiPrompt(e.target.value)}
                  placeholder="Ej: Necesito un oficio informando al Ministerio que el contrato lleva un 65% de avance..."
                  className="w-full px-3 py-2 text-sm border border-brand-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none resize-none" />
                <button onClick={handleAiGenerate} disabled={aiLoading || !aiPrompt.trim()}
                  className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
                  {aiLoading ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />Generando...</> : <><Sparkles className="w-3.5 h-3.5" />Generar campos</>}
                </button>
              </div>
            )}
          </div>

          {error && <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700"><AlertCircle className="w-4 h-4 flex-shrink-0" />{error}</div>}

          {/* Tipo, fecha, estado */}
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
                {Object.entries(STATUS_SALIDA).map(([v, c]) => <option key={v} value={v}>{c.label}</option>)}
              </select>
            </div>
          </div>
          <FieldInput form={form} set={set} label="Asunto" field="subject" required placeholder="Asunto de la comunicación" />

          <div className="flex items-center gap-2"><div className="flex-1 h-px bg-surface-100" /><span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Destinatario</span><div className="flex-1 h-px bg-surface-100" /></div>
          <div className="grid grid-cols-2 gap-3">
            <FieldInput form={form} set={set} label="Nombre completo"  field="recipient_name"    placeholder="Nombre del destinatario" />
            <FieldInput form={form} set={set} label="Cargo"            field="recipient_title"   placeholder="Cargo / Función" />
            <FieldInput form={form} set={set} label="Entidad"          field="recipient_entity"  placeholder="Nombre de la entidad" />
            <FieldInput form={form} set={set} label="Ciudad"           field="recipient_city"    placeholder="Ciudad" />
            <FieldInput form={form} set={set} label="Dirección"        field="recipient_address" placeholder="Dirección (opcional)" className="col-span-2" />
          </div>

          <div className="flex items-center gap-2"><div className="flex-1 h-px bg-surface-100" /><span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Remitente</span><div className="flex-1 h-px bg-surface-100" /></div>
          <div className="grid grid-cols-2 gap-3">
            <FieldInput form={form} set={set} label="Nombre del remitente"  field="sender_name"   placeholder="Ej: Germán Medina Wilches" />
            <FieldInput form={form} set={set} label="Cargo del remitente"   field="sender_title"  placeholder="Ej: Gerente de Proyecto" />
            <FieldInput form={form} set={set} label="Empresa del remitente" field="sender_entity" placeholder="Ej: Consorcio..." className="col-span-2" />
          </div>

          <div className="flex items-center gap-2"><div className="flex-1 h-px bg-surface-100" /><span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Referencia del Contrato</span><div className="flex-1 h-px bg-surface-100" /></div>
          <div className="grid grid-cols-2 gap-3">
            <FieldInput form={form} set={set} label="N° de Contrato"       field="contract_reference" placeholder="Ej: 001-2025" />
            <FieldInput form={form} set={set} label="Entidad contratante"  field="project_entity"     placeholder="Nombre de la entidad" />
            <FieldInput form={form} set={set} label="Fecha de inicio"      field="project_start_date" type="date" />
          </div>
          <FieldTextarea form={form} set={set} label="Objeto del contrato" field="project_object" rows={2} placeholder="Resumen del objeto del contrato" />

          <div className="flex items-center gap-2"><div className="flex-1 h-px bg-surface-100" /><span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Contenido</span><div className="flex-1 h-px bg-surface-100" /></div>
          <div className="space-y-1">
            <label className="block text-xs font-medium text-surface-600">Cuerpo de la comunicación</label>
            <RichTextEditor value={form.body} onChange={v => set('body', v)} />
          </div>
          <FieldInput form={form} set={set} label="Cierre" field="closing" placeholder="Ej: Cordialmente," />

          <div className="flex items-center gap-2"><div className="flex-1 h-px bg-surface-100" /><span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Seguimiento</span><div className="flex-1 h-px bg-surface-100" /></div>
          <div className="grid grid-cols-3 gap-3">
            <FieldInput form={form} set={set} label="N° de radicado"    field="radicado_number" placeholder="RAD-2026-001" />
            <FieldInput form={form} set={set} label="Fecha de envío"    field="sent_date"       type="date" />
            <FieldInput form={form} set={set} label="Fecha de respuesta" field="response_date"  type="date" />
          </div>
          <FieldTextarea form={form} set={set} label="Observaciones internas" field="notes" rows={2} placeholder="Notas de seguimiento..." />
        </div>

        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-surface-100 flex-shrink-0 bg-surface-50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm text-surface-600 hover:bg-surface-100 rounded-lg transition-colors">Cancelar</button>
          <button onClick={handleSave} disabled={saving}
            className="flex items-center gap-1.5 px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
            {saving ? <><span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin inline-block" />Guardando...</> : <>{isEdit ? 'Guardar cambios' : 'Crear correspondencia'}</>}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Card de item SALIDA ──────────────────────────────────────────────────────
function SalidaCard({ item, perms, projectId, onEdit, onDelete, onPreview, onSign, onThread, onReply, sigStatus, deleting }) {
  const typeLabel = TYPES.find(t => t.value === item.correspondence_type)?.label || item.correspondence_type;
  const hasThread = Number(item.reply_count) > 0 || !!item.parent_id;
  const sigLabel  = sigStatus?.status === 'completed' ? 'Firmado' : sigStatus?.status === 'in_progress' ? 'En proceso' : 'Firmar';
  const sigCls    = sigStatus?.status === 'completed' ? 'bg-green-50 text-green-700 border-green-200 hover:bg-green-100'
                  : sigStatus?.status === 'in_progress' ? 'bg-blue-50 text-blue-700 border-blue-200 hover:bg-blue-100'
                  : 'bg-brand-50 text-brand-700 border-brand-200 hover:bg-brand-100';
  return (
    <div className="group bg-white border border-surface-100 rounded-xl hover:border-brand-200 hover:shadow-sm transition-all">
      <div className="flex items-start gap-4 p-4">
        <div className="w-9 h-9 rounded-xl bg-brand-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <ArrowUpRight className="w-4 h-4 text-brand-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-mono text-xs text-brand-600 font-semibold bg-brand-50 px-2 py-0.5 rounded">{item.consecutive_code}</span>
            <span className="text-xs text-surface-400 bg-surface-50 px-2 py-0.5 rounded">{typeLabel}</span>
            <StatusBadge status={item.status} />
            {hasThread && (
              <button onClick={() => onThread(item)}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full text-[10px] font-medium hover:bg-violet-100 transition-colors">
                <GitBranch className="w-3 h-3" />
                {Number(item.reply_count) > 0 ? `${item.reply_count} respuesta${Number(item.reply_count)>1?'s':''}` : 'En hilo'}
              </button>
            )}
          </div>
          <p className="text-sm font-semibold text-brand-900 truncate">{item.subject}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-surface-400">
            {item.recipient_entity && <span className="flex items-center gap-1"><ChevronRight className="w-3 h-3" />{item.recipient_entity}</span>}
            {item.recipient_name   && <span>{item.recipient_name}</span>}
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDate(item.reference_date)}</span>
            {item.radicado_number  && <span className="text-blue-600 font-medium">Rad: {item.radicado_number}</span>}
          </div>
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {perms?.canEdit && (
            <button onClick={() => onReply(item)} title="Crear respuesta/seguimiento"
              className="flex items-center gap-1 px-2 py-1 bg-teal-50 text-teal-700 border border-teal-200 rounded-lg text-xs font-medium hover:bg-teal-100 transition-colors">
              <Reply className="w-3 h-3" />Responder
            </button>
          )}
          {perms?.canEdit && (
            <button onClick={() => onSign(item)} title="Firmas digitales"
              className={`flex items-center gap-1 px-2 py-1 rounded-lg border text-xs font-medium transition-colors ${sigCls}`}>
              <PenLine className="w-3 h-3" />{sigLabel}
            </button>
          )}
          <button onClick={() => onPreview(item)} title="Vista previa"
            className="p-1.5 hover:bg-brand-50 rounded-lg transition-colors text-surface-400 hover:text-brand-600">
            <Eye className="w-4 h-4" />
          </button>
          {perms?.canEdit && <button onClick={() => onEdit(item)} title="Editar" className="p-1.5 hover:bg-brand-50 rounded-lg transition-colors text-surface-400 hover:text-brand-600"><Pencil className="w-4 h-4" /></button>}
          {perms?.canEdit && <button onClick={() => onDelete(item.id)} disabled={deleting === item.id} title="Eliminar" className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-surface-400 hover:text-red-500 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>}
        </div>
      </div>
    </div>
  );
}

// ─── Card de item ENTRADA ─────────────────────────────────────────────────────
function AttachmentPreviewModal({ preview, onClose }) {
  if (!preview) return null;
  return (
    <div className="fixed inset-0 bg-black/70 z-[60] flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl flex flex-col w-full max-w-4xl max-h-[90vh] overflow-hidden" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-4 py-3 border-b border-surface-100 flex-shrink-0">
          <span className="text-sm font-medium text-surface-700 truncate">{preview.name}</span>
          <div className="flex items-center gap-2">
            <a href={preview.url} download={preview.name}
              className="text-xs text-brand-600 hover:underline flex items-center gap-1">
              <Download className="w-3.5 h-3.5" />Descargar
            </a>
            <button onClick={onClose} className="p-1.5 hover:bg-surface-100 rounded-lg">
              <X className="w-4 h-4 text-surface-500" />
            </button>
          </div>
        </div>
        {preview.mime?.startsWith('image/') ? (
          <img src={preview.url} alt={preview.name} className="object-contain max-h-[80vh] p-4" />
        ) : (
          <iframe src={preview.url} title={preview.name} className="flex-1 w-full" style={{ minHeight: '70vh' }} />
        )}
      </div>
    </div>
  );
}

function EntradaCard({ item, perms, projectId, onEdit, onDelete, onThread, onReply, onAssign, deleting }) {
  const hasThread = Number(item.reply_count) > 0 || !!item.parent_id;
  const [attachments, setAttachments] = useState([]);
  const [preview, setPreview]         = useState(null);

  useEffect(() => {
    if (!item.id) return;
    correspondenceAPI.listAttachments(projectId, item.id)
      .then(r => setAttachments(r.data?.data || []))
      .catch(() => setAttachments([]));
  }, [item.id, projectId]);

  const openPreview = (att) => {
    correspondenceAPI.downloadAttachmentById(projectId, item.id, att.id)
      .then(r => {
        const ext  = (att.original_name || '').split('.').pop().toLowerCase();
        const mime = att.mime_type || (ext === 'pdf' ? 'application/pdf' : ['png','jpg','jpeg','gif','webp'].includes(ext) ? `image/${ext}` : 'application/octet-stream');
        setPreview({ url: URL.createObjectURL(new Blob([r.data], { type: mime })), name: att.original_name, mime });
      }).catch(() => {});
  };

  const closePreview = () => { if (preview) { URL.revokeObjectURL(preview.url); setPreview(null); } };

  return (
    <div className="group bg-white border border-surface-100 rounded-xl hover:border-teal-200 hover:shadow-sm transition-all">
      <div className="flex items-start gap-4 p-4">
        <div className="w-9 h-9 rounded-xl bg-teal-50 flex items-center justify-center flex-shrink-0 mt-0.5">
          <ArrowDownLeft className="w-4 h-4 text-teal-600" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className="font-mono text-xs text-teal-700 font-semibold bg-teal-50 px-2 py-0.5 rounded">{item.consecutive_code}</span>
            <StatusBadge status={item.status} />
            {hasThread && (
              <button onClick={() => onThread(item)}
                className="inline-flex items-center gap-1 px-2 py-0.5 bg-violet-50 text-violet-700 rounded-full text-[10px] font-medium hover:bg-violet-100 transition-colors">
                <GitBranch className="w-3 h-3" />
                {Number(item.reply_count) > 0 ? `${item.reply_count} respuesta${Number(item.reply_count)>1?'s':''}` : 'En hilo'}
              </button>
            )}
          </div>
          <p className="text-sm font-semibold text-brand-900 truncate">{item.subject}</p>
          <div className="flex items-center gap-3 mt-1 flex-wrap text-xs text-surface-400">
            {item.sender_entity_external && <span className="flex items-center gap-1"><ArrowDownLeft className="w-3 h-3" />{item.sender_entity_external}</span>}
            {item.sender_name_external   && <span>{item.sender_name_external}</span>}
            <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{fmtDate(item.received_date || item.reference_date)}</span>
            {item.radicado_number && <span className="text-teal-600 font-medium">Rad: {item.radicado_number}</span>}
            {item.assigned_to_name && (
              <span className="flex items-center gap-1 text-amber-600">
                <UserCheck className="w-3 h-3" />{item.assigned_to_name}
              </span>
            )}
          </div>
          {/* Adjuntos — solo contador */}
          {attachments.length > 0 && (
            <div className="mt-2">
              <button onClick={() => openPreview(attachments[0])}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-50 border border-surface-200 rounded-full text-xs text-surface-500 hover:text-brand-600 hover:border-brand-300 transition-colors">
                <Paperclip className="w-3 h-3 flex-shrink-0" />
                {attachments.length} adjunto{attachments.length !== 1 ? 's' : ''}
              </button>
            </div>
          )}
          {/* Adjunto legacy — contador */}
          {attachments.length === 0 && item.attachment_original_name && (
            <div className="mt-2">
              <button onClick={() => {
                  api.get(`/exec/${projectId}/correspondence/${item.id}/attachment`, { responseType: 'blob' })
                    .then(r => {
                      const ext  = (item.attachment_original_name || '').split('.').pop().toLowerCase();
                      const mime = ext === 'pdf' ? 'application/pdf' : ['png','jpg','jpeg'].includes(ext) ? `image/${ext}` : 'application/octet-stream';
                      setPreview({ url: URL.createObjectURL(new Blob([r.data], { type: mime })), name: item.attachment_original_name, mime });
                    }).catch(() => {});
                }}
                className="inline-flex items-center gap-1.5 px-2.5 py-1 bg-surface-50 border border-surface-200 rounded-full text-xs text-surface-500 hover:text-brand-600 hover:border-brand-300 transition-colors">
                <Paperclip className="w-3 h-3 flex-shrink-0" />1 adjunto
              </button>
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
          {/* Hilo */}
          {(hasThread) && (
            <button onClick={() => onThread(item)} title="Ver hilo"
              className="p-1.5 hover:bg-violet-50 rounded-lg transition-colors text-surface-400 hover:text-violet-600">
              <GitBranch className="w-4 h-4" />
            </button>
          )}
          {/* Responder con oficio de salida */}
          {perms?.canEdit && (
            <button onClick={() => onReply(item)} title="Responder con oficio"
              className="flex items-center gap-1 px-2 py-1 bg-brand-50 text-brand-700 border border-brand-200 rounded-lg text-xs font-medium hover:bg-brand-100 transition-colors">
              <Reply className="w-3 h-3" />Responder
            </button>
          )}
          {perms?.canEdit && <button onClick={() => onEdit(item)} title="Editar" className="p-1.5 hover:bg-brand-50 rounded-lg transition-colors text-surface-400 hover:text-brand-600"><Pencil className="w-4 h-4" /></button>}
          {perms?.canEdit && <button onClick={() => onDelete(item.id)} disabled={deleting === item.id} title="Eliminar" className="p-1.5 hover:bg-red-50 rounded-lg transition-colors text-surface-400 hover:text-red-500 disabled:opacity-50"><Trash2 className="w-4 h-4" /></button>}
        </div>
      </div>
      <AttachmentPreviewModal preview={preview} onClose={closePreview} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
// PANEL PRINCIPAL
// ═══════════════════════════════════════════════════════════════════════════════
export default function CorrespondencePanel({ projectId, perms }) {
  // Tabs: 'salida' | 'entrada' | 'firmas'
  const [activeTab, setActiveTab] = useState('salida');

  // Datos
  const [items, setItems]           = useState([]);
  const [loading, setLoading]       = useState(true);
  const [teamMembers, setTeamMembers] = useState([]);

  // Filtros
  const [search, setSearch]           = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Modales salida
  const [showSalidaForm, setShowSalidaForm]   = useState(false);
  const [editSalidaItem, setEditSalidaItem]   = useState(null);
  const [replyToItem, setReplyToItem]         = useState(null); // item entrada al que respondemos
  const [previewItem, setPreviewItem]         = useState(null);
  const [sigModal, setSigModal]               = useState(null);
  const [corrSigStatuses, setCorrSigStatuses] = useState({});

  // Modales entrada
  const [showEntradaForm, setShowEntradaForm] = useState(false);
  const [editEntradaItem, setEditEntradaItem] = useState(null);
  const [replyEntradaTo, setReplyEntradaTo]   = useState(null); // item salida al que llega respuesta

  // Thread modal
  const [threadItem, setThreadItem] = useState(null);

  // Firmas libres
  const [freeRequests, setFreeRequests]   = useState([]);
  const [freeLoading, setFreeLoading]     = useState(false);
  const [freeError, setFreeError]         = useState('');
  const [showFirmaModal, setShowFirmaModal] = useState(false);
  const [traceReq, setTraceReq]           = useState(null);

  // Delete
  const [deleting, setDeleting] = useState(null);

  // Inbox status (para botón sincronizar rápido)
  const [inboxEnabled, setInboxEnabled]   = useState(false);
  const [inboxLastSync, setInboxLastSync] = useState(null);
  const [syncing, setSyncing]             = useState(false);

  const loadInboxStatus = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await emailInboxAPI.get(projectId);
      const d = r.data?.data;
      setInboxEnabled(!!(d?.enabled));
      setInboxLastSync(d?.last_polled_at || null);
    } catch { setInboxEnabled(false); setInboxLastSync(null); }
  }, [projectId]);

  const handleQuickSync = async () => {
    setSyncing(true);
    try { await emailInboxAPI.sync(projectId); await load(); }
    catch { }
    finally { setSyncing(false); }
  };

  // ── Carga datos ────────────────────────────────────────────────────────────
  const load = useCallback(async () => {
    if (!projectId) return;
    setLoading(true);
    try {
      const r    = await correspondenceAPI.list(projectId);
      const data = r.data.data || [];
      setItems(data);
      if (data.length > 0) {
        const salida = data.filter(c => c.direction !== 'entrada');
        if (salida.length > 0) {
          const statuses = await corrSignaturesAPI.batchStatus(projectId, salida.map(c => c.id));
          setCorrSigStatuses(statuses);
        }
      }
    } catch { setItems([]); }
    finally { setLoading(false); }
  }, [projectId]);

  const loadTeam = useCallback(async () => {
    if (!projectId) return;
    try {
      const r = await api.get(`/exec/${projectId}/team`);
      setTeamMembers(r.data.data || r.data || []);
    } catch { setTeamMembers([]); }
  }, [projectId]);

  const loadFreeRequests = useCallback(async () => {
    if (!projectId) return;
    setFreeLoading(true); setFreeError('');
    try {
      const r = await freeSignaturesAPI.list(projectId);
      setFreeRequests(r.data || []);
    } catch (e) {
      setFreeError(e.response?.data?.error || e.message || 'Error al cargar procesos de firma');
      setFreeRequests([]);
    }
    finally { setFreeLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); loadTeam(); loadInboxStatus(); }, [load, loadTeam, loadInboxStatus]);
  useEffect(() => { if (activeTab === 'firmas') loadFreeRequests(); }, [activeTab, loadFreeRequests]);

  // ── Delete ─────────────────────────────────────────────────────────────────
  const handleDelete = async (id) => {
    if (!window.confirm('¿Eliminar esta correspondencia?')) return;
    setDeleting(id);
    try { await correspondenceAPI.remove(projectId, id); load(); }
    catch { /* ignore */ }
    finally { setDeleting(null); }
  };

  // ── Datos filtrados por tab ────────────────────────────────────────────────
  const salida  = items.filter(c => c.direction !== 'entrada');
  const entrada = items.filter(c => c.direction === 'entrada');

  const filterList = (list, statusCfg) => list.filter(c => {
    const q = search.toLowerCase();
    const matchSearch = !q || c.consecutive_code?.toLowerCase().includes(q)
      || c.subject?.toLowerCase().includes(q)
      || c.sender_entity_external?.toLowerCase().includes(q)
      || c.recipient_entity?.toLowerCase().includes(q)
      || c.sender_name_external?.toLowerCase().includes(q);
    const matchStatus = !filterStatus || c.status === filterStatus;
    return matchSearch && matchStatus;
  });

  const filteredSalida  = filterList(salida,  STATUS_SALIDA);
  const filteredEntrada = filterList(entrada, STATUS_ENTRADA);

  // Conteos
  const countsSalida  = salida.reduce((a, c)  => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});
  const countsEntrada = entrada.reduce((a, c) => { a[c.status] = (a[c.status] || 0) + 1; return a; }, {});

  if (loading) return (
    <div className="flex items-center justify-center h-40">
      <div className="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
    </div>
  );

  return (
    <div className="space-y-4">
      {/* ── Tab switcher ── */}
      <div className="flex gap-1 p-1 bg-surface-100 rounded-xl w-fit">
        {[
          { id: 'salida',  label: 'Salida',             icon: ArrowUpRight,  count: salida.length },
          { id: 'entrada', label: 'Entrada',             icon: ArrowDownLeft, count: entrada.length },
          { id: 'firmas',  label: 'Firma de documentos', icon: Shield,        count: null },
        ].map(({ id, label, icon: Icon, count }) => (
          <button key={id} onClick={() => { setActiveTab(id); setSearch(''); setFilterStatus(''); }}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors
              ${activeTab === id ? 'bg-white shadow-sm text-brand-700' : 'text-surface-500 hover:text-surface-700'}`}>
            <Icon className="w-4 h-4" />{label}
            {count !== null && count > 0 && (
              <span className={`text-xs px-1.5 py-0.5 rounded-full font-semibold
                ${activeTab === id
                  ? id === 'entrada' ? 'bg-teal-100 text-teal-700' : 'bg-brand-100 text-brand-700'
                  : 'bg-surface-200 text-surface-500'}`}>
                {count}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* ════════════ TAB: SALIDA ════════════ */}
      {activeTab === 'salida' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-brand-900 flex items-center gap-2">
                <ArrowUpRight className="w-5 h-5 text-brand-600" />Correspondencia de Salida
              </h3>
              <p className="text-xs text-surface-400 mt-0.5">Oficios, cartas y comunicaciones que enviamos</p>
            </div>
            {perms?.canEdit && (
              <button onClick={() => { setEditSalidaItem(null); setReplyToItem(null); setShowSalidaForm(true); }}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 shadow-sm transition-colors">
                <Plus className="w-4 h-4" />Nueva
              </button>
            )}
          </div>

          {/* Resumen estados salida */}
          {salida.length > 0 && (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2">
              {Object.entries(STATUS_SALIDA).map(([status, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button key={status} onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
                    className={`flex flex-col items-center p-2 rounded-xl border transition-all text-center
                      ${filterStatus === status ? 'border-brand-400 bg-brand-50' : 'border-surface-100 bg-white hover:bg-surface-50'}`}>
                    <Icon className={`w-4 h-4 mb-1 ${filterStatus === status ? 'text-brand-600' : 'text-surface-400'}`} />
                    <span className="text-lg font-bold text-brand-900">{countsSalida[status] || 0}</span>
                    <span className="text-[10px] text-surface-500">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Buscador */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-300" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por asunto, código, entidad..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none" />
          </div>

          {/* Lista salida */}
          {filteredSalida.length === 0 ? (
            <div className="text-center py-16 bg-surface-50 rounded-2xl border-2 border-dashed border-surface-200">
              <ArrowUpRight className="w-10 h-10 text-surface-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-surface-400">
                {salida.length === 0 ? 'No hay correspondencia de salida' : 'No hay resultados para los filtros'}
              </p>
              {salida.length === 0 && perms?.canEdit && (
                <button onClick={() => { setEditSalidaItem(null); setReplyToItem(null); setShowSalidaForm(true); }}
                  className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white text-sm font-medium rounded-xl hover:bg-brand-700 mx-auto transition-colors">
                  <Plus className="w-4 h-4" />Crear primera comunicación
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredSalida.map(item => (
                <SalidaCard key={item.id} item={item} perms={perms} projectId={projectId}
                  sigStatus={corrSigStatuses[item.id]}
                  deleting={deleting}
                  onEdit={i  => { setEditSalidaItem(i); setReplyToItem(null); setShowSalidaForm(true); }}
                  onDelete={handleDelete}
                  onPreview={i => setPreviewItem(i)}
                  onSign={i  => setSigModal(i)}
                  onThread={i => setThreadItem(i)}
                  onReply={i  => { setReplyToItem(null); setEditSalidaItem(null); setShowSalidaForm(false);
                                   // Abrir formulario entrada como respuesta a este item de salida
                                   setReplyEntradaTo(i); setEditEntradaItem(null); setShowEntradaForm(true); }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════════ TAB: ENTRADA ════════════ */}
      {activeTab === 'entrada' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-base font-semibold text-brand-900 flex items-center gap-2">
                <ArrowDownLeft className="w-5 h-5 text-teal-600" />Correspondencia de Entrada
              </h3>
              <p className="text-xs text-surface-400 mt-0.5">Comunicaciones recibidas de terceros</p>
            </div>
            <div className="flex items-center gap-2">
              {/* Sincronizar rápido — visible cuando la bandeja está activa */}
              {inboxEnabled && (
                <button onClick={handleQuickSync} disabled={syncing}
                  title="Sincronizar correos ahora"
                  className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium rounded-xl border border-surface-200 bg-white text-surface-500 hover:text-teal-700 hover:border-teal-300 disabled:opacity-50 transition-colors">
                  <RotateCcw className={`w-4 h-4 ${syncing ? 'animate-spin' : ''}`} />
                  <span className="hidden sm:inline">{syncing ? 'Sincronizando...' : 'Sincronizar'}</span>
                </button>
              )}
              {perms?.canEdit && (
                <button onClick={() => { setEditEntradaItem(null); setReplyEntradaTo(null); setShowEntradaForm(true); }}
                  className="flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 shadow-sm transition-colors">
                  <Plus className="w-4 h-4" />Radicar
                </button>
              )}
            </div>
          </div>

          {/* ── Status bar compacto cuando la bandeja está activa ── */}
          {inboxEnabled && (
            <div className="flex items-center gap-3 px-4 py-2.5 bg-teal-50 border border-teal-100 rounded-xl text-sm">
              <span className="w-2 h-2 rounded-full bg-teal-500 flex-shrink-0 animate-pulse" />
              <span className="text-teal-700 font-medium">Bandeja activa</span>
              {inboxLastSync && (
                <span className="text-teal-500 text-xs">
                  · Última sincronización: {new Date(inboxLastSync).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}

          {/* Resumen estados entrada */}
          {entrada.length > 0 && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {Object.entries(STATUS_ENTRADA).map(([status, cfg]) => {
                const Icon = cfg.icon;
                return (
                  <button key={status} onClick={() => setFilterStatus(filterStatus === status ? '' : status)}
                    className={`flex flex-col items-center p-2 rounded-xl border transition-all text-center
                      ${filterStatus === status ? 'border-teal-400 bg-teal-50' : 'border-surface-100 bg-white hover:bg-surface-50'}`}>
                    <Icon className={`w-4 h-4 mb-1 ${filterStatus === status ? 'text-teal-600' : 'text-surface-400'}`} />
                    <span className="text-lg font-bold text-brand-900">{countsEntrada[status] || 0}</span>
                    <span className="text-[10px] text-surface-500">{cfg.label}</span>
                  </button>
                );
              })}
            </div>
          )}

          {/* Buscador */}
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-300" />
            <input value={search} onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por asunto, código, entidad remitente..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-brand-500 outline-none" />
          </div>

          {/* Lista entrada */}
          {filteredEntrada.length === 0 ? (
            <div className="text-center py-16 bg-surface-50 rounded-2xl border-2 border-dashed border-surface-200">
              <Inbox className="w-10 h-10 text-surface-300 mx-auto mb-3" />
              <p className="text-sm font-medium text-surface-400">
                {entrada.length === 0 ? 'No hay correspondencia de entrada registrada' : 'No hay resultados para los filtros'}
              </p>
              {entrada.length === 0 && perms?.canEdit && (
                <button onClick={() => { setEditEntradaItem(null); setReplyEntradaTo(null); setShowEntradaForm(true); }}
                  className="mt-4 flex items-center gap-1.5 px-4 py-2 bg-teal-600 text-white text-sm font-medium rounded-xl hover:bg-teal-700 mx-auto transition-colors">
                  <Plus className="w-4 h-4" />Radicar primera comunicación
                </button>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              {filteredEntrada.map(item => (
                <EntradaCard key={item.id} item={item} perms={perms} projectId={projectId}
                  deleting={deleting}
                  onEdit={i  => { setEditEntradaItem(i); setReplyEntradaTo(null); setShowEntradaForm(true); }}
                  onDelete={handleDelete}
                  onThread={i => setThreadItem(i)}
                  onReply={i  => {
                    // Responder con oficio de salida vinculado
                    setEditSalidaItem(null);
                    setReplyToItem(i);
                    setShowEntradaForm(false);
                    setShowSalidaForm(true);
                  }}
                  onAssign={i => {
                    const userId = window.prompt('ID del responsable (se asignará automáticamente):');
                    if (userId) correspondenceAPI.assign(projectId, i.id, userId).then(load).catch(() => {});
                  }}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* ════════════ TAB: FIRMAS ════════════ */}
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

          {!freeLoading && freeRequests.length > 0 && (() => {
            const fc = freeRequests.reduce((a, r) => { a[r.status] = (a[r.status] || 0) + 1; return a; }, {});
            return (
              <div className="grid grid-cols-4 gap-3">
                {[{ key: 'in_progress', label: 'En proceso', cls: 'text-blue-600' }, { key: 'completed', label: 'Completados', cls: 'text-emerald-600' }, { key: 'rejected', label: 'Rechazados', cls: 'text-red-500' }, { key: 'cancelled', label: 'Cancelados', cls: 'text-surface-400' }].map(({ key, label, cls }) => (
                  <div key={key} className="bg-white border border-surface-100 rounded-xl p-3 text-center shadow-sm">
                    <p className={`text-2xl font-bold ${cls}`}>{fc[key] || 0}</p>
                    <p className="text-xs text-surface-400 mt-0.5">{label}</p>
                  </div>
                ))}
              </div>
            );
          })()}

          {freeLoading ? (
            <div className="flex items-center justify-center h-32"><Loader2 className="w-5 h-5 animate-spin text-brand-400" /></div>
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
                        <span className={`inline-flex items-center px-1.5 py-0.5 rounded-full text-[10px] font-medium ${statusCfg.cls}`}>{statusCfg.label}</span>
                        <span className="text-xs text-surface-400">{req.signed_count}/{req.total_signers} firmantes</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <button onClick={async () => { try { const r = await freeSignaturesAPI.get(projectId, req.id); setTraceReq({ req, detail: r.data }); } catch {} }}
                        className="flex items-center gap-1 px-2 py-1 bg-surface-50 text-surface-600 border border-surface-200 rounded-lg text-xs font-medium hover:bg-surface-100 transition-colors">
                        <Activity className="w-3 h-3" />Trazabilidad
                      </button>
                      {req.status === 'completed' && (
                        <button onClick={async () => { try { const r = await freeSignaturesAPI.downloadPdf(projectId, req.id); const blob = new Blob([r.data], { type: 'application/pdf' }); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = `firmado_${req.file_name || req.title}.pdf`; a.click(); URL.revokeObjectURL(url); } catch { alert('Error al descargar'); } }}
                          className="flex items-center gap-1 px-2 py-1 bg-emerald-50 text-emerald-700 border border-emerald-200 rounded-lg text-xs font-medium hover:bg-emerald-100 transition-colors">
                          <Download className="w-3 h-3" />PDF firmado
                        </button>
                      )}
                      {req.status === 'in_progress' && perms?.canEdit && (
                        <button title="Cancelar firma" onClick={async () => { if (!window.confirm('¿Cancelar este proceso de firma?')) return; await freeSignaturesAPI.cancel(projectId, req.id); loadFreeRequests(); }}
                          className="p-1.5 hover:bg-red-50 text-surface-400 hover:text-red-500 rounded-lg transition-colors"><Ban className="w-4 h-4" /></button>
                      )}
                      {perms?.canEdit && (
                        <button title="Eliminar permanentemente" onClick={async () => { if (!window.confirm('¿Eliminar permanentemente?')) return; try { await freeSignaturesAPI.eliminate(projectId, req.id); loadFreeRequests(); } catch { alert('Error al eliminar'); } }}
                          className="p-1.5 hover:bg-red-50 text-surface-400 hover:text-red-600 rounded-lg transition-colors"><Trash2 className="w-4 h-4" /></button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ── Modales ─────────────────────────────────────────────────────────── */}

      {/* Formulario SALIDA */}
      {showSalidaForm && (
        <FormModal
          projectId={projectId}
          initial={editSalidaItem}
          replyTo={replyToItem}
          onClose={() => { setShowSalidaForm(false); setEditSalidaItem(null); setReplyToItem(null); }}
          onSaved={() => { setShowSalidaForm(false); setEditSalidaItem(null); setReplyToItem(null); load(); }}
        />
      )}

      {/* Formulario ENTRADA (radicar) */}
      {showEntradaForm && (
        <RadicarModal
          projectId={projectId}
          initial={editEntradaItem}
          replyTo={replyEntradaTo}
          teamMembers={teamMembers}
          onClose={() => { setShowEntradaForm(false); setEditEntradaItem(null); setReplyEntradaTo(null); }}
          onSaved={() => { setShowEntradaForm(false); setEditEntradaItem(null); setReplyEntradaTo(null); load(); }}
        />
      )}

      {/* Vista previa salida */}
      {previewItem && (
        <PreviewModal projectId={projectId} record={previewItem} onClose={() => setPreviewItem(null)} />
      )}

      {/* Firmas digitales */}
      {sigModal && (
        <CorrSignatureModal
          projectId={projectId}
          corrItem={sigModal}
          existingRequest={corrSigStatuses[sigModal.id] || null}
          onClose={() => setSigModal(null)}
          onChanged={() => { setSigModal(null); load(); }}
        />
      )}

      {/* Firma libre */}
      {showFirmaModal && (
        <FirmaLibreModal
          projectId={projectId}
          onClose={() => setShowFirmaModal(false)}
          onCreated={() => { setShowFirmaModal(false); loadFreeRequests(); }}
        />
      )}

      {/* Hilo */}
      {threadItem && (
        <ThreadModal projectId={projectId} item={threadItem} onClose={() => setThreadItem(null)} />
      )}

      {/* Trazabilidad firma libre */}
      {traceReq && (() => {
        const { req, detail } = traceReq;
        const signers = detail?.signers || [];
        const fmt = d => d ? new Date(d).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null;
        const events = [];
        events.push({ icon: '🚀', label: 'Proceso de firmas iniciado', sub: `por ${detail?.created_by_name || 'Sistema'}`, time: fmt(detail?.created_at), color: 'blue' });
        for (const s of signers) {
          if (['notified','viewed','signed','rejected'].includes(s.status)) events.push({ icon: '✉️', label: `Correo enviado a ${s.signer_name}`, sub: s.signer_email, time: fmt(s.created_at), color: 'indigo' });
          if (['viewed','signed','rejected'].includes(s.status)) events.push({ icon: '👁️', label: `Enlace abierto por ${s.signer_name}`, sub: null, time: null, color: 'yellow' });
          if (s.status === 'signed') events.push({ icon: '✍️', label: `Documento firmado por ${s.signer_name}`, sub: `${s.signer_email} · IP: ${s.ip_address || '—'}`, time: fmt(s.signed_at), color: 'green' });
          if (s.status === 'rejected') events.push({ icon: '✗', label: `Firma rechazada por ${s.signer_name}`, sub: s.rejection_reason || '—', time: fmt(s.signed_at), color: 'red' });
        }
        if (req.status === 'completed') events.push({ icon: '✅', label: 'Proceso completado — todos firmaron', sub: null, time: fmt(detail?.completed_at), color: 'emerald' });
        const colorMap = { blue:'bg-blue-100 text-blue-600', indigo:'bg-indigo-100 text-indigo-600', yellow:'bg-amber-100 text-amber-600', green:'bg-emerald-100 text-emerald-600', red:'bg-red-100 text-red-600', emerald:'bg-emerald-500 text-white' };
        return (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[85vh]">
              <div className="flex items-center justify-between p-5 border-b border-surface-100">
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 bg-brand-100 rounded-xl flex items-center justify-center"><Shield className="w-4 h-4 text-brand-600" /></div>
                  <div><p className="font-semibold text-surface-900 text-sm">Firmas Digitales</p><p className="text-xs text-surface-400 truncate max-w-56">{req.title}</p></div>
                </div>
                <button onClick={() => setTraceReq(null)} className="p-2 hover:bg-surface-100 rounded-lg transition-colors"><X className="w-4 h-4 text-surface-400" /></button>
              </div>
              <div className="px-5 pt-4">
                <div className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium mb-3 ${{ in_progress:'bg-blue-100 text-blue-700', completed:'bg-emerald-100 text-emerald-700', rejected:'bg-red-100 text-red-700', cancelled:'bg-surface-100 text-surface-500' }[req.status]}`}>
                  {req.status === 'completed' ? '✓ Completado' : req.status === 'in_progress' ? '● En proceso' : req.status}
                  <span className="ml-1 opacity-70">{req.signed_count}/{req.total_signers} firmantes</span>
                </div>
                {req.total_signers > 0 && (
                  <div className="w-full h-1.5 bg-surface-100 rounded-full mb-1 overflow-hidden">
                    <div className="h-full bg-emerald-500 rounded-full transition-all" style={{ width: `${(req.signed_count / req.total_signers) * 100}%` }} />
                  </div>
                )}
              </div>
              <div className="flex-1 overflow-y-auto px-5 pb-5">
                <div className="space-y-3 mt-4">
                  {events.map((ev, i) => (
                    <div key={i} className="flex gap-3">
                      <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs flex-shrink-0 ${colorMap[ev.color] || 'bg-surface-100 text-surface-500'}`}>{ev.icon}</div>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-surface-800">{ev.label}</p>
                        {ev.sub  && <p className="text-xs text-surface-400 truncate">{ev.sub}</p>}
                        {ev.time && <p className="text-xs text-surface-300 mt-0.5">{ev.time}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        );
      })()}

    </div>
  );
}
