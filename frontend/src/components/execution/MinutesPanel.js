import React, { useState, useEffect, useCallback, useRef } from 'react';
import { minutesAPI, exportsAPI, signaturesAPI } from '../../services/api';
import { Plus, Edit2, Trash2, X, Save, Loader2, FileText, Users, CheckSquare, Check, Square, Download, Upload, Sparkles, Wand2, ChevronDown, PenLine, Shield, UserPlus, AlertTriangle } from 'lucide-react';

const MT = { comite_obra: 'Comité de obra', comite_seguimiento: 'Comité seguimiento', reunion_tecnica: 'Reunión técnica', reunion_financiera: 'Reunión financiera', otro: 'Otro' };
const MS = { borrador: { l: 'Borrador', bg: 'bg-amber-100', t: 'text-amber-700' }, firmada: { l: 'Firmada', bg: 'bg-emerald-100', t: 'text-emerald-700' }, archivada: { l: 'Archivada', bg: 'bg-slate-100', t: 'text-slate-600' } };

// Parse JSON safely - handles string, array, null, object
function safeArr(v) {
  if (Array.isArray(v)) return v;
  if (!v) return [];
  if (typeof v === 'string') { try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; } }
  return [];
}

// ═══════════════════════════════════════
// Minute Modal (create / edit / AI prefill)
// ═══════════════════════════════════════
function MinuteModal({ item, prefill, projectId, onClose, onSaved }) {
  const isEdit = Boolean(item?.id);
  const src = prefill || item || {};

  const [form, setForm] = useState({
    title: src.title || '',
    minute_type: src.minute_type || 'comite_seguimiento',
    meeting_date: (src.meeting_date || '').split('T')[0] || new Date().toISOString().split('T')[0],
    location: src.location || '',
    agenda: src.agenda || '',
    discussions: src.discussions || '',
    next_meeting_date: (src.next_meeting_date || '').split('T')[0] || '',
    status: src.status || 'borrador',
  });

  const [attendees, setAttendees] = useState(safeArr(src.attendees));
  const [agreements, setAgreements] = useState(safeArr(src.agreements));
  const [actionItems, setActionItems] = useState(safeArr(src.action_items));
  const [newAtt, setNewAtt] = useState('');
  const [newAgr, setNewAgr] = useState('');
  const [newAI, setNewAI] = useState({ task: '', responsible: '', due_date: '' });
  const [saving, setSaving] = useState(false);

  const set = f => e => setForm(d => ({ ...d, [f]: e.target.value }));
  const addAtt = () => { if (newAtt.trim()) { setAttendees([...attendees, newAtt.trim()]); setNewAtt(''); } };
  const addAgr = () => { if (newAgr.trim()) { setAgreements([...agreements, newAgr.trim()]); setNewAgr(''); } };
  const addAI = () => { if (newAI.task.trim()) { setActionItems([...actionItems, { ...newAI }]); setNewAI({ task: '', responsible: '', due_date: '' }); } };

  const handle = async e => {
    e.preventDefault(); setSaving(true);
    try {
      const data = { ...form, attendees, agreements, action_items: actionItems };
      if (isEdit) await minutesAPI.update(projectId, item.id, data);
      else await minutesAPI.create(projectId, data);
      onSaved();
    } catch (err) { alert(err.response?.data?.error || 'Error'); }
    finally { setSaving(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <div className="flex items-center gap-2">
            <h3 className="font-display font-bold text-brand-900">{isEdit ? 'Editar' : prefill ? 'Revisar y Guardar' : 'Nueva'} Acta</h3>
            {prefill && <span className="px-2 py-0.5 bg-violet-100 text-violet-700 text-[10px] font-semibold rounded-full">Generada con IA</span>}
          </div>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400" /></button>
        </div>
        <form onSubmit={handle} className="p-5 space-y-3">
          {prefill && (
            <div className="p-2.5 bg-violet-50 border border-violet-100 rounded-lg text-xs text-violet-700">
              Revise los datos extraídos por la IA. Puede editar cualquier campo antes de guardar.
            </div>
          )}
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2"><label className="block text-xs font-medium text-brand-800 mb-1">Título *</label><input value={form.title} onChange={set('title')} required className="input-field text-sm" /></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Tipo</label><select value={form.minute_type} onChange={set('minute_type')} className="input-field text-sm">{Object.entries(MT).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Fecha *</label><input type="date" value={form.meeting_date} onChange={set('meeting_date')} required className="input-field text-sm" /></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Lugar</label><input value={form.location} onChange={set('location')} className="input-field text-sm" /></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Próx. reunión</label><input type="date" value={form.next_meeting_date} onChange={set('next_meeting_date')} className="input-field text-sm" /></div>
          </div>

          {/* Attendees */}
          <div className="p-3 bg-blue-50 rounded-lg space-y-2">
            <p className="text-xs font-semibold text-blue-800 flex items-center gap-1"><Users className="w-3 h-3" /> Asistentes ({attendees.length})</p>
            <div className="flex flex-wrap gap-1">{attendees.map((a, i) => <span key={i} className="inline-flex items-center gap-1 px-2 py-0.5 bg-white rounded text-xs text-blue-800">{typeof a === 'string' ? a : a.name || JSON.stringify(a)}<button type="button" onClick={() => setAttendees(attendees.filter((_, j) => j !== i))} className="text-blue-400 hover:text-red-500">×</button></span>)}</div>
            <div className="flex gap-1"><input value={newAtt} onChange={e => setNewAtt(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addAtt())} className="input-field text-xs flex-1" placeholder="Nombre..." /><button type="button" onClick={addAtt} className="px-2 py-1 bg-blue-600 text-white rounded text-xs">+</button></div>
          </div>

          <div><label className="block text-xs font-medium text-brand-800 mb-1">Agenda</label><textarea value={form.agenda} onChange={set('agenda')} className="input-field text-sm min-h-[50px] resize-y" /></div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Discusiones</label><textarea value={form.discussions} onChange={set('discussions')} className="input-field text-sm min-h-[80px] resize-y" /></div>

          {/* Agreements */}
          <div className="p-3 bg-emerald-50 rounded-lg space-y-2">
            <p className="text-xs font-semibold text-emerald-800 flex items-center gap-1"><CheckSquare className="w-3 h-3" /> Acuerdos ({agreements.length})</p>
            <div className="space-y-1">{agreements.map((a, i) => <div key={i} className="flex items-center gap-1 text-xs text-emerald-800"><span className="flex-1 bg-white px-2 py-1 rounded">{typeof a === 'string' ? a : JSON.stringify(a)}</span><button type="button" onClick={() => setAgreements(agreements.filter((_, j) => j !== i))} className="text-red-400 hover:text-red-600 text-sm">×</button></div>)}</div>
            <div className="flex gap-1"><input value={newAgr} onChange={e => setNewAgr(e.target.value)} onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addAgr())} className="input-field text-xs flex-1" placeholder="Nuevo acuerdo..." /><button type="button" onClick={addAgr} className="px-2 py-1 bg-emerald-600 text-white rounded text-xs">+</button></div>
          </div>

          {/* Action Items */}
          <div className="p-3 bg-amber-50 rounded-lg space-y-2">
            <p className="text-xs font-semibold text-amber-800">Compromisos ({actionItems.length})</p>
            <div className="space-y-1">{actionItems.map((a, i) => <div key={i} className="flex items-center gap-2 text-xs bg-white p-2 rounded"><span className="flex-1 font-medium">{a.task}</span>{a.responsible && <span className="text-surface-400">{a.responsible}</span>}{a.due_date && <span className="text-surface-400">{a.due_date}</span>}<button type="button" onClick={() => setActionItems(actionItems.filter((_, j) => j !== i))} className="text-red-400">×</button></div>)}</div>
            <div className="grid grid-cols-5 gap-1"><input value={newAI.task} onChange={e => setNewAI({ ...newAI, task: e.target.value })} className="input-field text-xs col-span-2" placeholder="Tarea..." /><input value={newAI.responsible} onChange={e => setNewAI({ ...newAI, responsible: e.target.value })} className="input-field text-xs" placeholder="Responsable" /><input type="date" value={newAI.due_date} onChange={e => setNewAI({ ...newAI, due_date: e.target.value })} className="input-field text-xs" /><button type="button" onClick={addAI} className="px-2 py-1 bg-amber-600 text-white rounded text-xs">+</button></div>
          </div>

          {isEdit && <div><label className="block text-xs font-medium text-brand-800 mb-1">Estado</label><select value={form.status} onChange={set('status')} className="input-field text-sm">{Object.entries(MS).map(([k, v]) => <option key={k} value={k}>{v.l}</option>)}</select></div>}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-2">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {isEdit ? 'Guardar' : prefill ? 'Guardar Acta' : 'Crear'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// Auto-Generate Modal (extract with AI)
// ═══════════════════════════════════════
function AutoGenerateModal({ projectId, onClose, onExtracted }) {
  const [file, setFile] = useState(null);
  const [pasteText, setPasteText] = useState('');
  const [inputMode, setInputMode] = useState('file');
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);

  const handleGenerate = async () => {
    if (inputMode === 'file' && !file) return setError('Seleccione el archivo de transcripción');
    if (inputMode === 'paste' && pasteText.trim().length < 30) return setError('Pegue la transcripción completa (mín. 30 caracteres)');

    setGenerating(true); setError('');
    try {
      const provider = localStorage.getItem('sgip_ai_provider') || 'openai';
      const apiKey = localStorage.getItem('sgip_ai_key') || '';
      const model = localStorage.getItem('sgip_ai_model') || '';

      const fd = new FormData();
      if (inputMode === 'file') fd.append('transcript', file);
      else fd.append('transcript_text', pasteText);
      fd.append('provider', provider);
      if (apiKey) fd.append('api_key', apiKey);
      if (model) fd.append('model', model);

      const res = await minutesAPI.autoGenerate(projectId, fd);
      // Success — pass extracted data to parent to open prefilled form
      onExtracted(res.data.data);
    } catch (e) {
      const errData = e.response?.data;
      let msg = errData?.error || e.message;
      if (errData?.raw_preview) msg += `\n\nRespuesta parcial de la IA:\n${errData.raw_preview}`;
      if (errData?.hint) msg += `\n\n${errData.hint}`;
      if (errData?.extracted_length !== undefined) msg += `\n\n(Texto extraído: ${errData.extracted_length} caracteres)`;
      setError(msg);
    } finally { setGenerating(false); }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <div className="flex items-center gap-2">
            <Wand2 className="w-5 h-5 text-violet-500" />
            <h3 className="font-display font-bold text-brand-900">Generar Acta con IA</h3>
          </div>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400" /></button>
        </div>
        <div className="p-5 space-y-4">
          <div className="p-3 bg-violet-50 border border-violet-100 rounded-lg">
            <p className="text-xs text-violet-800 leading-relaxed">
              Suba la transcripción de Teams (.vtt, .txt, .docx) o pegue el texto. La IA extraerá asistentes, temas, acuerdos y compromisos para que los revise antes de guardar.
            </p>
          </div>

          {/* Input mode toggle */}
          <div className="flex gap-2">
            <button type="button" onClick={() => setInputMode('file')}
              className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition-colors
                ${inputMode === 'file' ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-surface-200 text-surface-400 hover:bg-surface-50'}`}>
              <Upload className="w-4 h-4" /> Subir archivo
            </button>
            <button type="button" onClick={() => setInputMode('paste')}
              className={`flex-1 px-3 py-2 rounded-lg border text-sm font-medium flex items-center justify-center gap-2 transition-colors
                ${inputMode === 'paste' ? 'bg-violet-50 border-violet-300 text-violet-700' : 'border-surface-200 text-surface-400 hover:bg-surface-50'}`}>
              <FileText className="w-4 h-4" /> Pegar texto
            </button>
          </div>

          {/* File upload */}
          {inputMode === 'file' && (
            <div onClick={() => fileRef.current?.click()}
              className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors
                ${file ? 'border-violet-300 bg-violet-50' : 'border-surface-200 hover:border-violet-300 hover:bg-violet-50/50'}`}>
              <input ref={fileRef} type="file" accept=".vtt,.txt,.docx,.doc,.md" className="hidden"
                onChange={e => { setFile(e.target.files[0]); setError(''); }} />
              {file ? (
                <div className="flex items-center justify-center gap-2">
                  <FileText className="w-5 h-5 text-violet-500" />
                  <span className="text-sm font-medium text-violet-700">{file.name}</span>
                  <span className="text-xs text-violet-400">({(file.size / 1024).toFixed(1)} KB)</span>
                  <button type="button" onClick={e => { e.stopPropagation(); setFile(null); }} className="text-red-400 hover:text-red-600 ml-2">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-surface-300 mx-auto mb-2" />
                  <p className="text-sm text-surface-500">Haga clic para seleccionar la transcripción</p>
                  <p className="text-[10px] text-surface-400 mt-1">Formatos: .vtt, .txt, .docx</p>
                </>
              )}
            </div>
          )}

          {/* Paste text */}
          {inputMode === 'paste' && (
            <textarea value={pasteText} onChange={e => { setPasteText(e.target.value); setError(''); }}
              className="input-field text-xs min-h-[180px] resize-y font-mono"
              placeholder={'Pegue aquí el contenido completo de la transcripción de Teams...\n\nEjemplo formato VTT:\nWEBVTT\n\n1\n00:00:00.000 --> 00:00:05.000\n<v Juan Pérez>Buenos días, vamos a iniciar la reunión</v>\n\nEjemplo formato texto:\nJuan Pérez   0:00\nBuenos días, vamos a iniciar la reunión'} />
          )}

          {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-xs text-red-700 whitespace-pre-wrap max-h-40 overflow-y-auto">{error}</div>}

          {generating && (
            <div className="flex items-center gap-3 p-3 bg-violet-50 border border-violet-100 rounded-lg">
              <Loader2 className="w-4 h-4 animate-spin text-violet-500" />
              <div>
                <p className="text-sm font-medium text-violet-700">Analizando transcripción con IA...</p>
                <p className="text-xs text-violet-500">Extrayendo asistentes, temas, acuerdos y compromisos</p>
              </div>
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
            <button type="button" onClick={handleGenerate} disabled={generating}
              className="btn-primary text-sm flex items-center gap-2 bg-violet-600 hover:bg-violet-700">
              {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {generating ? 'Procesando...' : 'Generar Acta con IA'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// Create Mode Selector
// ═══════════════════════════════════════
function CreateModeModal({ onManual, onAutomatic, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900">Nueva Acta</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400" /></button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-sm text-surface-500 mb-2">Seleccione cómo desea crear el acta:</p>
          <button onClick={onManual}
            className="w-full p-4 rounded-xl border-2 border-surface-200 hover:border-brand-300 hover:bg-brand-50/50 transition-all text-left group">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-brand-100 flex items-center justify-center group-hover:bg-brand-200 transition-colors">
                <Edit2 className="w-5 h-5 text-brand-600" />
              </div>
              <div>
                <p className="font-semibold text-brand-900 text-sm">Manual</p>
                <p className="text-xs text-surface-400">Escribir el acta manualmente en el formulario</p>
              </div>
            </div>
          </button>
          <button onClick={onAutomatic}
            className="w-full p-4 rounded-xl border-2 border-violet-200 hover:border-violet-400 hover:bg-violet-50/50 transition-all text-left group">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-lg bg-violet-100 flex items-center justify-center group-hover:bg-violet-200 transition-colors">
                <Wand2 className="w-5 h-5 text-violet-600" />
              </div>
              <div>
                <p className="font-semibold text-violet-900 text-sm">Automática con IA</p>
                <p className="text-xs text-surface-400">Subir transcripción de Teams y generar con ChatGPT</p>
              </div>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// Main Panel
// ═══════════════════════════════════════
// ═══ Commitment Edit Modal ═══
function CommitmentEditModal({ commitment, teamMembers, onSave, onClose }) {
  const [form, setForm] = useState({
    status: commitment.status || 'pendiente',
    responsible: commitment.responsible || '',
    due_date: commitment.due_date ? commitment.due_date.split('T')[0] : '',
    start_date: commitment.start_date ? commitment.start_date.split('T')[0] : '',
    completed_date: commitment.completed_date ? commitment.completed_date.split('T')[0] : '',
    evidence: commitment.evidence || '',
    notes: commitment.notes || '',
    priority: commitment.priority || 'media',
  });
  const [saving, setSaving] = useState(false);

  const set = (f) => (e) => setForm(prev => ({ ...prev, [f]: e.target.value }));

  const handleSave = async () => {
    setSaving(true);
    try { await onSave(form); } finally { setSaving(false); }
  };

  const statusOpts = [
    { val: 'pendiente', label: 'Pendiente', color: 'bg-amber-100 text-amber-700' },
    { val: 'en_progreso', label: 'En progreso', color: 'bg-blue-100 text-blue-700' },
    { val: 'completado', label: 'Completado', color: 'bg-emerald-100 text-emerald-700' },
    { val: 'cancelado', label: 'Cancelado', color: 'bg-surface-100 text-surface-500' },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <div>
            <h3 className="font-display font-bold text-brand-900">Gestionar Compromiso</h3>
            <p className="text-[10px] text-surface-400 mt-0.5">Acta #{commitment.minute_number}</p>
          </div>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400" /></button>
        </div>

        <div className="p-5 space-y-4">
          {/* Task (read-only) */}
          <div className="p-3 bg-surface-50 rounded-lg">
            <p className="text-xs font-medium text-brand-800 mb-1">Compromiso</p>
            <p className="text-sm text-brand-900">{commitment.task}</p>
          </div>

          {/* Status */}
          <div>
            <p className="text-xs font-medium text-brand-800 mb-1.5">Estado</p>
            <div className="flex gap-1.5 flex-wrap">
              {statusOpts.map(s => (
                <button key={s.val} onClick={() => setForm(p => ({ ...p, status: s.val }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${form.status === s.val ? `${s.color} border-current` : 'bg-white border-surface-200 text-surface-400'}`}>
                  {s.label}
                </button>
              ))}
            </div>
          </div>

          {/* Responsible */}
          <div>
            <p className="text-xs font-medium text-brand-800 mb-1">Responsable</p>
            {teamMembers.length > 0 ? (
              <select value={form.responsible} onChange={set('responsible')} className="input-field text-sm w-full">
                <option value="">— Seleccionar —</option>
                {teamMembers.map(t => (
                  <option key={t.id} value={t.member_name || t.full_name}>{t.member_name || t.full_name} ({t.role_in_project || t.cargo})</option>
                ))}
                {form.responsible && !teamMembers.find(t => (t.member_name || t.full_name) === form.responsible) && (
                  <option value={form.responsible}>{form.responsible} (externo)</option>
                )}
              </select>
            ) : (
              <input value={form.responsible} onChange={set('responsible')} className="input-field text-sm w-full" placeholder="Nombre del responsable" />
            )}
          </div>

          {/* Priority */}
          <div>
            <p className="text-xs font-medium text-brand-800 mb-1.5">Prioridad</p>
            <div className="flex gap-1.5">
              {[{val:'alta',l:'Alta',c:'bg-red-100 text-red-700'},{val:'media',l:'Media',c:'bg-amber-100 text-amber-700'},{val:'baja',l:'Baja',c:'bg-blue-100 text-blue-700'}].map(p => (
                <button key={p.val} onClick={() => setForm(prev => ({ ...prev, priority: p.val }))}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium border-2 transition-all ${form.priority === p.val ? `${p.c} border-current` : 'bg-white border-surface-200 text-surface-400'}`}>
                  {p.l}
                </button>
              ))}
            </div>
          </div>

          {/* Dates */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <p className="text-xs font-medium text-brand-800 mb-1">Fecha límite</p>
              <input type="date" value={form.due_date} onChange={set('due_date')} className="input-field text-sm w-full" />
            </div>
            {form.status === 'completado' && (
              <div>
                <p className="text-xs font-medium text-brand-800 mb-1">Fecha cumplimiento</p>
                <input type="date" value={form.completed_date} onChange={set('completed_date')} className="input-field text-sm w-full" />
              </div>
            )}
          </div>

          {/* Evidence */}
          <div>
            <p className="text-xs font-medium text-brand-800 mb-1">Evidencia de cumplimiento</p>
            <input value={form.evidence} onChange={set('evidence')} className="input-field text-sm w-full"
              placeholder="Ej: Correo enviado 12/mar, acta firmada, entregable aprobado..." />
          </div>

          {/* Notes */}
          <div>
            <p className="text-xs font-medium text-brand-800 mb-1">Notas de seguimiento</p>
            <textarea value={form.notes} onChange={set('notes')} className="input-field text-sm w-full min-h-[60px] resize-y"
              placeholder="Observaciones, avances parciales, bloqueos..." />
          </div>
        </div>

        <div className="flex justify-end gap-3 p-5 border-t border-surface-100">
          <button onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
          <button onClick={handleSave} disabled={saving} className="btn-primary text-sm flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Guardar
          </button>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════
// Signature Modal (create / view request)
// ═══════════════════════════════════════
const EMPTY_SIGNER = { signer_name: '', signer_email: '', signer_role: '' };

function SignatureModal({ projectId, minute, existingRequest, onClose, onChanged }) {
  // isTerminal: process ended (cancelled/rejected) — always go straight to create form
  const isTerminal = ['cancelled', 'rejected'].includes(existingRequest?.status);
  const hasActiveRequest = !isTerminal && existingRequest && existingRequest.status;
  const [mode,    setMode]    = useState(hasActiveRequest ? 'status' : 'create');
  const [signers, setSigners] = useState([{ ...EMPTY_SIGNER }, { ...EMPTY_SIGNER }]);
  const [saving,  setSaving]  = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [err,     setErr]     = useState('');

  const setSigner = (i, field, val) =>
    setSigners(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));

  const addSigner = () => setSigners(prev => [...prev, { ...EMPTY_SIGNER }]);
  const removeSigner = (i) => setSigners(prev => prev.filter((_, idx) => idx !== i));

  const handleCreate = async () => {
    const valid = signers.filter(s => s.signer_name.trim() && s.signer_email.trim());
    if (valid.length < 1) { setErr('Agregue al menos un firmante con nombre y correo.'); return; }
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const s of valid) {
      if (!emailRx.test(s.signer_email)) { setErr(`Correo inválido: ${s.signer_email}`); return; }
    }
    setSaving(true); setErr('');
    try {
      await signaturesAPI.create(projectId, minute.id, {
        // Backend expects: name, email, role, order
        signers: valid.map((s, i) => ({
          name:  s.signer_name.trim(),
          email: s.signer_email.trim(),
          role:  s.signer_role?.trim() || '',
          order: i + 1,
        })),
      });
      onChanged();
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || 'Error al iniciar el proceso de firmas.');
    } finally { setSaving(false); }
  };

  const handleCancel = async () => {
    if (!window.confirm('¿Cancelar el proceso de firmas? Se notificará a los firmantes.')) return;
    setCancelling(true);
    try {
      await signaturesAPI.cancel(projectId, minute.id);
      onChanged();
      onClose();
    } catch (e) {
      setErr(e.response?.data?.error || 'Error al cancelar.');
    } finally { setCancelling(false); }
  };

  // Backend returns flat object: { id, status, document_hash, signers: [...] }
  const req = existingRequest;                          // the request itself
  const reqSigners = existingRequest?.signers || [];
  const signedCount = reqSigners.filter(s => s.status === 'signed').length;

  const statusColor = (s) => {
    if (s === 'signed')    return 'bg-green-100 text-green-700';
    if (s === 'rejected')  return 'bg-red-100 text-red-700';
    if (s === 'notified')  return 'bg-blue-100 text-blue-700';
    if (s === 'viewed')    return 'bg-yellow-100 text-yellow-700';
    return 'bg-gray-100 text-gray-500';
  };
  const statusLabel = (s) => ({
    pending: 'Pendiente', notified: 'Notificado', viewed: 'Visto',
    signed: 'Firmado', rejected: 'Rechazado',
  }[s] || s);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 bg-gradient-to-r from-brand-50 to-blue-50">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-brand-600" />
            <div>
              <h2 className="font-semibold text-gray-800 text-sm">Firmas Digitales</h2>
              <p className="text-xs text-gray-400 truncate max-w-xs">{minute.title}</p>
            </div>
          </div>
          <button onClick={onClose} className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center">
            <X size={16} className="text-gray-400" />
          </button>
        </div>

        <div className="px-6 py-5 space-y-4 max-h-[70vh] overflow-y-auto">
          {/* Tab toggle when request exists */}
          {hasActiveRequest && (
            <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium">
              <button
                onClick={() => setMode('status')}
                className={`flex-1 py-2 transition-colors ${mode === 'status' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >Actividad</button>
              <button
                onClick={() => setMode('create')}
                className={`flex-1 py-2 transition-colors ${mode === 'create' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'}`}
              >Nuevo proceso</button>
            </div>
          )}

          {/* ACTIVITY TIMELINE view */}
          {mode === 'status' && hasActiveRequest && (() => {
            // Build timeline from available data
            const events = [];
            const fmtTs = (ts) => ts ? new Date(ts).toLocaleString('es-CO', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit', timeZone:'America/Bogota' }) : '';
            if (req?.created_at)
              events.push({ icon: '🚀', color: 'bg-brand-100 text-brand-700', text: 'Proceso de firmas iniciado', sub: '', ts: req.created_at });
            reqSigners.forEach(s => {
              // notified = email sent (we use created_at for first, signed_at of prev for subsequent)
              if (s.status !== 'pending')
                events.push({ icon: '📧', color: 'bg-blue-100 text-blue-700', text: `Correo enviado a ${s.signer_name}`, sub: s.signer_email, ts: req.created_at });
              if (s.status === 'viewed' || s.status === 'signed' || s.status === 'rejected')
                events.push({ icon: '👁', color: 'bg-yellow-100 text-yellow-700', text: `Enlace abierto por ${s.signer_name}`, sub: s.signer_email, ts: null });
              if (s.status === 'signed')
                events.push({ icon: '✍️', color: 'bg-green-100 text-green-700', text: `Documento firmado por ${s.signer_name}`, sub: `${s.signer_email}${s.ip_address ? ' · IP: ' + s.ip_address : ''}`, ts: s.signed_at });
              if (s.status === 'rejected')
                events.push({ icon: '✗', color: 'bg-red-100 text-red-700', text: `Rechazado por ${s.signer_name}`, sub: s.rejection_reason || s.signer_email, ts: s.signed_at });
            });
            if (req?.status === 'completed' && req?.completed_at)
              events.push({ icon: '✅', color: 'bg-emerald-100 text-emerald-700', text: 'Proceso completado — todos los firmantes han firmado', sub: '', ts: req.completed_at });
            if (req?.status === 'cancelled')
              events.push({ icon: '⊘', color: 'bg-gray-100 text-gray-500', text: 'Proceso cancelado', sub: '', ts: null });

            return (
              <div className="space-y-3">
                {/* Status pill + progress */}
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    req?.status === 'completed' ? 'bg-green-100 text-green-700' :
                    req?.status === 'rejected'  ? 'bg-red-100 text-red-600'  :
                    req?.status === 'cancelled' ? 'bg-gray-100 text-gray-500' : 'bg-blue-100 text-blue-700'
                  }`}>{{ in_progress: 'En progreso', completed: 'Completado', rejected: 'Rechazado', cancelled: 'Cancelado' }[req?.status] || req?.status}</span>
                  <span className="text-xs text-gray-400">{signedCount} / {reqSigners.length} firmados</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1">
                  <div className={`h-1 rounded-full transition-all ${req?.status === 'completed' ? 'bg-green-500' : 'bg-brand-500'}`}
                    style={{ width: `${reqSigners.length ? (signedCount / reqSigners.length) * 100 : 0}%` }} />
                </div>

                {/* Timeline */}
                <div className="relative mt-2">
                  {events.map((ev, i) => (
                    <div key={i} className="flex gap-3 pb-4 relative">
                      {/* Vertical line */}
                      {i < events.length - 1 && (
                        <div className="absolute left-3.5 top-7 bottom-0 w-px bg-gray-200" />
                      )}
                      {/* Icon dot */}
                      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center justify-center text-sm z-10 ${ev.color}`}>
                        {ev.icon}
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0 pt-0.5">
                        <p className="text-xs font-medium text-gray-800 leading-snug">{ev.text}</p>
                        {ev.sub && <p className="text-[10px] text-gray-400 truncate mt-0.5">{ev.sub}</p>}
                        {ev.ts && <p className="text-[10px] text-gray-400 mt-0.5">{fmtTs(ev.ts)}</p>}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Actions */}
                {req?.status === 'completed' && (
                  <button
                    onClick={async () => {
                      try {
                        const r = await signaturesAPI.certificate(projectId, minute.id);
                        const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
                        const a = document.createElement('a'); a.href = url;
                        a.download = `Certificado_Firma_Acta${minute.minute_number || minute.id}.pdf`;
                        a.click(); URL.revokeObjectURL(url);
                      } catch (e) { setErr('Error al generar el certificado PDF.'); }
                    }}
                    className="w-full text-xs text-green-700 border border-green-300 bg-green-50
                      rounded-xl py-2.5 hover:bg-green-100 transition-colors font-semibold
                      flex items-center justify-center gap-1.5"
                  >
                    <Download size={13} className="text-green-700" />
                    Descargar certificado PDF firmado
                  </button>
                )}
                {req?.status === 'in_progress' && (
                  <button onClick={handleCancel} disabled={cancelling}
                    className="w-full text-xs text-red-500 border border-red-200 rounded-xl py-2
                      hover:bg-red-50 transition-colors disabled:opacity-50 flex items-center justify-center gap-1"
                  >
                    {cancelling ? <Loader2 size={12} className="animate-spin" /> : null}
                    Cancelar proceso de firmas
                  </button>
                )}
              </div>
            );
          })()}

          {/* CREATE view */}
          {mode === 'create' && (
            <div className="space-y-4">
              {isTerminal && (
                <div className={`text-xs rounded-lg p-3 leading-relaxed border ${existingRequest?.status === 'rejected' ? 'bg-red-50 border-red-200 text-red-700' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  <strong>{existingRequest?.status === 'rejected' ? '✕ Proceso rechazado.' : '⊘ Proceso cancelado.'}</strong> Puedes iniciar un nuevo proceso de firmas para esta acta.
                </div>
              )}
              {!isTerminal && existingRequest?.status === 'completed' && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-3 leading-relaxed">
                  <strong>Nota:</strong> El acta ya tiene un proceso completado. Al iniciar uno nuevo se generará un proceso independiente (útil si editaste el contenido del acta). El certificado anterior sigue siendo válido.
                </div>
              )}
              <p className="text-xs text-gray-500 leading-relaxed bg-blue-50 rounded-lg p-3 border border-blue-100">
                <strong>Firma electrónica con validez legal</strong> conforme a la Ley 527 de 1999 y
                Decreto 1074 de 2015. Cada firmante recibirá un correo con un enlace único para firmar
                el documento de forma secuencial.
              </p>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-600">Firmantes (en orden de firma)</p>
                  <button
                    onClick={addSigner}
                    className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
                  >
                    <UserPlus size={12} /> Agregar
                  </button>
                </div>

                {signers.map((s, i) => (
                  <div key={i} className="rounded-xl border border-gray-200 p-3 space-y-2">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] font-bold text-brand-600 bg-brand-50 px-2 py-0.5 rounded-full">
                        Firmante #{i + 1}
                      </span>
                      {signers.length > 1 && (
                        <button onClick={() => removeSigner(i)} className="text-gray-300 hover:text-red-400">
                          <X size={12} />
                        </button>
                      )}
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <input
                        type="text"
                        placeholder="Nombre completo *"
                        value={s.signer_name}
                        onChange={e => setSigner(i, 'signer_name', e.target.value)}
                        className="col-span-2 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs
                          focus:outline-none focus:border-brand-400"
                      />
                      <input
                        type="email"
                        placeholder="Correo electrónico *"
                        value={s.signer_email}
                        onChange={e => setSigner(i, 'signer_email', e.target.value)}
                        className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs
                          focus:outline-none focus:border-brand-400"
                      />
                      <input
                        type="text"
                        placeholder="Cargo / Rol"
                        value={s.signer_role}
                        onChange={e => setSigner(i, 'signer_role', e.target.value)}
                        className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs
                          focus:outline-none focus:border-brand-400"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {err && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50
                  rounded-lg px-3 py-2 border border-red-100">
                  <AlertTriangle size={12} /> {err}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        {mode === 'create' && (
          <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2">
            <button onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
            <button
              onClick={handleCreate}
              disabled={saving}
              className="btn-primary text-sm flex items-center gap-2"
            >
              {saving ? <Loader2 size={14} className="animate-spin" /> : <PenLine size={14} />}
              Iniciar proceso de firmas
            </button>
          </div>
        )}
        {mode === 'status' && (
          <div className="px-6 py-4 border-t border-gray-100 flex justify-end">
            <button onClick={onClose} className="btn-ghost text-sm">Cerrar</button>
          </div>
        )}
      </div>
    </div>
  );
}

export default function MinutesPanel({ projectId, perms = {} }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);
  const [view, setView] = useState('actas'); // 'actas' | 'compromisos'
  const [editingCommitment, setEditingCommitment] = useState(null); // { minute_id, index, ...data }
  const [teamMembers, setTeamMembers] = useState([]);
  const [cFilter, setCFilter]       = useState('todos'); // todos | pendientes | vencidos | completados
  const [selected, setSelected]       = useState(new Set()); // keys: `${minute_id}-${index}`
  const [bulkLoading, setBulkLoading] = useState(false);
  const [closedAccordions, setClosedAccordions] = useState(new Set()); // minute ids that are collapsed
  const [sigModal,    setSigModal]    = useState(null);   // minute object | null
  const [sigStatuses, setSigStatuses] = useState({});     // { [minuteId]: { request, signers } | null }

  const load = useCallback(async () => {
    try {
      const r = await minutesAPI.list(projectId);
      const data = (r.data.data || []).map(m => ({
        ...m,
        attendees: safeArr(m.attendees),
        agreements: safeArr(m.agreements),
        action_items: safeArr(m.action_items),
      }));
      setItems(data);
      // Load signature statuses for all actas (best-effort, no crash on fail)
      if (data.length > 0) {
        const statuses = await signaturesAPI.batchStatus(projectId, data.map(m => m.id));
        setSigStatuses(statuses);
      }
    } catch {} finally { setLoading(false); }
  }, [projectId]);

  // Load team members for responsible dropdown
  const loadTeam = useCallback(async () => {
    try {
      const { teamAPI } = await import('../../services/api');
      const r = await teamAPI.list(projectId);
      setTeamMembers(r.data.data || []);
    } catch {}
  }, [projectId]);

  useEffect(() => { setLoading(true); load(); }, [load]);
  useEffect(() => { loadTeam(); }, [loadTeam]);
  const showToast = m => { setToast(m); setTimeout(() => setToast(null), 2500); };
  const del = async (id) => { if (!window.confirm('¿Eliminar acta?')) return; await minutesAPI.delete(projectId, id); showToast('Eliminada'); load(); };
  const handleAIExtracted = (data) => { setModal({ prefill: data }); };

  // ═══ Extract commitments from loaded actas ═══
  const allCommitments = [];
  for (const m of items) {
    const ai = safeArr(m.action_items);
    ai.forEach((item, idx) => {
      const isDone = item.completed || item.status === 'completado';
      allCommitments.push({
        minute_id: m.id,
        minute_number: m.minute_number,
        minute_title: m.title || `Acta #${m.minute_number}`,
        minute_type: m.minute_type || 'otro',
        meeting_date: m.meeting_date,
        index: idx,
        task: item.task || item.description || item.text || '',
        responsible: item.responsible || item.responsable || '',
        due_date: item.due_date || item.fecha || null,
        start_date: item.start_date || null,
        status: item.status || (isDone ? 'completado' : 'pendiente'),
        completed: isDone,
        notes: item.notes || item.notas || '',
        evidence: item.evidence || '',
        completed_date: item.completed_date || null,
        priority: item.priority || 'media',
      });
    });
  }

  const now = new Date();
  const cStats = {
    total: allCommitments.length,
    completed: allCommitments.filter(i => i.completed).length,
    pending: allCommitments.filter(i => !i.completed).length,
    overdue: allCommitments.filter(i => !i.completed && i.due_date && new Date(i.due_date) < now).length,
  };

  // Filter
  const filtered = allCommitments.filter(c => {
    if (cFilter === 'pendientes') return !c.completed;
    if (cFilter === 'vencidos') return !c.completed && c.due_date && new Date(c.due_date) < now;
    if (cFilter === 'completados') return c.completed;
    return true;
  });

  const updateCommitment = async (minuteId, index, updates) => {
    try {
      const acta = items.find(m => m.id === minuteId);
      if (!acta) return;
      const ai = [...safeArr(acta.action_items)];
      if (index >= ai.length) return;

      // Merge ALL updates into the item
      Object.keys(updates).forEach(k => {
        if (updates[k] !== undefined) ai[index][k] = updates[k];
      });

      // Auto-set completed flag
      if (updates.status === 'completado') {
        ai[index].completed = true;
        if (!ai[index].completed_date) ai[index].completed_date = now.toISOString().split('T')[0];
      } else if (updates.status === 'pendiente' || updates.status === 'en_progreso') {
        ai[index].completed = false;
        ai[index].completed_date = null;
      }

      await minutesAPI.update(projectId, minuteId, { action_items: ai });
      showToast('Compromiso actualizado');
      setEditingCommitment(null);
      load();
    } catch (e) { showToast('Error: ' + (e.response?.data?.error || e.message)); }
  };

  // ═══ Multi-select helpers ═══
  const toggleSelect = (key) => setSelected(prev => {
    const next = new Set(prev);
    next.has(key) ? next.delete(key) : next.add(key);
    return next;
  });

  const toggleSelectAll = () => {
    const keys = filtered.map(c => `${c.minute_id}-${c.index}`);
    const allSelected = keys.every(k => selected.has(k));
    setSelected(allSelected ? new Set() : new Set(keys));
  };

  const clearSelection = () => setSelected(new Set());

  const toggleAccordion = (id) => setClosedAccordions(prev => {
    const next = new Set(prev);
    next.has(id) ? next.delete(id) : next.add(id);
    return next;
  });

  const bulkUpdate = async (statusValue) => {
    if (selected.size === 0) return;
    setBulkLoading(true);
    try {
      // Group selected by minute_id to minimize API calls
      const byMinute = {};
      for (const key of selected) {
        const [mid, idx] = key.split('-');
        if (!byMinute[mid]) byMinute[mid] = [];
        byMinute[mid].push(parseInt(idx));
      }
      for (const [minuteId, indexes] of Object.entries(byMinute)) {
        const acta = items.find(m => m.id === parseInt(minuteId));
        if (!acta) continue;
        const ai = [...safeArr(acta.action_items)];
        for (const idx of indexes) {
          if (idx >= ai.length) continue;
          ai[idx].status = statusValue;
          ai[idx].completed = statusValue === 'completado';
          if (statusValue === 'completado' && !ai[idx].completed_date)
            ai[idx].completed_date = new Date().toISOString().split('T')[0];
          else if (statusValue !== 'completado')
            ai[idx].completed_date = null;
        }
        await minutesAPI.update(projectId, parseInt(minuteId), { action_items: ai });
      }
      showToast(`${selected.size} compromisos actualizados a "${statusValue}"`);
      clearSelection();
      load();
    } catch (e) { showToast('Error: ' + (e.response?.data?.error || e.message)); }
    finally { setBulkLoading(false); }
  };

  if (loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up bg-emerald-600 text-white">{toast}</div>}

      {/* View toggle */}
      <div className="flex items-center justify-between">
        <div className="flex gap-1 bg-surface-100 rounded-lg p-0.5">
          <button onClick={() => setView('actas')}
            className={`px-3 py-1.5 text-xs rounded-md transition-all ${view === 'actas' ? 'bg-white shadow text-brand-700 font-medium' : 'text-surface-500'}`}>
            Actas ({items.length})
          </button>
          <button onClick={() => setView('compromisos')}
            className={`px-3 py-1.5 text-xs rounded-md transition-all ${view === 'compromisos' ? 'bg-white shadow text-brand-700 font-medium' : 'text-surface-500'}`}>
            Compromisos {cStats.total > 0 ? `(${cStats.pending} pendientes)` : ''}
          </button>
        </div>
        {view === 'actas' && perms.canCreate && <button onClick={() => setModal('choose')} className="btn-primary text-sm flex items-center gap-1.5"><Plus className="w-4 h-4" /> Nueva Acta</button>}
      </div>

      {/* ═══ COMMITMENTS VIEW ═══ */}
      {view === 'compromisos' && (
        <div className="space-y-3">
          {allCommitments.length === 0 ? <p className="text-center py-8 text-surface-400 text-sm">Sin compromisos registrados. Cree un acta con compromisos primero.</p> : (
            <>
              {/* Stats */}
              <div className="grid grid-cols-4 gap-2">
                <button onClick={() => setCFilter('todos')} className={`p-2.5 rounded-lg text-center transition-colors ${cFilter === 'todos' ? 'ring-2 ring-brand-400' : ''} bg-surface-50`}><p className="text-lg font-bold text-brand-700">{cStats.total}</p><p className="text-[10px] text-surface-400">Total</p></button>
                <button onClick={() => setCFilter('completados')} className={`p-2.5 rounded-lg text-center transition-colors ${cFilter === 'completados' ? 'ring-2 ring-emerald-400' : ''} bg-emerald-50`}><p className="text-lg font-bold text-emerald-600">{cStats.completed}</p><p className="text-[10px] text-emerald-500">Completados</p></button>
                <button onClick={() => setCFilter('pendientes')} className={`p-2.5 rounded-lg text-center transition-colors ${cFilter === 'pendientes' ? 'ring-2 ring-amber-400' : ''} bg-amber-50`}><p className="text-lg font-bold text-amber-600">{cStats.pending}</p><p className="text-[10px] text-amber-500">Pendientes</p></button>
                <button onClick={() => setCFilter('vencidos')} className={`p-2.5 rounded-lg text-center transition-colors ${cFilter === 'vencidos' ? 'ring-2 ring-red-400' : ''} bg-red-50`}><p className="text-lg font-bold text-red-600">{cStats.overdue}</p><p className="text-[10px] text-red-500">Vencidos</p></button>
              </div>

              {/* ── Barra de acciones masivas ── */}
              {selected.size > 0 ? (
                <div className="flex items-center gap-2 px-3 py-2 bg-brand-600 rounded-lg text-white text-sm shadow-md">
                  <button onClick={clearSelection} className="p-0.5 hover:bg-white/20 rounded transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                  <span className="font-medium flex-1">{selected.size} seleccionado{selected.size !== 1 ? 's' : ''}</span>
                  {bulkLoading
                    ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                    : <>
                        <button onClick={() => bulkUpdate('completado')}
                          className="flex items-center gap-1 px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 rounded-md text-xs font-medium transition-colors">
                          <Check className="w-3 h-3" /> Completar
                        </button>
                        <button onClick={() => bulkUpdate('en_progreso')}
                          className="flex items-center gap-1 px-2.5 py-1 bg-blue-500 hover:bg-blue-400 rounded-md text-xs font-medium transition-colors">
                          En progreso
                        </button>
                        <button onClick={() => bulkUpdate('pendiente')}
                          className="flex items-center gap-1 px-2.5 py-1 bg-amber-500 hover:bg-amber-400 rounded-md text-xs font-medium transition-colors">
                          Pendiente
                        </button>
                      </>
                  }
                </div>
              ) : (
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-surface-400">{filtered.length} compromiso{filtered.length !== 1 ? 's' : ''} {cFilter !== 'todos' ? `(filtro: ${cFilter})` : ''}</p>
                  {filtered.length > 0 && (
                    <button onClick={toggleSelectAll}
                      className="flex items-center gap-1 text-[10px] text-surface-400 hover:text-brand-600 transition-colors">
                      <Square className="w-3 h-3" /> Seleccionar todos
                    </button>
                  )}
                </div>
              )}

              {/* ── Accordion per acta ── */}
              {(() => {
                // Group filtered commitments by minute_id preserving acta order
                const actaOrder = [];
                const byActa = {};
                for (const c of filtered) {
                  if (!byActa[c.minute_id]) { actaOrder.push(c.minute_id); byActa[c.minute_id] = []; }
                  byActa[c.minute_id].push(c);
                }
                return (
                  <div className="space-y-2">
                    {actaOrder.map(mid => {
                      const group = byActa[mid];
                      const isOpen = !closedAccordions.has(mid);
                      const info = group[0];
                      const pendingCount = group.filter(c => !c.completed).length;
                      const allKeys = group.map(c => `${c.minute_id}-${c.index}`);
                      const allSel = allKeys.every(k => selected.has(k));
                      const someSel = !allSel && allKeys.some(k => selected.has(k));

                      const toggleActaSelect = (e) => {
                        e.stopPropagation();
                        setSelected(prev => {
                          const next = new Set(prev);
                          if (allSel) allKeys.forEach(k => next.delete(k));
                          else allKeys.forEach(k => next.add(k));
                          return next;
                        });
                      };

                      return (
                        <div key={mid} className="border border-surface-200 rounded-xl overflow-hidden shadow-sm">
                          {/* Accordion header */}
                          <div
                            className={`flex items-center gap-3 px-4 py-3 cursor-pointer select-none transition-colors ${isOpen ? 'bg-brand-50 border-b border-surface-100' : 'bg-white hover:bg-surface-50'}`}
                            onClick={() => toggleAccordion(mid)}>
                            {/* Per-acta select checkbox */}
                            <button
                              onClick={toggleActaSelect}
                              className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 transition-all ${
                                allSel ? 'bg-brand-600 border-brand-600' :
                                someSel ? 'bg-brand-100 border-brand-400' :
                                'border-surface-300 hover:border-brand-400 bg-white'
                              }`}>
                              {allSel && <Check className="w-3 h-3 text-white" />}
                              {someSel && <div className="w-2 h-0.5 bg-brand-600 rounded" />}
                            </button>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-[10px] font-semibold text-surface-400 uppercase tracking-wide">Acta #{info.minute_number}</span>
                                <span className="text-sm font-semibold text-brand-900 truncate">{info.minute_title}</span>
                              </div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <span className="text-[10px] text-surface-400">
                                  {new Date(info.meeting_date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                                </span>
                                <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                  pendingCount > 0 ? 'bg-amber-100 text-amber-700' : 'bg-emerald-100 text-emerald-700'
                                }`}>
                                  {pendingCount > 0 ? `${pendingCount} pendiente${pendingCount !== 1 ? 's' : ''}` : '✓ Todos completos'}
                                </span>
                                <span className="text-[10px] text-surface-400">{group.length} compromiso{group.length !== 1 ? 's' : ''}</span>
                              </div>
                            </div>
                            <ChevronDown className={`w-4 h-4 text-surface-400 transition-transform duration-200 flex-shrink-0 ${isOpen ? 'rotate-180' : ''}`} />
                          </div>

                          {/* Accordion body */}
                          {isOpen && (
                            <div className="p-3 space-y-1.5 bg-white">
                              {group.map((c) => {
                                const key = `${c.minute_id}-${c.index}`;
                                const isSelected = selected.has(key);
                                const isDone = c.completed;
                                const isOverdue = !isDone && c.due_date && new Date(c.due_date) < now;
                                const daysLeft = c.due_date && !isDone ? Math.ceil((new Date(c.due_date) - now) / 86400000) : null;
                                return (
                                  <div key={key}
                                    className={`border rounded-lg p-3 transition-all ${
                                      isSelected ? 'border-brand-400 bg-brand-50/40 shadow-sm' :
                                      isDone ? 'border-emerald-200 bg-emerald-50/30' :
                                      isOverdue ? 'border-red-200 bg-red-50/30' :
                                      'border-surface-100 hover:border-surface-200 bg-white'
                                    }`}>
                                    <div className="flex items-start gap-3">
                                      {/* Multi-select checkbox */}
                                      <button
                                        onClick={() => toggleSelect(key)}
                                        className={`w-5 h-5 rounded border-2 flex items-center justify-center flex-shrink-0 mt-0.5 transition-all ${
                                          isSelected ? 'bg-brand-600 border-brand-600' : 'border-surface-300 hover:border-brand-400 bg-white'
                                        }`}>
                                        {isSelected && <Check className="w-3 h-3 text-white" />}
                                      </button>
                                      <div className="flex-1 min-w-0">
                                        <p className={`text-sm ${isDone ? 'line-through text-surface-400' : 'text-brand-900'}`}>{c.task}</p>
                                        <div className="flex flex-wrap items-center gap-2 mt-1.5 text-[10px] text-surface-400">
                                          {c.responsible && <span className="font-medium text-brand-600 bg-brand-50 px-1.5 py-0.5 rounded">→ {c.responsible}</span>}
                                          {c.due_date && (
                                            <span className={`px-1.5 py-0.5 rounded ${isOverdue ? 'bg-red-100 text-red-600 font-semibold' : daysLeft !== null && daysLeft <= 7 ? 'bg-amber-100 text-amber-600' : 'bg-surface-100'}`}>
                                              📅 {new Date(c.due_date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' })}
                                              {isOverdue && ` (${Math.abs(daysLeft)}d vencido)`}
                                              {!isOverdue && daysLeft !== null && daysLeft <= 7 && daysLeft > 0 && ` (${daysLeft}d)`}
                                            </span>
                                          )}
                                          {!c.due_date && !isDone && <span className="bg-amber-50 text-amber-500 px-1.5 py-0.5 rounded italic">Sin fecha límite</span>}
                                          {isDone && c.completed_date && <span className="text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded">✓ {new Date(c.completed_date).toLocaleDateString('es-CO', { day: '2-digit', month: 'short' })}</span>}
                                        </div>
                                        {c.evidence && <p className="text-[10px] text-emerald-600 mt-1">📎 {c.evidence}</p>}
                                        {c.notes && <p className="text-[10px] text-surface-400 mt-1 italic">💬 {c.notes}</p>}
                                      </div>
                                      <div className="flex items-center gap-1 flex-shrink-0">
                                        <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                                          isDone ? 'bg-emerald-100 text-emerald-700' :
                                          isOverdue ? 'bg-red-100 text-red-700' :
                                          c.status === 'en_progreso' ? 'bg-blue-100 text-blue-700' :
                                          'bg-amber-100 text-amber-700'
                                        }`}>{isDone ? 'Completado' : isOverdue ? 'Vencido' : c.status === 'en_progreso' ? 'En progreso' : 'Pendiente'}</span>
                                        {perms.canEdit && (
                                          <button onClick={() => setEditingCommitment({...c})}
                                            className="w-6 h-6 rounded hover:bg-surface-100 flex items-center justify-center ml-1">
                                            <Edit2 className="w-3 h-3 text-surface-400" />
                                          </button>
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })()}
            </>
          )}

          {/* ═══ EDIT COMMITMENT MODAL ═══ */}
          {editingCommitment && (
            <CommitmentEditModal
              commitment={editingCommitment}
              teamMembers={teamMembers}
              onSave={(updates) => updateCommitment(editingCommitment.minute_id, editingCommitment.index, updates)}
              onClose={() => setEditingCommitment(null)}
            />
          )}
        </div>
      )}

      {/* ═══ ACTAS VIEW ═══ */}
      {view === 'actas' && (<>
      {items.length === 0 ? <p className="text-center py-8 text-surface-400 text-sm">Sin actas registradas</p> :
        <div className="space-y-2">{items.map(m => {
          const s = MS[m.status] || MS.borrador;
          const att = m.attendees || [];
          const agr = m.agreements || [];
          const ai = m.action_items || [];
          const sigStatus = sigStatuses[m.id];
          const sigReq = sigStatus?.request;
          const sigBadge = sigReq
            ? sigReq.status === 'completed'   ? { bg: 'bg-emerald-100', t: 'text-emerald-700', l: '✓ Firmada' }
            : sigReq.status === 'in_progress' ? { bg: 'bg-blue-100',    t: 'text-blue-700',    l: `✍ Firmando (${(sigStatus.signers||[]).filter(x=>x.status==='signed').length}/${(sigStatus.signers||[]).length})` }
            : sigReq.status === 'rejected'    ? { bg: 'bg-red-100',     t: 'text-red-600',     l: '✕ Rechazada' }
            : null
            : null;
          return (
            <div key={m.id} className="group bg-white border border-surface-100 rounded-lg p-4 hover:border-surface-200 transition-colors">
              <div className="flex items-start justify-between gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <span className="font-mono text-xs text-brand-500 font-semibold">Acta #{m.minute_number}</span>
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.bg} ${s.t}`}>{s.l}</span>
                    <span className="text-[10px] text-surface-400">{MT[m.minute_type] || m.minute_type}</span>
                  </div>
                  <p className="text-sm font-medium text-brand-900">{m.title}</p>
                  <p className="text-xs text-surface-400 mt-0.5">{new Date(m.meeting_date).toLocaleDateString('es-CO', { day: '2-digit', month: 'long', year: 'numeric' })} {m.location ? `· ${m.location}` : ''}</p>
                </div>
                {/* Action buttons — always visible */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  {perms.canEdit && (
                    <button onClick={() => setModal(m)} className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Editar">
                      <Edit2 className="w-3.5 h-3.5 text-surface-400" />
                    </button>
                  )}
                  <button onClick={async () => { try { const r = await exportsAPI.minuteToWord(projectId, m.id); const url = URL.createObjectURL(new Blob([r.data])); const a = document.createElement('a'); a.href = url; a.download = `Acta_${m.minute_number || m.id}.docx`; a.click(); URL.revokeObjectURL(url); } catch (e) { alert('Error exportando: ' + e.message); } }} className="w-7 h-7 rounded hover:bg-blue-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Descargar Word">
                    <Download className="w-3.5 h-3.5 text-blue-500" />
                  </button>
                  {perms.canDelete && (
                    <button onClick={() => del(m.id)} className="w-7 h-7 rounded hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity" title="Eliminar">
                      <Trash2 className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  )}
                  {/* Firma button — ALWAYS visible, adapts to status */}
                  <button
                    onClick={() => setSigModal(m)}
                    title={sigReq ? 'Ver estado de firmas' : 'Solicitar firmas digitales'}
                    className={`flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-semibold border transition-colors ${
                      sigReq?.status === 'completed'   ? 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100' :
                      sigReq?.status === 'in_progress' ? 'bg-blue-50 border-blue-200 text-blue-700 hover:bg-blue-100' :
                      sigReq?.status === 'rejected'    ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100' :
                      'bg-purple-50 border-purple-200 text-purple-600 hover:bg-purple-100'
                    }`}
                  >
                    <PenLine className="w-3 h-3" />
                    {sigReq?.status === 'completed'   ? 'Firmada' :
                     sigReq?.status === 'in_progress' ? `${(sigStatus?.signers||[]).filter(x=>x.status==='signed').length}/${(sigStatus?.signers||[]).length} firmados` :
                     sigReq?.status === 'rejected'    ? 'Rechazada' :
                     'Firmas'}
                  </button>
                </div>
              </div>
              <div className="flex gap-4 mt-2 text-[10px] text-surface-400">
                {att.length > 0 && <span className="flex items-center gap-1"><Users className="w-3 h-3" /> {att.length} asistentes</span>}
                {agr.length > 0 && <span className="flex items-center gap-1"><CheckSquare className="w-3 h-3" /> {agr.length} acuerdos</span>}
                {ai.length > 0 && <span className="flex items-center gap-1"><FileText className="w-3 h-3" /> {ai.length} compromisos</span>}
              </div>
            </div>
          );
        })}</div>}

      {/* Mode chooser */}
      {modal === 'choose' && (
        <CreateModeModal
          onManual={() => setModal('manual')}
          onAutomatic={() => setModal('auto')}
          onClose={() => setModal(null)}
        />
      )}

      {/* Manual create */}
      {modal === 'manual' && (
        <MinuteModal item={null} projectId={projectId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); showToast('Acta creada'); load(); }} />
      )}

      {/* Auto-generate (extraction step) */}
      {modal === 'auto' && (
        <AutoGenerateModal projectId={projectId}
          onClose={() => setModal(null)}
          onExtracted={handleAIExtracted} />
      )}

      {/* AI prefilled form (review before save) */}
      {modal?.prefill && (
        <MinuteModal prefill={modal.prefill} projectId={projectId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); showToast('Acta generada con IA y guardada'); load(); }} />
      )}

      {/* Edit existing */}
      {modal && modal.id && !modal.prefill && (
        <MinuteModal item={modal} projectId={projectId}
          onClose={() => setModal(null)}
          onSaved={() => { setModal(null); showToast('Acta actualizada'); load(); }} />
      )}

      {/* Signature modal */}
      {sigModal && (
        <SignatureModal
          projectId={projectId}
          minute={sigModal}
          existingRequest={sigStatuses[sigModal.id] || null}
          onClose={() => setSigModal(null)}
          onChanged={() => { setSigModal(null); showToast('Proceso de firmas actualizado'); load(); }}
        />
      )}
      </>)}
    </div>
  );
}
