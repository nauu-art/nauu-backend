const { PrismaClient } = require('@prisma/client')
const { notify, TYPES } = require('../utils/notify')
const prisma = new PrismaClient()

const followArtist = async (req, res) => {
  try {
    const { artistId } = req.params
    await prisma.follow.upsert({
      where: { followerId_artistId: { followerId: req.user.id, artistId } },
      create: { followerId: req.user.id, artistId },
      update: {}
    })
    // Notificar artista
    try {
      const [followerUser, artistProfile] = await Promise.all([
        prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } }),
        prisma.artistProfile.findUnique({ where: { id: artistId }, select: { userId: true, username: true } })
      ])
      if (followerUser && artistProfile) {
        await notify(artistProfile.userId, TYPES.NEW_FOLLOWER, `${followerUser.name} começou a seguir-te`, `/${artistProfile.username}`)
      }
    } catch {}
    res.json({ following: true })
  } catch (err) {
    console.error('Follow error:', err)
    res.status(500).json({ error: 'Erro ao seguir artista' })
  }
}

const unfollowArtist = async (req, res) => {
  try {
    const { artistId } = req.params
    await prisma.follow.deleteMany({
      where: { followerId: req.user.id, artistId }
    })
    res.json({ following: false })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao deixar de seguir' })
  }
}

const getFollowing = async (req, res) => {
  try {
    const following = await prisma.follow.findMany({
      where: { followerId: req.user.id },
      include: {
        artist: {
          include: {
            user: { select: { avatarUrl: true } },
            categories: { include: { category: { select: { name: true } } } },
            _count: { select: { artworks: true } }
          }
        }
      },
      orderBy: { createdAt: 'desc' }
    })
    res.json(following.map(f => f.artist))
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar seguidos' })
  }
}

const getFeed = async (req, res) => {
  try {
    const { page = 1, limit = 12 } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    const following = await prisma.follow.findMany({
      where: { followerId: req.user.id },
      select: { artistId: true }
    })

    const artistIds = following.map(f => f.artistId)

    if (artistIds.length === 0) {
      return res.json({ data: [], pagination: { total: 0, page: 1, totalPages: 0 } })
    }

    // Incluir posts dos artistas seguidos no feed
    const posts = await prisma.artistPost.findMany({
      where: { artistId: { in: artistIds }, published: true },
      orderBy: { createdAt: 'desc' },
      take: 5,
      include: {
        artist: {
          select: { id: true, artistName: true, username: true, user: { select: { avatarUrl: true } } }
        }
      }
    })

    const [artworks, total] = await Promise.all([
      prisma.artwork.findMany({
        where: { artistId: { in: artistIds }, isDraft: false },
        skip,
        take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          images: { orderBy: { isPrimary: 'desc' } },
          artist: {
            select: {
              id: true, artistName: true, username: true,
              user: { select: { avatarUrl: true } }
            }
          },
          categories: { include: { category: { select: { name: true } } } }
        }
      }),
      prisma.artwork.count({ where: { artistId: { in: artistIds }, isDraft: false } })
    ])

    res.json({ data: artworks, posts, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter feed' })
  }
}

const isFollowing = async (req, res) => {
  try {
    const { artistId } = req.params
    const follow = await prisma.follow.findUnique({
      where: { followerId_artistId: { followerId: req.user.id, artistId } }
    })
    res.json({ following: !!follow })
  } catch (err) {
    res.status(500).json({ error: 'Erro' })
  }
}

module.exports = { followArtist, unfollowArtist, getFollowing, getFeed, isFollowing }
