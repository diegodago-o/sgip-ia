import React, { useState, useEffect } from 'react';
import { projectsAPI, aiAPI } from '../../services/api';
import AIAutoPopulatePanel from '../ai/AIAutoPopulatePanel';
import {
  BrainCircuit, FileSearch, FileOutput, BarChart3, MessageSquare, Sparkles,
  ChevronDown, FolderKanban, Loader2, Copy, Check, Settings2,
  Upload, Send, AlertTriangle, CheckCircle2, XCircle, Clock, Zap,
} from 'lucide-react';

const TABS = [
  { id: 'extract', label: 'Analizar Documento', icon: FileSearch, desc: 'Sube y analiza documentos' },
  { id: 'generate', label: 'Generar Docs', icon: FileOutput, desc: 'Genera informes y oficios' },
  { id: 'analyze', label: 'Analizar Proyecto', icon: BarChart3, desc: 'Análisis inteligente' },
  { id: 'chat', label: 'Asistente', icon: MessageSquare, desc: 'Chat con IA' },
  { id: 'auto_populate', label: 'Auto-Poblar', icon: Sparkles, desc: 'Poblar módulos desde documentos' },
];

const PROVIDERS = {
  anthropic: { name: 'Claude (Anthropic)', models: ['claude-sonnet-4-20250514', 'claude-opus-4-20250514', 'claude-haiku-4-5-20251001'] },
  openai: { name: 'GPT-5 (OpenAI)', models: ['gpt-5.2', 'gpt-5', 'gpt-5-mini', 'gpt-5-nano'] },
};

const DOC_TYPES = {
  informe_mensual: 'Informe mensual de gestión',
  acta_comite: 'Acta de comité de seguimiento',
  oficio_supervisor: 'Oficio del supervisor/interventor',
  informe_cierre: 'Informe final de cierre',
  balance_financiero: 'Balance financiero detallado',
  acta_inicio: 'Acta de inicio del contrato',
  requerimiento: 'Requerimiento al contratista',
};

const EXTRACT_TYPES = {
  contract: 'Contrato / Minuta',
  invoice: 'Factura / Cuenta de cobro',
  minutes: 'Acta de reunión',
  general: 'Documento general',
};

const ALERT_COLORS = { critico: 'bg-red-100 text-red-800 border-red-200', alto: 'bg-orange-100 text-orange-800 border-orange-200', medio: 'bg-amber-100 text-amber-800 border-amber-200', bajo: 'bg-blue-100 text-blue-800 border-blue-200' };
const ALERT_ICONS = { critico: <XCircle className="w-4 h-4" />, alto: <AlertTriangle className="w-4 h-4" />, medio: <Clock className="w-4 h-4" />, bajo: <CheckCircle2 className="w-4 h-4" /> };

function ProviderSelector({ provider, setProvider, apiKey, setApiKey, model, setModel, systemConfigured }) {
  const [show, setShow] = useState(false);
  const p = PROVIDERS[provider];
  const sysActive = systemConfigured?.[provider]; // true if system key is set for this provider

  return (
    <div className="flex items-center gap-2 flex-wrap">
      {/* System key badge */}
      {sysActive && (
        <span className="inline-flex items-center gap-1 px-2 py-1 rounded-full bg-emerald-50 border border-emerald-200 text-[10px] font-medium text-emerald-700">
          <CheckCircle2 className="w-3 h-3" /> Clave del sistema activa
        </span>
      )}
      <button onClick={() => setShow(!show)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-surface-200 text-xs text-brand-800 hover:bg-surface-50">
        <Settings2 className="w-3.5 h-3.5 text-surface-400" /> {p.name} <ChevronDown className={`w-3 h-3 transition-transform ${show ? 'rotate-180' : ''}`} />
      </button>
      {show && (
        <div className="flex items-center gap-2 flex-wrap animate-fade-in">
          <select value={provider} onChange={e => { setProvider(e.target.value); setModel(PROVIDERS[e.target.value].models[0]); }} className="input-field text-xs py-1.5 w-36">
            {Object.entries(PROVIDERS).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
          </select>
          <select value={model} onChange={e => setModel(e.target.value)} className="input-field text-xs py-1.5 w-48">
            {p.models.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)}
            className="input-field text-xs py-1.5 w-56"
            placeholder={sysActive ? 'Clave personal (opcional — sobreescribe la del sistema)' : `API Key ${provider === 'anthropic' ? 'Anthropic' : 'OpenAI'} (requerida)`} />
        </div>
      )}
    </div>
  );
}

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  return <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
    className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-surface-100 hover:bg-surface-200 text-surface-500">
    {copied ? <><Check className="w-3 h-3 text-emerald-500" /> Copiado</> : <><Copy className="w-3 h-3" /> Copiar</>}
  </button>;
}

