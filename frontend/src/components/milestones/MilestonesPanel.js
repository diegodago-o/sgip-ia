import React, { useState, useEffect, useCallback } from 'react';
import { milestonesAPI, deliverablesAPI, obligationsAPI, documentsAPI, evidenceAPI } from '../../services/api';
import {
  Plus, Edit2, Trash2, X, Save, Loader2, Flag, Package, CheckCircle2,
  Clock, AlertTriangle, FileText, Link2, Paperclip,
} from 'lucide-react';

const M_STATUS = {
  pendiente:{label:'Pendiente',bg:'bg-blue-100',text:'text-blue-700'},
  cumplido:{label:'Cumplido',bg:'bg-emerald-100',text:'text-emerald-700'},
  vencido:{label:'Vencido',bg:'bg-red-100',text:'text-red-700'},
};
const D_STATUS = {
  pendiente:{label:'Pendiente',bg:'bg-blue-100',text:'text-blue-700'},
  en_elaboracion:{label:'En Elaboración',bg:'bg-amber-100',text:'text-amber-700'},
  entregado:{label:'Entregado',bg:'bg-cyan-100',text:'text-cyan-700'},
  aprobado:{label:'Aprobado',bg:'bg-emerald-100',text:'text-emerald-700'},
  rechazado:{label:'Rechazado',bg:'bg-red-100',text:'text-red-700'},
};
const ALERT_S = { overdue:'border-l-4 border-l-red-500 bg-red-50/30', urgent:'border-l-4 border-l-amber-400', ok:'border-l-4 border-l-emerald-300', normal:'' };

function fmtDate(d) { return d ? new Date(d).toLocaleDateString('es-CO',{day:'2-digit',month:'short',year:'numeric'}) : '\u2014'; }

