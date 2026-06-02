const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const { upload, processImage } = require('../config/storage')
const prisma = new PrismaClient()

const requireAdmin = (req, res, next) => {
  if (req.user?.accountType !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' })
  next()
}

router.get('/', async (req, res) => {
  try {
    const collections = await prisma.curatedCollection.findMany({
      where: { published: true },
      orderBy: { position: 'asc' },
      include: {
        items: {
          orderBy: { position: 'asc' },
          take: 6,
          include: {
            artwork: { include: { images: { where: { isPrimary: true }, take: 1 }, categories: { include: { category: true } }, artist: { select: { id: true, artistName: true, username: true, userId: true, city: true, user: { select: { avatarUrl: true } } } } } },
            artist: { select: { id: true, artistName: true, username: true, user: { select: { avatarUrl: true } }, _count: { select: { artworks: { where: { isDraft: false } } } } } }
          }
        },
        _count: { select: { items: true } }
      }
    })
    res.json(collections)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

router.get('/admin/all', authenticate, requireAdmin, async (req, res) => {
  try {
    const collections = await prisma.curatedCollection.findMany({
      orderBy: { position: 'asc' },
      include: { _count: { select: { items: true } } }
    })
    res.json(collections)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

router.get('/admin/:id/items', authenticate, requireAdmin, async (req, res) => {
  try {
    const items = await prisma.curatedItem.findMany({
      where: { collectionId: req.params.id },
      orderBy: { position: 'asc' },
      include: {
        artwork: { select: { id: true, title: true, images: { where: { isPrimary: true }, take: 1, select: { imageUrl: true } }, artist: { select: { artistName: true } } } },
        artist: { select: { id: true, artistName: true, username: true } }
      }
    })
    res.json(items)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

router.get('/:slug', async (req, res) => {
  try {
    const collection = await prisma.curatedCollection.findUnique({
      where: { slug: req.params.slug },
      include: {
        items: {
          orderBy: { position: 'asc' },
          include: {
            artwork: { include: { images: { orderBy: { isPrimary: 'desc' } }, artist: { select: { artistName: true, username: true } } } },
            artist: { select: { id: true, artistName: true, username: true, bio: true, city: true, user: { select: { avatarUrl: true } }, _count: { select: { artworks: { where: { isDraft: false } } } } } }
          }
        }
      }
    })
    if (!collection || !collection.published) return res.status(404).json({ error: 'Não encontrada' })
    res.json(collection)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

router.post('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const { title, description, slug } = req.body
    if (!title || !slug) return res.status(400).json({ error: 'Título e slug obrigatórios' })
    const collection = await prisma.curatedCollection.create({ data: { title, description, slug } })
    res.json(collection)
  } catch (err) { res.status(500).json({ error: 'Erro — slug pode já existir' }) }
})

router.put('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { title, description, published, position } = req.body
    const updated = await prisma.curatedCollection.update({
      where: { id: req.params.id },
      data: { ...(title && { title }), ...(description !== undefined && { description }), ...(published !== undefined && { published }), ...(position !== undefined && { position }), updatedAt: new Date() }
    })
    res.json(updated)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

router.delete('/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.curatedCollection.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

router.post('/:id/cover', authenticate, requireAdmin, upload.single('cover'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem' })
    const coverImageUrl = await processImage(req.file.buffer, 'curated')
    await prisma.curatedCollection.update({ where: { id: req.params.id }, data: { coverImageUrl } })
    res.json({ coverImageUrl })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

router.post('/:id/items', authenticate, requireAdmin, async (req, res) => {
  try {
    const { artworkId, artistId } = req.body
    if (!artworkId && !artistId) return res.status(400).json({ error: 'artworkId ou artistId obrigatório' })
    const count = await prisma.curatedItem.count({ where: { collectionId: req.params.id } })
    const item = await prisma.curatedItem.create({
      data: { collectionId: req.params.id, artworkId: artworkId || null, artistId: artistId || null, position: count }
    })
    res.json(item)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

router.delete('/:id/items/:itemId', authenticate, requireAdmin, async (req, res) => {
  try {
    await prisma.curatedItem.delete({ where: { id: req.params.itemId } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

module.exports = router
