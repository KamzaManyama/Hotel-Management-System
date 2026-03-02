const mysql = require('mysql2/promise');
const bcrypt = require('bcryptjs');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
require('dotenv').config();

async function setupDatabase() {
  let conn;
  try {
    
    conn = await mysql.createConnection({
      host: process.env.DB_HOST || 'localhost',
      port: process.env.DB_PORT || 3306,
      user: process.env.DB_USER || 'root',
      password: process.env.DB_PASSWORD || '',
      multipleStatements: true,
    });

    console.log('Connected to MySQL');

    // Run schema
    const schema = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
    await conn.query(schema);
    console.log(' Schema created successfully');

    // Select the database
    await conn.query(`USE hotel_management`);

    // Seed default manager account
    const existing = await conn.query(`SELECT id FROM staff WHERE email = 'admin@hotel.com'`);
    if (existing[0].length === 0) {
      const passwordHash = await bcrypt.hash('Admin@1234', 10);
      await conn.query(
        `INSERT INTO staff (uuid, full_name, email, password_hash, role) VALUES (?, ?, ?, ?, ?)`,
        [uuidv4(), 'Hotel Manager', 'admin@hotel.com', passwordHash, 'manager']
      );
      console.log(' Default manager account created');
      console.log(' Email: admin@hotel.com');
      console.log(' Password: Admin@1234');
      console.log(' Please change this password after first login!');
    } else {
      console.log(' Manager account already exists');
    }

    console.log('\n Database setup complete!');
    console.log('   Run: npm start  to launch the server');

  } catch (err) {
    console.error(' Setup failed:', err.message);
    process.exit(1);
  } finally {
    if (conn) await conn.end();
  }
}

setupDatabase();