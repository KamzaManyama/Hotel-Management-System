const express = require('express');
const router = express.Router();
const db = require('../config/db');
const { authenticate, requireRole, auditLog } = require('../middleware/auth');
const { ok, fail, paginate } = require('../middleware/helpers');
const { uploadHousekeeping } = require('../middleware/upload');

router.use(authenticate);

// GET /api/housekeeping/tasks
router.get('/tasks', async (req, res) => {
  const { status, assigned_to, room_id, task_type } = req.query;
  const { limit, offset } = paginate(req);
  let query = `SELECT ht.*, r.room_number, r.status as room_status, rt.name as room_type,
                      s.full_name as assigned_name, r.floor
               FROM housekeeping_tasks ht
               JOIN rooms r ON r.id = ht.room_id
               JOIN room_types rt ON rt.id = r.room_type_id
               LEFT JOIN staff s ON s.id = ht.assigned_to
               WHERE 1=1`;
  const params = [];
  if (status) { query += ' AND ht.status=?'; params.push(status); }
  if (task_type) { query += ' AND ht.task_type=?'; params.push(task_type); }
  if (assigned_to) { query += ' AND ht.assigned_to=?'; params.push(assigned_to); }
  else if (req.staff.role === 'housekeeping') { query += ' AND ht.assigned_to=?'; params.push(req.staff.id); }
  if (room_id) { query += ' AND ht.room_id=?'; params.push(room_id); }
  query += ` ORDER BY FIELD(ht.priority,'urgent','high','normal','low'), ht.created_at LIMIT ${limit} OFFSET ${offset}`;
  try {
    const [rows] = await db.query(query, params);
    return ok(res, { tasks: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// GET /api/housekeeping/rooms - room cleaning overview
router.get('/rooms', async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT r.*, rt.name as type_name,
        (SELECT ht.status FROM housekeeping_tasks ht WHERE ht.room_id=r.id ORDER BY ht.created_at DESC LIMIT 1) as latest_task_status,
        (SELECT ht.assigned_to FROM housekeeping_tasks ht WHERE ht.room_id=r.id ORDER BY ht.created_at DESC LIMIT 1) as latest_assigned_to
       FROM rooms r JOIN room_types rt ON rt.id=r.room_type_id
       WHERE r.is_active=1 ORDER BY r.floor, r.room_number`
    );
    return ok(res, { rooms: rows });
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/housekeeping/tasks - create task
router.post('/tasks', requireRole('manager','receptionist','housekeeping'), async (req, res) => {
  const { room_id, task_type, assigned_to, priority, notes } = req.body;
  if (!room_id) return fail(res, 'room_id required');
  try {
    const [result] = await db.query(
      'INSERT INTO housekeeping_tasks (room_id, task_type, assigned_to, priority, notes, requested_by) VALUES (?,?,?,?,?,?)',
      [room_id, task_type||'daily_clean', assigned_to||null, priority||'normal', notes, req.staff.id]
    );
    return ok(res, { task_id: result.insertId }, 'Task created', 201);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/housekeeping/tasks/:id/status
router.put('/tasks/:id/status', async (req, res) => {
  const { status, notes } = req.body;
  const valid = ['pending','in_progress','completed','inspected'];
  if (!valid.includes(status)) return fail(res, 'Invalid status');
  try {
    const updates = [`status=?`];
    const params = [status];
    if (status === 'in_progress') { updates.push('started_at=NOW()'); }
    if (status === 'completed') { updates.push('completed_at=NOW()'); }
    if (notes) { updates.push('notes=?'); params.push(notes); }
    params.push(req.params.id);
    await db.query(`UPDATE housekeeping_tasks SET ${updates.join(',')} WHERE id=?`, params);
    
    // If inspected, mark room as inspected/available
    if (status === 'inspected') {
      const [task] = await db.query('SELECT room_id FROM housekeeping_tasks WHERE id=?', [req.params.id]);
      if (task.length) await db.query('UPDATE rooms SET status=? WHERE id=?', ['inspected', task[0].room_id]);
    }
    if (status === 'completed') {
      const [task] = await db.query('SELECT room_id FROM housekeeping_tasks WHERE id=?', [req.params.id]);
      if (task.length) await db.query('UPDATE rooms SET status=? WHERE id=?', ['clean', task[0].room_id]);
    }
    
    await auditLog(req.staff.id, 'HOUSEKEEPING_STATUS', 'housekeeping_task', req.params.id, {status}, req.ip);
    return ok(res, {}, `Task marked as ${status}`);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// POST /api/housekeeping/tasks/:id/photo
router.post('/tasks/:id/photo', uploadHousekeeping.single('photo'), async (req, res) => {
  if (!req.file) return fail(res, 'No photo uploaded');
  try {
    await db.query('UPDATE housekeeping_tasks SET issue_photo=? WHERE id=?', [req.file.path, req.params.id]);
    return ok(res, { path: req.file.path }, 'Photo uploaded');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/housekeeping/tasks/:id/assign
router.put('/tasks/:id/assign', requireRole('manager','receptionist'), async (req, res) => {
  const { assigned_to } = req.body;
  if (!assigned_to) return fail(res, 'assigned_to required');
  try {
    await db.query('UPDATE housekeeping_tasks SET assigned_to=? WHERE id=?', [assigned_to, req.params.id]);
    return ok(res, {}, 'Task assigned');
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

// PUT /api/housekeeping/rooms/:id/status - quick room status update
router.put('/rooms/:id/status', async (req, res) => {
  const { status, notes } = req.body;
  const valid = ['available','dirty','clean','inspected','out_of_order','maintenance'];
  if (!valid.includes(status)) return fail(res, 'Invalid status');
  try {
    await db.query('UPDATE rooms SET status=?, notes=COALESCE(?,notes) WHERE id=?', [status, notes, req.params.id]);
    await auditLog(req.staff.id, 'ROOM_STATUS_CHANGE', 'room', req.params.id, {status}, req.ip);
    return ok(res, {}, `Room marked as ${status}`);
  } catch (err) {
    return fail(res, 'Server error', 500);
  }
});

module.exports = router;