// ═══ Generic Modal ═══
function ItemModal({ type, item, projectId, obligations, milestones, onClose, onSaved }) {
  const isEdit = Boolean(item?.id);
  const isMilestone = type === 'milestone';
  const [form, setForm] = useState(
    isMilestone ? { name:item?.name||'', description:item?.description||'', due_date:item?.due_date?item.due_date.split('T')[0]:'', due_date_rule:item?.due_date_rule||'', status:item?.status||'pendiente' }
    : { name:item?.name||'', description:item?.description||'', due_date:item?.due_date?item.due_date.split('T')[0]:'', obligation_id:item?.obligation_id||'', milestone_id:item?.milestone_id||'', required_format:item?.required_format||'', acceptance_criteria:item?.acceptance_criteria||'', status:item?.status||'pendiente' }
  );
  const [saving, setSaving] = useState(false);
  const set = f => e => setForm(d=>({...d,[f]:e.target.value}));

  const handleSubmit = async(e)=>{ e.preventDefault(); setSaving(true);
    try {
      const api = isMilestone ? milestonesAPI : deliverablesAPI;
      if (isEdit) await api.update(projectId, item.id, form); else await api.create(projectId, form);
      onSaved();
    } catch{} finally{setSaving(false);}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900">{isEdit?'Editar':'Crear'} {isMilestone?'Hito':'Entregable'}</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400"/></button>
        </div>
        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          <div><label className="block text-sm font-medium text-brand-800 mb-1">Nombre *</label><input value={form.name} onChange={set('name')} required className="input-field"/></div>
          <div><label className="block text-sm font-medium text-brand-800 mb-1">Descripción</label><textarea value={form.description} onChange={set('description')} className="input-field min-h-[60px] resize-y"/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-sm font-medium text-brand-800 mb-1">Fecha límite</label><input type="date" value={form.due_date} onChange={set('due_date')} className="input-field"/></div>
            {isMilestone && <div><label className="block text-sm font-medium text-brand-800 mb-1">Regla de fecha</label><input value={form.due_date_rule} onChange={set('due_date_rule')} className="input-field" placeholder="Ej: 30 días después del inicio"/></div>}
            {!isMilestone && <>
              <div><label className="block text-sm font-medium text-brand-800 mb-1">Formato requerido</label><input value={form.required_format} onChange={set('required_format')} className="input-field" placeholder="PDF, Excel..."/></div>
              <div><label className="block text-sm font-medium text-brand-800 mb-1">Obligación vinculada</label>
                <select value={form.obligation_id} onChange={set('obligation_id')} className="input-field"><option value="">Ninguna</option>{obligations.map(o=><option key={o.id} value={o.id}>{o.code} - {o.description?.substring(0,40)}</option>)}</select></div>
              <div><label className="block text-sm font-medium text-brand-800 mb-1">Hito vinculado</label>
                <select value={form.milestone_id} onChange={set('milestone_id')} className="input-field"><option value="">Ninguno</option>{milestones.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}</select></div>
            </>}
            {isEdit && <div><label className="block text-sm font-medium text-brand-800 mb-1">Estado</label>
              <select value={form.status} onChange={set('status')} className="input-field">
                {Object.entries(isMilestone?M_STATUS:D_STATUS).map(([k,v])=><option key={k} value={k}>{v.label}</option>)}
              </select></div>}
          </div>
          {!isMilestone && <div><label className="block text-sm font-medium text-brand-800 mb-1">Criterios de aceptación</label><textarea value={form.acceptance_criteria} onChange={set('acceptance_criteria')} className="input-field min-h-[50px] resize-y" placeholder="Criterios que debe cumplir el entregable..."/></div>}
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary flex items-center gap-2">{saving?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>} {isEdit?'Guardar':'Crear'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ═══ Evidence Mini-Panel (inside obligations) ═══
export function EvidencePanel({ projectId, obligationId, documents }) {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ document_id:'', description:'' });

  const load = useCallback(async()=>{try{const{data}=await evidenceAPI.list(projectId,obligationId);setItems(data.data);}catch{}finally{setLoading(false);}}, [projectId,obligationId]);
  useEffect(()=>{load();},[load]);

  const handleAdd = async()=>{
    if(!form.document_id && !form.description) return;
    await evidenceAPI.create(projectId, obligationId, form);
    setForm({document_id:'',description:''}); setAdding(false); load();
  };
  const handleDelete = async(evId)=>{ await evidenceAPI.delete(projectId,obligationId,evId); load(); };

  return (
    <div className="mt-3 pt-3 border-t border-surface-100">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-surface-400 uppercase flex items-center gap-1"><Paperclip className="w-3 h-3"/> Evidencias ({items.length})</span>
        <button onClick={()=>setAdding(!adding)} className="text-[10px] text-brand-600 font-medium flex items-center gap-1"><Plus className="w-3 h-3"/> Agregar</button>
      </div>
      {loading ? <Loader2 className="w-3 h-3 animate-spin text-surface-300"/> :
        items.map(ev=>(
          <div key={ev.id} className="flex items-center gap-2 py-1 text-xs">
            {ev.file_name && <><FileText className="w-3 h-3 text-surface-400"/><span className="text-brand-800">{ev.file_name}</span></>}
            {ev.description && <span className="text-surface-500">{ev.description}</span>}
            <button onClick={()=>handleDelete(ev.id)} className="ml-auto w-4 h-4 rounded hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-2.5 h-2.5 text-red-400"/></button>
          </div>
        ))}
      {adding && (
        <div className="flex gap-2 mt-2">
          <select value={form.document_id} onChange={e=>setForm(f=>({...f,document_id:e.target.value}))} className="text-xs border rounded px-2 py-1 flex-1">
            <option value="">Documento...</option>{documents.map(d=><option key={d.id} value={d.id}>{d.file_name}</option>)}
          </select>
          <input value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="Nota" className="text-xs border rounded px-2 py-1 flex-1"/>
          <button onClick={handleAdd} className="w-6 h-6 rounded bg-brand-600 text-white flex items-center justify-center"><Save className="w-3 h-3"/></button>
          <button onClick={()=>setAdding(false)} className="w-6 h-6 rounded hover:bg-surface-100 flex items-center justify-center"><X className="w-3 h-3"/></button>
        </div>
      )}
    </div>
  );
}

