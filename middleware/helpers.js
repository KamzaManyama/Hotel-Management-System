const { v4: uuidv4 } = require('uuid');

// Generate booking reference: BK-YYYYMMDD-XXXX
const generateBookingRef = () => {
  const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const rand = Math.random().toString(36).substr(2, 5).toUpperCase();
  return `BK-${date}-${rand}`;
};

// Generate payment reference
const generatePaymentRef = () => {
  const rand = Math.random().toString(36).substr(2, 8).toUpperCase();
  return `PAY-${rand}`;
};

// Generate invoice number: INV-YYYY-XXXXX
const generateInvoiceNumber = () => {
  const year = new Date().getFullYear();
  const rand = Math.floor(Math.random() * 90000) + 10000;
  return `INV-${year}-${rand}`;
};

// Generate lost & found ref
const generateItemRef = () => {
  const rand = Math.random().toString(36).substr(2, 6).toUpperCase();
  return `LF-${rand}`;
};

// Success response
const ok = (res, data = {}, message = 'Success', statusCode = 200) => {
  return res.status(statusCode).json({ success: true, message, ...data });
};

// Error response
const fail = (res, message = 'An error occurred', statusCode = 400, errors = null) => {
  const body = { success: false, message };
  if (errors) body.errors = errors;
  return res.status(statusCode).json(body);
};

// Pagination helper
const paginate = (req) => {
  const page = parseInt(req.query.page) || 1;
  const limit = Math.min(parseInt(req.query.limit) || 20, 100);
  const offset = (page - 1) * limit;
  return { page, limit, offset };
};

module.exports = {
  generateBookingRef,
  generatePaymentRef,
  generateInvoiceNumber,
  generateItemRef,
  uuidv4,
  ok,
  fail,
  paginate,
};