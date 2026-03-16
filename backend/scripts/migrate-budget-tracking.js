/**
 * SGIP-IA — Migration: Budget Monthly Tracking
 * Run: node scripts/migrate-budget-tracking.js
 */
require('dotenv').config();
const pool = require('../src/config/database');

async function migrate() {
  console.log('📊 Creando tabla de seguimiento presupuestal mensual...\n');

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS budget_tracking (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      mes INT NOT NULL,
      categoria ENUM('nomina','contratistas','gastos_operativos','otros') NOT NULL,
      subcategoria VARCHAR(200) NULL,
      valor_planeado DECIMAL(18,2) NOT NULL DEFAULT 0,
      valor_ejecutado DECIMAL(18,2) NOT NULL DEFAULT 0,
      notas TEXT NULL,
      created_by INT NULL,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE KEY uk_project_mes_cat_sub (project_id, mes, categoria, subcategoria),
      INDEX idx_project_mes (project_id, mes)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ Tabla budget_tracking creada');

  await pool.end();
  console.log('\n🎉 Migración completada');
}

migrate().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
