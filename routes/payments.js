const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole, auditLog } = require('../middleware/auth');
const { ok, fail, paginate, generatePaymentRef } = require('../middleware/helpers');

router.use(authenticate, requireRole('manager', 'receptionist'));

// GET /api/payments - list payments
router.get('/', async (req, res) => {
  const { booking_id, method, type, start_date, end_date } = req.query;
  const { limit, offset } = paginate(req);
  let query = `SELECT p.*, b.booking_ref, g.first_name, g.last_name, s.full_name as processed_by_name
               FROM payments p
               JOIN bookings b ON b.id=p.booking_id
               JOIN guests g ON g.id=p.guest_id
               LEFT JOIN staff s ON s.id=p.processed_by
               WHERE 1=1`;
  const params = [];
  if (booking_id) { query += ' AND p.booking_id=?'; params.push(booking_id); }
  if (method) { query += ' AND p.method=?'; params.push(method); }
  if (type) { query += ' AND p.type=?'; params.push(type); }
  if (start_date) { query += ' AND DATE(p.created_at) >= ?'; params.push(start_date); }
  if (end_date) { query += ' AND DATE(p.created_at) <= ?'; params.push(end_date); }
  query += ` ORDER BY p.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  try {
    const [rows] = await db.query(query, params);
    return ok(res, { payments: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/payments - record payment
router.post('/', async (req, res) => {
  const { booking_id, amount, method, type, reference_number, notes } = req.body;
  if (!booking_id || !amount || !method) return fail(res, 'booking_id, amount, method required');
  try {
    const [bookings] = await db.query('SELECT * FROM bookings WHERE id=?', [booking_id]);
    if (!bookings.length) return fail(res, 'Booking not found', 404);
    const booking = bookings[0];

    const ref = generatePaymentRef();
    const [result] = await db.query(
      'INSERT INTO payments (payment_ref, booking_id, guest_id, amount, method, type, reference_number, notes, processed_by) VALUES (?,?,?,?,?,?,?,?,?)',
      [ref, booking_id, booking.guest_id, amount, method, type||'full_payment', reference_number, notes, req.staff.id]
    );

    // Update amount paid on booking
    await db.query('UPDATE bookings SET amount_paid = amount_paid + ? WHERE id=?', [amount, booking_id]);

    await auditLog(req.staff.id, 'RECORD_PAYMENT', 'payment', result.insertId, {booking_id, amount, method}, req.ip);
    return ok(res, { payment_id: result.insertId, payment_ref: ref }, 'Payment recorded', 201);
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

// POST /api/payments/refund
router.post('/refund', requireRole('manager'), async (req, res) => {
  const { booking_id, amount, reason } = req.body;
  if (!booking_id || !amount) return fail(res, 'booking_id and amount required');
  try {
    const [bookings] = await db.query('SELECT * FROM bookings WHERE id=?', [booking_id]);
    if (!bookings.length) return fail(res, 'Booking not found', 404);
    const booking = bookings[0];

    const ref = generatePaymentRef();
    await db.query(
      'INSERT INTO payments (payment_ref, booking_id, guest_id, amount, method, type, notes, processed_by) VALUES (?,?,?,?,?,?,?,?)',
      [ref, booking_id, booking.guest_id, -parseFloat(amount), 'refund', 'refund', reason, req.staff.id]
    );
    await db.query('UPDATE bookings SET amount_paid = amount_paid - ? WHERE id=?', [amount, booking_id]);
    await auditLog(req.staff.id, 'ISSUE_REFUND', 'booking', booking_id, {amount}, req.ip);
    return ok(res, { payment_ref: ref }, 'Refund issued');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/payments/discount
router.post('/discount', requireRole('manager'), async (req, res) => {
  const { booking_id, discount_amount, reason } = req.body;
  if (!booking_id || !discount_amount) return fail(res, 'booking_id and discount_amount required');
  try {
    await db.query(
      `UPDATE bookings SET discount_amount=discount_amount+?, total_amount=total_amount-?,
        internal_notes=CONCAT(COALESCE(internal_notes,''),' | Discount: ',?) WHERE id=?`,
      [discount_amount, discount_amount, reason||'Discount applied', booking_id]
    );
    await auditLog(req.staff.id, 'APPLY_DISCOUNT', 'booking', booking_id, {discount_amount}, req.ip);
    return ok(res, {}, 'Discount applied');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;