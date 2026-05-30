const express = require('express')
const router = express.Router()
const { authenticate, requireArtist } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()
const nodemailer = require('nodemailer')

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
})

const sendMail = (to, subject, html) =>
  transporter.sendMail({ from: process.env.EMAIL_FROM, to, subject, html }).catch(console.error)

// GET /api/approval/status — estado atual do artista
router.get('/status', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({
      where: { userId: req.user.id },
      select: { status: true, adminNotes: true, artistName: true, bio: true, user: { select: { avatarUrl: true } }, _count: { select: { artworks: true } } }
    })
    res.json(artist)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/approval/submit — artista submete para aprovação
router.post('/submit', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({
      where: { userId: req.user.id },
      include: { user: true, _count: { select: { artworks: true } } }
    })

    // Verificar requisitos
    const missing = []
    if (!artist.artistName) missing.push('Nome artístico')
    if (!artist.user.avatarUrl) missing.push('Fotografia de perfil')
    if (!artist.bio) missing.push('Biografia')
    if (artist._count.artworks < 3) missing.push(`Mínimo 3 obras (tens ${artist._count.artworks})`)

    if (missing.length > 0) return res.status(400).json({ error: 'Perfil incompleto', missing })
    if (artist.status === 'UNDER_REVIEW') return res.status(400).json({ error: 'Já está em revisão' })
    if (artist.status === 'APPROVED') return res.status(400).json({ error: 'Já aprovado' })

    await prisma.artistProfile.update({
      where: { userId: req.user.id },
      data: { status: 'UNDER_REVIEW' }
    })

    // Email ao admin
    await sendMail(
      process.env.SMTP_USER,
      `Novo artista submetido: ${artist.artistName}`,
      `<h2>Novo artista para aprovação</h2>
       <p><strong>Nome:</strong> ${artist.artistName}</p>
       <p><strong>Email:</strong> ${artist.user.email}</p>
       <p><strong>Obras:</strong> ${artist._count.artworks}</p>
       <p><a href="${process.env.FRONTEND_URL}/admin">Ver painel admin →</a></p>`
    )

    res.json({ ok: true, status: 'UNDER_REVIEW' })
  } catch (e) { console.error(e); res.status(500).json({ error: 'Erro' }) }
})

// ── Rotas de admin ──────────────────────────────────────────

const requireAdmin = (req, res, next) => {
  if (req.user?.accountType !== 'ADMIN') return res.status(403).json({ error: 'Acesso negado' })
  next()
}

// GET /api/approval/pending — lista de artistas pendentes
router.get('/pending', authenticate, requireAdmin, async (req, res) => {
  try {
    const artists = await prisma.artistProfile.findMany({
      where: { status: 'UNDER_REVIEW' },
      include: {
        user: { select: { email: true, avatarUrl: true } },
        _count: { select: { artworks: true } }
      },
      orderBy: { createdAt: 'asc' }
    })
    res.json(artists)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// GET /api/approval/review/:id — detalhe para revisão
router.get('/review/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({
      where: { id: req.params.id },
      include: {
        user: { select: { email: true, avatarUrl: true } },
        artworks: { include: { images: { where: { isPrimary: true }, take: 1 }, categories: { include: { category: true } } } },
        categories: { include: { category: true } }
      }
    })
    if (!artist) return res.status(404).json({ error: 'Não encontrado' })
    res.json(artist)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/approval/approve/:id
router.post('/approve/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.update({
      where: { id: req.params.id },
      data: { status: 'APPROVED', isApproved: true, adminNotes: null },
      include: { user: true }
    })
    await sendMail(
      artist.user.email,
      'O seu perfil foi aprovado — nauu.art',
      `<h2>Parabéns, ${artist.artistName}!</h2>
       <p>O seu perfil está agora disponível publicamente no nauu.art.</p>
       <p><a href="${process.env.FRONTEND_URL}/${artist.username}">Ver o meu perfil →</a></p>`
    )
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/approval/changes/:id
router.post('/changes/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const { notes } = req.body
    const artist = await prisma.artistProfile.update({
      where: { id: req.params.id },
      data: { status: 'CHANGES_REQUESTED', adminNotes: notes },
      include: { user: true }
    })
    await sendMail(
      artist.user.email,
      'São necessárias alterações ao seu perfil — nauu.art',
      `<h2>Olá ${artist.artistName},</h2>
       <p>Analisámos o seu perfil e gostaríamos de pedir algumas alterações:</p>
       <blockquote>${notes}</blockquote>
       <p><a href="${process.env.FRONTEND_URL}/dashboard/profile">Editar perfil →</a></p>`
    )
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// POST /api/approval/reject/:id
router.post('/reject/:id', authenticate, requireAdmin, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.update({
      where: { id: req.params.id },
      data: { status: 'REJECTED', isApproved: false },
      include: { user: true }
    })
    await sendMail(
      artist.user.email,
      'Atualização da sua candidatura — nauu.art',
      `<h2>Olá ${artist.artistName},</h2>
       <p>Agradecemos a sua submissão. Neste momento o seu perfil não se enquadra na linha curatorial do nauu.art.</p>`
    )
    res.json({ ok: true })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

module.exports = router
