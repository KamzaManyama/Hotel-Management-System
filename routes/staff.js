const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const db = require('../config/db');
const { authenticate, requireRole, auditLog } = require('../middleware/auth');
const { ok, fail, uuidv4, paginate } = require('../middleware/helpers');

// All routes require manager role
router.use(authenticate, requireRole('manager'));

// GET /api/staff - list all staff
router.get('/', async (req, res) => {
  const { role, is_active, search } = req.query;
  const { limit, offset } = paginate(req);
  let query = 'SELECT id, uuid, full_name, email, role, phone, is_active, created_at, last_login FROM staff WHERE 1=1';
  const params = [];
  if (role) { query += ' AND role = ?'; params.push(role); }
  if (is_active !== undefined) { query += ' AND is_active = ?'; params.push(is_active === 'true' ? 1 : 0); }
  if (search) { query += ' AND (full_name LIKE ? OR email LIKE ?)'; params.push(`%${search}%`, `%${search}%`); }
  query += ` ORDER BY full_name LIMIT ${limit} OFFSET ${offset}`;
  try {
    const [rows] = await db.query(query, params);
    return ok(res, { staff: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/staff - create staff account
router.post('/', async (req, res) => {
  const { full_name, email, password, role, phone } = req.body;
  if (!full_name || !email || !password || !role) return fail(res, 'full_name, email, password, role required');
  const validRoles = ['manager', 'receptionist', 'housekeeping', 'maintenance'];
  if (!validRoles.includes(role)) return fail(res, 'Invalid role');
  if (password.length < 8) return fail(res, 'Password must be at least 8 characters');

  try {
    const [existing] = await db.query('SELECT id FROM staff WHERE email = ?', [email]);
    if (existing.length) return fail(res, 'Email already in use');

    const hash = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO staff (uuid, full_name, email, password_hash, role, phone, created_by) VALUES (?,?,?,?,?,?,?)',
      [uuidv4(), full_name, email.toLowerCase(), hash, role, phone, req.staff.id]
    );
    await auditLog(req.staff.id, 'CREATE_STAFF', 'staff', result.insertId, { email, role }, req.ip);
    return ok(res, { staff_id: result.insertId }, 'Staff account created', 201);
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/staff/:id - update staff
router.put('/:id', async (req, res) => {
  const { full_name, phone, role } = req.body;
  try {
    const fields = []; const params = [];
    if (full_name) { fields.push('full_name = ?'); params.push(full_name); }
    if (phone !== undefined) { fields.push('phone = ?'); params.push(phone); }
    if (role) {
      const validRoles = ['manager', 'receptionist', 'housekeeping', 'maintenance'];
      if (!validRoles.includes(role)) return fail(res, 'Invalid role');
      fields.push('role = ?'); params.push(role);
    }
    if (!fields.length) return fail(res, 'Nothing to update');
    params.push(req.params.id);
    await db.query(`UPDATE staff SET ${fields.join(', ')} WHERE id = ?`, params);
    await auditLog(req.staff.id, 'UPDATE_STAFF', 'staff', req.params.id, req.body, req.ip);
    return ok(res, {}, 'Staff updated');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/staff/:id/disable
router.put('/:id/disable', async (req, res) => {
  if (parseInt(req.params.id) === req.staff.id) return fail(res, 'Cannot disable your own account');
  try {
    await db.query('UPDATE staff SET is_active = 0 WHERE id = ?', [req.params.id]);
    await auditLog(req.staff.id, 'DISABLE_STAFF', 'staff', req.params.id, {}, req.ip);
    return ok(res, {}, 'Staff account disabled');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/staff/:id/enable
router.put('/:id/enable', async (req, res) => {
  try {
    await db.query('UPDATE staff SET is_active = 1 WHERE id = ?', [req.params.id]);
    return ok(res, {}, 'Staff account enabled');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/staff/:id/reset-password
router.put('/:id/reset-password', async (req, res) => {
  const { new_password } = req.body;
  if (!new_password || new_password.length < 8) return fail(res, 'Password must be at least 8 characters');
  try {
    const hash = await bcrypt.hash(new_password, 10);
    await db.query('UPDATE staff SET password_hash = ? WHERE id = ?', [hash, req.params.id]);
    await auditLog(req.staff.id, 'RESET_PASSWORD', 'staff', req.params.id, {}, req.ip);
    return ok(res, {}, 'Password reset successfully');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/staff/activity-logs
router.get('/activity-logs', async (req, res) => {
  const { limit, offset } = paginate(req);
  const { staff_id } = req.query;
  let query = `SELECT al.*, s.full_name, s.role FROM audit_logs al 
               LEFT JOIN staff s ON s.id = al.staff_id WHERE 1=1`;
  const params = [];
  if (staff_id) { query += ' AND al.staff_id = ?'; params.push(staff_id); }
  query += ` ORDER BY al.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  try {
    const [rows] = await db.query(query, params);
    return ok(res, { logs: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;