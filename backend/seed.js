const bcrypt = require('bcryptjs');
const pool = require('./config/db');

async function seed() {
  console.log('🌱 Seeding initial demo users into MySQL...');

  const users = [
    { name: 'Rohan SMO', email: 'smo@test.com', password: 'password123', role: 'smo' },
    { name: 'Priya Manager', email: 'manager@test.com', password: 'password123', role: 'manager' },
    { name: 'Amit Admin', email: 'admin@test.com', password: 'password123', role: 'admin' },
  ];

  for (const user of users) {
    const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [user.email]);
    if (existing.length === 0) {
      const hash = await bcrypt.hash(user.password, 10);
      await pool.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [user.name, user.email, hash, user.role]
      );
      console.log(`✅ Created user: ${user.name} (${user.role}) - ${user.email}`);
    } else {
      console.log(`ℹ️ User ${user.email} already exists.`);
    }
  }

  console.log('✨ Seeding complete!');
  process.exit(0);
}

seed().catch((err) => {
  console.error('Seeding error:', err);
  process.exit(1);
});

