#  Hotel Management System — Backend API

A complete, self-contained hotel management system built with **Node.js + Express + MySQL**. No SaaS owner, no cloud dependency — install it and run it yourself.

---

##  Quick Setup

### 1. Prerequisites
- Node.js v18+
- MySQL 8.0+

### 2. Install Dependencies
```bash
npm install
```

### 3. Configure Environment
```bash
cp .env.example .env
# Edit .env and set your DB credentials
```

### 4. Setup Database
```bash
npm run setup-db
```
This creates all tables and a default manager account:
- **Email:** `admin@hotel.com`
- **Password:** `Admin@1234`
-  Change this password immediately after first login!

### 5. Start Server
```bash
npm start         # Production
npm run dev       # Development (with auto-reload)
```

Server runs on: `http://localhost:3000`
API Docs: `http://localhost:3000/api`

---

##  Authentication

All staff endpoints require a JWT token in the Authorization header:

```
Authorization: Bearer <your_jwt_token>
```

Get a token by calling `POST /api/auth/login`.

### Staff Roles
| Role | Access |
|------|--------|
| `manager` | Full access — settings, reports, staff management, pricing |
| `receptionist` | Bookings, check-in/out, payments, guests |
| `housekeeping` | Housekeeping tasks, room status |
| `maintenance` | Maintenance requests |

---

##  Public API (Guest-Facing, No Auth)

| Endpoint | Description |
|----------|-------------|
| `GET /api/public/hotel-info` | Hotel name, contact, policies |
| `GET /api/public/amenities` | Hotel facilities list |
| `GET /api/public/gallery` | Photo gallery (`?category=pool`) |
| `GET /api/public/room-types` | All room types with images & pricing |
| `GET /api/public/room-types/:slug` | Single room type |
| `GET /api/public/availability?check_in=2025-01-15&check_out=2025-01-18&adults=2` | Availability search |
| `POST /api/public/bookings` | Create booking from website |
| `GET /api/public/bookings/:ref` | Look up booking |
| `PUT /api/public/bookings/:ref/cancel` | Cancel booking (requires email) |
| `POST /api/public/contact` | Send contact message |

### Example: Check Availability
```
GET /api/public/availability?check_in=2025-03-01&check_out=2025-03-05&adults=2&children=1
```

### Example: Create Booking (Website)
```json
POST /api/public/bookings
{
  "room_type_id": 1,
  "check_in_date": "2025-03-01",
  "check_out_date": "2025-03-05",
  "adults": 2,
  "children": 0,
  "first_name": "John",
  "last_name": "Doe",
  "email": "john@email.com",
  "phone": "+1234567890",
  "special_requests": "Late check-in please"
}
```

---

##  Room Management

```
GET    /api/rooms                          # List all rooms
POST   /api/rooms                          # Create room [Manager]
PUT    /api/rooms/:id                      # Update room
PUT    /api/rooms/:id/status               # Quick status update

GET    /api/rooms/types                    # List room types
POST   /api/rooms/types                    # Create room type [Manager]
PUT    /api/rooms/types/:id                # Update room type
POST   /api/rooms/types/:id/images         # Upload room image (multipart: image file)
DELETE /api/rooms/types/:typeId/images/:id # Delete room image

GET    /api/rooms/pricing-rules            # List pricing rules
POST   /api/rooms/pricing-rules            # Create pricing rule
```

### Create Room Type
```json
POST /api/rooms/types
{
  "name": "Deluxe King Suite",
  "slug": "deluxe-king-suite",
  "description": "Spacious suite with ocean view...",
  "max_adults": 2,
  "max_children": 1,
  "bed_type": "King",
  "room_size_sqm": 45,
  "base_price": 250.00,
  "amenities": ["WiFi", "Mini Bar", "Balcony", "Safe"]
}
```

---

##  Booking Management

```
GET  /api/bookings                         # List bookings
POST /api/bookings                         # Create manually [Receptionist]
GET  /api/bookings/calendar?start=&end=    # Calendar view
GET  /api/bookings/today/arrivals          # Today's arrivals
GET  /api/bookings/today/departures        # Today's departures
GET  /api/bookings/today/no-shows          # Overdue check-ins
GET  /api/bookings/:id                     # Booking details
PUT  /api/bookings/:id                     # Edit booking
PUT  /api/bookings/:id/cancel              # Cancel
PUT  /api/bookings/:id/no-show             # Mark no-show
PUT  /api/bookings/:id/upgrade             # Upgrade room
PUT  /api/bookings/:id/vip                 # Mark VIP
POST /api/bookings/:id/checkin             # Check in guest
POST /api/bookings/:id/checkout            # Check out (auto housekeeping + invoice)
POST /api/bookings/:id/extra-charges       # Add charges
GET  /api/bookings/:id/invoice             # Get invoice
```

### Check In
```json
POST /api/bookings/123/checkin
{
  "room_id": 5,
  "id_verified": true,
  "signature_data": "data:image/png;base64,...",
  "notes": "Guest requested extra pillows"
}
```

---

##  Payments

```
GET  /api/payments                         # List payments
POST /api/payments                         # Record payment
POST /api/payments/refund                  # Issue refund [Manager]
POST /api/payments/discount                # Apply discount [Manager]
```

