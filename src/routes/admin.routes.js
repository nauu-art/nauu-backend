const express = require('express')
const router = express.Router()
const multer = require('multer')
const path = require('path')
const fs = require('fs')
const { adminLogin, getStats, getUsers, getUserDetail, banUser, promoteToArtist, getArtworks, toggleFeatured, deleteArtwork, toggleArtistFeatured } = require('../controllers/admin.controller')
const { authenticate } = require('../middleware/auth.middleware')

const requireAdmin = (req, res, next) => {
  if (!req.user || req.user.accountType !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso restrito a administradores' })
  }
  next()
}

// Multer para logo — guarda em disco temporariamente
const logoUpload = multer({
  storage: multer.diskStorage({
    destination: '/tmp/',
    filename: (req, file, cb) => cb(null, 'logo-upload' + path.extname(file.originalname))
  }),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = ['image/svg+xml', 'image/png', 'image/jpeg']
    if (allowed.includes(file.mimetype)) cb(null, true)
    else cb(new Error('Apenas SVG ou PNG'))
  }
})

router.post('/login', adminLogin)
router.get('/stats', authenticate, requireAdmin, getStats)
router.get('/users', authenticate, requireAdmin, getUsers)
router.get('/users/:id', authenticate, requireAdmin, getUserDetail)
router.put('/users/:id/ban', authenticate, requireAdmin, banUser)

router.delete('/users/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const user = await prisma.user.findUnique({ where: { id: req.params.id } })
    if (!user) return res.status(404).json({ error: 'Utilizador não encontrado' })
    if (user.accountType === 'ADMIN') return res.status(403).json({ error: 'Não podes apagar um admin' })
    await prisma.user.delete({ where: { id: req.params.id } })
    res.json({ message: 'Utilizador eliminado' })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao eliminar utilizador' })
  }
})
router.put('/users/:id/promote', authenticate, requireAdmin, promoteToArtist)
router.get('/artworks', authenticate, requireAdmin, getArtworks)
router.put('/artworks/:id/featured', authenticate, requireAdmin, toggleFeatured)
router.delete('/artworks/:id', authenticate, requireAdmin, deleteArtwork)
router.put('/artists/:id/featured', authenticate, requireAdmin, toggleArtistFeatured)
router.put('/artists/:id/approve', authenticate, requireAdmin, async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const { status } = req.body // APPROVED, REJECTED, PENDING
    const artist = await prisma.artistProfile.update({
      where: { id: req.params.id },
      data: { status }
    })
    res.json(artist)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// GET /api/admin/settings
router.get('/settings', authenticate, requireAdmin, async (req, res) => {
  const { PrismaClient } = require('@prisma/client')
  const prisma = new PrismaClient()
  const svgPath = '/var/www/nauu/frontend/public/logo.svg'
  const pngPath = '/var/www/nauu/frontend/public/logo.png'
  const logoUrl = fs.existsSync(svgPath) ? '/logo.svg' : fs.existsSync(pngPath) ? '/logo.png' : null
  const featureRows = await prisma.siteSettings.findMany({ where: { key: { startsWith: 'feature_' } } }).catch(() => [])
  const features = Object.fromEntries(featureRows.map(r => [r.key.replace('feature_', ''), r.value === 'true']))
  await prisma.$disconnect()
  res.json({ logoUrl, features })
})

// PATCH /api/admin/settings/features
router.patch('/settings/features', authenticate, requireAdmin, async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const { key, value } = req.body
    const allowedKeys = ['ar', 'colorPalette']
    if (!allowedKeys.includes(key)) return res.status(400).json({ error: 'Chave inválida' })
    await prisma.siteSettings.upsert({
      where: { key: `feature_${key}` },
      update: { value: String(value) },
      create: { key: `feature_${key}`, value: String(value) }
    })
    await prisma.$disconnect()
    res.json({ ok: true, key, value })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao guardar' })
  }
})

