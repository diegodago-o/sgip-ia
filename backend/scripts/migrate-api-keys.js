require('dotenv').config();
const mysql = require('mysql2/promise');

async function migrate() {
  const conn = await mysql.createConnection({
    host: process.env.DB_HOST || 'localhost',
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'sgip_ia',
  });

  console.log('Creando tabla api_keys...');

  await conn.execute(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id          INT PRIMARY KEY AUTO_INCREMENT,
      name        VARCHAR(100) NOT NULL,
      key_prefix  VARCHAR(12) NOT NULL,
      key_hash    VARCHAR(64) NOT NULL UNIQUE,
      created_by  INT NOT NULL,
      last_used_at DATETIME,
      is_active   TINYINT NOT NULL DEFAULT 1,
      created_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  console.log('✅  api_keys lista.');
  await conn.end();
}

migrate().catch(e => { console.error(e); process.exit(1); });
