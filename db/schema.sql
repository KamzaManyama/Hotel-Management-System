-- ============================================================
-- HOTEL MANAGEMENT SYSTEM - FULL DATABASE SCHEMA
-- Run this file to set up the complete database
-- ============================================================

CREATE DATABASE IF NOT EXISTS hotel_management CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE hotel_management;

-- ============================================================
-- STAFF / USERS
-- ============================================================
CREATE TABLE IF NOT EXISTS staff (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) UNIQUE NOT NULL,
  full_name VARCHAR(100) NOT NULL,
  email VARCHAR(150) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role ENUM('manager','receptionist','housekeeping','maintenance') NOT NULL,
  phone VARCHAR(30),
  is_active BOOLEAN DEFAULT TRUE,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  last_login TIMESTAMP NULL,
  INDEX idx_role (role),
  INDEX idx_active (is_active)
);

-- ============================================================
-- HOTEL SETTINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS hotel_settings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  setting_key VARCHAR(100) UNIQUE NOT NULL,
  setting_value TEXT,
  updated_by INT,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

INSERT IGNORE INTO hotel_settings (setting_key, setting_value) VALUES
('hotel_name', 'My Hotel'),
('hotel_tagline', 'Your home away from home'),
('hotel_email', 'info@myhotel.com'),
('hotel_phone', '+1234567890'),
('hotel_address', '123 Hotel Street, City, Country'),
('hotel_description', 'A wonderful hotel for all occasions.'),
('check_in_time', '14:00'),
('check_out_time', '11:00'),
('tax_rate', '0.10'),
('currency', 'USD'),
('currency_symbol', 'ZAR'),
('cancellation_policy', 'Free cancellation up to 48 hours before arrival.'),
('child_policy', 'Children under 12 stay free.'),
('pet_policy', 'Pets are not allowed.'),
('wifi_password', ''),
('total_floors', '5');

-- ============================================================
-- ROOM TYPES / CATEGORIES
-- ============================================================
CREATE TABLE IF NOT EXISTS room_types (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) UNIQUE NOT NULL,
  description TEXT,
  short_description VARCHAR(255),
  max_adults INT DEFAULT 2,
  max_children INT DEFAULT 1,
  bed_type VARCHAR(100),
  room_size_sqm DECIMAL(8,2),
  base_price DECIMAL(10,2) NOT NULL,
  weekend_price DECIMAL(10,2),
  amenities JSON,
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ============================================================
-- ROOM TYPE IMAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS room_type_images (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_type_id INT NOT NULL,
  image_path VARCHAR(500) NOT NULL,
  caption VARCHAR(255),
  is_primary BOOLEAN DEFAULT FALSE,
  sort_order INT DEFAULT 0,
  uploaded_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_type_id) REFERENCES room_types(id) ON DELETE CASCADE,
  INDEX idx_room_type (room_type_id)
);

-- ============================================================
-- INDIVIDUAL ROOMS
-- ============================================================
CREATE TABLE IF NOT EXISTS rooms (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_number VARCHAR(20) UNIQUE NOT NULL,
  room_type_id INT NOT NULL,
  floor INT,
  description TEXT,
  status ENUM('available','occupied','dirty','clean','inspected','out_of_order','maintenance') DEFAULT 'available',
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (room_type_id) REFERENCES room_types(id),
  INDEX idx_status (status),
  INDEX idx_type (room_type_id)
);

-- ============================================================
-- SEASONAL / PROMOTIONAL PRICING
-- ============================================================
CREATE TABLE IF NOT EXISTS pricing_rules (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_type_id INT,
  name VARCHAR(150) NOT NULL,
  type ENUM('seasonal','weekend','promotion','special') NOT NULL,
  price_override DECIMAL(10,2),
  price_modifier_pct DECIMAL(5,2),
  start_date DATE,
  end_date DATE,
  days_of_week JSON,
  promo_code VARCHAR(50),
  is_active BOOLEAN DEFAULT TRUE,
  created_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (room_type_id) REFERENCES room_types(id) ON DELETE CASCADE,
  INDEX idx_type (type),
  INDEX idx_dates (start_date, end_date)
);

-- ============================================================
-- GUESTS
-- ============================================================
CREATE TABLE IF NOT EXISTS guests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  uuid VARCHAR(36) UNIQUE NOT NULL,
  first_name VARCHAR(100) NOT NULL,
  last_name VARCHAR(100) NOT NULL,
  email VARCHAR(150),
  phone VARCHAR(30),
  nationality VARCHAR(100),
  id_type ENUM('passport','national_id','drivers_license','other'),
  id_number VARCHAR(100),
  date_of_birth DATE,
  address TEXT,
  is_vip BOOLEAN DEFAULT FALSE,
  vip_notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  INDEX idx_email (email),
  INDEX idx_id_number (id_number)
);

