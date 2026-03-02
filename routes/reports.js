const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ok, fail } = require('../middleware/helpers');

router.use(authenticate, requireRole('manager'));

// GET /api/reports/dashboard - main dashboard stats
router.get('/dashboard', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];

    // Occupancy
    const [totalRooms] = await db.query(`SELECT COUNT(*) as total FROM rooms WHERE is_active=1 AND status != 'out_of_order'`);
    const [occupiedRooms] = await db.query(`SELECT COUNT(*) as total FROM rooms WHERE status='occupied'`);
    const occupancyRate = totalRooms[0].total > 0 
      ? ((occupiedRooms[0].total / totalRooms[0].total) * 100).toFixed(1) 
      : 0;

    // Daily revenue
    const [dailyRev] = await db.query(
      `SELECT COALESCE(SUM(amount),0) as total FROM payments WHERE DATE(created_at)=? AND amount > 0`,
      [today]
    );

    // Monthly revenue
    const [monthlyRev] = await db.query(
      `SELECT COALESCE(SUM(amount),0) as total FROM payments 
       WHERE YEAR(created_at)=YEAR(NOW()) AND MONTH(created_at)=MONTH(NOW()) AND amount > 0`
    );

    // Arrivals today
    const [arrivals] = await db.query(
      `SELECT COUNT(*) as total FROM bookings WHERE check_in_date=? AND status IN ('confirmed','pending')`, [today]
    );

    // Departures today
    const [departures] = await db.query(
      `SELECT COUNT(*) as total FROM bookings WHERE check_out_date=? AND status='checked_in'`, [today]
    );

    // Room status overview
    const [roomStatuses] = await db.query(
      `SELECT status, COUNT(*) as count FROM rooms WHERE is_active=1 GROUP BY status`
    );

    // Lost & found summary
    const [lostFound] = await db.query(
      `SELECT status, COUNT(*) as count FROM lost_found GROUP BY status`
    );

    // Maintenance pending
    const [maintenance] = await db.query(
      `SELECT COUNT(*) as total FROM maintenance_requests WHERE status IN ('open','assigned','in_progress')`
    );

    // Housekeeping pending
    const [housekeeping] = await db.query(
      `SELECT COUNT(*) as total FROM housekeeping_tasks WHERE status IN ('pending','in_progress')`
    );

    // Pending payments
    const [pendingPay] = await db.query(
      `SELECT COUNT(*) as total, COALESCE(SUM(total_amount - amount_paid),0) as total_owed
       FROM bookings WHERE balance_due > 0 AND status IN ('confirmed','checked_in')`
    );

    return ok(res, {
      occupancy: {
        rate: parseFloat(occupancyRate),
        occupied: occupiedRooms[0].total,
        total: totalRooms[0].total
      },
      revenue: {
        today: parseFloat(dailyRev[0].total),
        this_month: parseFloat(monthlyRev[0].total)
      },
      bookings: {
        arrivals_today: arrivals[0].total,
        departures_today: departures[0].total
      },
      room_statuses: roomStatuses,
      lost_found: lostFound,
      maintenance_open: maintenance[0].total,
      housekeeping_pending: housekeeping[0].total,
      pending_payments: {
        count: pendingPay[0].total,
        total_owed: parseFloat(pendingPay[0].total_owed)
      }
    });
  } catch (err) {
    console.error(err);
    return fail(res, 'Server error', 500);
  }
});

