/**
 * SGIP-IA — Migración Módulo 3: Cierre y Liquidación
 * Run: node scripts/migrate-m3.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sgip_ia',
  });
  console.log('🔌 Conectado — Migración Módulo 3\n');

  // ── 1. closure_checklists — Items de verificación para cierre ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS closure_checklists (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      category ENUM('contractual','tecnico','financiero','administrativo','documental','ambiental') NOT NULL DEFAULT 'contractual',
      item_order INT NOT NULL DEFAULT 0,
      description VARCHAR(500) NOT NULL,
      responsible VARCHAR(255) NULL,
      is_completed TINYINT(1) NOT NULL DEFAULT 0,
      completed_by INT NULL,
      completed_at DATETIME NULL,
      evidence_doc_id INT NULL,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_category (category),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (evidence_doc_id) REFERENCES documents(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ closure_checklists (Checklist de cierre)');

  // ── 2. liquidation_records — Acta de liquidación ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS liquidation_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL UNIQUE,
      liquidation_type ENUM('bilateral','unilateral','judicial') NOT NULL DEFAULT 'bilateral',
      liquidation_date DATE NULL,
      original_value DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      additions_value DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      final_contract_value DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      total_paid DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      total_retained DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      retention_release DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      balance_in_favor_of ENUM('contratista','entidad','equilibrio') NOT NULL DEFAULT 'equilibrio',
      balance_amount DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      original_start_date DATE NULL,
      original_end_date DATE NULL,
      actual_end_date DATE NULL,
      total_additions_days INT NOT NULL DEFAULT 0,
      total_suspension_days INT NOT NULL DEFAULT 0,
      physical_completion_pct DECIMAL(5,2) NOT NULL DEFAULT 100.00,
      pending_obligations TEXT NULL,
      contractor_observations TEXT NULL,
      entity_observations TEXT NULL,
      status ENUM('borrador','en_revision','firmada','archivada') NOT NULL DEFAULT 'borrador',
      signed_by_contractor VARCHAR(255) NULL,
      signed_by_entity VARCHAR(255) NULL,
      signed_at DATETIME NULL,
      document_id INT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ liquidation_records (Acta de liquidación)');

  // ── 3. lessons_learned — Lecciones aprendidas ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS lessons_learned (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      category ENUM('tecnico','gestion','contractual','financiero','comunicacion','riesgos','calidad','otro') NOT NULL DEFAULT 'gestion',
      lesson_type ENUM('positiva','negativa','mejora') NOT NULL DEFAULT 'mejora',
      title VARCHAR(500) NOT NULL,
      situation TEXT NOT NULL,
      action_taken TEXT NULL,
      result TEXT NULL,
      recommendation TEXT NULL,
      impact_area VARCHAR(255) NULL,
      reported_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_category (category),
      INDEX idx_type (lesson_type),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ lessons_learned (Lecciones aprendidas)');

  await conn.end();
  console.log('\n🎉 Migración Módulo 3 completada — 3 tablas creadas');
}

migrate().catch((err) => {
  console.error('❌ Error en migración M3:', err.message);
  process.exit(1);
});
