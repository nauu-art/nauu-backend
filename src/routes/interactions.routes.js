const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const { notify } = require('../utils/notify')
const prisma = new PrismaClient()

// ── Likes nas obras ──────────────────────────────────────────

// POST /api/interactions/artworks/:id/like — toggle like
router.post('/artworks/:id/like', authenticate, async (req, res) => {
  try {
    const existing = await prisma.artworkLike.findUnique({
      where: { artworkId_userId: { artworkId: req.params.id, userId: req.user.id } }
    })
    if (existing) {
      await prisma.artworkLike.delete({ where: { artworkId_userId: { artworkId: req.params.id, userId: req.user.id } } })
      res.json({ liked: false })
    } else {
      await prisma.artworkLike.create({ data: { artworkId: req.params.id, userId: req.user.id } })
      // Notificar artista
      const artwork = await prisma.artwork.findUnique({ where: { id: req.params.id }, include: { artist: true } })
      const liker = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } })
      if (artwork && artwork.artist.userId !== req.user.id) {
        await notify(artwork.artist.userId, 'NEW_FAVORITE', `${liker.name} reagiu à obra "${artwork.title}"`, `/artwork/${req.params.id}`)
      }
      res.json({ liked: true })
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// GET /api/interactions/artworks/:id/likes — total de likes + se o user deu like
router.get('/artworks/:id/likes', async (req, res) => {
  try {
    const count = await prisma.artworkLike.count({ where: { artworkId: req.params.id } })
    res.json({ count, liked: false })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

router.get('/artworks/:id/likes/me', authenticate, async (req, res) => {
  try {
    const count = await prisma.artworkLike.count({ where: { artworkId: req.params.id } })
    const liked = await prisma.artworkLike.findUnique({
      where: { artworkId_userId: { artworkId: req.params.id, userId: req.user.id } }
    })
    res.json({ count, liked: !!liked })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// ── Comentários nas obras ────────────────────────────────────

// GET /api/interactions/artworks/:id/comments
router.get('/artworks/:id/comments', async (req, res) => {
  try {
    const comments = await prisma.artworkComment.findMany({
      where: { artworkId: req.params.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } }
    })
    res.json(comments)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/interactions/artworks/:id/comments
router.post('/artworks/:id/comments', authenticate, async (req, res) => {
  try {
    const { content } = req.body
    if (!content?.trim()) return res.status(400).json({ error: 'Comentário vazio' })
    const comment = await prisma.artworkComment.create({
      data: { artworkId: req.params.id, userId: req.user.id, content },
      include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } }
    })
    // Notificar artista
    const artwork = await prisma.artwork.findUnique({ where: { id: req.params.id }, include: { artist: true } })
    if (artwork && artwork.artist.userId !== req.user.id) {
      await notify(artwork.artist.userId, 'NEW_COMMENT', `${comment.user.name} comentou "${artwork.title}"`, `/artwork/${req.params.id}`)
    }
    res.json(comment)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// DELETE /api/interactions/artworks/:id/comments/:commentId
router.delete('/artworks/:id/comments/:commentId', authenticate, async (req, res) => {
  try {
    const comment = await prisma.artworkComment.findUnique({ where: { id: req.params.commentId } })
    if (!comment) return res.status(404).json({ error: 'Comentário não encontrado' })
    // Pode apagar o dono do comentário ou o artista da obra
    const artwork = await prisma.artwork.findUnique({ where: { id: req.params.id }, include: { artist: true } })
    const isOwner = comment.userId === req.user.id
    const isArtist = artwork?.artist?.userId === req.user.id
    if (!isOwner && !isArtist) return res.status(403).json({ error: 'Sem permissão' })
    await prisma.artworkComment.delete({ where: { id: req.params.commentId } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// ── Comentários nos posts ────────────────────────────────────

// GET /api/interactions/posts/:id/comments
router.get('/posts/:id/comments', async (req, res) => {
  try {
    const comments = await prisma.postComment.findMany({
      where: { postId: req.params.id },
      orderBy: { createdAt: 'asc' },
      include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } }
    })
    res.json(comments)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/interactions/posts/:id/comments
router.post('/posts/:id/comments', authenticate, async (req, res) => {
  try {
    const { content } = req.body
    if (!content?.trim()) return res.status(400).json({ error: 'Comentário vazio' })
    const comment = await prisma.postComment.create({
      data: { postId: req.params.id, userId: req.user.id, content },
      include: { user: { select: { id: true, name: true, username: true, avatarUrl: true } } }
    })
    // Notificar autor do post
    const post = await prisma.post.findUnique({ where: { id: req.params.id } })
    if (post && post.userId !== req.user.id) {
      await notify(post.userId, 'NEW_COMMENT', `${comment.user.name} comentou o teu post "${post.title}"`, `/u/${comment.user.username}`)
    }
    res.json(comment)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

module.exports = router
