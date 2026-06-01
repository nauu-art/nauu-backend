const { PrismaClient } = require('@prisma/client')
const { processImage } = require('../config/storage')
const prisma = new PrismaClient()

const getArtists = async (req, res) => {
  try {
    const { page = 1, limit = 20, search, category, city, country, sort = 'createdAt_desc' } = req.query
    const skip = (Number(page) - 1) * Number(limit)
    const where = { status: 'APPROVED', user: { isBanned: false } }
    if (search) {
      where.OR = [
        { artistName: { contains: search, mode: 'insensitive' } },
        { user: { name: { contains: search, mode: 'insensitive' } } },
      ]
    }
    if (city) where.city = { contains: city, mode: 'insensitive' }
    if (country && req.query.excludeCountry) {
      // País específico (ignora excludeCountry)
      where.country = { equals: country, mode: 'insensitive' }
    } else if (country) {
      where.country = { equals: country, mode: 'insensitive' }
    } else if (req.query.excludeCountry) {
      where.country = { not: { equals: req.query.excludeCountry, mode: 'insensitive' } }
    }
    if (category) where.categories = { some: { category: { slug: category } } }
    // Filtro por distrito — filtra pelos concelhos do distrito
    if (req.query.district) {
      const { DISTRITOS_CONCELHOS } = require('../../frontend/lib/portugal') || {}
      // Fallback manual dos concelhos principais
      const districtMap = {
        'Aveiro': ['Aveiro','Santa Maria da Feira','São João da Madeira','Oliveira de Azeméis','Ovar','Espinho','Estarreja','Ílhavo','Águeda','Mealhada'],
        'Braga': ['Braga','Guimarães','Vila Nova de Famalicão','Barcelos','Esposende','Fafe','Vizela'],
        'Porto': ['Porto','Vila Nova de Gaia','Matosinhos','Gondomar','Maia','Valongo','Vila do Conde','Póvoa de Varzim','Amarante','Paredes'],
        'Lisboa': ['Lisboa','Cascais','Sintra','Amadora','Oeiras','Loures','Odivelas','Mafra','Vila Franca de Xira'],
        'Setúbal': ['Setúbal','Almada','Barreiro','Seixal','Moita','Montijo','Sesimbra','Palmela'],
        'Faro': ['Faro','Albufeira','Portimão','Lagos','Loulé','Olhão','Tavira','Silves'],
        'Coimbra': ['Coimbra','Figueira da Foz','Lousã','Mealhada','Montemor-o-Velho'],
        'Leiria': ['Leiria','Marinha Grande','Alcobaça','Peniche','Nazaré','Caldas da Rainha'],
        'Viseu': ['Viseu','Lamego'],
        'Évora': ['Évora'],
        'Beja': ['Beja'],
        'Santarém': ['Santarém','Tomar','Torres Novas','Entroncamento','Abrantes'],
        'Viana do Castelo': ['Viana do Castelo','Ponte de Lima'],
        'Vila Real': ['Vila Real','Chaves'],
        'Bragança': ['Bragança'],
        'Castelo Branco': ['Castelo Branco','Covilhã'],
        'Guarda': ['Guarda'],
        'Portalegre': ['Portalegre'],
        'Açores': ['Ponta Delgada','Angra do Heroísmo'],
        'Madeira': ['Funchal'],
      }
      const concelhos = districtMap[req.query.district] || []
      if (concelhos.length > 0) {
        where.city = { in: concelhos }
      }
    }

    const [artists, total] = await Promise.all([
      prisma.artistProfile.findMany({
        where, skip, take: Number(limit),
        orderBy: sort === 'featured' ? { isFeatured: 'desc' } : { createdAt: 'desc' },
        include: {
          user: { select: { avatarUrl: true } },
          categories: { include: { category: { select: { name: true, slug: true } } } },
          _count: { select: { artworks: { where: { isDraft: false } } } },
        },
      }),
      prisma.artistProfile.count({ where }),
    ])
    res.json({ data: artists, pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) } })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar artistas' })
  }
}

const getArtist = async (req, res) => {
  try {
    const { username } = req.params
    const artist = await prisma.artistProfile.findUnique({
      where: { username },
      include: {
        user: { select: { avatarUrl: true, createdAt: true, isBanned: true } },
        categories: { include: { category: true } },
        _count: { select: { artworks: { where: { isDraft: false } }, contactsReceived: true } },
      },
    })
    if (!artist || artist.user?.isBanned) return res.status(404).json({ error: 'Artista não encontrado' })
    if (artist.status !== 'APPROVED') {
      // Só o próprio artista pode ver o seu perfil não aprovado
      const authHeader = req.headers.authorization
      if (!authHeader) return res.status(404).json({ error: 'Artista não encontrado' })
      const jwt = require('jsonwebtoken')
      try {
        const decoded = jwt.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET)
        if (decoded.id !== artist.userId) return res.status(404).json({ error: 'Artista não encontrado' })
      } catch { return res.status(404).json({ error: 'Artista não encontrado' }) }
    }
    res.json(artist)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter artista' })
  }
}

