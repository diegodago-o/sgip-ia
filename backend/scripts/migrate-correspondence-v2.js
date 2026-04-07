/**
 * migrate-correspondence-v2.js
 * Agrega soporte completo de correspondencia de ENTRADA y SALIDA:
 *   - Campo direction (salida/entrada)
 *   - parent_id para hilos de respuesta
 *   - Campos del remitente externo (entrada)
 *   - Adjunto de documento recibido
 *   - Responsable asignado
 *   - Radicado de entrada (numeración independiente)
 *   - Nuevo estado en_atencion en el ENUM de status
 *
 * SEGURO: todos los ALTER son IF NOT EXISTS o MODIFY sin pérdida de datos.
 * Los registros existentes quedan con direction='salida' (DEFAULT).
 */
require('dotenv').config();
const path = require('path');
const fs   = require('fs');
const pool = require('../src/config/database');

async function migrate() {
  console.log('📬 Migrando correspondencia v2 (Entrada / Salida)...');
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // ── 1. Campo direction ───────────────────────────────────────────────────
    await conn.execute(`
      ALTER TABLE correspondence
        ADD COLUMN IF NOT EXISTS direction
          ENUM('salida','entrada') NOT NULL DEFAULT 'salida'
          AFTER project_id
    `);
    console.log('  ✓ direction');

    // ── 2. parent_id — vinculación de hilos ──────────────────────────────────
    await conn.execute(`
      ALTER TABLE correspondence
        ADD COLUMN IF NOT EXISTS parent_id INT NULL
          AFTER direction
    `);
    console.log('  ✓ parent_id');

    // ── 3. Radicado de entrada (numeración independiente de salida) ──────────
    await conn.execute(`
      ALTER TABLE correspondence
        ADD COLUMN IF NOT EXISTS radicado_entrada VARCHAR(100) NULL
          AFTER radicado_number
    `);
    console.log('  ✓ radicado_entrada');

    // ── 4. Remitente externo (quien nos envió la correspondencia) ─────────────
    await conn.execute(`
      ALTER TABLE correspondence
        ADD COLUMN IF NOT EXISTS sender_entity_external VARCHAR(300) NULL
          AFTER notes
    `);
    await conn.execute(`
      ALTER TABLE correspondence
        ADD COLUMN IF NOT EXISTS sender_name_external VARCHAR(200) NULL
          AFTER sender_entity_external
    `);
    console.log('  ✓ sender_entity_external / sender_name_external');

    // ── 5. Fecha de recepción (distinta de reference_date) ───────────────────
    await conn.execute(`
      ALTER TABLE correspondence
        ADD COLUMN IF NOT EXISTS received_date DATE NULL
          AFTER sender_name_external
    `);
    console.log('  ✓ received_date');

    // ── 6. Adjunto del documento recibido ────────────────────────────────────
    await conn.execute(`
      ALTER TABLE correspondence
        ADD COLUMN IF NOT EXISTS attachment_path VARCHAR(500) NULL
          AFTER received_date
    `);
    await conn.execute(`
      ALTER TABLE correspondence
        ADD COLUMN IF NOT EXISTS attachment_original_name VARCHAR(300) NULL
          AFTER attachment_path
    `);
    console.log('  ✓ attachment_path / attachment_original_name');

    // ── 7. Responsable asignado ──────────────────────────────────────────────
    await conn.execute(`
      ALTER TABLE correspondence
        ADD COLUMN IF NOT EXISTS assigned_to INT NULL
          AFTER attachment_original_name
    `);
    console.log('  ✓ assigned_to');

    // ── 8. ENUM status: agregar en_atencion ───────────────────────────────────
    // MySQL permite MODIFY COLUMN en ENUM sin pérdida de datos existentes.
    await conn.execute(`
      ALTER TABLE correspondence
        MODIFY COLUMN status
          ENUM('borrador','radicado','enviado','recibido','en_atencion','respondido','archivado')
          NOT NULL DEFAULT 'borrador'
    `);
    console.log('  ✓ status ENUM ampliado (+ en_atencion)');

    // ── 9. Índices ───────────────────────────────────────────────────────────
    // Ignoramos error si el índice ya existe
    try {
      await conn.execute(`ALTER TABLE correspondence ADD INDEX idx_corr_direction (direction)`);
      console.log('  ✓ idx_corr_direction');
    } catch (_) { console.log('  · idx_corr_direction ya existe'); }

    try {
      await conn.execute(`ALTER TABLE correspondence ADD INDEX idx_corr_parent (parent_id)`);
      console.log('  ✓ idx_corr_parent');
    } catch (_) { console.log('  · idx_corr_parent ya existe'); }

    // ── 10. FK parent_id ─────────────────────────────────────────────────────
    try {
      await conn.execute(`
        ALTER TABLE correspondence
          ADD CONSTRAINT fk_corr_parent
          FOREIGN KEY (parent_id) REFERENCES correspondence(id) ON DELETE SET NULL
      `);
      console.log('  ✓ FK fk_corr_parent');
    } catch (_) { console.log('  · FK fk_corr_parent ya existe'); }

    // ── 11. FK assigned_to ───────────────────────────────────────────────────
    try {
      await conn.execute(`
        ALTER TABLE correspondence
          ADD CONSTRAINT fk_corr_assigned
          FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
      `);
      console.log('  ✓ FK fk_corr_assigned');
    } catch (_) { console.log('  · FK fk_corr_assigned ya existe'); }

    // ── 12. Directorio de adjuntos ───────────────────────────────────────────
    const uploadDir = path.join(__dirname, '..', 'uploads', 'correspondence');
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
      console.log('  ✓ directorio uploads/correspondence creado');
    } else {
      console.log('  · directorio uploads/correspondence ya existe');
    }

    await conn.commit();
    console.log('\n✅ Migración v2 completada correctamente.');
  } catch (err) {
    await conn.rollback();
    console.error('❌ Error en migración v2:', err.message);
    process.exit(1);
  } finally {
    conn.release();
    process.exit(0);
  }
}

migrate();