-- ============================================================
-- BOOKINGS
-- ============================================================
CREATE TABLE IF NOT EXISTS bookings (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_ref VARCHAR(20) UNIQUE NOT NULL,
  guest_id INT NOT NULL,
  room_type_id INT NOT NULL,
  room_id INT,
  check_in_date DATE NOT NULL,
  check_out_date DATE NOT NULL,
  adults INT DEFAULT 1,
  children INT DEFAULT 0,
  nights INT GENERATED ALWAYS AS (DATEDIFF(check_out_date, check_in_date)) STORED,
  base_price_per_night DECIMAL(10,2) NOT NULL,
  total_room_cost DECIMAL(10,2) NOT NULL,
  extra_charges DECIMAL(10,2) DEFAULT 0,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  tax_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  amount_paid DECIMAL(10,2) DEFAULT 0,
  balance_due DECIMAL(10,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,
  status ENUM('pending','confirmed','checked_in','checked_out','cancelled','no_show','archived') DEFAULT 'pending',
  special_requests TEXT,
  internal_notes TEXT,
  is_vip BOOLEAN DEFAULT FALSE,
  source ENUM('website','walk_in','phone','agent','other') DEFAULT 'website',
  created_by INT,
  checked_in_by INT,
  checked_out_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  confirmed_at TIMESTAMP NULL,
  checked_in_at TIMESTAMP NULL,
  checked_out_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL,
  FOREIGN KEY (guest_id) REFERENCES guests(id),
  FOREIGN KEY (room_type_id) REFERENCES room_types(id),
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  INDEX idx_status (status),
  INDEX idx_check_in (check_in_date),
  INDEX idx_check_out (check_out_date),
  INDEX idx_ref (booking_ref)
);

-- ============================================================
-- DIGITAL SIGNATURES (Check-In)
-- ============================================================
CREATE TABLE IF NOT EXISTS signatures (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  guest_id INT NOT NULL,
  signature_data LONGTEXT,
  signed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  signed_by_staff INT,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (guest_id) REFERENCES guests(id)
);

-- ============================================================
-- PAYMENTS
-- ============================================================
CREATE TABLE IF NOT EXISTS payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  payment_ref VARCHAR(30) UNIQUE NOT NULL,
  booking_id INT NOT NULL,
  guest_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  method ENUM('cash','card','eft','online','refund','other') NOT NULL,
  type ENUM('deposit','full_payment','partial','extra_charge','refund','discount') DEFAULT 'full_payment',
  status ENUM('pending','completed','failed','refunded') DEFAULT 'completed',
  reference_number VARCHAR(100),
  notes TEXT,
  processed_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (guest_id) REFERENCES guests(id),
  INDEX idx_booking (booking_id),
  INDEX idx_created (created_at)
);

-- ============================================================
-- EXTRA CHARGES (Minibar, Room Service, etc.)
-- ============================================================
CREATE TABLE IF NOT EXISTS extra_charges (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id INT NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  quantity INT DEFAULT 1,
  added_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  INDEX idx_booking (booking_id)
);

-- ============================================================
-- INVOICES
-- ============================================================
CREATE TABLE IF NOT EXISTS invoices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  invoice_number VARCHAR(30) UNIQUE NOT NULL,
  booking_id INT NOT NULL,
  guest_id INT NOT NULL,
  subtotal DECIMAL(10,2) NOT NULL,
  tax_amount DECIMAL(10,2) NOT NULL,
  discount_amount DECIMAL(10,2) DEFAULT 0,
  total_amount DECIMAL(10,2) NOT NULL,
  amount_paid DECIMAL(10,2) DEFAULT 0,
  status ENUM('draft','issued','paid','partial','void') DEFAULT 'issued',
  issued_by INT,
  issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  due_date DATE,
  notes TEXT,
  FOREIGN KEY (booking_id) REFERENCES bookings(id),
  FOREIGN KEY (guest_id) REFERENCES guests(id),
  INDEX idx_booking (booking_id)
);

-- ============================================================
-- HOUSEKEEPING
-- ============================================================
CREATE TABLE IF NOT EXISTS housekeeping_tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT NOT NULL,
  task_type ENUM('checkout_clean','daily_clean','deep_clean','inspection','turndown') DEFAULT 'daily_clean',
  status ENUM('pending','in_progress','completed','inspected') DEFAULT 'pending',
  assigned_to INT,
  priority ENUM('low','normal','high','urgent') DEFAULT 'normal',
  notes TEXT,
  issue_photo VARCHAR(500),
  requested_by INT,
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  INDEX idx_room (room_id),
  INDEX idx_status (status),
  INDEX idx_assigned (assigned_to)
);

