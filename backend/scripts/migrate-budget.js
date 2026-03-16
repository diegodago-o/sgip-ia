/**
 * SGIP-IA — Migración Presupuesto v2
 * Run: node scripts/migrate-budget.js
 * 
 * Model:
 *   budget_income       - Ingresos del proyecto
 *   budget_payroll       - Personal por nómina (prestaciones auto-calculadas)
 *   budget_contractors   - Personal por honorarios (tipos de contrato, ARL)
 *   budget_expenses      - Gastos generales agrupados por categoría (arriendos, legales, servicios, viajes, activos)
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

  // Drop old generic tables if they exist
  await conn.execute('DROP TABLE IF EXISTS budget_entries');
  await conn.execute('DROP TABLE IF EXISTS budget_sections');
  console.log('🗑️  Tablas antiguas eliminadas (si existían)\n');

  // ── budget_income ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS budget_income (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      label VARCHAR(255) NOT NULL,
      value DECIMAL(18,2) NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      notes VARCHAR(500) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ budget_income');

  // ── budget_payroll (personal por nómina) ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS budget_payroll (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      cargo VARCHAR(255) NOT NULL,
      cantidad INT NOT NULL DEFAULT 1,
      salario_base DECIMAL(18,2) NOT NULL,
      aux_transporte DECIMAL(18,2) NOT NULL DEFAULT 0,
      mes_inicio INT NOT NULL DEFAULT 1 COMMENT 'Mes en que inicia (1-based)',
      mes_fin INT NULL COMMENT 'Mes en que termina (null = todo el proyecto)',
      -- Factores de prestaciones (% sobre salario base, precargados con valores legales)
      pct_prima DECIMAL(6,3) NOT NULL DEFAULT 8.333,
      pct_vacaciones DECIMAL(6,3) NOT NULL DEFAULT 4.167,
      pct_cesantias DECIMAL(6,3) NOT NULL DEFAULT 8.333,
      pct_int_cesantias DECIMAL(6,3) NOT NULL DEFAULT 1.000,
      pct_arl DECIMAL(6,3) NOT NULL DEFAULT 0.522,
      pct_pension DECIMAL(6,3) NOT NULL DEFAULT 12.000,
      pct_ccf DECIMAL(6,3) NOT NULL DEFAULT 4.000,
      pct_icbf DECIMAL(6,3) NOT NULL DEFAULT 3.000,
      pct_sena DECIMAL(6,3) NOT NULL DEFAULT 2.000,
      pct_salud DECIMAL(6,3) NOT NULL DEFAULT 8.500,
      -- Computed fields (stored for queries)
      costo_mensual DECIMAL(18,2) NULL COMMENT 'Salario + aux + prestaciones mensual',
      meses_vinculacion INT NULL COMMENT 'mes_fin - mes_inicio + 1',
      costo_total DECIMAL(18,2) NULL COMMENT 'costo_mensual * cantidad * meses',
      notes TEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ budget_payroll');

  // ── budget_contractors (personal por honorarios) ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS budget_contractors (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      cargo VARCHAR(255) NOT NULL,
      cantidad INT NOT NULL DEFAULT 1,
      tipo_contrato ENUM('mensual','por_horas','por_productos') NOT NULL DEFAULT 'mensual',
      valor_mensual DECIMAL(18,2) NULL COMMENT 'Para tipo mensual',
      valor_hora DECIMAL(18,2) NULL COMMENT 'Para tipo por_horas',
      horas_mes DECIMAL(8,2) NULL COMMENT 'Horas estimadas por mes',
      valor_producto DECIMAL(18,2) NULL COMMENT 'Para tipo por_productos',
      cantidad_productos INT NULL,
      arl_nivel ENUM('I','II','III','IV','V') NULL DEFAULT 'I',
      arl_pct DECIMAL(6,3) NULL DEFAULT 0.522,
      arl_valor_mensual DECIMAL(18,2) NULL,
      mes_inicio INT NOT NULL DEFAULT 1,
      mes_fin INT NULL,
      costo_mensual DECIMAL(18,2) NULL,
      meses_vinculacion INT NULL,
      costo_total DECIMAL(18,2) NULL,
      notes TEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ budget_contractors');

  // ── budget_expenses (gastos generales con categoría) ──
  await conn.execute(`
    CREATE TABLE IF NOT EXISTS budget_expenses (
      id INT AUTO_INCREMENT PRIMARY KEY,
      project_id INT NOT NULL,
      category ENUM('arriendo_equipos','gastos_legales','servicios_publicos','gastos_viaje','activos_fijos','otros') NOT NULL,
      label VARCHAR(500) NOT NULL,
      cantidad DECIMAL(14,4) NULL DEFAULT 1,
      valor_unitario DECIMAL(18,2) NULL DEFAULT 0,
      mes_inicio INT NOT NULL DEFAULT 1,
      mes_fin INT NULL COMMENT 'null = todo el proyecto',
      meses INT NULL COMMENT 'Computed: mes_fin - mes_inicio + 1',
      valor_mensual DECIMAL(18,2) NULL COMMENT 'cantidad * valor_unitario',
      valor_total DECIMAL(18,2) NULL COMMENT 'valor_mensual * meses',
      notes TEXT NULL,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      INDEX idx_project (project_id),
      INDEX idx_category (category),
      FOREIGN KEY (project_id) REFERENCES projects(id) ON DELETE CASCADE
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
  `);
  console.log('✅ budget_expenses');

  await conn.end();
  console.log('\n🎉 Migración presupuesto v2 completada — 4 tablas');
}

migrate().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
