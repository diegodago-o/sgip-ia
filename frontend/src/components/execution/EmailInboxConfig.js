import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail, Server, Shield, Zap, Eye, EyeOff, CheckCircle2,
  AlertCircle, Loader2, RefreshCw, Trash2, Power, PowerOff,
  ChevronDown, ChevronUp, Settings, Clock, X,
} from 'lucide-react';
import { emailInboxAPI } from '../../services/api';

// ─── Configuraciones por proveedor ────────────────────────────────────────────
const PROVIDERS = [
  {
    id:          'imap',
    label:       'SMTP / IMAP',
    desc:        'Servidor personalizado',
    icon:        Server,
    badge:       null,
    defaults:    { imap_port: 993, imap_use_ssl: true },
    fields:      ['imap_host', 'imap_port', 'imap_use_ssl', 'imap_folder', 'username', 'password'],
  },
  {
    id:          'gmail',
    label:       'Gmail',
    desc:        'Contraseña de aplicación',
    icon:        Mail,
    badge:       null,
    defaults:    { imap_host: 'imap.gmail.com', imap_port: 993, imap_use_ssl: true },
    fields:      ['username', 'password'],
    hint:        'Usa una contraseña de aplicación de Google (no tu contraseña normal). Actívala en myaccount.google.com → Seguridad → Contraseñas de aplicaciones.',
  },
  {
    id:          'm365_basic',
    label:       'Microsoft 365',
    desc:        'Usuario y contraseña',
    icon:        Mail,
    badge:       null,
    defaults:    { imap_host: 'outlook.office365.com', imap_port: 993, imap_use_ssl: true },
    fields:      ['username', 'password'],
    hint:        'M365 usa outlook.office365.com:993 (SSL). Asegúrate de que SMTP AUTH esté habilitado en el centro de administración M365 para este buzón.',
  },
  {
    id:          'm365_modern',
    label:       'Microsoft 365 (Modern)',
    desc:        'Graph API — OAuth2',
    icon:        Shield,
    badge:       'Recomendado',
    fields:      ['tenant_id', 'client_id', 'client_secret'],
    hint:        'Requiere permisos Mail.Read en la App registration de Azure AD. Si ya tienes la conexión de SharePoint configurada, puedes reutilizar el mismo App registration agregando el permiso.',
  },
];

const INTERVALS = [
  { value: 5,  label: 'Cada 5 min' },
  { value: 15, label: 'Cada 15 min' },
  { value: 30, label: 'Cada 30 min' },
  { value: 60, label: 'Cada hora' },
];

