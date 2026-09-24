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
        data TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `).then(() => {
      console.log('✅ Connected to PostgreSQL database');
      db.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS data TEXT;').catch(() => {});
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
// ROUTES (Supporting route aliases to handle /api/users, /users, /api/api/users)
// ─────────────────────────────────────────────────────────────

// Health check
app.get(['/api/health', '/health', '/api/api/health'], async (req, res) => {
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
app.post(['/api/login', '/login', '/api/api/login'], async (req, res) => {
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
app.post(['/api/users', '/users', '/api/api/users'], async (req, res) => {
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
      console.log(`New user created: ${clean}`);
      return res.status(201).json({ success: true, message: `User "${clean}" created!`, username: clean, loginUrl: `/${clean}-user/dashboard` });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Database error: ' + e.message });
    }
  }

  // In-memory fallback
  if (memUsers.find(u => u.username === clean)) return res.status(409).json({ success: false, message: `Username "${clean}" already exists` });
  memUsers.push({ id: nextId++, username: clean, password, companyName, ownerName, email, contact, altContact, address, description, role: 'USER', createdAt: new Date().toISOString() });
  console.log(`New user created: ${clean}`);
  return res.status(201).json({ success: true, message: `User "${clean}" created!`, username: clean, loginUrl: `/${clean}-user/dashboard` });
});

// GET /api/users
app.get(['/api/users', '/users', '/api/api/users'], async (req, res) => {
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
app.delete(['/api/users/:username', '/users/:username', '/api/api/users/:username'], async (req, res) => {
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
// DATA BACKUP & RESTORE ENDPOINTS
// ─────────────────────────────────────────────────────────────

// GET /api/users/:username/data
app.get(['/api/users/:username/data', '/users/:username/data', '/api/api/users/:username/data', '/api/backup/:username', '/backup/:username'], async (req, res) => {
  const { username } = req.params;
  if (db) {
    try {
      const result = await db.query('SELECT username, company_name, owner_name, email, contact, address, description, data FROM users WHERE username=$1', [username]);
      if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
      const user = result.rows[0];
      const parsedData = user.data ? (typeof user.data === 'string' ? JSON.parse(user.data) : user.data) : {};
      return res.json({
        success: true,
        companyProfile: {
          username: user.username,
          companyName: user.company_name,
          ownerName: user.owner_name,
          email: user.email,
          contact: user.contact,
          address: user.address,
          description: user.description
        },
        billingHistory: parsedData.billingHistory || [],
        employees: parsedData.employees || [],
        complianceRecords: parsedData.complianceRecords || [],
        data: parsedData,
        exportedAt: new Date().toISOString(),
        version: "1.0"
      });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Database error: ' + e.message });
    }
  }

  const u = memUsers.find(x => x.username === username);
  if (!u) return res.status(404).json({ success: false, message: 'User not found' });
  const parsedData = u.data ? (typeof u.data === 'string' ? JSON.parse(u.data) : u.data) : {};
  return res.json({
    success: true,
    companyProfile: {
      username: u.username,
      companyName: u.companyName,
      ownerName: u.ownerName,
      email: u.email,
      contact: u.contact,
      address: u.address,
      description: u.description
    },
    billingHistory: parsedData.billingHistory || [],
    employees: parsedData.employees || [],
    complianceRecords: parsedData.complianceRecords || [],
    data: parsedData,
    exportedAt: new Date().toISOString(),
    version: "1.0"
  });
});

// POST /api/users/:username/data (Save full live user data)
app.post(['/api/users/:username/data', '/users/:username/data', '/api/api/users/:username/data'], async (req, res) => {
  const { username } = req.params;
  const payload = req.body.data || req.body;
  const dataToSave = JSON.stringify(payload);

  if (db) {
    try {
      await db.query('UPDATE users SET data=$1 WHERE username=$2', [dataToSave, username]);
      return res.json({ success: true, message: 'User data saved to PostgreSQL' });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Database error: ' + e.message });
    }
  }

  const u = memUsers.find(x => x.username === username);
  if (u) {
    u.data = dataToSave;
    return res.json({ success: true, message: 'User data saved in memory' });
  }
  return res.status(404).json({ success: false, message: 'User not found' });
});

// POST /api/users/:username/restore (Append restored JSON data without overriding)
app.post(['/api/users/:username/restore', '/users/:username/restore', '/api/api/users/:username/restore', '/api/backup/:username/restore', '/backup/:username/restore'], async (req, res) => {
  const { username } = req.params;
  const restoredPayload = req.body; // JSON backup file object

  let existingData = { billingHistory: [], employees: [], complianceRecords: [] };

  if (db) {
    try {
      const result = await db.query('SELECT data FROM users WHERE username=$1', [username]);
      if (result.rows.length === 0) return res.status(404).json({ success: false, message: 'User not found' });
      if (result.rows[0].data) {
        try {
          existingData = JSON.parse(result.rows[0].data);
        } catch (e) {}
      }

      // APPEND LOGIC: Keep all existing records and append uploaded records with unique IDs
      const mergedBilling = [
        ...(existingData.billingHistory || []),
        ...(restoredPayload.billingHistory || []).map((item, idx) => ({
          ...item,
          id: Date.now() + idx + Math.floor(Math.random() * 10000)
        }))
      ];

      const mergedEmployees = [
        ...(existingData.employees || []),
        ...(restoredPayload.employees || []).map((item, idx) => ({
          ...item,
          id: Date.now() + idx + Math.floor(Math.random() * 10000)
        }))
      ];

      const mergedCompliance = [
        ...(existingData.complianceRecords || []),
        ...(restoredPayload.complianceRecords || []).map((item, idx) => ({
          ...item,
          id: Date.now() + idx + Math.floor(Math.random() * 10000)
        }))
      ];

      const merged = {
        ...existingData,
        billingHistory: mergedBilling,
        employees: mergedEmployees,
        complianceRecords: mergedCompliance,
        lastRestoredAt: new Date().toISOString()
      };

      await db.query('UPDATE users SET data=$1 WHERE username=$2', [JSON.stringify(merged), username]);
      return res.json({
        success: true,
        message: `Data appended successfully to PostgreSQL for company ${username}!`,
        mergedData: merged
      });
    } catch (e) {
      return res.status(500).json({ success: false, message: 'Database error: ' + e.message });
    }
  }

  // Memory fallback
  const u = memUsers.find(x => x.username === username);
  if (!u) return res.status(404).json({ success: false, message: 'User not found' });
  if (u.data) {
    try {
      existingData = typeof u.data === 'string' ? JSON.parse(u.data) : u.data;
    } catch (e) {}
  }

  const mergedBilling = [
    ...(existingData.billingHistory || []),
    ...(restoredPayload.billingHistory || []).map((item, idx) => ({
      ...item,
      id: Date.now() + idx + Math.floor(Math.random() * 10000)
    }))
  ];

  const mergedEmployees = [
    ...(existingData.employees || []),
    ...(restoredPayload.employees || []).map((item, idx) => ({
      ...item,
      id: Date.now() + idx + Math.floor(Math.random() * 10000)
    }))
  ];

  const merged = {
    ...existingData,
    billingHistory: mergedBilling,
    employees: mergedEmployees,
    lastRestoredAt: new Date().toISOString()
  };

  u.data = JSON.stringify(merged);
  return res.json({
    success: true,
    message: `Data appended successfully in memory for ${username}!`,
    mergedData: merged
  });
});

// ─────────────────────────────────────────────────────────────
app.listen(port, () => {
  console.log(`\n🚀 TrioTax Backend running on port ${port}`);
  console.log(`   Mode: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'In-Memory'}`);
  console.log(`   Health: http://localhost:${port}/api/health\n`);
});
