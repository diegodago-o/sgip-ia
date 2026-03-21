import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail, Save, Send, Eye, EyeOff, CheckCircle2, XCircle,
  Loader2, Shield, Server, User, Lock, Settings, ChevronRight,
  AlertTriangle, Info, Zap, Key, Plus, Trash2, Copy, RefreshCw,
  ToggleLeft, ToggleRight, Link, ExternalLink, Clock, Bell, LogIn,
} from 'lucide-react';
import api from '../services/api';

// ─── settingsAPI ─────────────────────────────────────────────────────────────
const settingsAPI = {
  getEmail:       ()    => api.get('/settings/email'),
  saveEmail:      (d)   => api.put('/settings/email', d),
  testEmail:      (d)   => api.post('/settings/email/test', d),
  getN8n:         ()    => api.get('/settings/n8n'),
  saveN8n:        (d)   => api.put('/settings/n8n', d),
  testN8n:        (d)   => api.post('/settings/n8n/test', d),
  listApiKeys:    ()    => api.get('/settings/api-keys'),
  createKey:      (d)   => api.post('/settings/api-keys', d),
  revokeKey:      (id)  => api.delete(`/settings/api-keys/${id}`),
  getNotifs:      ()    => api.get('/settings/notifications'),
  saveNotifs:     (d)   => api.put('/settings/notifications', d),
  testNotif:      (d)   => api.post('/settings/notifications/test', d),
  getSSO:         ()    => api.get('/settings/sso'),
  saveSSO:        (d)   => api.put('/settings/sso', d),
};

// ─── Provider definitions ────────────────────────────────────────────────────
const PROVIDERS = [
  { id: 'smtp',       label: 'SMTP Personalizado',            icon: Server, desc: 'Cualquier servidor SMTP (Zoho, SendGrid, AWS SES, etc.)', color: 'brand' },
  { id: 'smtp_gmail', label: 'Gmail',                         icon: Mail,   desc: 'Cuenta Gmail con contraseña de aplicación',               color: 'red'   },
  { id: 'smtp_m365',  label: 'Microsoft 365 (SMTP básico)',   icon: Mail,   desc: 'Cuenta M365 con usuario y contraseña (SMTP AUTH)',         color: 'blue'  },
  { id: 'oauth2_m365',label: 'Microsoft 365 (Auth moderna)',  icon: Shield, desc: 'App registration Azure AD — recomendado para M365',       color: 'violet', badge: 'Recomendado' },
];

const EMPTY_EMAIL = {
  provider_type: '', from_name: '', from_email: '', username: '', password: '',
  smtp_host: '', smtp_port: '587', smtp_secure: false, smtp_reject_unauthorized: true,
  tenant_id: '', client_id: '', client_secret: '',
};

// ─── Available webhook events ─────────────────────────────────────────────────
const WEBHOOK_EVENTS = [
  { id: 'acta.created',          label: 'Acta creada',               desc: 'Se firma y crea una nueva acta de comité' },
  { id: 'commitment.created',    label: 'Compromiso creado',         desc: 'Nuevo compromiso registrado en un acta' },
  { id: 'commitment.overdue',    label: 'Compromiso vencido',        desc: 'Compromiso llegó a su fecha límite sin cumplirse' },
  { id: 'correspondence.created',label: 'Correspondencia recibida',  desc: 'Nuevo documento de correspondencia ingresado' },
  { id: 'project.updated',       label: 'Proyecto actualizado',      desc: 'Cambios de estado o datos en un proyecto' },
  { id: 'payment.pending',       label: 'Pago pendiente',            desc: 'Pago de proyecto próximo a vencer o vencido' },
];

// ─── Shared helpers ───────────────────────────────────────────────────────────
function Field({ label, hint, children, required }) {
  return (
    <div>
      <label className="block text-xs font-medium text-brand-800 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-[10px] text-surface-400 mt-0.5">{hint}</p>}
    </div>
  );
}

function Input({ value, onChange, type = 'text', placeholder, className = '', ...rest }) {
  return (
    <input type={type} value={value} onChange={onChange} placeholder={placeholder}
      className={`input-field text-sm w-full ${className}`} {...rest} />
  );
}

function PasswordInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input type={show ? 'text' : 'password'} value={value} onChange={onChange}
        placeholder={placeholder} className="input-field text-sm w-full pr-9" autoComplete="new-password" />
      <button type="button" onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-brand-600 transition-colors">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

