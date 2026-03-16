import React from 'react';
import { useLocation } from 'react-router-dom';
import { Construction, ArrowRight } from 'lucide-react';

const MODULE_INFO = {
  '/planificacion': { module: 'Módulo 2', title: 'Planificación', description: 'Cronogramas, EDT/WBS, líneas base y asignación de recursos.', features: ['Cronogramas interactivos (Gantt)', 'EDT / WBS automática', 'Líneas base de alcance, tiempo y costo', 'Asignación de recursos'] },
  '/ejecucion':     { module: 'Módulo 3', title: 'Ejecución y Seguimiento', description: 'Avance, comunicaciones, facturación e informes periódicos.', features: ['Registro de avance físico y financiero', 'Gestión de comunicaciones', 'Facturación y condiciones de pago', 'Informes automáticos'] },
  '/control':       { module: 'Módulo 4', title: 'Control y Cambios', description: 'Desviaciones, solicitudes de cambio, adiciones y riesgos.', features: ['Análisis de desviaciones', 'Solicitudes de cambio', 'Gestión de riesgos', 'Control de adiciones'] },
  '/cierre':        { module: 'Módulo 5', title: 'Cierre y Liquidación', description: 'Entregables finales, acta de liquidación y lecciones aprendidas.', features: ['Checklist de cierre', 'Acta de liquidación', 'Lecciones aprendidas'] },
  '/indicadores':   { module: 'Módulo 6', title: 'Indicadores y KPIs', description: 'Dashboard ejecutivo con semáforos de estado y tendencias.', features: ['KPIs operativos y estratégicos', 'Semáforos de estado', 'Reportes ejecutivos'] },
  '/ia':            { module: 'Módulo 7', title: 'Motor de IA', description: 'Configuración de IA, integraciones y análisis predictivo.', features: ['Configuración de modelos IA', 'Integración SharePoint', 'OCR y NLP'] },
  '/configuracion': { module: 'Sistema', title: 'Configuración', description: 'Usuarios, roles, permisos y parámetros generales.', features: ['Gestión de usuarios y roles', 'Parámetros del sistema', 'Integraciones'] },
};

export default function PlaceholderPage() {
  const location = useLocation();
  const info = MODULE_INFO[location.pathname] || { module: '—', title: 'No encontrado', description: '', features: [] };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-10rem)]">
      <div className="max-w-lg text-center animate-slide-up">
        <div className="w-16 h-16 rounded-2xl bg-brand-50 border-2 border-brand-100 flex items-center justify-center mx-auto mb-6">
          <Construction className="w-7 h-7 text-brand-500" />
        </div>
        <span className="inline-block px-3 py-1 rounded-full bg-brand-100 text-brand-700 text-xs font-semibold font-mono mb-3">{info.module}</span>
        <h2 className="text-2xl font-display font-bold text-brand-900 mb-2">{info.title}</h2>
        <p className="text-surface-400 mb-8 leading-relaxed">{info.description}</p>
        {info.features.length > 0 && (
          <div className="bg-white rounded-xl p-5 shadow-card text-left mb-6">
            <p className="text-xs uppercase tracking-widest text-surface-400 font-semibold mb-3">Funcionalidades planeadas</p>
            <div className="space-y-2">
              {info.features.map(f => (
                <div key={f} className="flex items-center gap-2.5 text-sm text-brand-800">
                  <ArrowRight className="w-3.5 h-3.5 text-brand-400 flex-shrink-0" /><span>{f}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <p className="text-xs text-surface-400 font-mono">Próximamente</p>
      </div>
    </div>
  );
}
