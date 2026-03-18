const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'sgip_ia',
  waitForConnections: true,
  connectionLimit: parseInt(process.env.DB_POOL_SIZE || '20'),
  maxIdle: 10,
  idleTimeout: 60000,         // Close idle connections after 60s
  queueLimit: 0,
  charset: 'utf8mb4',
  timezone: '+00:00',         // MySQL stores UTC; JS conversion uses toLocaleString with timeZone
  connectTimeout: 10000,      // 10s connection timeout
  enableKeepAlive: true,
  keepAliveInitialDelay: 10000,
  // SSL for production
  ...(process.env.DB_SSL === 'true' ? {
    ssl: { rejectUnauthorized: process.env.DB_SSL_REJECT_UNAUTHORIZED !== 'false' }
  } : {}),
});

// Test connection on startup
pool.getConnection()
  .then(conn => { console.log('✅ Database connected'); conn.release(); })
  .catch(err => { console.error('❌ Database connection failed:', err.message); });

module.exports = pool;
