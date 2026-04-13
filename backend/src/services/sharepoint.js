/**
 * SharePoint Online — Microsoft Graph API Service
 * Multi-tenant: accepts a connection object { tenant_id, client_id, client_secret, site_url }
 * Token cached per tenant+client pair; site ID cached per site URL; both in Maps.
 */

const axios = require('axios');

// token cache: key = `${tenant_id}|${client_id}` → { token, expiresAt }
const _tokenCache = new Map();
// site ID cache: key = site_url → siteId
const _siteIdCache = new Map();
// download URL cache: key = `${siteId}|${itemId}` → { url, expiresAt }
// Microsoft pre-auth URLs are valid ~1 h; we cache 45 min to stay safe
const _downloadUrlCache = new Map();
const DOWNLOAD_URL_TTL_MS = 45 * 60 * 1000;

// ─────────────────────────────────────────────
// Internal helpers
// ─────────────────────────────────────────────

async function getToken(conn) {
  const key    = `${conn.tenant_id}|${conn.client_id}`;
  const cached = _tokenCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.token;

  const res = await axios.post(
    `https://login.microsoftonline.com/${conn.tenant_id}/oauth2/v2.0/token`,
    new URLSearchParams({
      grant_type:    'client_credentials',
      client_id:     conn.client_id,
      client_secret: conn.client_secret,
      scope:         'https://graph.microsoft.com/.default',
    }),
    { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
  );

  _tokenCache.set(key, {
    token:     res.data.access_token,
    expiresAt: Date.now() + 55 * 60 * 1000,
  });
  return res.data.access_token;
}

async function graphGet(conn, path, params = {}) {
  const token = await getToken(conn);
  const res   = await axios.get(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
    params,
  });
  return res.data;
}

async function graphPost(conn, path, body) {
  const token = await getToken(conn);
  const res   = await axios.post(`https://graph.microsoft.com/v1.0${path}`, body, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });
  return res.data;
}

async function graphPut(conn, path, buffer, contentType) {
  const token = await getToken(conn);
  const res   = await axios.put(`https://graph.microsoft.com/v1.0${path}`, buffer, {
    headers: {
      Authorization:  `Bearer ${token}`,
      'Content-Type': contentType || 'application/octet-stream',
    },
    maxContentLength: Infinity,
    maxBodyLength:    Infinity,
  });
  return res.data;
}

async function getSiteId(conn) {
  if (_siteIdCache.has(conn.site_url)) return _siteIdCache.get(conn.site_url);

  const url      = new URL(conn.site_url);
  const hostname = url.hostname;
  const sitePath = url.pathname;

  const data = await graphGet(conn, `/sites/${hostname}:${sitePath}`);
  _siteIdCache.set(conn.site_url, data.id);
  return data.id;
}

function encodePath(rawPath) {
  return rawPath.split('/').map(seg => encodeURIComponent(seg)).join('/');
}

/** Returns the base Graph path for the drive (default or specific library). */
function drivePath(siteId, driveId) {
  return driveId ? `/sites/${siteId}/drives/${driveId}` : `/sites/${siteId}/drive`;
}

// ─────────────────────────────────────────────
// Public API
// ─────────────────────────────────────────────