// GET /api/reports/revenue?start_date=&end_date=
router.get('/revenue', async (req, res) => {
  const { start_date, end_date } = req.query;
  const start = start_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const end = end_date || new Date().toISOString().split('T')[0];
  try {
    const [daily] = await db.query(
      `SELECT DATE(created_at) as date, SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END) as revenue,
              SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END) as refunds,
              COUNT(*) as transactions
       FROM payments WHERE DATE(created_at) BETWEEN ? AND ?
       GROUP BY DATE(created_at) ORDER BY date`,
      [start, end]
    );

    const [byMethod] = await db.query(
      `SELECT method, SUM(amount) as total, COUNT(*) as count
       FROM payments WHERE DATE(created_at) BETWEEN ? AND ? AND amount > 0
       GROUP BY method`,
      [start, end]
    );

    const [totals] = await db.query(
      `SELECT COALESCE(SUM(CASE WHEN amount > 0 THEN amount ELSE 0 END),0) as total_revenue,
              COALESCE(SUM(CASE WHEN amount < 0 THEN ABS(amount) ELSE 0 END),0) as total_refunds
       FROM payments WHERE DATE(created_at) BETWEEN ? AND ?`,
      [start, end]
    );

    return ok(res, { start_date: start, end_date: end, daily, by_method: byMethod, totals: totals[0] });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/reports/occupancy?start_date=&end_date=
router.get('/occupancy', async (req, res) => {
  const { start_date, end_date } = req.query;
  const start = start_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const end = end_date || new Date().toISOString().split('T')[0];
  try {
    const [daily] = await db.query(
      `SELECT b.check_in_date as date, COUNT(*) as bookings,
              SUM(b.nights) as total_nights, SUM(b.total_amount) as revenue
       FROM bookings b WHERE b.check_in_date BETWEEN ? AND ? AND b.status NOT IN ('cancelled','no_show')
       GROUP BY b.check_in_date ORDER BY date`,
      [start, end]
    );

    const [byRoomType] = await db.query(
      `SELECT rt.name, COUNT(b.id) as bookings, SUM(b.nights) as total_nights, SUM(b.total_amount) as revenue
       FROM bookings b JOIN room_types rt ON rt.id=b.room_type_id
       WHERE b.check_in_date BETWEEN ? AND ? AND b.status NOT IN ('cancelled','no_show')
       GROUP BY rt.id, rt.name ORDER BY revenue DESC`,
      [start, end]
    );

    const [summary] = await db.query(
      `SELECT COUNT(*) as total_bookings, SUM(nights) as total_nights,
              COALESCE(SUM(total_amount),0) as total_revenue,
              AVG(nights) as avg_stay_length,
              SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END) as cancellations,
              SUM(CASE WHEN status='no_show' THEN 1 ELSE 0 END) as no_shows
       FROM bookings WHERE check_in_date BETWEEN ? AND ?`,
      [start, end]
    );

    return ok(res, { start_date: start, end_date: end, daily, by_room_type: byRoomType, summary: summary[0] });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/reports/payments?start_date=&end_date=
router.get('/payments', async (req, res) => {
  const { start_date, end_date } = req.query;
  const start = start_date || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split('T')[0];
  const end = end_date || new Date().toISOString().split('T')[0];
  try {
    const [payments] = await db.query(
      `SELECT p.*, b.booking_ref, g.first_name, g.last_name, s.full_name as staff_name
       FROM payments p JOIN bookings b ON b.id=p.booking_id JOIN guests g ON g.id=p.guest_id
       LEFT JOIN staff s ON s.id=p.processed_by
       WHERE DATE(p.created_at) BETWEEN ? AND ? ORDER BY p.created_at DESC`,
      [start, end]
    );
    return ok(res, { payments, count: payments.length });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/reports/lost-found
router.get('/lost-found', async (req, res) => {
  try {
    const [items] = await db.query(
      `SELECT lf.*, r.room_number, g.first_name, g.last_name, s.full_name as found_by_name
       FROM lost_found lf LEFT JOIN rooms r ON r.id=lf.room_id
       LEFT JOIN guests g ON g.id=lf.linked_guest_id LEFT JOIN staff s ON s.id=lf.found_by
       ORDER BY lf.date_found DESC`
    );
    const [summary] = await db.query(
      `SELECT status, COUNT(*) as count FROM lost_found GROUP BY status`
    );
    return ok(res, { items, summary });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/reports/housekeeping
router.get('/housekeeping', async (req, res) => {
  const { start_date, end_date } = req.query;
  const start = start_date || new Date().toISOString().split('T')[0];
  const end = end_date || new Date().toISOString().split('T')[0];
  try {
    const [performance] = await db.query(
      `SELECT s.full_name, s.id,
              COUNT(ht.id) as tasks_assigned,
              SUM(CASE WHEN ht.status='completed' THEN 1 ELSE 0 END) as completed,
              AVG(TIMESTAMPDIFF(MINUTE, ht.started_at, ht.completed_at)) as avg_minutes
       FROM housekeeping_tasks ht JOIN staff s ON s.id=ht.assigned_to
       WHERE DATE(ht.created_at) BETWEEN ? AND ?
       GROUP BY s.id, s.full_name`,
      [start, end]
    );
    return ok(res, { performance });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/reports/contacts - contact messages inbox
router.get('/contacts', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT * FROM contact_messages ORDER BY created_at DESC LIMIT 100`
    );
    return ok(res, { messages: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/reports/contacts/:id/read
router.put('/contacts/:id/read', async (req, res) => {
  try {
    await db.query('UPDATE contact_messages SET status=? WHERE id=?', ['read', req.params.id]);
    return ok(res, {}, 'Marked as read');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;