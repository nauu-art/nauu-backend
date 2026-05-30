const multer = require('multer')
const sharp = require('sharp')
const path = require('path')
const fs = require('fs')
const crypto = require('crypto')

const UPLOAD_DIR = '/var/www/nauu/uploads'

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/jpg', 'image/svg+xml']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error('Apenas imagens são permitidas'))
  },
})

const processImage = async (buffer, subfolder = 'artworks') => {
  console.log('processImage called, buffer size:', buffer ? buffer.length : 'null/undefined')
  
  if (!buffer || buffer.length === 0) {
    throw new Error('Buffer de imagem vazio')
  }

  const filename = `${crypto.randomBytes(16).toString('hex')}.webp`
  const dir = path.join(UPLOAD_DIR, subfolder)

  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })

  await sharp(buffer)
    .resize(2000, 2000, { fit: 'inside', withoutEnlargement: true })
    .webp({ quality: 85 })
    .toFile(path.join(dir, filename))

  return `/uploads/${subfolder}/${filename}`
}

module.exports = { upload, processImage }
