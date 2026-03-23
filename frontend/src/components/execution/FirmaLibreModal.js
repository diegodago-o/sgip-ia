import React, { useState, useRef, useCallback } from 'react';
import {
  X, Upload, UserPlus, Trash2, GripVertical, ArrowRight,
  FileText, Shield, AlertCircle, Loader2, CheckCircle,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { freeSignaturesAPI } from '../../services/api';

const FIELD_COLORS = [
  '#2E86AB', '#E84855', '#3BB273', '#F18F01',
  '#7B2D8B', '#1B4332', '#C9184A', '#023E8A',
];

const EMPTY_SIGNER = { signer_name: '', signer_email: '', signer_role: '', page_num: 1 };

// ── Draggable signature field box ────────────────────────────────────────────
// NOTE: The overlay div (z-index 5) inside containerRef blocks the native PDF
// viewer's OS-level window so pointer events reach these boxes (z-index 10).
function SignatureFieldBox({ idx, pos, name, color, containerRef, onMove, onRemove, onResize }) {
  const startDrag   = useRef(null);
  const startResize = useRef(null);

  const handleMouseDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    // Offset = where inside the box the user clicked (keeps box from jumping)
    const offsetX = (e.clientX - rect.left) / rect.width  - pos.x_percent;
    const offsetY = (e.clientY - rect.top)  / rect.height - pos.y_percent;
    startDrag.current = { offsetX, offsetY, w: pos.width_percent, h: pos.height_percent };

    const onMove_ = (ev) => {
      if (!startDrag.current) return;
      const r = containerRef.current.getBoundingClientRect();
      const { offsetX: ox, offsetY: oy, w, h } = startDrag.current;
      const newX = Math.max(0, Math.min(1 - w, (ev.clientX - r.left) / r.width  - ox));
      const newY = Math.max(0, Math.min(1 - h, (ev.clientY - r.top)  / r.height - oy));
      onMove(idx, newX, newY);
    };
    const onUp = () => {
      startDrag.current = null;
      document.removeEventListener('mousemove', onMove_);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onMove_);
    document.addEventListener('mouseup',   onUp);
  };

  const handleResizeMouseDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    startResize.current = {
      startX: e.clientX, startY: e.clientY,
      origW: pos.width_percent, origH: pos.height_percent,
      containerW: rect.width, containerH: rect.height,
    };
    const onResize_ = (ev) => {
      if (!startResize.current) return;
      const { startX, startY, origW, origH, containerW, containerH } = startResize.current;
      const newW = Math.max(0.08, Math.min(1 - pos.x_percent, origW + (ev.clientX - startX) / containerW));
      const newH = Math.max(0.03, Math.min(1 - pos.y_percent, origH + (ev.clientY - startY) / containerH));
      onResize(idx, newW, newH);
    };
    const onUp = () => {
      startResize.current = null;
      document.removeEventListener('mousemove', onResize_);
      document.removeEventListener('mouseup',   onUp);
    };
    document.addEventListener('mousemove', onResize_);
    document.addEventListener('mouseup',   onUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        left:   `${pos.x_percent      * 100}%`,
        top:    `${pos.y_percent      * 100}%`,
        width:  `${pos.width_percent  * 100}%`,
        height: `${pos.height_percent * 100}%`,
        border: `2px solid ${color}`,
        background: `${color}22`,
        cursor: 'move',
        userSelect: 'none',
        borderRadius: 3,
        zIndex: 10,
      }}
    >
      <div style={{ position: 'absolute', top: 2, left: 4, fontSize: 9, color, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '85%', textOverflow: 'ellipsis' }}>
        {idx + 1}. {name}
      </div>
      {/* Remove button */}
      <button
        onMouseDown={e => { e.stopPropagation(); onRemove(idx); }}
        style={{ position: 'absolute', top: -8, right: -8, background: color, border: 'none', borderRadius: '50%', width: 16, height: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11 }}
      >
        <X size={9} color="white" />
      </button>
      {/* Resize handle */}
      <div
        onMouseDown={handleResizeMouseDown}
        style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, cursor: 'se-resize', background: color, borderRadius: '2px 0 3px 0', opacity: 0.7 }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function FirmaLibreModal({ projectId, onClose, onCreated }) {
  const [step, setStep]     = useState(1); // 1=Documento, 2=Firmantes, 3=Posiciones
  const [title, setTitle]   = useState('');
  const [file, setFile]     = useState(null);
  const [signers, setSigners] = useState([{ ...EMPTY_SIGNER }]);
  const [positions, setPositions] = useState([]); // one per signer
  const [pdfPreviewUrl, setPdfPreviewUrl] = useState(null);
  const [pdfPage, setPdfPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const fileInputRef  = useRef(null);
  const containerRef  = useRef(null);

  // Step 1 — drop / select file
  const handleFile = useCallback((f) => {
    if (!f || f.type !== 'application/pdf') { setError('Solo se aceptan archivos PDF'); return; }
    if (f.size > 50 * 1024 * 1024) { setError('El archivo no puede superar 50 MB'); return; }
    setFile(f);
    if (pdfPreviewUrl) URL.revokeObjectURL(pdfPreviewUrl);
    setPdfPreviewUrl(URL.createObjectURL(f));
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
    setError('');
  }, [pdfPreviewUrl, title]);

  const handleDrop = (e) => {
    e.preventDefault();
    const f = e.dataTransfer.files[0];
    if (f) handleFile(f);
  };

  // Step 2 — signers CRUD
  const updateSigner = (i, field, val) => setSigners(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
  const addSigner    = () => setSigners(prev => [...prev, { ...EMPTY_SIGNER }]);
  const removeSigner = (i) => { if (signers.length === 1) return; setSigners(prev => prev.filter((_, idx) => idx !== i)); };

  // Go from step 2 → 3: init positions for each signer
  const goToPositions = () => {
    const defaultPos = signers.map((_, i) => ({
      x_percent: 0.05 + (i % 3) * 0.31,
      y_percent: 0.75 + Math.floor(i / 3) * 0.12,
      width_percent:  0.27,
      height_percent: 0.07,
    }));
    setPositions(defaultPos);
    setStep(3);
  };

  // Step 3 — position manipulation
  const movePos   = (i, x, y)   => setPositions(prev => prev.map((p, idx) => idx === i ? { ...p, x_percent: x, y_percent: y } : p));
  const resizePos = (i, w, h)   => setPositions(prev => prev.map((p, idx) => idx === i ? { ...p, width_percent: w, height_percent: h } : p));
  const removePos = (i) => {
    setPositions(prev => prev.map((p, idx) => idx === i ? null : p));
  };

  // Submit
  const handleSubmit = async () => {
    setError('');
    for (const [i, s] of signers.entries()) {
      if (!s.signer_name.trim()) return setError(`Nombre requerido en firmante ${i + 1}`);
      if (!s.signer_email.trim() || !s.signer_email.includes('@')) return setError(`Email inválido en firmante ${i + 1}`);
    }
    setLoading(true);
    try {
      const fd = new FormData();
      fd.append('file', file);
      fd.append('title', title.trim());
      const signersWithPos = signers.map((s, i) => ({
        ...s,
        sign_order: i + 1,
        ...(positions[i] || { x_percent: 0.1, y_percent: 0.75, width_percent: 0.27, height_percent: 0.07 }),
      }));
      fd.append('signers', JSON.stringify(signersWithPos));
      await freeSignaturesAPI.create(projectId, fd);
      onCreated?.();
      onClose();
    } catch (e) {
      setError(e.response?.data?.error || 'Error al crear la solicitud');
    } finally {
      setLoading(false);
    }
  };

  const canStep2 = file && title.trim();
  const canStep3 = signers.every(s => s.signer_name.trim() && s.signer_email.includes('@'));

  // ── Step indicators
  const steps = ['Documento', 'Firmantes', 'Posiciones'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-surface-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-brand-100 rounded-xl flex items-center justify-center">
              <Shield className="w-5 h-5 text-brand-600" />
            </div>
            <div>
              <h2 className="font-semibold text-surface-900">Firma de documento libre</h2>
              <p className="text-xs text-surface-500">Paso {step} de 3 — {steps[step - 1]}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-100 rounded-lg transition-colors">
            <X className="w-5 h-5 text-surface-400" />
          </button>
        </div>

        {/* Step tabs */}
        <div className="flex gap-0 px-6 pt-4 flex-shrink-0">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                ${step === i + 1 ? 'bg-brand-100 text-brand-700' : step > i + 1 ? 'text-emerald-600' : 'text-surface-400'}`}>
                {step > i + 1 ? <CheckCircle className="w-3 h-3" /> : <span className="w-4 h-4 rounded-full border flex items-center justify-center text-[10px]">{i + 1}</span>}
                {s}
              </div>
              {i < steps.length - 1 && <ArrowRight className="w-3 h-3 text-surface-300 mx-1" />}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-6">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* ── Step 1: Documento ── */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Título del documento</label>
                <input
                  type="text"
                  value={title}
                  onChange={e => setTitle(e.target.value)}
                  placeholder="Ej: Contrato de consultoría 2025"
                  className="input-field w-full"
                />
              </div>

              {/* Drop zone */}
              <div
                onDrop={handleDrop}
                onDragOver={e => e.preventDefault()}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors
                  ${file ? 'border-emerald-300 bg-emerald-50' : 'border-surface-200 hover:border-brand-300 hover:bg-brand-50'}`}
              >
                {file ? (
                  <div className="space-y-2">
                    <FileText className="w-10 h-10 text-emerald-500 mx-auto" />
                    <p className="font-medium text-surface-900">{file.name}</p>
                    <p className="text-xs text-surface-400">{(file.size / 1024).toFixed(0)} KB · <span className="text-brand-600 underline">Cambiar</span></p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Upload className="w-10 h-10 text-surface-300 mx-auto" />
                    <p className="font-medium text-surface-600">Arrastra el PDF aquí o haz clic para seleccionar</p>
                    <p className="text-xs text-surface-400">Solo archivos PDF · Máx. 50 MB</p>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden" onChange={e => handleFile(e.target.files[0])} />
            </div>
          )}

          {/* ── Step 2: Firmantes ── */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-surface-500">Define los firmantes en el orden en que deben firmar (secuencial).</p>
              {signers.map((s, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-surface-50 rounded-xl border border-surface-100">
                  <div className="flex items-center gap-2 mt-2">
                    <GripVertical className="w-4 h-4 text-surface-300" />
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: FIELD_COLORS[i % FIELD_COLORS.length] }}>
                      {i + 1}
                    </div>
                  </div>
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <input placeholder="Nombre completo" value={s.signer_name}
                      onChange={e => updateSigner(i, 'signer_name', e.target.value)}
                      className="input-field text-sm col-span-1" />
                    <input placeholder="Correo electrónico" value={s.signer_email} type="email"
                      onChange={e => updateSigner(i, 'signer_email', e.target.value)}
                      className="input-field text-sm col-span-1" />
                    <input placeholder="Rol (Ej: Representante Legal)" value={s.signer_role}
                      onChange={e => updateSigner(i, 'signer_role', e.target.value)}
                      className="input-field text-sm col-span-1" />
                  </div>
                  {signers.length > 1 && (
                    <button onClick={() => removeSigner(i)} className="mt-1.5 p-1.5 hover:bg-red-50 rounded-lg text-surface-400 hover:text-red-500 transition-colors">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  )}
                </div>
              ))}
              <button onClick={addSigner} className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700 font-medium px-2 py-1 hover:bg-brand-50 rounded-lg transition-colors">
                <UserPlus className="w-4 h-4" /> Agregar firmante
              </button>
            </div>
          )}

          {/* ── Step 3: Posiciones ── */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-surface-500">Arrastra los campos de firma al lugar donde debe firmar cada persona. Arrastra la esquina inferior derecha para redimensionar.</p>

              <div className="flex gap-3 flex-wrap">
                {signers.map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border"
                    style={{ borderColor: FIELD_COLORS[i % FIELD_COLORS.length], color: FIELD_COLORS[i % FIELD_COLORS.length], background: `${FIELD_COLORS[i % FIELD_COLORS.length]}15` }}>
                    <span>{i + 1}. {s.signer_name}</span>
                    {!positions[i] && <span className="opacity-60">(sin posición)</span>}
                  </div>
                ))}
              </div>

              {/* PDF preview with draggable signature fields */}
              <div className="border border-surface-200 rounded-xl overflow-hidden bg-surface-50">
                {/* Page navigation bar */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-100 bg-white">
                  <span className="text-xs text-surface-500">Página {pdfPage} — navega para posicionar campos en otras páginas</span>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => setPdfPage(p => Math.max(1, p - 1))}
                      disabled={pdfPage <= 1}
                      className="p-1 rounded hover:bg-surface-100 disabled:opacity-30 transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs font-medium w-6 text-center">{pdfPage}</span>
                    <button
                      type="button"
                      onClick={() => setPdfPage(p => p + 1)}
                      className="p-1 rounded hover:bg-surface-100 transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>

                {pdfPreviewUrl ? (
                  <div ref={containerRef} className="relative w-full" style={{ height: 460 }}>
                    {/* PDF iframe — visible but events blocked by overlay below */}
                    <iframe
                      src={`${pdfPreviewUrl}#page=${pdfPage}`}
                      className="w-full h-full"
                      title="PDF Preview"
                      style={{ display: 'block', border: 'none' }}
                    />

                    {/* ── Transparent overlay (zIndex 5) ───────────────────────────────
                        This sits on top of the iframe and prevents the browser's native
                        PDF viewer from capturing pointer events. Without this, Chrome's
                        PDF plugin renders above the DOM and steals all mouse events,
                        making the signature boxes un-draggable. The overlay is fully
                        transparent so the PDF remains visible underneath.          ── */}
                    <div
                      style={{
                        position: 'absolute', inset: 0,
                        zIndex: 5,
                        background: 'transparent',
                        cursor: 'default',
                      }}
                    />

                    {/* Signature field boxes — zIndex 10, above overlay */}
                    {positions.map((pos, i) =>
                      pos ? (
                        <SignatureFieldBox
                          key={i} idx={i} pos={pos}
                          name={signers[i]?.signer_name || `Firmante ${i + 1}`}
                          color={FIELD_COLORS[i % FIELD_COLORS.length]}
                          containerRef={containerRef}
                          onMove={movePos}
                          onResize={resizePos}
                          onRemove={removePos}
                        />
                      ) : null
                    )}
                  </div>
                ) : (
                  <div className="flex items-center justify-center text-surface-400 text-sm" style={{ height: 460 }}>
                    Sin vista previa disponible
                  </div>
                )}
              </div>

              <p className="text-xs text-surface-400">
                💡 El PDF está bloqueado para que puedas arrastrar los campos de firma. Usa los botones ‹ › para cambiar de página.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-6 border-t border-surface-100 flex-shrink-0">
          <button
            onClick={() => step > 1 ? setStep(s => s - 1) : onClose()}
            className="btn-secondary"
          >
            {step === 1 ? 'Cancelar' : 'Atrás'}
          </button>

          <div className="flex gap-2">
            {step === 1 && (
              <button onClick={() => { setError(''); setStep(2); }} disabled={!canStep2} className="btn-primary disabled:opacity-50">
                Siguiente <ArrowRight className="w-4 h-4 inline ml-1" />
              </button>
            )}
            {step === 2 && (
              <button onClick={() => { setError(''); goToPositions(); }} disabled={!canStep3} className="btn-primary disabled:opacity-50">
                Posicionar firmas <ArrowRight className="w-4 h-4 inline ml-1" />
              </button>
            )}
            {step === 3 && (
              <button onClick={handleSubmit} disabled={loading} className="btn-primary disabled:opacity-50">
                {loading ? <><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Enviando...</> : <><Shield className="w-4 h-4 inline mr-2" />Enviar para firma</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