const getArtistArtworks = async (req, res) => {
  try {
    const { username } = req.params
    const { page = 1, limit = 12, availability } = req.query
    const skip = (Number(page) - 1) * Number(limit)
    const artist = await prisma.artistProfile.findUnique({ where: { username } })
    if (!artist || artist.user?.isBanned) return res.status(404).json({ error: 'Artista não encontrado' })
    if (artist.status !== 'APPROVED') {
      const authHeader = req.headers.authorization
      if (!authHeader) return res.status(404).json({ error: 'Artista não encontrado' })
      const jwt = require('jsonwebtoken')
      try {
        const decoded = jwt.verify(authHeader.replace('Bearer ', ''), process.env.JWT_SECRET)
        if (decoded.id !== artist.userId) return res.status(404).json({ error: 'Artista não encontrado' })
      } catch { return res.status(404).json({ error: 'Artista não encontrado' }) }
    }
    const where = { artistId: artist.id, isDraft: false }
    if (availability) where.availability = availability
    const [artworks, total] = await Promise.all([
      prisma.artwork.findMany({
        where, skip, take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: { images: { orderBy: { isPrimary: 'desc' } }, categories: { include: { category: true } }, collection: { select: { id: true, name: true } } },
      }),
      prisma.artwork.count({ where }),
    ])
    res.json({ data: artworks, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter obras do artista' })
  }
}

const updateProfile = async (req, res) => {
  try {
    const allowedFields = ['artistName', 'bio', 'city', 'country', 'contactEmail', 'phone', 'websiteUrl', 'instagramUrl', 'behanceUrl', 'linkedinUrl']
    const data = {}
    for (const field of allowedFields) {
      if (req.body[field] !== undefined) data[field] = req.body[field]
    }

    // Atualizar categorias se fornecidas
    if (req.body.categoryIds && Array.isArray(req.body.categoryIds)) {
      data.categories = {
        deleteMany: {},
        create: req.body.categoryIds.map(categoryId => ({ categoryId }))
      }
    }

    const profile = await prisma.artistProfile.update({
      where: { userId: req.user.id },
      data,
      include: { categories: { include: { category: true } } }
    })
    res.json(profile)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao atualizar perfil' })
  }
}

const uploadAvatar = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' })
    const avatarUrl = await processImage(req.file.buffer, 'avatars')
    await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl } })
    res.json({ avatarUrl })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao fazer upload do avatar' })
  }
}

const uploadCover = async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem enviada' })
    const coverImageUrl = await processImage(req.file.buffer, 'covers')
    await prisma.artistProfile.update({ where: { userId: req.user.id }, data: { coverImageUrl } })
    res.json({ coverImageUrl })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao fazer upload da capa' })
  }
}

const getDashboardStats = async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    if (!artist) return res.status(404).json({ error: 'Perfil não encontrado' })
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000)
    const [totalArtworks, totalViews, totalFavorites, recentContacts, topArtworks, recentContactsList] = await Promise.all([
      prisma.artwork.count({ where: { artistId: artist.id } }),
      prisma.artwork.aggregate({ where: { artistId: artist.id }, _sum: { viewCount: true } }),
      prisma.favorite.count({ where: { artwork: { artistId: artist.id } } }),
      prisma.contactRequest.count({ where: { artistId: artist.id, createdAt: { gte: thirtyDaysAgo } } }),
      prisma.artwork.findMany({ where: { artistId: artist.id }, orderBy: { viewCount: 'desc' }, take: 5, include: { images: { where: { isPrimary: true }, take: 1 } } }),
      prisma.contactRequest.findMany({ where: { artistId: artist.id }, orderBy: { createdAt: 'desc' }, take: 5, include: { artwork: { select: { title: true } } } }),
    ])
    res.json({
      stats: { totalArtworks, totalViews: totalViews._sum.viewCount || 0, totalFavorites, recentContacts },
      topArtworks,
      recentContacts: recentContactsList,
    })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter estatísticas' })
  }
}


const getArtistStats = async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { username: req.params.username } })
    if (!artist) return res.status(404).json({ error: 'Artista não encontrado' })

    const [views, favs] = await Promise.all([
      prisma.artwork.aggregate({ where: { artistId: artist.id }, _sum: { viewCount: true } }),
      prisma.favorite.count({ where: { artwork: { artistId: artist.id } } })
    ])

    res.json({ views: views._sum.viewCount || 0, favs })
  } catch { res.status(500).json({ error: 'Erro' }) }
}

module.exports = { getArtists, getArtist, getArtistArtworks, updateProfile, uploadAvatar, uploadCover, getDashboardStats, getArtistStats }
