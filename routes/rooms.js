const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole, auditLog } = require('../middleware/auth');
const { ok, fail, paginate } = require('../middleware/helpers');
const { uploadRoomImage } = require('../middleware/upload');

router.use(authenticate);

// ==================== ROOM TYPES ====================

// GET /api/rooms/types
router.get('/types', async (req, res) => {
  try {
    const [types] = await db.query('SELECT * FROM room_types ORDER BY sort_order, base_price');
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

// POST /api/rooms/types - manager only
router.post('/types', requireRole('manager'), async (req, res) => {
  const { name, slug, description, short_description, max_adults, max_children,
          bed_type, room_size_sqm, base_price, weekend_price, amenities } = req.body;
  if (!name || !slug || !base_price) return fail(res, 'name, slug, base_price required');
  try {
    const [result] = await db.query(
      `INSERT INTO room_types (name, slug, description, short_description, max_adults, max_children, 
        bed_type, room_size_sqm, base_price, weekend_price, amenities)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [name, slug, description, short_description, max_adults||2, max_children||1,
       bed_type, room_size_sqm, base_price, weekend_price, JSON.stringify(amenities||[])]
    );
    await auditLog(req.staff.id, 'CREATE_ROOM_TYPE', 'room_type', result.insertId, {name}, req.ip);
    return ok(res, { room_type_id: result.insertId }, 'Room type created', 201);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return fail(res, 'Slug already exists');
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/rooms/types/:id
router.put('/types/:id', requireRole('manager'), async (req, res) => {
  const allowed = ['name','slug','description','short_description','max_adults','max_children',
                   'bed_type','room_size_sqm','base_price','weekend_price','amenities','is_active','sort_order'];
  const fields = []; const params = [];
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      fields.push(`${key} = ?`);
      params.push(key === 'amenities' ? JSON.stringify(req.body[key]) : req.body[key]);
    }
  }
  if (!fields.length) return fail(res, 'Nothing to update');
  params.push(req.params.id);
  try {
    await db.query(`UPDATE room_types SET ${fields.join(', ')} WHERE id = ?`, params);
    return ok(res, {}, 'Room type updated');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/rooms/types/:id/images - upload room type image
router.post('/types/:id/images', requireRole('manager'), uploadRoomImage.single('image'), async (req, res) => {
  if (!req.file) return fail(res, 'No image uploaded');
  const { caption, is_primary, sort_order } = req.body;
  try {
    if (is_primary === 'true' || is_primary === true) {
      await db.query('UPDATE room_type_images SET is_primary = 0 WHERE room_type_id = ?', [req.params.id]);
    }
    const [result] = await db.query(
      'INSERT INTO room_type_images (room_type_id, image_path, caption, is_primary, sort_order, uploaded_by) VALUES (?,?,?,?,?,?)',
      [req.params.id, req.file.path, caption, is_primary ? 1 : 0, sort_order || 0, req.staff.id]
    );
    return ok(res, { image_id: result.insertId, path: req.file.path }, 'Image uploaded', 201);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// DELETE /api/rooms/types/:typeId/images/:imageId
router.delete('/types/:typeId/images/:imageId', requireRole('manager'), async (req, res) => {
  try {
    await db.query('DELETE FROM room_type_images WHERE id = ? AND room_type_id = ?', [req.params.imageId, req.params.typeId]);
    return ok(res, {}, 'Image deleted');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// ==================== INDIVIDUAL ROOMS ====================

// GET /api/rooms - list rooms
router.get('/', async (req, res) => {
  const { status, room_type_id, floor } = req.query;
  let query = `SELECT r.*, rt.name as type_name, rt.base_price 
               FROM rooms r JOIN room_types rt ON rt.id = r.room_type_id WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND r.status = ?'; params.push(status); }
  if (room_type_id) { query += ' AND r.room_type_id = ?'; params.push(room_type_id); }
  if (floor) { query += ' AND r.floor = ?'; params.push(floor); }
  query += ' ORDER BY r.room_number';
  try {
    const [rows] = await db.query(query, params);
    return ok(res, { rooms: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/rooms - create room
router.post('/', requireRole('manager'), async (req, res) => {
  const { room_number, room_type_id, floor, description } = req.body;
  if (!room_number || !room_type_id) return fail(res, 'room_number and room_type_id required');
  try {
    const [result] = await db.query(
      'INSERT INTO rooms (room_number, room_type_id, floor, description) VALUES (?,?,?,?)',
      [room_number, room_type_id, floor, description]
    );
    await auditLog(req.staff.id, 'CREATE_ROOM', 'room', result.insertId, {room_number}, req.ip);
    return ok(res, { room_id: result.insertId }, 'Room created', 201);
  } catch (err) {
    if (err.code === 'ER_DUP_ENTRY') return fail(res, 'Room number already exists');
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/rooms/:id - update room
router.put('/:id', requireRole('manager', 'receptionist'), async (req, res) => {
  const { room_number, room_type_id, floor, description, status, notes, is_active } = req.body;
  const fields = []; const params = [];
  if (room_number) { fields.push('room_number = ?'); params.push(room_number); }
  if (room_type_id) { fields.push('room_type_id = ?'); params.push(room_type_id); }
  if (floor !== undefined) { fields.push('floor = ?'); params.push(floor); }
  if (description !== undefined) { fields.push('description = ?'); params.push(description); }
  if (status) {
    const validStatuses = ['available','occupied','dirty','clean','inspected','out_of_order','maintenance'];
    if (!validStatuses.includes(status)) return fail(res, 'Invalid status');
    fields.push('status = ?'); params.push(status);
  }
  if (notes !== undefined) { fields.push('notes = ?'); params.push(notes); }
  if (is_active !== undefined) { fields.push('is_active = ?'); params.push(is_active); }
  if (!fields.length) return fail(res, 'Nothing to update');
  params.push(req.params.id);
  try {
    await db.query(`UPDATE rooms SET ${fields.join(', ')} WHERE id = ?`, params);
    await auditLog(req.staff.id, 'UPDATE_ROOM', 'room', req.params.id, req.body, req.ip);
    return ok(res, {}, 'Room updated');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/rooms/:id/status - quick status update
router.put('/:id/status', authenticate, async (req, res) => {
  const { status, notes } = req.body;
  const valid = ['available','occupied','dirty','clean','inspected','out_of_order','maintenance'];
  if (!valid.includes(status)) return fail(res, 'Invalid status');
  try {
    await db.query('UPDATE rooms SET status = ?, notes = ? WHERE id = ?', [status, notes, req.params.id]);
    await auditLog(req.staff.id, 'ROOM_STATUS_CHANGE', 'room', req.params.id, {status}, req.ip);
    return ok(res, {}, `Room marked as ${status}`);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// ==================== PRICING ====================

// GET /api/rooms/pricing-rules
router.get('/pricing-rules', requireRole('manager'), async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT pr.*, rt.name as room_type_name FROM pricing_rules pr 
       LEFT JOIN room_types rt ON rt.id = pr.room_type_id 
       ORDER BY pr.created_at DESC`
    );
    return ok(res, { pricing_rules: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/rooms/pricing-rules
router.post('/pricing-rules', requireRole('manager'), async (req, res) => {
  const { room_type_id, name, type, price_override, price_modifier_pct, start_date, end_date, days_of_week, promo_code } = req.body;
  if (!name || !type) return fail(res, 'name and type required');
  try {
    const [result] = await db.query(
      `INSERT INTO pricing_rules (room_type_id, name, type, price_override, price_modifier_pct, start_date, end_date, days_of_week, promo_code, created_by)
       VALUES (?,?,?,?,?,?,?,?,?,?)`,
      [room_type_id, name, type, price_override, price_modifier_pct, start_date, end_date, JSON.stringify(days_of_week), promo_code, req.staff.id]
    );
    return ok(res, { rule_id: result.insertId }, 'Pricing rule created', 201);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/rooms/pricing-rules/:id
router.put('/pricing-rules/:id', requireRole('manager'), async (req, res) => {
  const { name, price_override, price_modifier_pct, start_date, end_date, is_active } = req.body;
  const fields = []; const params = [];
  if (name) { fields.push('name=?'); params.push(name); }
  if (price_override !== undefined) { fields.push('price_override=?'); params.push(price_override); }
  if (price_modifier_pct !== undefined) { fields.push('price_modifier_pct=?'); params.push(price_modifier_pct); }
  if (start_date) { fields.push('start_date=?'); params.push(start_date); }
  if (end_date) { fields.push('end_date=?'); params.push(end_date); }
  if (is_active !== undefined) { fields.push('is_active=?'); params.push(is_active); }
  if (!fields.length) return fail(res, 'Nothing to update');
  params.push(req.params.id);
  try {
    await db.query(`UPDATE pricing_rules SET ${fields.join(',')} WHERE id=?`, params);
    return ok(res, {}, 'Pricing rule updated');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// DELETE /api/rooms/pricing-rules/:id
router.delete('/pricing-rules/:id', requireRole('manager'), async (req, res) => {
  try {
    await db.query('DELETE FROM pricing_rules WHERE id = ?', [req.params.id]);
    return ok(res, {}, 'Pricing rule deleted');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;