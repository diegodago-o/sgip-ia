import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import {
  CheckCircle, XCircle, AlertTriangle, PenLine, RotateCcw,
  FileText, Shield, Loader2, Type, ImageIcon, Smartphone, Upload, MapPin,
} from 'lucide-react';

const PUBLIC_API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

/* ── Canvas signature pad (draw) ────────────────────────── */
function SignaturePad({ onSigned, disabled }) {
  const canvasRef  = useRef(null);
  const drawing    = useRef(false);
  const lastPos    = useRef({ x: 0, y: 0 });
  const hasStrokeRef = useRef(false);
  const [hasStroke, setHasStroke] = useState(false);

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
    ctx.beginPath(); ctx.arc(pos.x, pos.y, 1.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#1e3a5f'; ctx.fill();
  }, [disabled]);

  const draw = useCallback((e) => {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    const pos = getPos(e, canvas);
    ctx.beginPath(); ctx.moveTo(lastPos.current.x, lastPos.current.y); ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1e3a5f'; ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
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
        <canvas ref={canvasRef} width={700} height={180} className="w-full h-full" style={{ touchAction: 'none' }} />
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
    ctx.strokeStyle = '#CBD5E1'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, 140); ctx.lineTo(canvas.width - 20, 140); ctx.stroke();
    ctx.fillStyle = '#1e3a5f';
    ctx.font = '700 62px "Dancing Script", cursive';
    ctx.textBaseline = 'alphabetic';
    const x = Math.max(20, (canvas.width - ctx.measureText(val).width) / 2);
    ctx.fillText(val, x, 130);
    onSigned(canvas.toDataURL('image/png'));
  }, [onSigned]);

  const handleChange = (e) => {
    const val = e.target.value; setText(val);
    document.fonts.ready.then(() => render(val));
  };
  useEffect(() => { if (defaultName) document.fonts.ready.then(() => render(defaultName)); }, []); // eslint-disable-line

  const clear = () => { setText(''); onSigned(null); const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height); };

  return (
    <div className="space-y-3">
      <input type="text" value={text} onChange={handleChange} disabled={disabled}
        placeholder="Escriba su nombre completo…"
        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:outline-none focus:border-brand-400 disabled:opacity-50" />
      <div className={`relative border-2 rounded-xl overflow-hidden bg-white ${disabled ? 'opacity-50' : 'border-brand-300 shadow-inner'}`} style={{ height: 170 }}>
        <canvas ref={canvasRef} width={700} height={170} className="w-full h-full" />
        {!text && <div className="absolute inset-0 flex items-center justify-center pointer-events-none"><span className="text-gray-300 text-sm select-none">La firma aparecerá aquí</span></div>}
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

function MultiSignaturePad({ onSigned, disabled, token, signerName }) {
  const [mode, setMode] = useState('draw');
  return (
    <div className="space-y-3">
      <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-gray-50 p-1 gap-0.5">
        {SIG_MODES.map(({ id, label, Icon }) => (
          <button key={id} type="button" onClick={() => { setMode(id); onSigned(null); }}
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

/* ── Main page ──────────────────────────────────────────── */
export default function FirmaLibrePage() {
  const { token } = useParams();
  const [info, setInfo]               = useState(null);
  const [loading, setLoading]         = useState(true);
  const [error, setError]             = useState('');
  const [signatureImg, setSignatureImg] = useState(null);
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
      await axios.post(`${PUBLIC_API}/firma/libre/${token}/firmar`, { signature_image: signatureImg });
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

        {/* Position indicator */}
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex items-center gap-3">
          <MapPin className="w-4 h-4 text-blue-500 flex-shrink-0" />
          <p className="text-sm text-blue-700">
            Su firma debe ir en la <strong>página {signerPage}</strong> del documento.
            {signer.x_percent && (
              <span className="ml-1 text-blue-500">
                Posición: {Math.round((signer.x_percent || 0) * 100)}% horizontal,{' '}
                {Math.round((signer.y_percent  || 0) * 100)}% vertical en esa página.
              </span>
            )}
          </p>
        </div>

        {/* PDF preview */}
        {pdfBlobUrl && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
              <p className="text-sm font-medium text-gray-700">Vista previa del documento</p>
              <a href={pdfBlobUrl} download={request.file_name}
                className="text-xs text-brand-600 hover:underline">Descargar original</a>
            </div>
            <iframe src={`${pdfBlobUrl}#page=${signerPage}`} className="w-full" style={{ height: 480 }} title="Documento" />
          </div>
        )}

        {/* Signature area */}
        {!rejectMode ? (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
            <div className="flex items-center gap-2 mb-4">
              <PenLine className="w-5 h-5 text-brand-500" />
              <h3 className="font-semibold text-gray-800">Tu firma electrónica</h3>
            </div>

            <MultiSignaturePad
              onSigned={setSignatureImg}
              disabled={submitting}
              token={token}
              signerName={signer.name}
            />

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 rounded-lg text-sm text-red-700 mt-3">
                <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />{error}
              </div>
            )}

            <div className="flex items-center justify-between mt-5 pt-4 border-t border-gray-100">
              <button onClick={() => setRejectMode(true)}
                className="flex items-center gap-1.5 text-sm text-red-500 hover:text-red-700 hover:bg-red-50 px-3 py-2 rounded-lg transition-colors">
                <XCircle className="w-4 h-4" /> Rechazar documento
              </button>
              <button onClick={handleSign} disabled={!signatureImg || submitting}
                className="flex items-center gap-2 bg-brand-600 hover:bg-brand-700 text-white px-6 py-2.5 rounded-xl font-medium text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed">
                {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Shield className="w-4 h-4" />}
                Firmar documento
              </button>
            </div>

            <p className="text-xs text-gray-400 mt-3 text-center">
              Al firmar acepta que esta firma tiene validez jurídica según Ley 527 de 1999 y Decreto 1074 de 2015 (Colombia). Su IP quedará registrada.
            </p>
          </div>
        ) : (
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
  );
}
