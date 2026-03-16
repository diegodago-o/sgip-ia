/**
 * SGIP-IA - Database Seeder
 * Run: node scripts/seed.js
 * Creates a demo admin user for development.
 */
require('dotenv').config();
const bcrypt = require('bcryptjs');
const pool = require('../src/config/database');

async function seed() {
  console.log('🌱 Sembrando datos iniciales...\n');

  const passwordHash = await bcrypt.hash('admin123', 10);

  // Demo admin user
  await pool.execute(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`,
    ['admin@sgip-ia.com', passwordHash, 'Administrador SGIP', 'admin']
  );
  console.log('✅ Usuario admin creado: admin@sgip-ia.com / admin123');

  // Demo director user
  const directorHash = await bcrypt.hash('director123', 10);
  await pool.execute(
    `INSERT INTO users (email, password_hash, full_name, role)
     VALUES (?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE full_name = VALUES(full_name)`,
    ['director@sgip-ia.com', directorHash, 'Carlos Rodríguez', 'director']
  );
  console.log('✅ Usuario director creado: director@sgip-ia.com / director123');

  await pool.end();
  console.log('\n🎉 Seed completado');
}

seed().catch((err) => {
  console.error('❌ Error en seed:', err.message);
  process.exit(1);
});
