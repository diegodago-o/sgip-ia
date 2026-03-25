import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import {
  CheckCircle, XCircle, AlertTriangle, PenLine, RotateCcw,
  FileText, Shield, Loader2, Type, ImageIcon, Smartphone, Upload, MapPin,
} from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';

pdfjsLib.GlobalWorkerOptions.workerSrc = `${process.env.PUBLIC_URL}/pdf.worker.min.js`;

const PUBLIC_API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

// Resolución 2x para exportación nítida al PDF (independiente del DPR del dispositivo)
const CANVAS_SCALE = 2;

/* ── Canvas signature pad (draw) ────────────────────────── */
function SignaturePad({ onSigned, disabled }) {
  const canvasRef    = useRef(null);
  const drawing      = useRef(false);
  const lastPos      = useRef({ x: 0, y: 0 });
  const hasStrokeRef = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);
  // Dimensiones lógicas del área de dibujo
  const W = 700, H = 180;

  useEffect(() => { hasStrokeRef.current = hasStroke; }, [hasStroke]);

  const getPos = (e, canvas) => {
    const rect = canvas.getBoundingClientRect();
    const src  = e.touches ? e.touches[0] : e;
    return {
      x: (src.clientX - rect.left) * (canvas.width  / rect.width),
      y: (src.clientY - rect.top)  * (canvas.height / rect.height),
    };
  };

  const startDraw = useCallback((e) => {
    if (disabled) return;
    e.preventDefault();
    drawing.current = true;
    const pos = getPos(e, canvasRef.current);
    lastPos.current = pos;
    const ctx = canvasRef.current.getContext('2d');
    ctx.beginPath(); ctx.arc(pos.x, pos.y, 1.5 * CANVAS_SCALE, 0, 2 * Math.PI);
    ctx.fillStyle = '#1e3a5f'; ctx.fill();
  }, [disabled]);

  const draw = useCallback((e) => {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1e3a5f'; ctx.lineWidth = 2.5 * CANVAS_SCALE;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.stroke();
    lastPos.current = pos;
    setHasStroke(true);
  }, [disabled]);

  const endDraw = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasStrokeRef.current && canvasRef.current)
      onSigned(canvasRef.current.toDataURL('image/png'));
  }, [onSigned]);

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false); hasStrokeRef.current = false; onSigned(null);
  };

  useEffect(() => {
    const canvas = canvasRef.current;
    canvas.addEventListener('mousedown',  startDraw, { passive: false });
    canvas.addEventListener('mousemove',  draw,      { passive: false });
    canvas.addEventListener('mouseup',    endDraw);
    canvas.addEventListener('mouseleave', endDraw);
    canvas.addEventListener('touchstart', startDraw, { passive: false });
    canvas.addEventListener('touchmove',  draw,      { passive: false });
    canvas.addEventListener('touchend',   endDraw);
    return () => {
      canvas.removeEventListener('mousedown',  startDraw);
      canvas.removeEventListener('mousemove',  draw);
      canvas.removeEventListener('mouseup',    endDraw);
      canvas.removeEventListener('mouseleave', endDraw);
      canvas.removeEventListener('touchstart', startDraw);
      canvas.removeEventListener('touchmove',  draw);
      canvas.removeEventListener('touchend',   endDraw);
    };
  }, [startDraw, draw, endDraw]);

  return (
    <div className="space-y-2">
      <div className={`relative border-2 rounded-xl overflow-hidden bg-white
        ${disabled ? 'opacity-50 cursor-not-allowed' : 'border-brand-300 cursor-crosshair shadow-inner'}`}
        style={{ height: 180 }}>
        {/* canvas 2x — se muestra al tamaño CSS, se exporta en alta resolución */}
        <canvas ref={canvasRef} width={W * CANVAS_SCALE} height={H * CANVAS_SCALE}
          className="w-full h-full" style={{ touchAction: 'none' }} />
        {!hasStroke && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm select-none">Dibuje su firma aquí</span>
          </div>
        )}
      </div>
      <button type="button" onClick={clear} disabled={disabled || !hasStroke}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        <RotateCcw size={12} /> Limpiar
      </button>
    </div>
  );
}