### Record Payment
```json
POST /api/payments
{
  "booking_id": 123,
  "amount": 500.00,
  "method": "card",
  "type": "full_payment",
  "reference_number": "TXN-123456"
}
```

---

##  Housekeeping

```
GET  /api/housekeeping/rooms               # Room cleaning overview
GET  /api/housekeeping/tasks               # Task list
POST /api/housekeeping/tasks               # Create task
PUT  /api/housekeeping/tasks/:id/status    # Update: pending → in_progress → completed → inspected
PUT  /api/housekeeping/tasks/:id/assign    # Assign to staff
POST /api/housekeeping/tasks/:id/photo     # Upload issue photo (multipart: photo file)
PUT  /api/housekeeping/rooms/:id/status    # Update room status directly
```

---

##  Maintenance

```
GET  /api/maintenance                      # List requests
GET  /api/maintenance/:id                  # Request details
POST /api/maintenance                      # Create request
PUT  /api/maintenance/:id/accept           # Accept task
PUT  /api/maintenance/:id/start            # Mark in progress
PUT  /api/maintenance/:id/complete         # Mark completed
PUT  /api/maintenance/:id/assign           # Assign to staff
POST /api/maintenance/:id/photo            # Upload repair photo
```

---

##  Lost & Found

```
GET  /api/lost-found                       # List items
GET  /api/lost-found/:id                   # Item details
POST /api/lost-found                       # Log found item
PUT  /api/lost-found/:id/store             # Mark stored (with storage location)
PUT  /api/lost-found/:id/link-guest        # Link to guest
PUT  /api/lost-found/:id/contact-attempt   # Log contact attempt
PUT  /api/lost-found/:id/claim             # Mark returned/shipped
PUT  /api/lost-found/:id/dispose           # Dispose [Manager]
POST /api/lost-found/:id/photo             # Upload item photo
```

---

## Reports (Manager Only)

```
GET /api/reports/dashboard                 # Main KPI dashboard
GET /api/reports/revenue?start_date=&end_date=   # Revenue report
GET /api/reports/occupancy?start_date=&end_date= # Occupancy stats
GET /api/reports/payments?start_date=&end_date=  # Payment history
GET /api/reports/lost-found                # Lost & found summary
GET /api/reports/housekeeping              # Staff performance
GET /api/reports/contacts                  # Contact messages
```

---

##  Settings (Manager Only)

```
GET /api/settings                          # Get all settings
PUT /api/settings                          # Update settings (send key:value pairs)
```

### Update Settings
```json
PUT /api/settings
{
  "hotel_name": "Grand Ocean Hotel",
  "hotel_phone": "+1 555 123 4567",
  "check_in_time": "15:00",
  "tax_rate": "0.12"
}
```

### Gallery Management
```
GET    /api/settings/gallery               # List gallery images
POST   /api/settings/gallery/upload        # Upload image (multipart: image file + title, category)
PUT    /api/settings/gallery/:id           # Update gallery item
DELETE /api/settings/gallery/:id           # Delete gallery item
```

---

##  Staff Management (Manager Only)

```
GET /api/staff                             # List staff
POST /api/staff                            # Create account
PUT /api/staff/:id                         # Update
PUT /api/staff/:id/disable                 # Disable
PUT /api/staff/:id/enable                  # Enable
PUT /api/staff/:id/reset-password          # Reset password
GET /api/staff/activity-logs               # Audit trail
```

---

##  Automated Behaviors

- ✅ Auto-generates booking reference (BK-YYYYMMDD-XXXXX)
- ✅ Auto-generates invoice number (INV-YYYY-XXXXX)
- ✅ Auto-generates payment reference
- ✅ Auto-calculates tax from settings
- ✅ Auto-marks room as dirty after checkout
- ✅ Auto-creates housekeeping task on checkout
- ✅ Prevents double booking
- ✅ Logs all staff actions to audit trail
- ✅ JWT session expires after 8 hours

---

##  Security

- Passwords hashed with bcrypt (10 rounds)
- JWT authentication with expiry
- Role-based access control on every route
- Full audit trail of all actions
- Input validation on all endpoints

---

##  Project Structure

```
hotel-system/
├── server.js              # Main entry point
├── config/
│   └── db.js              # MySQL connection pool
├── middleware/
│   ├── auth.js            # JWT auth + role checks + audit log
│   ├── helpers.js         # Response helpers, ref generators
│   └── upload.js          # Multer file upload configs
├── routes/
│   ├── auth.js            # Login, profile
│   ├── public.js          # Guest-facing API
│   ├── bookings.js        # Full booking management
│   ├── rooms.js           # Rooms + room types + pricing
│   ├── payments.js        # Payment recording
│   ├── guests.js          # Guest management
│   ├── housekeeping.js    # Housekeeping tasks
│   ├── maintenance.js     # Maintenance requests
│   ├── lostfound.js       # Lost & found
│   ├── reports.js         # Dashboard + exports
│   ├── settings.js        # Hotel settings + gallery
│   └── staff.js           # Staff management
├── db/
│   ├── schema.sql         # Full MySQL schema
│   └── setup.js           # DB setup + seed script
├── uploads/               # Uploaded images (auto-created)
├── .env.example
└── package.json
```
