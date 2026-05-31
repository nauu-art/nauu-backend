const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const { notify, TYPES } = require('../utils/notify')
const { upload, processImage } = require('../config/storage')
const nodemailer = require('nodemailer')
const prisma = new PrismaClient()

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
})

const sendEmail = (to, subject, html) =>
  transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, html }).catch(console.error)

// GET /api/messages — inbox do utilizador
router.get('/', authenticate, async (req, res) => {
  try {
    const conversations = await prisma.conversation.findMany({
      where: { participants: { some: { userId: req.user.id } } },
      orderBy: { lastMessageAt: 'desc' },
      include: {
        artwork: { select: { id: true, title: true, images: { where: { isPrimary: true }, take: 1 } } },
        participants: {
          include: { user: { select: { id: true, name: true, avatarUrl: true, artistProfile: { select: { artistName: true, username: true } } } } }
        },
        messages: { orderBy: { createdAt: 'desc' }, take: 1 }
      }
    })
    // Adicionar unreadCount do utilizador atual
    const withUnread = conversations.map(c => ({
      ...c,
      myUnread: c.participants.find(p => p.userId === req.user.id)?.unreadCount || 0,
      otherParticipant: c.participants.find(p => p.userId !== req.user.id)
    }))
    res.json(withUnread)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// GET /api/messages/unread — total não lidas
router.get('/unread', authenticate, async (req, res) => {
  try {
    const total = await prisma.conversationParticipant.aggregate({
      where: { userId: req.user.id },
      _sum: { unreadCount: true }
    })
    res.json({ unread: total._sum.unreadCount || 0 })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/messages — iniciar conversa
router.post('/', authenticate, async (req, res) => {
  try {
    const { artistUserId, artworkId, content } = req.body
    if (!content?.trim()) return res.status(400).json({ error: 'Mensagem obrigatória' })
    if (req.user.id === artistUserId) return res.status(400).json({ error: 'Não podes enviar mensagem a ti próprio' })

    // Verificar se já existe conversa
    let conversation = await prisma.conversation.findFirst({
      where: {
        artworkId: artworkId || null,
        participants: { every: { userId: { in: [req.user.id, artistUserId] } } },
        AND: [
          { participants: { some: { userId: req.user.id } } },
          { participants: { some: { userId: artistUserId } } }
        ]
      }
    })

    if (!conversation) {
      // Determinar roles
      const artistProfile = await prisma.artistProfile.findUnique({ where: { userId: artistUserId } })
      conversation = await prisma.conversation.create({
        data: {
          artworkId: artworkId || null,
          participants: {
            create: [
              { userId: req.user.id, role: 'BUYER' },
              { userId: artistUserId, role: 'ARTIST' }
            ]
          }
        }
      })
    }

    // Criar mensagem
    const message = await prisma.message.create({
      data: { conversationId: conversation.id, senderId: req.user.id, content, type: 'TEXT' },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } }
    })

    // Atualizar conversa
    await prisma.conversation.update({
      where: { id: conversation.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: content.slice(0, 100), updatedAt: new Date() }
    })

    // Incrementar unread do destinatário
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: conversation.id, userId: { not: req.user.id } },
      data: { unreadCount: { increment: 1 } }
    })

    // Notificação in-app
    const sender = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } })
    await notify(artistUserId, 'NEW_MESSAGE', `${sender.name} enviou-te uma mensagem`, `/account/messages/${conversation.id}`)

    // Email
    const artistUser = await prisma.user.findUnique({ where: { id: artistUserId }, select: { email: true, name: true } })
    await sendEmail(
      artistUser.email,
      `Nova mensagem de ${sender.name} — nauu.art`,
      `<p>Olá ${artistUser.name},</p><p>${sender.name} enviou-te uma mensagem:</p><blockquote>${content}</blockquote><p><a href="${process.env.FRONTEND_URL}/dashboard/messages/${conversation.id}">Ver conversa →</a></p>`
    )

    res.json({ conversation, message })
  } catch (err) { console.error('POST /messages error:', err.message, err.stack); res.status(500).json({ error: err.message || 'Erro ao enviar mensagem' }) }
})

// GET /api/messages/:id — conversa completa
router.get('/:id', authenticate, async (req, res) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: {
        artwork: { select: { id: true, title: true, images: { where: { isPrimary: true }, take: 1 } } },
        participants: {
          include: { user: { select: { id: true, name: true, avatarUrl: true, artistProfile: { select: { artistName: true, username: true } } } } }
        },
        messages: {
          orderBy: { createdAt: 'asc' },
          include: { sender: { select: { id: true, name: true, avatarUrl: true } } }
        },
        shipments: true
      }
    })
    if (!conversation) return res.status(404).json({ error: 'Conversa não encontrada' })
    const isParticipant = conversation.participants.some(p => p.userId === req.user.id)
    if (!isParticipant) return res.status(403).json({ error: 'Sem acesso' })

    // Marcar como lido
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: req.params.id, userId: req.user.id },
      data: { unreadCount: 0, lastReadAt: new Date() }
    })

    res.json(conversation)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// POST /api/messages/:id/reply — responder
