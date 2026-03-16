import React, { useState, useEffect } from 'react';
import {
  Mail, Save, Send, Eye, EyeOff, CheckCircle2, XCircle,
  Loader2, Shield, Server, User, Lock, Settings, ChevronRight,
  AlertTriangle, Info,
} from 'lucide-react';
import api from '../services/api';

// ─── settingsAPI (local helper until added to api.js) ────────────────────────
const settingsAPI = {
  getEmail:  ()       => api.get('/settings/email'),
  saveEmail: (data)   => api.put('/settings/email', data),
  testEmail: (data)   => api.post('/settings/email/test', data),
};

// ─── Provider definitions ────────────────────────────────────────────────────
const PROVIDERS = [
  {
    id: 'smtp',
    label: 'SMTP Personalizado',
    icon: Server,
    desc: 'Cualquier servidor SMTP (Zoho, SendGrid, AWS SES, etc.)',
    color: 'brand',
  },
  {
    id: 'smtp_gmail',
    label: 'Gmail',
    icon: Mail,
    desc: 'Cuenta Gmail con contraseña de aplicación',
    color: 'red',
  },
  {
    id: 'smtp_m365',
    label: 'Microsoft 365 (SMTP básico)',
    icon: Mail,
    desc: 'Cuenta M365 con usuario y contraseña (SMTP AUTH habilitado)',
    color: 'blue',
  },
  {
    id: 'oauth2_m365',
    label: 'Microsoft 365 (Autenticación moderna)',
    icon: Shield,
    desc: 'App registration de Azure AD — recomendado para M365',
    color: 'violet',
    badge: 'Recomendado',
  },
];

const EMPTY = {
  provider_type: '',
  from_name: '',
  from_email: '',
  username: '',
  password: '',
  smtp_host: '',
  smtp_port: '587',
  smtp_secure: false,
  smtp_reject_unauthorized: true,
  tenant_id: '',
  client_id: '',
  client_secret: '',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────
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
    <input
      type={type}
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      className={`input-field text-sm w-full ${className}`}
      {...rest}
    />
  );
}

function PasswordInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        className="input-field text-sm w-full pr-9"
        autoComplete="new-password"
      />
      <button type="button" onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-brand-600 transition-colors">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  );
}

// ─── Sidebar nav items ───────────────────────────────────────────────────────
const NAV = [
  { id: 'email', label: 'Correo electrónico', icon: Mail },
  // Future sections: { id: 'general', label: 'General', icon: Settings },
];

