import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Eye, EyeOff, Lock, Mail, Cpu } from 'lucide-react';

export default function LoginPage() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPass, setShowPass] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

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
      {/* Left panel - Branding */}
      <div className="hidden lg:flex lg:w-[55%] relative bg-brand-900 overflow-hidden">
        {/* Background pattern */}
        <div className="absolute inset-0 opacity-[0.07]"
          style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, white 1px, transparent 0)`,
            backgroundSize: '32px 32px',
          }}
        />
        {/* Gradient orbs */}
        <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-brand-500 opacity-20 blur-[120px]" />
        <div className="absolute bottom-[-10%] left-[-5%] w-[400px] h-[400px] rounded-full bg-accent-400 opacity-10 blur-[100px]" />
        
        <div className="relative z-10 flex flex-col justify-between p-12 xl:p-16 w-full">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur flex items-center justify-center">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <span className="text-white font-display font-bold text-xl tracking-tight">SGIP-IA</span>
          </div>

          {/* Main copy */}
          <div className="space-y-6 max-w-lg">
            <h1 className="text-4xl xl:text-5xl font-display font-extrabold text-white leading-tight">
              Gestión de Proyectos<br />
              <span className="text-brand-300">potenciada con IA</span>
            </h1>
            <p className="text-brand-200 text-lg leading-relaxed">
              Automatiza el seguimiento de tus proyectos desde la adjudicación hasta el cierre. 
              Extracción inteligente de obligaciones, alertas proactivas y KPIs en tiempo real.
            </p>
            {/* Feature pills */}
            <div className="flex flex-wrap gap-2 pt-2">
              {['Multiproyecto', 'Público & Privado', 'IA Integrada', 'SharePoint'].map((tag) => (
                <span key={tag} className="px-3 py-1.5 rounded-full bg-white/10 text-white/80 text-sm font-medium backdrop-blur-sm">
                  {tag}
                </span>
              ))}
            </div>
          </div>

          {/* Footer */}
          <p className="text-brand-400 text-sm">
            SGIP-IA v1.0 · Sistema de Gestión Integral de Proyectos
          </p>
        </div>
      </div>

      {/* Right panel - Login form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-12 bg-white">
        <div className="w-full max-w-md animate-fade-in">
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10">
            <div className="w-10 h-10 rounded-xl bg-brand-600 flex items-center justify-center">
              <Cpu className="w-5 h-5 text-white" />
            </div>
            <span className="font-display font-bold text-xl text-brand-900">SGIP-IA</span>
          </div>

          <div className="mb-8">
            <h2 className="text-2xl font-display font-bold text-brand-900">
              Iniciar sesión
            </h2>
            <p className="mt-2 text-surface-400">
              Ingresa tus credenciales para acceder al sistema
            </p>
          </div>

          {error && (
            <div className="mb-6 p-4 rounded-lg bg-red-50 border border-red-100 animate-slide-up">
              <p className="text-red-700 text-sm font-medium">{error}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-5">
            {/* Email */}
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">
                Correo electrónico
              </label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="correo@empresa.com"
                  className="input-field pl-11"
                  required
                  autoFocus
                />
              </div>
            </div>

            {/* Password */}
            <div>
              <label className="block text-sm font-medium text-brand-800 mb-1.5">
                Contraseña
              </label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4.5 h-4.5 text-surface-400" />
                <input
                  type={showPass ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="input-field pl-11 pr-11"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPass(!showPass)}
                  className="absolute right-3.5 top-1/2 -translate-y-1/2 text-surface-400 hover:text-brand-600 transition-colors"
                >
                  {showPass ? <EyeOff className="w-4.5 h-4.5" /> : <Eye className="w-4.5 h-4.5" />}
                </button>
              </div>
            </div>

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="btn-primary w-full py-3 text-base flex items-center justify-center gap-2 mt-2"
            >
              {loading ? (
                <>
                  <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                  Verificando...
                </>
              ) : (
                'Ingresar'
              )}
            </button>
          </form>

          {/* Dev hint */}
          <div className="mt-8 p-4 rounded-lg bg-surface-50 border border-surface-200">
            <p className="text-xs font-mono text-surface-400 mb-1">Credenciales de desarrollo:</p>
            <p className="text-xs font-mono text-brand-700">admin@sgip-ia.com / admin123</p>
          </div>
        </div>
      </div>
    </div>
  );
}
