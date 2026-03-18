import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import axios from 'axios';
import {
  CheckCircle, XCircle, AlertTriangle, PenLine, RotateCcw,
  FileText, Users, Calendar, Shield, Loader2
} from 'lucide-react';

const PUBLIC_API = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

/* ── helpers ─────────────────────────────────────────────── */
const fmt = (d) =>
  d ? new Date(d).toLocaleDateString('es-CO', { year: 'numeric', month: 'long', day: 'numeric' }) : '—';

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
    if (hasStroke && canvasRef.current) {
      onSigned(canvasRef.current.toDataURL('image/png'));
    }
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
        <canvas
          ref={canvasRef}
          width={700}
          height={180}
          className="w-full h-full"
          style={{ touchAction: 'none' }}
        />
        {!hasStroke && !disabled && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-gray-300 text-sm select-none">Dibuje su firma aquí</span>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={clear}
        disabled={disabled || !hasStroke}
        className="flex items-center gap-1 text-xs text-gray-500 hover:text-red-500
          disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        <RotateCcw size={12} /> Limpiar
      </button>
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
        <p className="text-xs text-gray-400 mt-6">
          SGIP-IA · Firma Electrónica · Ley 527/1999
        </p>
      </div>
    </div>
  );
}

/* ── Main page ──────────────────────────────────────────── */
export default function SigningPage() {
  const { token } = useParams();

  const [state,   setState]   = useState('loading'); // loading|ready|notTurn|alreadySigned|completed|rejected|error
  const [data,    setData]    = useState(null);
  const [sigImg,  setSigImg]  = useState(null);
  const [sending, setSending] = useState(false);
  const [errMsg,  setErrMsg]  = useState('');
  const [showReject, setShowReject] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const [done,    setDone]    = useState(null); // { type: 'signed'|'rejected', name }

  useEffect(() => {
    axios.get(`${PUBLIC_API}/firma/${token}`)
      .then(r => {
        setData(r.data);
        setState('ready');
      })
      .catch(e => {
        const msg = e.response?.data?.error || '';
        if (msg.includes('No es su turno'))       setState('notTurn');
        else if (msg.includes('ya firmó'))         setState('alreadySigned');
        else if (msg.includes('completada'))       setState('completed');
        else if (msg.includes('cancelada') || msg.includes('rechazada')) setState('rejected');
        else if (msg.includes('inválido') || msg.includes('expirado'))   setState('error');
        else setState('error');
        setErrMsg(msg);
      });
  }, [token]);

  const handleSign = async () => {
    if (!sigImg) { setErrMsg('Por favor dibuje su firma antes de continuar.'); return; }
    setSending(true); setErrMsg('');
    try {
      await axios.post(`${PUBLIC_API}/firma/${token}/firmar`, { signature_image: sigImg });
      setDone({ type: 'signed', name: data?.data?.signer?.name });
    } catch (e) {
      setErrMsg(e.response?.data?.error || 'Error al procesar la firma. Intente nuevamente.');
    } finally {
      setSending(false);
    }
  };

  const handleReject = async () => {
    if (!rejectReason.trim()) { setErrMsg('Ingrese el motivo del rechazo.'); return; }
    setSending(true); setErrMsg('');
    try {
      await axios.post(`${PUBLIC_API}/firma/${token}/rechazar`, { reason: rejectReason });
      setDone({ type: 'rejected' });
    } catch (e) {
      setErrMsg(e.response?.data?.error || 'Error al procesar el rechazo.');
    } finally {
      setSending(false);
    }
  };

  /* ── status screens ── */
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
      message={`Gracias ${done.name}. Su firma electrónica ha sido registrada con validez legal conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012 de Colombia. Puede cerrar esta ventana.`} />;

  if (done?.type === 'rejected')
    return <StatusScreen icon={XCircle} color="bg-red-500"
      title="Firma rechazada"
      message="Su rechazo ha sido registrado. El proceso de firmas ha sido cancelado y el creador del acta ha sido notificado. Puede cerrar esta ventana." />;

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
      message="Todos los firmantes han completado su firma. El acta está debidamente firmada. Puede cerrar esta ventana." />;

  if (state === 'rejected')
    return <StatusScreen icon={XCircle} color="bg-gray-500"
      title="Proceso cancelado"
      message="El proceso de firmas para este documento fue cancelado o rechazado. Comuníquese con el responsable del proyecto." />;

  if (state === 'error')
    return <StatusScreen icon={XCircle} color="bg-red-500"
      title="Enlace inválido o expirado"
      message={errMsg || "El enlace de firma no es válido o ha expirado. Por favor solicite un nuevo enlace al responsable del proyecto."} />;

  /* ── ready state — main form ── */
  // API response shape: { success, data: { signer, minute, allSigners, project, request } }
  const { signer, minute, allSigners: signers, project } = data?.data || {};
  const signedCount  = (signers || []).filter(s => s.status === 'signed').length;
  const totalSigners = (signers || []).length;

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
                  s.status === 'signed' ? 'bg-green-500' :
                  s.order === signer?.order ? 'bg-brand-500' : 'bg-gray-200'
                }`} />
              ))}
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Document info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="bg-gradient-to-r from-brand-600 to-brand-700 px-6 py-4">
            <div className="flex items-center gap-2 text-white">
              <FileText size={18} />
              <h1 className="font-semibold">{minute?.title || 'Acta de Reunión'}</h1>
            </div>
            <p className="text-brand-100 text-xs mt-0.5">{minute?.meeting_type}</p>
          </div>
          <div className="px-6 py-4 grid grid-cols-2 gap-4 text-sm">
            <div className="flex items-start gap-2">
              <Calendar size={14} className="text-gray-400 mt-0.5" />
              <div>
                <p className="text-xs text-gray-400">Fecha de reunión</p>
                <p className="font-medium text-gray-700">{fmt(minute?.meeting_date)}</p>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Users size={14} className="text-gray-400 mt-0.5" />
              <div>
                <p className="text-xs text-gray-400">Asistentes</p>
                <p className="font-medium text-gray-700">
                  {Array.isArray(minute?.attendees)
                    ? minute.attendees.join(', ')
                    : (minute?.attendees || '—')}
                </p>
              </div>
            </div>
          </div>
          {minute?.agreements && (
            <div className="px-6 pb-4">
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Acuerdos</p>
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3 leading-relaxed whitespace-pre-line">
                {minute.agreements}
              </p>
            </div>
          )}
        </div>

        {/* Signer info */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-4">
          <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-3">
            Firmante actual
          </p>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-brand-100 flex items-center justify-center">
              <span className="text-brand-700 font-bold text-sm">
                {(signer?.name || '?')[0].toUpperCase()}
              </span>
            </div>
            <div>
              <p className="font-semibold text-gray-800">{signer?.name}</p>
              <p className="text-xs text-gray-400">{signer?.role} · {signer?.email}</p>
            </div>
          </div>
        </div>

        {/* Signature pad */}
        <div className="bg-white rounded-2xl shadow-sm border border-gray-100 px-6 py-5">
          <div className="flex items-center gap-2 mb-4">
            <PenLine size={16} className="text-brand-600" />
            <h2 className="font-semibold text-gray-800">Su firma</h2>
          </div>
          <SignaturePad onSigned={setSigImg} disabled={sending} />

          {errMsg && (
            <div className="mt-3 flex items-center gap-2 text-red-600 text-sm bg-red-50
              rounded-lg px-3 py-2 border border-red-100">
              <AlertTriangle size={14} />
              {errMsg}
            </div>
          )}

          {/* Consent notice */}
          <p className="text-xs text-gray-400 mt-4 leading-relaxed">
            Al hacer clic en <strong>Firmar</strong>, acepta que esta firma electrónica
            tiene validez legal conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012
            de Colombia. Se registrará su dirección IP, fecha y hora como parte del
            registro de auditoría del documento.
          </p>

          {/* Actions */}
          {!showReject ? (
            <div className="flex gap-3 mt-5">
              <button
                onClick={() => { setShowReject(true); setErrMsg(''); }}
                disabled={sending}
                className="flex-1 border border-red-200 text-red-500 rounded-xl py-2.5
                  text-sm font-medium hover:bg-red-50 transition-colors disabled:opacity-50"
              >
                Rechazar
              </button>
              <button
                onClick={handleSign}
                disabled={sending || !sigImg}
                className="flex-2 flex-grow-[2] flex items-center justify-center gap-2
                  bg-brand-600 hover:bg-brand-700 text-white rounded-xl py-2.5
                  text-sm font-semibold transition-colors disabled:opacity-50
                  disabled:cursor-not-allowed shadow-sm"
              >
                {sending
                  ? <><Loader2 size={16} className="animate-spin" /> Procesando…</>
                  : <><CheckCircle size={16} /> Firmar documento</>
                }
              </button>
            </div>
          ) : (
            <div className="mt-5 space-y-3">
              <p className="text-sm font-medium text-gray-700">Motivo del rechazo</p>
              <textarea
                value={rejectReason}
                onChange={e => setRejectReason(e.target.value)}
                placeholder="Explique por qué rechaza la firma de este documento…"
                rows={3}
                disabled={sending}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm
                  resize-none focus:outline-none focus:border-brand-400 disabled:opacity-50"
              />
              <div className="flex gap-3">
                <button
                  onClick={() => { setShowReject(false); setErrMsg(''); }}
                  disabled={sending}
                  className="flex-1 border border-gray-200 text-gray-600 rounded-xl py-2.5
                    text-sm hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  Cancelar
                </button>
                <button
                  onClick={handleReject}
                  disabled={sending || !rejectReason.trim()}
                  className="flex-1 bg-red-500 hover:bg-red-600 text-white rounded-xl
                    py-2.5 text-sm font-semibold transition-colors disabled:opacity-50
                    flex items-center justify-center gap-2"
                >
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
                    ${s.status === 'signed'   ? 'bg-green-100 text-green-700' :
                      s.status === 'rejected' ? 'bg-red-100 text-red-700' :
                      s.order === signer?.order ? 'bg-brand-100 text-brand-700' :
                      'bg-gray-100 text-gray-400'}`}>
                    {s.status === 'signed' ? '✓' : i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-700 truncate">{s.name}</p>
                    <p className="text-xs text-gray-400 truncate">{s.role}</p>
                  </div>
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                    ${s.status === 'signed'    ? 'bg-green-100 text-green-700' :
                      s.status === 'rejected'  ? 'bg-red-100 text-red-700' :
                      s.status === 'notified'  ? 'bg-blue-100 text-blue-700' :
                      s.status === 'viewed'    ? 'bg-yellow-100 text-yellow-700' :
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