// POST /api/admin/logo
router.post('/logo', authenticate, requireAdmin, logoUpload.single('logo'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhum ficheiro enviado' })

    const isSvg = req.file.mimetype === 'image/svg+xml'
    const outputPath = isSvg
      ? '/var/www/nauu/frontend/public/logo.svg'
      : '/var/www/nauu/frontend/public/logo.png'

    if (isSvg) {
      fs.copyFileSync(req.file.path, outputPath)
    } else {
      const sharp = require('sharp')
      await sharp(req.file.path)
        .resize(400, null, { withoutEnlargement: true })
        .png()
        .toFile(outputPath)
    }

    fs.unlinkSync(req.file.path)

    const logoUrl = isSvg ? `/logo.svg?v=${Date.now()}` : `/logo.png?v=${Date.now()}`
    res.json({ message: 'Logo atualizado!', url: logoUrl })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao fazer upload do logo' })
  }
})

// module.exports moved to end

// Conteúdo editável
const { PrismaClient: PC2 } = require('@prisma/client')
const prismaContent = new PC2()

router.get('/content/:key', authenticate, requireAdmin, async (req, res) => {
  try {
    const content = await prismaContent.siteContent.findUnique({ where: { key: req.params.key } })
    res.json(content || { key: req.params.key, title: '', content: '' })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

router.put('/content/:key', authenticate, requireAdmin, async (req, res) => {
  try {
    const { title, content } = req.body
    const updated = await prismaContent.siteContent.upsert({
      where: { key: req.params.key },
      update: { title, content },
      create: { key: req.params.key, title, content }
    })
    res.json(updated)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// Blog posts
router.get('/blog', authenticate, requireAdmin, async (req, res) => {
  try {
    const posts = await prismaContent.siteContent.findMany({
      where: { key: { startsWith: 'blog_' } },
      orderBy: { updatedAt: 'desc' }
    })
    res.json(posts)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

router.post('/blog', authenticate, requireAdmin, async (req, res) => {
  try {
    const { title, content, slug } = req.body
    if (!title || !content || !slug) return res.status(400).json({ error: 'Campos obrigatórios' })
    const post = await prismaContent.siteContent.create({
      data: { key: `blog_${slug}`, title, content }
    })
    res.status(201).json(post)
  } catch { res.status(500).json({ error: 'Erro ao criar post' }) }
})

router.delete('/blog/:key', authenticate, requireAdmin, async (req, res) => {
  try {
    await prismaContent.siteContent.delete({ where: { key: req.params.key } })
    res.json({ message: 'Post eliminado' })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// Upload capa blog
const { processImage: processImg } = require('../config/storage')
const multerLocal = require('multer'); const uploadCoverLocal = multerLocal({ storage: multerLocal.memoryStorage(), limits: { fileSize: 10*1024*1024 }, fileFilter: (req, file, cb) => { const allowed = ['image/jpeg','image/png','image/webp']; allowed.includes(file.mimetype) ? cb(null, true) : cb(new Error('Apenas imagens JPEG, PNG ou WebP')) } })
router.post('/blog/:key/cover', authenticate, requireAdmin, uploadCoverLocal.single('cover'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Sem ficheiro' })
    const imageUrl = await processImg(req.file.buffer, 'blog')
    const { PrismaClient: PC3 } = require('@prisma/client')
    const p = new PC3()
    await p.siteContent.update({ where: { key: req.params.key }, data: { imageUrl } })
    res.json({ imageUrl })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao fazer upload' })
  }
})

// Upload capa blog

module.exports = router

// Rota pública para conteúdo legal
router.get('/public/content/:key', async (req, res) => {
  try {
    const { PrismaClient: PC4 } = require('@prisma/client')
    const p = new PC4()
    const content = await p.siteContent.findUnique({ where: { key: req.params.key } })
    res.json(content || { key: req.params.key, title: '', content: '' })
  } catch { res.status(500).json({ error: 'Erro' }) }
})
