/**
 * SGIP-IA — Migration: Income Schedule + Month Validation
 * Run: node scripts/migrate-income-schedule.js
 */
require('dotenv').config();
const pool = require('../src/config/database');

async function migrate() {
  console.log('💰 Reestructurando ingresos con forma de pago flexible...\n');

  // 1. Create income_schedule table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS budget_income_schedule (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      tipo_pago ENUM('mensual','hito','unico') NOT NULL DEFAULT 'mensual',
      mes INT NULL,
      descripcion VARCHAR(300) NULL,
      valor_sin_iva DECIMAL(18,2) NOT NULL DEFAULT 0,
      valor_iva DECIMAL(18,2) NOT NULL DEFAULT 0,
      valor_con_iva DECIMAL(18,2) NOT NULL DEFAULT 0,
      estado ENUM('pendiente','facturado','pagado') NOT NULL DEFAULT 'pendiente',
      fecha_estimada DATE NULL,
      notas TEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      INDEX idx_project (project_id),
      INDEX idx_project_mes (project_id, mes)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ Tabla budget_income_schedule creada');

  // 2. Add forma_pago to budget_income if not exists
  try { await pool.execute("ALTER TABLE budget_income ADD COLUMN forma_pago ENUM('mensual','hitos','unico') DEFAULT 'mensual' AFTER tipo"); } catch(e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
  console.log('✅ Campo forma_pago agregado a budget_income');

  await pool.end();
  console.log('\n🎉 Migración completada');
}

migrate().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
