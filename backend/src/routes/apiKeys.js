/**
 * /api/settings/api-keys  — API Key management
 *
 * GET    /api/settings/api-keys          → list all keys (prefix only, never raw)
 * POST   /api/settings/api-keys          → generate new key (returned ONCE)
 * DELETE /api/settings/api-keys/:id      → revoke key
 */
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { authMiddleware: authenticate, roleMiddleware } = require('../middleware/auth');
const requireAdmin = roleMiddleware('admin');
const db = require('../config/database');

// Auto-create table if needed
async function ensureTable() {
  try {
    await db.execute(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id          INT PRIMARY KEY AUTO_INCREMENT,
        name        VARCHAR(100) NOT NULL,
        key_prefix  VARCHAR(12) NOT NULL,
        key_hash    VARCHAR(64) NOT NULL UNIQUE,
        created_by  INT NOT NULL,
        last_used_at DATETIME,
        is_active   TINYINT NOT NULL DEFAULT 1,
        created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
  } catch (e) { console.error('[apiKeys] ensureTable:', e.message); }
}
ensureTable();

// ─────────────────────────────────────────────────────────────────────────────
// GET /api/settings/api-keys
// ─────────────────────────────────────────────────────────────────────────────
router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.execute(
      `SELECT id, name, key_prefix, is_active, last_used_at, created_at
       FROM api_keys ORDER BY created_at DESC`
    );
    res.json({ success: true, data: rows });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// POST /api/settings/api-keys
// ─────────────────────────────────────────────────────────────────────────────
router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nombre requerido' });

    // Generate: prefix (sgip_live_) + 32 random hex chars
    const raw     = crypto.randomBytes(24).toString('hex'); // 48 hex chars
    const prefix  = 'sgip_' + raw.slice(0, 6);             // sgip_xxxxxx
    const fullKey = prefix + '_' + raw.slice(6);           // sgip_xxxxxx_yyyyyy...
    const hash    = crypto.createHash('sha256').update(fullKey).digest('hex');

    await db.execute(
      `INSERT INTO api_keys (name, key_prefix, key_hash, created_by)
       VALUES (?, ?, ?, ?)`,
      [name.trim(), prefix, hash, req.user.id]
    );

    // Return the full key ONCE — it won't be recoverable
    res.json({
      success: true,
      message: 'API Key generada. Guárdela ahora, no se mostrará de nuevo.',
      data: { name: name.trim(), prefix, key: fullKey },
    });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// DELETE /api/settings/api-keys/:id
// ─────────────────────────────────────────────────────────────────────────────
router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await db.execute(
      'UPDATE api_keys SET is_active = 0 WHERE id = ?',
      [req.params.id]
    );
    res.json({ success: true, message: 'API Key revocada' });
  } catch (e) { res.status(500).json({ error: e.message }); }
});

module.exports = router;
