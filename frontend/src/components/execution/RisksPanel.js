import React, { useState, useEffect, useCallback } from 'react';
import { risksAPI } from '../../services/api';
import { Plus, Edit2, Trash2, X, Save, Loader2, ShieldAlert, AlertTriangle } from 'lucide-react';

const CAT={tecnico:'Técnico',financiero:'Financiero',legal:'Legal',ambiental:'Ambiental',social:'Social',operativo:'Operativo',externo:'Externo'};
const PROB={muy_baja:'Muy baja',baja:'Baja',media:'Media',alta:'Alta',muy_alta:'Muy alta'};
const IMP={muy_bajo:'Muy bajo',bajo:'Bajo',medio:'Medio',alto:'Alto',muy_alto:'Muy alto'};
const RS={identificado:{l:'Identificado',bg:'bg-blue-100',t:'text-blue-700'},mitigando:{l:'Mitigando',bg:'bg-amber-100',t:'text-amber-700'},materializado:{l:'Materializado',bg:'bg-red-100',t:'text-red-700'},cerrado:{l:'Cerrado',bg:'bg-slate-100',t:'text-slate-600'}};
const LEVEL_C={critico:'bg-red-600 text-white',alto:'bg-orange-500 text-white',medio:'bg-amber-400 text-amber-900',bajo:'bg-green-200 text-green-800'};

