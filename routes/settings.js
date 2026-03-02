const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole } = require('../middleware/auth');
const { ok, fail } = require('../middleware/helpers');
const { uploadGallery } = require('../middleware/upload');

router.use(authenticate, requireRole('manager'));

// ==================== HOTEL SETTINGS ====================

// GET /api/settings
router.get('/', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT setting_key, setting_value FROM hotel_settings ORDER BY setting_key');
    const settings = {};
    rows.forEach(r => settings[r.setting_key] = r.setting_value);
    return ok(res, { settings });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/settings - update multiple settings
router.put('/', async (req, res) => {
  const updates = req.body; // { key: value, key: value }
  if (!updates || typeof updates !== 'object') return fail(res, 'Provide settings as key-value pairs');
  try {
    for (const [key, value] of Object.entries(updates)) {
      await db.query(
        'INSERT INTO hotel_settings (setting_key, setting_value, updated_by) VALUES (?,?,?) ON DUPLICATE KEY UPDATE setting_value=?, updated_by=?',
        [key, value, req.staff.id, value, req.staff.id]
      );
    }
    return ok(res, {}, 'Settings updated');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// ==================== GALLERY ====================

// GET /api/settings/gallery
router.get('/gallery', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM gallery ORDER BY sort_order, id DESC');
    return ok(res, { gallery: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/settings/gallery/upload
router.post('/gallery/upload', uploadGallery.single('image'), async (req, res) => {
  if (!req.file) return fail(res, 'No image uploaded');
  const { title, description, category, sort_order } = req.body;
  try {
    const [result] = await db.query(
      'INSERT INTO gallery (title, description, image_path, category, sort_order, uploaded_by) VALUES (?,?,?,?,?,?)',
      [title, description, req.file.path, category||'other', sort_order||0, req.staff.id]
    );
    return ok(res, { image_id: result.insertId, path: req.file.path }, 'Image uploaded', 201);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/settings/gallery/:id
router.put('/gallery/:id', async (req, res) => {
  const { title, description, category, is_active, sort_order } = req.body;
  const fields = []; const params = [];
  if (title !== undefined) { fields.push('title=?'); params.push(title); }
  if (description !== undefined) { fields.push('description=?'); params.push(description); }
  if (category) { fields.push('category=?'); params.push(category); }
  if (is_active !== undefined) { fields.push('is_active=?'); params.push(is_active); }
  if (sort_order !== undefined) { fields.push('sort_order=?'); params.push(sort_order); }
  if (!fields.length) return fail(res, 'Nothing to update');
  params.push(req.params.id);
  try {
    await db.query(`UPDATE gallery SET ${fields.join(',')} WHERE id=?`, params);
    return ok(res, {}, 'Gallery item updated');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// DELETE /api/settings/gallery/:id
router.delete('/gallery/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM gallery WHERE id=?', [req.params.id]);
    return ok(res, {}, 'Gallery item deleted');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// ==================== AMENITIES ====================

// GET /api/settings/amenities
router.get('/amenities', async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM amenities ORDER BY sort_order, name');
    return ok(res, { amenities: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/settings/amenities
router.post('/amenities', async (req, res) => {
  const { name, description, icon, category, sort_order } = req.body;
  if (!name) return fail(res, 'name required');
  try {
    const [result] = await db.query(
      'INSERT INTO amenities (name, description, icon, category, sort_order) VALUES (?,?,?,?,?)',
      [name, description, icon, category||'general', sort_order||0]
    );
    return ok(res, { amenity_id: result.insertId }, 'Amenity created', 201);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/settings/amenities/:id
router.put('/amenities/:id', async (req, res) => {
  const { name, description, icon, category, is_active, sort_order } = req.body;
  const fields = []; const params = [];
  if (name) { fields.push('name=?'); params.push(name); }
  if (description !== undefined) { fields.push('description=?'); params.push(description); }
  if (icon) { fields.push('icon=?'); params.push(icon); }
  if (category) { fields.push('category=?'); params.push(category); }
  if (is_active !== undefined) { fields.push('is_active=?'); params.push(is_active); }
  if (sort_order !== undefined) { fields.push('sort_order=?'); params.push(sort_order); }
  if (!fields.length) return fail(res, 'Nothing to update');
  params.push(req.params.id);
  try {
    await db.query(`UPDATE amenities SET ${fields.join(',')} WHERE id=?`, params);
    return ok(res, {}, 'Amenity updated');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// DELETE /api/settings/amenities/:id
router.delete('/amenities/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM amenities WHERE id=?', [req.params.id]);
    return ok(res, {}, 'Amenity deleted');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;