// ═══ Main Panel ═══
export default function MilestonesPanel({ projectId, perms = {} }) {
  const [subTab, setSubTab] = useState('milestones');
  const [milestones, setMilestones] = useState([]);
  const [deliverables, setDeliverables] = useState([]);
  const [mStats, setMStats] = useState(null);
  const [dStats, setDStats] = useState(null);
  const [obligations, setObligations] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(null);
  const [toast, setToast] = useState(null);

  const load = useCallback(async()=>{
    try {
      const [mR,dR,msR,dsR] = await Promise.all([
        milestonesAPI.list(projectId), deliverablesAPI.list(projectId),
        milestonesAPI.stats(projectId), deliverablesAPI.stats(projectId),
      ]);
      setMilestones(mR.data.data); setDeliverables(dR.data.data);
      setMStats(msR.data.data); setDStats(dsR.data.data);
    } catch{} finally{setLoading(false);}
  }, [projectId]);

  useEffect(()=>{load();},[load]);
  useEffect(()=>{ obligationsAPI.list(projectId).then(({data})=>setObligations(data.data)).catch(()=>{}); }, [projectId]);

  const showToast = (msg)=>{ setToast(msg); setTimeout(()=>setToast(null),3000); };

  const handleDeleteM = async(id,name)=>{ if(!window.confirm(`¿Eliminar hito "${name}"?`))return; await milestonesAPI.delete(projectId,id); showToast('Hito eliminado'); load(); };
  const handleDeleteD = async(id,name)=>{ if(!window.confirm(`¿Eliminar "${name}"?`))return; await deliverablesAPI.delete(projectId,id); showToast('Entregable eliminado'); load(); };
  const handleQuickStatus = async(type,id,status)=>{
    if(type==='m') await milestonesAPI.update(projectId,id,{status}); else await deliverablesAPI.update(projectId,id,{status});
    load();
  };

  if(loading) return <div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin"/></div>;

  return (
    <div className="space-y-4">
      {toast && <div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up bg-emerald-600 text-white">{toast}</div>}

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-6 gap-3">
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-sm font-bold text-violet-600">{mStats?.total||0}</p><p className="text-[10px] text-surface-400 uppercase">Hitos</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-sm font-bold text-emerald-600">{mStats?.cumplido||0}</p><p className="text-[10px] text-surface-400 uppercase">Cumplidos</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className={`text-sm font-bold ${(mStats?.overdue||0)>0?'text-red-600 animate-pulse':'text-surface-400'}`}>{mStats?.overdue||0}</p><p className="text-[10px] text-surface-400 uppercase">Vencidos</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-sm font-bold text-brand-600">{dStats?.total||0}</p><p className="text-[10px] text-surface-400 uppercase">Entregables</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-sm font-bold text-emerald-600">{dStats?.aprobado||0}</p><p className="text-[10px] text-surface-400 uppercase">Aprobados</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className={`text-sm font-bold ${(dStats?.rechazado||0)>0?'text-red-600':'text-surface-400'}`}>{dStats?.rechazado||0}</p><p className="text-[10px] text-surface-400 uppercase">Rechazados</p></div>
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-surface-100">
        <button onClick={()=>setSubTab('milestones')} className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 ${subTab==='milestones'?'border-brand-600 text-brand-700':'border-transparent text-surface-400'}`}><Flag className="w-3.5 h-3.5"/> Hitos ({milestones.length})</button>
        <button onClick={()=>setSubTab('deliverables')} className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-medium border-b-2 ${subTab==='deliverables'?'border-brand-600 text-brand-700':'border-transparent text-surface-400'}`}><Package className="w-3.5 h-3.5"/> Entregables ({deliverables.length})</button>
      </div>

      {/* Milestones */}
      {subTab==='milestones' && (
        <div className="space-y-2">
          <div className="flex justify-end">{perms.canCreate && <button onClick={()=>setModal({type:'milestone'})} className="btn-primary text-sm flex items-center gap-1.5"><Plus className="w-4 h-4"/> Nuevo Hito</button>}</div>
          {milestones.length===0 ? <p className="text-center py-8 text-surface-400 text-sm">Sin hitos registrados</p> :
            milestones.map(m=>{ const st=M_STATUS[m.status]||M_STATUS.pendiente; const al=ALERT_S[m.alert_level]||''; return (
              <div key={m.id} className={`group bg-white rounded-lg border border-surface-100 p-4 hover:shadow-card transition-all ${al}`}>
                <div className="flex items-start gap-3">
                  <Flag className={`w-5 h-5 mt-0.5 ${st.text} flex-shrink-0`}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1"><span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span></div>
                    <p className="text-sm font-medium text-brand-900">{m.name}</p>
                    {m.description && <p className="text-xs text-surface-400 mt-1">{m.description}</p>}
                    <div className="flex items-center gap-3 mt-2">
                      {m.due_date && <span className={`text-xs flex items-center gap-1 ${m.alert_level==='overdue'?'text-red-600 font-semibold':'text-surface-400'}`}><Clock className="w-3 h-3"/>{fmtDate(m.due_date)} {m.days_remaining!=null&&`(${m.days_remaining>=0?m.days_remaining+'d':Math.abs(m.days_remaining)+'d vencido'})`}</span>}
                      <span className="text-xs text-surface-300">{m.deliverable_count||0} entregables</span>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {m.status==='pendiente'&&<button onClick={()=>handleQuickStatus('m',m.id,'cumplido')} className="w-7 h-7 rounded hover:bg-emerald-50 flex items-center justify-center" title="Cumplido"><CheckCircle2 className="w-4 h-4 text-emerald-400"/></button>}
                    <button onClick={()=>setModal({type:'milestone',item:m})} className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center opacity-0 group-hover:opacity-100"><Edit2 className="w-3.5 h-3.5 text-surface-400"/></button>
                    <button onClick={()=>handleDeleteM(m.id,m.name)} className="w-7 h-7 rounded hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5 text-red-400"/></button>
                  </div>
                </div>
              </div>
          );})}
        </div>
      )}

      {/* Deliverables */}
      {subTab==='deliverables' && (
        <div className="space-y-2">
          <div className="flex justify-end">{perms.canCreate && <button onClick={()=>setModal({type:'deliverable'})} className="btn-primary text-sm flex items-center gap-1.5"><Plus className="w-4 h-4"/> Nuevo Entregable</button>}</div>
          {deliverables.length===0 ? <p className="text-center py-8 text-surface-400 text-sm">Sin entregables registrados</p> :
            deliverables.map(d=>{ const st=D_STATUS[d.status]||D_STATUS.pendiente; const al=ALERT_S[d.alert_level]||''; return (
              <div key={d.id} className={`group bg-white rounded-lg border border-surface-100 p-4 hover:shadow-card transition-all ${al}`}>
                <div className="flex items-start gap-3">
                  <Package className={`w-5 h-5 mt-0.5 ${st.text} flex-shrink-0`}/>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                      {d.required_format && <span className="text-[10px] px-1.5 py-0.5 bg-surface-100 text-surface-500 rounded">{d.required_format}</span>}
                    </div>
                    <p className="text-sm font-medium text-brand-900">{d.name}</p>
                    {d.description && <p className="text-xs text-surface-400 mt-1">{d.description}</p>}
                    <div className="flex items-center gap-3 mt-2 flex-wrap">
                      {d.due_date && <span className={`text-xs flex items-center gap-1 ${d.alert_level==='overdue'?'text-red-600 font-semibold':'text-surface-400'}`}><Clock className="w-3 h-3"/>{fmtDate(d.due_date)}</span>}
                      {d.obligation_code && <span className="text-xs text-surface-400 flex items-center gap-1"><Link2 className="w-3 h-3"/>{d.obligation_code}</span>}
                      {d.milestone_name && <span className="text-xs text-violet-500 flex items-center gap-1"><Flag className="w-3 h-3"/>{d.milestone_name}</span>}
                    </div>
                    {d.acceptance_criteria && <div className="mt-2 p-2 bg-surface-50 rounded text-xs text-surface-500"><strong className="text-surface-600">Criterios:</strong> {d.acceptance_criteria}</div>}
                  </div>
                  <div className="flex items-center gap-1">
                    {d.status==='pendiente'&&<button onClick={()=>handleQuickStatus('d',d.id,'en_elaboracion')} className="w-7 h-7 rounded hover:bg-amber-50 flex items-center justify-center" title="Iniciar"><Clock className="w-4 h-4 text-amber-400"/></button>}
                    {d.status==='en_elaboracion'&&<button onClick={()=>handleQuickStatus('d',d.id,'entregado')} className="w-7 h-7 rounded hover:bg-cyan-50 flex items-center justify-center" title="Entregar"><Package className="w-4 h-4 text-cyan-500"/></button>}
                    {d.status==='entregado'&&<button onClick={()=>handleQuickStatus('d',d.id,'aprobado')} className="w-7 h-7 rounded hover:bg-emerald-50 flex items-center justify-center" title="Aprobar"><CheckCircle2 className="w-4 h-4 text-emerald-400"/></button>}
                    <button onClick={()=>setModal({type:'deliverable',item:d})} className="w-7 h-7 rounded hover:bg-surface-100 flex items-center justify-center opacity-0 group-hover:opacity-100"><Edit2 className="w-3.5 h-3.5 text-surface-400"/></button>
                    <button onClick={()=>handleDeleteD(d.id,d.name)} className="w-7 h-7 rounded hover:bg-red-50 flex items-center justify-center opacity-0 group-hover:opacity-100"><Trash2 className="w-3.5 h-3.5 text-red-400"/></button>
                  </div>
                </div>
              </div>
          );})}
        </div>
      )}

      {/* Modal */}
      {modal && <ItemModal type={modal.type} item={modal.item||null} projectId={projectId} obligations={obligations} milestones={milestones} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);showToast(modal.item?'Actualizado':'Creado');load();}} />}
    </div>
  );
}
