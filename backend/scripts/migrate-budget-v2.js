/**
 * SGIP-IA — Migration: Budget Restructure (PUC + Deductions)
 * Run: node scripts/migrate-budget-v2.js
 */
require('dotenv').config();
const pool = require('../src/config/database');

async function migrate() {
  console.log('💰 Reestructurando módulo de presupuesto...\n');

  // 1. Add IVA fields to budget_income
  const incomeAlters = [
    "ADD COLUMN tipo ENUM('ingreso','descuento','informativo') NOT NULL DEFAULT 'ingreso' AFTER label",
    "ADD COLUMN es_iva TINYINT(1) NOT NULL DEFAULT 0 AFTER tipo",
    "ADD COLUMN es_total_con_iva TINYINT(1) NOT NULL DEFAULT 0 AFTER es_iva",
    "ADD COLUMN editable TINYINT(1) NOT NULL DEFAULT 1 AFTER notes",
  ];
  for (const alter of incomeAlters) {
    try { await pool.execute(`ALTER TABLE budget_income ${alter}`); } catch (e) { if (e.code !== 'ER_DUP_FIELDNAME') throw e; }
  }
  console.log('✅ budget_income: campos tipo, es_iva, es_total_con_iva, editable agregados');

  // Mark existing rows
  await pool.execute("UPDATE budget_income SET es_iva=1 WHERE label LIKE '%IVA Generado%'");
  await pool.execute("UPDATE budget_income SET es_total_con_iva=1, editable=0 WHERE label LIKE '%con IVA%'");
  await pool.execute("UPDATE budget_income SET tipo='descuento' WHERE label IN ('Retefuente','Estampillas','Gravamen al manejo financiero')");

  // 2. Create PUC accounts table
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS budget_puc_accounts (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      cuenta VARCHAR(20) NOT NULL,
      nombre VARCHAR(200) NOT NULL,
      parent_cuenta VARCHAR(20) NULL,
      nivel INT NOT NULL DEFAULT 0,
      valor DECIMAL(18,2) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      es_subtotal TINYINT(1) NOT NULL DEFAULT 0,
      es_predefinida TINYINT(1) NOT NULL DEFAULT 1,
      notas TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE KEY uk_project_cuenta (project_id, cuenta),
      INDEX idx_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ Tabla budget_puc_accounts creada');

  // 3. Create deductions table (Retenciones, Activos Fijos, GNC)
  await pool.execute(`
    CREATE TABLE IF NOT EXISTS budget_deductions (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      codigo VARCHAR(20) NOT NULL,
      nombre VARCHAR(200) NOT NULL,
      tipo ENUM('retencion','activo_fijo','gnc','otro') NOT NULL,
      valor DECIMAL(18,2) NOT NULL DEFAULT 0,
      porcentaje DECIMAL(8,4) NULL,
      base_calculo ENUM('ingresos','ganancia_contable','manual') NOT NULL DEFAULT 'manual',
      sort_order INT NOT NULL DEFAULT 0,
      notas TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE,
      UNIQUE KEY uk_project_codigo (project_id, codigo),
      INDEX idx_project (project_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ Tabla budget_deductions creada');

  // 4. Seed PUC accounts for existing projects
  const [projects] = await pool.execute('SELECT id FROM projects');
  for (const p of projects) {
    await seedPUC(p.id);
    await seedDeductions(p.id);
  }
  console.log(`✅ PUC y deducciones inicializadas para ${projects.length} proyectos`);

  await pool.end();
  console.log('\n🎉 Reestructuración de presupuesto completada');
}

async function seedPUC(projectId) {
  const accounts = [
    // Ingresos (cuenta 4)
    { cuenta: '4',    nombre: 'INGRESOS',                parent: null, nivel: 0, sort: 0,  subtotal: 1 },
    { cuenta: '41',   nombre: 'Operacionales',            parent: '4',  nivel: 1, sort: 1,  subtotal: 1 },
    // Gastos (cuenta 5)
    { cuenta: '5',    nombre: 'GASTOS',                   parent: null, nivel: 0, sort: 10, subtotal: 1 },
    { cuenta: '5105', nombre: 'Gastos de personal',        parent: '5',  nivel: 1, sort: 11, subtotal: 1 },
    { cuenta: '5110', nombre: 'Honorarios',                parent: '5',  nivel: 1, sort: 12 },
    { cuenta: '5120', nombre: 'Arrendamientos',            parent: '5',  nivel: 1, sort: 13 },
    { cuenta: '5130', nombre: 'Seguros',                   parent: '5',  nivel: 1, sort: 14 },
    { cuenta: '5135', nombre: 'Servicios',                 parent: '5',  nivel: 1, sort: 15 },
    { cuenta: '5140', nombre: 'Gastos legales',            parent: '5',  nivel: 1, sort: 16 },
    { cuenta: '5145', nombre: 'Mantenimiento y reparaciones', parent: '5', nivel: 1, sort: 17 },
    { cuenta: '5150', nombre: 'Adecuación e instalación',  parent: '5',  nivel: 1, sort: 18 },
    { cuenta: '5155', nombre: 'Gastos de viaje',           parent: '5',  nivel: 1, sort: 19 },
    { cuenta: '5195', nombre: 'Diversos',                  parent: '5',  nivel: 1, sort: 20 },
    { cuenta: '5305', nombre: 'Financieros',               parent: '5',  nivel: 1, sort: 21 },
  ];

  for (const a of accounts) {
    await pool.execute(
      `INSERT IGNORE INTO budget_puc_accounts (project_id, cuenta, nombre, parent_cuenta, nivel, sort_order, es_subtotal, es_predefinida)
       VALUES (?,?,?,?,?,?,?,1)`,
      [projectId, a.cuenta, a.nombre, a.parent || null, a.nivel, a.sort, a.subtotal ? 1 : 0]
    );
  }
}

async function seedDeductions(projectId) {
  const deductions = [
    { codigo: 'R',   nombre: 'Retenciones',                tipo: 'retencion',   sort: 0, pct: 4.0, base: 'ingresos' },
    { codigo: 'AF',  nombre: 'Activos fijos',              tipo: 'activo_fijo', sort: 1, pct: null, base: 'manual' },
    { codigo: 'GNC', nombre: 'Gastos No Contabilizados',   tipo: 'gnc',         sort: 2, pct: null, base: 'manual' },
  ];

  for (const d of deductions) {
    await pool.execute(
      `INSERT IGNORE INTO budget_deductions (project_id, codigo, nombre, tipo, porcentaje, base_calculo, sort_order)
       VALUES (?,?,?,?,?,?,?)`,
      [projectId, d.codigo, d.nombre, d.tipo, d.pct, d.base, d.sort]
    );
  }
}

migrate().catch(err => { console.error('❌ Error:', err.message); process.exit(1); });
