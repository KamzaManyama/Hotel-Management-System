require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

// Import routes
const authRoutes = require('./routes/auth');
const publicRoutes = require('./routes/public');
const staffRoutes = require('./routes/staff');
const roomRoutes = require('./routes/rooms');
const bookingRoutes = require('./routes/bookings');
const paymentRoutes = require('./routes/payments');
const housekeepingRoutes = require('./routes/housekeeping');
const maintenanceRoutes = require('./routes/maintenance');
const lostFoundRoutes = require('./routes/lostfound');
const reportsRoutes = require('./routes/reports');
const settingsRoutes = require('./routes/settings');
const guestRoutes = require('./routes/guests');

const app = express();
const PORT = process.env.PORT || 3000;

// ==================== MIDDLEWARE ====================
app.use(cors({
  origin: process.env.CORS_ORIGIN || '*',
  methods: ['GET','POST','PUT','DELETE','PATCH','OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Ensure uploads directory exists
const uploadDir = process.env.UPLOAD_DIR || 'uploads';
fs.mkdirSync(uploadDir, { recursive: true });

// Serve uploaded files
app.use(`/${uploadDir}`, express.static(path.join(__dirname, uploadDir)));

// Request logger (simple)
app.use((req, res, next) => {
  if (process.env.NODE_ENV !== 'production') {
    console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
  }
  next();
});

// ==================== ROUTES ====================

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'Hotel Management System',
    version: '1.0.0',
    timestamp: new Date().toISOString()
  });
});

// Public (guest-facing) routes - NO auth required
app.use('/api/public', publicRoutes);

// Auth routes
app.use('/api/auth', authRoutes);

