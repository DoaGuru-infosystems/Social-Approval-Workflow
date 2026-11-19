const multer = require('multer');
const path = require('path');
const fs = require('fs');

const logosDir = path.join(__dirname, '..', 'uploads', 'logos');
if (!fs.existsSync(logosDir)) {
  fs.mkdirSync(logosDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, logosDir);
  },
  filename: (req, file, cb) => {
    const clientId = req.params.id || 'temp';
    const ext = path.extname(file.originalname).toLowerCase() || '.png';
    // Remove existing client logo files in directory to prevent orphaned formats
    try {
      const existingFiles = fs.readdirSync(logosDir);
      for (const f of existingFiles) {
        if (f.startsWith(`client_${clientId}_logo`)) {
          fs.unlinkSync(path.join(logosDir, f));
        }
      }
    } catch (_) {}

    cb(null, `client_${clientId}_logo${ext}`);
  },
});

const fileFilter = (req, file, cb) => {
  const allowedExts = ['.png', '.jpg', '.jpeg'];
  const allowedMimes = ['image/png', 'image/jpeg', 'image/jpg'];
  const ext = path.extname(file.originalname).toLowerCase();

  if (allowedExts.includes(ext) && allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error('Invalid file type. Only PNG and JPG/JPEG files are allowed.'), false);
  }
};

const logoUpload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB max
  },
});

module.exports = logoUpload;
