import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Eye, EyeOff, Lock, Mail, Cpu, ShieldCheck, ArrowRight, AlertCircle } from 'lucide-react';
import axios from 'axios';

const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

function GoogleLogo() {
  return (
    <svg viewBox="0 0 24 24" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}

function MicrosoftLogo({ white = false }) {
  return (
    <svg viewBox="0 0 23 23" width="18" height="18" xmlns="http://www.w3.org/2000/svg">
      <rect x="1" y="1" width="10" height="10" fill={white ? '#fff' : '#F25022'}/>
      <rect x="12" y="1" width="10" height="10" fill={white ? '#ffffffbb' : '#7FBA00'}/>
      <rect x="1" y="12" width="10" height="10" fill={white ? '#ffffffbb' : '#00A4EF'}/>
      <rect x="12" y="12" width="10" height="10" fill={white ? '#ffffff88' : '#FFB900'}/>
    </svg>
  );
}

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [ssoProviders, setSsoProviders] = useState({ google: false, microsoft: false });
  const { login }  = useAuth();
  const navigate   = useNavigate();

  useEffect(() => {
    axios.get(`${API_BASE}/auth/sso-providers`)
      .then(r => setSsoProviders(r.data))
      .catch(() => {});
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Credenciales incorrectas. Verifica tu correo y contraseña.');
    } finally {
      setLoading(false);
    }
  };

  const hasSso = ssoProviders.google || ssoProviders.microsoft;
  const bothSso = ssoProviders.google && ssoProviders.microsoft;

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — Branding ─────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[55%] relative bg-brand-900 overflow-hidden">
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`, backgroundSize: '32px 32px' }} />
        <div className="absolute top-[-8%] right-[-4%] w-[520px] h-[520px] rounded-full bg-brand-400 opacity-20 blur-[130px] pointer-events-none" />
        <div className="absolute bottom-[-12%] left-[-6%] w-[420px] h-[420px] rounded-full bg-accent-400 opacity-10 blur-[110px] pointer-events-none" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-display font-bold text-xl tracking-tight">SGIP-IA</span>
          </div>

          <div className="space-y-6 max-w-lg">
            <h1 className="text-4xl xl:text-5xl font-display font-extrabold text-white leading-tight">
              Gestión de Proyectos<br />
              <span className="text-brand-300">potenciada con IA</span>
            </h1>
            <p className="text-brand-200 text-base xl:text-lg leading-relaxed">
              Automatiza el seguimiento de tus proyectos desde la adjudicación hasta el cierre.
              Extracción inteligente de obligaciones, alertas proactivas y KPIs en tiempo real.
            </p>
            <div className="flex flex-wrap gap-2 pt-1">
              {['Multiproyecto', 'Público & Privado', 'IA Integrada', 'SharePoint'].map((tag) => (
                <span key={tag}
                  className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-white/80 text-sm font-medium backdrop-blur-sm">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-1.5 text-brand-400 text-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
            Acceso protegido
          </div>
        </div>
      </div>

      {/* ── Right panel — Login form ──────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-white">
        <div className="w-full max-w-[400px] animate-fade-in">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <span className="font-display font-bold text-xl text-brand-900">SGIP-IA</span>
          </div>

          {/* Heading */}
          <div className="mb-7">
            <h2 className="text-2xl font-display font-bold text-brand-900">Iniciar sesión</h2>
            <p className="mt-1.5 text-surface-400 text-sm">Accede con tu cuenta corporativa o tus credenciales</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-200 flex items-start gap-3 animate-slide-up">
              <AlertCircle className="w-4 h-4 text-red-500 flex-shrink-0 mt-0.5" />
              <p className="text-red-700 text-sm font-medium">{error}</p>
            </div>
          )}

          {/* ── SSO Buttons ───────────────────────────────────────────── */}
          {hasSso && (
            <div className={`mb-6 ${bothSso ? 'grid grid-cols-2 gap-3' : ''}`}>
              {ssoProviders.microsoft && (
                <a
                  href={`${API_BASE}/auth/microsoft`}
                  className="flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl text-sm font-semibold text-white transition-all duration-150 shadow-sm"
                  style={{ background: '#0078D4' }}
                  onMouseEnter={e => e.currentTarget.style.background = '#006BBF'}
                  onMouseLeave={e => e.currentTarget.style.background = '#0078D4'}
                >
                  <MicrosoftLogo white />
                  <span>{bothSso ? 'Microsoft' : 'Continuar con Microsoft 365'}</span>
                </a>
              )}
              {ssoProviders.google && (
                <a
                  href={`${API_BASE}/auth/google`}
                  className="flex items-center justify-center gap-2.5 px-4 py-3 rounded-xl border border-surface-200 text-sm font-semibold text-brand-800 bg-white hover:bg-surface-50 hover:border-surface-300 transition-all duration-150 shadow-sm"
                >
                  <GoogleLogo />
                  <span>{bothSso ? 'Google' : 'Continuar con Google'}</span>
                </a>
              )}
            </div>
          )}

          {/* Divider */}
          {hasSso && (
            <div className="flex items-center gap-3 mb-6">
              <div className="flex-1 h-px bg-surface-100" />
              <span className="text-xs text-surface-400 font-medium">o ingresa con correo y contraseña</span>
              <div className="flex-1 h-px bg-surface-100" />
            </div>
          )}

          {/* ── Local Login Form ──────────────────────────────────────── */}
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => { setEmail(e.target.value); setError(''); }}
                  placeholder="correo@empresa.com"
                  className="input-field pl-10 w-full"
                  required
                  autoFocus={!hasSso}
                  autoComplete="email"
                />
              </div>
            </div>

            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => { setPassword(e.target.value); setError(''); }}
                  placeholder="••••••••"
                  className="input-field pl-10 pr-10 w-full"
                  required
                  autoComplete="current-password"
                />
                <button type="button" onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-brand-600 transition-colors">
                  {showPass ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full mt-1 flex items-center justify-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-semibold rounded-xl shadow-sm transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verificando...
                </>
              ) : (
                <>
                  Ingresar
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </form>

          {/* Security note */}
          <div className="mt-8 flex items-center justify-center gap-1.5 text-surface-300 text-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Conexión cifrada · Acceso corporativo</span>
          </div>
        </div>
      </div>

    </div>
  );
}
