import React, { useState } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext';
import {
  Cpu, LayoutDashboard, FileCheck, PlayCircle,
  CheckSquare, BarChart3, BrainCircuit, Users,
  ChevronLeft, ChevronRight, ChevronDown, LogOut, Settings, User,
} from 'lucide-react';

const ROLE_LABELS = {
  admin: 'Administrador',
  gerente_proyecto: 'Gerente de Proyecto',
  director_pmo: 'Director PMO',
  ceo: 'Dirección General',
  apoyo: 'Apoyo / Seguimiento',
};

const MODULE_ACCESS = {
  admin:            ['dashboard', 'adjudicacion', 'ejecucion', 'cierre', 'indicadores', 'ia'],
  gerente_proyecto: ['adjudicacion', 'ejecucion', 'cierre', 'indicadores', 'ia'],
  director_pmo:     ['dashboard', 'adjudicacion', 'ejecucion', 'cierre', 'indicadores', 'ia'],
  ceo:              ['dashboard', 'adjudicacion', 'ejecucion', 'cierre', 'indicadores', 'ia'],
  apoyo:            ['adjudicacion', 'ejecucion', 'cierre', 'indicadores', 'ia'],
};

const ALL_MODULES = [
  { id: 'dashboard',    to: '/',             icon: LayoutDashboard, label: 'Dashboard' },
  { id: 'adjudicacion', to: '/adjudicacion', icon: FileCheck,       label: 'Adjudicación' },
  { id: 'ejecucion',    to: '/ejecucion',    icon: PlayCircle,      label: 'Ejecución' },
  { id: 'cierre',       to: '/cierre',       icon: CheckSquare,     label: 'Cierre' },
  { id: 'indicadores',  to: '/indicadores',  icon: BarChart3,       label: 'Indicadores' },
  { id: 'ia',           to: '/ia',           icon: BrainCircuit,    label: 'Motor IA' },
];

