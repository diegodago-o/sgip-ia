import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Eye, EyeOff, Lock, Mail, Cpu, ShieldCheck, ArrowRight } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError]       = useState('');
  const [loading, setLoading]   = useState(false);
  const { login }  = useAuth();
  const navigate   = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password);
      navigate('/');
    } catch (err) {
      setError(err.response?.data?.error || 'Error de conexión con el servidor');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex">

      {/* ── Left panel — Branding ─────────────────────────────────────────── */}
      <div className="hidden lg:flex lg:w-[55%] relative bg-brand-900 overflow-hidden">
        {/* Dot grid */}
        <div className="absolute inset-0 opacity-[0.06]"
          style={{ backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`, backgroundSize: '32px 32px' }} />
        {/* Glow orbs */}
        <div className="absolute top-[-8%] right-[-4%] w-[520px] h-[520px] rounded-full bg-brand-400 opacity-20 blur-[130px] pointer-events-none" />
        <div className="absolute bottom-[-12%] left-[-6%] w-[420px] h-[420px] rounded-full bg-accent-400 opacity-10 blur-[110px] pointer-events-none" />

        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm border border-white/10 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-display font-bold text-xl tracking-tight">SGIP-IA</span>
          </div>

          {/* Hero copy */}
          <div className="space-y-6 max-w-lg">
            <h1 className="text-4xl xl:text-5xl font-display font-extrabold text-white leading-tight">
              Gestión de Proyectos<br />
              <span className="text-brand-300">potenciada con IA</span>
            </h1>
            <p className="text-brand-200 text-base xl:text-lg leading-relaxed">
              Automatiza el seguimiento de tus proyectos desde la adjudicación hasta el cierre.
              Extracción inteligente de obligaciones, alertas proactivas y KPIs en tiempo real.
            </p>
            {/* Feature pills */}
            <div className="flex flex-wrap gap-2 pt-1">
              {['Multiproyecto', 'Público & Privado', 'IA Integrada', 'SharePoint'].map((tag) => (
                <span key={tag}
                  className="px-3 py-1.5 rounded-full bg-white/10 border border-white/10 text-white/80 text-sm font-medium backdrop-blur-sm">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className="flex items-center gap-1.5 text-brand-400 text-xs">
            <ShieldCheck className="w-3.5 h-3.5" />
            Acceso protegido
          </div>
        </div>
      </div>

      {/* ── Right panel — Login form ──────────────────────────────────────── */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-white">
        <div className="w-full max-w-[380px] animate-fade-in">

          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <span className="font-display font-bold text-xl text-brand-900">SGIP-IA</span>
          </div>

          {/* Heading */}
          <div className="mb-8">
            <h2 className="text-2xl font-display font-bold text-brand-900">Iniciar sesión</h2>
            <p className="mt-1.5 text-surface-400 text-sm">Ingresa tus credenciales para acceder al sistema</p>
          </div>

          {/* Error */}
          {error && (
            <div className="mb-5 p-3.5 rounded-xl bg-red-50 border border-red-100 flex items-start gap-2.5 animate-slide-up">
              <div className="w-4 h-4 rounded-full bg-red-200 flex items-center justify-center flex-shrink-0 mt-0.5">
                <span className="text-red-600 text-[10px] font-bold">!</span>
              </div>
              <p className="text-red-700 text-sm">{error}</p>
            </div>
          )}

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@empresa.com"
                  className="input-field pl-10 w-full"
                  required
                  autoFocus
                  autoComplete="email"
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-surface-400 pointer-events-none" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full mt-2 flex items-center justify-center gap-2 px-6 py-3 bg-brand-600 hover:bg-brand-700 active:bg-brand-800 text-white text-sm font-semibold rounded-xl shadow-sm transition-all duration-150 disabled:opacity-60 disabled:cursor-not-allowed"
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
