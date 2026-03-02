const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole, auditLog } = require('../middleware/auth');
const { ok, fail, paginate, generateBookingRef, generateInvoiceNumber, uuidv4 } = require('../middleware/helpers');

router.use(authenticate);

// GET /api/bookings - list bookings
router.get('/', async (req, res) => {
  const { status, check_in_date, check_out_date, room_id, room_type_id, search, is_vip } = req.query;
  const { limit, offset, page } = paginate(req);

  let query = `SELECT b.*, g.first_name, g.last_name, g.email, g.phone, g.is_vip as guest_vip,
                      rt.name as room_type_name, r.room_number
               FROM bookings b
               JOIN guests g ON g.id = b.guest_id
               JOIN room_types rt ON rt.id = b.room_type_id
               LEFT JOIN rooms r ON r.id = b.room_id
               WHERE 1=1`;
  const params = [];

  if (status) { query += ' AND b.status = ?'; params.push(status); }
  if (check_in_date) { query += ' AND b.check_in_date = ?'; params.push(check_in_date); }
  if (check_out_date) { query += ' AND b.check_out_date = ?'; params.push(check_out_date); }
  if (room_id) { query += ' AND b.room_id = ?'; params.push(room_id); }
  if (room_type_id) { query += ' AND b.room_type_id = ?'; params.push(room_type_id); }
  if (is_vip === 'true') { query += ' AND b.is_vip = 1'; }
  if (search) {
    query += ' AND (b.booking_ref LIKE ? OR g.first_name LIKE ? OR g.last_name LIKE ? OR g.email LIKE ?)';
    const s = `%${search}%`;
    params.push(s, s, s, s);
  }

  // Count total
  const countQuery = `SELECT COUNT(*) as total FROM bookings b JOIN guests g ON g.id = b.guest_id JOIN room_types rt ON rt.id = b.room_type_id WHERE 1=1${query.split('WHERE 1=1')[1].split('ORDER')[0]}`;
  
  query += ` ORDER BY b.created_at DESC LIMIT ${limit} OFFSET ${offset}`;

  try {
    const [rows] = await db.query(query, params);
    const [countResult] = await db.query(countQuery.replace(`SELECT b.*, g.first_name, g.last_name, g.email, g.phone, g.is_vip as guest_vip,\n                      rt.name as room_type_name, r.room_number\n               FROM bookings b\n               JOIN guests g ON g.id = b.guest_id\n               JOIN room_types rt ON rt.id = b.room_type_id\n               LEFT JOIN rooms r ON r.id = b.room_id`, ''), params);
    
    const [total] = await db.query(
      `SELECT COUNT(*) as total FROM bookings b JOIN guests g ON g.id=b.guest_id WHERE 1=1 ${params.length ? '' : ''}`,
      []
    );

    return ok(res, { bookings: rows, pagination: { page, limit, total: rows.length } });
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

// GET /api/bookings/today/arrivals
router.get('/today/arrivals', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, g.first_name, g.last_name, g.phone, g.email, g.is_vip,
              rt.name as room_type_name, r.room_number
       FROM bookings b
       JOIN guests g ON g.id = b.guest_id
       JOIN room_types rt ON rt.id = b.room_type_id
       LEFT JOIN rooms r ON r.id = b.room_id
       WHERE b.check_in_date = CURDATE() AND b.status IN ('confirmed','pending')
       ORDER BY b.is_vip DESC, b.check_in_date`
    );
    return ok(res, { arrivals: rows, count: rows.length });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/bookings/today/departures
router.get('/today/departures', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, g.first_name, g.last_name, g.phone, g.email,
              rt.name as room_type_name, r.room_number, b.total_amount - b.amount_paid as balance
       FROM bookings b
       JOIN guests g ON g.id = b.guest_id
       JOIN room_types rt ON rt.id = b.room_type_id
       LEFT JOIN rooms r ON r.id = b.room_id
       WHERE b.check_out_date = CURDATE() AND b.status = 'checked_in'
       ORDER BY b.check_out_date`
    );
    return ok(res, { departures: rows, count: rows.length });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/bookings/today/no-shows
router.get('/today/no-shows', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, g.first_name, g.last_name, g.phone, g.email, rt.name as room_type_name
       FROM bookings b JOIN guests g ON g.id=b.guest_id JOIN room_types rt ON rt.id=b.room_type_id
       WHERE b.check_in_date < CURDATE() AND b.status IN ('confirmed','pending')
       ORDER BY b.check_in_date`
    );
    return ok(res, { no_shows: rows, count: rows.length });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/bookings/calendar?start=&end=
router.get('/calendar', async (req, res) => {
  const { start, end } = req.query;
  if (!start || !end) return fail(res, 'start and end dates required');
  try {
    const [rows] = await db.query(
      `SELECT b.id, b.booking_ref, b.check_in_date, b.check_out_date, b.status, b.is_vip,
              g.first_name, g.last_name, rt.name as room_type, r.room_number
       FROM bookings b
       JOIN guests g ON g.id=b.guest_id
       JOIN room_types rt ON rt.id=b.room_type_id
       LEFT JOIN rooms r ON r.id=b.room_id
       WHERE b.check_in_date <= ? AND b.check_out_date >= ?
         AND b.status NOT IN ('cancelled','archived')
       ORDER BY b.check_in_date`,
      [end, start]
    );
    return ok(res, { events: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/bookings/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, g.*, g.id as guest_id,
              rt.name as room_type_name, rt.base_price,
              r.room_number, r.floor, r.status as room_status
       FROM bookings b
       JOIN guests g ON g.id = b.guest_id
       JOIN room_types rt ON rt.id = b.room_type_id
       LEFT JOIN rooms r ON r.id = b.room_id
       WHERE b.id = ? OR b.booking_ref = ?`,
      [req.params.id, req.params.id]
    );
    if (!rows.length) return fail(res, 'Booking not found', 404);
    
    const booking = rows[0];
    
    // Get payments
    const [payments] = await db.query('SELECT * FROM payments WHERE booking_id = ? ORDER BY created_at', [booking.id]);
    const [extras] = await db.query('SELECT * FROM extra_charges WHERE booking_id = ? ORDER BY created_at', [booking.id]);
    
    return ok(res, { booking, payments, extra_charges: extras });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/bookings - create booking manually (receptionist)
router.post('/', requireRole('manager','receptionist'), async (req, res) => {
  const { room_type_id, check_in_date, check_out_date, adults, children,
          first_name, last_name, email, phone, nationality, id_type, id_number,
          special_requests, internal_notes, is_vip, source, room_id, guest_id } = req.body;

  if (!room_type_id || !check_in_date || !check_out_date || (!guest_id && (!first_name || !last_name)))
    return fail(res, 'Missing required fields');

  try {
    const [typeRows] = await db.query('SELECT * FROM room_types WHERE id = ?', [room_type_id]);
    if (!typeRows.length) return fail(res, 'Room type not found');
    const roomType = typeRows[0];

    const nights = Math.ceil((new Date(check_out_date) - new Date(check_in_date)) / (1000 * 60 * 60 * 24));
    if (nights < 1) return fail(res, 'Minimum 1 night');

    const pricePerNight = parseFloat(roomType.base_price);
    const [taxRow] = await db.query(`SELECT setting_value FROM hotel_settings WHERE setting_key='tax_rate'`);
    const taxRate = parseFloat(taxRow[0]?.setting_value || '0');
    const totalRoomCost = pricePerNight * nights;
    const taxAmount = parseFloat((totalRoomCost * taxRate).toFixed(2));
    const totalAmount = parseFloat((totalRoomCost + taxAmount).toFixed(2));

    let gId = guest_id;
    if (!gId) {
      const [gr] = await db.query(
        `INSERT INTO guests (uuid, first_name, last_name, email, phone, nationality, id_type, id_number)
         VALUES (?,?,?,?,?,?,?,?)`,
        [uuidv4(), first_name, last_name, email, phone, nationality, id_type, id_number]
      );
      gId = gr.insertId;
    }

    const ref = generateBookingRef();
    const [result] = await db.query(
      `INSERT INTO bookings (booking_ref, guest_id, room_type_id, room_id, check_in_date, check_out_date,
        adults, children, base_price_per_night, total_room_cost, tax_amount, total_amount,
        status, special_requests, internal_notes, is_vip, source, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ref, gId, room_type_id, room_id||null, check_in_date, check_out_date,
       adults||1, children||0, pricePerNight, totalRoomCost, taxAmount, totalAmount,
       'confirmed', special_requests, internal_notes, is_vip?1:0, source||'walk_in', req.staff.id]
    );

    if (room_id) {
      await db.query('UPDATE rooms SET status=? WHERE id=?', ['occupied', room_id]);
    }

    await auditLog(req.staff.id, 'CREATE_BOOKING', 'booking', result.insertId, {ref}, req.ip);
    return ok(res, { booking_id: result.insertId, booking_ref: ref }, 'Booking created', 201);
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/bookings/:id - edit booking
router.put('/:id', requireRole('manager','receptionist'), async (req, res) => {
  const allowed = ['check_in_date','check_out_date','adults','children','room_type_id','room_id',
                   'special_requests','internal_notes','is_vip','status'];
  const fields = []; const params = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) { fields.push(`${key}=?`); params.push(req.body[key]); }
  }
  if (!fields.length) return fail(res, 'Nothing to update');
  params.push(req.params.id);
  try {
    await db.query(`UPDATE bookings SET ${fields.join(',')} WHERE id=?`, params);
    await auditLog(req.staff.id, 'UPDATE_BOOKING', 'booking', req.params.id, req.body, req.ip);
    return ok(res, {}, 'Booking updated');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/bookings/:id/cancel
router.put('/:id/cancel', requireRole('manager','receptionist'), async (req, res) => {
  try {
    await db.query(
      `UPDATE bookings SET status='cancelled', cancelled_at=NOW() WHERE id=? AND status NOT IN ('checked_in','checked_out','cancelled')`,
      [req.params.id]
    );
    await auditLog(req.staff.id, 'CANCEL_BOOKING', 'booking', req.params.id, {}, req.ip);
    return ok(res, {}, 'Booking cancelled');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/bookings/:id/no-show
router.put('/:id/no-show', requireRole('manager','receptionist'), async (req, res) => {
  try {
    await db.query('UPDATE bookings SET status=? WHERE id=? AND status IN (?,?)',
      ['no_show', req.params.id, 'confirmed', 'pending']);
    await auditLog(req.staff.id, 'MARK_NO_SHOW', 'booking', req.params.id, {}, req.ip);
    return ok(res, {}, 'Marked as no-show');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/bookings/:id/checkin
router.post('/:id/checkin', requireRole('manager','receptionist'), async (req, res) => {
  const { room_id, id_verified, signature_data, notes } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM bookings WHERE id=?', [req.params.id]);
    if (!rows.length) return fail(res, 'Booking not found', 404);
    const b = rows[0];
    if (b.status !== 'confirmed' && b.status !== 'pending') return fail(res, 'Booking must be confirmed to check in');

    await db.query(
      `UPDATE bookings SET status='checked_in', room_id=COALESCE(?,room_id), 
        checked_in_at=NOW(), checked_in_by=?, internal_notes=COALESCE(?,internal_notes) WHERE id=?`,
      [room_id, req.staff.id, notes, req.params.id]
    );

    if (room_id) {
      await db.query('UPDATE rooms SET status=? WHERE id=?', ['occupied', room_id]);
    }

    if (signature_data) {
      await db.query(
        'INSERT INTO signatures (booking_id, guest_id, signature_data, signed_by_staff) VALUES (?,?,?,?)',
        [req.params.id, b.guest_id, signature_data, req.staff.id]
      );
    }

    await auditLog(req.staff.id, 'CHECK_IN', 'booking', req.params.id, {room_id}, req.ip);
    return ok(res, {}, 'Guest checked in successfully');
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

// POST /api/bookings/:id/checkout
router.post('/:id/checkout', requireRole('manager','receptionist'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, r.id as real_room_id FROM bookings b LEFT JOIN rooms r ON r.id=b.room_id WHERE b.id=?`,
      [req.params.id]
    );
    if (!rows.length) return fail(res, 'Booking not found', 404);
    const b = rows[0];
    if (b.status !== 'checked_in') return fail(res, 'Guest must be checked in to check out');

    await db.query(
      `UPDATE bookings SET status='checked_out', checked_out_at=NOW(), checked_out_by=? WHERE id=?`,
      [req.staff.id, req.params.id]
    );

    if (b.room_id) {
      await db.query('UPDATE rooms SET status=? WHERE id=?', ['dirty', b.room_id]);
      // Auto-create housekeeping task
      await db.query(
        `INSERT INTO housekeeping_tasks (room_id, task_type, status, priority, requested_by) VALUES (?,?,?,?,?)`,
        [b.room_id, 'checkout_clean', 'pending', 'high', req.staff.id]
      );
    }

    // Generate invoice
    const [extras] = await db.query('SELECT SUM(amount * quantity) as total FROM extra_charges WHERE booking_id=?', [req.params.id]);
    const extraTotal = parseFloat(extras[0].total || 0);
    const invoiceNum = generateInvoiceNumber();
    
    await db.query(
      `INSERT INTO invoices (invoice_number, booking_id, guest_id, subtotal, tax_amount, total_amount, amount_paid, status, issued_by)
       SELECT ?, b.id, b.guest_id, b.total_room_cost + ?, b.tax_amount, b.total_amount + ?, b.amount_paid,
              IF(b.amount_paid >= b.total_amount + ?, 'paid', 'partial'), ?
       FROM bookings b WHERE b.id=?`,
      [invoiceNum, extraTotal, extraTotal, extraTotal, req.staff.id, req.params.id]
    );

    await auditLog(req.staff.id, 'CHECK_OUT', 'booking', req.params.id, {}, req.ip);
    return ok(res, { invoice_number: invoiceNum }, 'Guest checked out successfully');
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/bookings/:id/upgrade
router.put('/:id/upgrade', requireRole('manager','receptionist'), async (req, res) => {
  const { room_type_id, room_id, reason } = req.body;
  if (!room_type_id) return fail(res, 'room_type_id required');
  try {
    await db.query(
      `UPDATE bookings SET room_type_id=?, room_id=COALESCE(?,room_id), 
        internal_notes=CONCAT(COALESCE(internal_notes,''),' | Upgraded: ',?) WHERE id=?`,
      [room_type_id, room_id, reason||'Room upgrade', req.params.id]
    );
    await auditLog(req.staff.id, 'UPGRADE_ROOM', 'booking', req.params.id, {room_type_id}, req.ip);
    return ok(res, {}, 'Room upgraded');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/bookings/:id/vip
router.put('/:id/vip', requireRole('manager','receptionist'), async (req, res) => {
  try {
    await db.query('UPDATE bookings SET is_vip=1 WHERE id=?', [req.params.id]);
    return ok(res, {}, 'Marked as VIP');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/bookings/:id/extra-charges
router.post('/:id/extra-charges', requireRole('manager','receptionist'), async (req, res) => {
  const { description, amount, quantity } = req.body;
  if (!description || !amount) return fail(res, 'description and amount required');
  try {
    const [result] = await db.query(
      'INSERT INTO extra_charges (booking_id, description, amount, quantity, added_by) VALUES (?,?,?,?,?)',
      [req.params.id, description, amount, quantity||1, req.staff.id]
    );
    // Update booking total
    await db.query(
      'UPDATE bookings SET extra_charges = extra_charges + ? WHERE id=?',
      [parseFloat(amount) * (quantity||1), req.params.id]
    );
    return ok(res, { charge_id: result.insertId }, 'Extra charge added', 201);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/bookings/:id/invoice
router.get('/:id/invoice', requireRole('manager','receptionist'), async (req, res) => {
  try {
    const [invoices] = await db.query(
      `SELECT i.*, g.first_name, g.last_name, g.email, g.phone,
              b.booking_ref, b.check_in_date, b.check_out_date, b.nights, b.room_type_id,
              rt.name as room_type_name, r.room_number
       FROM invoices i JOIN bookings b ON b.id=i.booking_id
       JOIN guests g ON g.id=i.guest_id JOIN room_types rt ON rt.id=b.room_type_id
       LEFT JOIN rooms r ON r.id=b.room_id
       WHERE i.booking_id=? ORDER BY i.issued_at DESC LIMIT 1`,
      [req.params.id]
    );
    if (!invoices.length) return fail(res, 'No invoice found for this booking', 404);
    const [extras] = await db.query('SELECT * FROM extra_charges WHERE booking_id=?', [req.params.id]);
    const [payments] = await db.query('SELECT * FROM payments WHERE booking_id=?', [req.params.id]);
    return ok(res, { invoice: invoices[0], extra_charges: extras, payments });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;