/**
 * SGIP-IA — Migración Módulo 2: Ejecución y Seguimiento
 * Run: node scripts/migrate-m2.js
 * Creates 6 tables for execution tracking.
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
  console.log('🔌 Conectado — Migración Módulo 2\n');

  // ── 1. schedule_activities — Cronograma/Gantt ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS schedule_activities (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      parent_id INT NULL,
      wbs_code VARCHAR(50) NULL,
      name VARCHAR(500) NOT NULL,
      description TEXT NULL,
      activity_type ENUM('summary','task','milestone') NOT NULL DEFAULT 'task',
      start_date DATE NULL,
      end_date DATE NULL,
      baseline_start DATE NULL,
      baseline_end DATE NULL,
      duration_days INT NULL,
      progress_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      weight_pct DECIMAL(5,2) NULL DEFAULT 0.00,
      predecessor_ids JSON NULL,
      assigned_to VARCHAR(255) NULL,
      status ENUM('no_iniciada','en_progreso','completada','atrasada','suspendida') NOT NULL DEFAULT 'no_iniciada',
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_parent (parent_id),
      INDEX idx_status (status),
      INDEX idx_dates (start_date, end_date),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES schedule_activities(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ schedule_activities (Cronograma/Gantt)');

  // ── 2. progress_records — Avance físico y financiero ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS progress_records (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      period_label VARCHAR(50) NOT NULL,
      period_date DATE NOT NULL,
      physical_planned DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      physical_actual DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      financial_planned DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      financial_actual DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      observations TEXT NULL,
      recorded_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_period (period_date),
      UNIQUE KEY uq_project_period (project_id, period_date),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ progress_records (Avance físico/financiero)');

  // ── 3. payments — Control de pagos/facturación ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS payments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      payment_number INT NOT NULL,
      payment_type ENUM('anticipo','corte_mensual','corte_parcial','pago_final','otro') NOT NULL DEFAULT 'corte_mensual',
      concept VARCHAR(500) NOT NULL,
      period_from DATE NULL,
      period_to DATE NULL,
      gross_value DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      amortization DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      retention_pct DECIMAL(5,2) NOT NULL DEFAULT 0.00,
      retention_value DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      taxes DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      net_value DECIMAL(18,2) NOT NULL DEFAULT 0.00,
      invoice_number VARCHAR(100) NULL,
      invoice_date DATE NULL,
      status ENUM('borrador','presentado','en_revision','aprobado','pagado','rechazado') NOT NULL DEFAULT 'borrador',
      approved_by INT NULL,
      approved_at DATETIME NULL,
      paid_at DATE NULL,
      document_id INT NULL,
      notes TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_status (status),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ payments (Control de pagos)');

  // ── 4. meeting_minutes — Actas e Informes ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS meeting_minutes (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      minute_number INT NOT NULL,
      minute_type ENUM('comite_obra','comite_seguimiento','reunion_tecnica','reunion_financiera','otro') NOT NULL DEFAULT 'comite_seguimiento',
      title VARCHAR(500) NOT NULL,
      meeting_date DATE NOT NULL,
      location VARCHAR(255) NULL,
      attendees JSON NULL,
      agenda TEXT NULL,
      discussions TEXT NULL,
      agreements JSON NULL,
      action_items JSON NULL,
      next_meeting_date DATE NULL,
      status ENUM('borrador','firmada','archivada') NOT NULL DEFAULT 'borrador',
      document_id INT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_date (meeting_date),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ meeting_minutes (Actas e Informes)');

  // ── 5. change_orders — Gestión de cambios y adiciones ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS change_orders (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      change_number INT NOT NULL,
      change_type ENUM('adicion_presupuestal','adicion_plazo','modificacion_alcance','otro_si','suspension','reinicio') NOT NULL,
      title VARCHAR(500) NOT NULL,
      justification TEXT NOT NULL,
      requested_date DATE NOT NULL,
      impact_cost DECIMAL(18,2) NULL DEFAULT 0.00,
      impact_days INT NULL DEFAULT 0,
      new_contract_value DECIMAL(18,2) NULL,
      new_end_date DATE NULL,
      status ENUM('solicitado','en_revision','aprobado','rechazado','implementado') NOT NULL DEFAULT 'solicitado',
      approved_by INT NULL,
      approved_at DATETIME NULL,
      document_id INT NULL,
      notes TEXT NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_status (status),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
      FOREIGN KEY (document_id) REFERENCES documents(id) ON DELETE SET NULL,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ change_orders (Cambios y adiciones)');

  // ── 6. risks — Control de riesgos ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS risks (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      risk_code VARCHAR(20) NULL,
      category ENUM('tecnico','financiero','legal','ambiental','social','operativo','externo') NOT NULL DEFAULT 'operativo',
      description TEXT NOT NULL,
      probability ENUM('muy_baja','baja','media','alta','muy_alta') NOT NULL DEFAULT 'media',
      impact ENUM('muy_bajo','bajo','medio','alto','muy_alto') NOT NULL DEFAULT 'medio',
      risk_score INT GENERATED ALWAYS AS (
        (CASE probability WHEN 'muy_baja' THEN 1 WHEN 'baja' THEN 2 WHEN 'media' THEN 3 WHEN 'alta' THEN 4 WHEN 'muy_alta' THEN 5 END)
        * (CASE impact WHEN 'muy_bajo' THEN 1 WHEN 'bajo' THEN 2 WHEN 'medio' THEN 3 WHEN 'alto' THEN 4 WHEN 'muy_alto' THEN 5 END)
      ) STORED,
      risk_level VARCHAR(10) GENERATED ALWAYS AS (
        CASE WHEN risk_score >= 15 THEN 'critico' WHEN risk_score >= 8 THEN 'alto' WHEN risk_score >= 4 THEN 'medio' ELSE 'bajo' END
      ) STORED,
      mitigation_plan TEXT NULL,
      contingency_plan TEXT NULL,
      responsible VARCHAR(255) NULL,
      trigger_event TEXT NULL,
      status ENUM('identificado','mitigando','materializado','cerrado') NOT NULL DEFAULT 'identificado',
      identified_date DATE NOT NULL DEFAULT (CURDATE()),
      close_date DATE NULL,
      created_by INT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_score (risk_score),
      INDEX idx_status (status),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ risks (Control de riesgos)');

  await conn.end();
  console.log('\n🎉 Migración Módulo 2 completada — 6 tablas creadas');
}

migrate().catch((err) => {
  console.error('❌ Error en migración M2:', err.message);
  process.exit(1);
});