function RiskModal({item,projectId,onClose,onSaved}){
  const isEdit=Boolean(item?.id);
  const [form,setForm]=useState({description:item?.description||'',category:item?.category||'operativo',probability:item?.probability||'media',impact:item?.impact||'medio',mitigation_plan:item?.mitigation_plan||'',contingency_plan:item?.contingency_plan||'',responsible:item?.responsible||'',trigger_event:item?.trigger_event||'',status:item?.status||'identificado'});
  const [saving,setSaving]=useState(false);
  const set=f=>e=>setForm(d=>({...d,[f]:e.target.value}));
  const handle=async e=>{e.preventDefault();setSaving(true);try{if(isEdit)await risksAPI.update(projectId,item.id,form);else await risksAPI.create(projectId,form);onSaved();}catch(err){alert(err.response?.data?.error||'Error');}finally{setSaving(false);}};
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto m-4 animate-slide-up" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between p-5 border-b border-surface-100">
          <h3 className="font-display font-bold text-brand-900">{isEdit?'Editar':'Nuevo'} Riesgo</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-surface-400"/></button>
        </div>
        <form onSubmit={handle} className="p-5 space-y-3">
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Descripción del riesgo *</label><textarea value={form.description} onChange={set('description')} required className="input-field text-sm min-h-[60px] resize-y"/></div>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Categoría</label><select value={form.category} onChange={set('category')} className="input-field text-sm">{Object.entries(CAT).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Probabilidad</label><select value={form.probability} onChange={set('probability')} className="input-field text-sm">{Object.entries(PROB).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Impacto</label><select value={form.impact} onChange={set('impact')} className="input-field text-sm">{Object.entries(IMP).map(([k,v])=><option key={k} value={k}>{v}</option>)}</select></div>
          </div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Plan de mitigación</label><textarea value={form.mitigation_plan} onChange={set('mitigation_plan')} className="input-field text-sm min-h-[40px] resize-y"/></div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Plan de contingencia</label><textarea value={form.contingency_plan} onChange={set('contingency_plan')} className="input-field text-sm min-h-[40px] resize-y"/></div>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="block text-xs font-medium text-brand-800 mb-1">Responsable</label><input value={form.responsible} onChange={set('responsible')} className="input-field text-sm"/></div>
            {isEdit&&<div><label className="block text-xs font-medium text-brand-800 mb-1">Estado</label><select value={form.status} onChange={set('status')} className="input-field text-sm">{Object.entries(RS).map(([k,v])=><option key={k} value={k}>{v.l}</option>)}</select></div>}
          </div>
          <div><label className="block text-xs font-medium text-brand-800 mb-1">Evento detonante</label><input value={form.trigger_event} onChange={set('trigger_event')} className="input-field text-sm"/></div>
          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="btn-ghost text-sm">Cancelar</button>
            <button type="submit" disabled={saving} className="btn-primary text-sm flex items-center gap-2">{saving?<Loader2 className="w-4 h-4 animate-spin"/>:<Save className="w-4 h-4"/>}{isEdit?'Guardar':'Registrar'}</button>
          </div>
        </form>
      </div>
    </div>
  );
}

// Mini heatmap
function RiskMatrix({matrixData}){
  const probLabels=['muy_alta','alta','media','baja','muy_baja'];
  const impLabels=['muy_bajo','bajo','medio','alto','muy_alto'];
  const probNames={'muy_alta':'5','alta':'4','media':'3','baja':'2','muy_baja':'1'};
  const impNames={'muy_bajo':'1','bajo':'2','medio':'3','alto':'4','muy_alto':'5'};
  const getCount=(p,i)=>{const m=matrixData.find(d=>d.probability===p&&d.impact===i);return m?m.count:0;};
  const getColor=(p,i)=>{const pv={'muy_baja':1,'baja':2,'media':3,'alta':4,'muy_alta':5};const iv={'muy_bajo':1,'bajo':2,'medio':3,'alto':4,'muy_alto':5};const s=pv[p]*iv[i];if(s>=15)return'bg-red-600 text-white';if(s>=8)return'bg-orange-400 text-white';if(s>=4)return'bg-amber-300 text-amber-900';return'bg-green-200 text-green-800';};
  return(
    <div className="overflow-x-auto">
      <table className="text-[10px]"><thead><tr><th className="p-1 text-surface-400">P\I</th>{impLabels.map(i=><th key={i} className="p-1 text-center text-surface-400 w-8">{impNames[i]}</th>)}</tr></thead>
      <tbody>{probLabels.map(p=><tr key={p}><td className="p-1 text-right text-surface-400 pr-2">{probNames[p]}</td>{impLabels.map(i=>{const c=getCount(p,i);return<td key={i} className="p-0.5"><div className={`w-7 h-7 rounded flex items-center justify-center font-bold ${c>0?getColor(p,i):'bg-surface-50 text-surface-300'}`}>{c||''}</div></td>;})}</tr>)}</tbody></table>
    </div>
  );
}

export default function RisksPanel({projectId,perms={}}){
  const [items,setItems]=useState([]);const [stats,setStats]=useState(null);const [matrix,setMatrix]=useState([]);const [loading,setLoading]=useState(true);const [modal,setModal]=useState(null);const [toast,setToast]=useState(null);
  const load=useCallback(async()=>{try{const [lr,sr,mr]=await Promise.all([risksAPI.list(projectId),risksAPI.stats(projectId),risksAPI.matrix(projectId)]);setItems(lr.data.data);setStats(sr.data.data);setMatrix(mr.data.data);}catch{}finally{setLoading(false);};},[projectId]);
  useEffect(()=>{setLoading(true);load();},[load]);
  const showToast=m=>{setToast(m);setTimeout(()=>setToast(null),2500);};
  const del=async(id)=>{if(!window.confirm('¿Eliminar riesgo?'))return;await risksAPI.delete(projectId,id);showToast('Eliminado');load();};

  if(loading)return<div className="flex justify-center py-12"><div className="w-5 h-5 border-2 border-brand-200 border-t-brand-600 rounded-full animate-spin"/></div>;

  return(
    <div className="space-y-4">
      {toast&&<div className="fixed top-4 right-4 z-50 px-4 py-3 rounded-lg shadow-lg text-sm font-medium animate-slide-up bg-emerald-600 text-white">{toast}</div>}
      {stats&&<div className="grid grid-cols-1 sm:grid-cols-6 gap-3">
        <div className="sm:col-span-2 p-3 bg-white border border-surface-100 rounded-lg">
          <p className="text-xs font-semibold text-brand-800 mb-2">Matriz P × I</p>
          <RiskMatrix matrixData={matrix}/>
        </div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className={`text-sm font-bold ${(stats.criticos||0)>0?'text-red-600 animate-pulse':'text-surface-400'}`}>{stats.criticos||0}</p><p className="text-[10px] text-surface-400">Críticos</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className={`text-sm font-bold ${(stats.altos||0)>0?'text-orange-600':'text-surface-400'}`}>{stats.altos||0}</p><p className="text-[10px] text-surface-400">Altos</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-sm font-bold text-amber-600">{stats.medios||0}</p><p className="text-[10px] text-surface-400">Medios</p></div>
        <div className="p-3 bg-surface-50 rounded-lg"><p className="text-sm font-bold text-green-600">{stats.bajos||0}</p><p className="text-[10px] text-surface-400">Bajos</p></div>
      </div>}
      <div className="flex justify-between items-center">
        <span className="text-xs text-surface-400">{items.length} riesgo{items.length!==1?'s':''}</span>
        {(perms.canCreate||perms.canAddEvidence)&&<button onClick={()=>setModal({})} className="btn-primary text-sm flex items-center gap-1.5"><Plus className="w-4 h-4"/> Nuevo Riesgo</button>}
      </div>
      {items.length===0?<p className="text-center py-8 text-surface-400 text-sm">Sin riesgos registrados</p>:
        <div className="space-y-2">{items.map(r=>{const s=RS[r.status]||RS.identificado;const lc=LEVEL_C[r.risk_level]||'bg-surface-100';return(
          <div key={r.id} className="group bg-white border border-surface-100 rounded-lg p-4 hover:border-surface-200 transition-colors">
            <div className="flex items-start justify-between gap-3">
              <div className="flex-1">
                <div className="flex items-center gap-2 mb-1">
                  <span className="font-mono text-xs text-brand-500 font-semibold">{r.risk_code}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${s.bg} ${s.t}`}>{s.l}</span>
                  <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${lc}`}>{r.risk_level?.toUpperCase()} ({r.risk_score})</span>
                  <span className="text-[10px] text-surface-400">{CAT[r.category]||r.category}</span>
                </div>
                <p className="text-sm text-brand-900">{r.description}</p>
                <div className="flex gap-4 mt-1 text-[10px] text-surface-400">
                  <span>P: {PROB[r.probability]}</span>
                  <span>I: {IMP[r.impact]}</span>
                  {r.responsible&&<span>Resp: {r.responsible}</span>}
                </div>
                {r.mitigation_plan&&<p className="text-xs text-surface-400 mt-1 italic line-clamp-1">Mitigación: {r.mitigation_plan}</p>}
              </div>
              <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                {(perms.canEdit||perms.canAddEvidence)&&<button onClick={()=>setModal(r)} className="w-6 h-6 rounded hover:bg-surface-100 flex items-center justify-center"><Edit2 className="w-3 h-3 text-surface-400"/></button>}
                {perms.canDelete&&<button onClick={()=>del(r.id)} className="w-6 h-6 rounded hover:bg-red-50 flex items-center justify-center"><Trash2 className="w-3 h-3 text-red-400"/></button>}
              </div>
            </div>
          </div>);
        })}</div>}
      {modal&&<RiskModal item={modal.id?modal:null} projectId={projectId} onClose={()=>setModal(null)} onSaved={()=>{setModal(null);showToast(modal.id?'Actualizado':'Registrado');load();}}/>}
    </div>
  );
}
