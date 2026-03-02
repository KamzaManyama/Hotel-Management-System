const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole, auditLog } = require('../middleware/auth');
const { ok, fail, paginate } = require('../middleware/helpers');
const { uploadMaintenance } = require('../middleware/upload');

router.use(authenticate);

// GET /api/maintenance - list requests
router.get('/', async (req, res) => {
  const { status, priority, category, room_id, assigned_to } = req.query;
  const { limit, offset } = paginate(req);
  let query = `SELECT mr.*, r.room_number, r.floor,
                      s.full_name as assigned_name,
                      sr.full_name as reported_by_name
               FROM maintenance_requests mr
               LEFT JOIN rooms r ON r.id=mr.room_id
               LEFT JOIN staff s ON s.id=mr.assigned_to
               LEFT JOIN staff sr ON sr.id=mr.reported_by
               WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND mr.status=?'; params.push(status); }
  if (priority) { query += ' AND mr.priority=?'; params.push(priority); }
  if (category) { query += ' AND mr.category=?'; params.push(category); }
  if (room_id) { query += ' AND mr.room_id=?'; params.push(room_id); }
  if (assigned_to) { query += ' AND mr.assigned_to=?'; params.push(assigned_to); }
  else if (req.staff.role === 'maintenance') { query += ' AND mr.assigned_to=?'; params.push(req.staff.id); }
  query += ` ORDER BY FIELD(mr.priority,'urgent','high','normal','low'), mr.created_at DESC LIMIT ${limit} OFFSET ${offset}`;
  try {
    const [rows] = await db.query(query, params);
    return ok(res, { requests: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/maintenance/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT mr.*, r.room_number, s.full_name as assigned_name 
       FROM maintenance_requests mr 
       LEFT JOIN rooms r ON r.id=mr.room_id
       LEFT JOIN staff s ON s.id=mr.assigned_to
       WHERE mr.id=?`,
      [req.params.id]
    );
    if (!rows.length) return fail(res, 'Request not found', 404);
    return ok(res, { request: rows[0] });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/maintenance - create request
router.post('/', async (req, res) => {
  const { room_id, title, description, category, priority, assigned_to } = req.body;
  if (!title) return fail(res, 'title required');
  try {
    // Mark room as maintenance if room_id provided
    if (room_id) {
      await db.query('UPDATE rooms SET status=? WHERE id=?', ['maintenance', room_id]);
    }
    const [result] = await db.query(
      'INSERT INTO maintenance_requests (room_id, title, description, category, priority, assigned_to, reported_by) VALUES (?,?,?,?,?,?,?)',
      [room_id||null, title, description, category||'other', priority||'normal', assigned_to||null, req.staff.id]
    );
    await auditLog(req.staff.id, 'CREATE_MAINTENANCE', 'maintenance_request', result.insertId, {title}, req.ip);
    return ok(res, { request_id: result.insertId }, 'Maintenance request created', 201);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/maintenance/:id/accept - maintenance staff accepts task
router.put('/:id/accept', requireRole('maintenance','manager'), async (req, res) => {
  try {
    await db.query(
      'UPDATE maintenance_requests SET status=?, assigned_to=? WHERE id=? AND status=?',
      ['assigned', req.staff.id, req.params.id, 'open']
    );
    return ok(res, {}, 'Task accepted');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/maintenance/:id/start
router.put('/:id/start', requireRole('maintenance','manager'), async (req, res) => {
  try {
    await db.query(
      `UPDATE maintenance_requests SET status='in_progress', started_at=NOW() WHERE id=?`,
      [req.params.id]
    );
    return ok(res, {}, 'Marked in progress');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/maintenance/:id/complete
router.put('/:id/complete', requireRole('maintenance','manager'), async (req, res) => {
  const { repair_notes, mark_room_available } = req.body;
  try {
    await db.query(
      `UPDATE maintenance_requests SET status='completed', completed_at=NOW(), repair_notes=? WHERE id=?`,
      [repair_notes, req.params.id]
    );
    if (mark_room_available) {
      const [rows] = await db.query('SELECT room_id FROM maintenance_requests WHERE id=?', [req.params.id]);
      if (rows.length && rows[0].room_id) {
        await db.query('UPDATE rooms SET status=? WHERE id=?', ['available', rows[0].room_id]);
      }
    }
    await auditLog(req.staff.id, 'COMPLETE_MAINTENANCE', 'maintenance_request', req.params.id, {repair_notes}, req.ip);
    return ok(res, {}, 'Marked completed');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/maintenance/:id/photo
router.post('/:id/photo', uploadMaintenance.single('photo'), async (req, res) => {
  if (!req.file) return fail(res, 'No photo uploaded');
  try {
    await db.query('UPDATE maintenance_requests SET repair_photo=? WHERE id=?', [req.file.path, req.params.id]);
    return ok(res, { path: req.file.path }, 'Photo uploaded');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/maintenance/:id/assign
router.put('/:id/assign', requireRole('manager','receptionist'), async (req, res) => {
  const { assigned_to } = req.body;
  if (!assigned_to) return fail(res, 'assigned_to required');
  try {
    await db.query('UPDATE maintenance_requests SET assigned_to=?, status=? WHERE id=?', [assigned_to, 'assigned', req.params.id]);
    return ok(res, {}, 'Task assigned');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;