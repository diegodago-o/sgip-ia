import React, { useState, useRef, useCallback, useEffect } from 'react';
import {
  X, Upload, UserPlus, Trash2, GripVertical, ArrowRight,
  FileText, Shield, AlertCircle, Loader2, CheckCircle,
} from 'lucide-react';
import { freeSignaturesAPI } from '../../services/api';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL}/pdf.worker.min.js`;

const FIELD_COLORS = [
  '#2E86AB', '#E84855', '#3BB273', '#F18F01',
  '#7B2D8B', '#1B4332', '#C9184A', '#023E8A',
];
const EMPTY_SIGNER = { signer_name: '', signer_email: '', signer_role: '' };

// ── Renders ALL PDF pages stacked vertically as canvases ──────────────────────
// Using canvas (not iframe) means absolutely-positioned children receive
// pointer events correctly — no browser PDF-viewer OS-layer interference.
function PDFAllPages({ pdfUrl, onReady }) {
  const [pages, setPages] = useState([]); // [{canvas, width, height}]
  const [loading, setLoading] = useState(true);
  const canvasRefs = useRef([]);

  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        if (cancelled) return;
        const numPages = pdf.numPages;
        const pageData = [];
        for (let p = 1; p <= numPages; p++) {
          const page = await pdf.getPage(p);
          pageData.push({ page, num: p });
        }
        if (!cancelled) { setPages(pageData); }
      } catch (e) {
        if (!cancelled) { console.error('PDF load error:', e); setLoading(false); }
      }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl]);

  // Render each page into its canvas once refs are ready
  useEffect(() => {
    if (!pages.length) return;
    let cancelled = false;
    (async () => {
      const containerWidth = canvasRefs.current[0]?.parentElement?.parentElement?.clientWidth || 680;
      const pageHeights = [];
      for (let i = 0; i < pages.length; i++) {
        const canvas = canvasRefs.current[i];
        if (!canvas || cancelled) break;
        const { page } = pages[i];
        const nativeVp = page.getViewport({ scale: 1 });
        const scale    = containerWidth / nativeVp.width;
        const vp       = page.getViewport({ scale });
        canvas.width   = vp.width;
        canvas.height  = vp.height;
        await page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
        pageHeights.push(vp.height);
      }
      if (!cancelled) {
        setLoading(false);
        onReady?.({ totalPages: pages.length, pageHeights });
      }
    })();
    return () => { cancelled = true; };
  }, [pages, onReady]);

  return (
    <div style={{ position: 'relative' }}>
      {loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#f8fafc', zIndex: 1, minHeight: 200 }}>
          <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
        </div>
      )}
      {pages.map((_, i) => (
        <canvas
          key={i}
          ref={el => { canvasRefs.current[i] = el; }}
          style={{ display: 'block', width: '100%', borderBottom: i < pages.length - 1 ? '2px solid #e2e8f0' : 'none' }}
        />
      ))}
    </div>
  );
}

// ── Draggable signature field ─────────────────────────────────────────────────
// pos: { x_percent, y_percent, width_percent, height_percent }
// These are fractions of containerRef total scroll dimensions (all pages stacked).
function SignatureFieldBox({ idx, pos, name, color, scrollRef, containerRef, onMove, onRemove, onResize }) {
  const startDrag   = useRef(null);
  const startResize = useRef(null);

  const getContainerDims = () => {
    const el = containerRef.current;
    return { w: el.scrollWidth || el.offsetWidth, h: el.scrollHeight || el.offsetHeight };
  };

  const handleMouseDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const { w, h } = getContainerDims();
    const contRect = containerRef.current.getBoundingClientRect();
    // Offset = where inside the box the user clicked (preserves click point)
    const absX = e.clientX - contRect.left + (scrollRef.current?.scrollLeft || 0);
    const absY = e.clientY - contRect.top  + (scrollRef.current?.scrollTop  || 0);
    const offsetX = absX / w - pos.x_percent;
    const offsetY = absY / h - pos.y_percent;
    startDrag.current = { offsetX, offsetY, pw: pos.width_percent, ph: pos.height_percent };

    const onMove_ = (ev) => {
      if (!startDrag.current) return;
      const { w: cw, h: ch } = getContainerDims();
      const cr  = containerRef.current.getBoundingClientRect();
      const { offsetX: ox, offsetY: oy, pw, ph } = startDrag.current;
      const ax  = ev.clientX - cr.left + (scrollRef.current?.scrollLeft || 0);
      const ay  = ev.clientY - cr.top  + (scrollRef.current?.scrollTop  || 0);
      const newX = Math.max(0, Math.min(1 - pw, ax / cw - ox));
      const newY = Math.max(0, Math.min(1 - ph, ay / ch - oy));
      onMove(idx, newX, newY);
    };
    const onUp = () => {
      startDrag.current = null;
      document.removeEventListener('mousemove', onMove_);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove_);
    document.addEventListener('mouseup', onUp);
  };

  const handleResizeMouseDown = (e) => {
    e.preventDefault(); e.stopPropagation();
    const { w, h } = getContainerDims();
    startResize.current = {
      startX: e.clientX, startY: e.clientY,
      origW: pos.width_percent, origH: pos.height_percent,
      cw: w, ch: h,
    };
    const onResize_ = (ev) => {
      if (!startResize.current) return;
      const { startX, startY, origW, origH, cw, ch } = startResize.current;
      const newW = Math.max(0.06, Math.min(1 - pos.x_percent, origW + (ev.clientX - startX) / cw));
      const newH = Math.max(0.02, Math.min(1 - pos.y_percent, origH + (ev.clientY - startY) / ch));
      onResize(idx, newW, newH);
    };
    const onUp = () => {
      startResize.current = null;
      document.removeEventListener('mousemove', onResize_);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onResize_);
    document.addEventListener('mouseup', onUp);
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
        cursor: 'move', userSelect: 'none', borderRadius: 3, zIndex: 10,
        boxSizing: 'border-box',
      }}
    >
      <div style={{ position: 'absolute', top: 2, left: 4, fontSize: 9, color, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '85%', textOverflow: 'ellipsis' }}>
        {idx + 1}. {name}
      </div>
      <button
        onMouseDown={e => { e.stopPropagation(); onRemove(idx); }}
        style={{ position: 'absolute', top: -8, right: -8, background: color, border: 'none', borderRadius: '50%', width: 16, height: 16, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 11 }}
      >
        <X size={9} color="white" />
      </button>
      <div
        onMouseDown={handleResizeMouseDown}
        style={{ position: 'absolute', bottom: 0, right: 0, width: 12, height: 12, cursor: 'se-resize', background: color, borderRadius: '2px 0 3px 0', opacity: 0.8 }}
      />
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
export default function FirmaLibreModal({ projectId, onClose, onCreated }) {
  const [step, setStep]       = useState(1);
  const [title, setTitle]     = useState('');
  const [file, setFile]       = useState(null);
  const [signers, setSigners] = useState([{ ...EMPTY_SIGNER }]);
  // positions[i]: { x_percent, y_percent, width_percent, height_percent }
  // coordinates relative to total stacked document (all pages)
  const [positions, setPositions] = useState([]);
  const [pdfUrl, setPdfUrl]     = useState(null);
  const [pdfInfo, setPdfInfo]   = useState(null); // { totalPages, pageHeights }
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const fileInputRef = useRef(null);
  const scrollRef    = useRef(null); // the scrollable outer div
  const containerRef = useRef(null); // the inner div sized to all pages

  const handleFile = useCallback((f) => {
    if (!f || f.type !== 'application/pdf') { setError('Solo se aceptan archivos PDF'); return; }
    if (f.size > 50 * 1024 * 1024) { setError('El archivo no puede superar 50 MB'); return; }
    setFile(f);
    if (pdfUrl) URL.revokeObjectURL(pdfUrl);
    setPdfUrl(URL.createObjectURL(f));
    if (!title) setTitle(f.name.replace(/\.pdf$/i, ''));
    setError('');
  }, [pdfUrl, title]);

  const handleDrop = (e) => { e.preventDefault(); handleFile(e.dataTransfer.files[0]); };

  const updateSigner = (i, field, val) => setSigners(prev => prev.map((s, idx) => idx === i ? { ...s, [field]: val } : s));
  const addSigner    = () => setSigners(prev => [...prev, { ...EMPTY_SIGNER }]);
  const removeSigner = (i) => { if (signers.length === 1) return; setSigners(prev => prev.filter((_, idx) => idx !== i)); };

  // Step 2 → 3: initialize positions near bottom of last page
  const goToPositions = () => {
    const defaultPos = signers.map((_, i) => ({
      x_percent:      0.05 + (i % 3) * 0.31,
      y_percent:      0.88,   // near bottom of document
      width_percent:  0.27,
      height_percent: 0.04,
    }));
    setPositions(defaultPos);
    setStep(3);
  };

  const movePos   = (i, x, y) => setPositions(prev => prev.map((p, idx) => idx === i ? { ...p, x_percent: x, y_percent: y } : p));
  const resizePos = (i, w, h) => setPositions(prev => prev.map((p, idx) => idx === i ? { ...p, width_percent: w, height_percent: h } : p));
  const removePos = (i) => setPositions(prev => prev.map((p, idx) => idx === i ? null : p));

  // Convert document-relative y_percent → page_num + per-page y_percent
  const resolvePagePosition = useCallback((pos) => {
    if (!pdfInfo || !pos) return { page_num: 1, y_percent: pos?.y_percent || 0.8 };
    const { totalPages, pageHeights } = pdfInfo;
    const totalH = pageHeights.reduce((a, b) => a + b, 0);
    const absY   = pos.y_percent * totalH;
    let cumH = 0, pageNum = 1, yOnPage = pos.y_percent;
    for (let p = 0; p < pageHeights.length; p++) {
      if (absY <= cumH + pageHeights[p]) {
        pageNum  = p + 1;
        yOnPage  = (absY - cumH) / pageHeights[p];
        break;
      }
      cumH += pageHeights[p];
    }
    return { page_num: pageNum, y_percent: yOnPage };
  }, [pdfInfo]);

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
      const signersWithPos = signers.map((s, i) => {
        const pos    = positions[i] || { x_percent: 0.1, y_percent: 0.85, width_percent: 0.27, height_percent: 0.04 };
        const paged  = resolvePagePosition(pos);
        return {
          ...s,
          sign_order:     i + 1,
          page_num:       paged.page_num,
          x_percent:      pos.x_percent,
          y_percent:      paged.y_percent,  // per-page y
          width_percent:  pos.width_percent,
          height_percent: pos.height_percent,
        };
      });
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
  const steps    = ['Documento', 'Firmantes', 'Posiciones'];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-3xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between p-5 border-b border-surface-100 flex-shrink-0">
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
        <div className="flex gap-0 px-5 pt-4 flex-shrink-0">
          {steps.map((s, i) => (
            <div key={s} className="flex items-center">
              <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium transition-colors
                ${step === i + 1 ? 'bg-brand-100 text-brand-700' : step > i + 1 ? 'text-emerald-600' : 'text-surface-400'}`}>
                {step > i + 1
                  ? <CheckCircle className="w-3 h-3" />
                  : <span className="w-4 h-4 rounded-full border flex items-center justify-center text-[10px]">{i + 1}</span>}
                {s}
              </div>
              {i < steps.length - 1 && <span className="text-surface-300 mx-1 text-xs">›</span>}
            </div>
          ))}
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-5 min-h-0">
          {error && (
            <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 mb-4">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}

          {/* ── Step 1: Documento */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-surface-700 mb-1">Título del documento</label>
                <input type="text" value={title} onChange={e => setTitle(e.target.value)}
                  placeholder="Ej: Contrato de consultoría 2025" className="input-field w-full" />
              </div>
              <div
                onDrop={handleDrop} onDragOver={e => e.preventDefault()}
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
                    <p className="text-xs text-surface-400">Solo PDF · Máx. 50 MB</p>
                  </div>
                )}
              </div>
              <input ref={fileInputRef} type="file" accept="application/pdf" className="hidden"
                onChange={e => handleFile(e.target.files[0])} />
            </div>
          )}

          {/* ── Step 2: Firmantes */}
          {step === 2 && (
            <div className="space-y-3">
              <p className="text-sm text-surface-500">Define los firmantes en el orden en que deben firmar (secuencial).</p>
              {signers.map((s, i) => (
                <div key={i} className="flex items-start gap-3 p-3 bg-surface-50 rounded-xl border border-surface-100">
                  <div className="flex items-center gap-2 mt-2">
                    <GripVertical className="w-4 h-4 text-surface-300" />
                    <div className="w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold text-white"
                      style={{ background: FIELD_COLORS[i % FIELD_COLORS.length] }}>{i + 1}</div>
                  </div>
                  <div className="flex-1 grid grid-cols-3 gap-2">
                    <input placeholder="Nombre completo" value={s.signer_name}
                      onChange={e => updateSigner(i, 'signer_name', e.target.value)} className="input-field text-sm" />
                    <input placeholder="Correo electrónico" value={s.signer_email} type="email"
                      onChange={e => updateSigner(i, 'signer_email', e.target.value)} className="input-field text-sm" />
                    <input placeholder="Rol (Representante Legal...)" value={s.signer_role}
                      onChange={e => updateSigner(i, 'signer_role', e.target.value)} className="input-field text-sm" />
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

          {/* ── Step 3: Posiciones */}
          {step === 3 && (
            <div className="space-y-3">
              <p className="text-sm text-surface-500">
                Arrastra cada campo al lugar exacto donde debe firmar. Puedes hacer scroll por todo el documento.
                Arrastra la esquina inferior derecha para redimensionar.
              </p>

              {/* Signer chips */}
              <div className="flex gap-2 flex-wrap">
                {signers.map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium border"
                    style={{ borderColor: FIELD_COLORS[i % FIELD_COLORS.length], color: FIELD_COLORS[i % FIELD_COLORS.length], background: `${FIELD_COLORS[i % FIELD_COLORS.length]}15` }}>
                    {i + 1}. {s.signer_name}
                    {!positions[i] && <span className="opacity-50 ml-1">(sin campo)</span>}
                  </div>
                ))}
              </div>

              {/* PDF viewer + draggable fields */}
              <div className="border border-surface-200 rounded-xl overflow-hidden bg-surface-50">
                <div className="flex items-center justify-between px-3 py-1.5 border-b border-surface-100 bg-white">
                  <span className="text-xs text-surface-500">
                    Arrastra los campos de firma · {pdfInfo ? `${pdfInfo.totalPages} páginas` : 'Cargando...'}
                  </span>
                  <span className="text-xs text-surface-400">Scroll para navegar</span>
                </div>

                {/* scrollRef: outer scrollable container */}
                <div ref={scrollRef} style={{ maxHeight: 500, overflowY: 'auto', position: 'relative' }}>
                  {/* containerRef: inner div sized to ALL pages — reference for absolute positioning */}
                  <div ref={containerRef} style={{ position: 'relative' }}>
                    <PDFAllPages pdfUrl={pdfUrl} onReady={setPdfInfo} />
                    {/* Signature fields positioned relative to containerRef */}
                    {positions.map((pos, i) =>
                      pos ? (
                        <SignatureFieldBox
                          key={i} idx={i} pos={pos}
                          name={signers[i]?.signer_name || `Firmante ${i + 1}`}
                          color={FIELD_COLORS[i % FIELD_COLORS.length]}
                          scrollRef={scrollRef}
                          containerRef={containerRef}
                          onMove={movePos}
                          onResize={resizePos}
                          onRemove={removePos}
                        />
                      ) : null
                    )}
                  </div>
                </div>
              </div>

              <p className="text-xs text-surface-400">
                💡 Los campos se posicionan exactamente donde los arrastres. La firma del firmante quedará en esa posición dentro del PDF.
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between p-5 border-t border-surface-100 flex-shrink-0">
          <button onClick={() => step > 1 ? setStep(s => s - 1) : onClose()} className="btn-secondary">
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
                {loading
                  ? <><Loader2 className="w-4 h-4 animate-spin inline mr-2" />Enviando...</>
                  : <><Shield className="w-4 h-4 inline mr-2" />Enviar para firma</>}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
