const path = require('path');
const fs = require('fs');
const sharp = require('sharp');

/**
 * Ensures an image is in JPEG format for Instagram compatibility.
 * If already JPEG, returns original path.
 * If PNG, WebP, etc., converts to high-quality JPEG and returns new relative path.
 *
 * @param {string} relativeOrAbsolutePath - Path to image (e.g. 'uploads/image.png')
 * @returns {Promise<string>} - Path to JPEG image (e.g. 'uploads/image.jpg')
 */
const ensureJpegForInstagram = async (imagePath) => {
  if (!imagePath) return imagePath;

  // If already .jpg or .jpeg, no conversion needed
  if (/\.(jpe?g)$/i.test(imagePath)) {
    return imagePath;
  }

  // Resolve absolute disk path
  const projectRoot = path.resolve(__dirname, '..');
  const diskPath = path.isAbsolute(imagePath)
    ? imagePath
    : path.join(projectRoot, imagePath.replace(/^[\\/]+/, ''));

  if (!fs.existsSync(diskPath)) {
    console.warn(`[ImageConverter] Source file does not exist: ${diskPath}`);
    return imagePath;
  }

  // Generate target .jpg path
  const dir = path.dirname(diskPath);
  const baseName = path.basename(diskPath, path.extname(diskPath));
  const jpegFileName = `${baseName}.jpg`;
  const targetJpegDiskPath = path.join(dir, jpegFileName);

  // Convert with sharp: flatten transparency with white background, JPEG quality 95
  try {
    await sharp(diskPath)
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: 95, mozjpeg: true })
      .toFile(targetJpegDiskPath);

    // Return project-relative path matching original style (e.g. 'uploads/xxx.jpg')
    const relativeToProject = path.relative(projectRoot, targetJpegDiskPath).replace(/\\/g, '/');
    console.log(`[ImageConverter] Converted ${imagePath} -> ${relativeToProject} (${fs.statSync(targetJpegDiskPath).size} bytes)`);
    return relativeToProject;
  } catch (err) {
    console.error(`[ImageConverter] Failed to convert image to JPEG:`, err.message);
    return imagePath;
  }
};

module.exports = {
  ensureJpegForInstagram,
};
