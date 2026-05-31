const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

// GET /api/notifications — listar notificações do utilizador
router.get('/', authenticate, async (req, res) => {
  try {
    const notifications = await prisma.notification.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      take: 50
    })
    const unread = await prisma.notification.count({
      where: { userId: req.user.id, read: false }
    })
    res.json({ notifications, unread })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// PUT /api/notifications/read — marcar todas como lidas
router.put('/read', authenticate, async (req, res) => {
  try {
    await prisma.notification.updateMany({
      where: { userId: req.user.id, read: false },
      data: { read: true }
    })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// PUT /api/notifications/:id/read — marcar uma como lida
router.put('/:id/read', authenticate, async (req, res) => {
  try {
    await prisma.notification.update({
      where: { id: req.params.id },
      data: { read: true }
    })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

module.exports = router
