import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const port = process.env.PORT || 3001;

app.use(cors());
app.use(express.json());

// ─────────────────────────────────────────────
// In-Memory User Store (works without a database)
// Replace with Prisma calls when Railway PostgreSQL is ready
// ─────────────────────────────────────────────
interface User {
  id: number;
  username: string;
  password: string;
  companyName?: string;
  ownerName?: string;
  email?: string;
  contact?: string;
  altContact?: string;
  address?: string;
  description?: string;
  role: 'ADMIN' | 'USER';
  createdAt: string;
}

let users: User[] = [];
let nextId = 1;

// ─────────────────────────────────────────────
// Routes
// ─────────────────────────────────────────────

// Health check
app.get('/api/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Backend is running', totalUsers: users.length });
});

// POST /api/login — Validate credentials
app.post('/api/login', (req: Request, res: Response) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  const user = users.find(u => u.username === username && u.password === password);

  if (!user) {
    return res.status(401).json({ success: false, message: 'Invalid username or password' });
  }

  return res.json({
    success: true,
    message: 'Login successful',
    username: user.username,
    role: user.role,
  });
});

// POST /api/users — Admin creates a new user
app.post('/api/users', (req: Request, res: Response) => {
  const { username, password, companyName, ownerName, email, contact, altContact, address, description } = req.body;

  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Username and password are required' });
  }

  const usernameClean = username.toLowerCase().replace(/\s+/g, '');

  const existing = users.find(u => u.username === usernameClean);
  if (existing) {
    return res.status(409).json({ success: false, message: `Username "${usernameClean}" already exists. Please choose a different one.` });
  }

  const newUser: User = {
    id: nextId++,
    username: usernameClean,
    password,
    companyName,
    ownerName,
    email,
    contact,
    altContact,
    address,
    description,
    role: 'USER',
    createdAt: new Date().toISOString(),
  };

  users.push(newUser);

  console.log(`✅ New user created: ${usernameClean} | Login URL: /${usernameClean}-user/dashboard`);

  return res.status(201).json({
    success: true,
    message: `User "${usernameClean}" created successfully!`,
    username: usernameClean,
    loginUrl: `/${usernameClean}-user/dashboard`,
  });
});

// GET /api/users — Admin fetches all users
app.get('/api/users', (_req: Request, res: Response) => {
  const safeUsers = users
    .filter(u => u.role === 'USER')
    .map(({ password: _p, ...rest }) => rest); // exclude passwords

  return res.json({ success: true, users: safeUsers });
});

// DELETE /api/users/:username — Admin deletes a user
app.delete('/api/users/:username', (req: Request, res: Response) => {
  const { username } = req.params;
  const index = users.findIndex(u => u.username === username);

  if (index === -1) {
    return res.status(404).json({ success: false, message: 'User not found' });
  }

  users.splice(index, 1);
  return res.json({ success: true, message: `User "${username}" deleted` });
});

// ─────────────────────────────────────────────
app.listen(port, () => {
  console.log(`\n🚀 TrioTax Backend running on port ${port}`);
  console.log(`   Health:     http://localhost:${port}/api/health`);
  console.log(`   Login:      POST http://localhost:${port}/api/login`);
  console.log(`   Users:      GET/POST http://localhost:${port}/api/users`);
  console.log(`\n📌 Admin Panel: http://localhost:5173/trioadmin  (admin / admin123)`);
  console.log(`📌 User Login:  http://localhost:5173/login\n`);
});
