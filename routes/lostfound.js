const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole, auditLog } = require('../middleware/auth');
const { ok, fail, paginate, generateItemRef } = require('../middleware/helpers');
const { uploadLostFound } = require('../middleware/upload');

router.use(authenticate);

// GET /api/lost-found
router.get('/', async (req, res) => {
  const { status, category, search } = req.query;
  const { limit, offset } = paginate(req);
  let query = `SELECT lf.*, r.room_number, g.first_name, g.last_name, g.email as guest_email,
                      s.full_name as found_by_name
               FROM lost_found lf
               LEFT JOIN rooms r ON r.id=lf.room_id
               LEFT JOIN guests g ON g.id=lf.linked_guest_id
               LEFT JOIN staff s ON s.id=lf.found_by
               WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND lf.status=?'; params.push(status); }
  if (category) { query += ' AND lf.category=?'; params.push(category); }
  if (search) { query += ' AND (lf.item_name LIKE ? OR lf.item_ref LIKE ? OR lf.description LIKE ?)'; params.push(`%${search}%`,`%${search}%`,`%${search}%`); }
  query += ` ORDER BY lf.date_found DESC LIMIT ${limit} OFFSET ${offset}`;
  try {
    const [rows] = await db.query(query, params);
    return ok(res, { items: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/lost-found/:id
router.get('/:id', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT lf.*, r.room_number, g.first_name, g.last_name, g.email, g.phone
       FROM lost_found lf
       LEFT JOIN rooms r ON r.id=lf.room_id
       LEFT JOIN guests g ON g.id=lf.linked_guest_id
       WHERE lf.id=? OR lf.item_ref=?`,
      [req.params.id, req.params.id]
    );
    if (!rows.length) return fail(res, 'Item not found', 404);
    return ok(res, { item: rows[0] });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/lost-found - log found item
router.post('/', async (req, res) => {
  const { item_name, description, category, room_id, location_found, date_found,
          condition_status, storage_location, notes } = req.body;
  if (!item_name || !date_found) return fail(res, 'item_name and date_found required');
  try {
    const ref = generateItemRef();
    const [result] = await db.query(
      `INSERT INTO lost_found (item_ref, item_name, description, category, room_id, location_found, 
        date_found, condition_status, storage_location, notes, found_by, status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
      [ref, item_name, description, category||'other', room_id||null, location_found, date_found,
       condition_status||'good', storage_location, notes, req.staff.id, 'logged']
    );
    return ok(res, { item_id: result.insertId, item_ref: ref }, 'Lost item logged', 201);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/lost-found/:id/store
router.put('/:id/store', async (req, res) => {
  const { storage_location } = req.body;
  try {
    await db.query(
      'UPDATE lost_found SET status=?, storage_location=COALESCE(?,storage_location) WHERE id=?',
      ['stored', storage_location, req.params.id]
    );
    return ok(res, {}, 'Item stored');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/lost-found/:id/link-guest
router.put('/:id/link-guest', requireRole('manager','receptionist'), async (req, res) => {
  const { guest_id } = req.body;
  if (!guest_id) return fail(res, 'guest_id required');
  try {
    await db.query('UPDATE lost_found SET linked_guest_id=?, status=? WHERE id=?', [guest_id, 'contacted', req.params.id]);
    return ok(res, {}, 'Item linked to guest');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/lost-found/:id/contact-attempt
router.put('/:id/contact-attempt', requireRole('manager','receptionist'), async (req, res) => {
  const { notes } = req.body;
  try {
    await db.query(
      `UPDATE lost_found SET contact_attempts=contact_attempts+1, last_contact_at=NOW(),
        notes=CONCAT(COALESCE(notes,''),' | Contact attempt: ',COALESCE(?,'')) WHERE id=?`,
      [notes, req.params.id]
    );
    return ok(res, {}, 'Contact attempt logged');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/lost-found/:id/claim
router.put('/:id/claim', requireRole('manager','receptionist'), async (req, res) => {
  const { method, notes, signature_data } = req.body;
  const validMethods = ['returned', 'shipped'];
  if (!method || !validMethods.includes(method)) return fail(res, 'method must be returned or shipped');
  try {
    await db.query(
      'UPDATE lost_found SET status=?, claimed_at=NOW(), signature_data=?, notes=CONCAT(COALESCE(notes,\'\'),\' | \',?) WHERE id=?',
      [method, signature_data, notes||'', req.params.id]
    );
    await auditLog(req.staff.id, 'LOST_FOUND_CLAIMED', 'lost_found', req.params.id, {method}, req.ip);
    return ok(res, {}, `Item marked as ${method}`);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/lost-found/:id/dispose
router.put('/:id/dispose', requireRole('manager'), async (req, res) => {
  const { reason } = req.body;
  try {
    await db.query(
      'UPDATE lost_found SET status=?, disposed_at=NOW(), notes=CONCAT(COALESCE(notes,\'\'),\' | Disposed: \',?) WHERE id=?',
      ['disposed', reason||'', req.params.id]
    );
    return ok(res, {}, 'Item marked as disposed');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/lost-found/:id/photo
router.post('/:id/photo', uploadLostFound.single('photo'), async (req, res) => {
  if (!req.file) return fail(res, 'No photo uploaded');
  try {
    await db.query('UPDATE lost_found SET photo=? WHERE id=?', [req.file.path, req.params.id]);
    return ok(res, { path: req.file.path }, 'Photo uploaded');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;