const express = require('express')
const router = express.Router()
const { authenticate, requireArtist } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const { processImage } = require('../config/storage')
const { upload } = require('../config/storage')
const prisma = new PrismaClient()

// GET /api/artist-collections/:username — coleções públicas de um artista
router.get('/by/:username', async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { username: req.params.username } })
    if (!artist) return res.status(404).json({ error: 'Artista não encontrado' })
    const collections = await prisma.artistCollection.findMany({
      where: { artistId: artist.id },
      orderBy: { position: 'asc' },
      include: {
        artworks: {
          where: { isDraft: false },
          take: 4,
          orderBy: { createdAt: 'desc' },
          include: { images: { where: { isPrimary: true }, take: 1 } }
        },
        _count: { select: { artworks: { where: { isDraft: false } } } }
      }
    })
    res.json(collections)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// GET /api/artist-collections/collection/:id — detalhe de uma coleção
router.get('/collection/:id', async (req, res) => {
  try {
    const collection = await prisma.artistCollection.findUnique({
      where: { id: req.params.id },
      include: {
        artist: { select: { artistName: true, username: true, user: { select: { avatarUrl: true } } } },
        artworks: {
          where: { isDraft: false },
          orderBy: { createdAt: 'desc' },
          include: {
            images: { orderBy: { isPrimary: 'desc' } },
            categories: { include: { category: { select: { name: true } } } }
          }
        }
      }
    })
    if (!collection) return res.status(404).json({ error: 'Coleção não encontrada' })
    res.json(collection)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// GET /api/artist-collections/my/all — coleções do artista logado
router.get('/my/all', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const collections = await prisma.artistCollection.findMany({
      where: { artistId: artist.id },
      orderBy: { position: 'asc' },
      include: {
        _count: { select: { artworks: true } },
        artworks: { take: 1, include: { images: { where: { isPrimary: true }, take: 1 } } }
      }
    })
    res.json(collections)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/artist-collections — criar coleção
router.post('/', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const { name, description } = req.body
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' })
    const collection = await prisma.artistCollection.create({
      data: { artistId: artist.id, name, description }
    })
    res.json(collection)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// PUT /api/artist-collections/:id — editar coleção
router.put('/:id', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const collection = await prisma.artistCollection.findUnique({ where: { id: req.params.id } })
    if (!collection || collection.artistId !== artist.id) return res.status(403).json({ error: 'Sem permissão' })
    const { name, description } = req.body
    const updated = await prisma.artistCollection.update({
      where: { id: req.params.id },
      data: { name, description, updatedAt: new Date() }
    })
    res.json(updated)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// DELETE /api/artist-collections/:id — apagar coleção
router.delete('/:id', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const collection = await prisma.artistCollection.findUnique({ where: { id: req.params.id } })
    if (!collection || collection.artistId !== artist.id) return res.status(403).json({ error: 'Sem permissão' })
    await prisma.artwork.updateMany({ where: { collectionId: req.params.id }, data: { collectionId: null } })
    await prisma.artistCollection.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/artist-collections/:id/cover — upload capa
router.post('/:id/cover', authenticate, requireArtist, upload.single('cover'), async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const collection = await prisma.artistCollection.findUnique({ where: { id: req.params.id } })
    if (!collection || collection.artistId !== artist.id) return res.status(403).json({ error: 'Sem permissão' })
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem' })
    const coverImageUrl = await processImage(req.file.buffer, 'collections')
    await prisma.artistCollection.update({ where: { id: req.params.id }, data: { coverImageUrl } })
    res.json({ coverImageUrl })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// PUT /api/artist-collections/artwork/:artworkId — associar obra a coleção
router.put('/artwork/:artworkId', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const artwork = await prisma.artwork.findUnique({ where: { id: req.params.artworkId } })
    if (!artwork || artwork.artistId !== artist.id) return res.status(403).json({ error: 'Sem permissão' })
    const { collectionId } = req.body
    if (collectionId) {
      const col = await prisma.artistCollection.findUnique({ where: { id: collectionId } })
      if (!col || col.artistId !== artist.id) return res.status(403).json({ error: 'Sem permissão' })
    }
    await prisma.artwork.update({ where: { id: req.params.artworkId }, data: { collectionId: collectionId || null } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

module.exports = router