/* ── Type signature pad ─────────────────────────────────── */
function TypeSignaturePad({ onSigned, disabled, defaultName }) {
  const [text, setText] = useState(defaultName || '');
  const canvasRef = useRef(null);
  // Dimensiones lógicas; el canvas se renderiza a 2x para nitidez en PDF
  const W = 700, H = 170;
  const FONT_SIZE = 62; // lógico; se duplica internamente

  useEffect(() => {
    if (!document.getElementById('dancing-script-font')) {
      const link = document.createElement('link');
      link.id = 'dancing-script-font'; link.rel = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const render = useCallback((val) => {
    const canvas = canvasRef.current; if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!val.trim()) { onSigned(null); return; }
    // Baseline decorativa NO se dibuja en el canvas — se muestra solo en CSS
    // (evita que la línea gris aparezca incrustada en el PDF)
    ctx.fillStyle = '#1e3a5f';
    ctx.font = `700 ${FONT_SIZE * CANVAS_SCALE}px "Dancing Script", cursive`;
    ctx.textBaseline = 'alphabetic';
    const textW = ctx.measureText(val).width;
    const x = Math.max(20 * CANVAS_SCALE, (canvas.width - textW) / 2);
    ctx.fillText(val, x, 130 * CANVAS_SCALE);
    onSigned(canvas.toDataURL('image/png'));
  }, [onSigned]);

  const handleChange = (e) => {
    const val = e.target.value; setText(val);
    document.fonts.ready.then(() => render(val));
  };
  useEffect(() => { if (defaultName) document.fonts.ready.then(() => render(defaultName)); }, []); // eslint-disable-line

  const clear = () => {
    setText(''); onSigned(null);
    const c = canvasRef.current;
    c.getContext('2d').clearRect(0, 0, c.width, c.height);
  };

  return (
    <div className="space-y-3">
      <input type="text" value={text} onChange={handleChange} disabled={disabled}
        placeholder="Escriba su nombre completo…"
        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-400 disabled:opacity-50" />
      <div className={`relative border-2 rounded-xl overflow-hidden bg-white ${disabled ? 'opacity-50' : 'border-brand-300 shadow-inner'}`}
        style={{ height: 170 }}>
        {/* canvas 2x — fondo transparente, solo trazo cursivo */}
        <canvas ref={canvasRef} width={W * CANVAS_SCALE} height={H * CANVAS_SCALE} className="w-full h-full" />
        {/* Baseline como decoración CSS — no entra en el PNG exportado */}
        {text && (
          <div className="absolute pointer-events-none"
            style={{ bottom: 32, left: 20, right: 20, height: 1, background: '#CBD5E1' }} />
        )}
        {!text && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm select-none">La firma aparecerá aquí</span>
          </div>
        )}
      </div>
      <button type="button" onClick={clear} disabled={disabled || !text}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        <RotateCcw size={12} /> Limpiar
      </button>
    </div>
  );
}

/* ── Image upload pad ───────────────────────────────────── */
function ImageSignaturePad({ onSigned, disabled }) {
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0]; if (!file) return;
    if (!file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      // Convert any format (WebP, GIF, BMP…) to PNG so pdf-lib can embed it
      const img = new window.Image();
      img.onload = () => {
        const cvs = document.createElement('canvas');
        cvs.width  = img.naturalWidth  || img.width;
        cvs.height = img.naturalHeight || img.height;
        cvs.getContext('2d').drawImage(img, 0, 0);
        const pngDataUrl = cvs.toDataURL('image/png');
        setPreview(pngDataUrl);
        onSigned(pngDataUrl);
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  };
  const clear = () => { setPreview(null); onSigned(null); if (inputRef.current) inputRef.current.value = ''; };

  return (
    <div className="space-y-3">
      {!preview ? (
        <label className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed rounded-xl bg-gray-50 cursor-pointer hover:bg-blue-50 hover:border-brand-300 transition-colors ${disabled ? 'opacity-50 pointer-events-none' : 'border-gray-200'}`} style={{ height: 170 }}>
          <Upload size={28} className="text-gray-300" />
          <span className="text-sm text-gray-400">Clic o arrastre imagen de su firma</span>
          <span className="text-xs text-gray-300">PNG, JPG · fondo blanco o transparente</span>
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        </label>
      ) : (
        <div className="relative border-2 border-brand-300 rounded-xl overflow-hidden bg-white shadow-inner" style={{ height: 170 }}>
          <img src={preview} alt="firma" className="w-full h-full object-contain p-3" />
          <button type="button" onClick={clear} disabled={disabled}
            className="absolute top-2 right-2 w-6 h-6 bg-red-100 rounded-full flex items-center justify-center text-red-500 hover:bg-red-200 text-xs font-bold">✕</button>
        </div>
      )}
    </div>
  );
}

/* ── Mobile QR pad ───────────────────────────────────────── */
function MobileSignaturePad({ token }) {
  const url = window.location.href;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&color=1B3A5C&bgcolor=FFFFFF&data=${encodeURIComponent(url)}`;
  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <img src={qrSrc} alt="QR firma" width={180} height={180} className="rounded-lg" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-gray-700">Escanea desde tu celular</p>
        <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
          Abre la cámara y apunta al código QR para abrir esta página en tu teléfono con pantalla táctil.
        </p>
      </div>
    </div>
  );
}

/* ── Multi-mode signature selector ──────────────────────── */
const SIG_MODES = [
  { id: 'draw',   label: 'Dibujar',  Icon: PenLine    },
  { id: 'type',   label: 'Escribir', Icon: Type       },
  { id: 'image',  label: 'Imagen',   Icon: ImageIcon  },
  { id: 'mobile', label: 'Celular',  Icon: Smartphone },
];

function MultiSignaturePad({ onSigned, onModeChange, disabled, token, signerName }) {
  const [mode, setMode] = useState('draw');
  const changeMode = (id) => { setMode(id); onSigned(null); onModeChange?.(id); };
  return (
    <div className="space-y-3">
      <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-gray-50 p-1 gap-0.5">
        {SIG_MODES.map(({ id, label, Icon }) => (
          <button key={id} type="button" onClick={() => changeMode(id)}
            className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg text-xs font-medium transition-all
              ${mode === id ? 'bg-white text-brand-700 shadow-sm border border-gray-100' : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon size={15} /><span className="hidden sm:block">{label}</span>
          </button>
        ))}
      </div>
      {mode === 'draw'   && <SignaturePad       onSigned={onSigned} disabled={disabled} />}
      {mode === 'type'   && <TypeSignaturePad   onSigned={onSigned} disabled={disabled} defaultName={signerName} />}
      {mode === 'image'  && <ImageSignaturePad  onSigned={onSigned} disabled={disabled} />}
      {mode === 'mobile' && <MobileSignaturePad token={token} />}
    </div>
  );
}

/* ── PDF viewer with interactive signature field overlay ────────────────────── */
function PDFSignerViewer({ pdfUrl, signerPage, xPct, yPct, wPct, hPct, done, onFieldClick, onNumPages }) {
  const [pages,   setPages]   = useState([]);
  const [numPgs,  setNumPgs]  = useState(0);
  const [loading, setLoading] = useState(true);
  const canvasRefs = useRef([]);
  const fieldRef   = useRef(null);

  // 1 — load PDF
  useEffect(() => {
    if (!pdfUrl) return;
    let cancelled = false;
    (async () => {
      try {
        const pdf = await pdfjsLib.getDocument(pdfUrl).promise;
        if (cancelled) return;
        const n = pdf.numPages;
        const data = [];
        for (let p = 1; p <= n; p++) data.push({ page: await pdf.getPage(p), num: p });
        if (!cancelled) { setPages(data); setNumPgs(n); onNumPages?.(n); }
      } catch (e) { if (!cancelled) { console.error('[PDFSignerViewer]', e); setLoading(false); } }
    })();
    return () => { cancelled = true; };
  }, [pdfUrl, onNumPages]);

  // 2 — render canvases
  useEffect(() => {
    if (!pages.length) return;
    let cancelled = false;
    (async () => {
      const cw = canvasRefs.current[0]?.parentElement?.parentElement?.clientWidth || 680;
      for (let i = 0; i < pages.length; i++) {
        const canvas = canvasRefs.current[i];
        if (!canvas || cancelled) break;
        const vp0   = pages[i].page.getViewport({ scale: 1 });
        const scale = cw / vp0.width;
        const vp    = pages[i].page.getViewport({ scale });
        canvas.width  = vp.width;
        canvas.height = vp.height;
        await pages[i].page.render({ canvasContext: canvas.getContext('2d'), viewport: vp }).promise;
      }
      if (!cancelled) setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [pages]);

  // 3 — auto-scroll to signature field
  useEffect(() => {
    if (!loading && fieldRef.current)
      setTimeout(() => fieldRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' }), 400);
  }, [loading]);

  // Convert total-doc y_percent → per-page fraction for the signing page
  const perPageY = numPgs > 0
    ? Math.max(0, Math.min(1 - hPct, yPct * numPgs - (signerPage - 1)))
    : yPct;

  return (
    <div>
      <style>{`
        @keyframes sigFieldPulse {
          0%,100% { box-shadow: 0 0 0 3px rgba(27,95,170,0.22); }
          50%      { box-shadow: 0 0 0 7px rgba(27,95,170,0.07); }
        }
      `}</style>

      <div style={{ position: 'relative', minHeight: 200 }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-50 z-10" style={{ minHeight: 200 }}>
            <Loader2 className="w-8 h-8 animate-spin text-brand-400" />
          </div>
        )}

        {pages.map((_, i) => (
          <div key={i} style={{ position: 'relative' }}>
            <canvas
              ref={el => { canvasRefs.current[i] = el; }}
              style={{ display: 'block', width: '100%', borderBottom: i < pages.length - 1 ? '2px solid #e2e8f0' : 'none' }}
            />

            {/* ── Interactive "Clic para firmar" overlay ─────────────────── */}
            {i + 1 === signerPage && !done && (
              <div
                ref={fieldRef}
                onClick={onFieldClick}
                style={{
                  position: 'absolute',
                  left:   `${xPct  * 100}%`,
                  top:    `${perPageY * 100}%`,
                  width:  `${wPct  * 100}%`,
                  height: `${hPct  * 100}%`,
                  cursor: 'pointer',
                  zIndex: 10,
                  border: '2.5px solid #1B5FAA',
                  borderRadius: 5,
                  background: 'rgba(27,95,170,0.07)',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 2,
                  animation: 'sigFieldPulse 2s ease-in-out infinite',
                  overflow: 'hidden',
                }}
              >
                <PenLine size={13} color="#1B5FAA" style={{ flexShrink: 0 }} />
                <span style={{ fontSize: 10, fontWeight: 700, color: '#1B5FAA', pointerEvents: 'none', whiteSpace: 'nowrap' }}>
                  Clic para firmar
                </span>
              </div>
            )}

            {/* ── Firmado ──────────────────────────────────────────────────── */}
            {i + 1 === signerPage && done && (
              <div
                style={{
                  position: 'absolute',
                  left:   `${xPct  * 100}%`,
                  top:    `${perPageY * 100}%`,
                  width:  `${wPct  * 100}%`,
                  height: `${hPct  * 100}%`,
                  zIndex: 10,
                  border: '2px solid #059669',
                  borderRadius: 5,
                  background: 'rgba(5,150,105,0.08)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <CheckCircle size={16} color="#059669" />
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────── */
export default function FirmaLibrePage() {
  const { token } = useParams();
  const [info, setInfo]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [signatureImg, setSignatureImg] = useState(null);
  const [sigMode, setSigMode]           = useState('draw'); // draw | type | image
  const [sigModalOpen, setSigModalOpen] = useState(false); // modal de firma
  const [pdfNumPages,  setPdfNumPages]  = useState(null);  // páginas totales del PDF
  const [rejectMode, setRejectMode]   = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [submitting, setSubmitting]   = useState(false);
  const [done, setDone]               = useState(false);
  const [doneMsg, setDoneMsg]         = useState('');
  const [pdfBlobUrl, setPdfBlobUrl]   = useState(null);

  useEffect(() => {
    axios.get(`${PUBLIC_API}/firma/libre/${token}`)
      .then(r => {
        setInfo(r.data);
        return axios.get(`${PUBLIC_API}/firma/libre/${token}/pdf`, { responseType: 'blob' });
      })
      .then(r => { setPdfBlobUrl(URL.createObjectURL(r.data)); })
      .catch(e => setError(e.response?.data?.error || 'Enlace inválido o expirado'))
      .finally(() => setLoading(false));
  }, [token]);

  const handleSign = async () => {
    if (!signatureImg) return;
    setSubmitting(true);
    try {
      await axios.post(`${PUBLIC_API}/firma/libre/${token}/firmar`, {
        signature_image: signatureImg,
        signature_type:  sigMode,   // draw | type | image
      });
      setDoneMsg('¡Firma registrada exitosamente! Recibirás el documento firmado por correo cuando todos hayan firmado.');
      setDone(true);
    } catch (e) {
      setError(e.response?.data?.error || 'Error al registrar la firma');
    } finally { setSubmitting(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) return;
    setSubmitting(true);
    try {
      await axios.post(`${PUBLIC_API}/firma/libre/${token}/rechazar`, { reason: rejectReason });
      setDoneMsg('Has rechazado la firma. El solicitante ha sido notificado.');
      setDone(true);
    } catch (e) {
      setError(e.response?.data?.error || 'Error al rechazar');
    } finally { setSubmitting(false); }
  };

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="text-center space-y-3">
        <Loader2 className="w-8 h-8 animate-spin text-brand-600 mx-auto" />
        <p className="text-gray-500 text-sm">Cargando documento...</p>
      </div>
    </div>
  );

  if (error && !info) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
        <XCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-800 mb-2">Enlace no disponible</h2>
        <p className="text-gray-500 text-sm">{error}</p>
      </div>
    </div>
  );

  if (done) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-lg p-8 max-w-md text-center">
        <CheckCircle className="w-12 h-12 text-emerald-500 mx-auto mb-4" />
        <h2 className="text-lg font-semibold text-gray-800 mb-2">¡Listo!</h2>
        <p className="text-gray-500 text-sm">{doneMsg}</p>
      </div>
    </div>
  );

  const { signer, request, allSigners, position } = info;

  // Determine which page the signer should sign on
  const signerPage = signer.page_num || 1;

  return (
    <>
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-brand-700 text-white px-6 py-4 shadow">
        <div className="max-w-4xl mx-auto flex items-center gap-3">
          <Shield className="w-6 h-6 text-blue-300" />
          <div>
            <h1 className="font-bold text-lg">Firma electrónica</h1>
            <p className="text-blue-300 text-xs">SGIP-IA · Ley 527/1999 Colombia</p>
          </div>
        </div>
      </div>

      <div className="max-w-4xl mx-auto px-4 py-6 space-y-4">
        {/* Document info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
          <div className="flex items-start gap-3">
            <FileText className="w-8 h-8 text-brand-500 flex-shrink-0 mt-0.5" />
            <div>
              <h2 className="font-semibold text-gray-900">{request.title}</h2>
              <p className="text-sm text-gray-500">{request.file_name} · Proyecto: {request.project_name} ({request.project_code})</p>
              <p className="text-xs text-gray-400 mt-1">
                Hola <strong>{signer.name}</strong> — Firmante {position} de {allSigners.length} · Rol: {signer.role || '—'}
              </p>
            </div>
          </div>
          {allSigners.length > 1 && (
            <div className="mt-4 flex flex-wrap gap-2">
              {allSigners.map((s, i) => (
                <div key={s.id} className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium
                  ${s.status === 'signed' ? 'bg-emerald-100 text-emerald-700' :
                    s.id === signer.id   ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>
                  {s.status === 'signed' ? <CheckCircle className="w-3 h-3" /> : <PenLine className="w-3 h-3" />}
                  {i + 1}. {s.signer_name}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* PDF con overlay interactivo de firma */}
        {pdfBlobUrl && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            {/* Toolbar */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" />
                <p className="text-sm font-medium text-gray-700">Vista previa del documento</p>
              </div>
              <a href={pdfBlobUrl} download={request.file_name}
                className="text-xs text-brand-600 hover:underline">Descargar original</a>
            </div>
            {/* Hint */}
            {!done && (
              <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 border-b border-blue-100">
                <MapPin className="w-3.5 h-3.5 text-blue-500 flex-shrink-0" />
                <p className="text-xs text-blue-700">
                  Tu campo de firma está en la <strong>página {signerPage}</strong>.
                  Haz clic en el recuadro azul pulsante para firmar.
                </p>
              </div>
            )}
            {/* Visor PDF con overlay */}
            <div className="overflow-y-auto" style={{ maxHeight: '70vh' }}>
              <PDFSignerViewer
                pdfUrl={pdfBlobUrl}
                signerPage={signerPage}
                xPct={parseFloat(signer.x_percent) || 0.10}
                yPct={parseFloat(signer.y_percent)  || 0.50}
                wPct={parseFloat(signer.width_percent)  || 0.25}
                hPct={parseFloat(signer.height_percent) || 0.08}
                done={done}
                onFieldClick={() => { setError(''); setSigModalOpen(true); }}
                onNumPages={setPdfNumPages}
              />
            </div>
          </div>
        )}

        {/* Opción rechazar (fuera del modal) */}
        {!done && !rejectMode && (
          <div className="flex justify-center">
            <button onClick={() => setRejectMode(true)}
              className="flex items-center gap-1.5 text-sm text-red-400 hover:text-red-600 hover:bg-red-50 px-4 py-2 rounded-lg transition-colors">
              <XCircle className="w-4 h-4" /> Rechazar documento
            </button>
          </div>
        )}

        {/* Formulario de rechazo */}
        {rejectMode && (
          <div className="bg-white rounded-2xl shadow-sm border border-red-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <XCircle className="w-5 h-5 text-red-500" />
              <h3 className="font-semibold text-gray-800">Rechazar documento</h3>
            </div>
            <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
              placeholder="Indique el motivo del rechazo (requerido)..." rows={4}
              className="w-full border border-gray-200 rounded-xl p-3 text-sm focus:outline-none focus:ring-2 focus:ring-red-300 resize-none" />
            <div className="flex items-center gap-3 mt-4">
              <button onClick={() => setRejectMode(false)} className="px-4 py-2 text-sm text-gray-600 hover:bg-gray-100 rounded-lg transition-colors">
                Cancelar
              </button>
              <button onClick={handleReject} disabled={!rejectReason.trim() || submitting}
                className="flex items-center gap-2 bg-red-600 hover:bg-red-700 text-white px-5 py-2 rounded-xl text-sm font-medium transition-colors disabled:opacity-50">
                {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                Confirmar rechazo
              </button>
            </div>
          </div>
        )}
      </div>
    </div>

    {/* ── Modal de firma ────────────────────────────────────────────────────── */}
    {sigModalOpen && (
      <div
        className="fixed inset-0 z-50 flex items-end sm:items-center justify-center"
        style={{ background: 'rgba(0,0,0,0.45)' }}
        onClick={e => { if (e.target === e.currentTarget) setSigModalOpen(false); }}
      >
        <div className="bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl w-full max-w-lg">
          {/* Header */}
          <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <PenLine className="w-5 h-5 text-brand-600" />
              <h3 className="font-semibold text-gray-800">Tu firma electrónica</h3>
            </div>
            <button onClick={() => setSigModalOpen(false)}
              className="text-gray-400 hover:text-gray-600 p-1 rounded-lg hover:bg-gray-100 transition-colors">
              <XCircle className="w-5 h-5" />
            </button>
          </div>
          {/* Pad de firma */}
          <div className="p-5">
            <MultiSignaturePad
              onSigned={setSignatureImg}
              onModeChange={setSigMode}
              disabled={submitting}
              token={token}
              signerName={signer.name}
            />
            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700 mt-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}
              </div>
            )}
          </div>
          {/* Footer */}
          <div className="px-5 pb-2 flex items-center justify-between gap-3 border-t border-gray-100 pt-4">
            <button onClick={() => { setSigModalOpen(false); setRejectMode(true); }}
              className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors">
              <XCircle className="w-4 h-4" /> Rechazar
            </button>
            <button
              onClick={handleSign}
              disabled={!signatureImg || submitting}
              className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
              Firmar documento
            </button>
          </div>
          <p className="text-xs text-gray-400 text-center px-5 pb-5 pt-2">
            Al firmar acepta la validez jurídica según Ley 527/1999 y Decreto 1074/2015 (Colombia).
            Su IP quedará registrada.
          </p>
        </div>
      </div>
    )}
    </>
  );
}
