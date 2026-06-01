// ── artist.routes.js ──────────────────────────────────────
const express = require('express');
const { upload } = require('../config/storage');
const path = require('path');
const router = express.Router();
const { getArtists, getArtist, getArtistArtworks, updateProfile, uploadAvatar, uploadCover, getDashboardStats, getArtistStats } = require('../controllers/artist.controller');
const { authenticate, requireArtist } = require('../middleware/auth.middleware');



router.get('/', getArtists);
router.get('/dashboard/stats', authenticate, requireArtist, getDashboardStats);
router.get('/:username', getArtist);
router.get('/:username/artworks', getArtistArtworks);
router.put('/profile', authenticate, requireArtist, updateProfile);
router.post('/profile/avatar', authenticate, requireArtist, upload.single('avatar'), uploadAvatar);
router.post('/profile/cover', authenticate, requireArtist, upload.single('cover'), uploadCover);

router.get('/:username/stats', getArtistStats)

module.exports = router;

// Estatísticas detalhadas de uma obra
router.get('/stats/artwork/:id', authenticate, requireArtist, async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const { id } = req.params

    const [artwork, favorites, contacts] = await Promise.all([
      prisma.artwork.findUnique({
        where: { id },
        select: { title: true, viewCount: true, createdAt: true, availability: true }
      }),
      prisma.favorite.count({ where: { artworkId: id } }),
      prisma.contactRequest.findMany({
        where: { artworkId: id },
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' }
      }),
    ])

    if (!artwork) return res.status(404).json({ error: 'Obra não encontrada' })

    res.json({ artwork, favorites, contacts: contacts.length, contactDates: contacts.map(c => c.createdAt) })
  } catch (err) {
    res.status(500).json({ error: 'Erro' })
  }
})

// Países com artistas internacionais
router.get('/countries', async (req, res) => {
  try {
    const { PrismaClient } = require('@prisma/client')
    const prisma = new PrismaClient()
    const countries = await prisma.artistProfile.groupBy({
      by: ['country'],
      where: { country: { not: { equals: 'Portugal', mode: 'insensitive' } }, AND: [{ country: { not: null } }, { country: { not: '' } }] },
      _count: { country: true },
      orderBy: { _count: { country: 'desc' } }
    })
    res.json(countries.filter(c => c.country).map(c => ({ country: c.country, count: c._count.country })))
  } catch (err) {
    res.status(500).json({ error: 'Erro' })
  }
})