export default function Sidebar() {
  const { user, logout } = useAuth();
  const location = useLocation();
  const [collapsed, setCollapsed]   = useState(false);
  const [configOpen, setConfigOpen] = useState(
    location.pathname === '/configuracion' || location.pathname.startsWith('/admin')
  );
  const role = user?.role || 'apoyo';
  const allowedModules = MODULE_ACCESS[role] || MODULE_ACCESS.apoyo;
  const visibleModules = ALL_MODULES.filter(m => allowedModules.includes(m.id));

  // Active link: white semi-transparent bg + white left-border indicator
  const linkClasses = (isActive) =>
    `group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[1rem] font-normal transition-all duration-200 ${
      isActive
        ? 'bg-white/20 text-white'
        : 'text-white hover:bg-white/10'
    }`;

  return (
    <aside className={`flex flex-col bg-brand-500 text-white transition-all duration-300 ease-out shadow-sidebar ${collapsed ? 'w-[72px]' : 'w-[260px]'}`}>
      {/* ── Logo / Header ── */}
      <div className={`flex items-center h-16 px-4 border-b border-white/15 ${collapsed ? 'justify-center' : 'justify-between'}`}>
        <div className="flex items-center gap-2.5 overflow-hidden">
          <div className="w-8 h-8 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
            <Cpu className="w-4.5 h-4.5 text-white" />
          </div>
          {!collapsed && <span className="font-display font-bold text-base tracking-tight whitespace-nowrap animate-fade-in">SGIP-IA</span>}
        </div>
        {!collapsed && (
          <button onClick={() => setCollapsed(true)} className="w-7 h-7 rounded-md bg-white/10 hover:bg-white/20 flex items-center justify-center transition-colors">
            <ChevronLeft className="w-4 h-4 text-white/70" />
          </button>
        )}
      </div>

      {collapsed && (
        <button onClick={() => setCollapsed(false)} className="w-full flex justify-center py-3 text-white/60 hover:text-white transition-colors">
          <ChevronRight className="w-4 h-4" />
        </button>
      )}

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {!collapsed && <p className="px-3 mb-2 text-[10px] uppercase tracking-widest text-white/40 font-semibold">Módulos</p>}

        {visibleModules.map((item) => {
          const Icon = item.icon;
          const isActive = location.pathname === item.to;
          return (
            <NavLink
              key={item.to} to={item.to}
              className={() => linkClasses(isActive)}
              title={collapsed ? item.label : undefined}
              style={isActive ? { borderLeft: '3px solid white', paddingLeft: '10px' } : {}}>
              <Icon className="w-[18px] h-[18px] flex-shrink-0 text-white" />
              {!collapsed && <span className="flex-1 truncate">{item.label}</span>}
              {!collapsed && item.soon && (
                <span className="px-1.5 py-0.5 text-[10px] rounded bg-white/15 text-white/70 font-mono">Soon</span>
              )}
            </NavLink>
          );
        })}

        {/* Configuración — solo admin */}
        {role === 'admin' && (
          <>
            <div className="my-3 mx-3 border-t border-white/15" />
            {!collapsed && <p className="px-3 mb-2 text-[10px] uppercase tracking-widest text-white/40 font-semibold">Sistema</p>}

            {collapsed ? (
              <NavLink to="/configuracion"
                className={() => linkClasses(location.pathname === '/configuracion')}
                title="Configuración"
                style={location.pathname === '/configuracion' ? { borderLeft: '3px solid white', paddingLeft: '10px' } : {}}>
                <Settings className="w-[18px] h-[18px] flex-shrink-0 text-white" />
              </NavLink>
            ) : (
              <div>
                <button
                  onClick={() => setConfigOpen(o => !o)}
                  className={`w-full group flex items-center gap-3 px-3 py-2.5 rounded-lg text-[1rem] font-normal transition-all duration-200 ${
                    location.pathname === '/configuracion' || location.pathname.startsWith('/admin')
                      ? 'bg-white/20 text-white'
                      : 'text-white hover:bg-white/10'
                  }`}
                  style={
                    location.pathname === '/configuracion' || location.pathname.startsWith('/admin')
                      ? { borderLeft: '3px solid white', paddingLeft: '10px' }
                      : {}
                  }>
                  <Settings className="w-[18px] h-[18px] flex-shrink-0 text-white" />
                  <span className="flex-1 text-left truncate">Configuración</span>
                  <ChevronDown className={`w-3.5 h-3.5 text-white/60 transition-transform duration-200 ${configOpen ? 'rotate-180' : ''}`} />
                </button>

                {configOpen && (
                  <div className="ml-4 mt-0.5 space-y-0.5 border-l border-white/15 pl-3">
                    <NavLink to="/configuracion"
                      className={() => `flex items-center gap-2 px-2 py-2 rounded-md text-xs font-medium transition-all duration-150 ${
                        location.pathname === '/configuracion'
                          ? 'text-white bg-white/15'
                          : 'text-white hover:bg-white/10'
                      }`}>
                      <Settings className="w-3.5 h-3.5 flex-shrink-0" />
                      <span>Ajustes del sistema</span>
                    </NavLink>

                    {role === 'admin' && (
                      <NavLink to="/admin/usuarios"
                        className={() => `flex items-center gap-2 px-2 py-2 rounded-md text-xs font-normal transition-all duration-150 ${
                          location.pathname.startsWith('/admin')
                            ? 'text-white bg-white/15'
                            : 'text-white hover:bg-white/10'
                        }`}>
                        <Users className="w-3.5 h-3.5 flex-shrink-0" />
                        <span>Usuarios y Roles</span>
                      </NavLink>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </nav>

      {/* ── User / Footer ── */}
      <div className={`border-t border-white/15 p-3 ${collapsed ? 'flex justify-center' : ''}`}>
        {collapsed ? (
          <button onClick={logout} className="w-9 h-9 rounded-lg bg-white/10 hover:bg-red-500/30 flex items-center justify-center transition-colors" title="Cerrar sesión">
            <LogOut className="w-4 h-4 text-white/70 hover:text-red-300" />
          </button>
        ) : (
          <div className="flex items-center gap-3 animate-fade-in">
            <div className="w-9 h-9 rounded-lg bg-white/20 flex items-center justify-center flex-shrink-0">
              <User className="w-4 h-4 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-[1rem] font-normal text-white truncate">{user?.full_name || 'Usuario'}</p>
              <p className="text-xs font-normal text-white/70 truncate">{ROLE_LABELS[role] || role}</p>
            </div>
            <button onClick={logout} className="w-8 h-8 rounded-lg hover:bg-red-500/30 flex items-center justify-center transition-colors" title="Cerrar sesión">
              <LogOut className="w-4 h-4 text-white/70 hover:text-red-300" />
            </button>
          </div>
        )}
      </div>
    </aside>
  );
}
