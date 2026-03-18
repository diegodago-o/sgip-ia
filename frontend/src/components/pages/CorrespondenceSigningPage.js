import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import {
  CheckCircle, XCircle, AlertTriangle, PenLine, RotateCcw,
  FileText, Shield, Loader2,
  Type, ImageIcon, Smartphone, Upload,
} from 'lucide-react';

const PUBLIC_API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

/* ── helpers ─────────────────────────────────────────────── */
const fmt = (d) =>
  d ? new Date(d).toLocaleDateString('es-CO', {
    year: 'numeric', month: 'long', day: 'numeric', timeZone: 'America/Bogota',
  }) : '—';

/* ── Canvas signature pad ───────────────────────────────── */
function SignaturePad({ onSigned, disabled }) {
  const canvasRef = useRef(null);
  const drawing   = useRef(false);
  const lastPos   = useRef({ x: 0, y: 0 });
  const [hasStroke, setHasStroke] = useState(false);

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
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, 1.5, 0, 2 * Math.PI);
    ctx.fillStyle = '#1e3a5f';
    ctx.fill();
  }, [disabled]);

  const draw = useCallback((e) => {
    if (!drawing.current || disabled) return;
    e.preventDefault();
    const canvas = canvasRef.current;
    const ctx    = canvas.getContext('2d');
    const pos    = getPos(e, canvas);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.strokeStyle = '#1e3a5f';
    ctx.lineWidth   = 2.5;
    ctx.lineCap     = 'round';
    ctx.lineJoin    = 'round';
    ctx.stroke();
    lastPos.current = pos;
    setHasStroke(true);
  }, [disabled]);

  const endDraw = useCallback(() => {
    if (!drawing.current) return;
    drawing.current = false;
    if (hasStroke && canvasRef.current) onSigned(canvasRef.current.toDataURL('image/png'));
  }, [hasStroke, onSigned]);

  const clear = () => {
    const canvas = canvasRef.current;
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    setHasStroke(false);
    onSigned(null);
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
        <canvas ref={canvasRef} width={700} height={180} className="w-full h-full"
          style={{ touchAction: 'none' }} />
        {!hasStroke && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm select-none">Dibuje su firma aquí</span>
          </div>
        )}
      </div>
      <button type="button" onClick={clear} disabled={disabled || !hasStroke}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500
          disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
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
      link.id   = 'dancing-script-font';
      link.rel  = 'stylesheet';
      link.href = 'https://fonts.googleapis.com/css2?family=Dancing+Script:wght@700&display=swap';
      document.head.appendChild(link);
    }
  }, []);

  const render = useCallback((val) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!val.trim()) { onSigned(null); return; }
    ctx.strokeStyle = '#CBD5E1'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(20, 140); ctx.lineTo(canvas.width - 20, 140); ctx.stroke();
    ctx.fillStyle = '#1e3a5f';
    ctx.font = '700 62px "Dancing Script", cursive';
    ctx.textBaseline = 'alphabetic';
    const measured = ctx.measureText(val);
    const x = Math.max(20, (canvas.width - measured.width) / 2);
    ctx.fillText(val, x, 130);
    onSigned(canvas.toDataURL('image/png'));
  }, [onSigned]);

  const handleChange = (e) => {
    const val = e.target.value;
    setText(val);
    document.fonts.ready.then(() => render(val));
  };

  useEffect(() => {
    if (defaultName) document.fonts.ready.then(() => render(defaultName));
  }, []); // eslint-disable-line

  const clear = () => {
    setText(''); onSigned(null);
    const c = canvasRef.current; c.getContext('2d').clearRect(0, 0, c.width, c.height);
  };

  return (
    <div className="space-y-3">
      <input type="text" value={text} onChange={handleChange} disabled={disabled}
        placeholder="Escriba su nombre completo…"
        className="w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm
          focus:outline-none focus:border-brand-400 disabled:opacity-50" />
      <div className={`relative border-2 rounded-xl overflow-hidden bg-white
        ${disabled ? 'opacity-50' : 'border-brand-300 shadow-inner'}`} style={{ height: 170 }}>
        <canvas ref={canvasRef} width={700} height={170} className="w-full h-full" />
        {!text && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm select-none">La firma aparecerá aquí</span>
          </div>
        )}
      </div>
      <button type="button" onClick={clear} disabled={disabled || !text}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500
          disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
        <RotateCcw size={12} /> Limpiar
      </button>
    </div>
  );
}

