import React, { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import { Cpu } from 'lucide-react';

export default function OAuthCallbackPage() {
  const [searchParams] = useSearchParams();
  const { loginWithToken } = useAuth();
  const navigate = useNavigate();
  const [error, setError] = useState('');

  useEffect(() => {
    const errorMsg = searchParams.get('error');
    if (errorMsg) {
      setError(decodeURIComponent(errorMsg));
      return;
    }

    const payloadRaw = searchParams.get('payload');
    if (!payloadRaw) {
      setError('No se recibió respuesta del proveedor de identidad');
      return;
    }

    try {
      const { token, user } = JSON.parse(decodeURIComponent(payloadRaw));
      if (!token || !user) throw new Error('Respuesta incompleta');
      loginWithToken(token, user);
      navigate('/', { replace: true });
    } catch {
      setError('Error procesando la respuesta de autenticación');
    }
  }, [searchParams, loginWithToken, navigate]);

  if (error) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-surface-50 p-6">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-xl bg-red-100 flex items-center justify-center mx-auto mb-4">
            <span className="text-red-600 text-xl font-bold">!</span>
          </div>
          <h2 className="text-lg font-semibold text-brand-900 mb-2">Error de autenticación</h2>
          <p className="text-sm text-surface-400 mb-6">{error}</p>
          <button
            onClick={() => navigate('/login', { replace: true })}
            className="px-6 py-2.5 bg-brand-600 hover:bg-brand-700 text-white text-sm font-semibold rounded-xl transition-colors"
          >
            Volver al inicio de sesión
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-surface-50">
      <div className="text-center">
        <div className="w-12 h-12 rounded-xl bg-brand-600 flex items-center justify-center mx-auto mb-4">
          <Cpu className="w-6 h-6 text-white" />
        </div>
        <div className="flex items-center gap-2 text-surface-400 text-sm">
          <div className="w-4 h-4 border-2 border-brand-600/30 border-t-brand-600 rounded-full animate-spin" />
          Verificando identidad...
        </div>
      </div>
    </div>
  );
}
