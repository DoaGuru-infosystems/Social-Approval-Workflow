const mysql = require('mysql2/promise');
const dotenv = require('dotenv');

dotenv.config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'social_approval_db',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
});

// Helper to test database connection status
pool.testConnection = async () => {
  try {
    const connection = await pool.getConnection();
    connection.release();
    return { connected: true };
  } catch (error) {
    return { connected: false, error: error.message };
  }
};

module.exports = pool;

