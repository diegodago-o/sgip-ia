import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { projectsAPI, sharepointConnectionsAPI } from '../../services/api';
import { Save, ArrowLeft, Loader2, FolderKanban } from 'lucide-react';

const TYPE_OPTIONS = [
  { value: 'obra_civil', label: 'Obra Civil' },
  { value: 'ti', label: 'Tecnología / TI' },
  { value: 'consultoria', label: 'Consultoría' },
  { value: 'interventoria', label: 'Interventoría' },
  { value: 'asesoria', label: 'Asesoría' },
  { value: 'mixto', label: 'Mixto' },
  { value: 'otro', label: 'Otro' },
];

const TERM_UNIT_OPTIONS = [
  { value: 'dias_calendario', label: 'Días calendario' },
  { value: 'dias_habiles', label: 'Días hábiles' },
  { value: 'meses', label: 'Meses' },
  { value: 'anos', label: 'Años' },
];

const SELECTION_PROCESS_OPTIONS = [
  { value: '', label: 'Seleccione...' },
  { value: 'licitacion', label: 'Licitación Pública' },
  { value: 'concurso_meritos', label: 'Concurso de Méritos' },
  { value: 'minima_cuantia', label: 'Mínima Cuantía' },
  { value: 'contratacion_directa', label: 'Contratación Directa' },
  { value: 'otro', label: 'Otro' },
];

const EMPTY_FORM = {
  name: '', project_type: 'obra_civil', sector: 'publico',
  client_name: '', client_nit: '', contract_number: '', contract_object: '',
  contract_value: '', sign_date: '', start_date: '',
  execution_term: '', execution_term_unit: 'meses',
  supervisor: '', director_id: '', location: '', priority: 'media',
  selection_process: '', secop_number: '', cdp_number: '', rp_number: '',
  sharepoint_connection_id: '',
  sharepoint_drive_id:      '',
  sharepoint_folder:        '',
  tags: [],
};

function Field({ label, required, children, span = 1 }) {
  return (
    <div className={span === 2 ? 'sm:col-span-2' : ''}>
      <label className="block text-sm font-medium text-brand-800 mb-1.5">
        {label} {required && <span className="text-red-400">*</span>}
      </label>
      {children}
    </div>
  );
}

