/**
 * SharePoint Online — Microsoft Graph API Service
 * Auth: Client Credentials (app-only, no user interaction)
 * Token cached for 55 min (tokens last 60 min)
 */

const axios = require('axios');

let _tokenCache = null;   // { token, expiresAt }
let _siteIdCache = null;  // string

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

async function getToken() {
  if (_tokenCache && _tokenCache.expiresAt > Date.now()) return _tokenCache.token;

  const { SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET } = process.env;
  if (!SP_TENANT_ID || !SP_CLIENT_ID || !SP_CLIENT_SECRET) {
    throw new Error('SharePoint no configurado: faltan variables SP_TENANT_ID / SP_CLIENT_ID / SP_CLIENT_SECRET');
  }

  const res = await axios.post(
    `https://login.microsoftonline.com/${SP_TENANT_ID}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     SP_CLIENT_ID,
      client_secret: SP_CLIENT_SECRET,
      scope:         'https://graph.microsoft.com/.default',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  _tokenCache = {
    token:     res.data.access_token,
    expiresAt: Date.now() + 55 * 60 * 1000, // 55 min
  };
  return _tokenCache.token;
}

async function graphGet(path, params = {}) {
  const token = await getToken();
  const res = await axios.get(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  return res.data;
}

async function graphPost(path, body) {
  const token = await getToken();
  const res = await axios.post(`https://graph.microsoft.com/v1.0${path}`, body, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return res.data;
}

async function graphPut(path, buffer, contentType) {
  const token = await getToken();
  const res = await axios.put(`https://graph.microsoft.com/v1.0${path}`, buffer, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    maxContentLength: Infinity,
    maxBodyLength:    Infinity,
  });
  return res.data;
}

async function getSiteId() {
  if (_siteIdCache) return _siteIdCache;

  const url      = new URL(process.env.SP_SITE_URL);
  const hostname = url.hostname;                      // e.g. empresa.sharepoint.com
  const sitePath = url.pathname;                      // e.g. /sites/proyectos

  const data    = await graphGet(`/sites/${hostname}:${sitePath}`);
  _siteIdCache  = data.id;
  return _siteIdCache;
}

/**
 * Build a safe Graph path segment from a folder/file path.
 * Encodes each path segment individually; leaves "/" as separator.
 */
function encodePath(rawPath) {
  return rawPath
    .split('/')
    .map(seg => encodeURIComponent(seg))
    .join('/');
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

module.exports = {

  /**
   * Returns true only if all 4 SP env vars are set.
   */
  isConfigured() {
    const { SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET, SP_SITE_URL } = process.env;
    return !!(SP_TENANT_ID && SP_CLIENT_ID && SP_CLIENT_SECRET && SP_SITE_URL);
  },

  /**
   * Test connection — returns { site, status: 'ok' } or throws.
   */
  async testConnection() {
    const siteId = await getSiteId();
    const data   = await graphGet(`/sites/${siteId}`);
    return { site: data.displayName || data.name, status: 'ok' };
  },

  /**
   * List items inside a folder path (relative to the SP site drive root).
   * @param {string} folderPath  e.g. "Proyectos/TI-2026-001" or "Proyectos/TI-2026-001/Contratos"
   * @returns {Array} items — normalised to { id, name, size, type, lastModified, webUrl, createdBy }
   */
  async listFolder(folderPath) {
    const siteId  = await getSiteId();
    const encoded = encodePath(folderPath.replace(/^\/+/, ''));
    const data    = await graphGet(
      `/sites/${siteId}/drive/root:/${encoded}:/children`,
      { $select: 'id,name,size,lastModifiedDateTime,file,folder,webUrl,createdBy' }
    );

    return (data.value || []).map(item => ({
      id:           item.id,
      name:         item.name,
      type:         item.folder ? 'folder' : 'file',
      size:         item.size || 0,
      lastModified: item.lastModifiedDateTime,
      webUrl:       item.webUrl,
      mimeType:     item.file ? item.file.mimeType : null,
      createdBy:    item.createdBy?.user?.displayName || null,
    }));
  },

  /**
   * Upload a file buffer to SharePoint.
   * Uses simple PUT for files ≤ 4 MB; upload session for larger files.
   * @param {string} folderPath  destination folder (relative to site root)
   * @param {string} fileName
   * @param {Buffer} buffer
   * @param {string} mimeType
   * @returns uploaded item { id, name, webUrl }
   */
  async uploadFile(folderPath, fileName, buffer, mimeType) {
    const siteId         = await getSiteId();
    const cleanFolder    = folderPath.replace(/^\/+/, '').replace(/\/+$/, '');
    const encodedFolder  = encodePath(cleanFolder);
    const encodedName    = encodeURIComponent(fileName);

    if (buffer.length <= 4 * 1024 * 1024) {
      // Simple upload
      const data = await graphPut(
        `/sites/${siteId}/drive/root:/${encodedFolder}/${encodedName}:/content`,
        buffer,
        mimeType
      );
      return { id: data.id, name: data.name, webUrl: data.webUrl };
    }

    // Large file: upload session (chunked)
    const sessionData = await graphPost(
      `/sites/${siteId}/drive/root:/${encodedFolder}/${encodedName}:/createUploadSession`,
      { item: { '@microsoft.graph.conflictBehavior': 'rename' } }
    );
    const uploadUrl = sessionData.uploadUrl;

    const chunkSize = 3 * 1024 * 1024; // 3 MB chunks
    let start = 0;
    let result = null;

    while (start < buffer.length) {
      const end   = Math.min(start + chunkSize, buffer.length);
      const chunk = buffer.slice(start, end);

      const token = await getToken();
      const resp  = await axios.put(uploadUrl, chunk, {
        headers: {
          Authorization:   `Bearer ${token}`,
          'Content-Range': `bytes ${start}-${end - 1}/${buffer.length}`,
          'Content-Length': chunk.length,
        },
        maxContentLength: Infinity,
        maxBodyLength:    Infinity,
      });

      if (resp.data && resp.data.id) result = resp.data; // Final response
      start = end;
    }

    return { id: result.id, name: result.name, webUrl: result.webUrl };
  },

  /**
   * Get a temporary download URL (~1 hour) for a Drive item.
   * @param {string} itemId  SP item ID
   * @returns {string} download URL
   */
  async getDownloadUrl(itemId) {
    const siteId = await getSiteId();
    const data   = await graphGet(`/sites/${siteId}/drive/items/${itemId}`);
    return data['@microsoft.graph.downloadUrl'] || data.webUrl;
  },

  /**
   * Get an embed preview URL for a Drive item.
   * Falls back gracefully if the file type doesn't support preview.
   * @param {string} itemId  SP item ID
   * @returns {{ url: string, type: 'embed'|'web' }}
   */
  async getPreviewUrl(itemId) {
    const siteId = await getSiteId();
    try {
      const data = await graphPost(
        `/sites/${siteId}/drive/items/${itemId}/createLink`,
        { type: 'embed', scope: 'organization' }
      );
      return { url: data.link?.webUrl || data.webUrl, type: 'embed' };
    } catch {
      // Not all file types support embed links → fall back to direct web URL
      const data = await graphGet(`/sites/${siteId}/drive/items/${itemId}`);
      return { url: data.webUrl, type: 'web' };
    }
  },
};
