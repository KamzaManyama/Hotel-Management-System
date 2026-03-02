const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../config/db');
const { authenticate } = require('../middleware/auth');
const { ok, fail, auditLog } = require('../middleware/helpers');

const JWT_SECRET = process.env.JWT_SECRET || 'hotel_secret_key';
const JWT_EXPIRES = process.env.JWT_EXPIRES_IN || '8h';

// POST /api/auth/login
router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) return fail(res, 'Email and password are required');

  try {
    const [rows] = await db.query(
      'SELECT * FROM staff WHERE email = ? AND is_active = 1',
      [email.toLowerCase().trim()]
    );

    if (!rows.length) return fail(res, 'Invalid credentials', 401);

    const staff = rows[0];
    const valid = await bcrypt.compare(password, staff.password_hash);
    if (!valid) return fail(res, 'Invalid credentials', 401);

    const token = jwt.sign(
      { id: staff.id, email: staff.email, role: staff.role },
      JWT_SECRET,
      { expiresIn: JWT_EXPIRES }
    );

    await db.query('UPDATE staff SET last_login = NOW() WHERE id = ?', [staff.id]);

    return ok(res, {
      token,
      staff: {
        id: staff.id,
        uuid: staff.uuid,
        full_name: staff.full_name,
        email: staff.email,
        role: staff.role,
      }
    }, 'Login successful');
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  return ok(res, { staff: req.staff });
});

// PUT /api/auth/change-password
router.put('/change-password', authenticate, async (req, res) => {
  const { current_password, new_password } = req.body;
  if (!current_password || !new_password) return fail(res, 'Both passwords required');
  if (new_password.length < 8) return fail(res, 'New password must be at least 8 characters');

  try {
    const [rows] = await db.query('SELECT password_hash FROM staff WHERE id = ?', [req.staff.id]);
    const valid = await bcrypt.compare(current_password, rows[0].password_hash);
    if (!valid) return fail(res, 'Current password is incorrect');

    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE staff SET password_hash = ? WHERE id = ?', [hash, req.staff.id]);
    return ok(res, {}, 'Password changed successfully');
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;