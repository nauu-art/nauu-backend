const { PrismaClient } = require('@prisma/client')
const bcrypt = require('bcryptjs')
const jwt = require('jsonwebtoken')
const prisma = new PrismaClient()

// POST /api/admin/login
const adminLogin = async (req, res) => {
  try {
    const { email, password } = req.body
    const user = await prisma.user.findUnique({ where: { email } })
    if (!user || user.accountType !== 'ADMIN') {
      return res.status(401).json({ error: 'Credenciais inválidas' })
    }
    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' })

    const token = jwt.sign(
      { userId: user.id, accountType: 'ADMIN' },
      process.env.JWT_SECRET,
      { expiresIn: '30d' }
    )
    res.json({ token, user: { id: user.id, name: user.name, email: user.email, accountType: user.accountType } })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao fazer login' })
  }
}

// GET /api/admin/stats
const getStats = async (req, res) => {
  try {
    const [totalUsers, totalArtists, totalArtworks, totalContacts, recentUsers, recentArtworks] = await Promise.all([
      prisma.user.count({ where: { accountType: 'USER' } }),
      prisma.user.count({ where: { accountType: 'ARTIST' } }),
      prisma.artwork.count(),
      prisma.contactRequest.count(),
      prisma.user.findMany({ orderBy: { createdAt: 'desc' }, take: 5, select: { id: true, name: true, email: true, accountType: true, createdAt: true, isBanned: true } }),
      prisma.artwork.findMany({
        orderBy: { createdAt: 'desc' }, take: 5,
        include: { artist: { select: { artistName: true, username: true } }, images: { where: { isPrimary: true }, take: 1 } }
      }),
    ])
    res.json({ stats: { totalUsers, totalArtists, totalArtworks, totalContacts }, recentUsers, recentArtworks })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter estatísticas' })
  }
}

// GET /api/admin/users
const getUsers = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, type } = req.query
    const skip = (Number(page) - 1) * Number(limit)
    const where = {}
    if (search) where.OR = [
      { name: { contains: search, mode: 'insensitive' } },
      { email: { contains: search, mode: 'insensitive' } },
    ]
    if (type) where.accountType = type

    const [users, total] = await Promise.all([
      prisma.user.findMany({
        where, skip, take: Number(limit),
        orderBy: { createdAt: 'desc' },
        select: {
          id: true, name: true, email: true, accountType: true,
          isEmailVerified: true, isBanned: true, createdAt: true, artistProfile: { select: { username: true, status: true } },
          artistProfile: { select: { artistName: true, username: true, isFeatured: true } },
          _count: { select: { favorites: true, contactsSent: true } }
        }
      }),
      prisma.user.count({ where }),
    ])
    res.json({ data: users, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar utilizadores' })
  }
}

// PUT /api/admin/users/:id/ban
const banUser = async (req, res) => {
  try {
    const { id } = req.params
    const user = await prisma.user.findUnique({ where: { id } })
    if (!user) return res.status(404).json({ error: 'Utilizador não encontrado' })
    if (user.accountType === 'ADMIN') return res.status(403).json({ error: 'Não podes banir um admin' })
    const updated = await prisma.user.update({ where: { id }, data: { isBanned: !user.isBanned } })
    res.json({ message: updated.isBanned ? 'Utilizador banido' : 'Ban removido', isBanned: updated.isBanned })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao banir utilizador' })
  }
}

// PUT /api/admin/users/:id/promote
const promoteToArtist = async (req, res) => {
  try {
    const { id } = req.params
    const user = await prisma.user.findUnique({ where: { id }, include: { artistProfile: true } })
    if (!user) return res.status(404).json({ error: 'Utilizador não encontrado' })
    if (user.accountType === 'ARTIST') return res.status(400).json({ error: 'Já é artista' })

    await prisma.user.update({ where: { id }, data: { accountType: 'ARTIST' } })
    if (!user.artistProfile) {
      const username = user.name.toLowerCase().replace(/\s+/g, '').replace(/[^a-z0-9]/g, '') + Math.floor(Math.random() * 999)
      await prisma.artistProfile.create({
        data: { userId: id, artistName: user.name, username, contactEmail: user.email }
      })
    }
    res.json({ message: 'Utilizador promovido a artista' })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao promover utilizador' })
  }
}

// GET /api/admin/artworks
const getArtworks = async (req, res) => {
  try {
    const { page = 1, limit = 20, search } = req.query
    const skip = (Number(page) - 1) * Number(limit)
    const where = {}
    if (search) where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { artist: { artistName: { contains: search, mode: 'insensitive' } } },
    ]

    const [artworks, total] = await Promise.all([
      prisma.artwork.findMany({
        where, skip, take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: {
          artist: { select: { artistName: true, username: true } },
          images: { where: { isPrimary: true }, take: 1 },
          _count: { select: { favorites: true } }
        }
      }),
      prisma.artwork.count({ where }),
    ])
    res.json({ data: artworks, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar obras' })
  }
}

// PUT /api/admin/artworks/:id/featured
const toggleFeatured = async (req, res) => {
  try {
    const { id } = req.params
    const artwork = await prisma.artwork.findUnique({ where: { id } })
    if (!artwork) return res.status(404).json({ error: 'Obra não encontrada' })
    const updated = await prisma.artwork.update({ where: { id }, data: { isFeatured: !artwork.isFeatured } })
    res.json({ message: updated.isFeatured ? 'Obra em destaque' : 'Destaque removido', isFeatured: updated.isFeatured })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar destaque' })
  }
}

// DELETE /api/admin/artworks/:id
const deleteArtwork = async (req, res) => {
  try {
    const { id } = req.params
    await prisma.artwork.delete({ where: { id } })
    res.json({ message: 'Obra eliminada' })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao eliminar obra' })
  }
}

// PUT /api/admin/artists/:id/featured
const toggleArtistFeatured = async (req, res) => {
  try {
    const { id } = req.params
    const artist = await prisma.artistProfile.findUnique({ where: { id } })
    if (!artist) return res.status(404).json({ error: 'Artista não encontrado' })
    const updated = await prisma.artistProfile.update({ where: { id }, data: { isFeatured: !artist.isFeatured } })
    res.json({ message: updated.isFeatured ? 'Artista em destaque' : 'Destaque removido', isFeatured: updated.isFeatured })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar destaque' })
  }
}

module.exports = { adminLogin, getStats, getUsers, banUser, promoteToArtist, getArtworks, toggleFeatured, deleteArtwork, toggleArtistFeatured }
