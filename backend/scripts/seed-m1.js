/**
 * SGIP-IA — Seed Módulo 1
 * Run: node scripts/seed-m1.js
 * Creates demo projects and related data for development.
 */
require('dotenv').config();
const pool = require('../src/config/database');

async function seed() {
  console.log('🌱 Sembrando datos del Módulo 1...\n');

  // Get user IDs
  const [users] = await pool.execute('SELECT id, role FROM users');
  const admin = users.find(u => u.role === 'admin');
  const director = users.find(u => u.role === 'director');

  if (!admin || !director) {
    console.error('❌ Ejecute primero: node scripts/seed.js');
    process.exit(1);
  }

  // ── Demo Projects ──
  const projects = [
    {
      code: 'OC-2026-001', name: 'Construcción Centro Deportivo Municipal de Soacha',
      project_type: 'obra_civil', sector: 'publico',
      client_name: 'Alcaldía Municipal de Soacha', client_nit: '899999999-1',
      contract_number: 'LP-2026-001', contract_value: 2850000000.00,
      contract_object: 'Construcción del Centro Deportivo Municipal incluyendo cancha sintética, coliseo cubierto, piscina semiolímpica y áreas administrativas.',
      sign_date: '2026-01-15', start_date: '2026-02-01',
      execution_term: 12, execution_term_unit: 'meses',
      estimated_end_date: '2027-01-31',
      supervisor: 'Interventoría ABC S.A.S.',
      status: 'en_ejecucion', priority: 'alta', progress_pct: 15.00,
      selection_process: 'licitacion', secop_number: 'SECOP-2026-00123',
      cdp_number: 'CDP-2026-0045', rp_number: 'RP-2026-0067',
      director_id: director.id, created_by: admin.id,
    },
    {
      code: 'TI-2026-002', name: 'Implementación ERP Cloud para Grupo Empresarial Andino',
      project_type: 'ti', sector: 'privado',
      client_name: 'Grupo Empresarial Andino S.A.', client_nit: '800123456-7',
      contract_number: 'GEA-2026-IT-003', contract_value: 480000000.00,
      contract_object: 'Implementación de sistema ERP en la nube para las 5 filiales del grupo, incluyendo módulos financiero, inventarios, RRHH y reportería BI.',
      sign_date: '2026-01-20', start_date: '2026-02-10',
      execution_term: 8, execution_term_unit: 'meses',
      estimated_end_date: '2026-10-10',
      status: 'en_arranque', priority: 'alta', progress_pct: 5.00,
      director_id: director.id, created_by: admin.id,
    },
    {
      code: 'INT-2026-003', name: 'Interventoría Mejoramiento Vial Tramo Zipaquirá-Chía',
      project_type: 'interventoria', sector: 'publico',
      client_name: 'Instituto Nacional de Vías - INVÍAS', client_nit: '800100000-1',
      contract_number: 'CM-2026-089', contract_value: 320000000.00,
      contract_object: 'Interventoría técnica, administrativa, financiera y ambiental a las obras de mejoramiento vial del tramo Zipaquirá-Chía, 12.4 km.',
      sign_date: '2026-02-01', start_date: '2026-02-15',
      execution_term: 14, execution_term_unit: 'meses',
      estimated_end_date: '2027-04-15',
      supervisor: 'Supervisión INVÍAS Regional Cundinamarca',
      status: 'adjudicado', priority: 'media', progress_pct: 0.00,
      selection_process: 'concurso_meritos', secop_number: 'SECOP-2026-00456',
      director_id: director.id, created_by: admin.id,
    },
    {
      code: 'CON-2026-004', name: 'Consultoría Diseños Acueducto Rural Boyacá',
      project_type: 'consultoria', sector: 'publico',
      client_name: 'Gobernación de Boyacá', client_nit: '891800000-2',
      contract_number: 'MC-2026-023', contract_value: 95000000.00,
      contract_object: 'Elaboración de diseños detallados para el acueducto rural que abastecerá 8 veredas del municipio de Tinjacá.',
      sign_date: '2026-01-10', start_date: '2026-01-20',
      execution_term: 4, execution_term_unit: 'meses',
      estimated_end_date: '2026-05-20',
      status: 'en_ejecucion', priority: 'media', progress_pct: 45.00,
      selection_process: 'minima_cuantia',
      director_id: director.id, created_by: admin.id,
    },
    {
      code: 'ASE-2026-005', name: 'Asesoría Transformación Digital Cámara de Comercio',
      project_type: 'asesoria', sector: 'privado',
      client_name: 'Cámara de Comercio de Bucaramanga', client_nit: '890200000-3',
      contract_number: 'CCB-2026-AS-001', contract_value: 150000000.00,
      contract_object: 'Asesoría estratégica en transformación digital, incluyendo diagnóstico de madurez tecnológica, hoja de ruta y acompañamiento en implementación.',
      sign_date: '2026-02-05', start_date: '2026-02-17',
      execution_term: 6, execution_term_unit: 'meses',
      estimated_end_date: '2026-08-17',
      status: 'adjudicado', priority: 'baja', progress_pct: 0.00,
      director_id: director.id, created_by: admin.id,
    },
  ];

  for (const p of projects) {
    const cols = Object.keys(p);
    const placeholders = cols.map(() => '?').join(', ');
    const updateCols = cols.map(c => `${c} = VALUES(${c})`).join(', ');
    await pool.execute(
      `INSERT INTO projects (${cols.join(', ')}) VALUES (${placeholders})
       ON DUPLICATE KEY UPDATE ${updateCols}`,
      Object.values(p)
    );
    console.log(`✅ Proyecto: ${p.code} — ${p.name.substring(0, 50)}...`);
  }

  await pool.end();
  console.log('\n🎉 Seed Módulo 1 completado — 5 proyectos de demostración');
}

seed().catch((err) => {
  console.error('❌ Error en seed:', err.message);
  process.exit(1);
});