-- ============================================================
-- MAINTENANCE
-- ============================================================
CREATE TABLE IF NOT EXISTS maintenance_requests (
  id INT AUTO_INCREMENT PRIMARY KEY,
  room_id INT,
  title VARCHAR(255) NOT NULL,
  description TEXT,
  category ENUM('plumbing','electrical','hvac','furniture','appliance','structural','other') DEFAULT 'other',
  priority ENUM('low','normal','high','urgent') DEFAULT 'normal',
  status ENUM('open','assigned','in_progress','completed','cancelled') DEFAULT 'open',
  assigned_to INT,
  reported_by INT,
  repair_notes TEXT,
  repair_photo VARCHAR(500),
  started_at TIMESTAMP NULL,
  completed_at TIMESTAMP NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  INDEX idx_status (status),
  INDEX idx_room (room_id)
);

-- ============================================================
-- LOST & FOUND
-- ============================================================
CREATE TABLE IF NOT EXISTS lost_found (
  id INT AUTO_INCREMENT PRIMARY KEY,
  item_ref VARCHAR(20) UNIQUE NOT NULL,
  item_name VARCHAR(255) NOT NULL,
  description TEXT,
  category ENUM('electronics','clothing','jewellery','documents','money','keys','bags','other') DEFAULT 'other',
  room_id INT,
  location_found VARCHAR(255),
  date_found DATE NOT NULL,
  condition_status ENUM('good','damaged','partial') DEFAULT 'good',
  photo VARCHAR(500),
  storage_location VARCHAR(255),
  status ENUM('logged','stored','contacted','claimed','returned','shipped','unclaimed','disposed') DEFAULT 'logged',
  found_by INT,
  linked_guest_id INT,
  contact_attempts INT DEFAULT 0,
  last_contact_at TIMESTAMP NULL,
  signature_data LONGTEXT,
  claimed_at TIMESTAMP NULL,
  disposed_at TIMESTAMP NULL,
  notes TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (room_id) REFERENCES rooms(id),
  FOREIGN KEY (linked_guest_id) REFERENCES guests(id),
  INDEX idx_status (status),
  INDEX idx_date (date_found)
);

-- ============================================================
-- AUDIT LOGS
-- ============================================================
CREATE TABLE IF NOT EXISTS audit_logs (
  id INT AUTO_INCREMENT PRIMARY KEY,
  staff_id INT,
  action VARCHAR(100) NOT NULL,
  entity_type VARCHAR(50),
  entity_id INT,
  details JSON,
  ip_address VARCHAR(45),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_staff (staff_id),
  INDEX idx_entity (entity_type, entity_id),
  INDEX idx_created (created_at)
);

-- ============================================================
-- GALLERY
-- ============================================================
CREATE TABLE IF NOT EXISTS gallery (
  id INT AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255),
  description TEXT,
  image_path VARCHAR(500) NOT NULL,
  category ENUM('exterior','lobby','restaurant','pool','room','amenities','events','other') DEFAULT 'other',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0,
  uploaded_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- AMENITIES (Hotel Facilities)
-- ============================================================
CREATE TABLE IF NOT EXISTS amenities (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  description TEXT,
  icon VARCHAR(100),
  category ENUM('dining','recreation','business','transport','wellness','general') DEFAULT 'general',
  is_active BOOLEAN DEFAULT TRUE,
  sort_order INT DEFAULT 0
);

INSERT IGNORE INTO amenities (name, category, icon, sort_order) VALUES
('Free WiFi', 'general', 'wifi', 1),
('Swimming Pool', 'recreation', 'pool', 2),
('Restaurant', 'dining', 'restaurant', 3),
('Fitness Center', 'wellness', 'fitness', 4),
('Conference Rooms', 'business', 'meeting', 5),
('Spa & Wellness', 'wellness', 'spa', 6),
('Parking', 'transport', 'car', 7),
('24h Front Desk', 'general', 'desk', 8),
('Airport Transfer', 'transport', 'plane', 9),
('Room Service', 'dining', 'room-service', 10);

-- ============================================================
-- CONTACT MESSAGES
-- ============================================================
CREATE TABLE IF NOT EXISTS contact_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(150) NOT NULL,
  phone VARCHAR(30),
  subject VARCHAR(255),
  message TEXT NOT NULL,
  status ENUM('new','read','replied','archived') DEFAULT 'new',
  replied_by INT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_status (status)
);