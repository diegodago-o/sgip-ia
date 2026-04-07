import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail, Server, Shield, Zap, Eye, EyeOff, CheckCircle2,
  AlertCircle, Loader2, RefreshCw, Trash2, Power, PowerOff,
  ChevronDown, ChevronUp, Settings, Inbox, Clock, Download,
} from 'lucide-react';
import { emailInboxAPI } from '../../services/api';

// ─── Configuraciones por proveedor ────────────────────────────────────────────
const PROVIDERS = [
  {
    id:          'imap',
    label:       'SMTP / IMAP Personalizado',
    desc:        'Cualquier servidor IMAP (Zoho, AWS SES, etc.)',
    icon:        Server,
    color:       'border-surface-300 bg-white',
    activeColor: 'border-brand-500 bg-brand-50',
    defaults:    { imap_port: 993, imap_use_ssl: true },
    fields:      ['imap_host', 'imap_port', 'imap_use_ssl', 'imap_folder', 'username', 'password'],
  },
  {
    id:          'gmail',
    label:       'Gmail',
    desc:        'Cuenta Gmail con contraseña de aplicación',
    icon:        Mail,
    color:       'border-surface-300 bg-white',
    activeColor: 'border-red-400 bg-red-50',
    defaults:    { imap_host: 'imap.gmail.com', imap_port: 993, imap_use_ssl: true },
    fields:      ['username', 'password'],
    hint:        'Usa una contraseña de aplicación de Google (no tu contraseña normal). Actívala en myaccount.google.com → Seguridad → Contraseñas de aplicaciones.',
  },
  {
    id:          'm365_basic',
    label:       'Microsoft 365 (básico)',
    desc:        'Cuenta M365 con usuario y contraseña (SMTP AUTH)',
    icon:        Mail,
    color:       'border-surface-300 bg-white',
    activeColor: 'border-blue-400 bg-blue-50',
    defaults:    { imap_host: 'outlook.office365.com', imap_port: 993, imap_use_ssl: true },
    fields:      ['username', 'password'],
    hint:        'M365 usa outlook.office365.com:993 (SSL). Asegúrate de que SMTP AUTH esté habilitado en el centro de administración M365 para este buzón.',
  },
  {
    id:          'm365_modern',
    label:       'Microsoft 365 (Auth moderna)',
    desc:        'App registration Azure AD — recomendado para M365',
    icon:        Shield,
    color:       'border-surface-300 bg-white',
    activeColor: 'border-violet-400 bg-violet-50',
    badge:       'Recomendado',
    fields:      ['tenant_id', 'client_id', 'client_secret'],
    hint:        'Requiere permisos Mail.Read en la App registration de Azure AD. Si ya tienes la conexión de SharePoint configurada, puedes reutilizar el mismo App registration agregando el permiso.',
  },
];

