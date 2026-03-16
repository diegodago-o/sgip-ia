/**
 * SGIP-IA - Database Initialization
 * Run: node scripts/init-db.js
 * Creates the database and initial tables.
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_NAME = process.env.DB_NAME || 'sgip_ia';

async function initDatabase() {
  // Connect without database to create it
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
  });

  console.log('🔌 Conectado a MySQL');

  // Create database
  await conn.execute(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  console.log(`📦 Base de datos "${DB_NAME}" lista`);

  await conn.changeUser({ database: DB_NAME });

  // ── Users table ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS users (
      id INT AUTO_INCREMENT PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      role ENUM('admin', 'director', 'consultor', 'visor') NOT NULL DEFAULT 'consultor',
      avatar_url VARCHAR(500) NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      last_login DATETIME NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_email (email),
      INDEX idx_role (role)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ Tabla "users" creada');

  // ── Audit log table ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      user_id INT NULL,
      action VARCHAR(100) NOT NULL,
      entity_type VARCHAR(50) NULL,
      entity_id INT NULL,
      details JSON NULL,
      ip_address VARCHAR(45) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_user (user_id),
      INDEX idx_action (action),
      INDEX idx_created (created_at),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ Tabla "audit_log" creada');

  // ── Projects table (structure ready for Module 1) ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS projects (
      id INT AUTO_INCREMENT PRIMARY KEY,
      code VARCHAR(20) NOT NULL UNIQUE,
      name VARCHAR(500) NOT NULL,
      project_type ENUM('obra_civil', 'ti', 'consultoria', 'interventoria', 'asesoria', 'mixto', 'otro') NOT NULL,
      sector ENUM('publico', 'privado') NOT NULL,
      client_name VARCHAR(500) NOT NULL,
      client_nit VARCHAR(20) NULL,
      contract_number VARCHAR(100) NULL,
      contract_object TEXT NULL,
      contract_value DECIMAL(18,2) NULL,
      sign_date DATE NULL,
      start_date DATE NULL,
      execution_term INT NULL,
      execution_term_unit ENUM('dias_calendario', 'dias_habiles', 'meses', 'anos') DEFAULT 'dias_calendario',
      estimated_end_date DATE NULL,
      supervisor VARCHAR(255) NULL,
      director_id INT NULL,
      location VARCHAR(255) NULL,
      status ENUM('adjudicado', 'en_arranque', 'en_ejecucion', 'suspendido', 'cerrado', 'liquidado') NOT NULL DEFAULT 'adjudicado',
      priority ENUM('alta', 'media', 'baja') NOT NULL DEFAULT 'media',
      progress_pct DECIMAL(5,2) DEFAULT 0.00,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_status (status),
      INDEX idx_sector (sector),
      INDEX idx_type (project_type),
      FOREIGN KEY (director_id) REFERENCES users(id) ON DELETE SET NULL
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ Tabla "projects" creada');

  await conn.end();
  console.log('\n🎉 Base de datos inicializada correctamente');
}

initDatabase().catch((err) => {
  console.error('❌ Error inicializando base de datos:', err.message);
  process.exit(1);
});
