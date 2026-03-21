/**
 * Migration: add OAuth SSO columns to users table
 * Run: node scripts/migrate-oauth.js
 */
require('dotenv').config();
const pool = require('../src/config/database');

async function migrate() {
  console.log('[migrate-oauth] Starting migration...');
  try {
    // Make password_hash nullable (OAuth users have no password)
    await pool.execute(`
      ALTER TABLE users
        MODIFY COLUMN password_hash VARCHAR(255) NULL
    `);
    console.log('[migrate-oauth] ✓ password_hash now nullable');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || e.message.includes('already')) {
      console.log('[migrate-oauth] ~ password_hash already nullable');
    } else {
      console.warn('[migrate-oauth] password_hash:', e.message);
    }
  }

  try {
    await pool.execute(`
      ALTER TABLE users
        ADD COLUMN oauth_provider    VARCHAR(20)  NULL DEFAULT NULL AFTER password_hash,
        ADD COLUMN oauth_provider_id VARCHAR(255) NULL DEFAULT NULL AFTER oauth_provider,
        ADD COLUMN avatar_url        VARCHAR(500) NULL DEFAULT NULL
    `);
    console.log('[migrate-oauth] ✓ Added oauth_provider, oauth_provider_id, avatar_url');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME' || e.message.includes('Duplicate column')) {
      console.log('[migrate-oauth] ~ OAuth columns already exist');
    } else {
      console.warn('[migrate-oauth] columns:', e.message);
    }
  }

  try {
    await pool.execute(`
      ALTER TABLE users
        ADD UNIQUE KEY uq_oauth (oauth_provider, oauth_provider_id)
    `);
    console.log('[migrate-oauth] ✓ Added unique index on (oauth_provider, oauth_provider_id)');
  } catch (e) {
    if (e.message.includes('Duplicate key name') || e.message.includes('already exists')) {
      console.log('[migrate-oauth] ~ Unique index already exists');
    } else {
      console.warn('[migrate-oauth] index:', e.message);
    }
  }

  console.log('[migrate-oauth] Migration complete.');
  process.exit(0);
}

migrate().catch(err => { console.error('[migrate-oauth] Fatal:', err); process.exit(1); });
