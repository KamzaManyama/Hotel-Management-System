const multer = require('multer');
const path = require('path');
const fs = require('fs');

const getStorage = (folder) => multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = path.join(process.env.UPLOAD_DIR || 'uploads', folder);
    fs.mkdirSync(dir, { recursive: true });
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
    cb(null, name);
  },
});

const imageFilter = (req, file, cb) => {
  const allowed = ['.jpg', '.jpeg', '.png', '.gif', '.webp'];
  const ext = path.extname(file.originalname).toLowerCase();
  if (allowed.includes(ext)) cb(null, true);
  else cb(new Error('Only image files are allowed'), false);
};

const uploadRoomImage = multer({ storage: getStorage('rooms'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadGallery = multer({ storage: getStorage('gallery'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadMaintenance = multer({ storage: getStorage('maintenance'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadLostFound = multer({ storage: getStorage('lost-found'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });
const uploadHousekeeping = multer({ storage: getStorage('housekeeping'), fileFilter: imageFilter, limits: { fileSize: 10 * 1024 * 1024 } });

module.exports = { uploadRoomImage, uploadGallery, uploadMaintenance, uploadLostFound, uploadHousekeeping };