/* ── Image upload signature pad ─────────────────────────── */
function ImageSignaturePad({ onSigned, disabled }) {
  const [preview, setPreview] = useState(null);
  const inputRef = useRef(null);

  const handleFile = (e) => {
    const file = e.target.files?.[0];
    if (!file || !file.type.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = (ev) => { setPreview(ev.target.result); onSigned(ev.target.result); };
    reader.readAsDataURL(file);
  };

  const clear = () => {
    setPreview(null); onSigned(null);
    if (inputRef.current) inputRef.current.value = '';
  };

  return (
    <div className="space-y-3">
      {!preview ? (
        <label className={`flex flex-col items-center justify-center gap-3 border-2 border-dashed
          rounded-xl bg-gray-50 cursor-pointer hover:bg-blue-50 hover:border-brand-300 transition-colors
          ${disabled ? 'opacity-50 pointer-events-none' : 'border-gray-200'}`} style={{ height: 170 }}>
          <Upload size={28} className="text-gray-300" />
          <span className="text-sm text-gray-400">Haga clic o arrastre una imagen de su firma</span>
          <span className="text-xs text-gray-300">PNG, JPG · fondo blanco o transparente</span>
          <input ref={inputRef} type="file" accept="image/*" onChange={handleFile} className="hidden" />
        </label>
      ) : (
        <div className="relative border-2 border-brand-300 rounded-xl overflow-hidden bg-white shadow-inner"
          style={{ height: 170 }}>
          <img src={preview} alt="firma" className="w-full h-full object-contain p-3" />
          <button type="button" onClick={clear} disabled={disabled}
            className="absolute top-2 right-2 w-6 h-6 bg-red-100 rounded-full flex items-center
              justify-center text-red-500 hover:bg-red-200 text-xs font-bold">✕</button>
        </div>
      )}
    </div>
  );
}

/* ── Mobile QR pad ───────────────────────────────────────── */
function MobileSignaturePad({ token, onMobileSigned }) {
  const url = window.location.href;
  const qrSrc = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&color=1B3A5C&bgcolor=FFFFFF&data=${encodeURIComponent(url)}`;
  const [checking, setChecking] = useState(false);

  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const r = await axios.get(`${PUBLIC_API}/firma/corr/${token}`);
        const status = r.data?.data?.signer?.status;
        if (active && status === 'signed') onMobileSigned(r.data?.data?.signer?.signer_name || '');
      } catch { /* ignore */ }
    };
    setChecking(true);
    const iv = setInterval(check, 4000);
    return () => { active = false; clearInterval(iv); setChecking(false); };
  }, [token, onMobileSigned]);

  return (
    <div className="flex flex-col items-center gap-4 py-4">
      <div className="bg-white border border-gray-200 rounded-2xl p-4 shadow-sm">
        <img src={qrSrc} alt="QR firma" width={180} height={180} className="rounded-lg" />
      </div>
      <div className="text-center space-y-1">
        <p className="text-sm font-semibold text-gray-700">Escanea desde tu celular</p>
        <p className="text-xs text-gray-400 max-w-xs leading-relaxed">
          Abre la cámara y apunta al código QR. Se abrirá esta misma página en tu teléfono con
          pantalla táctil para dibujar tu firma.
        </p>
        {checking && (
          <p className="text-xs text-brand-500 flex items-center justify-center gap-1 mt-2">
            <Loader2 size={11} className="animate-spin" /> Esperando firma desde celular…
          </p>
        )}
      </div>
      <p className="text-[10px] text-gray-300 break-all text-center max-w-xs">{url}</p>
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

function MultiSignaturePad({ onSigned, disabled, token, signerName, onMobileSigned }) {
  const [mode, setMode] = useState('draw');
  const handleModeChange = (m) => { setMode(m); onSigned(null); };

  return (
    <div className="space-y-3">
      <div className="flex rounded-xl border border-gray-200 overflow-hidden bg-gray-50 p-1 gap-0.5">
        {SIG_MODES.map(({ id, label, Icon }) => (
          <button key={id} type="button" onClick={() => handleModeChange(id)}
            className={`flex-1 flex flex-col items-center gap-1 py-2 rounded-lg text-xs font-medium transition-all
              ${mode === id
                ? 'bg-white text-brand-700 shadow-sm border border-gray-100'
                : 'text-gray-500 hover:text-gray-700'}`}>
            <Icon size={15} />
            <span className="hidden sm:block">{label}</span>
          </button>
        ))}
      </div>
      {mode === 'draw'   && <SignaturePad      onSigned={onSigned} disabled={disabled} />}
      {mode === 'type'   && <TypeSignaturePad  onSigned={onSigned} disabled={disabled} defaultName={signerName} />}
      {mode === 'image'  && <ImageSignaturePad onSigned={onSigned} disabled={disabled} />}
      {mode === 'mobile' && <MobileSignaturePad token={token} onMobileSigned={onMobileSigned} />}
    </div>
  );
}

/* ── Status screens ─────────────────────────────────────── */
function StatusScreen({ icon: Icon, color, title, message }) {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50
      flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-xl p-10 max-w-md w-full text-center space-y-4">
        <div className={`mx-auto w-16 h-16 rounded-full flex items-center justify-center ${color}`}>
          <Icon size={32} className="text-white" />
        </div>
        <h1 className="text-xl font-bold text-gray-800">{title}</h1>
        <p className="text-gray-500 text-sm leading-relaxed">{message}</p>
        <p className="text-xs text-gray-400 mt-6">SGIP-IA · Firma Electrónica · Ley 527/1999</p>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────── */
export default function CorrespondenceSigningPage() {
  const { token } = useParams();

  const [state,        setState]        = useState('loading');
  const [data,         setData]         = useState(null);
  const [pdfUrl,       setPdfUrl]       = useState(null);
  const [sigImg,       setSigImg]       = useState(null);
  const [sending,      setSending]      = useState(false);
  const [errMsg,       setErrMsg]       = useState('');
  const [showReject,   setShowReject]   = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [done,         setDone]         = useState(null); // { type: 'signed'|'rejected', name }

  // Load signer data
  useEffect(() => {
    axios.get(`${PUBLIC_API}/firma/corr/${token}`)
      .then(r => {
        setData(r.data);
        const signer  = r.data?.data?.signer;
        const request = r.data?.data?.request;
        if (signer?.status === 'signed')   return setState('alreadySigned');
        if (signer?.status === 'rejected') return setState('alreadySigned');
        if (request?.status === 'completed') return setState('completed');
        if (['rejected', 'cancelled'].includes(request?.status)) return setState('rejected');
        setState('ready');
      })
      .catch(e => {
        const msg = e.response?.data?.error || '';
        if (msg.includes('No es su turno'))   setState('notTurn');
        else if (msg.includes('ya firmó'))     setState('alreadySigned');
        else if (msg.includes('completada'))   setState('completed');
        else if (msg.includes('cancelada') || msg.includes('rechazada')) setState('rejected');
        else setState('error');
        setErrMsg(msg);
      });
  }, [token]);

  // Load PDF with placeholders once data is ready
  useEffect(() => {
    if (state !== 'ready') return;
    axios.get(`${PUBLIC_API}/firma/corr/${token}/pdf`, { responseType: 'arraybuffer' })
      .then(r => setPdfUrl(URL.createObjectURL(new Blob([r.data], { type: 'application/pdf' }))))
      .catch(() => { /* PDF load failure is non-blocking */ });
    return () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); };
  }, [state]); // eslint-disable-line

  const handleSign = async () => {
    if (!sigImg) { setErrMsg('Por favor dibuje su firma antes de continuar.'); return; }
    setSending(true); setErrMsg('');
    try {
      await axios.post(`${PUBLIC_API}/firma/corr/${token}/firmar`, { signature_image: sigImg });
      setDone({ type: 'signed', name: data?.data?.signer?.signer_name });
    } catch (e) {
      setErrMsg(e.response?.data?.error || 'Error al procesar la firma. Intente nuevamente.');
    } finally { setSending(false); }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { setErrMsg('Ingrese el motivo del rechazo.'); return; }
    setSending(true); setErrMsg('');
    try {
      await axios.post(`${PUBLIC_API}/firma/corr/${token}/rechazar`, { reason: rejectReason });
      setDone({ type: 'rejected' });
    } catch (e) {
      setErrMsg(e.response?.data?.error || 'Error al procesar el rechazo.');
    } finally { setSending(false); }
  };

  /* ── Status screens ── */
  if (state === 'loading')
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50
        flex items-center justify-center">
        <Loader2 size={40} className="animate-spin text-brand-500" />
      </div>
    );

  if (done?.type === 'signed')
    return <StatusScreen icon={CheckCircle} color="bg-green-500"
      title="¡Firma registrada exitosamente!"
      message={`Gracias ${done.name}. Su firma electrónica ha sido registrada con validez legal conforme a la Ley 527 de 1999. Puede cerrar esta ventana.`} />;

  if (done?.type === 'rejected')
    return <StatusScreen icon={XCircle} color="bg-red-500"
      title="Firma rechazada"
      message="Su rechazo ha sido registrado. El proceso de firmas ha sido cancelado y el responsable ha sido notificado. Puede cerrar esta ventana." />;

  if (state === 'notTurn')
    return <StatusScreen icon={AlertTriangle} color="bg-yellow-500"
      title="Aún no es su turno"
      message="El proceso de firmas es secuencial. Recibirá un nuevo correo cuando llegue su turno para firmar. Por favor espere." />;

  if (state === 'alreadySigned')
    return <StatusScreen icon={CheckCircle} color="bg-green-500"
      title="Ya firmó este documento"
      message="Su firma ya fue registrada anteriormente en este documento. No es necesario realizar ninguna acción adicional." />;

  if (state === 'completed')
    return <StatusScreen icon={CheckCircle} color="bg-brand-500"
      title="Proceso de firma completado"
      message="Todos los firmantes han completado su firma. El documento está debidamente firmado. Puede cerrar esta ventana." />;

  if (state === 'rejected')
    return <StatusScreen icon={XCircle} color="bg-gray-500"
      title="Proceso cancelado"
      message="El proceso de firmas para este documento fue cancelado o rechazado. Comuníquese con el responsable del proyecto." />;

  if (state === 'error')
    return <StatusScreen icon={XCircle} color="bg-red-500"
      title="Enlace inválido o expirado"
      message={errMsg || "El enlace de firma no es válido o ha expirado. Por favor solicite un nuevo enlace al responsable del proyecto."} />;

  /* ── Ready state — main form ── */
  // API response: { data: { signer, correspondence, allSigners, project, request } }
  const { signer, correspondence: corr, allSigners: signers, project, request } = data?.data || {};
  const signedCount  = (signers || []).filter(s => s.status === 'signed').length;
  const totalSigners = (signers || []).length;

  const TYPE_LABELS = {
    oficio: 'OFICIO', circular: 'CIRCULAR', memorando: 'MEMORANDO',
    comunicado: 'COMUNICADO', carta: 'CARTA', radicado: 'RADICADO',
    derecho_peticion: 'DERECHO DE PETICIÓN',
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-blue-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-3xl mx-auto px-4 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-brand-600 rounded-lg flex items-center justify-center">
              <Shield size={18} className="text-white" />
            </div>
            <div>
              <p className="font-bold text-gray-800 text-sm leading-none">SGIP-IA</p>
              <p className="text-xs text-gray-400">Firma Electrónica · Ley 527/1999</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs text-gray-400">Firmante {signedCount + 1} de {totalSigners}</p>
            <div className="flex gap-1 mt-1">
              {(signers || []).map((s, i) => (
                <div key={i} className={`h-1.5 w-6 rounded-full ${
                  s.status === 'signed'
                    ? 'bg-green-500'
                    : s.sign_order === signer?.sign_order
                    ? 'bg-brand-500'
                    : 'bg-gray-200'
                }`} />
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Document info card */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-[#1E3A5F] px-6 py-5 flex gap-4">
            <div className="bg-[#2E86AB] rounded-lg p-2 flex-shrink-0 flex items-center justify-center">
              <FileText size={20} className="text-white" />
            </div>
            <div className="text-white">
              <p className="text-xs text-blue-300 uppercase tracking-wide font-semibold mb-0.5">
                {TYPE_LABELS[corr?.correspondence_type] || 'COMUNICACIÓN'} · {corr?.consecutive_code}
              </p>
              <h1 className="font-bold text-lg leading-snug">{corr?.subject || 'Documento'}</h1>
              <p className="text-blue-200 text-xs mt-1">
                {project?.name}{project?.code ? ` (${project.code})` : ''}
              </p>
            </div>
          </div>

          {/* Metadata grid */}
          <div className="px-6 py-4 grid grid-cols-2 gap-x-6 gap-y-3 text-sm border-b border-gray-100">
            <div>
              <p className="text-xs text-gray-400">Fecha</p>
              <p className="font-medium text-gray-800">{fmt(corr?.reference_date)}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400">Destinatario</p>
              <p className="font-medium text-gray-800">{corr?.recipient_name || '—'}</p>
            </div>
            {corr?.recipient_entity && (
              <div>
                <p className="text-xs text-gray-400">Entidad</p>
                <p className="font-medium text-gray-800">{corr.recipient_entity}</p>
              </div>
            )}
            {corr?.contract_reference && (
              <div>
                <p className="text-xs text-gray-400">Contrato</p>
                <p className="font-medium text-gray-800">N° {corr.contract_reference}</p>
              </div>
            )}
          </div>

          {/* Asunto */}
          <div className="px-6 py-3 border-b border-gray-100 flex gap-2 bg-gray-50">
            <span className="font-bold text-[#1E3A5F] text-xs whitespace-nowrap">ASUNTO:</span>
            <span className="text-xs font-medium text-gray-700">{corr?.subject}</span>
          </div>

          {/* PDF preview — shows signature placeholder location */}
          {pdfUrl && (
            <div className="px-6 py-4 border-b border-gray-100">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
                Vista del documento — su campo de firma está resaltado en color
              </p>
              <div className="rounded-xl overflow-hidden border border-gray-200 shadow-sm"
                style={{ height: 450 }}>
                <iframe src={pdfUrl} title="Documento a firmar"
                  className="w-full h-full border-0" />
              </div>
              <p className="text-[10px] text-gray-400 mt-2 text-center">
                El recuadro de color indica la posición exacta donde aparecerá su firma en el documento final.
              </p>
            </div>
          )}

          {/* Legal notice */}
          <div className="mx-6 mb-4 mt-2 bg-blue-50 border border-blue-100 rounded-xl px-4 py-3">
            <p className="text-xs text-blue-700 font-medium">
              ⚠️ Al firmar, certifica que ha leído y está de acuerdo con el contenido de este
              documento. Su firma electrónica tiene plena validez jurídica conforme a la Ley 527 de 1999.
            </p>
          </div>
        </div>

        {/* Signer info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Firmante actual
          </p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center">
              <span className="text-brand-700 font-bold text-sm">
                {(signer?.signer_name || '?')[0].toUpperCase()}
              </span>
            </div>
            <div>
              <p className="font-semibold text-gray-800">{signer?.signer_name}</p>
              <p className="text-xs text-gray-400">{signer?.signer_role} · {signer?.signer_email}</p>
            </div>
          </div>
        </div>

        {/* Signature pad */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-5">
          <div className="flex items-center gap-2 mb-4">
            <PenLine size={16} className="text-brand-600" />
            <h2 className="font-semibold text-gray-800">Su firma</h2>
          </div>
          <MultiSignaturePad
            onSigned={setSigImg}
            disabled={sending}
            token={token}
            signerName={signer?.signer_name || ''}
            onMobileSigned={(name) => setDone({ type: 'signed', name })}
          />

          {errMsg && (
            <div className="mt-3 flex items-center gap-2 text-red-600 text-sm bg-red-50
              rounded-lg px-3 py-2 border border-red-100">
              <AlertTriangle size={14} />{errMsg}
            </div>
          )}

          <p className="text-xs text-gray-400 mt-4 leading-relaxed">
            Al hacer clic en <strong>Firmar</strong>, acepta que esta firma electrónica tiene validez
            legal conforme a la Ley 527 de 1999 y el Decreto 1074 de 2015 de Colombia. Se registrará
            su dirección IP, fecha y hora como parte del registro de auditoría del documento.
          </p>

          {!showReject ? (
            <div className="flex gap-3 mt-5">
              <button onClick={() => { setShowReject(true); setErrMsg(''); }} disabled={sending}
                className="flex-1 border border-red-200 text-red-500 rounded-xl py-2.5
                  text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50">
                Rechazar
              </button>
              <button onClick={handleSign} disabled={sending || !sigImg}
                className="flex-2 flex-grow-[2] flex items-center justify-center gap-2
                  bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-2.5
                  text-sm font-semibold transition-colors disabled:opacity-50
                  disabled:cursor-not-allowed shadow-sm">
                {sending
                  ? <><Loader2 size={16} className="animate-spin" /> Procesando…</>
                  : <><CheckCircle size={16} /> Firmar documento</>
                }
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-sm font-medium text-gray-700">Motivo del rechazo</p>
              <textarea value={rejectReason} onChange={e => setRejectReason(e.target.value)}
                placeholder="Explique por qué rechaza la firma de este documento…"
                rows={3} disabled={sending}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                  resize-none focus:outline-none focus:border-brand-400 disabled:opacity-50" />
              <div className="flex gap-3">
                <button onClick={() => { setShowReject(false); setErrMsg(''); }} disabled={sending}
                  className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5
                    text-sm hover:bg-gray-50 transition-colors disabled:opacity-50">
                  Cancelar
                </button>
                <button onClick={handleReject} disabled={sending || !rejectReason.trim()}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl
                    py-2.5 text-sm font-semibold transition-colors disabled:opacity-50
                    flex items-center justify-center gap-2">
                  {sending
                    ? <><Loader2 size={16} className="animate-spin" /> Procesando…</>
                    : <><XCircle size={16} /> Confirmar rechazo</>
                  }
                </button>
              </div>
            </div>
          )}
        </div>

        {/* All signers progress */}
        {signers && signers.length > 1 && (
          <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-4">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
              Progreso de firmas
            </p>
            <div className="space-y-2">
              {signers.map((s, i) => (
                <div key={i} className="flex items-center gap-3">
                  <div className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold
                    ${s.status === 'signed'
                      ? 'bg-green-100 text-green-700'
                      : s.status === 'rejected'
                      ? 'bg-red-100 text-red-700'
                      : s.sign_order === signer?.sign_order
                      ? 'bg-brand-100 text-brand-700'
                      : 'bg-gray-100 text-gray-400'}`}>
                    {s.status === 'signed' ? '✓' : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">{s.signer_name}</p>
                    <p className="text-xs text-gray-400 truncate">{s.signer_role}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                    ${s.status === 'signed'   ? 'bg-green-100 text-green-700' :
                      s.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      s.status === 'notified' ? 'bg-blue-100 text-blue-700' :
                      s.status === 'viewed'   ? 'bg-yellow-100 text-yellow-700' :
                      'bg-gray-100 text-gray-500'}`}>
                    {s.status === 'signed'   ? 'Firmado' :
                     s.status === 'rejected' ? 'Rechazado' :
                     s.status === 'notified' ? 'Notificado' :
                     s.status === 'viewed'   ? 'Visto' : 'Pendiente'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        <p className="text-center text-xs text-gray-400 pb-4">
          SGIP-IA · Gestión de Proyectos con IA · Firma Electrónica con Validez Legal
        </p>
      </main>
    </div>
  );
}
