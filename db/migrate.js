// Runs schema.sql against DATABASE_URL. Safe to re-run (uses CREATE TABLE IF NOT EXISTS).
require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

async function runMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error('DATABASE_URL is not set.');
  }
  const pool = new Pool({
    connectionString,
    ssl: connectionString.includes('localhost') ? false : { rejectUnauthorized: false },
  });
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  try {
    await pool.query(sql);
    console.log('Migration complete: all tables exist.');
  } finally {
    await pool.end();
  }
}

module.exports = runMigration;

// Still runnable directly: node db/migrate.js
if (require.main === module) {
  runMigration().catch((err) => {
    console.error('Migration failed:', err.message);
    process.exit(1);
  });
}