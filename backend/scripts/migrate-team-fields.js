// migrate-team-fields.js
// Run: node scripts/migrate-team-fields.js
const pool = require('../src/config/database');

async function migrate() {
  console.log('🔄 Agregando campos a team_members...');

  const cols = [
    { name: 'person_name',        sql: "ALTER TABLE team_members ADD COLUMN person_name VARCHAR(255) NULL AFTER full_name" },
    { name: 'resource_type',      sql: "ALTER TABLE team_members ADD COLUMN resource_type ENUM('interno','externo') NULL DEFAULT NULL AFTER dedication_pct" },
    { name: 'participation_type', sql: "ALTER TABLE team_members ADD COLUMN participation_type ENUM('ejecuta','presentado','ambos') NULL DEFAULT NULL AFTER resource_type" },
  ];

  for (const col of cols) {
    try {
      await pool.execute(col.sql);
      console.log(`  ✅ ${col.name} agregada`);
    } catch (e) {
      if (e.code === 'ER_DUP_FIELDNAME') console.log(`  ⏭️ ${col.name} ya existe`);
      else throw e;
    }
  }

  console.log('✅ Migración completada');
  process.exit(0);
}

migrate().catch(e => { console.error('❌', e.message); process.exit(1); });
