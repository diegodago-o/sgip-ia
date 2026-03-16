/**
 * Migración: Tabla committee_commitments
 * Compromisos nativos de sesiones de comité (independientes de actas)
 */
const pool = require('../src/config/database');

async function migrate() {
  console.log('🔄 Creando tabla committee_commitments...');

  await pool.execute(`
    CREATE TABLE IF NOT EXISTS committee_commitments (
      id              INT AUTO_INCREMENT PRIMARY KEY,
      project_id      INT NOT NULL,
      description     TEXT NOT NULL,
      responsible     VARCHAR(255),
      due_date        DATE,
      status          ENUM('pendiente','en_progreso','cumplido','cancelado') DEFAULT 'pendiente',
      priority        ENUM('alta','media','baja') DEFAULT 'media',
      origin_date     DATE NOT NULL COMMENT 'Fecha del comité donde surgió',
      committee_type  ENUM('comite_seguimiento','comite_obra','reunion_tecnica','reunion_financiera','otro') DEFAULT 'comite_seguimiento',
      notes           TEXT,
      evidence        TEXT,
      completed_date  DATE,
      created_by      INT,
      created_at      DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      INDEX idx_project  (project_id),
      INDEX idx_status   (status),
      INDEX idx_due_date (due_date),
      INDEX idx_origin   (origin_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);

  console.log('✅ Tabla committee_commitments creada correctamente.');
  process.exit(0);
}

migrate().catch(err => {
  console.error('❌ Error en migración:', err);
  process.exit(1);
});
