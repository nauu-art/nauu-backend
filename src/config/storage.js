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
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/jpg']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error('Apenas imagens são permitidas'))
  },
})

const processImage = async (buffer, subfolder = 'artworks') => {
  console.log('processImage called, buffer size:', buffer ? buffer.length : 'null/undefined')
  
  if (!buffer || buffer.length === 0) {
    throw new Error('Buffer de imagem vazio')
  }

  // Validar magic bytes (primeiros bytes do ficheiro)
  const magicBytes = buffer.slice(0, 4)
  const isJpeg = magicBytes[0] === 0xFF && magicBytes[1] === 0xD8
  const isPng = magicBytes[0] === 0x89 && magicBytes[1] === 0x50 && magicBytes[2] === 0x4E && magicBytes[3] === 0x47
  const isWebp = buffer.slice(8, 12).toString('ascii') === 'WEBP'
  const isGif = magicBytes[0] === 0x47 && magicBytes[1] === 0x49 && magicBytes[2] === 0x46

  if (!isJpeg && !isPng && !isWebp && !isGif) {
    throw new Error('Formato de imagem inválido')
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
