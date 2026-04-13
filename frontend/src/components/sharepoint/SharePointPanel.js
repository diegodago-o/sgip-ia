/**
 * SharePointPanel — Explorador de archivos de SharePoint dentro de un proyecto.
 * Mounted at: ProjectDetailPage → tab 'sharepoint'
 *
 * Props:
 *   projectId  {number}  — ID del proyecto
 *   folderPath {string}  — Ruta raíz del proyecto en SharePoint
 *   pickerMode {bool}    — Si es true, muestra botón "Seleccionar" en vez de Descargar
 *   onSelect   {fn}      — Callback(item) cuando pickerMode=true y el usuario selecciona un archivo
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  FolderKanban, FolderOpen, FileText, Upload, Download,
  ChevronRight, Home, Loader2, AlertTriangle, X, ExternalLink,
  RefreshCw, File, Brain,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { sharepointAPI } from '../../services/api';
import SPCoveragePanel from './SPCoveragePanel';
import DocumentAnalysisModal, { canAnalyze } from './DocumentAnalysisModal';

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function formatSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });
}

function getFileIcon(item) {
  if (item.type === 'folder') return FolderOpen;
  const ext = (item.name || '').split('.').pop().toLowerCase();
  if (['pdf'].includes(ext)) return FileText;
  return File;
}

function getFileColor(item) {
  if (item.type === 'folder') return 'text-amber-500';
  const ext = (item.name || '').split('.').pop().toLowerCase();
  if (ext === 'pdf') return 'text-red-500';
  if (['doc', 'docx'].includes(ext)) return 'text-blue-600';
  if (['xls', 'xlsx'].includes(ext)) return 'text-green-600';
  if (['ppt', 'pptx'].includes(ext)) return 'text-orange-500';
  if (['jpg', 'jpeg', 'png', 'gif'].includes(ext)) return 'text-violet-500';
  return 'text-surface-400';
}

// ─────────────────────────────────────────────
// Helper: open download
// ─────────────────────────────────────────────
async function openDownload(projectId, itemId) {
  try {
    const r = await sharepointAPI.getDownloadUrl(projectId, itemId);
    window.open(r.data?.url || r.data, '_blank', 'noopener,noreferrer');
  } catch {
    // fallback: webUrl if available
  }
}

// ─────────────────────────────────────────────
// Preview Modal
// Estrategia por formato:
//   • DOCX/DOC  → mammoth.js  (blob → HTML local, sin servicio externo)
//   • XLSX/XLS  → SheetJS     (blob → tabla HTML local, sin servicio externo)
//   • PPTX/PPT  → Office Online Viewer (sin alternativa JS viable)
//   • PDF       → blob URL en <iframe> (nativo del navegador)
//   • Otros     → acciones solamente
// ─────────────────────────────────────────────

function getPreviewStrategy(filename) {
  const ext = (filename || '').split('.').pop().toLowerCase();
  if (['docx', 'doc'].includes(ext))        return 'docx';
  if (['xlsx', 'xls'].includes(ext))        return 'xlsx';
  if (['pptx', 'ppt', 'odp'].includes(ext)) return 'pptx';
  if (['odt'].includes(ext))                return 'docx';
  if (['ods'].includes(ext))                return 'xlsx';
  if (ext === 'pdf')                        return 'pdf';
  return 'none';
}

function PreviewModal({ item, projectId, getDownloadUrl, onClose }) {
  const [loading,      setLoading]      = useState(true);
  const [error,        setError]        = useState(null);
  const [retryKey,     setRetryKey]     = useState(0);

  // PDF: blob URL para iframe
  const [blobUrl,      setBlobUrl]      = useState(null);

  // DOCX: HTML sanitizado
  const [docHtml,      setDocHtml]      = useState(null);

  // XLSX: hojas [{name, html}]
  const [sheets,       setSheets]       = useState([]);
  const [activeSheet,  setActiveSheet]  = useState(0);

  // PPTX: Office Online iframe state
  const [iframeLoaded, setIframeLoaded] = useState(false);
  const [timedOut,     setTimedOut]     = useState(false);
  const [elapsed,      setElapsed]      = useState(0);
  const [officeUrl,    setOfficeUrl]    = useState(null);

  const blobRef  = useRef(null);
  const timerRef = useRef(null);
  const strategy = getPreviewStrategy(item.name);

  // Limpieza al desmontar
  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (blobRef.current)  URL.revokeObjectURL(blobRef.current);
  }, []);

  // Cronómetro PPTX mientras Office Online renderiza
  useEffect(() => {
    if (strategy !== 'pptx' || loading || iframeLoaded || timedOut) return;
    setElapsed(0);
    const iv = setInterval(() => setElapsed(s => s + 1), 1000);
    return () => clearInterval(iv);
  }, [strategy, loading, iframeLoaded, timedOut, retryKey]);

  // Efecto principal: descarga y renderiza según estrategia
  useEffect(() => {
    let cancelled = false;
    // reset state
    setLoading(true); setError(null);
    setBlobUrl(null); setDocHtml(null); setSheets([]); setActiveSheet(0);
    setIframeLoaded(false); setTimedOut(false); setElapsed(0); setOfficeUrl(null);
    if (blobRef.current) { URL.revokeObjectURL(blobRef.current); blobRef.current = null; }

    if (strategy === 'none') { setLoading(false); return; }

    const run = async () => {
      try {
        const url = await getDownloadUrl(item.id);
        if (cancelled) return;

        // ── PDF ──────────────────────────────────────────────────────
        if (strategy === 'pdf') {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('Error descargando archivo');
          const blob = await resp.blob();
          if (cancelled) return;
          const objUrl = URL.createObjectURL(blob);
          blobRef.current = objUrl;
          setBlobUrl(objUrl);
          setLoading(false);
          return;
        }

        // ── DOCX / DOC ────────────────────────────────────────────────
        if (strategy === 'docx') {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('Error descargando archivo');
          const buffer = await resp.arrayBuffer();
          if (cancelled) return;
          const mammoth = (await import('mammoth')).default || (await import('mammoth'));
          const result  = await mammoth.convertToHtml({ arrayBuffer: buffer });
          if (cancelled) return;
          // Limpiar párrafos vacíos consecutivos (>2 seguidos → 1)
          let html = result.value
            .replace(/(<p>\s*<\/p>\s*){3,}/gi, '<p></p>')
            .replace(/^(\s*<p>\s*<\/p>\s*)+/, '')   // quitar vacíos al inicio
            .replace(/(\s*<p>\s*<\/p>\s*)+$/, '');  // quitar vacíos al final
          const clean = DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
          setDocHtml(clean);
          setLoading(false);
          return;
        }

        // ── XLSX / XLS ────────────────────────────────────────────────
        if (strategy === 'xlsx') {
          const resp = await fetch(url);
          if (!resp.ok) throw new Error('Error descargando archivo');
          const buffer = await resp.arrayBuffer();
          if (cancelled) return;
          const XLSX = (await import('xlsx'));
          const wb   = XLSX.read(buffer, { type: 'array', cellFormula: false, cellStyles: false });
          if (cancelled) return;
          const parsed = wb.SheetNames.map(name => {
            const ws = wb.Sheets[name];
            // Obtener filas como arrays, sin blankrows
            const allRows = XLSX.utils.sheet_to_json(ws, {
              header: 1, defval: null, raw: false, blankrows: false,
            });
            // Filtrar filas completamente vacías
            const rows = allRows.filter(row =>
              Array.isArray(row) && row.some(c => c !== null && c !== undefined && String(c).trim() !== '')
            );
            // Calcular columna máxima con contenido (recortar vacíos al final)
            let maxCol = 0;
            rows.forEach(row => {
              for (let i = row.length - 1; i >= 0; i--) {
                const v = row[i];
                if (v !== null && v !== undefined && String(v).trim() !== '') {
                  if (i > maxCol) maxCol = i;
                  break;
                }
              }
            });
            return { name, rows, maxCol };
          });
          setSheets(parsed);
          setActiveSheet(0);
          setLoading(false);
          return;
        }

        // ── PPTX / PPT ────────────────────────────────────────────────
        if (strategy === 'pptx') {
          const embedUrl = `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(url)}`;
          setOfficeUrl(embedUrl);
          setLoading(false);
          timerRef.current = setTimeout(() => setTimedOut(true), 20000);
          return;
        }
      } catch (e) {
        if (!cancelled) { setError(e.message || 'Error cargando vista previa'); setLoading(false); }
      }
    };

    run();
    return () => { cancelled = true; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [item.id, strategy, retryKey, getDownloadUrl]);

  const handleRetry = () => { setRetryKey(k => k + 1); setElapsed(0); };

  // Mensaje contextual PPTX
  const pptxMsg = elapsed < 5  ? 'Cargando visor de PowerPoint...'
    : elapsed < 12 ? `Procesando... (${elapsed}s)`
    : `Tardando más de lo esperado (${elapsed}s)`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-6xl h-[94vh] flex flex-col overflow-hidden" style={{ border: '1px solid #d0d0d0' }}>

        {/* ── Header ── */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-surface-200 flex-shrink-0">
          <div className="flex items-center gap-2 min-w-0">
            <FileText className="w-4 h-4 text-brand-500 flex-shrink-0" />
            <span className="font-medium text-brand-900 truncate text-sm">{item.name}</span>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <a href={item.webUrl} target="_blank" rel="noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-brand-600 border border-brand-200 rounded-lg hover:bg-brand-50 transition-colors">
              <ExternalLink className="w-3.5 h-3.5" /> Abrir en SharePoint
            </a>
            <button onClick={() => openDownload(projectId, item.id)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">
              <Download className="w-3.5 h-3.5" /> Descargar
            </button>
            <button onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-lg hover:bg-surface-100 transition-colors">
              <X className="w-4 h-4 text-surface-400" />
            </button>
          </div>
        </div>

        {/* Pestañas XLSX se muestran dentro del visor Excel, no aquí */}

        {/* ── Contenido ── */}
        <div className="flex-1 overflow-hidden relative">

          {/* Spinner carga inicial */}
          {loading && (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-white z-10">
              <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
              <p className="text-sm text-surface-500">
                {strategy === 'docx' ? 'Procesando documento Word...'
                  : strategy === 'xlsx' ? 'Procesando hoja de cálculo...'
                  : strategy === 'pptx' ? 'Preparando presentación...'
                  : 'Cargando vista previa...'}
              </p>
            </div>
          )}

          {/* Error */}
          {!loading && error && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <AlertTriangle className="w-10 h-10 text-red-300" />
              <div className="text-center">
                <p className="text-sm font-medium text-surface-700">No se pudo cargar la vista previa</p>
                <p className="text-xs text-surface-400 mt-1">{error}</p>
              </div>
              <div className="flex gap-3">
                <button onClick={handleRetry}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors">
                  <RefreshCw className="w-4 h-4" /> Reintentar
                </button>
                <a href={item.webUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-brand-600 border border-brand-200 rounded-xl hover:bg-brand-50 transition-colors">
                  <ExternalLink className="w-4 h-4" /> Abrir en SharePoint
                </a>
              </div>
            </div>
          )}

          {/* PDF → iframe nativo */}
          {!loading && !error && strategy === 'pdf' && blobUrl && (
            <iframe src={blobUrl} title={item.name} className="w-full h-full border-0" />
          )}

          {/* ── VISOR WORD ── */}
          {!loading && !error && strategy === 'docx' && docHtml !== null && (
            <div className="h-full flex flex-col" style={{ background: '#c8c8c8' }}>
              {/* Barra superior Word — sticky fija */}
              <div className="flex items-center gap-2 px-4 py-1.5 flex-shrink-0"
                style={{ background: '#2b579a' }}>
                <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="white">
                  <path d="M21.17 3.25Q21.5 3.25 21.76 3.5 22 3.74 22 4.08V19.92Q22 20.26 21.76 20.5 21.5 20.75 21.17 20.75H7.83Q7.5 20.75 7.24 20.5 7 20.26 7 19.92V17H2.83Q2.5 17 2.24 16.76 2 16.5 2 16.17V7.83Q2 7.5 2.24 7.24 2.5 7 2.83 7H7V4.08Q7 3.74 7.24 3.5 7.5 3.25 7.83 3.25M7 13.06L8.18 17H10L11.19 13.09 12.37 17H14.19L15.34 13V17H17V7H14.19L12.99 10.9 11.79 7H9.99L8.81 10.91 7.62 7H7M19 17V15H18V17M19 13V11H18V13M19 9V7H18V9"/>
                </svg>
                <span className="text-white text-xs font-semibold truncate">{item.name}</span>
                <span className="ml-auto text-blue-200 text-[10px]">Vista previa · Solo lectura</span>
              </div>
              {/* Regla horizontal */}
              <div className="flex-shrink-0 flex items-center justify-center"
                style={{ background: '#e8e8e8', borderBottom: '1px solid #c0c0c0', height: 20 }}>
                <div style={{ width: 816, position: 'relative', height: '100%' }}>
                  {[0,1,2,3,4,5,6,7,8].map(i => (
                    <span key={i} style={{
                      position: 'absolute', left: `${i * 96}px`, fontSize: 9,
                      color: '#888', userSelect: 'none', top: 4,
                    }}>{i > 0 ? i : ''}</span>
                  ))}
                </div>
              </div>
              {/* Estilos Word */}
              <style>{`
                .sgip-word-page p        { margin: 0 0 8px 0; }
                .sgip-word-page p:empty  { display: none; }
                .sgip-word-page h1 { font-size:22px; font-weight:700; margin:22px 0 10px; color:#1f3864; border-bottom:2px solid #bfbfbf; padding-bottom:4px; }
                .sgip-word-page h2 { font-size:17px; font-weight:700; margin:18px 0 8px; color:#1f3864; }
                .sgip-word-page h3 { font-size:14px; font-weight:600; margin:14px 0 6px; color:#2e4057; }
                .sgip-word-page ul, .sgip-word-page ol { padding-left:28px; margin:4px 0 10px; }
                .sgip-word-page li  { margin-bottom:4px; }
                .sgip-word-page table { border-collapse:collapse; width:100%; margin:12px 0; font-size:12px; }
                .sgip-word-page td, .sgip-word-page th { border:1px solid #bfbfbf; padding:5px 10px; vertical-align:top; }
                .sgip-word-page th   { background:#dce6f1; font-weight:600; color:#1f3864; }
                .sgip-word-page tr:nth-child(even) td { background:#f2f7fd; }
                .sgip-word-page strong { font-weight:700; }
                .sgip-word-page em     { font-style:italic; }
                .sgip-word-page img    { max-width:100%; height:auto; margin:8px 0; }
                .sgip-word-page a      { color:#2b579a; text-decoration:underline; }
                .sgip-word-page blockquote { border-left:4px solid #2b579a; padding-left:12px; margin:10px 0; color:#555; }
              `}</style>
              {/* Canvas con scroll — flex-1 min-h-0 para que el scroll quede al fondo del viewport */}
              <div className="flex-1 min-h-0 overflow-y-auto overflow-x-hidden py-6 px-4 flex justify-center"
                style={{ background: '#c8c8c8' }}>
                <div
                  className="sgip-word-page w-full bg-white"
                  style={{
                    maxWidth: '816px',
                    minHeight: '1056px',
                    padding: '72px 96px',
                    boxShadow: '0 2px 8px rgba(0,0,0,.35), 0 0 0 1px rgba(0,0,0,.12)',
                    fontFamily: '"Calibri","Segoe UI",Arial,sans-serif',
                    fontSize: '13px',
                    lineHeight: '1.65',
                    color: '#1a1a1a',
                  }}
                  dangerouslySetInnerHTML={{ __html: docHtml }}
                />
              </div>
            </div>
          )}

          {/* ── VISOR EXCEL ── */}
          {!loading && !error && strategy === 'xlsx' && sheets.length > 0 && (() => {
            const { rows, maxCol } = sheets[activeSheet] || { rows: [], maxCol: 0 };
            const colLetter = n => {
              let s = ''; let i = n + 1;
              while (i > 0) { i--; s = String.fromCharCode(65 + (i % 26)) + s; i = Math.floor(i / 26); }
              return s;
            };
            // Primera fila como cabecera si tiene contenido
            const hasHeader = rows.length > 1 && rows[0].some(c => c !== null && c !== undefined && String(c).trim() !== '');
            return (
              <div className="h-full flex flex-col" style={{ background: '#f0f0f0', fontFamily: '"Calibri","Segoe UI",Arial,sans-serif' }}>

                {/* Barra superior Excel */}
                <div className="flex items-center gap-2 px-3 py-1.5 flex-shrink-0"
                  style={{ background: '#217346' }}>
                  <svg viewBox="0 0 24 24" className="w-4 h-4 flex-shrink-0" fill="white">
                    <path d="M21.17 3.25Q21.5 3.25 21.76 3.5 22 3.74 22 4.08V19.92Q22 20.26 21.76 20.5 21.5 20.75 21.17 20.75H7.83Q7.5 20.75 7.24 20.5 7 20.26 7 19.92V17H2.83Q2.5 17 2.24 16.76 2 16.5 2 16.17V7.83Q2 7.5 2.24 7.24 2.5 7 2.83 7H7V4.08Q7 3.74 7.24 3.5 7.5 3.25 7.83 3.25M7 13.06L8.18 17H10L11.19 13.09 12.37 17H14.19L15.34 13V17H17V7H14.19L12.99 10.9 11.79 7H9.99L8.81 10.91 7.62 7H7M19 17V15H18V17M19 13V11H18V13M19 9V7H18V9"/>
                  </svg>
                  <span className="text-white text-xs font-semibold truncate">{item.name}</span>
                  <span className="ml-auto text-green-200 text-[10px]">Vista previa · Solo lectura</span>
                </div>

                {/* Barra de fórmulas */}
                <div className="flex items-center flex-shrink-0"
                  style={{ background: '#fff', borderBottom: '1px solid #c0c0c0', height: 26 }}>
                  <div style={{ width: 52, minWidth: 52, background: '#f5f5f5', borderRight: '1px solid #c0c0c0', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, color: '#555', fontWeight: 600 }}>A1</div>
                  <div style={{ width: 1, height: '100%', background: '#c0c0c0' }} />
                  <div style={{ flex: 1, padding: '0 10px', fontSize: 12, color: '#1a1a1a', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {rows[0]?.[0] != null ? String(rows[0][0]) : ''}
                  </div>
                </div>

                {/* ─── TABLA — flex-1 min-h-0 es la clave para scroll fijo al fondo ─── */}
                <div className="flex-1 min-h-0 overflow-auto" style={{ background: '#f0f0f0' }}>
                  {rows.length === 0 ? (
                    <div className="flex items-center justify-center h-full">
                      <p className="text-sm" style={{ color: '#888' }}>Esta hoja no tiene datos</p>
                    </div>
                  ) : (
                    <table style={{ borderCollapse: 'collapse', fontSize: '12px', tableLayout: 'auto' }}>
                      <thead>
                        <tr>
                          {/* Celda esquina */}
                          <th style={{ width: 44, minWidth: 44, background: '#f2f2f2', border: '1px solid #c8c8c8', position: 'sticky', top: 0, left: 0, zIndex: 4 }} />
                          {/* Letras columna */}
                          {Array.from({ length: maxCol + 1 }, (_, ci) => (
                            <th key={ci} style={{
                              background: '#f2f2f2', border: '1px solid #c8c8c8',
                              padding: '3px 10px', fontWeight: 600, fontSize: '11px',
                              color: '#555', textAlign: 'center', whiteSpace: 'nowrap',
                              minWidth: 90, position: 'sticky', top: 0, zIndex: 3,
                              userSelect: 'none',
                            }}>
                              {colLetter(ci)}
                            </th>
                          ))}
                        </tr>
                        {/* Primera fila como encabezado de datos */}
                        {hasHeader && (
                          <tr>
                            <td style={{ background: '#f2f2f2', border: '1px solid #c8c8c8', padding: '3px 6px', textAlign: 'right', fontSize: '11px', color: '#888', position: 'sticky', top: 24, left: 0, zIndex: 3, fontWeight: 600 }}>1</td>
                            {Array.from({ length: maxCol + 1 }, (_, ci) => {
                              const val = rows[0]?.[ci] ?? '';
                              return (
                                <td key={ci} title={String(val).length > 25 ? String(val) : undefined}
                                  style={{
                                    border: '1px solid #c8c8c8',
                                    padding: '4px 10px',
                                    whiteSpace: 'nowrap',
                                    maxWidth: 280,
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    background: '#e2efda',  /* verde claro como cabecera Excel */
                                    fontWeight: 700,
                                    color: '#1a1a1a',
                                    fontSize: '12px',
                                    position: 'sticky',
                                    top: 24,
                                    zIndex: 2,
                                    borderBottom: '2px solid #70ad47',
                                  }}>
                                  {String(val)}
                                </td>
                              );
                            })}
                          </tr>
                        )}
                      </thead>
                      <tbody>
                        {(hasHeader ? rows.slice(1) : rows).map((row, ri) => {
                          const realRi = hasHeader ? ri + 2 : ri + 1;
                          return (
                            <tr key={ri} style={{ background: ri % 2 === 0 ? '#ffffff' : '#f5f5f5' }}
                              onMouseEnter={e => { Array.from(e.currentTarget.cells).forEach(c => { c.style.background = '#ddeeff'; }); }}
                              onMouseLeave={e => { Array.from(e.currentTarget.cells).forEach((c, i) => { c.style.background = i === 0 ? '#f2f2f2' : (ri % 2 === 0 ? '#ffffff' : '#f5f5f5'); }); }}>
                              {/* Número fila */}
                              <td style={{ background: '#f2f2f2', border: '1px solid #c8c8c8', padding: '3px 6px', textAlign: 'right', fontSize: '11px', color: '#888', position: 'sticky', left: 0, zIndex: 1, fontWeight: 500, userSelect: 'none', minWidth: 44 }}>
                                {realRi}
                              </td>
                              {Array.from({ length: maxCol + 1 }, (_, ci) => {
                                const val = row[ci] ?? '';
                                const str = String(val);
                                const isNum = str.trim() !== '' && !isNaN(Number(str.replace(/[$,%\s]/g, '')));
                                return (
                                  <td key={ci} title={str.length > 25 ? str : undefined}
                                    style={{
                                      border: '1px solid #e0e0e0',
                                      padding: '3px 10px',
                                      whiteSpace: 'nowrap',
                                      maxWidth: 280,
                                      overflow: 'hidden',
                                      textOverflow: 'ellipsis',
                                      textAlign: isNum ? 'right' : 'left',
                                      color: '#1a1a1a',
                                      fontSize: '12px',
                                    }}>
                                    {str}
                                  </td>
                                );
                              })}
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  )}
                </div>

                {/* Pestañas hojas — parte inferior */}
                <div className="flex items-center flex-shrink-0 overflow-x-auto"
                  style={{ background: '#d9d9d9', borderTop: '1px solid #b0b0b0', minHeight: 30 }}>
                  {/* Botones navegación hoja */}
                  <div className="flex items-center px-1 gap-0.5 flex-shrink-0" style={{ borderRight: '1px solid #b0b0b0' }}>
                    {['◀◀','◀','▶','▶▶'].map((a, i) => (
                      <button key={i} style={{ width: 18, height: 20, fontSize: 8, background: '#e8e8e8', border: '1px solid #b8b8b8', color: '#555', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>{a}</button>
                    ))}
                  </div>
                  <div className="flex items-end px-1 gap-0 overflow-x-auto">
                    {sheets.map((s, i) => (
                      <button key={i} onClick={() => setActiveSheet(i)}
                        style={{
                          padding: '4px 16px 3px',
                          fontSize: '11px',
                          border: '1px solid',
                          borderBottom: i === activeSheet ? '2px solid #217346' : '1px solid #b0b0b0',
                          borderColor: i === activeSheet ? '#b0b0b0' : '#c0c0c0',
                          background: i === activeSheet ? '#ffffff' : '#d0d0d0',
                          color: i === activeSheet ? '#217346' : '#444',
                          fontWeight: i === activeSheet ? 700 : 400,
                          cursor: 'pointer',
                          whiteSpace: 'nowrap',
                          marginTop: 2,
                        }}>
                        {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}

          {/* PPTX → Office Online (único con iframe externo) */}
          {!loading && !error && strategy === 'pptx' && officeUrl && !timedOut && (
            <>
              {!iframeLoaded && (
                <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-surface-50/95 z-10">
                  <Loader2 className="w-6 h-6 animate-spin text-brand-400" />
                  <p className="text-sm text-surface-600 text-center max-w-xs px-4">{pptxMsg}</p>
                  {elapsed >= 5 && (
                    <a href={item.webUrl} target="_blank" rel="noreferrer"
                      className="flex items-center gap-1.5 px-4 py-2 text-xs text-brand-600 border border-brand-200 bg-white rounded-xl hover:bg-brand-50 transition-colors shadow-sm">
                      <ExternalLink className="w-3.5 h-3.5" /> Abrir en SharePoint
                    </a>
                  )}
                </div>
              )}
              <iframe src={officeUrl} title={item.name} className="w-full h-full border-0"
                allowFullScreen
                onLoad={() => { setIframeLoaded(true); if (timerRef.current) clearTimeout(timerRef.current); }}
                onError={() => setTimedOut(true)}
              />
            </>
          )}

          {/* Timeout PPTX o formato sin preview */}
          {!loading && !error && (strategy === 'none' || (strategy === 'pptx' && timedOut)) && (
            <div className="flex flex-col items-center justify-center h-full gap-4">
              <File className="w-12 h-12 text-surface-300" />
              <div className="text-center">
                <p className="text-sm font-medium text-surface-600">
                  {strategy === 'pptx' ? 'El visor de presentaciones tardó demasiado' : 'Vista previa no disponible para este formato'}
                </p>
                <p className="text-xs text-surface-400 mt-1">
                  Usa los botones de arriba para abrir o descargar el archivo
                </p>
              </div>
              <div className="flex gap-3">
                {strategy === 'pptx' && (
                  <button onClick={handleRetry}
                    className="flex items-center gap-1.5 px-4 py-2 text-sm bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors">
                    <RefreshCw className="w-4 h-4" /> Reintentar
                  </button>
                )}
                <a href={item.webUrl} target="_blank" rel="noreferrer"
                  className="flex items-center gap-1.5 px-4 py-2 text-sm text-brand-600 border border-brand-200 rounded-xl hover:bg-brand-50 transition-colors">
                  <ExternalLink className="w-4 h-4" /> Abrir en SharePoint
                </a>
                <button onClick={() => openDownload(projectId, item.id)}
                  className="flex items-center gap-1.5 px-4 py-2 text-sm bg-brand-600 text-white rounded-xl hover:bg-brand-700 transition-colors">
                  <Download className="w-4 h-4" /> Descargar
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
export default function SharePointPanel({ projectId, folderPath, pickerMode = false, onSelect }) {
  const [files,        setFiles]        = useState([]);
  const [currentPath,  setCurrentPath]  = useState('');  // relative to folderPath
  const [breadcrumb,   setBreadcrumb]   = useState([]);  // [{ label, path }]
  const [loading,      setLoading]      = useState(true);
  const [uploading,    setUploading]    = useState(false);
  const [error,        setError]        = useState(null);
  const [previewItem,  setPreviewItem]  = useState(null);
  const [analyzeItem,  setAnalyzeItem]  = useState(null);

  const fileInputRef   = useRef(null);
  const folderCacheRef = useRef(new Map()); // key: subpath → items[]
  const loadAbortRef   = useRef(null);       // AbortController para cancelar requests en vuelo
  const urlCacheRef    = useRef(new Map()); // D: cache de download URLs por itemId (sesión)

  // Quick-access subfolders derived from first load (top-level folders)
  const [quickFolders, setQuickFolders] = useState([]);

  // Limpiar caches si cambia el proyecto
  useEffect(() => {
    folderCacheRef.current.clear();
    urlCacheRef.current.clear();
  }, [projectId]);

  // A: prefetch silencioso de URL al hacer hover en archivo Office
  const prefetchUrl = useCallback(async (itemId) => {
    if (urlCacheRef.current.has(itemId)) return; // ya en cache
    try {
      const r = await sharepointAPI.getDownloadUrl(projectId, itemId);
      const url = r.data?.url || r.data;
      if (url) urlCacheRef.current.set(itemId, url);
    } catch { /* ignorar errores silenciosos de prefetch */ }
  }, [projectId]);

  // D: obtener URL con cache primero (usado por PreviewModal)
  const getDownloadUrl = useCallback(async (itemId) => {
    if (urlCacheRef.current.has(itemId)) return urlCacheRef.current.get(itemId);
    const r = await sharepointAPI.getDownloadUrl(projectId, itemId);
    const url = r.data?.url || r.data;
    if (url) urlCacheRef.current.set(itemId, url);
    return url;
  }, [projectId]);

  // ── Load current folder ──────────────────────────────────────────
  const loadFolder = useCallback(async (subpath, forceRefresh = false) => {
    // Servir desde cache si está disponible y no se fuerza refresco
    if (!forceRefresh && folderCacheRef.current.has(subpath)) {
      const cached = folderCacheRef.current.get(subpath);
      setFiles(cached);
      if (!subpath) setQuickFolders(cached.filter(i => i.type === 'folder'));
      setLoading(false);
      setError(null);
      return;
    }

    // Cancelar request anterior en vuelo
    if (loadAbortRef.current) loadAbortRef.current.abort();
    loadAbortRef.current = new AbortController();
    const signal = loadAbortRef.current.signal;

    setLoading(true);
    setError(null);
    try {
      const res = await sharepointAPI.listFiles(projectId, subpath);
      if (signal.aborted) return;
      const items = res.data?.data || [];
      folderCacheRef.current.set(subpath, items); // guardar en cache
      setFiles(items);
      if (!subpath) setQuickFolders(items.filter(i => i.type === 'folder'));
    } catch (e) {
      if (e.name === 'CanceledError' || e.name === 'AbortError' || signal.aborted) return;
      setError(e.response?.data?.error || e.message || 'Error cargando archivos');
    } finally {
      if (!signal.aborted) setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    loadFolder(currentPath);
  }, [loadFolder, currentPath]);

  // ── Navigation ───────────────────────────────────────────────────
  const navigateInto = (folder) => {
    const newPath = currentPath ? `${currentPath}/${folder.name}` : folder.name;
    setBreadcrumb(prev => [...prev, { label: folder.name, path: newPath }]);
    setCurrentPath(newPath);
  };

  const navigateTo = (path, idx) => {
    // idx=-1 → root, idx>=0 → breadcrumb item
    if (idx === -1) {
      setBreadcrumb([]);
      setCurrentPath('');
    } else {
      setBreadcrumb(prev => prev.slice(0, idx + 1));
      setCurrentPath(path);
    }
  };

  // ── Upload ───────────────────────────────────────────────────────
  const handleUpload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    try {
      await sharepointAPI.upload(projectId, file, currentPath);
      folderCacheRef.current.delete(currentPath); // invalidar cache tras subida
      await loadFolder(currentPath, true);
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error subiendo archivo');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  // ── Item click ───────────────────────────────────────────────────
  const handleItemClick = (item) => {
    if (item.type === 'folder') {
      navigateInto(item);
    } else if (pickerMode) {
      // picker mode: do nothing on click, only "Select" button acts
    } else {
      setPreviewItem(item);
    }
  };

  // ─────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────
  return (
    <div className="space-y-4">

      {/* Coverage panel — only in explorer mode (not picker) */}
      {!pickerMode && <SPCoveragePanel projectId={projectId} />}

      {/* Quick-access folders */}
      {!currentPath && quickFolders.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {quickFolders.map(f => (
            <button key={f.id} onClick={() => navigateInto(f)}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-50 border border-amber-200 text-amber-700 text-xs font-medium rounded-lg hover:bg-amber-100 transition-colors">
              <FolderOpen className="w-3.5 h-3.5" />
              {f.name}
            </button>
          ))}
        </div>
      )}

      {/* Toolbar: breadcrumb + upload */}
      <div className="flex items-center justify-between bg-surface-50 border border-surface-200 rounded-xl px-4 py-2.5">
        {/* Breadcrumb */}
        <div className="flex items-center gap-1 flex-1 min-w-0 overflow-x-auto">
          <button onClick={() => navigateTo('', -1)}
            className="flex items-center gap-1 text-brand-600 hover:text-brand-800 text-xs font-medium flex-shrink-0">
            <Home className="w-3.5 h-3.5" />
          </button>
          {breadcrumb.map((crumb, idx) => (
            <React.Fragment key={crumb.path}>
              <ChevronRight className="w-3 h-3 text-surface-300 flex-shrink-0" />
              <button onClick={() => navigateTo(crumb.path, idx)}
                className="text-xs text-brand-600 hover:text-brand-800 hover:underline whitespace-nowrap">
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-2 flex-shrink-0 ml-3">
          <button onClick={() => loadFolder(currentPath)} title="Actualizar"
            className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-surface-200 transition-colors">
            <RefreshCw className={`w-3.5 h-3.5 text-surface-400 ${loading ? 'animate-spin' : ''}`} />
          </button>
          {!pickerMode && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleUpload}
              />
              <button onClick={() => fileInputRef.current?.click()} disabled={uploading}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-brand-600 hover:bg-brand-700 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60 disabled:cursor-not-allowed">
                {uploading
                  ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  : <Upload className="w-3.5 h-3.5" />}
                {uploading ? 'Subiendo...' : 'Subir'}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl text-red-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <p className="text-xs">{error}</p>
        </div>
      )}

      {/* File list */}
      <div className="bg-white border border-surface-200 rounded-xl overflow-x-auto">
        {loading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-surface-300">
            <Loader2 className="w-5 h-5 animate-spin" />
            <span className="text-sm">Cargando archivos...</span>
          </div>
        ) : files.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 gap-2 text-surface-300">
            <FolderKanban className="w-10 h-10" />
            <p className="text-sm">Esta carpeta está vacía</p>
            {!pickerMode && (
              <button onClick={() => fileInputRef.current?.click()}
                className="mt-2 flex items-center gap-1.5 px-4 py-2 text-sm text-brand-600 border border-brand-200 rounded-xl hover:bg-brand-50 transition-colors">
                <Upload className="w-4 h-4" /> Subir el primer archivo
              </button>
            )}
          </div>
        ) : (
          <table className="w-full min-w-[520px] text-sm">
            <thead>
              <tr className="border-b border-surface-100">
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-surface-400 w-auto">Nombre</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-surface-400 w-24 hidden sm:table-cell">Tamaño</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-surface-400 w-32 hidden md:table-cell">Modificado</th>
                <th className="px-4 py-2.5 w-24"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-50">
              {files.map(item => {
                const Icon = getFileIcon(item);
                const color = getFileColor(item);
                // Prefetch solo para PPTX (los otros formatos descargan el blob completo al abrir)
                const isOffice = item.type === 'file' && getPreviewStrategy(item.name) === 'pptx';
                return (
                  <tr key={item.id}
                    className="hover:bg-surface-50 transition-colors cursor-pointer group"
                    onClick={() => handleItemClick(item)}
                    onMouseEnter={() => { if (isOffice) prefetchUrl(item.id); }}>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Icon className={`w-4 h-4 flex-shrink-0 ${color}`} />
                        <span className="truncate text-sm text-brand-900 group-hover:text-brand-600">{item.name}</span>
                        {item.type === 'folder' && <ChevronRight className="w-3 h-3 text-surface-300 flex-shrink-0 ml-auto" />}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-surface-400 hidden sm:table-cell">
                      {item.type === 'folder' ? '—' : formatSize(item.size)}
                    </td>
                    <td className="px-4 py-3 text-right text-xs text-surface-400 hidden md:table-cell">
                      {formatDate(item.lastModified)}
                    </td>
                    <td className="px-4 py-3" onClick={e => e.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        {item.type === 'file' && (
                          pickerMode ? (
                            <button
                              onClick={() => onSelect && onSelect(item)}
                              className="px-2.5 py-1 text-xs bg-brand-600 text-white rounded-lg hover:bg-brand-700 transition-colors">
                              Seleccionar
                            </button>
                          ) : (
                            <div className="flex items-center gap-0.5">
                              {canAnalyze(item.name) && (
                                <button
                                  onClick={(e) => { e.stopPropagation(); setAnalyzeItem(item); }}
                                  className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 transition-colors"
                                  title="Analizar con IA">
                                  <Brain className="w-3.5 h-3.5" />
                                </button>
                              )}
                              <button
                                onClick={async (e) => { e.stopPropagation(); await openDownload(projectId, item.id); }}
                                className="w-7 h-7 flex items-center justify-center rounded-lg hover:bg-brand-50 text-surface-400 hover:text-brand-600 transition-colors"
                                title="Descargar">
                                <Download className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          )
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Analysis Modal */}
      {analyzeItem && (
        <DocumentAnalysisModal
          projectId={projectId}
          item={analyzeItem}
          onClose={() => setAnalyzeItem(null)}
        />
      )}

      {/* Preview Modal — key fuerza remount completo al cambiar de archivo */}
      {previewItem && (
        <PreviewModal
          key={previewItem.id}
          item={previewItem}
          projectId={projectId}
          getDownloadUrl={getDownloadUrl}
          onClose={() => setPreviewItem(null)}
        />
      )}
    </div>
  );
}
