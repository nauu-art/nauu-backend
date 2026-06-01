const { PrismaClient } = require('@prisma/client')
const { notify, TYPES } = require('../utils/notify')
const { z } = require('zod')
const { processImage } = require('../config/storage')

const prisma = new PrismaClient()

const artworkSchema = z.object({
  title: z.string().min(1, 'Título obrigatório'),
  description: z.string().optional(),
  technique: z.string().optional(),
  dimensions: z.string().optional(),
  yearCreated: z.number().int().min(1800).max(new Date().getFullYear()).optional(),
  price: z.number().positive().optional(),
  priceOnRequest: z.boolean().default(false),
  isDraft: z.boolean().default(false),
  collectionId: z.string().nullable().optional(),
  availability: z.enum(['AVAILABLE', 'SOLD', 'RESERVED']).default('AVAILABLE'),
  categoryIds: z.array(z.string()).optional(),
})

const getArtworks = async (req, res) => {
  try {
    const { page = 1, limit = 20, category, minPrice, maxPrice, availability, search, sort = 'createdAt_desc', featured } = req.query
    const where = { artist: { status: 'APPROVED', user: { isBanned: false } }, isDraft: false }
    const skip = (Number(page) - 1) * Number(limit)

    if (search) {
      where.OR = [
        { title: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { technique: { contains: search, mode: 'insensitive' } },
        { artist: { artistName: { contains: search, mode: 'insensitive' } } },
      ]
    }
    if (availability) {
      const availList = availability.split(',').map(a => a.trim().toUpperCase()).filter(Boolean)
      if (availList.length === 1) {
        where.availability = availList[0]
      } else if (availList.length > 1) {
        where.availability = { in: availList }
      }
    }
    if (featured === 'true') where.isFeatured = true
    if (minPrice || maxPrice) {
      where.price = {}
      if (minPrice) where.price.gte = Number(minPrice)
      if (maxPrice) where.price.lte = Number(maxPrice)
    }
    if (category) where.categories = { some: { category: { slug: category } } }
    if (req.query.categories) {
      const slugs = req.query.categories.split(',').filter(Boolean)
      if (slugs.length > 0) where.categories = { some: { category: { slug: { in: slugs } } } }
    }

    const [field, dir] = sort.split('_')
    const orderBy = { [field === 'price' ? 'price' : field === 'viewCount' ? 'viewCount' : 'createdAt']: dir === 'asc' ? 'asc' : 'desc' }

    const [artworks, total] = await Promise.all([
      prisma.artwork.findMany({
        where, skip, take: Number(limit), orderBy,
        include: {
          images: { orderBy: { isPrimary: 'desc' } },
          artist: { select: { id: true, artistName: true, username: true, city: true, userId: true, user: { select: { avatarUrl: true } } } },
          categories: { include: { category: { select: { name: true, slug: true } } } },
          collection: { select: { id: true, name: true } },
        },
      }),
      prisma.artwork.count({ where }),
    ])

    res.json({ data: artworks, pagination: { total, page: Number(page), limit: Number(limit), totalPages: Math.ceil(total / Number(limit)) } })
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao listar obras' })
  }
}

const getArtwork = async (req, res) => {
  try {
    const { id } = req.params
    const artwork = await prisma.artwork.findUnique({
      where: { id },
      include: {
        images: { orderBy: { displayOrder: 'asc' } },
        artist: {
          select: {
            id: true, artistName: true, username: true, userId: true,
            stripeOnboarded: true, commissionPercent: true,
            user: { select: { avatarUrl: true, id: true } },
            city: true, country: true, bio: true, contactEmail: true,
          },
        },
        categories: { include: { category: true } },
        collection: { select: { id: true, name: true } },
        shipping: true,
      },
    })
    if (!artwork) return res.status(404).json({ error: 'Obra não encontrada' })
    await prisma.artwork.update({ where: { id }, data: { viewCount: { increment: 1 } } })
    res.json(artwork)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter obra' })
  }
}

const createArtwork = async (req, res) => {
  try {
    const artistProfile = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    if (!artistProfile) return res.status(404).json({ error: 'Perfil de artista não encontrado' })

    const data = artworkSchema.parse({
      ...req.body,
      yearCreated: req.body.yearCreated ? Number(req.body.yearCreated) : undefined,
      price: req.body.price ? Number(req.body.price) : undefined,
      priceOnRequest: req.body.priceOnRequest === 'true' || req.body.priceOnRequest === true,
      isDraft: req.body.isDraft === 'true' || req.body.isDraft === true,
      collectionId: req.body.collectionId || null,
    })

    const { categoryIds, ...artworkData } = data

    const artwork = await prisma.artwork.create({
      data: {
        ...artworkData,
        artistId: artistProfile.id,
        ...(categoryIds?.length && { categories: { create: categoryIds.map(cid => ({ categoryId: cid })) } }),
      },
      include: { images: true, categories: { include: { category: true } } },
    })

    // Notificar seguidores quando não é rascunho
    if (!artworkData.isDraft) {
      try {
        const followers = await prisma.follow.findMany({
          where: { artistId: artistProfile.id },
          select: { follower: { select: { id: true } } }
        })
        for (const f of followers) {
          await notify(f.follower.id, TYPES.NEW_ARTWORK, `${artistProfile.artistName} publicou uma nova obra: ${artwork.title}`, `/artwork/${artwork.id}`)
        }
      } catch {}
    }
    res.status(201).json(artwork)
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors[0].message })
    console.error(err)
    res.status(500).json({ error: 'Erro ao criar obra' })
  }
}

