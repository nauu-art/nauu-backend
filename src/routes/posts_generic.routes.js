const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const { upload, processImage } = require('../config/storage')
const prisma = new PrismaClient()

// GET /api/posts/user/:username — posts públicos de qualquer utilizador
router.get('/user/:username', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({ where: { username: req.params.username } })
    if (!user) return res.status(404).json({ error: 'Utilizador não encontrado' })
    const posts = await prisma.post.findMany({
      where: { userId: user.id, published: true },
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
      data: { userId: req.user.id, title, content, published: published !== false, sentAsNewsletter: sendNewsletter === true },
    })

    // Enviar newsletter em background se pedido
    if (sendNewsletter && published !== false) {
      setImmediate(async () => {
        try {
          const { sendEmail } = require('../utils/email')
          // Buscar artista
          const artist = await prisma.artistProfile.findUnique({
            where: { userId: req.user.id },
            select: { id: true, artistName: true, username: true }
          })
          // Buscar seguidores com newsletter activa
          const subscriptions = await prisma.follow.findMany({
            where: { artistId: artist?.id },
            include: { follower: { select: { email: true, name: true } } }
          })
          const authorName = artist?.artistName || (await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true } }))?.name
          const postUrl = `${process.env.FRONTEND_URL}/posts/${post.id}`
          // Enviar em lotes de 50
          const followers = subscriptions.map(s => s.follower).filter(u => u.email)
          for (let i = 0; i < followers.length; i += 50) {
            const batch = followers.slice(i, i + 50)
            await Promise.allSettled(batch.map(f => sendEmail({
              to: f.email,
              subject: `${authorName} publicou: ${title}`,
              html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto;">
                <h2>${title}</h2>
                <p>Olá ${f.name},</p>
                <p>${authorName} publicou um novo post no nauu.art.</p>
                <div style="background:#f5f5f5;padding:16px;border-radius:8px;margin:16px 0;">
                  ${content.replace(/<[^>]*>/g, '').slice(0, 300)}…
                </div>
                <a href="${postUrl}" style="background:#1A7FD4;color:white;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:bold;">
                  Ler post completo
                </a>
                <hr style="margin:24px 0;border:none;border-top:1px solid #eee;">
                <p style="font-size:12px;color:#999;">
                  Recebeste este email porque segues ${authorName} no nauu.art.<br>
                  <a href="${process.env.FRONTEND_URL}/unsubscribe/${artist?.id}?token=${Buffer.from(f.email).toString('base64')}">Cancelar subscrição</a>
                </p>
              </div>`
            })))
          }
          console.log(`Newsletter enviada para ${followers.length} seguidores`)
        } catch (err) { console.error('Erro newsletter:', err.message) }
      })
    }

    res.status(201).json(post)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao criar post' }) }
})



// PUT /api/posts/:id — editar post
router.put('/:id', authenticate, async (req, res) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } })
    if (!post || post.userId !== req.user.id) return res.status(403).json({ error: 'Sem permissão' })
    const { title, content, published } = req.body
    const updated = await prisma.post.update({
      where: { id: req.params.id },
      data: { ...(title && { title }), ...(content && { content }), ...(published !== undefined && { published }), updatedAt: new Date() }
    })
    res.json(updated)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// DELETE /api/posts/:id — apagar post
router.delete('/:id', authenticate, async (req, res) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } })
    if (!post || post.userId !== req.user.id) return res.status(403).json({ error: 'Sem permissão' })
    await prisma.post.delete({ where: { id: req.params.id } })
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/posts/:id/cover — upload capa
router.post('/:id/cover', authenticate, upload.single('cover'), async (req, res) => {
  try {
    const post = await prisma.post.findUnique({ where: { id: req.params.id } })
    if (!post || post.userId !== req.user.id) return res.status(403).json({ error: 'Sem permissão' })
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem' })
    const imageUrl = await processImage(req.file.buffer, 'posts')
    await prisma.post.update({ where: { id: req.params.id }, data: { imageUrl } })
    res.json({ imageUrl })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// GET /api/posts/feed — posts de utilizadores seguidos
router.get('/feed', authenticate, async (req, res) => {
  try {
    const { page = 1, limit = 20 } = req.query
    const skip = (Number(page) - 1) * Number(limit)

    // Utilizadores seguidos (UserFollow)
    const userFollowing = await prisma.userFollow.findMany({
      where: { followerId: req.user.id },
      select: { followingId: true }
    })
    const followingIds = userFollowing.map(f => f.followingId)

    // Artistas seguidos (Follow)
    const artistFollowing = await prisma.follow.findMany({
      where: { followerId: req.user.id },
      select: { artistId: true }
    })
    const artistProfiles = await prisma.artistProfile.findMany({
      where: { id: { in: artistFollowing.map(f => f.artistId) } },
      select: { userId: true }
    })
    const artistUserIds = artistProfiles.map(a => a.userId)

    const allFollowingIds = [...new Set([...followingIds, ...artistUserIds])]

    if (allFollowingIds.length === 0) return res.json({ data: [], pagination: { total: 0, page: 1, totalPages: 0 } })

    const [posts, total] = await Promise.all([
      prisma.post.findMany({
        where: { userId: { in: allFollowingIds }, published: true },
        orderBy: { createdAt: 'desc' },
        skip, take: Number(limit),
        include: { user: { select: { id: true, name: true, username: true, avatarUrl: true, artistProfile: { select: { artistName: true, username: true } } } } }
      }),
      prisma.post.count({ where: { userId: { in: allFollowingIds }, published: true } })
    ])

    res.json({ data: posts, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})


// POST /api/posts-generic/:id/media — upload múltiplas imagens
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

// GET /api/posts-generic/unsubscribe/:artistId — cancelar subscrição de newsletter
router.get('/unsubscribe/:artistId', async (req, res) => {
  try {
    const { token } = req.query
    if (!token) return res.status(400).send('Token inválido')
    const email = Buffer.from(token, 'base64').toString('utf8')
    const user = await prisma.user.findFirst({ where: { email } })
    if (!user) return res.status(404).send('Utilizador não encontrado')
    // Marcar como não subscrito
    await prisma.newsletterSubscription.upsert({
      where: { followerId_artistId: { followerId: user.id, artistId: req.params.artistId } },
      update: { isSubscribed: false },
      create: { followerId: user.id, artistId: req.params.artistId, isSubscribed: false }
    })
    res.send(`
      <html><body style="font-family:sans-serif;max-width:400px;margin:80px auto;text-align:center;">
        <h2>✅ Subscrição cancelada</h2>
        <p>Deixaste de receber emails deste artista.<br>Podes continuar a seguir as suas obras no nauu.art.</p>
        <a href="${process.env.FRONTEND_URL}" style="color:#1A7FD4;">Voltar ao nauu.art</a>
      </body></html>
    `)
  } catch (err) { console.error(err); res.status(500).send('Erro') }
})
