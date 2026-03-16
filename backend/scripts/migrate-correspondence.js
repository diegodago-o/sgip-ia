require('dotenv').config();
const pool = require('../src/config/database');

async function migrate() {
  console.log('📬 Migrando módulo de Correspondencia...');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    await conn.execute(`
      CREATE TABLE IF NOT EXISTS correspondence (
        id                  INT AUTO_INCREMENT PRIMARY KEY,
        project_id          INT NOT NULL,
        consecutive_num     INT NOT NULL DEFAULT 1,
        consecutive_code    VARCHAR(60) NOT NULL UNIQUE,
        correspondence_type ENUM('oficio','circular','memorando','comunicado','carta','radicado','derecho_peticion') NOT NULL DEFAULT 'oficio',
        subject             VARCHAR(500) NOT NULL,
        reference_date      DATE NOT NULL,

        -- Destinatario
        recipient_name      VARCHAR(200),
        recipient_title     VARCHAR(200),
        recipient_entity    VARCHAR(300),
        recipient_address   VARCHAR(300),
        recipient_city      VARCHAR(100) DEFAULT 'Bogotá D.C.',

        -- Remitente
        sender_name         VARCHAR(200),
        sender_title        VARCHAR(200),

        -- Cuerpo
        body                TEXT,
        closing             VARCHAR(300),

        -- Datos del contrato (auto-llenados desde el proyecto)
        contract_reference  VARCHAR(200),
        project_entity      VARCHAR(300),
        project_start_date  DATE,
        project_object      TEXT,

        -- Estado y radicación
        status              ENUM('borrador','radicado','enviado','recibido','respondido','archivado') NOT NULL DEFAULT 'borrador',
        radicado_number     VARCHAR(100),
        sent_date           DATE,
        response_date       DATE,
        notes               TEXT,

        -- Prompt IA usado para generar
        ai_prompt           TEXT,

        -- Metadata
        created_by          INT,
        created_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at          TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

        FOREIGN KEY (project_id)  REFERENCES projects(id)  ON DELETE CASCADE,
        FOREIGN KEY (created_by)  REFERENCES users(id)     ON DELETE SET NULL,
        INDEX idx_corr_project    (project_id),
        INDEX idx_corr_status     (status),
        INDEX idx_corr_date       (reference_date)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
    `);

    await conn.commit();
    console.log('✅ Tabla correspondence creada correctamente.');
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error en migración:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
