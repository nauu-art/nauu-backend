const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const getPosts = async (req, res) => {
  try {
    const { username } = req.params
    const artist = await prisma.artistProfile.findUnique({ where: { username } })
    if (!artist) return res.status(404).json({ error: 'Artista não encontrado' })

    const posts = await prisma.artistPost.findMany({
      where: { artistId: artist.id, published: true },
      orderBy: { createdAt: 'desc' }
    })
    res.json(posts)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao listar posts' })
  }
}

const getMyPosts = async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    if (!artist) return res.status(404).json({ error: 'Perfil não encontrado' })

    const posts = await prisma.artistPost.findMany({
      where: { artistId: artist.id },
      orderBy: { createdAt: 'desc' }
    })
    res.json(posts)
  } catch (err) {
    res.status(500).json({ error: 'Erro' })
  }
}

const createPost = async (req, res) => {
  try {
    const { title, content, imageUrl, published } = req.body
    if (!title || !content) return res.status(400).json({ error: 'Título e conteúdo obrigatórios' })

    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    if (!artist) return res.status(404).json({ error: 'Perfil não encontrado' })

    const post = await prisma.artistPost.create({
      data: { artistId: artist.id, title, content, imageUrl, published: published !== false }
    })
    res.status(201).json(post)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao criar post' })
  }
}

const updatePost = async (req, res) => {
  try {
    const { id } = req.params
    const { title, content, imageUrl, published } = req.body
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const post = await prisma.artistPost.findFirst({ where: { id, artistId: artist?.id } })
    if (!post) return res.status(404).json({ error: 'Post não encontrado' })

    const updated = await prisma.artistPost.update({
      where: { id },
      data: { title, content, imageUrl, published }
    })
    res.json(updated)
  } catch (err) {
    res.status(500).json({ error: 'Erro ao atualizar post' })
  }
}

const deletePost = async (req, res) => {
  try {
    const { id } = req.params
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    await prisma.artistPost.deleteMany({ where: { id, artistId: artist?.id } })
    res.json({ message: 'Post eliminado' })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao eliminar post' })
  }
}

const uploadPostCover = async (req, res) => {
  try {
    const { id } = req.params
    if (!req.file) return res.status(400).json({ error: 'Sem ficheiro' })
    const { processImage } = require('../config/storage')
    const imageUrl = await processImage(req.file.buffer, 'posts')
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    await prisma.artistPost.updateMany({ where: { id, artistId: artist?.id }, data: { imageUrl } })
    res.json({ imageUrl })
  } catch (err) {
    res.status(500).json({ error: 'Erro ao fazer upload' })
  }
}

module.exports = { getPosts, getMyPosts, createPost, updatePost, deletePost, uploadPostCover }
