/**
 * SGIP-IA — Migration: Roles & Permissions System
 * Run: node scripts/migrate-roles.js
 */
require('dotenv').config();
const pool = require('../src/config/database');

async function migrate() {
  console.log('🔐 Migrando sistema de roles y permisos...\n');

  // 1. First expand ENUM to include BOTH old and new values (so no data is truncated)
  await pool.execute(`
    ALTER TABLE users 
    MODIFY COLUMN role ENUM('admin', 'director', 'consultor', 'visor', 'gerente_proyecto', 'director_pmo', 'ceo', 'apoyo') 
    NOT NULL DEFAULT 'apoyo'
  `);
  console.log('✅ ENUM expandido temporalmente');

  // 2. Migrate existing users to new roles
  await pool.execute("UPDATE users SET role = 'director_pmo' WHERE role = 'director'");
  await pool.execute("UPDATE users SET role = 'gerente_proyecto' WHERE role = 'consultor'");
  await pool.execute("UPDATE users SET role = 'ceo' WHERE role = 'visor'");
  console.log('✅ Roles migrados (director→director_pmo, consultor→gerente_proyecto, visor→ceo)');

  // 3. Now restrict ENUM to only new values
  await pool.execute(`
    ALTER TABLE users 
    MODIFY COLUMN role ENUM('admin', 'gerente_proyecto', 'director_pmo', 'ceo', 'apoyo') 
    NOT NULL DEFAULT 'apoyo'
  `);
  console.log('✅ Roles actualizados en tabla users');

  // 2. Add phone and position fields to users
  try {
    await pool.execute(`ALTER TABLE users ADD COLUMN phone VARCHAR(20) NULL AFTER full_name`);
    await pool.execute(`ALTER TABLE users ADD COLUMN position VARCHAR(150) NULL AFTER phone`);
    console.log('✅ Campos phone y position agregados a users');
  } catch (e) {
    if (e.code === 'ER_DUP_FIELDNAME') console.log('ℹ️  Campos phone/position ya existen');
    else throw e;
  }

  // 3. Create project_assignments table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS project_assignments (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      user_id INT NOT NULL,
      role_in_project ENUM('gerente_proyecto', 'apoyo') NOT NULL,
      assigned_by INT NULL,
      assigned_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      notes TEXT NULL,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (assigned_by) REFERENCES users(id) ON DELETE SET NULL,
      UNIQUE KEY uk_project_user (project_id, user_id),
      INDEX idx_user (user_id),
      INDEX idx_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ Tabla project_assignments creada');

  // 4. Seed demo users for each role
  const bcrypt = require('bcryptjs');
  const hash = await bcrypt.hash('sgip2025', 10);
  
  const demoUsers = [
    { email: 'gp@sgip-ia.com', name: 'María González', role: 'gerente_proyecto', position: 'Gerente de Proyectos' },
    { email: 'pmo@sgip-ia.com', name: 'Ricardo Vargas', role: 'director_pmo', position: 'Director PMO' },
    { email: 'ceo@sgip-ia.com', name: 'Laura Méndez', role: 'ceo', position: 'Directora General' },
    { email: 'apoyo@sgip-ia.com', name: 'Andrés Ruiz', role: 'apoyo', position: 'Profesional de Seguimiento' },
  ];

  for (const u of demoUsers) {
    await pool.execute(
      `INSERT INTO users (email, password_hash, full_name, role, position)
       VALUES (?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE full_name = VALUES(full_name), role = VALUES(role), position = VALUES(position)`,
      [u.email, hash, u.name, u.role, u.position]
    );
    console.log(`✅ Usuario ${u.role}: ${u.email} / sgip2025`);
  }

  // 5. Auto-assign GP to existing projects
  const [gps] = await pool.execute("SELECT id FROM users WHERE role = 'gerente_proyecto' LIMIT 1");
  if (gps.length > 0) {
    const [projects] = await pool.execute('SELECT id FROM projects');
    for (const p of projects) {
      await pool.execute(
        `INSERT IGNORE INTO project_assignments (project_id, user_id, role_in_project, assigned_by)
         VALUES (?, ?, 'gerente_proyecto', ?)`,
        [p.id, gps[0].id, gps[0].id]
      );
    }
    console.log(`✅ GP asignado a ${projects.length} proyectos existentes`);
  }

  await pool.end();
  console.log('\n🎉 Migración de roles completada');
  console.log('\n📋 Usuarios demo:');
  console.log('   admin@sgip-ia.com     / admin123   → Administrador');
  console.log('   gp@sgip-ia.com        / sgip2025   → Gerente de Proyecto');
  console.log('   pmo@sgip-ia.com       / sgip2025   → Director PMO');
  console.log('   ceo@sgip-ia.com       / sgip2025   → CEO');
  console.log('   apoyo@sgip-ia.com     / sgip2025   → Apoyo/Seguimiento');
}

migrate().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