function Feedback({ fb, onClose }) {
  if (!fb) return null;
  return (
    <div className={`flex items-start gap-3 p-3.5 rounded-lg border text-sm ${
      fb.type === 'success' ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                            : 'bg-red-50 border-red-200 text-red-800'}`}>
      {fb.type === 'success' ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                              : <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
      <span>{fb.msg}</span>
      <button onClick={onClose} className="ml-auto opacity-60 hover:opacity-100">✕</button>
    </div>
  );
}

// ─── Notification type definitions (mirrors backend) ─────────────────────────
const NOTIF_TYPES = [
  { id: 'acta.created',            category: 'instant',   label: 'Acta creada',                   desc: 'Al firmar y crear una nueva acta de comité',                default_recipients: 'project_team' },
  { id: 'commitment.created',      category: 'instant',   label: 'Compromiso creado',              desc: 'Al registrar un nuevo compromiso en un acta',               default_recipients: 'project_team' },
  { id: 'correspondence.received', category: 'instant',   label: 'Correspondencia recibida',       desc: 'Al ingresar nueva correspondencia al sistema',              default_recipients: 'project_team' },
  { id: 'payment.approved',        category: 'instant',   label: 'Pago aprobado',                  desc: 'Al aprobar un pago de proyecto',                            default_recipients: 'admins'       },
  { id: 'commitment.reminder',     category: 'scheduled', label: 'Recordatorio de compromiso',     desc: 'Días antes del vencimiento de un compromiso (configurable)', default_recipients: 'project_team', default_lead_days: 3 },
  { id: 'commitment.overdue',      category: 'scheduled', label: 'Alerta compromisos vencidos',    desc: 'Resumen diario de compromisos sin cumplir que ya vencieron',  default_recipients: 'admins'       },
  { id: 'payment.due_reminder',    category: 'scheduled', label: 'Recordatorio de corte de pago',  desc: 'Días antes del cierre de período de un pago (configurable)',  default_recipients: 'admins',      default_lead_days: 5 },
];

const RECIPIENT_OPTIONS = [
  { value: 'project_team', label: 'Equipo del proyecto',    desc: 'Usuarios asignados al proyecto' },
  { value: 'admins',       label: 'Administradores',        desc: 'Usuarios con rol admin / director PMO' },
  { value: 'custom',       label: 'Correos personalizados', desc: 'Ingresa los destinatarios manualmente' },
];

// ─── Sidebar nav ──────────────────────────────────────────────────────────────
const NAV = [
  { id: 'email',           label: 'Correo electrónico', icon: Mail  },
  { id: 'notificaciones',  label: 'Notificaciones',      icon: Bell  },
  { id: 'integraciones',   label: 'Integraciones',       icon: Zap   },
  { id: 'sso',             label: 'Inicio de sesión único', icon: LogIn },
];

// ══════════════════════════════════════════════════════════════════════════════
// EMAIL SECTION
// ══════════════════════════════════════════════════════════════════════════════
function EmailSection() {
  const [form, setForm]         = useState(EMPTY_EMAIL);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [feedback, setFeedback] = useState(null);

  const set  = (k) => (e) => { const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value; setForm(f => ({ ...f, [k]: v })); };
  const setV = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    settingsAPI.getEmail()
      .then(r => { const d = r.data?.data || {}; setForm(f => ({ ...f, ...d })); setTestEmail(d.from_email || d.username || ''); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showFb = (type, msg) => { setFeedback({ type, msg }); if (type === 'success') setTimeout(() => setFeedback(null), 4000); };

  const handleSave = async () => {
    if (!form.provider_type) return showFb('error', 'Seleccione un proveedor');
    setSaving(true);
    try { await settingsAPI.saveEmail(form); showFb('success', 'Configuración guardada correctamente'); }
    catch (e) { showFb('error', e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    if (!form.provider_type) return showFb('error', 'Guarde la configuración primero');
    setTesting(true);
    try { const r = await settingsAPI.testEmail({ ...form, test_recipient: testEmail }); showFb('success', r.data?.message || 'Correo de prueba enviado'); }
    catch (e) { showFb('error', e.response?.data?.error || e.message); }
    finally { setTesting(false); }
  };

  const isOAuth  = form.provider_type === 'oauth2_m365';
  const isCustom = form.provider_type === 'smtp';

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-400" /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <Feedback fb={feedback} onClose={() => setFeedback(null)} />

      {/* Provider selector */}
      <div>
        <h3 className="text-sm font-semibold text-brand-900 mb-3">Proveedor de correo</h3>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map(p => {
            const Icon = p.icon;
            const sel = form.provider_type === p.id;
            const colors = { brand: sel ? 'border-brand-500 bg-brand-50' : 'border-surface-200 hover:border-brand-300', red: sel ? 'border-red-400 bg-red-50' : 'border-surface-200 hover:border-red-300', blue: sel ? 'border-blue-400 bg-blue-50' : 'border-surface-200 hover:border-blue-300', violet: sel ? 'border-violet-500 bg-violet-50' : 'border-surface-200 hover:border-violet-300' };
            return (
              <button key={p.id} type="button" onClick={() => setV('provider_type', p.id)}
                className={`relative p-3.5 rounded-xl border-2 text-left transition-all ${colors[p.color]}`}>
                {p.badge && <span className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded-full">{p.badge}</span>}
                <div className="flex items-center gap-2 mb-1">
                  <Icon className={`w-4 h-4 ${sel ? 'text-brand-600' : 'text-surface-400'}`} />
                  <span className={`text-xs font-semibold ${sel ? 'text-brand-900' : 'text-surface-600'}`}>{p.label}</span>
                </div>
                <p className="text-[10px] text-surface-400 leading-snug">{p.desc}</p>
              </button>
            );
          })}
        </div>
      </div>

      {form.provider_type && (
        <>
          {/* Sender identity */}
          <div className="p-4 bg-surface-50 rounded-xl border border-surface-100 space-y-3">
            <h4 className="text-xs font-semibold text-brand-800 flex items-center gap-1.5"><User className="w-3.5 h-3.5" /> Identidad del remitente</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre del remitente" hint='"SGIP-IA Notificaciones"'><Input value={form.from_name} onChange={set('from_name')} placeholder='SGIP-IA' /></Field>
              <Field label="Correo del remitente" required hint="Correo desde el que se enviarán notificaciones"><Input value={form.from_email} onChange={set('from_email')} placeholder='notificaciones@empresa.com' /></Field>
            </div>
          </div>

          {/* OAuth2 M365 */}
          {isOAuth && (
            <div className="p-4 bg-violet-50 rounded-xl border border-violet-200 space-y-3">
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-violet-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-xs font-semibold text-violet-900">Autenticación moderna (OAuth2 — Microsoft Graph)</h4>
                  <p className="text-[10px] text-violet-700 mt-0.5 leading-relaxed">Requiere un <b>App Registration</b> en Azure AD con permiso <b>Mail.Send</b> (Application). No necesita SMTP AUTH en M365.</p>
                </div>
              </div>
              <div className="p-3 bg-white rounded-lg border border-violet-100 text-[10px] text-violet-800 space-y-1">
                <p className="font-semibold">Pasos en Azure Portal:</p>
                <p>1. Azure Active Directory → Registros de aplicaciones → Nueva registro</p>
                <p>2. API permissions → Microsoft Graph → <b>Mail.Send</b> (Application) → Conceder consentimiento</p>
                <p>3. Certificados y secretos → Nuevo secreto de cliente → copiar el valor</p>
                <p>4. Copiar <b>Id. del directorio (tenant)</b> e <b>Id. de la aplicación (client)</b></p>
              </div>
              <div className="space-y-3">
                <Field label="Tenant ID" required hint="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"><Input value={form.tenant_id} onChange={set('tenant_id')} placeholder='xxxxxxxx-xxxx-...' /></Field>
                <Field label="Client ID" required hint="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX"><Input value={form.client_id} onChange={set('client_id')} placeholder='xxxxxxxx-xxxx-...' /></Field>
                <Field label="Client Secret" required hint="El valor del secreto (no el ID)"><PasswordInput value={form.client_secret} onChange={set('client_secret')} placeholder='Valor del secreto...' /></Field>
              </div>
            </div>
          )}

          {/* SMTP credentials */}
          {!isOAuth && (
            <div className="p-4 bg-surface-50 rounded-xl border border-surface-100 space-y-3">
              <h4 className="text-xs font-semibold text-brand-800 flex items-center gap-1.5"><Lock className="w-3.5 h-3.5" /> Credenciales</h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Usuario / Correo" required hint={form.provider_type === 'smtp_gmail' ? 'Cuenta Gmail completa' : 'Usuario de la cuenta'}><Input value={form.username} onChange={set('username')} placeholder='correo@empresa.com' /></Field>
                <Field label={form.provider_type === 'smtp_gmail' ? 'Contraseña de aplicación' : 'Contraseña'} required hint={form.provider_type === 'smtp_gmail' ? 'Generar en: Mi cuenta → Seguridad → Contraseñas de app' : undefined}><PasswordInput value={form.password} onChange={set('password')} placeholder='••••••••' /></Field>
              </div>
              {form.provider_type === 'smtp_gmail' && (
                <div className="flex gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-800">Gmail requiere <b>verificación en dos pasos</b> y una <b>contraseña de aplicación</b> (no la contraseña normal). <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer" className="underline">Generar aquí →</a></p>
                </div>
              )}
            </div>
          )}

          {/* Custom SMTP server */}
          {isCustom && (
            <div className="p-4 bg-surface-50 rounded-xl border border-surface-100 space-y-3">
              <h4 className="text-xs font-semibold text-brand-800 flex items-center gap-1.5"><Server className="w-3.5 h-3.5" /> Servidor SMTP</h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2"><Field label="Host" required hint='Ej: smtp.zoho.com'><Input value={form.smtp_host} onChange={set('smtp_host')} placeholder='smtp.ejemplo.com' /></Field></div>
                <Field label="Puerto" required hint="587 = STARTTLS · 465 = SSL"><Input value={form.smtp_port} onChange={set('smtp_port')} placeholder='587' /></Field>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs text-brand-800 cursor-pointer"><input type="checkbox" checked={form.smtp_secure} onChange={set('smtp_secure')} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" /> Usar SSL/TLS (puerto 465)</label>
                <label className="flex items-center gap-2 text-xs text-brand-800 cursor-pointer"><input type="checkbox" checked={form.smtp_reject_unauthorized} onChange={set('smtp_reject_unauthorized')} className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" /> Verificar certificado TLS</label>
              </div>
            </div>
          )}

          {/* M365 basic info */}
          {form.provider_type === 'smtp_m365' && (
            <div className="flex gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
              <Info className="w-3.5 h-3.5 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-blue-800">Microsoft 365 usa <b>smtp.office365.com:587 (STARTTLS)</b>. Asegúrese de que <b>SMTP AUTH</b> esté habilitado para el buzón en el centro de administración de M365. Para mayor seguridad considere la autenticación moderna (OAuth2).</p>
            </div>
          )}

          {/* Test */}
          <div className="p-4 bg-surface-50 rounded-xl border border-surface-100 space-y-3">
            <h4 className="text-xs font-semibold text-brand-800 flex items-center gap-1.5"><Send className="w-3.5 h-3.5" /> Probar conexión</h4>
            <div className="flex gap-2">
              <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)} placeholder="destinatario@ejemplo.com" className="input-field text-sm flex-1" />
              <button type="button" onClick={handleTest} disabled={testing || saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {testing ? 'Enviando...' : 'Enviar prueba'}
              </button>
            </div>
            <p className="text-[10px] text-surface-400">Envía un correo de prueba para verificar que la configuración es correcta.</p>
          </div>
        </>
      )}

      <div className="flex justify-end pt-2">
        <button type="button" onClick={handleSave} disabled={saving || !form.provider_type}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// INTEGRACIONES SECTION
// ══════════════════════════════════════════════════════════════════════════════
function IntegracionesSection() {
  // ── N8N config state ──
  const [n8n, setN8n]           = useState({ enabled: false, webhook_secret: '', events: [] });
  const [loadingN8n, setLoadingN8n] = useState(true);
  const [savingN8n, setSavingN8n]   = useState(false);
  const [testingUrl, setTestingUrl] = useState(null); // id of event being tested
  const [fb, setFb]             = useState(null);

  // ── API Keys state ──
  const [apiKeys, setApiKeys]           = useState([]);
  const [loadingKeys, setLoadingKeys]   = useState(true);
  const [newKeyName, setNewKeyName]     = useState('');
  const [creatingKey, setCreatingKey]   = useState(false);
  const [revokingId, setRevokingId]     = useState(null);
  const [newlyCreated, setNewlyCreated] = useState(null); // { key, name, prefix }
  const [copiedKey, setCopiedKey]       = useState(false);

  const showFb = (type, msg) => { setFb({ type, msg }); if (type === 'success') setTimeout(() => setFb(null), 5000); };

  // Load N8N config
  useEffect(() => {
    settingsAPI.getN8n()
      .then(r => setN8n(r.data?.data || { enabled: false, webhook_secret: '', events: [] }))
      .catch(() => {})
      .finally(() => setLoadingN8n(false));
  }, []);

  // Load API keys
  const loadApiKeys = useCallback(() => {
    setLoadingKeys(true);
    settingsAPI.listApiKeys()
      .then(r => setApiKeys(r.data?.data || []))
      .catch(() => {})
      .finally(() => setLoadingKeys(false));
  }, []);
  useEffect(() => { loadApiKeys(); }, [loadApiKeys]);

  // ── Helpers for n8n state ──
  const setEnabled = (v) => setN8n(s => ({ ...s, enabled: v }));
  const setSecret  = (v) => setN8n(s => ({ ...s, webhook_secret: v }));

  // Get or create an event entry in the events array
  const getEventUrl = (eventId) => (n8n.events || []).find(e => e.event === eventId)?.webhook_url || '';

  const setEventUrl = (eventId, url) => {
    setN8n(s => {
      const events = [...(s.events || [])];
      const idx = events.findIndex(e => e.event === eventId);
      if (url.trim() === '') {
        // Remove if empty
        if (idx >= 0) events.splice(idx, 1);
      } else {
        if (idx >= 0) events[idx] = { ...events[idx], webhook_url: url };
        else events.push({ event: eventId, webhook_url: url });
      }
      return { ...s, events };
    });
  };

  const handleSaveN8n = async () => {
    setSavingN8n(true);
    try {
      await settingsAPI.saveN8n(n8n);
      showFb('success', 'Configuración N8N guardada correctamente');
    } catch (e) { showFb('error', e.response?.data?.error || e.message); }
    finally { setSavingN8n(false); }
  };

  const handleTestWebhook = async (eventId) => {
    const url = getEventUrl(eventId);
    if (!url) return;
    setTestingUrl(eventId);
    try {
      const r = await settingsAPI.testN8n({ webhook_url: url, webhook_secret: n8n.webhook_secret });
      showFb('success', r.data?.message || 'Webhook probado correctamente');
    } catch (e) { showFb('error', e.response?.data?.error || e.message); }
    finally { setTestingUrl(null); }
  };

  // ── API Key actions ──
  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return;
    setCreatingKey(true);
    try {
      const r = await settingsAPI.createKey({ name: newKeyName.trim() });
      setNewlyCreated(r.data?.data);
      setNewKeyName('');
      loadApiKeys();
    } catch (e) { showFb('error', e.response?.data?.error || e.message); }
    finally { setCreatingKey(false); }
  };

  const handleRevoke = async (id) => {
    setRevokingId(id);
    try {
      await settingsAPI.revokeKey(id);
      loadApiKeys();
      showFb('success', 'API Key revocada correctamente');
    } catch (e) { showFb('error', e.response?.data?.error || e.message); }
    finally { setRevokingId(null); }
  };

  const copyKey = async (key) => {
    try { await navigator.clipboard.writeText(key); setCopiedKey(true); setTimeout(() => setCopiedKey(false), 2000); } catch {}
  };

  const fmtDate = (d) => d ? new Date(d).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

  if (loadingN8n) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-400" /></div>;

  return (
    <div className="space-y-8 max-w-2xl">
      <Feedback fb={fb} onClose={() => setFb(null)} />

      {/* ══ N8N Integration card ══ */}
      <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-100 bg-surface-50">
          <div className="w-9 h-9 rounded-xl bg-orange-100 flex items-center justify-center flex-shrink-0">
            <Zap className="w-4.5 h-4.5 text-orange-600" />
          </div>
          <div className="flex-1">
            <h3 className="text-sm font-semibold text-brand-900">N8N — Automatizaciones</h3>
            <p className="text-[10px] text-surface-400 mt-0.5">Envía eventos del sistema a flujos de N8N mediante webhooks</p>
          </div>
          <a href="https://n8n.io" target="_blank" rel="noreferrer"
            className="flex items-center gap-1 text-[10px] text-brand-500 hover:text-brand-700 transition-colors">
            <ExternalLink className="w-3 h-3" /> n8n.io
          </a>
        </div>

        <div className="p-5 space-y-5">
          {/* Enable toggle */}
          <div className="flex items-center justify-between p-3.5 bg-surface-50 rounded-xl border border-surface-100">
            <div>
              <p className="text-sm font-medium text-brand-800">Activar integración</p>
              <p className="text-[10px] text-surface-400">Habilita el envío de eventos a N8N</p>
            </div>
            <button type="button" onClick={() => setEnabled(!n8n.enabled)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
                n8n.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-100 text-surface-500'
              }`}>
              {n8n.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
              {n8n.enabled ? 'Activo' : 'Inactivo'}
            </button>
          </div>

          {/* Webhook secret */}
          <Field label="Secreto del webhook (HMAC-SHA256)" hint="Se usa para firmar los eventos. N8N puede verificar la firma en el header X-SGIP-Signature">
            <PasswordInput value={n8n.webhook_secret} onChange={e => setSecret(e.target.value)} placeholder="Secreto opcional para verificación de firma..." />
          </Field>

          {/* Architecture info */}
          <div className="flex gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl">
            <Info className="w-3.5 h-3.5 text-blue-500 flex-shrink-0 mt-0.5" />
            <div className="text-[10px] text-blue-800 leading-relaxed space-y-1">
              <p><b>Cómo funciona:</b> SGIP-IA hace un POST automático a la URL que configures cuando ocurre cada evento. N8N recibe el payload y puede ejecutar cualquier flujo de automatización.</p>
              <p>En N8N, agrega un nodo <b>Webhook</b> como trigger, copia la URL y pégala abajo. Activa el flujo en modo de producción.</p>
            </div>
          </div>

          {/* Event list */}
          <div>
            <h4 className="text-xs font-semibold text-brand-800 mb-2 flex items-center gap-1.5">
              <Link className="w-3.5 h-3.5" /> URLs de webhook por evento
            </h4>
            <div className="rounded-xl border border-surface-100 overflow-hidden divide-y divide-surface-100">
              {WEBHOOK_EVENTS.map(ev => {
                const url = getEventUrl(ev.id);
                const isTesting = testingUrl === ev.id;
                return (
                  <div key={ev.id} className="p-3 bg-white">
                    <div className="flex items-start gap-2 mb-2">
                      <div className="w-1.5 h-1.5 rounded-full bg-brand-400 mt-1.5 flex-shrink-0" />
                      <div>
                        <p className="text-xs font-semibold text-brand-800">{ev.label}</p>
                        <p className="text-[10px] text-surface-400">{ev.desc} · <code className="bg-surface-100 px-1 rounded text-[9px]">{ev.id}</code></p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <input
                        type="url"
                        value={url}
                        onChange={e => setEventUrl(ev.id, e.target.value)}
                        placeholder="https://tu-n8n.com/webhook/..."
                        className="input-field text-xs flex-1 font-mono"
                      />
                      {url && (
                        <button type="button" onClick={() => handleTestWebhook(ev.id)} disabled={isTesting}
                          title="Enviar evento de prueba"
                          className="flex items-center gap-1 px-2.5 py-1.5 bg-orange-50 hover:bg-orange-100 text-orange-700 text-[10px] font-medium rounded-lg border border-orange-200 transition-colors disabled:opacity-50 flex-shrink-0">
                          {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                          {isTesting ? 'Probando...' : 'Probar'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="text-[10px] text-surface-400 mt-1.5">Deja vacíos los eventos que no quieras enviar a N8N.</p>
          </div>

          {/* Save N8N */}
          <div className="flex justify-end">
            <button type="button" onClick={handleSaveN8n} disabled={savingN8n}
              className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50">
              {savingN8n ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {savingN8n ? 'Guardando...' : 'Guardar configuración N8N'}
            </button>
          </div>
        </div>
      </div>

      {/* ══ API Keys card ══ */}
      <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        {/* Header */}
        <div className="flex items-center gap-3 px-5 py-4 border-b border-surface-100 bg-surface-50">
          <div className="w-9 h-9 rounded-xl bg-brand-100 flex items-center justify-center flex-shrink-0">
            <Key className="w-4.5 h-4.5 text-brand-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-brand-900">API Keys</h3>
            <p className="text-[10px] text-surface-400 mt-0.5">Claves para que N8N consulte datos de SGIP-IA via REST API</p>
          </div>
        </div>

        <div className="p-5 space-y-4">
          {/* Info */}
          <div className="flex gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
            <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
            <p className="text-[10px] text-amber-800 leading-relaxed">
              Las API Keys permiten a <b>N8N (u otras herramientas)</b> consultar proyectos, actas, compromisos y demás recursos vía REST. Pasa la clave en el header <code className="bg-amber-100 px-1 rounded">X-API-Key: sgip_xxxxxx_...</code>. La clave completa se muestra <b>una sola vez</b> al crearla.
            </p>
          </div>

          {/* New key created banner */}
          {newlyCreated && (
            <div className="p-4 bg-emerald-50 border-2 border-emerald-300 rounded-xl space-y-2">
              <div className="flex items-center gap-2">
                <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-semibold text-emerald-800">API Key creada: <span className="text-emerald-700">{newlyCreated.name}</span></p>
              </div>
              <p className="text-[10px] text-emerald-700">Copia esta clave ahora. <b>No se mostrará de nuevo.</b></p>
              <div className="flex gap-2">
                <code className="flex-1 text-xs bg-white border border-emerald-200 rounded-lg px-3 py-2 font-mono text-brand-800 break-all">
                  {newlyCreated.key}
                </code>
                <button type="button" onClick={() => copyKey(newlyCreated.key)} title="Copiar"
                  className="flex items-center gap-1 px-3 py-2 bg-emerald-100 hover:bg-emerald-200 text-emerald-700 text-xs font-medium rounded-lg border border-emerald-200 transition-colors flex-shrink-0">
                  {copiedKey ? <CheckCircle2 className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                  {copiedKey ? '¡Copiado!' : 'Copiar'}
                </button>
              </div>
              <button type="button" onClick={() => setNewlyCreated(null)}
                className="text-[10px] text-emerald-600 hover:text-emerald-800 underline">
                Ya guardé la clave, cerrar este aviso
              </button>
            </div>
          )}

          {/* Generate new key */}
          <div>
            <h4 className="text-xs font-semibold text-brand-800 mb-2 flex items-center gap-1.5"><Plus className="w-3.5 h-3.5" /> Generar nueva API Key</h4>
            <div className="flex gap-2">
              <input
                type="text"
                value={newKeyName}
                onChange={e => setNewKeyName(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && handleCreateKey()}
                placeholder='Nombre descriptivo, ej: "N8N Producción"'
                className="input-field text-sm flex-1"
              />
              <button type="button" onClick={handleCreateKey} disabled={creatingKey || !newKeyName.trim()}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 hover:bg-brand-700 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50 flex-shrink-0">
                {creatingKey ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {creatingKey ? 'Generando...' : 'Generar'}
              </button>
            </div>
          </div>

          {/* Keys table */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-xs font-semibold text-brand-800 flex items-center gap-1.5"><Key className="w-3.5 h-3.5" /> Claves activas</h4>
              <button type="button" onClick={loadApiKeys} title="Actualizar"
                className="text-surface-400 hover:text-brand-600 transition-colors">
                <RefreshCw className={`w-3.5 h-3.5 ${loadingKeys ? 'animate-spin' : ''}`} />
              </button>
            </div>

            {loadingKeys ? (
              <div className="flex justify-center py-6"><Loader2 className="w-4 h-4 animate-spin text-brand-400" /></div>
            ) : apiKeys.length === 0 ? (
              <div className="text-center py-8 text-surface-400">
                <Key className="w-6 h-6 mx-auto mb-2 opacity-40" />
                <p className="text-xs">No hay API Keys activas</p>
              </div>
            ) : (
              <div className="rounded-xl border border-surface-100 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-surface-50 border-b border-surface-100">
                    <tr>
                      <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-surface-500 uppercase tracking-wide">Nombre</th>
                      <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-surface-500 uppercase tracking-wide">Prefijo</th>
                      <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-surface-500 uppercase tracking-wide">Creada</th>
                      <th className="text-left px-3 py-2.5 text-[10px] font-semibold text-surface-500 uppercase tracking-wide">Último uso</th>
                      <th className="px-3 py-2.5" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-surface-50">
                    {apiKeys.map(k => (
                      <tr key={k.id} className="hover:bg-surface-50 transition-colors">
                        <td className="px-3 py-2.5 font-medium text-brand-800">{k.name}</td>
                        <td className="px-3 py-2.5">
                          <code className="bg-surface-100 px-1.5 py-0.5 rounded text-[10px] text-brand-700 font-mono">{k.key_prefix}_***</code>
                        </td>
                        <td className="px-3 py-2.5 text-surface-500 flex items-center gap-1">
                          <Clock className="w-3 h-3 opacity-50" />
                          {fmtDate(k.created_at)}
                        </td>
                        <td className="px-3 py-2.5 text-surface-400 text-[10px]">{k.last_used_at ? fmtDate(k.last_used_at) : 'Nunca'}</td>
                        <td className="px-3 py-2.5 text-right">
                          <button type="button" onClick={() => handleRevoke(k.id)}
                            disabled={revokingId === k.id}
                            title="Revocar"
                            className="flex items-center gap-1 ml-auto px-2 py-1 text-red-500 hover:bg-red-50 rounded-lg transition-colors disabled:opacity-50">
                            {revokingId === k.id ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                            <span className="text-[10px]">Revocar</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// NOTIFICACIONES SECTION
// ══════════════════════════════════════════════════════════════════════════════
function NotificacionesSection() {
  const [cfg, setCfg]           = useState({ enabled: false, notifications: {} });
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [fb, setFb]             = useState(null);

  const showFb = (type, msg) => { setFb({ type, msg }); if (type === 'success') setTimeout(() => setFb(null), 5000); };

  useEffect(() => {
    settingsAPI.getNotifs()
      .then(r => setCfg(r.data?.data || { enabled: false, notifications: {} }))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // ── Config helpers ──
  const setEnabled = (v) => setCfg(s => ({ ...s, enabled: v }));

  const getTypeCfg = (id) => (cfg.notifications || {})[id] || {};

  const setTypeCfg = (id, patch) => setCfg(s => ({
    ...s,
    notifications: {
      ...s.notifications,
      [id]: { ...getTypeCfg(id), ...patch },
    },
  }));

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsAPI.saveNotifs(cfg);
      showFb('success', 'Configuración de notificaciones guardada correctamente');
    } catch (e) { showFb('error', e.response?.data?.error || e.message); }
    finally { setSaving(false); }
  };

  const handleTest = async () => {
    if (!testEmail) return showFb('error', 'Ingresa un correo destinatario para la prueba');
    setTesting(true);
    try {
      const r = await settingsAPI.testNotif({ email: testEmail });
      showFb('success', r.data?.message || 'Correo de prueba enviado');
    } catch (e) { showFb('error', e.response?.data?.error || e.message); }
    finally { setTesting(false); }
  };

  const instant   = NOTIF_TYPES.filter(t => t.category === 'instant');
  const scheduled = NOTIF_TYPES.filter(t => t.category === 'scheduled');

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-400" /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <Feedback fb={fb} onClose={() => setFb(null)} />

      {/* Global toggle */}
      <div className="flex items-center justify-between p-4 bg-white rounded-2xl border border-surface-200 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-brand-100 flex items-center justify-center">
            <Bell className="w-4.5 h-4.5 text-brand-600" />
          </div>
          <div>
            <p className="text-sm font-semibold text-brand-900">Notificaciones por correo</p>
            <p className="text-[10px] text-surface-400">Activa o desactiva todas las notificaciones del sistema</p>
          </div>
        </div>
        <button type="button" onClick={() => setEnabled(!cfg.enabled)}
          className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${
            cfg.enabled ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-100 text-surface-500'
          }`}>
          {cfg.enabled ? <ToggleRight className="w-4 h-4" /> : <ToggleLeft className="w-4 h-4" />}
          {cfg.enabled ? 'Activo' : 'Inactivo'}
        </button>
      </div>

      {/* Prerequisite warning */}
      <div className="flex gap-2 p-3 bg-amber-50 border border-amber-100 rounded-xl">
        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
        <p className="text-[10px] text-amber-800 leading-relaxed">
          Las notificaciones usan el servidor configurado en <b>Correo electrónico</b>. Asegúrate de que esté configurado y probado antes de activarlas.
        </p>
      </div>

      {/* ── Immediate notifications ── */}
      <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-surface-100 bg-surface-50">
          <Send className="w-3.5 h-3.5 text-brand-500" />
          <span className="text-xs font-semibold text-brand-800 uppercase tracking-wide">Notificaciones inmediatas</span>
          <span className="text-[10px] text-surface-400 ml-1">Se envían en el momento del evento</span>
        </div>
        <div className="divide-y divide-surface-50">
          {instant.map(t => {
            const tc = getTypeCfg(t.id);
            const isEnabled = tc.enabled ?? false;
            return (
              <div key={t.id} className={`p-4 transition-colors ${!cfg.enabled ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="text-sm font-medium text-brand-800">{t.label}</p>
                    <p className="text-[10px] text-surface-400 mt-0.5">{t.desc}</p>
                  </div>
                  <button type="button"
                    disabled={!cfg.enabled}
                    onClick={() => setTypeCfg(t.id, { enabled: !isEnabled })}
                    className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all disabled:cursor-not-allowed ${
                      isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-100 text-surface-500'
                    }`}>
                    {isEnabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                    {isEnabled ? 'Activo' : 'Inactivo'}
                  </button>
                </div>

                {isEnabled && cfg.enabled && (
                  <div className="grid grid-cols-2 gap-3 mt-2 pt-2 border-t border-surface-50">
                    {/* Recipients */}
                    <div>
                      <label className="block text-[10px] font-medium text-surface-500 mb-1">Destinatarios</label>
                      <select
                        value={tc.recipients || t.default_recipients}
                        onChange={e => setTypeCfg(t.id, { recipients: e.target.value })}
                        className="input-field text-xs w-full py-1.5">
                        {RECIPIENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    {/* Custom emails */}
                    {(tc.recipients || t.default_recipients) === 'custom' && (
                      <div>
                        <label className="block text-[10px] font-medium text-surface-500 mb-1">Correos (separados por coma)</label>
                        <input
                          type="text"
                          value={(tc.custom_emails || []).join(', ')}
                          onChange={e => setTypeCfg(t.id, { custom_emails: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
                          placeholder="a@empresa.com, b@empresa.com"
                          className="input-field text-xs w-full py-1.5"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* ── Scheduled notifications ── */}
      <div className="rounded-2xl border border-surface-200 bg-white overflow-hidden shadow-sm">
        <div className="flex items-center gap-2 px-5 py-3.5 border-b border-surface-100 bg-surface-50">
          <Clock className="w-3.5 h-3.5 text-brand-500" />
          <span className="text-xs font-semibold text-brand-800 uppercase tracking-wide">Recordatorios programados</span>
          <span className="text-[10px] text-surface-400 ml-1">Se verifican cada hora automáticamente</span>
        </div>
        <div className="divide-y divide-surface-50">
          {scheduled.map(t => {
            const tc = getTypeCfg(t.id);
            const isEnabled = tc.enabled ?? false;
            return (
              <div key={t.id} className={`p-4 transition-colors ${!cfg.enabled ? 'opacity-50' : ''}`}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <div>
                    <p className="text-sm font-medium text-brand-800">{t.label}</p>
                    <p className="text-[10px] text-surface-400 mt-0.5">{t.desc}</p>
                  </div>
                  <button type="button"
                    disabled={!cfg.enabled}
                    onClick={() => setTypeCfg(t.id, { enabled: !isEnabled })}
                    className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all disabled:cursor-not-allowed ${
                      isEnabled ? 'bg-emerald-100 text-emerald-700' : 'bg-surface-100 text-surface-500'
                    }`}>
                    {isEnabled ? <ToggleRight className="w-3.5 h-3.5" /> : <ToggleLeft className="w-3.5 h-3.5" />}
                    {isEnabled ? 'Activo' : 'Inactivo'}
                  </button>
                </div>

                {isEnabled && cfg.enabled && (
                  <div className="grid grid-cols-2 gap-3 mt-2 pt-2 border-t border-surface-50">
                    {/* Destinatarios */}
                    <div>
                      <label className="block text-[10px] font-medium text-surface-500 mb-1">Destinatarios</label>
                      <select
                        value={tc.recipients || t.default_recipients}
                        onChange={e => setTypeCfg(t.id, { recipients: e.target.value })}
                        className="input-field text-xs w-full py-1.5">
                        {RECIPIENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </div>
                    {/* Días de anticipación */}
                    {t.default_lead_days !== undefined && (
                      <div>
                        <label className="block text-[10px] font-medium text-surface-500 mb-1">Días de anticipación</label>
                        <div className="flex items-center gap-2">
                          <input
                            type="number"
                            min="1" max="30"
                            value={tc.lead_days ?? t.default_lead_days}
                            onChange={e => setTypeCfg(t.id, { lead_days: Number(e.target.value) })}
                            className="input-field text-xs w-20 py-1.5"
                          />
                          <span className="text-[10px] text-surface-400">días antes del vencimiento</span>
                        </div>
                      </div>
                    )}
                    {/* Custom emails */}
                    {(tc.recipients || t.default_recipients) === 'custom' && (
                      <div className="col-span-2">
                        <label className="block text-[10px] font-medium text-surface-500 mb-1">Correos (separados por coma)</label>
                        <input
                          type="text"
                          value={(tc.custom_emails || []).join(', ')}
                          onChange={e => setTypeCfg(t.id, { custom_emails: e.target.value.split(',').map(x => x.trim()).filter(Boolean) })}
                          placeholder="a@empresa.com, b@empresa.com"
                          className="input-field text-xs w-full py-1.5"
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Test send */}
      <div className="p-4 bg-white rounded-2xl border border-surface-200 shadow-sm space-y-3">
        <h4 className="text-xs font-semibold text-brand-800 flex items-center gap-1.5">
          <Send className="w-3.5 h-3.5" /> Probar envío de notificación
        </h4>
        <div className="flex gap-2">
          <input type="email" value={testEmail} onChange={e => setTestEmail(e.target.value)}
            placeholder="destinatario@empresa.com"
            className="input-field text-sm flex-1" />
          <button type="button" onClick={handleTest} disabled={testing}
            className="flex items-center gap-1.5 px-4 py-2 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
            {testing ? 'Enviando...' : 'Enviar prueba'}
          </button>
        </div>
        <p className="text-[10px] text-surface-400">Envía un correo de prueba para verificar que las notificaciones llegan correctamente.</p>
      </div>

      {/* Save */}
      <div className="flex justify-end pt-2">
        <button type="button" onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-lg shadow-sm transition-colors disabled:opacity-50">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Guardando...' : 'Guardar configuración'}
        </button>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// ══════════════════════════════════════════════════════════════════════════════
// SSO SECTION
// ══════════════════════════════════════════════════════════════════════════════
const ROLES = [
  { value: 'apoyo',          label: 'Apoyo' },
  { value: 'coordinador',    label: 'Coordinador' },
  { value: 'director',       label: 'Director' },
  { value: 'director_pmo',   label: 'Director PMO' },
  { value: 'admin',          label: 'Administrador' },
];

const EMPTY_SSO = {
  google_enabled: false,
  google_client_id: '',
  google_client_secret: '',
  microsoft_enabled: false,
  microsoft_mode: 'multi',       // 'multi' = todos los tenants M365 | 'single' = un tenant específico
  microsoft_tenant_id: '',       // requerido solo cuando microsoft_mode === 'single'
  microsoft_client_id: '',
  microsoft_client_secret: '',
  allow_new_users: true,
  default_role: 'apoyo',
};

function SSOSection() {
  const [form, setForm]         = useState(EMPTY_SSO);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [feedback, setFeedback] = useState(null);

  const set  = (k) => (e) => {
    const v = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(f => ({ ...f, [k]: v }));
  };

  const showFb = (type, msg) => {
    setFeedback({ type, msg });
    if (type === 'success') setTimeout(() => setFeedback(null), 4000);
  };

  useEffect(() => {
    settingsAPI.getSSO()
      .then(r => { const d = r.data?.data || {}; setForm(f => ({ ...f, ...d })); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleSave = async () => {
    setSaving(true);
    try {
      await settingsAPI.saveSSO(form);
      showFb('success', 'Configuración SSO guardada correctamente');
    } catch (e) {
      showFb('error', e.response?.data?.error || e.message);
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="flex justify-center py-16"><Loader2 className="w-5 h-5 animate-spin text-brand-400" /></div>;

  return (
    <div className="space-y-6 max-w-2xl">
      <Feedback fb={feedback} onClose={() => setFeedback(null)} />

      {/* Info banner */}
      <div className="p-4 bg-blue-50 rounded-xl border border-blue-200 flex gap-3">
        <Info className="w-4 h-4 text-blue-600 flex-shrink-0 mt-0.5" />
        <div className="text-xs text-blue-800 leading-relaxed space-y-1">
          <p>El SSO permite que los usuarios inicien sesión con sus cuentas corporativas sin contraseña.</p>
          <p>Los usuarios existentes se vinculan por <strong>email</strong>. Los nuevos se crean con el rol predeterminado configurado abajo.</p>
          <p>Los botones aparecen en la página de inicio de sesión solo cuando el proveedor está <strong>habilitado y completamente configurado</strong>.</p>
        </div>
      </div>

      {/* Google */}
      <div className="p-5 bg-white rounded-xl border border-surface-200 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-50 border border-surface-200 flex items-center justify-center">
              <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
                <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
                <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
                <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
                <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-brand-900">Google Workspace / Gmail</h3>
              <p className="text-[10px] text-surface-400">OAuth 2.0 — Google Cloud Console</p>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-xs text-surface-500">{form.google_enabled ? 'Habilitado' : 'Deshabilitado'}</span>
            <button type="button" onClick={() => setForm(f => ({ ...f, google_enabled: !f.google_enabled }))}>
              {form.google_enabled
                ? <ToggleRight className="w-7 h-7 text-brand-600" />
                : <ToggleLeft  className="w-7 h-7 text-surface-300" />}
            </button>
          </label>
        </div>

        {form.google_enabled && (
          <div className="pt-3 border-t border-surface-100 space-y-3">
            <div className="p-3 bg-amber-50 rounded-lg border border-amber-200 text-xs text-amber-800 leading-relaxed">
              <strong>Configuración en Google Cloud Console:</strong>
              <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                <li>Crea un proyecto en <a href="https://console.cloud.google.com/" target="_blank" rel="noreferrer" className="underline">console.cloud.google.com</a></li>
                <li>Habilita la <strong>Google+ API</strong> / <strong>People API</strong></li>
                <li>En "Credenciales" → "ID de cliente OAuth 2.0" → tipo: <strong>Aplicación web</strong></li>
                <li>URI de redireccionamiento autorizado: <code className="bg-amber-100 px-1 rounded">{window.location.origin.replace(':3001', ':4000')}/api/auth/google/callback</code></li>
              </ol>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Client ID" required>
                <Input value={form.google_client_id} onChange={set('google_client_id')} placeholder="xxxxxxxxxx.apps.googleusercontent.com" />
              </Field>
              <Field label="Client Secret" required>
                <PasswordInput value={form.google_client_secret} onChange={set('google_client_secret')} placeholder="GOCSPX-..." />
              </Field>
            </div>
          </div>
        )}
      </div>

      {/* Microsoft */}
      <div className="p-5 bg-white rounded-xl border border-surface-200 space-y-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-surface-50 border border-surface-200 flex items-center justify-center">
              <svg viewBox="0 0 23 23" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
                <rect x="1" y="1" width="10" height="10" fill="#F25022"/>
                <rect x="12" y="1" width="10" height="10" fill="#7FBA00"/>
                <rect x="1" y="12" width="10" height="10" fill="#00A4EF"/>
                <rect x="12" y="12" width="10" height="10" fill="#FFB900"/>
              </svg>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-brand-900">Microsoft 365 / Outlook</h3>
              <p className="text-[10px] text-surface-400">OAuth 2.0 — Azure Active Directory</p>
            </div>
          </div>
          <label className="flex items-center gap-2 cursor-pointer select-none">
            <span className="text-xs text-surface-500">{form.microsoft_enabled ? 'Habilitado' : 'Deshabilitado'}</span>
            <button type="button" onClick={() => setForm(f => ({ ...f, microsoft_enabled: !f.microsoft_enabled }))}>
              {form.microsoft_enabled
                ? <ToggleRight className="w-7 h-7 text-brand-600" />
                : <ToggleLeft  className="w-7 h-7 text-surface-300" />}
            </button>
          </label>
        </div>

        {form.microsoft_enabled && (
          <div className="pt-3 border-t border-surface-100 space-y-4">

            {/* Tenant mode selector */}
            <div>
              <p className="text-xs font-medium text-brand-800 mb-2">Modo de acceso</p>
              <div className="grid grid-cols-2 gap-2">
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, microsoft_mode: 'multi' }))}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    (form.microsoft_mode || 'multi') === 'multi'
                      ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-400'
                      : 'border-surface-200 bg-white hover:border-brand-300'
                  }`}>
                  <p className="text-xs font-semibold text-brand-900">Multi-tenant <span className="ml-1 px-1.5 py-0.5 rounded bg-brand-100 text-brand-700 text-[10px]">Recomendado</span></p>
                  <p className="text-[10px] text-surface-500 mt-0.5 leading-relaxed">
                    Acepta usuarios de <strong>cualquier tenant de Microsoft 365</strong>.<br/>
                    Ideal si manejas múltiples organizaciones o tenants.
                  </p>
                </button>
                <button type="button"
                  onClick={() => setForm(f => ({ ...f, microsoft_mode: 'single' }))}
                  className={`p-3 rounded-xl border text-left transition-all ${
                    form.microsoft_mode === 'single'
                      ? 'border-brand-500 bg-brand-50 ring-1 ring-brand-400'
                      : 'border-surface-200 bg-white hover:border-brand-300'
                  }`}>
                  <p className="text-xs font-semibold text-brand-900">Tenant único</p>
                  <p className="text-[10px] text-surface-500 mt-0.5 leading-relaxed">
                    Restringe el acceso a <strong>una sola organización</strong>.<br/>
                    Requiere el Tenant ID de esa organización.
                  </p>
                </button>
              </div>
            </div>

            {/* Azure setup instructions */}
            <div className="p-3 bg-blue-50 rounded-lg border border-blue-200 text-xs text-blue-800 leading-relaxed">
              <strong>Configuración en Azure Active Directory:</strong>
              <ol className="list-decimal ml-4 mt-1 space-y-0.5">
                <li>Ve a <a href="https://portal.azure.com/" target="_blank" rel="noreferrer" className="underline">portal.azure.com</a> → Azure AD → Registros de aplicaciones</li>
                <li>Crea una nueva aplicación → tipo de cuenta:{' '}
                  {(form.microsoft_mode || 'multi') === 'multi'
                    ? <strong>Cuentas en cualquier directorio organizacional (multiinquilino)</strong>
                    : <strong>Cuentas solo en este directorio organizacional (tenant único)</strong>}
                </li>
                <li>URI de redirección: <code className="bg-blue-100 px-1 rounded">{window.location.origin.replace(':3001', ':4000')}/api/auth/microsoft/callback</code></li>
                <li>En "Certificados y secretos" crea un nuevo secreto de cliente</li>
                <li>Permisos de API (delegados): <strong>openid, email, profile, User.Read</strong></li>
              </ol>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Tenant ID — only required in single mode */}
              {form.microsoft_mode === 'single' && (
                <Field label="Tenant ID" required hint="ID del directorio Azure AD de tu organización">
                  <Input value={form.microsoft_tenant_id} onChange={set('microsoft_tenant_id')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
                </Field>
              )}
              <Field label="Client ID (Application ID)" required className={form.microsoft_mode === 'single' ? '' : 'col-span-2'}>
                <Input value={form.microsoft_client_id} onChange={set('microsoft_client_id')} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
              </Field>
              <div className={form.microsoft_mode === 'single' ? 'col-span-2' : 'col-span-2'}>
                <Field label="Client Secret" required>
                  <PasswordInput value={form.microsoft_client_secret} onChange={set('microsoft_client_secret')} placeholder="Valor del secreto de cliente" />
                </Field>
              </div>
            </div>

            {(form.microsoft_mode || 'multi') === 'multi' && (
              <div className="flex items-start gap-2 p-2.5 bg-green-50 rounded-lg border border-green-200">
                <CheckCircle2 className="w-3.5 h-3.5 text-green-600 flex-shrink-0 mt-0.5" />
                <p className="text-[10px] text-green-800 leading-relaxed">
                  Modo multi-tenant activo — los usuarios de <strong>todos tus tenants de Microsoft 365</strong> podrán iniciar sesión con una sola configuración. No se requiere Tenant ID.
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {/* User provisioning */}
      <div className="p-5 bg-white rounded-xl border border-surface-200 space-y-4">
        <h3 className="text-sm font-semibold text-brand-900 flex items-center gap-2">
          <User className="w-4 h-4 text-brand-500" />
          Aprovisionamiento de usuarios
        </h3>
        <div className="space-y-4">
          <div className="flex items-center justify-between py-2 border-b border-surface-100">
            <div>
              <p className="text-sm text-brand-800 font-medium">Permitir nuevos usuarios</p>
              <p className="text-xs text-surface-400 mt-0.5">Si está deshabilitado, solo usuarios ya registrados pueden usar SSO</p>
            </div>
            <button type="button" onClick={() => setForm(f => ({ ...f, allow_new_users: !f.allow_new_users }))}>
              {form.allow_new_users
                ? <ToggleRight className="w-7 h-7 text-brand-600" />
                : <ToggleLeft  className="w-7 h-7 text-surface-300" />}
            </button>
          </div>
          <Field label="Rol predeterminado para nuevos usuarios" hint="Rol asignado automáticamente al registrar un usuario vía SSO por primera vez">
            <select value={form.default_role} onChange={set('default_role')}
              className="input-field text-sm w-full">
              {ROLES.map(r => <option key={r.value} value={r.value}>{r.label}</option>)}
            </select>
          </Field>
        </div>
      </div>

      {/* Save */}
      <div className="flex justify-end">
        <button onClick={handleSave} disabled={saving}
          className="flex items-center gap-2 px-5 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl shadow-sm transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Guardando...' : 'Guardar configuración SSO'}
        </button>
      </div>
    </div>
  );
}

// Main ConfiguracionPage
// ══════════════════════════════════════════════════════════════════════════════
export default function ConfiguracionPage() {
  const [active, setActive] = useState('email');

  const titles = {
    email:           { h: 'Correo electrónico',         sub: 'Configura el servidor de correo para enviar notificaciones del sistema' },
    notificaciones:  { h: 'Notificaciones',              sub: 'Define qué eventos del sistema disparan emails, a quién y con cuánta anticipación' },
    integraciones:   { h: 'Integraciones',               sub: 'Conecta SGIP-IA con N8N y herramientas externas mediante webhooks y API Keys' },
    sso:             { h: 'Inicio de sesión único (SSO)', sub: 'Configura Google y Microsoft 365 para que los usuarios inicien sesión con sus cuentas corporativas' },
  };

  return (
    <div className="flex gap-0 h-full min-h-[calc(100vh-4rem)]">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 border-r border-surface-200 bg-white">
        <div className="p-4 border-b border-surface-100">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-brand-100 flex items-center justify-center">
              <Settings className="w-3.5 h-3.5 text-brand-600" />
            </div>
            <span className="text-sm font-semibold text-brand-900">Configuración</span>
          </div>
        </div>
        <nav className="p-2 space-y-0.5">
          {NAV.map(item => {
            const Icon = item.icon;
            const sel = active === item.id;
            return (
              <button key={item.id} onClick={() => setActive(item.id)}
                className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors ${
                  sel ? 'bg-brand-600 text-white font-medium' : 'text-surface-600 hover:bg-surface-50 hover:text-brand-700'
                }`}>
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${sel ? 'text-white' : 'text-surface-400'}`} />
                  {item.label}
                </div>
                {!sel && <ChevronRight className="w-3 h-3 text-surface-300" />}
              </button>
            );
          })}
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 overflow-y-auto p-6 bg-surface-50">
        <div className="mb-5">
          <h2 className="text-lg font-display font-bold text-brand-900">{titles[active]?.h}</h2>
          <p className="text-sm text-surface-400 mt-0.5">{titles[active]?.sub}</p>
        </div>
        {active === 'email'          && <EmailSection />}
        {active === 'notificaciones' && <NotificacionesSection />}
        {active === 'integraciones'  && <IntegracionesSection />}
        {active === 'sso'            && <SSOSection />}
      </main>
    </div>
  );
}