// Staff routes (all require auth via their own middleware)
app.use('/api/staff', staffRoutes);
app.use('/api/rooms', roomRoutes);
app.use('/api/bookings', bookingRoutes);
app.use('/api/payments', paymentRoutes);
app.use('/api/housekeeping', housekeepingRoutes);
app.use('/api/maintenance', maintenanceRoutes);
app.use('/api/lost-found', lostFoundRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/guests', guestRoutes);

// ==================== API DOCS ====================
app.get('/api', (req, res) => {
  res.json({
    name: 'Hotel Management System API',
    version: '1.0.0',
    endpoints: {
      public: {
        description: 'Guest-facing endpoints (no auth required)',
        routes: {
          'GET /api/public/hotel-info': 'Hotel information and settings',
          'GET /api/public/amenities': 'Hotel amenities list',
          'GET /api/public/gallery': 'Hotel gallery images',
          'GET /api/public/room-types': 'All room types with images',
          'GET /api/public/room-types/:slug': 'Single room type detail',
          'GET /api/public/availability': 'Check availability (query: check_in, check_out, adults, children)',
          'POST /api/public/bookings': 'Create booking from website',
          'GET /api/public/bookings/:ref': 'Look up booking by reference',
          'PUT /api/public/bookings/:ref/cancel': 'Cancel booking (requires email)',
          'POST /api/public/contact': 'Submit contact form',
        }
      },
      auth: {
        description: 'Authentication (no auth required)',
        routes: {
          'POST /api/auth/login': 'Staff login - returns JWT',
          'GET /api/auth/me': 'Get current staff info [AUTH]',
          'PUT /api/auth/change-password': 'Change own password [AUTH]',
        }
      },
      staff: {
        description: 'Staff management [AUTH - Manager only]',
        routes: {
          'GET /api/staff': 'List all staff',
          'POST /api/staff': 'Create staff account',
          'PUT /api/staff/:id': 'Update staff',
          'PUT /api/staff/:id/disable': 'Disable staff account',
          'PUT /api/staff/:id/enable': 'Enable staff account',
          'PUT /api/staff/:id/reset-password': 'Reset staff password',
          'GET /api/staff/activity-logs': 'View audit logs',
        }
      },
      rooms: {
        description: 'Room management [AUTH]',
        routes: {
          'GET /api/rooms': 'List rooms (filter by status, type, floor)',
          'POST /api/rooms': 'Create room [Manager]',
          'PUT /api/rooms/:id': 'Update room [Manager/Receptionist]',
          'PUT /api/rooms/:id/status': 'Update room status',
          'GET /api/rooms/types': 'List room types',
          'POST /api/rooms/types': 'Create room type [Manager]',
          'PUT /api/rooms/types/:id': 'Update room type [Manager]',
          'POST /api/rooms/types/:id/images': 'Upload room type image [Manager]',
          'DELETE /api/rooms/types/:typeId/images/:imageId': 'Delete room image [Manager]',
          'GET /api/rooms/pricing-rules': 'List pricing rules [Manager]',
          'POST /api/rooms/pricing-rules': 'Create pricing rule [Manager]',
          'PUT /api/rooms/pricing-rules/:id': 'Update pricing rule [Manager]',
          'DELETE /api/rooms/pricing-rules/:id': 'Delete pricing rule [Manager]',
        }
      },
      bookings: {
        description: 'Booking management [AUTH]',
        routes: {
          'GET /api/bookings': 'List bookings (filter: status, check_in_date, search)',
          'POST /api/bookings': 'Create booking manually [Manager/Receptionist]',
          'GET /api/bookings/calendar': 'Calendar view (query: start, end)',
          'GET /api/bookings/today/arrivals': 'Today\'s arrivals',
          'GET /api/bookings/today/departures': 'Today\'s departures',
          'GET /api/bookings/today/no-shows': 'No-shows',
          'GET /api/bookings/:id': 'Get booking details',
          'PUT /api/bookings/:id': 'Edit booking [Manager/Receptionist]',
          'PUT /api/bookings/:id/cancel': 'Cancel booking',
          'PUT /api/bookings/:id/no-show': 'Mark no-show',
          'PUT /api/bookings/:id/upgrade': 'Upgrade room',
          'PUT /api/bookings/:id/vip': 'Mark VIP',
          'POST /api/bookings/:id/checkin': 'Check in guest',
          'POST /api/bookings/:id/checkout': 'Check out guest (auto-creates invoice + housekeeping task)',
          'POST /api/bookings/:id/extra-charges': 'Add extra charge',
          'GET /api/bookings/:id/invoice': 'Get invoice',
        }
      },
      payments: {
        description: 'Payments [AUTH - Manager/Receptionist]',
        routes: {
          'GET /api/payments': 'List payments',
          'POST /api/payments': 'Record payment',
          'POST /api/payments/refund': 'Issue refund [Manager]',
          'POST /api/payments/discount': 'Apply discount [Manager]',
        }
      },
      housekeeping: {
        description: 'Housekeeping [AUTH]',
        routes: {
          'GET /api/housekeeping/tasks': 'List tasks (own tasks for housekeeping role)',
          'GET /api/housekeeping/rooms': 'Room cleaning overview',
          'POST /api/housekeeping/tasks': 'Create task',
          'PUT /api/housekeeping/tasks/:id/status': 'Update task status',
          'PUT /api/housekeeping/tasks/:id/assign': 'Assign task',
          'POST /api/housekeeping/tasks/:id/photo': 'Upload photo',
          'PUT /api/housekeeping/rooms/:id/status': 'Quick room status update',
        }
      },
      maintenance: {
        description: 'Maintenance [AUTH]',
        routes: {
          'GET /api/maintenance': 'List maintenance requests',
          'GET /api/maintenance/:id': 'Get request details',
          'POST /api/maintenance': 'Create request',
          'PUT /api/maintenance/:id/accept': 'Accept task [Maintenance/Manager]',
          'PUT /api/maintenance/:id/start': 'Mark in progress',
          'PUT /api/maintenance/:id/complete': 'Mark completed',
          'PUT /api/maintenance/:id/assign': 'Assign task',
          'POST /api/maintenance/:id/photo': 'Upload photo',
        }
      },
      lost_found: {
        description: 'Lost & Found [AUTH]',
        routes: {
          'GET /api/lost-found': 'List items',
          'GET /api/lost-found/:id': 'Get item details',
          'POST /api/lost-found': 'Log found item',
          'PUT /api/lost-found/:id/store': 'Mark stored',
          'PUT /api/lost-found/:id/link-guest': 'Link to guest',
          'PUT /api/lost-found/:id/contact-attempt': 'Log contact attempt',
          'PUT /api/lost-found/:id/claim': 'Mark returned/shipped',
          'PUT /api/lost-found/:id/dispose': 'Mark disposed [Manager]',
          'POST /api/lost-found/:id/photo': 'Upload photo',
        }
      },
      reports: {
        description: 'Reports & Dashboard [AUTH - Manager only]',
        routes: {
          'GET /api/reports/dashboard': 'Main dashboard stats',
          'GET /api/reports/revenue': 'Revenue report (query: start_date, end_date)',
          'GET /api/reports/occupancy': 'Occupancy report',
          'GET /api/reports/payments': 'Payments report',
          'GET /api/reports/lost-found': 'Lost & found report',
          'GET /api/reports/housekeeping': 'Housekeeping performance',
          'GET /api/reports/contacts': 'Contact messages',
          'PUT /api/reports/contacts/:id/read': 'Mark contact as read',
        }
      },
      settings: {
        description: 'Hotel settings [AUTH - Manager only]',
        routes: {
          'GET /api/settings': 'Get all settings',
          'PUT /api/settings': 'Update settings (send key-value pairs)',
          'GET /api/settings/gallery': 'Get gallery items',
          'POST /api/settings/gallery/upload': 'Upload gallery image',
          'PUT /api/settings/gallery/:id': 'Update gallery item',
          'DELETE /api/settings/gallery/:id': 'Delete gallery item',
          'GET /api/settings/amenities': 'Get amenities',
          'POST /api/settings/amenities': 'Create amenity',
          'PUT /api/settings/amenities/:id': 'Update amenity',
          'DELETE /api/settings/amenities/:id': 'Delete amenity',
        }
      },
      guests: {
        description: 'Guest management [AUTH]',
        routes: {
          'GET /api/guests': 'Search guests',
          'GET /api/guests/:id': 'Get guest + booking history',
          'POST /api/guests': 'Create guest [Manager/Receptionist]',
          'PUT /api/guests/:id': 'Update guest [Manager/Receptionist]',
        }
      }
    }
  });
});

// ==================== ERROR HANDLING ====================
app.use((req, res) => {
  res.status(404).json({ success: false, message: `Route ${req.method} ${req.path} not found` });
});

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ success: false, message: 'File too large (max 10MB)' });
  res.status(500).json({ success: false, message: 'Internal server error', ...(process.env.NODE_ENV !== 'production' && { error: err.message }) });
});

// ==================== START ====================
app.listen(PORT, () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║    Hotel Management System Server        ║');
  console.log('╠══════════════════════════════════════════╣');
  console.log(`║    Running on: http://localhost:${PORT}     ║`);
  console.log(`║    API Docs:   http://localhost:${PORT}/api ║`);
  console.log(`║    Health: http://localhost:${PORT}/health  ║`);
  console.log('╚══════════════════════════════════════════╝\n');
});

module.exports = app;