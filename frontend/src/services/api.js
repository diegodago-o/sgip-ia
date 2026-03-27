import axios from 'axios';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:4000/api';

const api = axios.create({
  baseURL: API_URL,
  headers: { 'Content-Type': 'application/json' },
});

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('sgip_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (r) => r,
  (error) => {
    if (error.response?.status === 401 && !error.config?.url?.includes('/auth/login')) {
      localStorage.removeItem('sgip_token');
      localStorage.removeItem('sgip_user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

export const authAPI = {
  login: (email, password) => api.post('/auth/login', { email, password }),
  me: () => api.get('/auth/me'),
};

export const projectsAPI = {
  summary: () => api.get('/projects/summary'),
  list: (params) => api.get('/projects', { params }),
  get: (id) => api.get(`/projects/${id}`),
  create: (data) => api.post('/projects', data),
  update: (id, data) => api.put(`/projects/${id}`, data),
  delete: (id) => api.delete(`/projects/${id}`),
  directors: () => api.get('/projects/options/directors'),
  statusInfo: (id) => api.get(`/projects/${id}/status-info`),
  changeStatus: (id, data) => api.post(`/projects/${id}/change-status`, data),
};

export const documentsAPI = {
  list: (projectId, params) => api.get(`/documents/${projectId}`, { params }),
  upload: (projectId, formData) => api.post(`/documents/${projectId}/upload`, formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
  }),
  update: (projectId, docId, data) => api.put(`/documents/${projectId}/${docId}`, data),
  download: (projectId, docId) => `${API_URL}/documents/${projectId}/${docId}/download`,
  delete: (projectId, docId) => api.delete(`/documents/${projectId}/${docId}`),
};

export const obligationsAPI = {
  list: (projectId, params) => api.get(`/obligations/${projectId}`, { params }),
  stats: (projectId) => api.get(`/obligations/${projectId}/stats`),
  create: (projectId, data) => api.post(`/obligations/${projectId}`, data),
  update: (projectId, id, data) => api.put(`/obligations/${projectId}/${id}`, data),
  delete: (projectId, id) => api.delete(`/obligations/${projectId}/${id}`),
  bulk: (projectId, data) => api.patch(`/obligations/${projectId}/bulk`, data),
};

export const policiesAPI = {
  list: (projectId) => api.get(`/policies/${projectId}`),
  stats: (projectId) => api.get(`/policies/${projectId}/stats`),
  create: (projectId, data) => api.post(`/policies/${projectId}`, data),
  update: (projectId, id, data) => api.put(`/policies/${projectId}/${id}`, data),
  delete: (projectId, id) => api.delete(`/policies/${projectId}/${id}`),
};

export const budgetAPI = {
  summary: (projectId) => api.get(`/budget/${projectId}/summary`),
  monthly: (projectId) => api.get(`/budget/${projectId}/monthly`),
  financialSummary: (projectId) => api.get(`/budget/${projectId}/financial-summary`),
  init: (projectId) => api.post(`/budget/${projectId}/init`),
  syncValue: (projectId) => api.post(`/budget/${projectId}/sync-value`),
  // Income
  incomeList: (projectId) => api.get(`/budget/${projectId}/income`),
  incomeAdd: (projectId, data) => api.post(`/budget/${projectId}/income`, data),
  incomeUpdate: (projectId, id, data) => api.put(`/budget/${projectId}/income/${id}`, data),
  incomeDelete: (projectId, id) => api.delete(`/budget/${projectId}/income/${id}`),
  // Income Schedule
  incomeScheduleList: (projectId) => api.get(`/budget/${projectId}/income-schedule`),
  incomeScheduleAdd: (projectId, data) => api.post(`/budget/${projectId}/income-schedule`, data),
  incomeScheduleUpdate: (projectId, id, data) => api.put(`/budget/${projectId}/income-schedule/${id}`, data),
  incomeScheduleDelete: (projectId, id) => api.delete(`/budget/${projectId}/income-schedule/${id}`),
  incomeScheduleGenerate: (projectId, data) => api.post(`/budget/${projectId}/income-schedule/generate`, data),
  // Payroll
  payrollList: (projectId) => api.get(`/budget/${projectId}/payroll`),
  payrollAdd: (projectId, data) => api.post(`/budget/${projectId}/payroll`, data),
  payrollUpdate: (projectId, id, data) => api.put(`/budget/${projectId}/payroll/${id}`, data),
  payrollDelete: (projectId, id) => api.delete(`/budget/${projectId}/payroll/${id}`),
  // Contractors
  contractorsList: (projectId) => api.get(`/budget/${projectId}/contractors`),
  contractorsAdd: (projectId, data) => api.post(`/budget/${projectId}/contractors`, data),
  contractorsUpdate: (projectId, id, data) => api.put(`/budget/${projectId}/contractors/${id}`, data),
  contractorsDelete: (projectId, id) => api.delete(`/budget/${projectId}/contractors/${id}`),
  // Expenses
  expensesList: (projectId, category) => api.get(`/budget/${projectId}/expenses`, { params: { category } }),
  expensesAdd: (projectId, data) => api.post(`/budget/${projectId}/expenses`, data),
  expensesUpdate: (projectId, id, data) => api.put(`/budget/${projectId}/expenses/${id}`, data),
  expensesDelete: (projectId, id) => api.delete(`/budget/${projectId}/expenses/${id}`),
  // PUC
  pucList: (projectId) => api.get(`/budget/${projectId}/puc`),
  pucInit: (projectId) => api.post(`/budget/${projectId}/puc/init`),
  pucAdd: (projectId, data) => api.post(`/budget/${projectId}/puc`, data),
  pucUpdate: (projectId, id, data) => api.put(`/budget/${projectId}/puc/${id}`, data),
  pucDelete: (projectId, id) => api.delete(`/budget/${projectId}/puc/${id}`),
  // Deductions
  deductionsList: (projectId) => api.get(`/budget/${projectId}/deductions`),
  deductionsInit: (projectId) => api.post(`/budget/${projectId}/deductions/init`),
  deductionsAdd: (projectId, data) => api.post(`/budget/${projectId}/deductions`, data),
  deductionsUpdate: (projectId, id, data) => api.put(`/budget/${projectId}/deductions/${id}`, data),
  deductionsDelete: (projectId, id) => api.delete(`/budget/${projectId}/deductions/${id}`),
  // Tracking
  tracking: (projectId) => api.get(`/budget/${projectId}/tracking`),
  trackingMonth: (projectId, mes) => api.get(`/budget/${projectId}/tracking/${mes}`),
  trackingSave: (projectId, mes, data) => api.post(`/budget/${projectId}/tracking/${mes}`, data),
  trackingAddExtra: (projectId, mes, data) => api.post(`/budget/${projectId}/tracking/${mes}/extra`, data),
  trackingDeleteExtra: (projectId, id) => api.delete(`/budget/${projectId}/tracking/extra/${id}`),
};

export const teamAPI = {
  list: (projectId) => api.get(`/team/${projectId}`),
  stats: (projectId) => api.get(`/team/${projectId}/stats`),
  create: (projectId, data) => api.post(`/team/${projectId}`, data),
  update: (projectId, id, data) => api.put(`/team/${projectId}/${id}`, data),
  delete: (projectId, id) => api.delete(`/team/${projectId}/${id}`),
};

export const milestonesAPI = {
  list: (projectId) => api.get(`/pm/${projectId}/milestones`),
  stats: (projectId) => api.get(`/pm/${projectId}/milestones/stats`),
  create: (projectId, data) => api.post(`/pm/${projectId}/milestones`, data),
  update: (projectId, id, data) => api.put(`/pm/${projectId}/milestones/${id}`, data),
  delete: (projectId, id) => api.delete(`/pm/${projectId}/milestones/${id}`),
};

export const deliverablesAPI = {
  list: (projectId) => api.get(`/pm/${projectId}/deliverables`),
  stats: (projectId) => api.get(`/pm/${projectId}/deliverables/stats`),
  create: (projectId, data) => api.post(`/pm/${projectId}/deliverables`, data),
  update: (projectId, id, data) => api.put(`/pm/${projectId}/deliverables/${id}`, data),
  delete: (projectId, id) => api.delete(`/pm/${projectId}/deliverables/${id}`),
};

export const evidenceAPI = {
  list: (projectId, oblId) => api.get(`/pm/${projectId}/obligations/${oblId}/evidence`),
  create: (projectId, oblId, data) => api.post(`/pm/${projectId}/obligations/${oblId}/evidence`, data),
  delete: (projectId, oblId, evId) => api.delete(`/pm/${projectId}/obligations/${oblId}/evidence/${evId}`),
};

// ═══ MODULE 2: Execution APIs ═══

export const scheduleAPI = {
  list: (pid) => api.get(`/exec/${pid}/schedule`),
  stats: (pid) => api.get(`/exec/${pid}/schedule/stats`),
  create: (pid, data) => api.post(`/exec/${pid}/schedule`, data),
  update: (pid, id, data) => api.put(`/exec/${pid}/schedule/${id}`, data),
  delete: (pid, id) => api.delete(`/exec/${pid}/schedule/${id}`),
  setBaseline: (pid) => api.post(`/exec/${pid}/schedule/set-baseline`),
  clearBaseline: (pid) => api.post(`/exec/${pid}/schedule/clear-baseline`),
  regenerateWBS: (pid) => api.post(`/exec/${pid}/schedule/regenerate-wbs`),
  reorder: (pid, items) => api.put(`/exec/${pid}/schedule/reorder`, { items }),
};

export const progressAPI = {
  list: (pid) => api.get(`/exec/${pid}/progress`),
  summary: (pid) => api.get(`/exec/${pid}/progress/summary`),
  create: (pid, data) => api.post(`/exec/${pid}/progress`, data),
  update: (pid, id, data) => api.put(`/exec/${pid}/progress/${id}`, data),
  delete: (pid, id) => api.delete(`/exec/${pid}/progress/${id}`),
};

export const paymentsAPI = {
  list: (pid) => api.get(`/exec/${pid}/payments`),
  summary: (pid) => api.get(`/exec/${pid}/payments/summary`),
  create: (pid, data) => api.post(`/exec/${pid}/payments`, data),
  update: (pid, id, data) => api.put(`/exec/${pid}/payments/${id}`, data),
  delete: (pid, id) => api.delete(`/exec/${pid}/payments/${id}`),
};

export const minutesAPI = {
  list: (pid) => api.get(`/exec/${pid}/minutes`),
  create: (pid, data) => api.post(`/exec/${pid}/minutes`, data),
  update: (pid, id, data) => api.put(`/exec/${pid}/minutes/${id}`, data),
  delete: (pid, id) => api.delete(`/exec/${pid}/minutes/${id}`),
  autoGenerate: (pid, formData) => api.post(`/exec/${pid}/minutes/auto-generate`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  downloadGenerated: (pid, filename) => api.get(`/exec/${pid}/minutes/download/${filename}`, { responseType: 'blob' }),
};

export const changesAPI = {
  list: (pid) => api.get(`/exec/${pid}/changes`),
  summary: (pid) => api.get(`/exec/${pid}/changes/summary`),
  create: (pid, data) => api.post(`/exec/${pid}/changes`, data),
  update: (pid, id, data) => api.put(`/exec/${pid}/changes/${id}`, data),
  delete: (pid, id) => api.delete(`/exec/${pid}/changes/${id}`),
};

export const risksAPI = {
  list: (pid) => api.get(`/exec/${pid}/risks`),
  stats: (pid) => api.get(`/exec/${pid}/risks/stats`),
  matrix: (pid) => api.get(`/exec/${pid}/risks/matrix`),
  create: (pid, data) => api.post(`/exec/${pid}/risks`, data),
  update: (pid, id, data) => api.put(`/exec/${pid}/risks/${id}`, data),
  delete: (pid, id) => api.delete(`/exec/${pid}/risks/${id}`),
};

// ═══ MODULE 3: Closure APIs ═══

export const closureAPI = {
  list: (pid) => api.get(`/close/${pid}/closure`),
  stats: (pid) => api.get(`/close/${pid}/closure/stats`),
  initTemplate: (pid) => api.post(`/close/${pid}/closure/init-template`),
  create: (pid, data) => api.post(`/close/${pid}/closure`, data),
  toggle: (pid, id) => api.put(`/close/${pid}/closure/${id}/toggle`),
  update: (pid, id, data) => api.put(`/close/${pid}/closure/${id}`, data),
  delete: (pid, id) => api.delete(`/close/${pid}/closure/${id}`),
};

export const liquidationAPI = {
  get: (pid) => api.get(`/close/${pid}/liquidation`),
  save: (pid, data) => api.post(`/close/${pid}/liquidation`, data),
};

export const lessonsAPI = {
  list: (pid) => api.get(`/close/${pid}/lessons`),
  stats: (pid) => api.get(`/close/${pid}/lessons/stats`),
  create: (pid, data) => api.post(`/close/${pid}/lessons`, data),
  update: (pid, id, data) => api.put(`/close/${pid}/lessons/${id}`, data),
  delete: (pid, id) => api.delete(`/close/${pid}/lessons/${id}`),
};

// ═══ AI ENGINE ═══

export const aiAPI = {
  settings: () => api.get('/ai/settings'),
  extract: (formData) => api.post('/ai/extract', formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  extractText: (data) => api.post('/ai/extract', data),
  generate: (pid, data) => api.post(`/ai/${pid}/generate`, data),
  analyze: (pid, data) => api.post(`/ai/${pid}/analyze`, data || {}),
  chat: (pid, data) => api.post(`/ai/${pid}/chat`, data),
  // Extract project data from contract document
  extractProject: (formData) => api.post('/ai/extract-project', formData, {
    headers: { 'Content-Type': 'multipart/form-data' },
    timeout: 90000,
  }),
  // Auto-populate
  autoAnalyze: (pid, data) => api.post(`/ai-populate/${pid}/analyze`, data, { timeout: 120000 }),
  autoApply: (pid, data) => api.post(`/ai-populate/${pid}/apply`, data),
};

// ═══ ADMIN ═══

export const adminAPI = {
  roles: () => api.get('/admin/roles'),
  listUsers: () => api.get('/admin/users'),
  createUser: (data) => api.post('/admin/users', data),
  updateUser: (id, data) => api.put(`/admin/users/${id}`, data),
  toggleUser: (id) => api.patch(`/admin/users/${id}/toggle`),
  deleteUser: (id) => api.delete(`/admin/users/${id}`),
  assignableUsers: () => api.get('/admin/users/assignable'),
  getUserAssignments: (uid) => api.get(`/admin/users/${uid}/assignments`),
  getAssignments: (pid) => api.get(`/admin/projects/${pid}/assignments`),
  assignUser: (pid, data) => api.post(`/admin/projects/${pid}/assignments`, data),
  removeAssignment: (pid, uid) => api.delete(`/admin/projects/${pid}/assignments/${uid}`),
};

// ═══ EXPORTS ═══

export const exportsAPI = {
  minuteToWord: (pid, mid) => api.get(`/exports/${pid}/minutes/${mid}/export-word`, { responseType: 'blob' }),
  aiDocToWord: (pid, data) => api.post(`/exports/${pid}/export-word`, data, { responseType: 'blob' }),
  budgetToExcel: (pid) => api.get(`/exports/${pid}/budget/export-excel`, { responseType: 'blob' }),
  liquidationToWord: (pid) => api.get(`/exports/${pid}/liquidation/export-word`, { responseType: 'blob' }),
};

// ═══ COMMITTEE ═══
export const committeeAPI = {
  dashboard: (pid, type, dateFrom, dateTo) => api.get(`/committee/${pid}/dashboard`, { params: { type, date_from: dateFrom, date_to: dateTo } }),
  history: (pid) => api.get(`/committee/${pid}/history`),
  updateCommitment: (pid, minuteId, index, data) => api.patch(`/committee/${pid}/commitments/${minuteId}/${index}`, data),
};

// ═══ COMMITTEE COMMITMENTS (compromisos nativos de comité) ═══
export const committeeCommitmentsAPI = {
  list:               (pid, params) => api.get(`/committee/${pid}/commitments`, { params }),
  pendingForSession:  (pid)         => api.get(`/committee/${pid}/commitments/pending-for-session`),
  create:             (pid, data)   => api.post(`/committee/${pid}/commitments`, data),
  update:             (pid, id, data) => api.put(`/committee/${pid}/commitments/${id}`, data),
  remove:             (pid, id)     => api.delete(`/committee/${pid}/commitments/${id}`),
};

// ═══ BI DASHBOARD ═══
export const dashboardAPI = {
  bi: () => api.get('/dashboard/bi'),
};

// ═══ INDICATORS & KPIs ═══
export const indicatorsAPI = {
  panel: (projectId) => api.get(`/indicators/${projectId}/panel`),
};

// ═══ DIGITAL SIGNATURES ═══
// signaturesAPI uses the authenticated `api` instance (Bearer token)
export const signaturesAPI = {
  // Get active signature request + signers for a minute
  get: (pid, mid) =>
    api.get(`/exec/${pid}/minutes/${mid}/firma`),
  // Create a new signature request
  create: (pid, mid, data) =>
    api.post(`/exec/${pid}/minutes/${mid}/firma`, data),
  // Cancel active request
  cancel: (pid, mid) =>
    api.delete(`/exec/${pid}/minutes/${mid}/firma`),
  // Download sealed PDF certificate (completed process only)
  certificate: (pid, mid) =>
    api.get(`/exec/${pid}/minutes/${mid}/firma/certificate`, { responseType: 'arraybuffer' }),
  // Batch-load statuses for multiple minutes
  batchStatus: async (pid, minuteIds) => {
    const results = await Promise.allSettled(
      minuteIds.map(mid =>
        api.get(`/exec/${pid}/minutes/${mid}/firma`)
          .then(r => ({ mid, data: r.data.data }))   // extract inner .data (null when no request)
          .catch(() => ({ mid, data: null }))
      )
    );
    const map = {};
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value.data !== null && r.value.data !== undefined) {
        map[r.value.mid] = r.value.data;
      }
    });
    return map;
  },
};

// ═══ CORRESPONDENCE DIGITAL SIGNATURES ═══
export const corrSignaturesAPI = {
  // Get active signature request + signers for a correspondence
  getStatus: (pid, cid) =>
    api.get(`/exec/${pid}/correspondence/${cid}/firma`),
  // Create a new signature request with positioned signers
  create: (pid, cid, data) =>
    api.post(`/exec/${pid}/correspondence/${cid}/firma`, data),
  // Cancel active request
  cancel: (pid, cid) =>
    api.delete(`/exec/${pid}/correspondence/${cid}/firma`),
  // Download sealed PDF certificate (completed process only)
  certificate: (pid, cid) =>
    api.get(`/exec/${pid}/correspondence/${cid}/firma/certificate`, { responseType: 'arraybuffer' }),
  // Batch-load statuses for multiple correspondence items
  batchStatus: async (pid, corrIds) => {
    const results = await Promise.allSettled(
      corrIds.map(cid =>
        api.get(`/exec/${pid}/correspondence/${cid}/firma`)
          .then(r => ({ cid, data: r.data.data }))
          .catch(() => ({ cid, data: null }))
      )
    );
    const map = {};
    results.forEach(r => {
      if (r.status === 'fulfilled' && r.value.data !== null && r.value.data !== undefined) {
        map[r.value.cid] = r.value.data;
      }
    });
    return map;
  },
};

// ═══ FREE SIGNATURES ═══
export const freeSignaturesAPI = {
  list:    (pid)      => api.get(`/exec/${pid}/firma-libre`),
  get:     (pid, id)  => api.get(`/exec/${pid}/firma-libre/${id}`),
  create:  (pid, fd)  => api.post(`/exec/${pid}/firma-libre`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }),
  cancel:  (pid, id)  => api.delete(`/exec/${pid}/firma-libre/${id}`),
  eliminate: (pid, id) => api.delete(`/exec/${pid}/firma-libre/${id}/eliminar`),
  downloadPdf: (pid, id) =>
    api.get(`/exec/${pid}/firma-libre/${id}/pdf`, { responseType: 'arraybuffer' }),
  // Public (no auth)
  getByToken:    token => api.get(`/firma/libre/${token}`),
  pdfByToken:    token => `${api.defaults.baseURL}/firma/libre/${token}/pdf`,
  sign:          (token, data) => api.post(`/firma/libre/${token}/firmar`, data),
  reject:        (token, data) => api.post(`/firma/libre/${token}/rechazar`, data),
};

// ═══ SHAREPOINT CONNECTIONS (admin CRUD) ═══
export const sharepointConnectionsAPI = {
  list:       ()        => api.get('/sharepoint-connections'),
  create:     (data)    => api.post('/sharepoint-connections', data),
  update:     (id, data)=> api.put(`/sharepoint-connections/${id}`, data),
  remove:     (id)      => api.delete(`/sharepoint-connections/${id}`),
  test:       (id)      => api.post(`/sharepoint-connections/${id}/test`),
  listDrives: (id)      => api.get(`/sharepoint-connections/${id}/drives`),
};

// ═══ SHAREPOINT ═══
export const sharepointAPI = {
  // Test connection (admin only)
  test: () =>
    api.get('/sharepoint/test'),
  // List files/folders in project root or subfolder
  listFiles: (projectId, subpath = '') =>
    api.get(`/sharepoint/projects/${projectId}/files`, { params: subpath ? { subpath } : {} }),
  // Upload a file (multipart/form-data)
  upload: (projectId, file, destFolder = '') => {
    const form = new FormData();
    form.append('file', file);
    if (destFolder) form.append('destFolder', destFolder);
    return api.post(`/sharepoint/projects/${projectId}/upload`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
  },
  // Returns { url } — frontend opens in new tab
  getDownloadUrl: (projectId, itemId) =>
    api.get(`/sharepoint/projects/${projectId}/download/${itemId}`),
  // Get preview URL for an item
  preview: (projectId, itemId) =>
    api.get(`/sharepoint/projects/${projectId}/preview/${itemId}`),
  // Document coverage stats (DB only, no Graph calls)
  coverage: (projectId) =>
    api.get(`/sharepoint/projects/${projectId}/coverage`),
};

export default api;
