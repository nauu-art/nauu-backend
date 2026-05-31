const express = require('express')
const router = express.Router()
const { authenticate } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const { notify } = require('../utils/notify')
const { upload, processImage } = require('../config/storage')
const prisma = new PrismaClient()

// GET /api/profile/:username — perfil público de qualquer utilizador
router.get('/:username', async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { username: req.params.username },
      select: {
        id: true, name: true, username: true, avatarUrl: true,
        bio: true, city: true, country: true, accountType: true, accountSubtype: true,
        createdAt: true,
        artistProfile: {
          select: {
            id: true, artistName: true, status: true, isFeatured: true,
            categories: { include: { category: { select: { name: true } } } },
            _count: { select: { artworks: { where: { isDraft: false } } } }
          }
        },
        collections: {
          where: { isPublic: true },
          take: 6,
          include: { items: { take: 3, include: { artwork: { include: { images: { where: { isPrimary: true }, take: 1 } } } } } }
        },
        _count: {
          select: {
            userFollowers: true,
            userFollowing: true,
          }
        }
      }
    })

    if (!user || user.isBanned) return res.status(404).json({ error: 'Utilizador não encontrado' })

    res.json(user)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// PUT /api/profile — atualizar perfil do utilizador
router.put('/', authenticate, async (req, res) => {
  try {
    const { name, bio, city, country, username } = req.body

    // Verificar username único
    if (username) {
      const existing = await prisma.user.findUnique({ where: { username } })
      if (existing && existing.id !== req.user.id) return res.status(409).json({ error: 'Username já em uso' })
      // Não permitir usernames de artistas já existentes noutros perfis
      const artistWithUsername = await prisma.artistProfile.findUnique({ where: { username } })
      if (artistWithUsername && artistWithUsername.userId !== req.user.id) return res.status(409).json({ error: 'Username já em uso' })
    }

    const updated = await prisma.user.update({
      where: { id: req.user.id },
      data: { ...(name && { name }), ...(bio !== undefined && { bio }), ...(city !== undefined && { city }), ...(country !== undefined && { country }), ...(username && { username }) }
    })

    res.json({ ok: true, user: { name: updated.name, username: updated.username, bio: updated.bio, city: updated.city, country: updated.country } })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao atualizar perfil' }) }
})

// POST /api/profile/avatar — upload avatar
router.post('/avatar', authenticate, upload.single('avatar'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'Nenhuma imagem' })
    const avatarUrl = await processImage(req.file.buffer, 'avatars')
    await prisma.user.update({ where: { id: req.user.id }, data: { avatarUrl } })
    res.json({ avatarUrl })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao fazer upload' }) }
})

// POST /api/profile/complete-onboarding — completar onboarding
router.post('/complete-onboarding', authenticate, async (req, res) => {
  try {
    const { username, bio, city, country, interests } = req.body
    if (!username) return res.status(400).json({ error: 'Username obrigatório' })

    const existing = await prisma.user.findUnique({ where: { username } })
    if (existing && existing.id !== req.user.id) return res.status(409).json({ error: 'Username já em uso' })

    await prisma.user.update({
      where: { id: req.user.id },
      data: { username, bio, city, country, onboardingCompleted: true }
    })

    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// POST /api/profile/follow/:userId — seguir/deixar de seguir utilizador
router.post('/follow/:userId', authenticate, async (req, res) => {
  try {
    const targetId = req.params.userId
    if (targetId === req.user.id) return res.status(400).json({ error: 'Não podes seguir-te a ti próprio' })

    const target = await prisma.user.findUnique({ where: { id: targetId }, select: { id: true, name: true, username: true } })
    if (!target) return res.status(404).json({ error: 'Utilizador não encontrado' })

    const existing = await prisma.userFollow.findUnique({
      where: { followerId_followingId: { followerId: req.user.id, followingId: targetId } }
    })

    if (existing) {
      await prisma.userFollow.delete({ where: { followerId_followingId: { followerId: req.user.id, followingId: targetId } } })
      res.json({ following: false })
    } else {
      await prisma.userFollow.create({ data: { followerId: req.user.id, followingId: targetId } })
      const me = await prisma.user.findUnique({ where: { id: req.user.id }, select: { name: true, username: true } })
      await notify(targetId, 'NEW_FOLLOWER', `${me.name} começou a seguir-te`, `/u/${me.username}`)
      res.json({ following: true })
    }
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// GET /api/profile/follow/:userId — verificar se segue
router.get('/follow/:userId', authenticate, async (req, res) => {
  try {
    const existing = await prisma.userFollow.findUnique({
      where: { followerId_followingId: { followerId: req.user.id, followingId: req.params.userId } }
    })
    res.json({ following: !!existing })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

module.exports = router
