/**
 * SGIP-IA — Migration: Budget Item-Level Tracking v2
 * Run: node scripts/migrate-budget-tracking-v2.js
 */
require('dotenv').config();
const pool = require('../src/config/database');

async function migrate() {
  console.log('📊 Reestructurando seguimiento presupuestal a nivel de ítem...\n');

  // Drop old table if exists
  await pool.execute('DROP TABLE IF EXISTS budget_tracking');
  console.log('✅ Tabla anterior eliminada');

  await pool.execute(`
    CREATE TABLE budget_tracking (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      mes INT NOT NULL,
      fuente ENUM('payroll','contractors','expenses','puc') NOT NULL,
      item_id INT NOT NULL,
      item_label VARCHAR(300) NOT NULL,
      valor_planeado DECIMAL(18,2) NOT NULL DEFAULT 0,
      valor_ejecutado DECIMAL(18,2) NOT NULL DEFAULT 0,
      notas TEXT NULL,
      created_by INT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE KEY uk_project_mes_fuente_item (project_id, mes, fuente, item_id),
      INDEX idx_project_mes (project_id, mes)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ Tabla budget_tracking (v2 por ítem) creada');

  await pool.end();
  console.log('\n🎉 Migración completada');
}

migrate().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
