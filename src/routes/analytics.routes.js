const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const requireAdmin = (req, res, next) => {
  if (req.user?.accountType !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' })
  next()
}

router.get('/', authenticate, requireAdmin, async (req, res) => {
  try {
    const now = new Date()
    const thirtyDaysAgo = new Date(now - 30 * 24 * 60 * 60 * 1000)
    const sevenDaysAgo = new Date(now - 7 * 24 * 60 * 60 * 1000)

    const [
      totalUsers, newUsersMonth, newUsersWeek,
      totalArtists, approvedArtists,
      totalArtworks, totalViews,
      totalOrders, paidOrders, totalRevenue,
      totalComments, totalLikes,
      totalConversations, totalMessages,
      totalFollows
    ] = await Promise.all([
      prisma.user.count(),
      prisma.user.count({ where: { createdAt: { gte: thirtyDaysAgo } } }),
      prisma.user.count({ where: { createdAt: { gte: sevenDaysAgo } } }),
      prisma.artistProfile.count(),
      prisma.artistProfile.count({ where: { status: 'APPROVED' } }),
      prisma.artwork.count({ where: { isDraft: false } }),
      prisma.artwork.aggregate({ _sum: { viewCount: true } }),
      prisma.order.count(),
      prisma.order.count({ where: { status: 'PAID' } }),
      prisma.order.aggregate({ where: { status: 'PAID' }, _sum: { amount: true } }),
      prisma.artworkComment.count(),
      prisma.artworkLike.count(),
      prisma.conversation.count(),
      prisma.message.count(),
      prisma.follow.count(),
    ])

    res.json({
      users: { total: totalUsers, newMonth: newUsersMonth, newWeek: newUsersWeek },
      artists: { total: totalArtists, approved: approvedArtists },
      artworks: { total: totalArtworks, totalViews: totalViews._sum.viewCount || 0 },
      orders: { total: totalOrders, paid: paidOrders, revenue: totalRevenue._sum.amount || 0 },
      engagement: { comments: totalComments, likes: totalLikes, conversations: totalConversations, messages: totalMessages, follows: totalFollows },
    })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

module.exports = router
