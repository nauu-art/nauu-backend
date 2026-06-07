const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const { upload, processImage } = require('../config/storage')
const prisma = new PrismaClient()

// GET /api/posts/artist/:username — posts públicos de um artista
router.get('/artist/:username', async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { username: req.params.username } })
    if (!artist) return res.status(404).json({ error: 'Artista não encontrado' })
    const posts = await prisma.post.findMany({
      where: { userId: artist.userId, published: true },
      orderBy: { createdAt: 'desc' },
      include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, artistProfile: { select: { artistName: true, username: true } } } } }
    })
    res.json(posts)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// GET /api/posts/my — posts do utilizador logado
router.get('/my', authenticate, async (req, res) => {
  try {
    const posts = await prisma.post.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' }
    })
    res.json(posts)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/posts — criar post
router.post('/', authenticate, async (req, res) => {
  try {
    const { title, content, published, sendNewsletter } = req.body
    if (!title || !content) return res.status(400).json({ error: 'Título e conteúdo obrigatórios' })
    const post = await prisma.post.create({
      data: { userId: req.user.id, title, content, published: published !== false, sentAsNewsletter: sendNewsletter === true }
    })

    // Newsletter em background
    if (sendNewsletter && published !== false) {
      setImmediate(async () => {
        try {
          const { sendEmail } = require('../utils/email')
          const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id }, select: { id: true, artistName: true, username: true } })
          const subscriptions = await prisma.follow.findMany({
            where: { artistId: artist?.id },
            include: { follower: { select: { email: true, name: true } } }
          })
          const authorName = artist?.artistName || req.user.name
          const followers = subscriptions.map(s => s.follower).filter(u => u.email)
          for (let i = 0; i < followers.length; i += 50) {
            const batch = followers.slice(i, i + 50)
            await Promise.allSettled(batch.map(f => sendEmail({
              to: f.email,
              subject: `${authorName} publicou: ${title}`,
              html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
                <h2>${title}</h2><p>Olá ${f.name},</p>
                <p>${authorName} publicou um novo post no nauu.art.</p>
                <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
                  ${content.replace(/<[^>]*>/g, '').slice(0, 300)}…
                </div>
                <a href="${process.env.FRONTEND_URL}/posts/${post.id}" style="background:#1A7FD4;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">Ler post completo</a>
                <hr style="margin:24px 0;border:none;border-top:1px solid #eee;">
                <p style="font-size:12px;color:#999;">
                  Recebeste este email porque segues ${authorName} no nauu.art.<br>
                  <a href="${process.env.FRONTEND_URL}/api/posts-generic/unsubscribe/${artist?.id}?token=${Buffer.from(f.email).toString('base64')}">Cancelar subscrição</a>
                </p>
              </div>`
            })))
          }
        } catch (err) { console.error('Erro newsletter:', err.message) }
      })
    }
    res.status(201).json(post)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// GET /api/posts/:id — detalhe de um post
router.get('/:id', async (req, res) => {
  try {
    const post = await prisma.post.findUnique({
      where: { id: req.params.id },
      include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, artistProfile: { select: { artistName: true, username: true } } } } }
    })
    if (!post || !post.published) return res.status(404).json({ error: 'Post não encontrado' })
    res.json(post)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// PUT /api/posts/:id — editar post
router.put('/:id', authenticate, async (req, res) => {
  try {
    const { title, content, published } = req.body
    const post = await prisma.post.findFirst({ where: { id: req.params.id, userId: req.user.id } })
    if (!post) return res.status(404).json({ error: 'Post não encontrado' })
    const updated = await prisma.post.update({ where: { id: req.params.id }, data: { title, content, published } })
    res.json(updated)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// DELETE /api/posts/:id — eliminar post
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const post = await prisma.post.findFirst({ where: { id: req.params.id, userId: req.user.id } })
    if (!post) return res.status(404).json({ error: 'Post não encontrado' })
    await prisma.post.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/posts/:id/cover — upload capa
router.post('/:id/cover', authenticate, upload.single('cover'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem' })
    const imageUrl = await processImage(req.file.buffer, 'posts')
    await prisma.post.update({ where: { id: req.params.id }, data: { imageUrl } })
    res.json({ imageUrl })
  } catch { res.status(500).json({ error: 'Erro' }) }
})


// POST /api/posts/:id/media — upload múltiplas imagens
router.post('/:id/media', authenticate, upload.array('images', 10), async (req, res) => {
  try {
    if (!req.files?.length) return res.status(400).json({ error: 'Nenhuma imagem' })
    const post = await prisma.post.findFirst({ where: { id: req.params.id, userId: req.user.id } })
    if (!post) return res.status(404).json({ error: 'Post não encontrado' })
    const urls = await Promise.all(req.files.map(f => processImage(f.buffer, 'posts')))
    const existing = JSON.parse(post.mediaUrls || '[]')
    const updated = [...existing, ...urls]
    // Primeira imagem também vai para imageUrl (capa)
    await prisma.post.update({
      where: { id: req.params.id },
      data: { mediaUrls: JSON.stringify(updated), imageUrl: updated[0] || post.imageUrl }
    })
    res.json({ mediaUrls: updated })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

module.exports = router