module.exports = {

  /**
   * Returns true only if the 3 required auth env vars are set
   * (used as system-wide fallback check).
   */
  isConfigured() {
    const { SP_TENANT_ID, SP_CLIENT_ID, SP_CLIENT_SECRET } = process.env;
    return !!(SP_TENANT_ID && SP_CLIENT_ID && SP_CLIENT_SECRET);
  },

  /**
   * Build a connection object from .env variables (fallback/legacy).
   * @param {string|null} [siteUrlOverride]  Override SP_SITE_URL (e.g. from project.sharepoint_site_url)
   */
  connFromEnv(siteUrlOverride) {
    return {
      tenant_id:     process.env.SP_TENANT_ID,
      client_id:     process.env.SP_CLIENT_ID,
      client_secret: process.env.SP_CLIENT_SECRET,
      site_url:      siteUrlOverride || process.env.SP_SITE_URL,
    };
  },

  /**
   * Test connection — returns { site, siteUrl, status: 'ok' } or throws.
   * @param {object} conn  Connection object { tenant_id, client_id, client_secret, site_url }
   */
  async testConnection(conn) {
    const siteId = await getSiteId(conn);
    const data   = await graphGet(conn, `/sites/${siteId}`);
    return { site: data.displayName || data.name, siteUrl: conn.site_url, status: 'ok' };
  },

  /**
   * List document libraries (drives) available in the site.
   * @param {object} conn
   * @returns {Array} drives — { id, name, description, webUrl, driveType }
   */
  async listDrives(conn) {
    const siteId = await getSiteId(conn);
    const data   = await graphGet(conn, `/sites/${siteId}/drives`, {
      $select: 'id,name,description,webUrl,driveType',
    });
    return (data.value || []).map(d => ({
      id:          d.id,
      name:        d.name,
      description: d.description || null,
      webUrl:      d.webUrl,
      driveType:   d.driveType,
    }));
  },

  /**
   * List items inside a folder path.
   * @param {object} conn
   * @param {string} folderPath  relative to library root ('' = root)
   * @param {string|null} driveId  specific document library ID (null = default "Documentos")
   */
  async listFolder(conn, folderPath, driveId) {
    const siteId   = await getSiteId(conn);
    const base     = drivePath(siteId, driveId);
    const clean    = (folderPath || '').replace(/^\/+/, '');
    const endpoint = clean
      ? `${base}/root:/${encodePath(clean)}:/children`
      : `${base}/root/children`;

    const data = await graphGet(conn, endpoint, {
      $select: 'id,name,size,lastModifiedDateTime,file,folder,webUrl,createdBy',
    });
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
   * @param {object} conn
   * @param {string} folderPath  destination folder (relative to library root)
   * @param {string} fileName
   * @param {Buffer} buffer
   * @param {string} mimeType
   * @param {string|null} driveId
   */
  async uploadFile(conn, folderPath, fileName, buffer, mimeType, driveId) {
    const siteId       = await getSiteId(conn);
    const base         = drivePath(siteId, driveId);
    const cleanFolder  = (folderPath || '').replace(/^\/+/, '').replace(/\/+$/, '');
    const encodedName  = encodeURIComponent(fileName);
    const itemPath     = cleanFolder
      ? `${base}/root:/${encodePath(cleanFolder)}/${encodedName}:`
      : `${base}/root:/${encodedName}:`;

    if (buffer.length <= 4 * 1024 * 1024) {
      const data = await graphPut(conn, `${itemPath}/content`, buffer, mimeType);
      return { id: data.id, name: data.name, webUrl: data.webUrl };
    }

    // Large file: chunked upload session
    const sessionData = await graphPost(conn, `${itemPath}/createUploadSession`, {
      item: { '@microsoft.graph.conflictBehavior': 'rename' },
    });
    const uploadUrl = sessionData.uploadUrl;
    const chunkSize = 3 * 1024 * 1024;
    let start  = 0;
    let result = null;

    while (start < buffer.length) {
      const end   = Math.min(start + chunkSize, buffer.length);
      const chunk = buffer.slice(start, end);
      const token = await getToken(conn);
      const resp  = await axios.put(uploadUrl, chunk, {
        headers: {
          Authorization:    `Bearer ${token}`,
          'Content-Range':  `bytes ${start}-${end - 1}/${buffer.length}`,
          'Content-Length': chunk.length,
        },
        maxContentLength: Infinity,
        maxBodyLength:    Infinity,
      });
      if (resp.data && resp.data.id) result = resp.data;
      start = end;
    }
    return { id: result.id, name: result.name, webUrl: result.webUrl };
  },

  /**
   * Get a temporary download URL (~1 hour) for a Drive item.
   * @param {object} conn
   * @param {string} itemId
   * @param {string|null} driveId
   */
  async getDownloadUrl(conn, itemId, driveId) {
    const siteId   = await getSiteId(conn);
    const cacheKey = `${siteId}|${itemId}`;

    const cached = _downloadUrlCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.url;

    const base = drivePath(siteId, driveId);
    const data = await graphGet(conn, `${base}/items/${itemId}`);
    const url  = data['@microsoft.graph.downloadUrl'] || data.webUrl;

    _downloadUrlCache.set(cacheKey, { url, expiresAt: Date.now() + DOWNLOAD_URL_TTL_MS });
    return url;
  },

  /**
   * Get an embed preview URL for a Drive item.
   * Falls back gracefully if the file type doesn't support preview.
   * @param {object} conn
   * @param {string} itemId
   * @param {string|null} driveId
   * @returns {{ url: string, type: 'embed'|'web' }}
   */
  async getPreviewUrl(conn, itemId, driveId) {
    const siteId = await getSiteId(conn);
    const base   = drivePath(siteId, driveId);
    try {
      const data = await graphPost(conn, `${base}/items/${itemId}/createLink`, {
        type: 'embed', scope: 'organization',
      });
      return { url: data.link?.webUrl || data.webUrl, type: 'embed' };
    } catch {
      const data = await graphGet(conn, `${base}/items/${itemId}`);
      return { url: data.webUrl, type: 'web' };
    }
  },
};
