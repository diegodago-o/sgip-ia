/**
 * SGIP-IA — Migración Módulo 1: Adjudicación y Arranque
 * Run: node scripts/migrate-m1.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_NAME = process.env.DB_NAME || 'sgip_ia';

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: DB_NAME,
  });

  console.log('🔌 Conectado a MySQL\n');

  // ── Helper: add column if not exists ──
  async function addCol(table, column, definition, after) {
    try {
      const [rows] = await conn.execute(
        `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = ? AND COLUMN_NAME = ?`,
        [DB_NAME, table, column]
      );
      if (rows.length === 0) {
        const afterClause = after ? ` AFTER \`${after}\`` : '';
        await conn.execute(`ALTER TABLE \`${table}\` ADD COLUMN \`${column}\` ${definition}${afterClause}`);
        console.log(`  + Columna ${table}.${column} agregada`);
      }
    } catch (err) {
      console.log(`  ⚠ ${table}.${column}: ${err.message}`);
    }
  }

  // ── 1. Add missing columns to projects ──
  console.log('📦 Actualizando tabla projects...');
  await addCol('projects', 'selection_process', "ENUM('licitacion','concurso_meritos','minima_cuantia','contratacion_directa','otro') NULL", 'priority');
  await addCol('projects', 'secop_number', 'VARCHAR(50) NULL', 'selection_process');
  await addCol('projects', 'cdp_number', 'VARCHAR(50) NULL', 'secop_number');
  await addCol('projects', 'rp_number', 'VARCHAR(50) NULL', 'cdp_number');
  await addCol('projects', 'tags', 'JSON NULL', 'rp_number');
  await addCol('projects', 'created_by', 'INT NULL', 'progress_pct');
  console.log('✅ projects actualizada\n');

  // ── 2. project_tags ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS project_tags (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      tag VARCHAR(100) NOT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE KEY uq_project_tag (project_id, tag),
      INDEX idx_tag (tag),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ project_tags');

  // ── 3. documents ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS documents (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      file_name VARCHAR(500) NOT NULL,
      file_path VARCHAR(1000) NOT NULL,
      file_size BIGINT NULL,
      mime_type VARCHAR(100) NULL,
      file_hash VARCHAR(64) NULL,
      doc_type ENUM('pliego','anexo_tecnico','propuesta_tecnica','propuesta_economica','contrato','adicion_otrosi','acta_inicio','poliza','presupuesto','otro') NULL,
      doc_type_confidence DECIMAL(5,2) NULL,
      doc_type_source ENUM('ia','manual') DEFAULT 'manual',
      version INT NOT NULL DEFAULT 1,
      parent_document_id INT NULL,
      ocr_processed TINYINT(1) DEFAULT 0,
      ocr_text LONGTEXT NULL,
      sharepoint_item_id VARCHAR(255) NULL,
      sharepoint_drive_id VARCHAR(255) NULL,
      uploaded_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_type (doc_type),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_document_id) REFERENCES documents(id) ON DELETE SET NULL,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ documents');

  // ── 4. ia_extractions ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS ia_extractions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      document_id INT NOT NULL,
      entity_type ENUM('obligacion_general','obligacion_especifica','entregable','hito','condicion_pago','penalidad','poliza_requerida','requisito_tecnico') NOT NULL,
      extracted_text TEXT NOT NULL,
      structured_data JSON NOT NULL,
      source_page INT NULL,
      source_clause VARCHAR(100) NULL,
      confidence DECIMAL(5,2) NOT NULL,
      confidence_level VARCHAR(10) NULL,
      status ENUM('pendiente','aprobada','editada','descartada') NOT NULL DEFAULT 'pendiente',
      reviewed_by INT NULL,
      reviewed_at DATETIME NULL,
      linked_entity_type VARCHAR(50) NULL,
      linked_entity_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_document (document_id),
      INDEX idx_status (status),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE CASCADE,
      FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ ia_extractions');

  // ── 5. obligations ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS obligations (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      code VARCHAR(30) NOT NULL,
      description TEXT NOT NULL,
      obligation_type ENUM('hacer','entregar','no_hacer','condicion') NOT NULL,
      source_document_id INT NULL,
      source_clause VARCHAR(100) NULL,
      periodicity ENUM('unica','diaria','semanal','quincenal','mensual','bimestral','trimestral','semestral','anual','al_cierre') DEFAULT 'unica',
      due_date DATE NULL,
      due_date_rule VARCHAR(255) NULL,
      responsible_user_id INT NULL,
      responsible_role VARCHAR(100) NULL,
      risk_level ENUM('alto','medio','bajo') DEFAULT 'medio',
      status ENUM('pendiente','en_curso','cumplida','vencida','no_aplica') NOT NULL DEFAULT 'pendiente',
      notes TEXT NULL,
      extraction_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY uq_obligation_code (project_id, code),
      INDEX idx_project (project_id),
      INDEX idx_status (status),
      INDEX idx_due (due_date),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (source_document_id) REFERENCES documents(id) ON DELETE SET NULL,
      FOREIGN KEY (responsible_user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (extraction_id) REFERENCES ia_extractions(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ obligations');

  // ── 6. milestones (BEFORE deliverables) ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS milestones (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      name VARCHAR(500) NOT NULL,
      description TEXT NULL,
      due_date DATE NULL,
      due_date_rule VARCHAR(255) NULL,
      status ENUM('pendiente','cumplido','vencido') NOT NULL DEFAULT 'pendiente',
      completed_at DATETIME NULL,
      extraction_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_due (due_date),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (extraction_id) REFERENCES ia_extractions(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ milestones');

  // ── 7. deliverables (now milestones exists) ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS deliverables (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      obligation_id INT NULL,
      milestone_id INT NULL,
      name VARCHAR(500) NOT NULL,
      description TEXT NULL,
      required_format VARCHAR(100) NULL,
      due_date DATE NULL,
      acceptance_criteria TEXT NULL,
      status ENUM('pendiente','en_elaboracion','entregado','aprobado','rechazado') NOT NULL DEFAULT 'pendiente',
      delivered_at DATETIME NULL,
      extraction_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_obligation (obligation_id),
      INDEX idx_milestone (milestone_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (obligation_id) REFERENCES obligations(id) ON DELETE SET NULL,
      FOREIGN KEY (milestone_id) REFERENCES milestones(id) ON DELETE SET NULL,
      FOREIGN KEY (extraction_id) REFERENCES ia_extractions(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ deliverables');

  // ── 8. penalties ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS penalties (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      penalty_type ENUM('multa','clausula_penal','declaratoria_incumplimiento','otra') NOT NULL,
      description TEXT NOT NULL,
      percentage DECIMAL(8,4) NULL,
      fixed_amount DECIMAL(18,2) NULL,
      max_cap DECIMAL(18,2) NULL,
      trigger_condition TEXT NULL,
      obligation_id INT NULL,
      source_clause VARCHAR(100) NULL,
      extraction_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (obligation_id) REFERENCES obligations(id) ON DELETE SET NULL,
      FOREIGN KEY (extraction_id) REFERENCES ia_extractions(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ penalties');

  // ── 9. payment_conditions ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS payment_conditions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      description TEXT NOT NULL,
      amount DECIMAL(18,2) NULL,
      percentage DECIMAL(5,2) NULL,
      condition_text TEXT NULL,
      required_documents TEXT NULL,
      periodicity ENUM('unica','mensual','bimestral','trimestral','por_hito','otro') DEFAULT 'mensual',
      extraction_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (extraction_id) REFERENCES ia_extractions(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ payment_conditions');

  // ── 10. policies ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS policies (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      policy_type ENUM('cumplimiento','calidad','pago_salarios','responsabilidad_civil','estabilidad_obra','todo_riesgo','otra') NOT NULL,
      insurer VARCHAR(255) NULL,
      policy_number VARCHAR(100) NULL,
      coverage_pct DECIMAL(5,2) NULL,
      insured_value DECIMAL(18,2) NULL,
      issue_date DATE NULL,
      expiry_date DATE NULL,
      status ENUM('vigente','por_vencer','vencida','en_renovacion','pendiente') NOT NULL DEFAULT 'pendiente',
      document_id INT NULL,
      required_by_contract TINYINT(1) DEFAULT 1,
      extraction_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_status (status),
      INDEX idx_expiry (expiry_date),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      FOREIGN KEY (extraction_id) REFERENCES ia_extractions(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ policies');

  // ── 11. budget_items ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS budget_items (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      parent_id INT NULL,
      item_code VARCHAR(50) NULL,
      description VARCHAR(500) NOT NULL,
      unit VARCHAR(50) NULL,
      quantity DECIMAL(14,4) NULL,
      unit_value DECIMAL(18,2) NULL,
      total_value DECIMAL(18,2) NULL,
      aiu_pct DECIMAL(5,2) NULL,
      level INT NOT NULL DEFAULT 0,
      sort_order INT DEFAULT 0,
      is_baseline TINYINT(1) DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_parent (parent_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES budget_items(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ budget_items');

  // ── 12. team_members ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS team_members (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      user_id INT NULL,
      full_name VARCHAR(255) NOT NULL,
      role_in_project VARCHAR(100) NOT NULL,
      required_profession VARCHAR(255) NULL,
      required_experience_years INT NULL,
      required_certifications TEXT NULL,
      actual_profession VARCHAR(255) NULL,
      actual_experience_years INT NULL,
      actual_certifications TEXT NULL,
      dedication_pct DECIMAL(5,2) NULL DEFAULT 100.00,
      join_date DATE NULL,
      leave_date DATE NULL,
      status ENUM('activo','inactivo','por_reemplazar') NOT NULL DEFAULT 'activo',
      profile_compliant TINYINT(1) NULL,
      compliance_notes TEXT NULL,
      extraction_id INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_user (user_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (extraction_id) REFERENCES ia_extractions(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ team_members');

  // ── 13. project_charters ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS project_charters (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL UNIQUE,
      content JSON NOT NULL,
      generated_file_path VARCHAR(1000) NULL,
      status ENUM('borrador','aprobado') NOT NULL DEFAULT 'borrador',
      approved_by INT NULL,
      approved_at DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ project_charters');

  // ── 14. obligation_evidence ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS obligation_evidence (
      id INT AUTO_INCREMENT PRIMARY KEY,
      obligation_id INT NOT NULL,
      document_id INT NULL,
      description VARCHAR(500) NULL,
      uploaded_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_obligation (obligation_id),
      FOREIGN KEY (obligation_id) REFERENCES obligations(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ obligation_evidence');

  await conn.end();
  console.log('\n🎉 Migración Módulo 1 completada — 14 tablas creadas/actualizadas');
}

migrate().catch((err) => {
  console.error('❌ Error en migración:', err.message);
  process.exit(1);
});