function MarkdownRenderer({ text }) {
  const html = text
    .replace(/^#### (.+)$/gm, '<h4 class="text-sm font-bold text-brand-900 mt-4 mb-1">$1</h4>')
    .replace(/^### (.+)$/gm, '<h3 class="text-base font-bold text-brand-900 mt-5 mb-2">$1</h3>')
    .replace(/^## (.+)$/gm, '<h2 class="text-lg font-display font-bold text-brand-900 mt-6 mb-2 pb-1 border-b border-surface-100">$1</h2>')
    .replace(/^# (.+)$/gm, '<h1 class="text-xl font-display font-bold text-brand-900 mt-6 mb-3">$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, '<strong class="font-semibold text-brand-900"><em>$1</em></strong>')
    .replace(/\*\*(.+?)\*\*/g, '<strong class="font-semibold text-brand-900">$1</strong>')
    .replace(/\*(.+?)\*/g, '<em class="italic">$1</em>')
    .replace(/^---$/gm, '<hr class="my-4 border-surface-200" />')
    .replace(/^[\s]*[-–•] (.+)$/gm, '<li class="ml-4 pl-1 py-0.5 list-disc">$1</li>')
    .replace(/^[\s]*(\d+)\.\s(.+)$/gm, '<li class="ml-4 pl-1 py-0.5 list-decimal" value="$1">$2</li>')
    .replace(/((?:<li class="ml-4 pl-1 py-0\.5 list-disc">.*<\/li>\s*)+)/g, '<ul class="my-2 space-y-0.5">$1</ul>')
    .replace(/((?:<li class="ml-4 pl-1 py-0\.5 list-decimal".*<\/li>\s*)+)/g, '<ol class="my-2 space-y-0.5">$1</ol>')
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-surface-50 rounded-lg p-3 my-3 text-xs font-mono overflow-x-auto border border-surface-100"><code>$2</code></pre>')
    .replace(/`([^`]+)`/g, '<code class="bg-surface-100 px-1.5 py-0.5 rounded text-xs font-mono text-brand-700">$1</code>')
    .replace(/\n\n/g, '</p><p class="mb-3">')
    .replace(/\n/g, '<br />');
  return <div className="text-sm text-brand-800 leading-relaxed" dangerouslySetInnerHTML={{ __html: `<p class="mb-3">${html}</p>` }} />;
}

// ── EXTRACT TAB → DOCUMENT ANALYSIS ──
function ExtractTab({ provider, apiKey, model }) {
  const [file, setFile] = useState(null);
  const [prompt, setPrompt] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [meta, setMeta] = useState(null);

  const QUICK_PROMPTS = [
    { label: 'Análisis completo', prompt: 'Analiza este documento a fondo. Identifica: 1) Tipo de documento y partes involucradas 2) Objeto y alcance 3) Obligaciones del contratista 4) Obligaciones de la entidad 5) Valores, plazos y condiciones de pago 6) Garantías y pólizas requeridas 7) Cláusulas penales y multas 8) Riesgos identificados 9) Entregables y productos 10) Recomendaciones para la ejecución' },
    { label: 'Obligaciones y entregables', prompt: 'Extrae y clasifica TODAS las obligaciones del contratista y de la entidad mencionadas en este documento. Para cada una indica si es obligación general o específica, su plazo si se menciona, y los entregables o productos asociados.' },
    { label: 'Pólizas y garantías', prompt: 'Identifica todas las garantías, pólizas y amparos mencionados en este documento. Para cada una indica: tipo de garantía, porcentaje de cobertura, vigencia requerida y beneficiario.' },
    { label: 'Cláusulas clave', prompt: 'Identifica y resume las cláusulas más importantes de este documento: cláusula penal, terminación anticipada, suspensión, adiciones, cesión, confidencialidad, propiedad intelectual, solución de controversias y cualquier otra cláusula relevante.' },
    { label: 'Resumen ejecutivo', prompt: 'Genera un resumen ejecutivo de este documento en máximo 500 palabras, destacando los puntos más importantes para un director de proyecto que necesita entender rápidamente de qué se trata.' },
    { label: 'Datos para el sistema', prompt: 'Extrae los datos que necesito para registrar este proyecto en un sistema de gestión: nombre del proyecto, número de contrato, tipo de contrato, objeto, contratista (nombre y NIT), entidad contratante, valor del contrato, fecha de inicio, fecha de fin, plazo en meses, supervisor/interventor, y forma de pago.' },
  ];

  const handleAnalyze = async (customPrompt) => {
    if (!file && !prompt.trim()) return;
    setLoading(true); setError(null); setResult('');
    const usePrompt = customPrompt || prompt || 'Analiza este documento a fondo y dame un resumen completo con los puntos más importantes.';
    try {
      const fd = new FormData();
      if (file) fd.append('file', file);
      fd.append('text', '');
      fd.append('extraction_type', 'analyze');
      fd.append('analysis_prompt', usePrompt);
      fd.append('provider', provider);
      if (apiKey) fd.append('api_key', apiKey);
      if (model) fd.append('model', model);
      const res = await aiAPI.extract(fd);
      setResult(res.data.data.analysis || res.data.data.raw_response || JSON.stringify(res.data.data, null, 2));
      setMeta(res.data.meta);
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      {/* File upload */}
      <div className="flex gap-4 items-start">
        <div className="flex-1">
          <div className="border-2 border-dashed border-surface-200 rounded-lg p-4 hover:border-brand-400 transition-colors">
            <input type="file" accept=".pdf,.txt,.md,.csv,.docx,.doc,.xlsx,.xls,.png,.jpg,.jpeg" onChange={e => { setFile(e.target.files[0]); setResult(''); }} className="hidden" id="ai-file" />
            <label htmlFor="ai-file" className="cursor-pointer flex items-center gap-3">
              <Upload className="w-6 h-6 text-surface-400" />
              <div>
                <p className="text-sm font-medium text-brand-800">{file ? file.name : 'Subir documento'}</p>
                <p className="text-xs text-surface-400">PDF, Word, Excel, TXT — máx 15MB</p>
              </div>
            </label>
          </div>
        </div>
      </div>

      {/* Quick analysis buttons */}
      {file && !result && (
        <div className="space-y-2">
          <p className="text-xs font-medium text-brand-800">Análisis rápido:</p>
          <div className="flex flex-wrap gap-2">
            {QUICK_PROMPTS.map((qp, i) => (
              <button key={i} onClick={() => handleAnalyze(qp.prompt)} disabled={loading}
                className="px-3 py-1.5 rounded-full bg-brand-50 text-xs text-brand-700 hover:bg-brand-100 transition-colors border border-brand-200">
                {qp.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Custom prompt */}
      {file && (
        <div className="flex gap-2">
          <input value={prompt} onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAnalyze()}
            className="input-field text-sm flex-1"
            placeholder="¿Qué quieres saber del documento? Ej: ¿Cuáles son las obligaciones del contratista?" disabled={loading} />
          <button onClick={() => handleAnalyze()} disabled={loading || (!file && !prompt.trim())}
            className="btn-primary px-4 flex items-center gap-2">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Zap className="w-4 h-4" />}
            {loading ? 'Analizando...' : 'Analizar'}
          </button>
        </div>
      )}

      {/* Error */}
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}

      {/* Result - natural text */}
      {result && (
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            {meta && <span className="text-[10px] text-surface-400">Método: {meta.method} · {meta.chars?.toLocaleString()} caracteres</span>}
            <CopyButton text={result} />
          </div>
          <div className="bg-white border border-surface-100 rounded-xl p-6 max-w-none">
            <MarkdownRenderer text={result} />
          </div>
        </div>
      )}

      {/* Empty state */}
      {!file && !result && (
        <div className="text-center py-12">
          <FileSearch className="w-10 h-10 text-surface-300 mx-auto mb-3" />
          <p className="text-sm text-surface-400">Suba un documento para analizarlo con IA</p>
          <p className="text-xs text-surface-400 mt-1">La IA leerá el documento completo y le dará un análisis detallado</p>
        </div>
      )}
    </div>
  );
}

// ── GENERATE TAB ──
function GenerateTab({ projectId, provider, apiKey, model }) {
  const [docType, setDocType] = useState('informe_mensual');
  const [instructions, setInstructions] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleGenerate = async () => {
    if (!projectId) return setError('Seleccione un proyecto');
    setLoading(true); setError(null); setResult('');
    try {
      const res = await aiAPI.generate(projectId, { document_type: docType, instructions, provider, api_key: apiKey || undefined, model });
      setResult(res.data.data.content);
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setLoading(false); }
  };

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <div><label className="block text-xs font-medium text-brand-800 mb-1">Tipo de documento</label>
          <select value={docType} onChange={e => setDocType(e.target.value)} className="input-field text-sm">
            {Object.entries(DOC_TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </div>
        <div><label className="block text-xs font-medium text-brand-800 mb-1">Instrucciones adicionales</label>
          <input value={instructions} onChange={e => setInstructions(e.target.value)} className="input-field text-sm" placeholder="Ej: Enfocarse en el atraso del cronograma..." />
        </div>
      </div>
      <button onClick={handleGenerate} disabled={loading || !projectId} className="btn-primary text-sm flex items-center gap-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileOutput className="w-4 h-4" />} {loading ? 'Generando...' : 'Generar Documento'}
      </button>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {result && (
        <div className="space-y-2">
          <div className="flex justify-end"><CopyButton text={result} /></div>
          <div className="bg-white border border-surface-100 rounded-xl p-6 max-w-none">
            <MarkdownRenderer text={result} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── ANALYZE TAB ──
function AnalyzeTab({ projectId, provider, apiKey, model }) {
  const [result, setResult] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleAnalyze = async () => {
    if (!projectId) return setError('Seleccione un proyecto');
    setLoading(true); setError(null); setResult(null);
    try {
      const res = await aiAPI.analyze(projectId, { provider, api_key: apiKey || undefined, model });
      setResult(res.data.data);
    } catch (err) { setError(err.response?.data?.error || err.message); }
    finally { setLoading(false); }
  };

  const healthColors = { critico: 'text-red-600 bg-red-50', en_riesgo: 'text-orange-600 bg-orange-50', precaución: 'text-amber-600 bg-amber-50', saludable: 'text-emerald-600 bg-emerald-50', excelente: 'text-green-600 bg-green-50' };

  return (
    <div className="space-y-4">
      <button onClick={handleAnalyze} disabled={loading || !projectId} className="btn-primary text-sm flex items-center gap-2">
        {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <BarChart3 className="w-4 h-4" />} {loading ? 'Analizando proyecto...' : 'Ejecutar Análisis IA'}
      </button>
      {error && <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">{error}</div>}
      {result && !result.parse_error && (
        <div className="space-y-4 animate-fade-in">
          {/* Health Score */}
          <div className={`p-4 rounded-xl ${healthColors[result.health_label] || 'bg-surface-50'}`}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-medium opacity-70">Salud del Proyecto</p>
                <p className="text-3xl font-display font-bold">{result.health_score}/100</p>
                <p className="text-xs mt-1 capitalize font-semibold">{result.health_label?.replace('_', ' ')}</p>
              </div>
              <div className="text-right space-y-1">
                {result.spi && <p className="text-xs">SPI: <span className={`font-bold ${result.spi < 1 ? 'text-red-600' : 'text-emerald-600'}`}>{result.spi}</span></p>}
                {result.cpi && <p className="text-xs">CPI: <span className={`font-bold ${result.cpi < 1 ? 'text-red-600' : 'text-emerald-600'}`}>{result.cpi}</span></p>}
              </div>
            </div>
            <p className="text-sm mt-2 opacity-80">{result.executive_summary}</p>
          </div>

          {/* Alerts */}
          {result.alerts?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-brand-900 mb-2">Alertas ({result.alerts.length})</h4>
              <div className="space-y-2">
                {result.alerts.map((a, i) => (
                  <div key={i} className={`p-3 rounded-lg border ${ALERT_COLORS[a.level] || ALERT_COLORS.bajo}`}>
                    <div className="flex items-start gap-2">
                      <span className="mt-0.5">{ALERT_ICONS[a.level]}</span>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-bold uppercase">{a.level}</span>
                          <span className="text-xs opacity-60">{a.category}</span>
                        </div>
                        <p className="text-sm font-medium mt-0.5">{a.title}</p>
                        <p className="text-xs mt-1 opacity-80">{a.description}</p>
                        {a.recommendation && <p className="text-xs mt-1 font-medium">→ {a.recommendation}</p>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Recommendations */}
          {result.recommendations?.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-brand-900 mb-2">Recomendaciones</h4>
              <div className="space-y-2">
                {result.recommendations.map((r, i) => (
                  <div key={i} className="flex items-start gap-3 p-3 bg-surface-50 rounded-lg">
                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${r.priority === 'alta' ? 'bg-red-100 text-red-700' : r.priority === 'media' ? 'bg-amber-100 text-amber-700' : 'bg-blue-100 text-blue-700'}`}>{r.priority}</span>
                    <div>
                      <p className="text-sm text-brand-900">{r.action}</p>
                      <p className="text-xs text-surface-400 mt-0.5">{r.area} · {r.expected_impact}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Next Actions */}
          {result.next_actions?.length > 0 && (
            <div className="p-4 bg-brand-50 rounded-lg">
              <h4 className="text-sm font-semibold text-brand-900 mb-2">Acciones Inmediatas</h4>
              <div className="space-y-1.5">
                {result.next_actions.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 text-sm text-brand-800">
                    <span className="w-5 h-5 rounded-full bg-brand-600 text-white text-xs flex items-center justify-center flex-shrink-0">{i + 1}</span>
                    {a}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {result?.parse_error && (
        <div className="bg-white border border-surface-100 rounded-lg p-4">
          <p className="text-xs text-amber-600 mb-2">La respuesta no se pudo parsear como JSON. Respuesta en texto:</p>
          <pre className="text-xs text-surface-600 whitespace-pre-wrap">{result.raw_response}</pre>
        </div>
      )}
    </div>
  );
}

// ── CHAT TAB ──
function ChatTab({ projectId, provider, apiKey, model }) {
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSend = async () => {
    if (!input.trim() || !projectId) return;
    const userMsg = input.trim();
    setInput('');
    setMessages(m => [...m, { role: 'user', content: userMsg }]);
    setLoading(true);
    try {
      const history = messages.map(m => ({ role: m.role, content: m.content }));
      const res = await aiAPI.chat(projectId, { message: userMsg, history, provider, api_key: apiKey || undefined, model });
      setMessages(m => [...m, { role: 'assistant', content: res.data.data.response }]);
    } catch (err) {
      setMessages(m => [...m, { role: 'assistant', content: `Error: ${err.response?.data?.error || err.message}` }]);
    } finally { setLoading(false); }
  };

  const suggestions = [
    '¿Cuál es el estado general del proyecto?',
    '¿Qué actividades están atrasadas?',
    '¿Cuánto se ha pagado y cuánto falta?',
    '¿Cuáles son los riesgos más críticos?',
    '¿Qué obligaciones están pendientes?',
  ];

  return (
    <div className="flex flex-col h-[500px]">
      <div className="flex-1 overflow-y-auto space-y-3 p-2">
        {messages.length === 0 && (
          <div className="text-center py-8">
            <BrainCircuit className="w-10 h-10 text-surface-300 mx-auto mb-3" />
            <p className="text-sm text-surface-400 mb-4">Pregúntale a la IA sobre tu proyecto</p>
            <div className="flex flex-wrap gap-2 justify-center">
              {suggestions.map((s, i) => (
                <button key={i} onClick={() => { setInput(s); }} className="px-3 py-1.5 rounded-full bg-brand-50 text-xs text-brand-700 hover:bg-brand-100 transition-colors">{s}</button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[80%] p-3 rounded-lg ${
              m.role === 'user' ? 'bg-brand-600 text-white rounded-br-sm text-sm' : 'bg-surface-100 rounded-bl-sm'}`}>
              {m.role === 'user' ? m.content : <MarkdownRenderer text={m.content} />}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex justify-start"><div className="bg-surface-100 rounded-lg p-3 rounded-bl-sm"><Loader2 className="w-4 h-4 animate-spin text-brand-500" /></div></div>
        )}
      </div>
      <div className="flex gap-2 pt-3 border-t border-surface-100">
        <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSend())}
          className="input-field text-sm flex-1" placeholder="Escriba su pregunta..." disabled={loading || !projectId} />
        <button onClick={handleSend} disabled={loading || !input.trim() || !projectId} className="btn-primary px-4">
          <Send className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
}

// ── MAIN PAGE ──
export default function AIPage() {
  const [projects, setProjects] = useState([]);
  const [selectedId, setSelectedId] = useState(() => {
    const s = localStorage.getItem('sgip_selected_project');
    return s ? parseInt(s, 10) : null;
  });
  const [selectedProject, setSelectedProject] = useState(null);
  const [activeTab, setActiveTab] = useState('extract');
  const [loading, setLoading] = useState(true);
  const [dropOpen, setDropOpen] = useState(false);

  // AI Config
  const [provider, setProvider] = useState(localStorage.getItem('sgip_ai_provider') || 'anthropic');
  const [apiKey, setApiKey] = useState(localStorage.getItem('sgip_ai_key') || '');
  const [model, setModel] = useState(localStorage.getItem('sgip_ai_model') || 'claude-sonnet-4-20250514');
  // System-wide key status: { anthropic: bool, openai: bool }
  const [systemConfigured, setSystemConfigured] = useState({ anthropic: false, openai: false });

  // Persist AI config
  useEffect(() => { localStorage.setItem('sgip_ai_provider', provider); }, [provider]);
  useEffect(() => { localStorage.setItem('sgip_ai_key', apiKey); }, [apiKey]);
  useEffect(() => { localStorage.setItem('sgip_ai_model', model); }, [model]);

  // Fetch system AI config status once on mount
  useEffect(() => {
    aiAPI.settings()
      .then(r => {
        const d = r.data?.data || {};
        setSystemConfigured({
          anthropic: !!(d.anthropic_configured),
          openai:    !!(d.openai_configured),
        });
        // If system has a default provider set and user hasn't chosen one yet, respect it
        if (d.default_provider && !localStorage.getItem('sgip_ai_provider')) {
          setProvider(d.default_provider);
        }
      })
      .catch(() => {});
  }, []);

  // Persist selected project across modules
  useEffect(() => { if (selectedId) localStorage.setItem('sgip_selected_project', selectedId); }, [selectedId]);

  useEffect(() => {
    projectsAPI.list({ limit: 100 })
      .then(({ data }) => {
        const all = data.data;
        setProjects(all);
        if (all.length === 0) return;
        const stored = parseInt(localStorage.getItem('sgip_selected_project'), 10);
        const preferred = all.find(p => p.id === stored) || all[0];
        setSelectedId(preferred.id);
        setSelectedProject(preferred);
      })
      .catch(() => {}).finally(() => setLoading(false));
  }, []);

  useEffect(() => { if (selectedId) { const p = projects.find(p => p.id === selectedId); if (p) setSelectedProject(p); } }, [selectedId, projects]);

  if (loading) return <div className="flex items-center justify-center h-64"><div className="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" /></div>;

  return (
    <div className="space-y-4 animate-fade-in">
      {/* Header */}
      <div className="bg-white rounded-xl shadow-card p-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-violet-500 to-brand-600 flex items-center justify-center">
              <BrainCircuit className="w-5 h-5 text-white" />
            </div>
            <div>
              <h2 className="text-lg font-display font-bold text-brand-900">Motor de IA</h2>
              <p className="text-xs text-surface-400">Extracción, generación, análisis y asistente inteligente</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ProviderSelector provider={provider} setProvider={setProvider} apiKey={apiKey} setApiKey={setApiKey} model={model} setModel={setModel} systemConfigured={systemConfigured} />
            {/* Project selector for generate/analyze/chat */}
            {activeTab !== 'extract' && (
              <div className="relative">
                <button onClick={() => setDropOpen(!dropOpen)} className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-surface-200 text-xs text-brand-800 hover:bg-surface-50">
                  <FolderKanban className="w-3.5 h-3.5 text-surface-400" />
                  {selectedProject ? `${selectedProject.code}` : 'Seleccionar'} <ChevronDown className="w-3 h-3" />
                </button>
                {dropOpen && (
                  <div className="absolute right-0 top-full mt-1 w-72 bg-white border border-surface-100 rounded-xl shadow-xl z-50 max-h-48 overflow-y-auto animate-slide-up">
                    {projects.map(p => (
                      <button key={p.id} onClick={() => { setSelectedId(p.id); setDropOpen(false); }}
                        className={`w-full text-left px-3 py-2 hover:bg-surface-50 border-b border-surface-50 last:border-0 text-xs ${p.id === selectedId ? 'bg-brand-50' : ''}`}>
                        <span className="font-mono text-brand-500">{p.code}</span> <span className="text-brand-900">{p.name}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* API Key warning */}
      {!apiKey && !systemConfigured?.[provider] && (
        <div className="flex items-center gap-2 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-700">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          Configure su API Key en el selector de proveedor (ícono ⚙️) o en el archivo .env del backend.
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white rounded-xl shadow-card overflow-hidden">
        <div className="flex border-b border-surface-100 overflow-x-auto">
          {TABS.map(tab => {
            const Icon = tab.icon; const isActive = activeTab === tab.id;
            return (
              <button key={tab.id} onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap
                  ${isActive ? 'border-violet-600 text-violet-700 bg-violet-50/50' : 'border-transparent text-surface-400 hover:text-surface-600'}`}>
                <Icon className="w-4 h-4" />{tab.label}
              </button>
            );
          })}
        </div>
        <div className="p-4">
          {activeTab === 'extract' && <ExtractTab provider={provider} apiKey={apiKey} model={model} />}
          {activeTab === 'generate' && <GenerateTab projectId={selectedId} provider={provider} apiKey={apiKey} model={model} />}
          {activeTab === 'analyze' && <AnalyzeTab projectId={selectedId} provider={provider} apiKey={apiKey} model={model} />}
          {activeTab === 'chat' && <ChatTab projectId={selectedId} provider={provider} apiKey={apiKey} model={model} />}
          {activeTab === 'auto_populate' && selectedId && <AIAutoPopulatePanel projectId={selectedId} provider={provider} apiKey={apiKey} model={model} />}
        </div>
      </div>
    </div>
  );
}
