import React from 'react';
import { useLocation } from 'react-router-dom';
import { Bell, Search, HelpCircle } from 'lucide-react';

const PAGE_TITLES = {
  '/':               'Dashboard',
  '/adjudicacion':   'Adjudicación y Arranque',
  '/planificacion':  'Planificación',
  '/ejecucion':      'Ejecución y Seguimiento',
  '/control':        'Control y Cambios',
  '/cierre':         'Cierre y Liquidación',
  '/indicadores':    'Indicadores y KPIs',
  '/ia':             'Motor de IA',
  '/configuracion':  'Configuración',
  '/admin/usuarios': 'Usuarios y Roles',
};

export default function TopBar() {
  const location = useLocation();
  const title = PAGE_TITLES[location.pathname] || 'SGIP-IA';

  return (
    <header className="h-16 bg-white border-b border-surface-200 flex items-center justify-between px-6 flex-shrink-0">
      {/* Left: Title */}
      <div>
        <h1 className="text-lg font-display font-bold text-brand-900">{title}</h1>
      </div>

      {/* Right: Actions */}
      <div className="flex items-center gap-1">
        {/* Search */}
        <button className="w-9 h-9 rounded-lg hover:bg-surface-100 flex items-center justify-center transition-colors">
          <Search className="w-4 h-4 text-surface-400" />
        </button>

        {/* Notifications */}
        <button className="w-9 h-9 rounded-lg hover:bg-surface-100 flex items-center justify-center transition-colors relative">
          <Bell className="w-4 h-4 text-surface-400" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full" />
        </button>

        {/* Help */}
        <button className="w-9 h-9 rounded-lg hover:bg-surface-100 flex items-center justify-center transition-colors">
          <HelpCircle className="w-4 h-4 text-surface-400" />
        </button>
      </div>
    </header>
  );
}
