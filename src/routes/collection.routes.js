const express = require('express')
const router = express.Router()
const { getCollections, createCollection, addToCollection, removeFromCollection, deleteCollection } = require('../controllers/collection.controller')
const { authenticate } = require('../middleware/auth.middleware')

router.get('/', authenticate, getCollections)
router.post('/', authenticate, createCollection)
router.post('/:id/items', authenticate, addToCollection)
router.delete('/:id/items/:artworkId', authenticate, removeFromCollection)
router.delete('/:id', authenticate, deleteCollection)


// GET /api/collections/:id — detalhe de uma coleção
router.get('/:id', async (req, res) => {
  try {
    const { PrismaClient: PC } = require('@prisma/client')
    const p = new PC()
    const col = await p.collection.findUnique({
      where: { id: req.params.id },
      include: {
        items: {
          include: {
            artwork: {
              include: {
                images: { where: { isPrimary: true }, take: 1 },
                artist: { select: { artistName: true, username: true, userId: true, user: { select: { avatarUrl: true } } } },
                categories: { include: { category: true } }
              }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        user: { select: { name: true, username: true, avatarUrl: true } }
      }
    })
    if (!col) return res.status(404).json({ error: 'Coleção não encontrada' })
    res.json(col)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})


// PUT /api/collections/:id — actualizar coleção
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { PrismaClient: PC } = require('@prisma/client')
    const p = new PC()
    const { name, description, isPublic } = req.body
    const col = await p.collection.findFirst({ where: { id: req.params.id, userId: req.user.id } })
    if (!col) return res.status(404).json({ error: 'Baú não encontrado' })
    const updated = await p.collection.update({
      where: { id: req.params.id },
      data: { ...(name && { name }), ...(description !== undefined && { description }), ...(isPublic !== undefined && { isPublic }) }
    })
    res.json(updated)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

module.exports = router

// GET /api/collections/:id — detalhe de uma coleção