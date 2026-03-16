require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sgip_ia',
  });

  console.log('Creando tabla system_settings...');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS system_settings (
      id           INT PRIMARY KEY AUTO_INCREMENT,
      setting_key  VARCHAR(100) NOT NULL UNIQUE,
      setting_value LONGTEXT,
      is_sensitive TINYINT NOT NULL DEFAULT 0,
      updated_by   INT,
      updated_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      created_at   TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Insert default empty email config
  await conn.execute(`
    INSERT IGNORE INTO system_settings (setting_key, setting_value, is_sensitive)
    VALUES ('email_config', '{}', 0)
  `);

  console.log('✅  system_settings lista.');
  await conn.end();
}

migrate().catch(e => { console.error(e); process.exit(1); });
