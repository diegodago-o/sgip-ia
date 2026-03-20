import React, { useState, useRef, useEffect, useCallback } from 'react';
import {
  X, Shield, PenLine, Download, Loader2, UserPlus,
  AlertTriangle, GripVertical, ArrowRight, CheckCircle,
} from 'lucide-react';
import api, { corrSignaturesAPI } from '../../services/api';

const EMPTY_SIGNER = { signer_name: '', signer_email: '', signer_role: '' };

// Distinct colors — one per signer position
const FIELD_COLORS = [
  '#2E86AB', '#E84855', '#3BB273', '#F18F01',
  '#7B2D8B', '#1B4332', '#C9184A', '#023E8A',
];

// ─── Draggable field box drawn on the PDF overlay ──────────────────────────
function SignatureFieldBox({ idx, pos, name, color, containerRef, onMove, onRemove }) {
  const startDrag = useRef(null);

  const handleMouseDown = (e) => {
    e.preventDefault();
    e.stopPropagation();
    const rect = containerRef.current.getBoundingClientRect();
    startDrag.current = {
      startX: e.clientX,
      startY: e.clientY,
      origX: pos.x_percent,
      origY: pos.y_percent,
      containerW: rect.width,
      containerH: rect.height,
    };

    const handleMouseMove = (ev) => {
      if (!startDrag.current) return;
      const { startX, startY, origX, origY, containerW, containerH } = startDrag.current;
      const dx = (ev.clientX - startX) / containerW;
      const dy = (ev.clientY - startY) / containerH;
      const newX = Math.max(0, Math.min(1 - pos.width_percent, origX + dx));
      const newY = Math.max(0, Math.min(1 - pos.height_percent, origY + dy));
      onMove(idx, newX, newY);
    };

    const handleMouseUp = () => {
      startDrag.current = null;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  };

  return (
    <div
      onMouseDown={handleMouseDown}
      style={{
        position: 'absolute',
        left:   `${pos.x_percent     * 100}%`,
        top:    `${pos.y_percent     * 100}%`,
        width:  `${pos.width_percent * 100}%`,
        height: `${pos.height_percent* 100}%`,
        border: `2px dashed ${color}`,
        background: `${color}22`,
        cursor: 'move',
        zIndex: 20,
        userSelect: 'none',
        pointerEvents: 'auto',   // override parent pointer-events:none
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxSizing: 'border-box',
      }}
    >
      <div style={{ pointerEvents: 'none', textAlign: 'center', padding: '2px 4px' }}>
        <div style={{ fontSize: '9px', fontWeight: 700, color, lineHeight: 1.2 }}>
          ✍ {name}
        </div>
      </div>
      {/* Remove button */}
      <button
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => { e.stopPropagation(); onRemove(idx); }}
        style={{
          position: 'absolute', top: -8, right: -8,
          width: 16, height: 16, borderRadius: '50%',
          background: color, color: '#fff', border: 'none',
          cursor: 'pointer', fontSize: 10,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1, pointerEvents: 'auto',
        }}
      >✕</button>
    </div>
  );
}

