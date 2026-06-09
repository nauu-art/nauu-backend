const express = require('express')
const router = express.Router()
const { PrismaClient } = require('@prisma/client')
const { generateCertificatePDF } = require('../services/certificate.service')

const prisma = new PrismaClient()

const ORDER_INCLUDE = {
  buyer: { select: { name: true, email: true } },
  artist: { select: { artistName: true } },
  artwork: {
    include: {
      images: { where: { isPrimary: true }, take: 1 },
      artist: { select: { artistName: true } }
    }
  }
}

// GET /api/certificates/:orderId — download PDF (comprador ou artista autenticado)
router.get('/:orderId', async (req, res) => {
  try {
    const { orderId } = req.params
    const order = await prisma.order.findUnique({ where: { id: orderId }, include: ORDER_INCLUDE })
    if (!order || order.status !== 'PAID') return res.status(404).json({ error: 'Certificado não disponível' })

    // Verificar acesso: comprador, artista da obra, ou admin (sem auth = acesso público negado aqui)
    const token = req.headers.authorization?.replace('Bearer ', '')
    if (token) {
      const jwt = require('jsonwebtoken')
      try {
        const decoded = jwt.verify(token, process.env.JWT_SECRET)
        const userId = decoded.userId || decoded.id
        const user = await prisma.user.findUnique({ where: { id: userId }, include: { artistProfile: true } })
        const isBuyer = order.buyerId === userId
        const isArtist = user?.artistProfile && order.artistId === user.artistProfile.id
        const isAdmin = user?.role === 'ADMIN'
        if (!isBuyer && !isArtist && !isAdmin) return res.status(403).json({ error: 'Sem acesso' })
      } catch { return res.status(401).json({ error: 'Token inválido' }) }
    } else {
      // Sem token: apenas para verificação pública (dados mínimos)
      return res.status(401).json({ error: 'Autenticação necessária para descarregar o certificado' })
    }

    const pdf = await generateCertificatePDF(order)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `attachment; filename="certificado-nauu-${orderId.slice(0,8)}.pdf"`)
    res.send(pdf)
  } catch (err) {
    console.error('[Certificate]', err)
    res.status(500).json({ error: 'Erro ao gerar certificado' })
  }
})

// GET /api/certificates/verify/:orderId — verificação pública (JSON, sem auth)
router.get('/verify/:orderId', async (req, res) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: req.params.orderId },
      include: {
        artwork: { select: { title: true, technique: true, dimensions: true, yearCreated: true, images: { where: { isPrimary: true }, take: 1 } } },
        artist: { select: { artistName: true } },
      }
    })
    if (!order || order.status !== 'PAID') return res.status(404).json({ valid: false })

    res.json({
      valid: true,
      certificateId: order.id,
      issuedAt: order.paidAt || order.createdAt,
      artwork: {
        title: order.artwork?.title,
        technique: order.artwork?.technique,
        dimensions: order.artwork?.dimensions,
        yearCreated: order.artwork?.yearCreated,
        imageUrl: order.artwork?.images?.[0]?.imageUrl,
      },
      artist: { name: order.artist?.artistName },
    })
  } catch (err) {
    res.status(500).json({ valid: false, error: 'Erro de servidor' })
  }
})

module.exports = router
