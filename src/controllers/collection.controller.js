const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const getCollections = async (req, res) => {
  try {
    const collections = await prisma.collection.findMany({
      where: { userId: req.user.id },
      include: {
        items: {
          include: {
            artwork: {
              include: { images: { where: { isPrimary: true }, take: 1 } }
            }
          },
          orderBy: { createdAt: 'desc' }
        },
        _count: { select: { items: true } }
      },
      orderBy: { createdAt: 'desc' }
    })
    res.json(collections)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar coleções' })
  }
}

const createCollection = async (req, res) => {
  try {
    const { name, description, isPublic } = req.body
    if (!name) return res.status(400).json({ error: 'Nome obrigatório' })
    const collection = await prisma.collection.create({
      data: { userId: req.user.id, name, description, isPublic: isPublic || false }
    })
    res.status(201).json(collection)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar coleção' })
  }
}

const addToCollection = async (req, res) => {
  try {
    const { id } = req.params
    const { artworkId } = req.body
    const collection = await prisma.collection.findFirst({ where: { id, userId: req.user.id } })
    if (!collection) return res.status(404).json({ error: 'Coleção não encontrada' })
    await prisma.collectionItem.upsert({
      where: { collectionId_artworkId: { collectionId: id, artworkId } },
      create: { collectionId: id, artworkId },
      update: {}
    })
    res.json({ message: 'Adicionado à coleção' })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao adicionar à coleção' })
  }
}

const removeFromCollection = async (req, res) => {
  try {
    const { id, artworkId } = req.params
    await prisma.collectionItem.deleteMany({ where: { collectionId: id, artworkId } })
    res.json({ message: 'Removido da coleção' })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover da coleção' })
  }
}

const deleteCollection = async (req, res) => {
  try {
    const { id } = req.params
    await prisma.collection.deleteMany({ where: { id, userId: req.user.id } })
    res.json({ message: 'Coleção eliminada' })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao eliminar coleção' })
  }
}

module.exports = { getCollections, createCollection, addToCollection, removeFromCollection, deleteCollection }