// ─── Main Modal ────────────────────────────────────────────────────────────
export default function CorrSignatureModal({
  projectId, corrItem, existingRequest, onClose, onChanged,
}) {
  // Terminal: cancelled/rejected → always show create form directly
  const isTerminal     = ['cancelled', 'rejected'].includes(existingRequest?.status);
  const hasActiveRequest = !isTerminal && existingRequest && existingRequest.status;
  // canStartNew: completed → allow new process alongside existing
  const canStartNew    = existingRequest?.status === 'completed';

  const [step, setStep] = useState(hasActiveRequest ? 'status' : 'signers');

  // ── Signers step ──
  const [signers, setSigners] = useState([{ ...EMPTY_SIGNER }, { ...EMPTY_SIGNER }]);

  // ── Position step ──
  const [pdfUrl,     setPdfUrl]     = useState(null);
  const [pdfLoading, setPdfLoading] = useState(false);
  // { signerIdx: { x_percent, y_percent, width_percent, height_percent, page_num } }
  const [placedFields, setPlacedFields] = useState({});
  // containerRef points to the page-1 overlay div (top 50% of 2-page outer container = 1 LETTER page).
  const containerRef    = useRef(null);
  // scrollWrapperEl: callback ref (useState) for the overflow-y:auto scroll wrapper.
  // Using useState instead of useRef so that the wheel-capture useEffect re-runs
  // the instant this div mounts into the DOM.
  const [scrollWrapperEl, setScrollWrapperEl] = useState(null);
  // (interceptorEl removed — DnD is now handled directly on the page-1 overlay div)

  // ── Shared ──
  const [saving,     setSaving]     = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [err, setErr] = useState('');

  // Clean up blob URL when component unmounts
  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);

  // Load PDF (authenticated) for the position step.
  // Appending #toolbar=0&navpanes=0&scrollbar=0 hides Chrome's PDF viewer chrome (toolbar,
  // nav-pane, scrollbar), so the PDF content fills the iframe exactly without offset,
  // giving accurate coordinate mapping between the drop position and the PDF page.
  const loadPdf = useCallback(async () => {
    setPdfLoading(true);
    try {
      const r = await api.get(
        `/exec/${projectId}/correspondence/${corrItem.id}/firma/pdf`,
        { responseType: 'arraybuffer' },
      );
      const blobUrl = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
      // &view=FitH fuerza zoom "fit-to-width" en el visor de Chrome, evitando que
      // el auto-zoom reduzca el documento a "fit-all-pages" un segundo después de cargar.
      setPdfUrl(blobUrl + '#toolbar=0&navpanes=0&scrollbar=0&view=FitH');
    } catch {
      setErr('Error al cargar el PDF. Verifique que el documento esté guardado correctamente.');
    } finally { setPdfLoading(false); }
  }, [projectId, corrItem.id]);

  // Window-level CAPTURE wheel listener.
  //
  // Why window + capture phase?
  // Chrome's PDF viewer runs in a separate compositor/renderer process. Wheel events
  // are routed at the OS/GPU compositor level — before the DOM stacking context or
  // pointer-events CSS can intervene. Even an overlay div with z-index:999 cannot
  // intercept them via bubble-phase listeners.
  //
  // The ONLY point where JS can reliably intercept before Chrome's PDF renderer is
  // window.addEventListener(..., { capture: true }) — which fires first in the event
  // pipeline, ahead of any element (including cross-process iframes).
  //
  // Strategy:
  //   1. Capture every wheel event on the window.
  //   2. Check if the cursor is inside the scroll wrapper bounds.
  //   3. If yes → preventDefault() (blocks PDF viewer) + manually set scrollTop.
  //   4. If no  → do nothing (let the event proceed normally elsewhere on the page).
  useEffect(() => {
    if (!scrollWrapperEl) return;
    const onWheelCapture = (e) => {
      const rect = scrollWrapperEl.getBoundingClientRect();
      if (
        e.clientX >= rect.left && e.clientX <= rect.right &&
        e.clientY >= rect.top  && e.clientY <= rect.bottom
      ) {
        e.preventDefault();
        scrollWrapperEl.scrollTop += e.deltaY;
      }
    };
    window.addEventListener('wheel', onWheelCapture, { capture: true, passive: false });
    return () => window.removeEventListener('wheel', onWheelCapture, { capture: true });
  }, [scrollWrapperEl]);

  // ── Validate signers & advance to position step ──
  const goToPosition = () => {
    const valid = signers.filter(s => s.signer_name.trim() && s.signer_email.trim());
    if (valid.length < 1) { setErr('Agregue al menos un firmante con nombre y correo.'); return; }
    const emailRx = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    for (const s of valid) {
      if (!emailRx.test(s.signer_email)) { setErr(`Correo inválido: ${s.signer_email}`); return; }
    }
    setErr('');
    setStep('position');
    if (!pdfUrl) loadPdf();
  };

  // ── HTML5 DnD — handled on the CONTAINER div (overlay has pointer-events:none) ──
  const handleDragStart = (e, idx) => {
    e.dataTransfer.setData('signerIndex', String(idx));
    e.dataTransfer.effectAllowed = 'copy';
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    const idxStr = e.dataTransfer.getData('signerIndex');
    if (idxStr === '') return;
    const idx = parseInt(idxStr, 10);
    if (isNaN(idx) || !containerRef.current) return;
    // containerRef = full 2-page container; coords are fractions of 2-page area.
    // x_percent / width_percent are fractions of page width (0-1, unchanged).
    // y_percent / height_percent are fractions of the FULL 2-page container height.
    //   y=0.0 → top of page 1 | y=0.5 → top of page 2 | y=1.0 → bottom of page 2
    //   height_percent=0.04 = 4% of 2-page height = 8% of 1 page (same visual size)
    const rect = containerRef.current.getBoundingClientRect();
    const W = 0.22;
    const H = 0.04; // 4% of 2-page container ≡ 8% of 1 page
    const x = Math.max(0, Math.min(1 - W, (e.clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1 - H, (e.clientY - rect.top)  / rect.height));
    setPlacedFields(prev => ({
      ...prev,
      [idx]: { x_percent: x, y_percent: y, width_percent: W, height_percent: H },
    }));
  };

  const handleMoveField = (idx, newX, newY) => {
    setPlacedFields(prev => ({
      ...prev,
      [idx]: { ...prev[idx], x_percent: newX, y_percent: newY },
    }));
  };

  const handleRemoveField = (idx) => {
    setPlacedFields(prev => { const n = { ...prev }; delete n[idx]; return n; });
  };

  // ── POST: create signature process ──
  const handleCreate = async () => {
    const validSigners = signers.filter(s => s.signer_name.trim() && s.signer_email.trim());
    const missing = validSigners.findIndex((_, i) => !placedFields[i]);
    if (missing !== -1) {
      setErr(`Arrastra el campo de firma de "${validSigners[missing].signer_name}" al documento.`);
      return;
    }
    setSaving(true); setErr('');
    try {
      await corrSignaturesAPI.create(projectId, corrItem.id, {
        signers: validSigners.map((s, i) => {
          const f = placedFields[i];
          // Convert from 2-page UI fractions → single-page backend fractions.
          // y_percent in UI is 0-1 over 2 pages: [0,0.5) = page 1, [0.5,1) = page 2.
          const page_num = f.y_percent < 0.5 ? 1 : 2;
          const y_page   = page_num === 1 ? f.y_percent * 2 : (f.y_percent - 0.5) * 2;
          const h_page   = f.height_percent * 2; // 0.04*2 = 0.08 per-page fraction
          return {
            name:           s.signer_name.trim(),
            email:          s.signer_email.trim(),
            role:           s.signer_role?.trim() || '',
            order:          i + 1,
            page_num,
            x_percent:      f.x_percent,
            y_percent:      y_page,
            width_percent:  f.width_percent,
            height_percent: h_page,
          };
        }),
      });
      onChanged();
    } catch (e) {
      setErr(e.response?.data?.error || 'Error al iniciar el proceso de firmas.');
      setSaving(false);
    }
  };

  // ── DELETE: cancel signature process ──
  const handleCancel = async () => {
    if (!window.confirm('¿Cancelar el proceso de firmas? Se notificará a los firmantes.')) return;
    setCancelling(true);
    try {
      await corrSignaturesAPI.cancel(projectId, corrItem.id);
      onChanged();
    } catch (e) {
      setErr(e.response?.data?.error || 'Error al cancelar.');
      setCancelling(false);
    }
  };

  // ── Status view helpers ──
  const req         = existingRequest;
  const reqSigners  = existingRequest?.signers || [];
  const signedCount = reqSigners.filter(s => s.status === 'signed').length;
  const fmtTs = (ts) => ts
    ? new Date(ts).toLocaleString('es-CO', {
        day: '2-digit', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit', timeZone: 'America/Bogota',
      })
    : '';

  // Valid signers for position step
  const validSignersForPos = signers.filter(s => s.signer_name.trim() && s.signer_email.trim());

  // ── Tab helpers ──
  // Tabs appear only when there's a completed request (so user can start a new one)
  const TabToggle = ({ current }) => (
    <div className="flex rounded-lg border border-gray-200 overflow-hidden text-xs font-medium mb-1">
      <button
        onClick={() => setStep('status')}
        className={`flex-1 py-2 transition-colors ${
          current === 'status' ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'
        }`}
      >Actividad</button>
      <button
        onClick={() => { setStep('signers'); setErr(''); }}
        className={`flex-1 py-2 transition-colors ${
          current === 'signers' || current === 'position'
            ? 'bg-brand-600 text-white' : 'text-gray-600 hover:bg-gray-50'
        }`}
      >Nuevo proceso</button>
    </div>
  );

  // ──────────────────────────────────────────────────────────────────────────
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4">
      <div
        className={`bg-white rounded-2xl shadow-2xl w-full overflow-hidden flex flex-col
          ${step === 'position' ? 'max-w-5xl h-[90vh]' : 'max-w-lg max-h-[90vh]'}`}
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100
          bg-gradient-to-r from-brand-50 to-blue-50 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Shield size={18} className="text-brand-600" />
            <div>
              <h2 className="font-semibold text-gray-800 text-sm">Firmas Digitales</h2>
              <p className="text-xs text-gray-400 truncate max-w-sm">
                {corrItem.consecutive_code} — {corrItem.subject}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {/* Step breadcrumb — shown in create flow */}
            {!hasActiveRequest && step !== 'status' && (
              <div className="flex items-center gap-1.5 text-xs text-gray-400">
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                  ${step === 'signers' ? 'bg-brand-600 text-white' : 'bg-green-500 text-white'}`}>
                  {step === 'signers' ? '1' : '✓'}
                </span>
                <span className={step === 'signers' ? 'text-brand-600 font-medium' : 'text-gray-400'}>
                  Firmantes
                </span>
                <span className="w-4 h-px bg-gray-300" />
                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold
                  ${step === 'position' ? 'bg-brand-600 text-white' : 'bg-gray-200 text-gray-400'}`}>
                  2
                </span>
                <span className={step === 'position' ? 'text-brand-600 font-medium' : 'text-gray-400'}>
                  Posicionar
                </span>
              </div>
            )}
            <button onClick={onClose}
              className="w-7 h-7 rounded-lg hover:bg-gray-100 flex items-center justify-center">
              <X size={16} className="text-gray-400" />
            </button>
          </div>
        </div>

        {/* ════════════════════ STEP: SIGNERS ════════════════════ */}
        {step === 'signers' && (
          <>
            <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
              {/* Tab toggle — only when returning from completed status */}
              {canStartNew && <TabToggle current="signers" />}

              {/* Terminal state banner */}
              {isTerminal && (
                <div className={`text-xs rounded-lg p-3 leading-relaxed border
                  ${existingRequest?.status === 'rejected'
                    ? 'bg-red-50 border-red-200 text-red-700'
                    : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  <strong>
                    {existingRequest?.status === 'rejected' ? '✕ Proceso rechazado.' : '⊘ Proceso cancelado.'}
                  </strong> Puedes iniciar un nuevo proceso de firmas.
                </div>
              )}
              {/* Completed — info note */}
              {canStartNew && (
                <div className="text-xs text-amber-700 bg-amber-50 border border-amber-200
                  rounded-lg p-3 leading-relaxed">
                  <strong>Nota:</strong> El documento ya tiene un proceso completado.
                  Iniciar uno nuevo es útil si editaste el contenido. El certificado anterior sigue siendo válido.
                </div>
              )}

              {/* Info banner */}
              {!canStartNew && (
                <p className="text-xs text-gray-500 leading-relaxed bg-blue-50 rounded-lg p-3 border border-blue-100">
                  <strong>Firma electrónica con validez legal</strong> (Ley 527/1999). Cada firmante recibirá
                  un correo con un enlace único. En el siguiente paso posicionarás exactamente <em>dónde</em>
                  aparecerá la firma de cada uno en el documento PDF.
                </p>
              )}

              {/* Signer list */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-gray-600">Firmantes (en orden de firma)</p>
                  <button
                    onClick={() => setSigners(prev => [...prev, { ...EMPTY_SIGNER }])}
                    className="flex items-center gap-1 text-xs text-brand-600 hover:text-brand-700"
                  >
                    <UserPlus size={12} /> Agregar
                  </button>
                </div>

                {signers.map((s, i) => {
                  const color = FIELD_COLORS[i % FIELD_COLORS.length];
                  return (
                    <div key={i} className="rounded-xl border border-gray-200 p-3 space-y-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full"
                          style={{ background: `${color}22`, color }}>
                          Firmante #{i + 1}
                        </span>
                        {signers.length > 1 && (
                          <button
                            onClick={() => setSigners(prev => prev.filter((_, idx) => idx !== i))}
                            className="text-gray-300 hover:text-red-400">
                            <X size={12} />
                          </button>
                        )}
                      </div>
                      <div className="grid grid-cols-2 gap-2">
                        <input type="text" placeholder="Nombre completo *"
                          value={s.signer_name}
                          onChange={e => setSigners(prev =>
                            prev.map((x, idx) => idx === i ? { ...x, signer_name: e.target.value } : x))}
                          className="col-span-2 border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs
                            focus:outline-none focus:border-brand-400" />
                        <input type="email" placeholder="Correo electrónico *"
                          value={s.signer_email}
                          onChange={e => setSigners(prev =>
                            prev.map((x, idx) => idx === i ? { ...x, signer_email: e.target.value } : x))}
                          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs
                            focus:outline-none focus:border-brand-400" />
                        <input type="text" placeholder="Cargo / Rol"
                          value={s.signer_role}
                          onChange={e => setSigners(prev =>
                            prev.map((x, idx) => idx === i ? { ...x, signer_role: e.target.value } : x))}
                          className="border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs
                            focus:outline-none focus:border-brand-400" />
                      </div>
                    </div>
                  );
                })}
              </div>

              {err && (
                <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50
                  rounded-lg px-3 py-2 border border-red-100">
                  <AlertTriangle size={12} /> {err}
                </div>
              )}
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-2 flex-shrink-0">
              <button onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
              <button onClick={goToPosition} className="btn-primary text-sm flex items-center gap-2">
                <ArrowRight size={14} /> Siguiente: Posicionar firmas
              </button>
            </div>
          </>
        )}

        {/* ════════════════════ STEP: POSITION ════════════════════ */}
        {step === 'position' && (
          <>
            <div className="flex flex-1 overflow-hidden">
              {/* Left panel — signer chips to drag */}
              <div className="w-56 flex-shrink-0 border-r border-gray-100 p-4 space-y-3 overflow-y-auto bg-white">
                <p className="text-xs font-semibold text-gray-700">Firmantes</p>
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  Arrastra cada firmante al documento para indicar dónde debe aparecer su firma.
                </p>

                {validSignersForPos.map((s, i) => {
                  const color = FIELD_COLORS[i % FIELD_COLORS.length];
                  const placed = !!placedFields[i];
                  return (
                    <div
                      key={i}
                      draggable={!placed}
                      onDragStart={(e) => handleDragStart(e, i)}
                      className={`rounded-xl border p-2.5 select-none transition-all
                        ${placed
                          ? 'opacity-60 cursor-default'
                          : 'cursor-grab hover:shadow-sm active:cursor-grabbing'}`}
                      style={{ borderColor: color, background: `${color}11` }}
                    >
                      <div className="flex items-center gap-2">
                        {placed
                          ? <CheckCircle size={12} className="text-green-500 flex-shrink-0" />
                          : <GripVertical size={12} style={{ color }} className="flex-shrink-0" />}
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold truncate" style={{ color }}>
                            #{i + 1} {s.signer_name}
                          </p>
                          {s.signer_role && (
                            <p className="text-[10px] text-gray-400 truncate">{s.signer_role}</p>
                          )}
                        </div>
                      </div>
                      {placed && (
                        <button
                          onClick={() => handleRemoveField(i)}
                          className="mt-1.5 w-full text-[10px] text-red-400 hover:text-red-600 text-left">
                          ✕ Quitar posición
                        </button>
                      )}
                    </div>
                  );
                })}

                <div className="pt-2 border-t border-gray-100">
                  <p className="text-[10px] text-gray-400">
                    {Object.keys(placedFields).length} de {validSignersForPos.length} posicionados
                  </p>
                </div>

                {err && (
                  <div className="text-red-600 text-[10px] bg-red-50 rounded-lg px-2 py-1.5
                    border border-red-100 leading-relaxed">
                    {err}
                  </div>
                )}
              </div>

              {/* Right panel — scrollable container + PDF iframe + overlay */}
              <div className="flex-1 flex flex-col overflow-hidden bg-gray-100">
                <div className="px-4 py-2 bg-white border-b border-gray-100 text-xs text-gray-500 flex-shrink-0">
                  Vista previa · Arrastra los firmantes a la posición exacta de su firma ·
                  <span className="text-brand-600 font-medium ml-1">Scroll habilitado</span>
                </div>

                {pdfLoading ? (
                  <div className="flex-1 flex items-center justify-center">
                    <Loader2 size={32} className="animate-spin text-brand-400" />
                  </div>
                ) : pdfUrl ? (
                  /*
                    Scrollable outer wrapper — scrollTop driven by window-capture wheel listener.
                    The outer div is 2 LETTER pages tall (258.82% = 792/612 × 200) so that:
                      1. The iframe fills 2 full pages and shows all PDF content (Bug 1 fix).
                      2. The scroll wrapper has real overflow to scroll (Bug 2 fix).
                    containerRef points to the page-1 overlay (top 50% = exactly 1 page).
                    All DnD coordinate calculations use getBoundingClientRect() on containerRef,
                    which covers only page 1 — keeping signature placement accurate.
                  */
                  <div ref={setScrollWrapperEl} className="flex-1 overflow-y-auto p-2">
                    {/*
                      2-page proportional container — containerRef points here.
                      paddingBottom 258.82% = 792/612 × 200% = 2 LETTER pages.
                      Coordinates (x_percent, y_percent) are fractions of THIS element:
                        x: 0-1 across the page width
                        y: 0-0.5 = page 1  |  0.5-1.0 = page 2
                      Converted to per-page fractions only when POSTing to backend.
                    */}
                    <div
                      ref={containerRef}
                      className="relative w-full"
                      style={{ paddingBottom: '258.82%' }}
                      onDragOver={handleDragOver}
                      onDrop={handleDrop}
                    >
                      {/* Layer 1 — PDF iframe, fills entire 2-page area (pointer-events off) */}
                      <iframe
                        src={pdfUrl}
                        title="PDF preview"
                        className="absolute inset-0 w-full h-full border-0"
                        style={{ zIndex: 1, pointerEvents: 'none' }}
                      />

                      {/* Layer 2 — signature field boxes, positioned relative to the full
                          2-page container so they can be placed on either page. */}
                      {Object.entries(placedFields).map(([idxStr, pos]) => {
                        const i = parseInt(idxStr, 10);
                        const signer = validSignersForPos[i];
                        if (!signer) return null;
                        return (
                          <SignatureFieldBox
                            key={i}
                            idx={i}
                            pos={pos}
                            name={signer.signer_name}
                            color={FIELD_COLORS[i % FIELD_COLORS.length]}
                            containerRef={containerRef}
                            onMove={handleMoveField}
                            onRemove={handleRemoveField}
                          />
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="flex-1 flex items-center justify-center text-gray-400 text-sm">
                    No se pudo cargar el PDF.
                  </div>
                )}
              </div>
            </div>

            <div className="px-6 py-4 border-t border-gray-100 flex justify-between items-center
              flex-shrink-0 bg-white">
              <button onClick={() => { setStep('signers'); setErr(''); }}
                className="btn-ghost text-sm">← Volver</button>
              <div className="flex gap-2">
                <button onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
                <button
                  onClick={handleCreate}
                  disabled={saving || Object.keys(placedFields).length < validSignersForPos.length}
                  className="btn-primary text-sm flex items-center gap-2 disabled:opacity-50
                    disabled:cursor-not-allowed">
                  {saving
                    ? <Loader2 size={14} className="animate-spin" />
                    : <PenLine size={14} />}
                  Iniciar proceso de firmas
                </button>
              </div>
            </div>
          </>
        )}

        {/* ════════════════════ STEP: STATUS ════════════════════ */}
        {step === 'status' && (() => {
          // Build activity timeline
          const events = [];
          if (req?.created_at)
            events.push({ icon: '🚀', color: 'bg-brand-100 text-brand-700', text: 'Proceso de firmas iniciado', sub: '', ts: req.created_at });
          reqSigners.forEach(s => {
            if (s.status !== 'pending')
              events.push({ icon: '📧', color: 'bg-blue-100 text-blue-700', text: `Correo enviado a ${s.signer_name}`, sub: s.signer_email, ts: req.created_at });
            if (['viewed', 'signed', 'rejected'].includes(s.status))
              events.push({ icon: '👁', color: 'bg-yellow-100 text-yellow-700', text: `Enlace abierto por ${s.signer_name}`, sub: s.signer_email, ts: null });
            if (s.status === 'signed')
              events.push({ icon: '✍️', color: 'bg-green-100 text-green-700', text: `Documento firmado por ${s.signer_name}`, sub: `${s.signer_email}${s.ip_address ? ' · IP: ' + s.ip_address : ''}`, ts: s.signed_at });
            if (s.status === 'rejected')
              events.push({ icon: '✗', color: 'bg-red-100 text-red-700', text: `Rechazado por ${s.signer_name}`, sub: s.rejection_reason || s.signer_email, ts: s.signed_at });
          });
          if (req?.status === 'completed' && req?.completed_at)
            events.push({ icon: '✅', color: 'bg-emerald-100 text-emerald-700', text: 'Proceso completado — todos firmaron', sub: '', ts: req.completed_at });

          return (
            <>
              <div className="px-6 py-5 space-y-4 overflow-y-auto flex-1">
                {/* Tab toggle — shown when process is completed */}
                {canStartNew && <TabToggle current="status" />}

                {/* Status pill + progress */}
                <div className="flex items-center justify-between">
                  <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${
                    req?.status === 'completed' ? 'bg-green-100 text-green-700' :
                    req?.status === 'rejected'  ? 'bg-red-100 text-red-600'    :
                    req?.status === 'cancelled' ? 'bg-gray-100 text-gray-500'  : 'bg-blue-100 text-blue-700'
                  }`}>
                    {{ in_progress: 'En progreso', completed: 'Completado', rejected: 'Rechazado', cancelled: 'Cancelado' }[req?.status] || req?.status}
                  </span>
                  <span className="text-xs text-gray-400">{signedCount} / {reqSigners.length} firmados</span>
                </div>
                <div className="w-full bg-gray-100 rounded-full h-1">
                  <div
                    className={`h-1 rounded-full transition-all ${req?.status === 'completed' ? 'bg-green-500' : 'bg-brand-500'}`}
                    style={{ width: `${reqSigners.length ? (signedCount / reqSigners.length) * 100 : 0}%` }}
                  />
                </div>

                {/* Timeline */}
                <div className="relative mt-2">
                  {events.map((ev, i) => (
                    <div key={i} className="flex gap-3 pb-4 relative">
                      {i < events.length - 1 && (
                        <div className="absolute left-3.5 top-7 bottom-0 w-px bg-gray-200" />
                      )}
                      <div className={`w-7 h-7 rounded-full flex-shrink-0 flex items-center
                        justify-center text-sm z-10 ${ev.color}`}>
                        {ev.icon}
                      </div>
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
                        const r = await corrSignaturesAPI.certificate(projectId, corrItem.id);
                        const url = URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }));
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `Firmado_${corrItem.consecutive_code}.pdf`;
                        a.click();
                        URL.revokeObjectURL(url);
                      } catch { setErr('Error al descargar el PDF firmado.'); }
                    }}
                    className="w-full text-xs text-green-700 border border-green-300 bg-green-50
                      rounded-xl py-2.5 hover:bg-green-100 transition-colors font-semibold
                      flex items-center justify-center gap-1.5"
                  >
                    <Download size={13} className="text-green-700" />
                    Descargar PDF firmado + auditoría
                  </button>
                )}
                {req?.status === 'in_progress' && (
                  <button
                    onClick={handleCancel}
                    disabled={cancelling}
                    className="w-full text-xs text-red-500 border border-red-200 rounded-xl py-2
                      hover:bg-red-50 transition-colors disabled:opacity-50
                      flex items-center justify-center gap-1"
                  >
                    {cancelling && <Loader2 size={12} className="animate-spin" />}
                    Cancelar proceso de firmas
                  </button>
                )}

                {err && (
                  <div className="flex items-center gap-2 text-red-600 text-xs bg-red-50
                    rounded-lg px-3 py-2 border border-red-100">
                    <AlertTriangle size={12} /> {err}
                  </div>
                )}
              </div>

              <div className="px-6 py-4 border-t border-gray-100 flex justify-end flex-shrink-0">
                <button onClick={onClose} className="btn-ghost text-sm">Cerrar</button>
              </div>
            </>
          );
        })()}
      </div>
    </div>
  );
}
