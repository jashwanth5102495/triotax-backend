const express = require('express');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3001;

// Full CORS preflight support for cross-origin requests from Vercel
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }
  next();
});

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────────────────────
// DATABASE SETUP
// If DATABASE_URL is set (Railway PostgreSQL), use pg (postgres)
// Otherwise use in-memory store
// ─────────────────────────────────────────────────────────────

let db = null; // postgres client when available

if (process.env.DATABASE_URL) {
  try {
    const { Pool } = require('pg');
    db = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
    
    // Create users table if it doesn't exist
    db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        company_name VARCHAR(255),
        owner_name VARCHAR(255),
        email VARCHAR(255),
        contact VARCHAR(50),
        alt_contact VARCHAR(50),
        address TEXT,
        description TEXT,
        role VARCHAR(20) DEFAULT 'USER',
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).then(() => {
      console.log('✅ Connected to PostgreSQL database');
    }).catch(err => {
      console.error('❌ DB table creation error:', err.message);
    });
  } catch (e) {
    console.log('⚠️  pg not installed, falling back to in-memory store');
    db = null;
  }
} else {
  console.log('ℹ️  No DATABASE_URL found, using in-memory store');
}

// ─────────────────────────────────────────────────────────────
// In-Memory fallback store
// ─────────────────────────────────────────────────────────────
let memUsers = [];
let nextId = 1;

// ─────────────────────────────────────────────────────────────
// ROUTES
// ─────────────────────────────────────────────────────────────

// Health check
app.get('/api/health', async (req, res) => {
  if (db) {
    try {
      const result = await db.query('SELECT COUNT(*) FROM users WHERE role=$1', ['USER']);
      return res.json({ status: 'ok', mode: 'postgresql', totalUsers: parseInt(result.rows[0].count) });
    } catch (e) {
      return res.json({ status: 'ok', mode: 'postgresql-error', error: e.message });
    }
  }
  res.json({ status: 'ok', mode: 'in-memory', totalUsers: memUsers.length });
});

// POST /api/login
app.post('/api/login', async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password required' });

  if (db) {
    try {
      const result = await db.query('SELECT * FROM users WHERE username=$1 AND password=$2', [username, password]);
      if (result.rows.length === 0) return res.status(401).json({ success: false, message: 'Invalid username or password' });
      const user = result.rows[0];
      return res.json({ success: true, username: user.username, role: user.role });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Database error: ' + e.message });
    }
  }

  // In-memory fallback
  const user = memUsers.find(u => u.username === username && u.password === password);
  if (!user) return res.status(401).json({ success: false, message: 'Invalid username or password' });
  return res.json({ success: true, username: user.username, role: user.role });
});

// POST /api/users — Admin creates a user
app.post('/api/users', async (req, res) => {
  const { username, password, companyName, ownerName, email, contact, altContact, address, description } = req.body;
  if (!username || !password) return res.status(400).json({ success: false, message: 'Username and password are required' });
  const clean = username.toLowerCase().replace(/\s+/g, '');

  if (db) {
    try {
      const exists = await db.query('SELECT id FROM users WHERE username=$1', [clean]);
      if (exists.rows.length > 0) return res.status(409).json({ success: false, message: `Username "${clean}" already exists` });
      await db.query(
        'INSERT INTO users (username, password, company_name, owner_name, email, contact, alt_contact, address, description, role) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)',
        [clean, password, companyName, ownerName, email, contact, altContact, address, description, 'USER']
      );
      console.log(`New user: ${clean}`);
      return res.status(201).json({ success: true, message: `User "${clean}" created!`, username: clean, loginUrl: `/${clean}-user/dashboard` });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Database error: ' + e.message });
    }
  }

  // In-memory fallback
  if (memUsers.find(u => u.username === clean)) return res.status(409).json({ success: false, message: `Username "${clean}" already exists` });
  memUsers.push({ id: nextId++, username: clean, password, companyName, ownerName, email, contact, altContact, address, description, role: 'USER', createdAt: new Date().toISOString() });
  console.log(`New user: ${clean}`);
  return res.status(201).json({ success: true, message: `User "${clean}" created!`, username: clean, loginUrl: `/${clean}-user/dashboard` });
});

// GET /api/users
app.get('/api/users', async (req, res) => {
  if (db) {
    try {
      const result = await db.query('SELECT id, username, company_name, owner_name, email, contact, created_at FROM users WHERE role=$1', ['USER']);
      return res.json({ success: true, users: result.rows });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Database error: ' + e.message });
    }
  }
  const safe = memUsers.filter(u => u.role === 'USER').map(({ password, ...rest }) => rest);
  return res.json({ success: true, users: safe });
});

// DELETE /api/users/:username
app.delete('/api/users/:username', async (req, res) => {
  const { username } = req.params;
  if (db) {
    try {
      await db.query('DELETE FROM users WHERE username=$1', [username]);
      return res.json({ success: true, message: `User deleted` });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Database error: ' + e.message });
    }
  }
  const idx = memUsers.findIndex(u => u.username === username);
  if (idx === -1) return res.status(404).json({ success: false, message: 'User not found' });
  memUsers.splice(idx, 1);
  return res.json({ success: true });
});

// ─────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`\n🚀 TrioTax Backend running on port ${port}`);
  console.log(`   Mode: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'In-Memory'}`);
  console.log(`   Health: http://localhost:${port}/api/health\n`);
});
