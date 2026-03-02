const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ok, fail, paginate, uuidv4 } = require('../middleware/helpers');

router.use(authenticate);

// GET /api/guests - search guests
router.get('/', async (req, res) => {
  const { search, is_vip } = req.query;
  const { limit, offset } = paginate(req);
  let query = 'SELECT * FROM guests WHERE 1=1';
  const params = [];
  if (search) {
    query += ' AND (first_name LIKE ? OR last_name LIKE ? OR email LIKE ? OR phone LIKE ? OR id_number LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s, s);
  }
  if (is_vip === 'true') { query += ' AND is_vip=1'; }
  query += ` ORDER BY first_name LIMIT ${limit} OFFSET ${offset}`;
  try {
    const [rows] = await db.query(query, params);
    return ok(res, { guests: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/guests/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM guests WHERE id=?', [req.params.id]);
    if (!rows.length) return fail(res, 'Guest not found', 404);
    const guest = rows[0];
    const [bookings] = await db.query(
      `SELECT b.booking_ref, b.check_in_date, b.check_out_date, b.status, b.total_amount,
              rt.name as room_type, r.room_number
       FROM bookings b JOIN room_types rt ON rt.id=b.room_type_id LEFT JOIN rooms r ON r.id=b.room_id
       WHERE b.guest_id=? ORDER BY b.check_in_date DESC LIMIT 20`,
      [req.params.id]
    );
    return ok(res, { guest, bookings });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/guests
router.post('/', requireRole('manager','receptionist'), async (req, res) => {
  const { first_name, last_name, email, phone, nationality, id_type, id_number, date_of_birth, address } = req.body;
  if (!first_name || !last_name) return fail(res, 'first_name and last_name required');
  try {
    const [result] = await db.query(
      'INSERT INTO guests (uuid, first_name, last_name, email, phone, nationality, id_type, id_number, date_of_birth, address) VALUES (?,?,?,?,?,?,?,?,?,?)',
      [uuidv4(), first_name, last_name, email, phone, nationality, id_type, id_number, date_of_birth, address]
    );
    return ok(res, { guest_id: result.insertId }, 'Guest created', 201);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/guests/:id
router.put('/:id', requireRole('manager','receptionist'), async (req, res) => {
  const allowed = ['first_name','last_name','email','phone','nationality','id_type','id_number','date_of_birth','address','is_vip','vip_notes'];
  const fields = []; const params = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { fields.push(`${key}=?`); params.push(req.body[key]); }
  }
  if (!fields.length) return fail(res, 'Nothing to update');
  params.push(req.params.id);
  try {
    await db.query(`UPDATE guests SET ${fields.join(',')} WHERE id=?`, params);
    return ok(res, {}, 'Guest updated');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;