const updateArtwork = async (req, res) => {
  try {
    const { id } = req.params
    const artistProfile = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const artwork = await prisma.artwork.findUnique({ where: { id } })
    if (!artwork) return res.status(404).json({ error: 'Obra não encontrada' })
    if (artwork.artistId !== artistProfile?.id) return res.status(403).json({ error: 'Sem permissão' })

    const data = artworkSchema.partial().parse({
      ...req.body,
      yearCreated: req.body.yearCreated ? Number(req.body.yearCreated) : undefined,
      price: req.body.price ? Number(req.body.price) : undefined,
      priceOnRequest: req.body.priceOnRequest === 'true' || req.body.priceOnRequest === true,
      isDraft: req.body.isDraft === 'true' || req.body.isDraft === true,
      collectionId: req.body.collectionId || null,
    })

    const { categoryIds, ...artworkData } = data
    const updated = await prisma.artwork.update({
      where: { id },
      data: {
        ...artworkData,
        ...(categoryIds && { categories: { deleteMany: {}, create: categoryIds.map(cid => ({ categoryId: cid })) } }),
      },
      include: { images: true, categories: { include: { category: true } } },
    })
    res.json(updated)
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors[0].message })
    res.status(500).json({ error: 'Erro ao atualizar obra' })
  }
}

const deleteArtwork = async (req, res) => {
  try {
    const { id } = req.params
    const artistProfile = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const artwork = await prisma.artwork.findUnique({ where: { id } })
    if (!artwork) return res.status(404).json({ error: 'Obra não encontrada' })
    if (artwork.artistId !== artistProfile?.id) return res.status(403).json({ error: 'Sem permissão' })
    await prisma.artwork.delete({ where: { id } })
    res.json({ message: 'Obra eliminada' })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao eliminar obra' })
  }
}

const uploadImages = async (req, res) => {
  try {
    const { id } = req.params
    const artistProfile = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const artwork = await prisma.artwork.findUnique({ where: { id } })
    if (!artwork || artwork.artistId !== artistProfile?.id) return res.status(403).json({ error: 'Sem permissão' })
    if (!req.files?.length) return res.status(400).json({ error: 'Nenhuma imagem enviada' })

    const existingCount = await prisma.artworkImage.count({ where: { artworkId: id } })
    const images = []

    for (let i = 0; i < req.files.length; i++) {
      const imageUrl = await processImage(req.files[i].buffer, 'artworks')
      const image = await prisma.artworkImage.create({
        data: { artworkId: id, imageUrl, isPrimary: existingCount === 0 && i === 0, displayOrder: existingCount + i },
      })
      images.push(image)
    }
    res.status(201).json(images)
  } catch (err) {
    console.error(err)
    res.status(500).json({ error: 'Erro ao fazer upload de imagens' })
  }
}

const getFeatured = async (req, res) => {
  try {
    const artworks = await prisma.artwork.findMany({
      where: { isFeatured: true, availability: 'AVAILABLE' },
      take: 8,
      include: {
        images: { where: { isPrimary: true }, take: 1 },
        artist: { select: { artistName: true, username: true } },
        categories: { include: { category: { select: { name: true, slug: true } } } },
      },
    })
    res.json(artworks)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter destaques' })
  }
}

module.exports = { getArtworks, getArtwork, createArtwork, updateArtwork, deleteArtwork, uploadImages, getFeatured }