export default function ProjectFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [form, setForm] = useState(EMPTY_FORM);
  const [directors, setDirectors] = useState([]);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [tagInput, setTagInput] = useState('');

  // SharePoint connection/drive state
  const [spConnections,   setSpConnections]   = useState([]);
  const [spDrives,        setSpDrives]        = useState([]);
  const [spDrivesLoading, setSpDrivesLoading] = useState(false);

  // Load SP connections once
  useEffect(() => {
    sharepointConnectionsAPI.list()
      .then(r => setSpConnections(r.data?.data || []))
      .catch(() => {});
  }, []);

  // Load drives when connection changes
  useEffect(() => {
    if (!form.sharepoint_connection_id) { setSpDrives([]); return; }
    setSpDrivesLoading(true);
    sharepointConnectionsAPI.listDrives(form.sharepoint_connection_id)
      .then(r => setSpDrives(r.data?.data || []))
      .catch(() => setSpDrives([]))
      .finally(() => setSpDrivesLoading(false));
  }, [form.sharepoint_connection_id]);

  useEffect(() => {
    projectsAPI.directors().then(({ data }) => setDirectors(data.data)).catch(() => {});
    if (isEdit) {
      projectsAPI.get(id)
        .then(({ data }) => {
          const p = data.data;
          setForm({
            name: p.name || '',
            project_type: p.project_type || 'obra_civil',
            sector: p.sector || 'publico',
            client_name: p.client_name || '',
            client_nit: p.client_nit || '',
            contract_number: p.contract_number || '',
            contract_object: p.contract_object || '',
            contract_value: p.contract_value || '',
            sign_date: p.sign_date ? p.sign_date.split('T')[0] : '',
            start_date: p.start_date ? p.start_date.split('T')[0] : '',
            execution_term: p.execution_term || '',
            execution_term_unit: p.execution_term_unit || 'meses',
            supervisor: p.supervisor || '',
            director_id: p.director_id || '',
            location: p.location || '',
            priority: p.priority || 'media',
            selection_process: p.selection_process || '',
            secop_number: p.secop_number || '',
            cdp_number: p.cdp_number || '',
            rp_number: p.rp_number || '',
            sharepoint_connection_id: p.sharepoint_connection_id ? String(p.sharepoint_connection_id) : '',
            sharepoint_drive_id:      p.sharepoint_drive_id      || '',
            sharepoint_folder:        p.sharepoint_folder        || '',
            tags: p.tags || [],
          });
        })
        .catch(() => setError('Error cargando proyecto'))
        .finally(() => setLoading(false));
    }
  }, [id, isEdit]);

  const set = (field) => (e) => setForm(f => ({ ...f, [field]: e.target.value }));

  const addTag = () => {
    const t = tagInput.trim();
    if (t && !form.tags.includes(t)) {
      setForm(f => ({ ...f, tags: [...f.tags, t] }));
    }
    setTagInput('');
  };

  const removeTag = (tag) => setForm(f => ({ ...f, tags: f.tags.filter(t => t !== tag) }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const payload = { ...form };
      if (payload.contract_value) payload.contract_value = parseFloat(payload.contract_value);
      if (payload.execution_term) payload.execution_term = parseInt(payload.execution_term);
      if (!payload.director_id) delete payload.director_id;

      // Clean empty public-sector fields if private
      if (payload.sector === 'privado') {
        payload.selection_process = null;
        payload.secop_number = null;
        payload.cdp_number = null;
        payload.rp_number = null;
      }

      if (isEdit) {
        await projectsAPI.update(id, payload);
      } else {
        await projectsAPI.create(payload);
      }
      navigate('/adjudicacion');
    } catch (err) {
      const msg = err.response?.data?.error || err.response?.data?.errors?.[0]?.msg || 'Error guardando proyecto';
      setError(msg);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-6 h-6 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button onClick={() => navigate('/adjudicacion')} className="w-9 h-9 rounded-lg hover:bg-surface-100 flex items-center justify-center">
          <ArrowLeft className="w-4 h-4 text-surface-400" />
        </button>
        <div>
          <h2 className="text-xl font-display font-bold text-brand-900">
            {isEdit ? 'Editar Proyecto' : 'Nuevo Proyecto'}
          </h2>
          <p className="text-sm text-surface-400">
            {isEdit ? 'Actualice la información del proyecto' : 'Registre un nuevo proyecto adjudicado'}
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-100 text-red-700 text-sm animate-slide-up">
          {error}
        </div>
      )}

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ── Section: Información básica ── */}
        <section className="bg-white rounded-xl shadow-card p-6">
          <h3 className="font-display font-semibold text-brand-900 mb-4 pb-3 border-b border-surface-100">
            Información Básica
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Nombre del Proyecto" required span={2}>
              <input value={form.name} onChange={set('name')} className="input-field" required placeholder="Ej: Construcción Centro Deportivo..." />
            </Field>
            <Field label="Tipo de Proyecto" required>
              <select value={form.project_type} onChange={set('project_type')} className="input-field">
                {TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Sector" required>
              <div className="flex gap-2">
                {['publico', 'privado'].map(s => (
                  <button key={s} type="button"
                    onClick={() => setForm(f => ({ ...f, sector: s }))}
                    className={`flex-1 py-2.5 rounded-lg border text-sm font-medium transition-all
                      ${form.sector === s
                        ? 'bg-brand-600 text-white border-brand-600'
                        : 'bg-white text-surface-400 border-surface-200 hover:border-surface-300'}`}
                  >
                    {s === 'publico' ? 'Público' : 'Privado'}
                  </button>
                ))}
              </div>
            </Field>
            <Field label="Prioridad" required>
              <select value={form.priority} onChange={set('priority')} className="input-field">
                <option value="alta">Alta</option>
                <option value="media">Media</option>
                <option value="baja">Baja</option>
              </select>
            </Field>
            <Field label="Director del Proyecto">
              <select value={form.director_id} onChange={set('director_id')} className="input-field">
                <option value="">Sin asignar</option>
                {directors.map(d => <option key={d.id} value={d.id}>{d.full_name}</option>)}
              </select>
            </Field>
          </div>
        </section>

        {/* ── Section: Contratante y Contrato ── */}
        <section className="bg-white rounded-xl shadow-card p-6">
          <h3 className="font-display font-semibold text-brand-900 mb-4 pb-3 border-b border-surface-100">
            Contratante y Contrato
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Cliente / Contratante" required>
              <input value={form.client_name} onChange={set('client_name')} className="input-field" required placeholder="Nombre de la entidad" />
            </Field>
            <Field label="NIT / Identificación">
              <input value={form.client_nit} onChange={set('client_nit')} className="input-field" placeholder="Ej: 899999999-1" />
            </Field>
            <Field label="Número de Contrato">
              <input value={form.contract_number} onChange={set('contract_number')} className="input-field" placeholder="Ej: LP-2026-001" />
            </Field>
            <Field label="Valor del Contrato">
              <input type="number" value={form.contract_value} onChange={set('contract_value')} className="input-field" placeholder="0" min="0" step="0.01" />
            </Field>
            <Field label="Objeto del Contrato" span={2}>
              <textarea value={form.contract_object} onChange={set('contract_object')} className="input-field min-h-[80px] resize-y" placeholder="Descripción del objeto contractual..." />
            </Field>
          </div>
        </section>

        {/* ── Section: Plazos ── */}
        <section className="bg-white rounded-xl shadow-card p-6">
          <h3 className="font-display font-semibold text-brand-900 mb-4 pb-3 border-b border-surface-100">
            Plazos y Fechas
          </h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Field label="Fecha de Firma">
              <input type="date" value={form.sign_date} onChange={set('sign_date')} className="input-field" />
            </Field>
            <Field label="Fecha de Inicio">
              <input type="date" value={form.start_date} onChange={set('start_date')} className="input-field" />
            </Field>
            <Field label="Plazo de Ejecución">
              <div className="flex gap-2">
                <input type="number" value={form.execution_term} onChange={set('execution_term')} className="input-field flex-1" placeholder="12" min="1" />
                <select value={form.execution_term_unit} onChange={set('execution_term_unit')} className="input-field w-40">
                  {TERM_UNIT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </div>
            </Field>
            <Field label="Supervisor / Interventor">
              <input value={form.supervisor} onChange={set('supervisor')} className="input-field" placeholder="Nombre del supervisor" />
            </Field>
            <Field label="Ubicación">
              <input value={form.location} onChange={set('location')} className="input-field" placeholder="Ciudad / Departamento" />
            </Field>
          </div>
        </section>

        {/* ── Section: Sector Público (conditional) ── */}
        {form.sector === 'publico' && (
          <section className="bg-white rounded-xl shadow-card p-6 animate-slide-up">
            <h3 className="font-display font-semibold text-brand-900 mb-4 pb-3 border-b border-surface-100">
              Información Sector Público
            </h3>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label="Proceso de Selección">
                <select value={form.selection_process} onChange={set('selection_process')} className="input-field">
                  {SELECTION_PROCESS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Número SECOP">
                <input value={form.secop_number} onChange={set('secop_number')} className="input-field" placeholder="SECOP-2026-XXXXX" />
              </Field>
              <Field label="CDP">
                <input value={form.cdp_number} onChange={set('cdp_number')} className="input-field" placeholder="CDP-2026-XXXX" />
              </Field>
              <Field label="RP">
                <input value={form.rp_number} onChange={set('rp_number')} className="input-field" placeholder="RP-2026-XXXX" />
              </Field>
            </div>
          </section>
        )}

        {/* ── Section: SharePoint ── */}
        <section className="bg-white rounded-xl shadow-card p-6">
          <div className="flex items-center gap-2 mb-4 pb-3 border-b border-surface-100">
            <FolderKanban className="w-4 h-4 text-surface-400" />
            <h3 className="font-display font-semibold text-brand-900">Integración SharePoint</h3>
            <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded bg-surface-100 text-surface-500">Opcional</span>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <Field label="Conexión SharePoint">
              <select value={form.sharepoint_connection_id} onChange={set('sharepoint_connection_id')} className="input-field">
                <option value="">— Sin integración SharePoint —</option>
                {spConnections.map(c => (
                  <option key={c.id} value={String(c.id)}>{c.name} · {c.site_url}</option>
                ))}
              </select>
              <p className="text-[11px] text-surface-400 mt-1">
                Selecciona la conexión configurada en Configuración → SharePoint. Sin conexión, el tab de SharePoint no aparece en el proyecto.
              </p>
            </Field>

            {form.sharepoint_connection_id && (
              <Field label="Biblioteca de documentos">
                {spDrivesLoading ? (
                  <div className="flex items-center gap-2 text-xs text-surface-400 py-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Cargando bibliotecas...
                  </div>
                ) : (
                  <select value={form.sharepoint_drive_id} onChange={set('sharepoint_drive_id')} className="input-field">
                    <option value="">— Biblioteca "Documentos" (por defecto) —</option>
                    {spDrives.map(d => (
                      <option key={d.id} value={d.id}>{d.name}{d.description ? ` — ${d.description}` : ''}</option>
                    ))}
                  </select>
                )}
                <p className="text-[11px] text-surface-400 mt-1">
                  Biblioteca de documentos que se mostrará en el tab SharePoint del proyecto.
                </p>
              </Field>
            )}

            {form.sharepoint_connection_id && (
              <Field label="Subcarpeta inicial (opcional)">
                <input
                  type="text"
                  value={form.sharepoint_folder}
                  onChange={set('sharepoint_folder')}
                  className="input-field"
                  placeholder="ej: Proyectos/TI-2026-001"
                />
                <p className="text-[11px] text-surface-400 mt-1">
                  Si se configura, el explorador abrirá directamente esta subcarpeta dentro de la biblioteca. Dejar vacío para mostrar la raíz.
                </p>
              </Field>
            )}
          </div>
        </section>

        {/* ── Section: Tags ── */}
        <section className="bg-white rounded-xl shadow-card p-6">
          <h3 className="font-display font-semibold text-brand-900 mb-4 pb-3 border-b border-surface-100">
            Etiquetas
          </h3>
          <div className="flex gap-2 mb-3">
            <input value={tagInput} onChange={e => setTagInput(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); addTag(); } }}
              className="input-field flex-1" placeholder="Escriba una etiqueta y presione Enter" />
            <button type="button" onClick={addTag} className="btn-ghost text-sm">Agregar</button>
          </div>
          {form.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {form.tags.map(tag => (
                <span key={tag} className="inline-flex items-center gap-1 px-2.5 py-1 bg-brand-50 text-brand-700 rounded-full text-sm">
                  {tag}
                  <button type="button" onClick={() => removeTag(tag)} className="hover:text-red-500 transition-colors">×</button>
                </span>
              ))}
            </div>
          )}
        </section>

        {/* ── Actions ── */}
        <div className="flex items-center justify-end gap-3 pb-8">
          <button type="button" onClick={() => navigate('/adjudicacion')} className="btn-ghost">
            Cancelar
          </button>
          <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {isEdit ? 'Guardar Cambios' : 'Crear Proyecto'}
          </button>
        </div>
      </form>
    </div>
  );
}
