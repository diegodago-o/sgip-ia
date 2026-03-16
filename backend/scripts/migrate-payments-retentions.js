// Migration: Add detailed retention columns to payments table
// Run: node backend/scripts/migrate-payments-retentions.js

require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sgip_ia',
  });

  console.log('🔄 Migrando tabla payments — retenciones detalladas...\n');

  const columns = [
    ['base_value', 'DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER gross_value'],
    ['iva_pct', 'DECIMAL(5,2) NOT NULL DEFAULT 19.00 AFTER base_value'],
    ['iva_value', 'DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER iva_pct'],
    ['reteiva_pct', 'DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER retention_value'],
    ['reteiva_value', 'DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER reteiva_pct'],
    ['retefuente_pct', 'DECIMAL(5,2) NOT NULL DEFAULT 0.00 AFTER reteiva_value'],
    ['retefuente_value', 'DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER retefuente_pct'],
    ['reteica_pct', 'DECIMAL(5,3) NOT NULL DEFAULT 0.000 AFTER retefuente_value'],
    ['reteica_value', 'DECIMAL(18,2) NOT NULL DEFAULT 0.00 AFTER reteica_pct'],
    ['paid_date', 'DATE NULL AFTER paid_at'],
  ];

  for (const [col, def] of columns) {
    try {
      const [rows] = await conn.execute(`SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='payments' AND COLUMN_NAME=?`, [col]);
      if (rows.length === 0) {
        await conn.execute(`ALTER TABLE payments ADD COLUMN ${col} ${def}`);
        console.log(`  ✅ Columna ${col} agregada`);
      } else {
        console.log(`  ⏭️  Columna ${col} ya existe`);
      }
    } catch (e) {
      console.log(`  ⚠️  Error con ${col}: ${e.message}`);
    }
  }

  // Migrate existing data: populate base_value from gross_value
  // If gross_value exists but base_value is 0, estimate base = gross / 1.19
  try {
    const [updated] = await conn.execute(`
      UPDATE payments SET
        base_value = ROUND(gross_value / (1 + iva_pct/100), 2),
        iva_value = ROUND(gross_value - (gross_value / (1 + iva_pct/100)), 2)
      WHERE base_value = 0 AND gross_value > 0
    `);
    if (updated.affectedRows > 0) {
      console.log(`\n  📊 ${updated.affectedRows} pagos existentes migrados (base estimada desde bruto)`);
    }
  } catch (e) { console.log('  ⚠️ Migration de datos:', e.message); }

  console.log('\n✅ Migración completada');
  await conn.end();
}

migrate().catch(e => { console.error('❌ Error:', e.message); process.exit(1); });
