const express = require('express')
const router = express.Router()
const { getArtworks, getArtwork, createArtwork, updateArtwork, deleteArtwork, uploadImages, getFeatured } = require('../controllers/artwork.controller')
const { authenticate, requireArtist, optionalAuth } = require('../middleware/auth.middleware')
const { upload } = require('../config/storage')

router.get('/', getArtworks)
router.get('/featured', getFeatured)
router.get('/:id', optionalAuth, getArtwork)
router.post('/', authenticate, requireArtist, createArtwork)
router.put('/:id', authenticate, requireArtist, updateArtwork)
router.delete('/:id', authenticate, requireArtist, deleteArtwork)
router.post('/:id/images', authenticate, requireArtist, upload.array('images', 10), uploadImages)

module.exports = router

// Obras similares
router.get('/:id/similar', async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const { id } = req.params

    const artwork = await prisma.artwork.findUnique({
      where: { id },
      include: { categories: true }
    })
    if (!artwork) return res.status(404).json({ error: 'Obra não encontrada' })

    const categoryIds = artwork.categories.map(c => c.categoryId)

    const similar = await prisma.artwork.findMany({
      where: {
        id: { not: id },
        artistId: { not: artwork.artistId },
        availability: 'AVAILABLE',
        categories: categoryIds.length > 0 ? { some: { categoryId: { in: categoryIds } } } : undefined,
      },
      take: 6,
      orderBy: { viewCount: 'desc' },
      include: {
        images: { where: { isPrimary: true }, take: 1 },
        artist: { select: { artistName: true, username: true } },
        categories: { include: { category: { select: { name: true } } } },
      }
    })

    res.json(similar)
  } catch (err) {
    res.status(500).json({ error: 'Erro' })
  }
})

// Obras do artista logado (dashboard)
router.get('/mine/all', authenticate, requireArtist, async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const artistProfile = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    if (!artistProfile) return res.status(404).json({ error: 'Artista não encontrado' })
    const artworks = await prisma.artwork.findMany({
      where: { artistId: artistProfile.id },
      orderBy: { createdAt: 'desc' },
      include: {
        images: { where: { isPrimary: true }, take: 1 },
        categories: { include: { category: { select: { name: true } } } },
      }
    })
    res.json({ data: artworks })
  } catch (err) {
    res.status(500).json({ error: 'Erro' })
  }
})