// ─── Componente principal ─────────────────────────────────────────────────────
export default function EmailInboxConfig({ projectId, onClose }) {
  const [config, setConfig]     = useState(null);
  const [loading, setLoading]   = useState(true);
  const [saving, setSaving]     = useState(false);
  const [testing, setTesting]   = useState(false);
  const [syncing, setSyncing]   = useState(false);
  const [toggling, setToggling] = useState(false);

  const [form, setForm] = useState({
    provider:          'm365_basic',
    email:             '',
    imap_host:         '',
    imap_port:         993,
    imap_use_ssl:      true,
    imap_folder:       'INBOX',
    username:          '',
    password:          '',
    tenant_id:         '',
    client_id:         '',
    client_secret:     '',
    poll_interval_min: 15,
  });

  const [showPass, setShowPass]         = useState(false);
  const [showSecret, setShowSecret]     = useState(false);
  const [testResult, setTestResult]     = useState(null);
  const [saveError, setSaveError]       = useState('');
  const [syncResult, setSyncResult]     = useState(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  // ── Carga config existente ────────────────────────────────────────────
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await emailInboxAPI.get(projectId);
      const d = r.data.data;
      setConfig(d);
      if (d) {
        setForm(f => ({
          ...f,
          provider:          d.provider          || 'm365_basic',
          email:             d.email             || '',
          imap_host:         d.imap_host         || '',
          imap_port:         d.imap_port         || 993,
          imap_use_ssl:      d.imap_use_ssl      !== false,
          imap_folder:       d.imap_folder       || 'INBOX',
          username:          d.username          || '',
          tenant_id:         d.tenant_id         || '',
          client_id:         d.client_id         || '',
          poll_interval_min: d.poll_interval_min || 15,
        }));
      }
    } catch { setConfig(null); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleProviderChange = (pid) => {
    const prov = PROVIDERS.find(p => p.id === pid);
    if (!prov) return;
    setForm(f => ({
      ...f,
      provider:    pid,
      imap_host:   prov.defaults?.imap_host   || f.imap_host,
      imap_port:   prov.defaults?.imap_port   || f.imap_port,
      imap_use_ssl: prov.defaults?.imap_use_ssl !== undefined ? prov.defaults.imap_use_ssl : f.imap_use_ssl,
    }));
    setTestResult(null);
  };

  // ── Guardar ──────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveError(''); setSaving(true); setTestResult(null);
    try {
      if (!form.email) { setSaveError('El email del buzón es requerido'); return; }
      const payload = { ...form };
      if (!payload.password)      delete payload.password;
      if (!payload.client_secret) delete payload.client_secret;
      await emailInboxAPI.save(projectId, payload);
      await load();
      setSaveError('');
    } catch (e) {
      setSaveError(e.response?.data?.error || 'Error al guardar');
    } finally { setSaving(false); }
  };

  // ── Probar conexión ──────────────────────────────────────────────────
  const handleTest = async () => {
    setTesting(true); setTestResult(null);
    try {
      const payload = { ...form };
      if (!payload.password)      delete payload.password;
      if (!payload.client_secret) delete payload.client_secret;
      const r = await emailInboxAPI.test(projectId, payload);
      setTestResult({ ok: true, message: r.data.message });
    } catch (e) {
      setTestResult({ ok: false, message: e.response?.data?.error || e.message });
    } finally { setTesting(false); }
  };

  // ── Sincronizar ahora ────────────────────────────────────────────────
  const handleSync = async () => {
    setSyncing(true); setSyncResult(null);
    try {
      const r = await emailInboxAPI.sync(projectId);
      setSyncResult({ ok: true, message: r.data.message, imported: r.data.imported });
      await load();
    } catch (e) {
      setSyncResult({ ok: false, message: e.response?.data?.error || e.message });
    } finally { setSyncing(false); }
  };

  // ── Toggle habilitar / deshabilitar ─────────────────────────────────
  const handleToggle = async () => {
    setToggling(true);
    try { await emailInboxAPI.toggle(projectId); await load(); }
    catch { /* ignore */ }
    finally { setToggling(false); }
  };

  // ── Eliminar config ──────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!window.confirm('¿Eliminar la configuración de bandeja? Los correos ya importados se conservan.')) return;
    try {
      await emailInboxAPI.remove(projectId);
      setConfig(null);
      setForm(f => ({ ...f, email: '', username: '', password: '', tenant_id: '', client_id: '', client_secret: '' }));
    } catch { /* ignore */ }
  };

  const currentProv = PROVIDERS.find(p => p.id === form.provider) || PROVIDERS[0];
  const hasConfig   = !!config;

  // ─── Render ────────────────────────────────────────────────────────────────
  return (
    /* Overlay */
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4" onClick={e => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col overflow-hidden">

        {/* ── Modal header ── */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-surface-100 flex-shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-teal-50 rounded-xl flex items-center justify-center">
              <Mail className="w-5 h-5 text-teal-600" />
            </div>
            <div>
              <h2 className="text-base font-semibold text-surface-900">Configuración de bandeja de correo</h2>
              <p className="text-xs text-surface-400">Monitoreo automático de correos entrantes para este proyecto</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-surface-100 rounded-xl transition-colors text-surface-400 hover:text-surface-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* ── Modal body ── */}
        {loading ? (
          <div className="flex items-center justify-center flex-1 py-20">
            <Loader2 className="w-6 h-6 animate-spin text-teal-500" />
          </div>
        ) : (
          <div className="flex flex-1 overflow-hidden">

            {/* ── Sidebar: selector de proveedor ── */}
            <div className="w-64 flex-shrink-0 border-r border-surface-100 bg-surface-50/60 p-4 space-y-1.5 overflow-y-auto">
              <p className="text-[10px] font-semibold text-surface-400 uppercase tracking-wider px-2 mb-3">Proveedor</p>
              {PROVIDERS.map(p => {
                const Icon   = p.icon;
                const active = form.provider === p.id;
                return (
                  <button key={p.id} type="button" onClick={() => handleProviderChange(p.id)}
                    className={`w-full flex items-start gap-3 px-3 py-3 rounded-xl text-left transition-all relative
                      ${active
                        ? 'bg-teal-50 border-l-2 border-teal-500 pl-[10px] shadow-sm'
                        : 'hover:bg-surface-100 border-l-2 border-transparent'}`}>
                    <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5
                      ${active ? 'bg-teal-100' : 'bg-surface-200'}`}>
                      <Icon className={`w-4 h-4 ${active ? 'text-teal-700' : 'text-surface-500'}`} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <p className={`text-sm font-semibold leading-tight ${active ? 'text-teal-900' : 'text-surface-700'}`}>{p.label}</p>
                        {p.badge && (
                          <span className="text-[9px] font-bold px-1.5 py-0.5 bg-teal-600 text-white rounded-full leading-none">{p.badge}</span>
                        )}
                      </div>
                      <p className="text-xs text-surface-400 mt-0.5 leading-snug">{p.desc}</p>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* ── Panel derecho: formulario ── */}
            <div className="flex-1 overflow-y-auto">
              <div className="p-6 space-y-5">

                {/* Alerts de estado */}
                {hasConfig && config.last_error && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-xs text-red-700">
                    <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                    <div><span className="font-semibold">Último error:</span> {config.last_error}</div>
                  </div>
                )}

                {syncResult && (
                  <div className={`flex items-start gap-2 p-3 rounded-xl text-sm border ${syncResult.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                    {syncResult.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                    {syncResult.message}
                  </div>
                )}

                {/* Hint del proveedor */}
                {currentProv.hint && (
                  <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
                    <Zap className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" />
                    <span>{currentProv.hint}</span>
                  </div>
                )}

                {/* Email del buzón */}
                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-surface-700">
                    Email del buzón <span className="text-red-500">*</span>
                  </label>
                  <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
                    placeholder="correspondencia-proyecto@empresa.com"
                    className="w-full px-3 py-2 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-shadow" />
                  <p className="text-[10px] text-surface-400">Dirección de la bandeja que se monitoreará para este proyecto</p>
                </div>

                {/* ── Credenciales según proveedor ── */}
                {form.provider === 'm365_modern' ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-surface-100" />
                      <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Credenciales Azure AD</span>
                      <div className="flex-1 h-px bg-surface-100" />
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-surface-700">Tenant ID <span className="text-red-500">*</span></label>
                        <input value={form.tenant_id} onChange={e => set('tenant_id', e.target.value)}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          className="w-full px-3 py-2 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none font-mono transition-shadow" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-surface-700">Client ID (App registration) <span className="text-red-500">*</span></label>
                        <input value={form.client_id} onChange={e => set('client_id', e.target.value)}
                          placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                          className="w-full px-3 py-2 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none font-mono transition-shadow" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-surface-700">
                          Client Secret {config?.has_client_secret && <span className="text-emerald-600 text-[10px] font-normal">✓ guardado</span>}
                        </label>
                        <div className="relative">
                          <input type={showSecret ? 'text' : 'password'} value={form.client_secret} onChange={e => set('client_secret', e.target.value)}
                            placeholder={config?.has_client_secret ? '••••••••••• (dejar vacío para mantener)' : 'Client secret de la app...'}
                            className="w-full px-3 py-2 pr-10 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-shadow" />
                          <button type="button" onClick={() => setShowSecret(!showSecret)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600">
                            {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>
                    {/* Permisos requeridos */}
                    <div className="p-4 bg-surface-50 border border-surface-200 rounded-xl">
                      <p className="text-xs font-semibold text-surface-600 mb-1">Permisos requeridos en Azure AD:</p>
                      <p className="text-xs text-surface-500 mb-2">Azure Portal → App registrations → tu app → API permissions</p>
                      <div className="bg-surface-800 text-emerald-300 rounded-lg p-3 font-mono text-xs">
                        Microsoft Graph → Application permissions:<br />
                        <span className="text-white font-bold">Mail.Read</span><br />
                        <span className="text-surface-400">Mail.ReadBasic (mínimo)</span>
                      </div>
                    </div>
                  </div>
                ) : (
                  /* IMAP / Gmail / M365 básico */
                  <div className="space-y-4">
                    <div className="flex items-center gap-2">
                      <div className="flex-1 h-px bg-surface-100" />
                      <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Credenciales</span>
                      <div className="flex-1 h-px bg-surface-100" />
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-surface-700">Usuario / Correo <span className="text-red-500">*</span></label>
                        <input value={form.username} onChange={e => set('username', e.target.value)}
                          placeholder={form.email || 'usuario@empresa.com'}
                          className="w-full px-3 py-2 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-shadow" />
                      </div>
                      <div className="space-y-1.5">
                        <label className="block text-xs font-semibold text-surface-700">
                          Contraseña {config?.has_password && <span className="text-emerald-600 text-[10px] font-normal">✓ guardada</span>}
                        </label>
                        <div className="relative">
                          <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)}
                            placeholder={config?.has_password ? '••••••••• (dejar vacío para mantener)' : form.provider === 'gmail' ? 'Contraseña de aplicación (16 caracteres)' : 'Contraseña del buzón'}
                            className="w-full px-3 py-2 pr-10 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none transition-shadow" />
                          <button type="button" onClick={() => setShowPass(!showPass)}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600">
                            {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                          </button>
                        </div>
                      </div>
                    </div>

                    {/* Avanzado: host/port/folder para IMAP libre */}
                    {form.provider === 'imap' && (
                      <div>
                        <button type="button" onClick={() => setShowAdvanced(!showAdvanced)}
                          className="flex items-center gap-1.5 text-xs text-surface-500 hover:text-surface-700 font-medium transition-colors">
                          <Settings className="w-3.5 h-3.5" />
                          Configuración avanzada del servidor
                          {showAdvanced ? <ChevronUp className="w-3.5 h-3.5" /> : <ChevronDown className="w-3.5 h-3.5" />}
                        </button>
                        {showAdvanced && (
                          <div className="mt-3 grid grid-cols-3 gap-3 p-4 bg-surface-50 border border-surface-100 rounded-xl">
                            <div className="space-y-1.5 col-span-2">
                              <label className="block text-xs font-semibold text-surface-700">Servidor IMAP</label>
                              <input value={form.imap_host} onChange={e => set('imap_host', e.target.value)}
                                placeholder="imap.ejemplo.com"
                                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="block text-xs font-semibold text-surface-700">Puerto</label>
                              <input type="number" value={form.imap_port} onChange={e => set('imap_port', Number(e.target.value))}
                                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none" />
                            </div>
                            <div className="space-y-1.5">
                              <label className="block text-xs font-semibold text-surface-700">Carpeta</label>
                              <input value={form.imap_folder} onChange={e => set('imap_folder', e.target.value)}
                                placeholder="INBOX"
                                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-xl focus:ring-2 focus:ring-teal-500 outline-none" />
                            </div>
                            <div className="col-span-2 flex items-center gap-2 pt-3">
                              <input type="checkbox" id="ssl" checked={!!form.imap_use_ssl} onChange={e => set('imap_use_ssl', e.target.checked)}
                                className="rounded border-surface-300 text-teal-600" />
                              <label htmlFor="ssl" className="text-xs font-medium text-surface-600 cursor-pointer">Usar SSL/TLS (recomendado)</label>
                            </div>
                          </div>
                        )}
                      </div>
                    )}

                    {/* Advertencia host para m365_basic */}
                    {form.provider === 'm365_basic' && (
                      <p className="text-xs text-blue-700 bg-blue-50 border border-blue-100 rounded-xl px-3 py-2.5">
                        M365 usa <strong>outlook.office365.com:993 (STARTTLS)</strong>. Asegúrese de que SMTP AUTH esté habilitado en el buzón.
                      </p>
                    )}
                  </div>
                )}

                {/* Frecuencia de revisión */}
                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-surface-700 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5 text-surface-400" />
                    Frecuencia de revisión
                  </label>
                  <div className="flex gap-2 flex-wrap">
                    {INTERVALS.map(iv => (
                      <button key={iv.value} type="button" onClick={() => set('poll_interval_min', iv.value)}
                        className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors
                          ${form.poll_interval_min === iv.value
                            ? 'bg-teal-600 text-white border-teal-600 shadow-sm'
                            : 'bg-white text-surface-600 border-surface-200 hover:border-teal-300'}`}>
                        {iv.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Resultado test */}
                {testResult && (
                  <div className={`flex items-start gap-2 p-3 rounded-xl text-sm border
                    ${testResult.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
                    {testResult.ok
                      ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
                      : <AlertCircle  className="w-4 h-4 mt-0.5 flex-shrink-0" />}
                    <span className="whitespace-pre-line leading-relaxed">{testResult.message}</span>
                  </div>
                )}

                {saveError && (
                  <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
                    <AlertCircle className="w-4 h-4 flex-shrink-0" />{saveError}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ── Modal footer ── */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-surface-100 bg-surface-50/60 flex-shrink-0 gap-3 flex-wrap">
          {/* Estado e info */}
          <div className="flex items-center gap-3 min-w-0">
            {hasConfig ? (
              <>
                <div className="flex items-center gap-2">
                  <span className={`w-2 h-2 rounded-full flex-shrink-0 ${config.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'}`} />
                  <span className={`text-sm font-medium ${config.enabled ? 'text-emerald-700' : 'text-surface-500'}`}>
                    {config.enabled ? 'Activa' : 'Pausada'}
                  </span>
                </div>
                {config.last_polled_at && (
                  <span className="text-xs text-surface-400 hidden sm:block">
                    · Última sync: {new Date(config.last_polled_at).toLocaleString('es-CO', { timeZone: 'America/Bogota', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                  </span>
                )}
                {config.emails_imported > 0 && (
                  <span className="text-xs text-surface-400 hidden sm:block">
                    · {config.emails_imported} importado(s)
                  </span>
                )}
              </>
            ) : (
              <span className="text-xs text-surface-400">Sin configurar</span>
            )}
          </div>

          {/* Acciones */}
          <div className="flex items-center gap-2 flex-shrink-0">
            {/* Eliminar */}
            {hasConfig && (
              <button onClick={handleDelete}
                className="p-2 text-surface-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar configuración">
                <Trash2 className="w-4 h-4" />
              </button>
            )}

            {/* Toggle activo / pausado */}
            {hasConfig && (
              <button onClick={handleToggle} disabled={toggling}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors disabled:opacity-50
                  ${config.enabled
                    ? 'bg-red-50 border-red-200 text-red-600 hover:bg-red-100'
                    : 'bg-emerald-50 border-emerald-200 text-emerald-700 hover:bg-emerald-100'}`}>
                {toggling
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : config.enabled ? <PowerOff className="w-3.5 h-3.5" /> : <Power className="w-3.5 h-3.5" />}
                {config.enabled ? 'Pausar' : 'Activar'}
              </button>
            )}

            {/* Sincronizar ahora */}
            {hasConfig && (
              <button onClick={handleSync} disabled={syncing}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-surface-200 text-surface-600 text-xs font-medium rounded-lg hover:bg-surface-50 disabled:opacity-50 transition-colors">
                {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Sincronizar
              </button>
            )}

            {/* Probar conexión */}
            <button onClick={handleTest} disabled={testing || !form.email}
              className="flex items-center gap-1.5 px-4 py-2 bg-white border border-surface-200 text-surface-700 text-sm font-medium rounded-lg hover:bg-surface-50 disabled:opacity-50 transition-colors">
              {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-amber-500" />}
              Probar
            </button>

            {/* Guardar */}
            <button onClick={handleSave} disabled={saving || !form.email}
              className="flex items-center gap-1.5 px-5 py-2 bg-teal-600 text-white text-sm font-medium rounded-lg hover:bg-teal-700 disabled:opacity-50 transition-colors shadow-sm">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              {hasConfig ? 'Actualizar' : 'Guardar y activar'}
            </button>
          </div>
        </div>

        {/* Nota seguridad */}
        <p className="text-[10px] text-surface-400 text-center pb-2">
          Las contraseñas se guardan encriptadas con AES-256. Solo el servidor puede leerlas.
        </p>
      </div>
    </div>
  );
}
