const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { ok, fail } = require('../middleware/helpers');

// GET /api/public/hotel-info
router.get('/hotel-info', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT setting_key, setting_value FROM hotel_settings');
    const settings = {};
    rows.forEach(r => settings[r.setting_key] = r.setting_value);
    return ok(res, { hotel: settings });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/public/amenities
router.get('/amenities', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM amenities WHERE is_active = 1 ORDER BY sort_order, name'
    );
    return ok(res, { amenities: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/public/gallery
router.get('/gallery', async (req, res) => {
  try {
    const { category } = req.query;
    let query = 'SELECT * FROM gallery WHERE is_active = 1';
    const params = [];
    if (category) { query += ' AND category = ?'; params.push(category); }
    query += ' ORDER BY sort_order, id DESC';
    const [rows] = await db.query(query, params);
    return ok(res, { gallery: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/public/room-types - list all active room types with images
router.get('/room-types', async (req, res) => {
  try {
    const [types] = await db.query(
      'SELECT * FROM room_types WHERE is_active = 1 ORDER BY sort_order, base_price'
    );
    // Attach images
    for (const t of types) {
      const [imgs] = await db.query(
        'SELECT * FROM room_type_images WHERE room_type_id = ? ORDER BY is_primary DESC, sort_order',
        [t.id]
      );
      t.images = imgs;
    }
    return ok(res, { room_types: types });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/public/room-types/:slug
router.get('/room-types/:slug', async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM room_types WHERE slug = ? AND is_active = 1', [req.params.slug]
    );
    if (!rows.length) return fail(res, 'Room type not found', 404);
    const type = rows[0];
    const [imgs] = await db.query(
      'SELECT * FROM room_type_images WHERE room_type_id = ? ORDER BY is_primary DESC, sort_order', [type.id]
    );
    type.images = imgs;
    return ok(res, { room_type: type });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/public/availability?check_in=&check_out=&adults=&children=
router.get('/availability', async (req, res) => {
  const { check_in, check_out, adults = 1, children = 0 } = req.query;
  if (!check_in || !check_out) return fail(res, 'check_in and check_out dates are required');

  const checkIn = new Date(check_in);
  const checkOut = new Date(check_out);
  if (isNaN(checkIn) || isNaN(checkOut)) return fail(res, 'Invalid date format');
  if (checkOut <= checkIn) return fail(res, 'Check-out must be after check-in');
  if (checkIn < new Date().setHours(0,0,0,0)) return fail(res, 'Check-in cannot be in the past');

  try {
    // Get all active room types that fit guest count
    const [types] = await db.query(
      `SELECT rt.*, 
        COUNT(r.id) as total_rooms
       FROM room_types rt
       LEFT JOIN rooms r ON r.room_type_id = rt.id AND r.is_active = 1 AND r.status != 'out_of_order'
       WHERE rt.is_active = 1 
         AND rt.max_adults >= ?
       GROUP BY rt.id
       ORDER BY rt.sort_order, rt.base_price`,
      [adults]
    );

    const nights = Math.ceil((checkOut - checkIn) / (1000 * 60 * 60 * 24));

    for (const type of types) {
      // Count booked rooms in that period
      const [booked] = await db.query(
        `SELECT COUNT(DISTINCT b.room_id) as booked
         FROM bookings b
         WHERE b.room_type_id = ?
           AND b.room_id IS NOT NULL
           AND b.status IN ('confirmed','checked_in')
           AND b.check_in_date < ?
           AND b.check_out_date > ?`,
        [type.id, check_out, check_in]
      );

      type.booked_rooms = booked[0].booked;
      type.available_rooms = Math.max(0, type.total_rooms - booked[0].booked);
      type.is_available = type.available_rooms > 0;
      type.nights = nights;

      // Apply pricing rules
      const price = await getEffectivePrice(type.id, check_in, check_out, type.base_price);
      type.price_per_night = price;
      type.total_price = parseFloat((price * nights).toFixed(2));

      // Attach primary image
      const [imgs] = await db.query(
        'SELECT * FROM room_type_images WHERE room_type_id = ? AND is_primary = 1 LIMIT 1',
        [type.id]
      );
      type.primary_image = imgs[0] || null;
    }

    return ok(res, {
      check_in,
      check_out,
      nights,
      adults: parseInt(adults),
      children: parseInt(children),
      room_types: types
    });
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

// Helper: get effective price considering pricing rules
async function getEffectivePrice(roomTypeId, checkIn, checkOut, basePrice) {
  const [rules] = await db.query(
    `SELECT * FROM pricing_rules 
     WHERE (room_type_id = ? OR room_type_id IS NULL)
       AND is_active = 1
       AND (start_date IS NULL OR start_date <= ?)
       AND (end_date IS NULL OR end_date >= ?)
     ORDER BY price_override DESC`,
    [roomTypeId, checkIn, checkIn]
  );

  let price = parseFloat(basePrice);
  for (const rule of rules) {
    if (rule.price_override) {
      price = parseFloat(rule.price_override);
      break;
    }
    if (rule.price_modifier_pct) {
      price = price * (1 + parseFloat(rule.price_modifier_pct) / 100);
    }
  }
  return parseFloat(price.toFixed(2));
}

// POST /api/public/bookings - create booking from website
router.post('/bookings', async (req, res) => {
  const {
    room_type_id, check_in_date, check_out_date, adults, children,
    first_name, last_name, email, phone, nationality,
    id_type, id_number, special_requests, promo_code
  } = req.body;

  if (!room_type_id || !check_in_date || !check_out_date || !first_name || !last_name)
    return fail(res, 'Required fields: room_type_id, check_in_date, check_out_date, first_name, last_name');

  const { v4: uuidv4 } = require('uuid');
  const { generateBookingRef } = require('../middleware/helpers');

  try {
    // Verify room type exists and is available
    const [typeRows] = await db.query('SELECT * FROM room_types WHERE id = ? AND is_active = 1', [room_type_id]);
    if (!typeRows.length) return fail(res, 'Room type not found');

    const roomType = typeRows[0];
    const nights = Math.ceil((new Date(check_out_date) - new Date(check_in_date)) / (1000 * 60 * 60 * 24));
    if (nights < 1) return fail(res, 'Minimum 1 night stay required');

    // Check availability
    const [booked] = await db.query(
      `SELECT COUNT(*) as cnt FROM bookings 
       WHERE room_type_id = ? AND room_id IS NOT NULL
       AND status IN ('confirmed','checked_in')
       AND check_in_date < ? AND check_out_date > ?`,
      [room_type_id, check_out_date, check_in_date]
    );

    const [totalRooms] = await db.query(
      `SELECT COUNT(*) as cnt FROM rooms WHERE room_type_id = ? AND is_active = 1 AND status != 'out_of_order'`,
      [room_type_id]
    );

    if (booked[0].cnt >= totalRooms[0].cnt) return fail(res, 'No rooms available for selected dates');

    const pricePerNight = await getEffectivePrice(room_type_id, check_in_date, check_out_date, roomType.base_price);

    // Get tax rate
    const [taxRow] = await db.query(`SELECT setting_value FROM hotel_settings WHERE setting_key = 'tax_rate'`);
    const taxRate = parseFloat(taxRow[0]?.setting_value || '0');

    const totalRoomCost = parseFloat((pricePerNight * nights).toFixed(2));
    const taxAmount = parseFloat((totalRoomCost * taxRate).toFixed(2));
    const totalAmount = parseFloat((totalRoomCost + taxAmount).toFixed(2));

    // Find or create guest
    let guestId;
    if (email) {
      const [existingGuest] = await db.query('SELECT id FROM guests WHERE email = ?', [email]);
      if (existingGuest.length) {
        guestId = existingGuest[0].id;
        await db.query(
          'UPDATE guests SET first_name=?, last_name=?, phone=? WHERE id=?',
          [first_name, last_name, phone, guestId]
        );
      }
    }

    if (!guestId) {
      const [guestResult] = await db.query(
        `INSERT INTO guests (uuid, first_name, last_name, email, phone, nationality, id_type, id_number)
         VALUES (?,?,?,?,?,?,?,?)`,
        [uuidv4(), first_name, last_name, email, phone, nationality, id_type, id_number]
      );
      guestId = guestResult.insertId;
    }

    const bookingRef = generateBookingRef();
    const [bookingResult] = await db.query(
      `INSERT INTO bookings (
        booking_ref, guest_id, room_type_id, check_in_date, check_out_date, 
        adults, children, base_price_per_night, total_room_cost, tax_amount, 
        total_amount, status, special_requests, source
       ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        bookingRef, guestId, room_type_id, check_in_date, check_out_date,
        adults || 1, children || 0, pricePerNight, totalRoomCost, taxAmount,
        totalAmount, 'confirmed', special_requests, 'website'
      ]
    );

    return ok(res, {
      booking: {
        booking_ref: bookingRef,
        booking_id: bookingResult.insertId,
        check_in_date,
        check_out_date,
        nights,
        room_type: roomType.name,
        price_per_night: pricePerNight,
        total_room_cost: totalRoomCost,
        tax_amount: taxAmount,
        total_amount: totalAmount,
        status: 'confirmed'
      }
    }, 'Booking confirmed successfully', 201);
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

// GET /api/public/bookings/:ref - guest lookup their booking
router.get('/bookings/:ref', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT b.*, g.first_name, g.last_name, g.email, g.phone,
              rt.name as room_type_name, r.room_number
       FROM bookings b
       JOIN guests g ON g.id = b.guest_id
       JOIN room_types rt ON rt.id = b.room_type_id
       LEFT JOIN rooms r ON r.id = b.room_id
       WHERE b.booking_ref = ?`,
      [req.params.ref.toUpperCase()]
    );
    if (!rows.length) return fail(res, 'Booking not found', 404);
    return ok(res, { booking: rows[0] });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/public/bookings/:ref/cancel - guest cancel booking
router.put('/bookings/:ref/cancel', async (req, res) => {
  const { email } = req.body;
  try {
    const [rows] = await db.query(
      `SELECT b.*, g.email as guest_email FROM bookings b JOIN guests g ON g.id = b.guest_id
       WHERE b.booking_ref = ?`,
      [req.params.ref.toUpperCase()]
    );
    if (!rows.length) return fail(res, 'Booking not found', 404);
    const booking = rows[0];

    if (booking.guest_email !== email) return fail(res, 'Email does not match booking', 403);
    if (['cancelled','checked_in','checked_out'].includes(booking.status))
      return fail(res, `Cannot cancel a booking with status: ${booking.status}`);

    await db.query(
      'UPDATE bookings SET status=?, cancelled_at=NOW() WHERE id=?',
      ['cancelled', booking.id]
    );
    return ok(res, {}, 'Booking cancelled successfully');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/public/contact
router.post('/contact', async (req, res) => {
  const { name, email, phone, subject, message } = req.body;
  if (!name || !email || !message) return fail(res, 'Name, email, and message are required');
  try {
    await db.query(
      'INSERT INTO contact_messages (name, email, phone, subject, message) VALUES (?,?,?,?,?)',
      [name, email, phone, subject, message]
    );
    return ok(res, {}, 'Message sent successfully');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;