const INTERVALS = [
  { value: 5,  label: 'Cada 5 minutos' },
  { value: 15, label: 'Cada 15 minutos' },
  { value: 30, label: 'Cada 30 minutos' },
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

  const [form, setForm]         = useState({
    provider:         'm365_basic',
    email:            '',
    imap_host:        '',
    imap_port:        993,
    imap_use_ssl:     true,
    imap_folder:      'INBOX',
    username:         '',
    password:         '',
    tenant_id:        '',
    client_id:        '',
    client_secret:    '',
    poll_interval_min: 15,
  });

  const [showPass, setShowPass]           = useState(false);
  const [showSecret, setShowSecret]       = useState(false);
  const [testResult, setTestResult]       = useState(null);  // { ok, message }
  const [saveError, setSaveError]         = useState('');
  const [syncResult, setSyncResult]       = useState(null);
  const [showAdvanced, setShowAdvanced]   = useState(false);

  // ── Carga config existente ─────────────────────────────────────────
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
          // Contraseñas NO se rellenan (solo se envían si se cambian)
        }));
      }
    } catch { setConfig(null); }
    finally { setLoading(false); }
  }, [projectId]);

  useEffect(() => { load(); }, [load]);

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  // Al cambiar proveedor, aplicar defaults
  const handleProviderChange = (pid) => {
    const prov = PROVIDERS.find(p => p.id === pid);
    if (!prov) return;
    setForm(f => ({
      ...f,
      provider: pid,
      imap_host: prov.defaults?.imap_host || f.imap_host,
      imap_port: prov.defaults?.imap_port || f.imap_port,
      imap_use_ssl: prov.defaults?.imap_use_ssl !== undefined ? prov.defaults.imap_use_ssl : f.imap_use_ssl,
    }));
    setTestResult(null);
  };

  // ── Guardar ────────────────────────────────────────────────────────
  const handleSave = async () => {
    setSaveError(''); setSaving(true); setTestResult(null);
    try {
      if (!form.email) { setSaveError('El email del buzón es requerido'); return; }
      const payload = { ...form };
      // Si contraseña vacía → no enviar (mantener la encriptada)
      if (!payload.password)      delete payload.password;
      if (!payload.client_secret) delete payload.client_secret;
      await emailInboxAPI.save(projectId, payload);
      await load();
      setSaveError('');
    } catch (e) {
      setSaveError(e.response?.data?.error || 'Error al guardar');
    } finally { setSaving(false); }
  };

  // ── Probar conexión ────────────────────────────────────────────────
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

  // ── Sincronizar ahora ──────────────────────────────────────────────
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

  // ── Toggle habilitar / deshabilitar ───────────────────────────────
  const handleToggle = async () => {
    setToggling(true);
    try {
      await emailInboxAPI.toggle(projectId);
      await load();
    } catch { /* ignore */ }
    finally { setToggling(false); }
  };

  // ── Eliminar config ────────────────────────────────────────────────
  const handleDelete = async () => {
    if (!window.confirm('¿Eliminar la configuración de bandeja? Los correos ya importados se conservan.')) return;
    try {
      await emailInboxAPI.remove(projectId);
      setConfig(null);
      setForm(f => ({ ...f, email: '', username: '', password: '', tenant_id: '', client_id: '', client_secret: '' }));
    } catch { /* ignore */ }
  };

  const currentProv = PROVIDERS.find(p => p.id === form.provider) || PROVIDERS[0];
  const isImap      = ['imap', 'gmail', 'm365_basic'].includes(form.provider);
  const hasConfig   = !!config;

  if (loading) return (
    <div className="flex items-center justify-center py-12">
      <Loader2 className="w-5 h-5 animate-spin text-brand-400" />
    </div>
  );

  return (
    <div className="space-y-5">

      {/* ── Header con estado ── */}
      {hasConfig && (
        <div className="flex items-center justify-between p-4 bg-surface-50 border border-surface-200 rounded-xl">
          <div className="flex items-center gap-3">
            <div className={`w-2.5 h-2.5 rounded-full ${config.enabled ? 'bg-emerald-500 animate-pulse' : 'bg-surface-300'}`} />
            <div>
              <p className="text-sm font-semibold text-surface-800">
                {config.enabled ? 'Bandeja activa' : 'Bandeja pausada'}
              </p>
              <p className="text-xs text-surface-400">
                {config.last_polled_at
                  ? `Última revisión: ${new Date(config.last_polled_at).toLocaleString('es-CO', { timeZone: 'America/Bogota', day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' })}`
                  : 'Aún no se ha sincronizado'}
                {' · '}
                <span className="font-medium">{config.emails_imported || 0} correo(s) importado(s)</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Sync manual */}
            <button onClick={handleSync} disabled={syncing || !hasConfig}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-surface-200 text-surface-600 text-xs font-medium rounded-lg hover:bg-surface-50 disabled:opacity-50 transition-colors">
              {syncing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
              Sincronizar ahora
            </button>
            {/* Toggle */}
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
          </div>
        </div>
      )}

      {/* Resultado sync */}
      {syncResult && (
        <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border ${syncResult.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
          {syncResult.ok ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" /> : <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          {syncResult.message}
        </div>
      )}

      {/* Error en bandeja */}
      {config?.last_error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-xs text-red-700">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <div><span className="font-semibold">Último error:</span> {config.last_error}</div>
        </div>
      )}

      {/* ── Selector de proveedor ── */}
      <div>
        <label className="block text-xs font-semibold text-surface-600 uppercase tracking-wide mb-2">
          Proveedor de correo
        </label>
        <div className="grid grid-cols-2 gap-3">
          {PROVIDERS.map(p => {
            const Icon    = p.icon;
            const active  = form.provider === p.id;
            return (
              <button key={p.id} onClick={() => handleProviderChange(p.id)} type="button"
                className={`relative flex items-start gap-3 p-3 rounded-xl border-2 text-left transition-all
                  ${active ? p.activeColor + ' shadow-sm' : p.color + ' hover:border-surface-400'}`}>
                <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${active ? 'bg-white shadow-sm' : 'bg-surface-100'}`}>
                  <Icon className={`w-4 h-4 ${active ? 'text-brand-600' : 'text-surface-500'}`} />
                </div>
                <div className="min-w-0">
                  <p className={`text-sm font-semibold leading-tight ${active ? 'text-brand-900' : 'text-surface-700'}`}>{p.label}</p>
                  <p className="text-xs text-surface-400 mt-0.5 leading-snug">{p.desc}</p>
                </div>
                {p.badge && (
                  <span className="absolute top-2 right-2 text-[10px] font-bold px-1.5 py-0.5 bg-violet-600 text-white rounded-full">{p.badge}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Hint del proveedor */}
      {currentProv.hint && (
        <div className="flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-lg text-xs text-blue-700">
          <Zap className="w-4 h-4 mt-0.5 flex-shrink-0 text-blue-500" />
          {currentProv.hint}
        </div>
      )}

      {/* ── Email del buzón ── */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-surface-600">
          Email del buzón del proyecto <span className="text-red-500">*</span>
        </label>
        <input type="email" value={form.email} onChange={e => set('email', e.target.value)}
          placeholder="correspondencia-proyecto@empresa.com"
          className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" />
        <p className="text-[10px] text-surface-400">Dirección de la bandeja que se monitoreará para este proyecto</p>
      </div>

      {/* ── Credenciales según proveedor ── */}
      {form.provider === 'm365_modern' ? (
        /* M365 Auth moderna */
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <div className="flex-1 h-px bg-surface-100" />
            <span className="text-xs font-semibold text-surface-400 uppercase tracking-wide">Credenciales Azure AD</span>
            <div className="flex-1 h-px bg-surface-100" />
          </div>
          <div className="space-y-3">
            <div className="space-y-1">
              <label className="block text-xs font-medium text-surface-600">Tenant ID <span className="text-red-500">*</span></label>
              <input value={form.tenant_id} onChange={e => set('tenant_id', e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none font-mono" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-surface-600">Client ID (App registration) <span className="text-red-500">*</span></label>
              <input value={form.client_id} onChange={e => set('client_id', e.target.value)}
                placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none font-mono" />
            </div>
            <div className="space-y-1">
              <label className="block text-xs font-medium text-surface-600">
                Client Secret {config?.has_client_secret && <span className="text-emerald-600 text-[10px]">✓ guardado</span>}
              </label>
              <div className="relative">
                <input type={showSecret ? 'text' : 'password'} value={form.client_secret} onChange={e => set('client_secret', e.target.value)}
                  placeholder={config?.has_client_secret ? '••••••••••• (dejar vacío para mantener)' : 'Client secret de la app...'}
                  className="w-full px-3 py-2 pr-10 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" />
                <button type="button" onClick={() => setShowSecret(!showSecret)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-surface-400 hover:text-surface-600">
                  {showSecret ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </div>
          {/* Permisos requeridos */}
          <div className="p-3 bg-surface-50 border border-surface-200 rounded-xl">
            <p className="text-xs font-semibold text-surface-600 mb-1">Permisos requeridos en Azure AD:</p>
            <p className="text-xs text-surface-500">Azure Portal → App registrations → tu app → API permissions</p>
            <div className="mt-2 bg-surface-800 text-emerald-300 rounded-lg p-2 font-mono text-xs">
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
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1 col-span-2">
              <label className="block text-xs font-medium text-surface-600">Usuario / Correo <span className="text-red-500">*</span></label>
              <input value={form.username} onChange={e => set('username', e.target.value)}
                placeholder={form.email || 'usuario@empresa.com'}
                className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" />
            </div>
            <div className="space-y-1 col-span-2">
              <label className="block text-xs font-medium text-surface-600">
                Contraseña {config?.has_password && <span className="text-emerald-600 text-[10px]">✓ guardada</span>}
              </label>
              <div className="relative">
                <input type={showPass ? 'text' : 'password'} value={form.password} onChange={e => set('password', e.target.value)}
                  placeholder={config?.has_password ? '••••••••• (dejar vacío para mantener)' : form.provider === 'gmail' ? 'Contraseña de aplicación (16 caracteres)' : 'Contraseña del buzón'}
                  className="w-full px-3 py-2 pr-10 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" />
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
                <div className="mt-3 grid grid-cols-3 gap-3 p-3 bg-surface-50 border border-surface-100 rounded-xl">
                  <div className="space-y-1 col-span-2">
                    <label className="block text-xs font-medium text-surface-600">Servidor IMAP</label>
                    <input value={form.imap_host} onChange={e => set('imap_host', e.target.value)}
                      placeholder="imap.ejemplo.com"
                      className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-surface-600">Puerto</label>
                    <input type="number" value={form.imap_port} onChange={e => set('imap_port', Number(e.target.value))}
                      className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" />
                  </div>
                  <div className="space-y-1">
                    <label className="block text-xs font-medium text-surface-600">Carpeta</label>
                    <input value={form.imap_folder} onChange={e => set('imap_folder', e.target.value)}
                      placeholder="INBOX"
                      className="w-full px-3 py-2 text-sm border border-surface-200 rounded-lg focus:ring-2 focus:ring-brand-500 outline-none" />
                  </div>
                  <div className="space-y-1 flex items-center gap-2 col-span-2 pt-4">
                    <input type="checkbox" id="ssl" checked={!!form.imap_use_ssl} onChange={e => set('imap_use_ssl', e.target.checked)}
                      className="rounded border-surface-300 text-brand-600" />
                    <label htmlFor="ssl" className="text-xs font-medium text-surface-600 cursor-pointer">Usar SSL/TLS (recomendado)</label>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Advertencia host para m365_basic */}
          {form.provider === 'm365_basic' && (
            <p className="text-xs text-blue-600 bg-blue-50 border border-blue-100 rounded-lg px-3 py-2">
              ℹ M365 usa <strong>outlook.office365.com:993 (STARTTLS)</strong>. Asegúrese de que SMTP AUTH esté habilitado en el buzón.
            </p>
          )}
        </div>
      )}

      {/* ── Frecuencia de revisión ── */}
      <div className="space-y-1">
        <label className="block text-xs font-medium text-surface-600">
          <Clock className="w-3.5 h-3.5 inline mr-1 text-surface-400" />
          Revisar bandeja
        </label>
        <div className="flex gap-2 flex-wrap">
          {INTERVALS.map(iv => (
            <button key={iv.value} type="button" onClick={() => set('poll_interval_min', iv.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors
                ${form.poll_interval_min === iv.value
                  ? 'bg-brand-600 text-white border-brand-600'
                  : 'bg-white text-surface-600 border-surface-200 hover:border-brand-300'}`}>
              {iv.label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Resultado test ── */}
      {testResult && (
        <div className={`flex items-start gap-2 p-3 rounded-lg text-sm border
          ${testResult.ok ? 'bg-emerald-50 border-emerald-100 text-emerald-700' : 'bg-red-50 border-red-100 text-red-700'}`}>
          {testResult.ok
            ? <CheckCircle2 className="w-4 h-4 mt-0.5 flex-shrink-0" />
            : <AlertCircle  className="w-4 h-4 mt-0.5 flex-shrink-0" />}
          {testResult.message}
        </div>
      )}

      {saveError && (
        <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-700">
          <AlertCircle className="w-4 h-4 flex-shrink-0" />{saveError}
        </div>
      )}

      {/* ── Acciones ── */}
      <div className="flex items-center gap-2 pt-1">
        {/* Probar conexión */}
        <button onClick={handleTest} disabled={testing || !form.email}
          className="flex items-center gap-1.5 px-4 py-2 bg-white border border-surface-200 text-surface-700 text-sm font-medium rounded-lg hover:bg-surface-50 disabled:opacity-50 transition-colors">
          {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4 text-amber-500" />}
          Probar conexión
        </button>

        {/* Guardar */}
        <button onClick={handleSave} disabled={saving || !form.email}
          className="flex items-center gap-1.5 px-5 py-2 bg-brand-600 text-white text-sm font-medium rounded-lg hover:bg-brand-700 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
          {hasConfig ? 'Actualizar configuración' : 'Guardar y activar'}
        </button>

        {/* Eliminar */}
        {hasConfig && (
          <button onClick={handleDelete}
            className="ml-auto p-2 text-surface-400 hover:text-red-500 hover:bg-red-50 rounded-lg transition-colors" title="Eliminar configuración">
            <Trash2 className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Nota de seguridad */}
      <p className="text-[10px] text-surface-400 text-center">
        🔒 Las contraseñas se guardan encriptadas con AES-256. Solo el servidor puede leerlas.
      </p>
    </div>
  );
}