router.post('/:id/reply', authenticate, async (req, res) => {
  try {
    const { content, type = 'TEXT' } = req.body
    if (!content?.trim()) return res.status(400).json({ error: 'Mensagem obrigatória' })

    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { participants: true }
    })
    if (!conversation) return res.status(404).json({ error: 'Não encontrada' })
    const myParticipant = conversation.participants.find(p => p.userId === req.user.id)
    if (!myParticipant) return res.status(403).json({ error: 'Sem acesso' })
    if (myParticipant.role === 'BUYER' && !conversation.canBuyerReply) return res.status(403).json({ error: 'Conversa fechada' })
    if (myParticipant.role === 'ARTIST' && !conversation.canArtistReply) return res.status(403).json({ error: 'Conversa fechada' })

    const message = await prisma.message.create({
      data: { conversationId: req.params.id, senderId: req.user.id, content, type },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } }
    })

    await prisma.conversation.update({
      where: { id: req.params.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: content.slice(0, 100), updatedAt: new Date() }
    })

    // Incrementar unread dos outros participantes
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: req.params.id, userId: { not: req.user.id } },
      data: { unreadCount: { increment: 1 } }
    })

    // Notificar outros participantes
    const sender = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } })
    const others = conversation.participants.filter(p => p.userId !== req.user.id)
    for (const p of others) {
      await notify(p.userId, 'NEW_MESSAGE', `${sender.name} enviou-te uma mensagem`, `/account/messages/${req.params.id}`)
    }

    res.json(message)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao responder' }) }
})

// PUT /api/messages/:id/status — fechar/bloquear conversa (artista)
router.put('/:id/status', authenticate, async (req, res) => {
  try {
    const { status, canBuyerReply, canArtistReply } = req.body
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { participants: true }
    })
    if (!conversation) return res.status(404).json({ error: 'Não encontrada' })
    const isParticipant = conversation.participants.some(p => p.userId === req.user.id)
    if (!isParticipant) return res.status(403).json({ error: 'Sem acesso' })

    await prisma.conversation.update({
      where: { id: req.params.id },
      data: { ...(status && { status }), ...(canBuyerReply !== undefined && { canBuyerReply }), ...(canArtistReply !== undefined && { canArtistReply }) }
    })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/messages/:id/image — enviar imagem
router.post('/:id/image', authenticate, upload.single('image'), async (req, res) => {
  try {
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { participants: true }
    })
    if (!conversation) return res.status(404).json({ error: 'Não encontrada' })
    if (!conversation.participants.some(p => p.userId === req.user.id)) return res.status(403).json({ error: 'Sem acesso' })
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem' })

    const imageUrl = await processImage(req.file.buffer, 'messages')
    const message = await prisma.message.create({
      data: { conversationId: req.params.id, senderId: req.user.id, content: '📷 Imagem', type: 'IMAGE', imageUrl },
      include: { sender: { select: { id: true, name: true, avatarUrl: true } } }
    })

    await prisma.conversation.update({
      where: { id: req.params.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: '📷 Imagem', updatedAt: new Date() }
    })
    await prisma.conversationParticipant.updateMany({
      where: { conversationId: req.params.id, userId: { not: req.user.id } },
      data: { unreadCount: { increment: 1 } }
    })

    res.json(message)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// POST /api/messages/:id/shipment — adicionar tracking (artista)
router.post('/:id/shipment', authenticate, async (req, res) => {
  try {
    const { carrier, trackingNumber, trackingUrl } = req.body
    const conversation = await prisma.conversation.findUnique({
      where: { id: req.params.id },
      include: { participants: true }
    })
    if (!conversation) return res.status(404).json({ error: 'Não encontrada' })
    const myParticipant = conversation.participants.find(p => p.userId === req.user.id)
    if (!myParticipant || myParticipant.role !== 'ARTIST') return res.status(403).json({ error: 'Só artistas podem adicionar tracking' })

    const shipment = await prisma.shipment.create({
      data: { conversationId: req.params.id, carrier, trackingNumber, trackingUrl, shippedAt: new Date() }
    })

    // Mensagem de sistema
    await prisma.message.create({
      data: {
        conversationId: req.params.id,
        senderId: req.user.id,
        content: `📦 Encomenda enviada via ${carrier || 'transportadora'}. Tracking: ${trackingNumber || 'N/A'}`,
        type: 'SHIPPING',
        metadata: JSON.stringify({ shipmentId: shipment.id, trackingNumber, trackingUrl })
      }
    })

    await prisma.conversation.update({
      where: { id: req.params.id },
      data: { lastMessageAt: new Date(), lastMessagePreview: '📦 Encomenda enviada', updatedAt: new Date() }
    })

    // Notificar comprador
    const buyer = conversation.participants.find(p => p.role === 'BUYER')
    if (buyer) {
      const sender = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } })
      await notify(buyer.userId, 'SHIPPING', `${sender.name} marcou a tua encomenda como enviada`, `/account/messages/${req.params.id}`)
    }

    res.json(shipment)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// POST /api/messages/:id/report — reportar conversa
router.post('/:id/report', authenticate, async (req, res) => {
  try {
    await prisma.conversation.update({
      where: { id: req.params.id },
      data: { reportedAt: new Date(), reportedBy: req.user.id }
    })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

module.exports = router