// ══════════════════════════════════════════════════════════════════════════════
// Email Config Section
// ══════════════════════════════════════════════════════════════════════════════
function EmailSection() {
  const [form, setForm]       = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving]   = useState(false);
  const [testing, setTesting] = useState(false);
  const [testEmail, setTestEmail] = useState('');
  const [feedback, setFeedback]   = useState(null); // { type: 'success'|'error', msg }

  const set = (k) => (e) => {
    const val = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setForm(f => ({ ...f, [k]: val }));
  };
  const setV = (k, v) => setForm(f => ({ ...f, [k]: v }));

  useEffect(() => {
    settingsAPI.getEmail()
      .then(r => {
        const d = r.data?.data || {};
        setForm(f => ({ ...f, ...d }));
        setTestEmail(d.from_email || d.username || '');
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const showFeedback = (type, msg) => {
    setFeedback({ type, msg });
    if (type === 'success') setTimeout(() => setFeedback(null), 4000);
  };

  const handleSave = async () => {
    if (!form.provider_type) return showFeedback('error', 'Seleccione un proveedor');
    setSaving(true);
    try {
      await settingsAPI.saveEmail(form);
      showFeedback('success', 'Configuración guardada correctamente');
    } catch (e) {
      showFeedback('error', e.response?.data?.error || e.message);
    } finally { setSaving(false); }
  };

  const handleTest = async () => {
    if (!form.provider_type) return showFeedback('error', 'Guarde la configuración primero');
    setTesting(true);
    try {
      const payload = { ...form, test_recipient: testEmail };
      const r = await settingsAPI.testEmail(payload);
      showFeedback('success', r.data?.message || 'Correo de prueba enviado');
    } catch (e) {
      showFeedback('error', e.response?.data?.error || e.message);
    } finally { setTesting(false); }
  };

  const provider = PROVIDERS.find(p => p.id === form.provider_type);
  const isOAuth  = form.provider_type === 'oauth2_m365';
  const isCustom = form.provider_type === 'smtp';

  if (loading) return (
    <div className="flex justify-center py-16">
      <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
    </div>
  );

  return (
    <div className="space-y-6 max-w-2xl">

      {/* Feedback banner */}
      {feedback && (
        <div className={`flex items-start gap-3 p-3.5 rounded-lg border text-sm ${
          feedback.type === 'success'
            ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
            : 'bg-red-50 border-red-200 text-red-800'
        }`}>
          {feedback.type === 'success'
            ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
            : <XCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          <span>{feedback.msg}</span>
          <button onClick={() => setFeedback(null)} className="ml-auto text-current opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ── 1. Provider selector ── */}
      <div>
        <h3 className="text-sm font-semibold text-brand-900 mb-3">Proveedor de correo</h3>
        <div className="grid grid-cols-2 gap-2">
          {PROVIDERS.map(p => {
            const Icon = p.icon;
            const sel = form.provider_type === p.id;
            const colors = {
              brand:  sel ? 'border-brand-500 bg-brand-50' : 'border-surface-200 hover:border-brand-300',
              red:    sel ? 'border-red-400 bg-red-50'     : 'border-surface-200 hover:border-red-300',
              blue:   sel ? 'border-blue-400 bg-blue-50'   : 'border-surface-200 hover:border-blue-300',
              violet: sel ? 'border-violet-500 bg-violet-50' : 'border-surface-200 hover:border-violet-300',
            };
            return (
              <button key={p.id} type="button" onClick={() => setV('provider_type', p.id)}
                className={`relative p-3.5 rounded-xl border-2 text-left transition-all ${colors[p.color]}`}>
                {p.badge && (
                  <span className="absolute top-2 right-2 text-[9px] font-bold px-1.5 py-0.5 bg-violet-100 text-violet-700 rounded-full">
                    {p.badge}
                  </span>
                )}
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
          {/* ── 2. Sender identity ── */}
          <div className="p-4 bg-surface-50 rounded-xl border border-surface-100 space-y-3">
            <h4 className="text-xs font-semibold text-brand-800 flex items-center gap-1.5">
              <User className="w-3.5 h-3.5" /> Identidad del remitente
            </h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Nombre del remitente" hint='Ej: "SGIP-IA Notificaciones"'>
                <Input value={form.from_name} onChange={set('from_name')} placeholder='SGIP-IA' />
              </Field>
              <Field label="Correo del remitente" required hint="El correo desde el que se enviarán los mensajes">
                <Input value={form.from_email} onChange={set('from_email')} placeholder='notificaciones@empresa.com' />
              </Field>
            </div>
          </div>

          {/* ── 3a. OAuth2 M365 fields ── */}
          {isOAuth && (
            <div className="p-4 bg-violet-50 rounded-xl border border-violet-200 space-y-3">
              <div className="flex items-start gap-2">
                <Shield className="w-4 h-4 text-violet-600 mt-0.5 flex-shrink-0" />
                <div>
                  <h4 className="text-xs font-semibold text-violet-900">Autenticación moderna (OAuth2 — Microsoft Graph)</h4>
                  <p className="text-[10px] text-violet-700 mt-0.5 leading-relaxed">
                    Requiere un <b>App Registration</b> en Azure AD con permiso <b>Mail.Send</b> (Application).
                    No se necesita habilitar SMTP AUTH en Microsoft 365.
                  </p>
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
                <Field label="Tenant ID (Id. del directorio)" required hint="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX">
                  <Input value={form.tenant_id} onChange={set('tenant_id')} placeholder='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' />
                </Field>
                <Field label="Client ID (Id. de la aplicación)" required hint="XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX">
                  <Input value={form.client_id} onChange={set('client_id')} placeholder='xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx' />
                </Field>
                <Field label="Client Secret (Secreto de cliente)" required hint="El valor del secreto (no el ID)">
                  <PasswordInput value={form.client_secret} onChange={set('client_secret')} placeholder='Valor del secreto...' />
                </Field>
              </div>
            </div>
          )}

          {/* ── 3b. SMTP auth ── */}
          {!isOAuth && (
            <div className="p-4 bg-surface-50 rounded-xl border border-surface-100 space-y-3">
              <h4 className="text-xs font-semibold text-brand-800 flex items-center gap-1.5">
                <Lock className="w-3.5 h-3.5" /> Credenciales
              </h4>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Usuario / Correo" required hint={form.provider_type === 'smtp_gmail' ? 'Cuenta Gmail completa' : 'Usuario de la cuenta'}>
                  <Input value={form.username} onChange={set('username')} placeholder='correo@empresa.com' />
                </Field>
                <Field label={form.provider_type === 'smtp_gmail' ? 'Contraseña de aplicación' : 'Contraseña'} required
                  hint={form.provider_type === 'smtp_gmail' ? 'Generar en: Mi cuenta → Seguridad → Contraseñas de app' : undefined}>
                  <PasswordInput value={form.password} onChange={set('password')} placeholder='••••••••' />
                </Field>
              </div>

              {/* Gmail info note */}
              {form.provider_type === 'smtp_gmail' && (
                <div className="flex gap-2 p-2.5 bg-amber-50 border border-amber-200 rounded-lg">
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-600 flex-shrink-0 mt-0.5" />
                  <p className="text-[10px] text-amber-800">
                    Gmail requiere <b>verificación en dos pasos</b> activada y una <b>contraseña de aplicación</b> (no la contraseña normal de la cuenta).
                    <a href="https://myaccount.google.com/apppasswords" target="_blank" rel="noreferrer"
                      className="ml-1 underline">Generar aquí →</a>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── 3c. Custom SMTP server settings ── */}
          {isCustom && (
            <div className="p-4 bg-surface-50 rounded-xl border border-surface-100 space-y-3">
              <h4 className="text-xs font-semibold text-brand-800 flex items-center gap-1.5">
                <Server className="w-3.5 h-3.5" /> Servidor SMTP
              </h4>
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="Host" required hint='Ej: smtp.zoho.com'>
                    <Input value={form.smtp_host} onChange={set('smtp_host')} placeholder='smtp.ejemplo.com' />
                  </Field>
                </div>
                <Field label="Puerto" required hint="587 = STARTTLS · 465 = SSL">
                  <Input value={form.smtp_port} onChange={set('smtp_port')} placeholder='587' />
                </Field>
              </div>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-xs text-brand-800 cursor-pointer">
                  <input type="checkbox" checked={form.smtp_secure} onChange={set('smtp_secure')}
                    className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
                  Usar SSL/TLS (puerto 465)
                </label>
                <label className="flex items-center gap-2 text-xs text-brand-800 cursor-pointer">
                  <input type="checkbox" checked={form.smtp_reject_unauthorized} onChange={set('smtp_reject_unauthorized')}
                    className="rounded border-surface-300 text-brand-600 focus:ring-brand-500" />
                  Verificar certificado TLS
                </label>
              </div>
            </div>
          )}

          {/* ── M365 basic: quick info ── */}
          {form.provider_type === 'smtp_m365' && (
            <div className="flex gap-2 p-2.5 bg-blue-50 border border-blue-200 rounded-lg">
              <Info className="w-3.5 h-3.5 text-blue-600 flex-shrink-0 mt-0.5" />
              <p className="text-[10px] text-blue-800">
                Microsoft 365 usa <b>smtp.office365.com:587 (STARTTLS)</b>. Asegúrese de que
                <b> SMTP AUTH</b> esté habilitado para el buzón en el centro de administración de M365.
                Para mayor seguridad considere la autenticación moderna (OAuth2).
              </p>
            </div>
          )}

          {/* ── 4. Test connection ── */}
          <div className="p-4 bg-surface-50 rounded-xl border border-surface-100 space-y-3">
            <h4 className="text-xs font-semibold text-brand-800 flex items-center gap-1.5">
              <Send className="w-3.5 h-3.5" /> Probar conexión
            </h4>
            <div className="flex gap-2">
              <input
                type="email"
                value={testEmail}
                onChange={e => setTestEmail(e.target.value)}
                placeholder="destinatario@ejemplo.com"
                className="input-field text-sm flex-1"
              />
              <button type="button" onClick={handleTest} disabled={testing || saving}
                className="flex items-center gap-1.5 px-4 py-2 bg-brand-700 hover:bg-brand-800 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                {testing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Send className="w-3.5 h-3.5" />}
                {testing ? 'Enviando...' : 'Enviar prueba'}
              </button>
            </div>
            <p className="text-[10px] text-surface-400">
              Envía un correo de prueba para verificar que la configuración es correcta.
            </p>
          </div>
        </>
      )}

      {/* ── Save button ── */}
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
// Main ConfiguracionPage
// ══════════════════════════════════════════════════════════════════════════════
export default function ConfiguracionPage() {
  const [active, setActive] = useState('email');

  return (
    <div className="flex gap-0 h-full min-h-[calc(100vh-4rem)]">

      {/* ── Sidebar ── */}
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

      {/* ── Content ── */}
      <main className="flex-1 overflow-y-auto p-6 bg-surface-50">
        <div className="mb-5">
          <h2 className="text-lg font-display font-bold text-brand-900">
            {active === 'email' && 'Correo electrónico'}
          </h2>
          <p className="text-sm text-surface-400 mt-0.5">
            {active === 'email' && 'Configura el servidor de correo para enviar notificaciones del sistema'}
          </p>
        </div>

        {active === 'email' && <EmailSection />}
      </main>
    </div>
  );
}
