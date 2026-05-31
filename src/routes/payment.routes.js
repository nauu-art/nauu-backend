const express = require('express')
const router = express.Router()
const { authenticate, requireArtist } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const { notify } = require('../utils/notify')
const Stripe = require('stripe')
const prisma = new PrismaClient()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const PLATFORM_FEE = parseFloat(process.env.PLATFORM_COMMISSION_PERCENT || 5) / 100

// GET /api/payments/config — chave pública para o frontend
router.get('/config', (req, res) => {
  res.json({ publishableKey: process.env.STRIPE_PUBLISHABLE_KEY })
})

// POST /api/payments/connect/onboard — iniciar onboarding Stripe Connect
router.post('/connect/onboard', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id }, include: { user: true } })
    if (!artist) return res.status(404).json({ error: 'Artista não encontrado' })

    let accountId = artist.stripeAccountId

    if (!accountId) {
      const account = await stripe.accounts.create({
        type: 'express',
        country: 'PT',
        email: artist.user.email,
        capabilities: { transfers: { requested: true } },
        business_type: 'individual',
        metadata: { artistId: artist.id, userId: req.user.id }
      })
      accountId = account.id
      await prisma.artistProfile.update({ where: { id: artist.id }, data: { stripeAccountId: accountId } })
    }

    const accountLink = await stripe.accountLinks.create({
      account: accountId,
      refresh_url: `${process.env.FRONTEND_URL}/dashboard/payments?refresh=true`,
      return_url: `${process.env.FRONTEND_URL}/dashboard/payments?success=true`,
      type: 'account_onboarding'
    })

    res.json({ url: accountLink.url })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro ao iniciar onboarding' }) }
})

// GET /api/payments/connect/status — estado da conta Stripe Connect
router.get('/connect/status', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    if (!artist?.stripeAccountId) return res.json({ connected: false, onboarded: false })

    const account = await stripe.accounts.retrieve(artist.stripeAccountId)
    const onboarded = account.charges_enabled && account.payouts_enabled

    if (onboarded && !artist.stripeOnboarded) {
      await prisma.artistProfile.update({ where: { id: artist.id }, data: { stripeOnboarded: true } })
    }

    res.json({
      connected: true,
      onboarded,
      chargesEnabled: account.charges_enabled,
      payoutsEnabled: account.payouts_enabled,
      requirements: account.requirements?.currently_due || []
    })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// POST /api/payments/intent — criar PaymentIntent
router.post('/intent', authenticate, async (req, res) => {
  try {
    const { artworkId, shippingAddress, notes } = req.body
    if (!artworkId) return res.status(400).json({ error: 'Obra obrigatória' })

    const artwork = await prisma.artwork.findUnique({
      where: { id: artworkId },
      include: { artist: { include: { user: true } } }
    })

    if (!artwork) return res.status(404).json({ error: 'Obra não encontrada' })
    if (artwork.availability !== 'AVAILABLE') return res.status(400).json({ error: 'Obra não disponível' })
    if (artwork.priceOnRequest || !artwork.price) return res.status(400).json({ error: 'Obra sem preço definido' })
    if (!artwork.artist.stripeAccountId || !artwork.artist.stripeOnboarded) return res.status(400).json({ error: 'Artista ainda não configurou pagamentos' })
    if (artwork.artist.userId === req.user.id) return res.status(400).json({ error: 'Não podes comprar a tua própria obra' })

    const amount = parseFloat(artwork.price)
    const commissionRate = parseFloat(artwork.artist.commissionPercent || PLATFORM_FEE)
    const platformFee = Math.round(amount * commissionRate * 100) / 100
    const artistAmount = Math.round((amount - platformFee) * 100) / 100
    const amountCents = Math.round(amount * 100)
    const feeCents = Math.round(platformFee * 100)

    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: 'eur',
      application_fee_amount: feeCents,
      transfer_data: { destination: artwork.artist.stripeAccountId },
      metadata: {
        artworkId,
        buyerId: req.user.id,
        artistId: artwork.artist.id,
      }
    })

    // Criar order em PENDING
    const order = await prisma.order.create({
      data: {
        buyerId: req.user.id,
        artistId: artwork.artist.id,
        artworkId,
        amount,
        platformFee,
        artistAmount,
        stripePaymentIntentId: paymentIntent.id,
        shippingAddress: shippingAddress ? JSON.stringify(shippingAddress) : null,
        notes
      }
    })

    res.json({
      clientSecret: paymentIntent.client_secret,
      orderId: order.id,
      amount,
      platformFee,
      artistAmount,
      artwork: { title: artwork.title, price: artwork.price }
    })
  } catch (err) { console.error(err); res.status(500).json({ error: err.message || 'Erro ao criar pagamento' }) }
})

// POST /api/payments/webhook — webhook Stripe
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  const sig = req.headers['stripe-signature']
  let event

  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET)
  } catch (err) {
    return res.status(400).json({ error: `Webhook Error: ${err.message}` })
  }

  if (event.type === 'payment_intent.succeeded') {
    const pi = event.data.object
    try {
      const order = await prisma.order.findFirst({ where: { stripePaymentIntentId: pi.id } })
      if (order) {
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'PAID', paidAt: new Date() }
        })
        // Marcar obra como reservada
        await prisma.artwork.update({ where: { id: order.artworkId }, data: { availability: 'RESERVED' } })
        // Notificar artista
        const artwork = await prisma.artwork.findUnique({ where: { id: order.artworkId }, select: { title: true, artist: { select: { userId: true } } } })
        const buyer = await prisma.user.findUnique({ where: { id: order.buyerId }, select: { name: true } })
        await notify(artwork.artist.userId, 'NEW_ORDER', `${buyer.name} comprou "${artwork.title}"!`, `/dashboard/orders`)
        // Notificar comprador
        await notify(order.buyerId, 'ORDER_PAID', `Pagamento confirmado para "${artwork.title}"`, `/account/orders`)
      }
    } catch (err) { console.error('Webhook handler error:', err) }
  }

  res.json({ received: true })
})

// GET /api/payments/orders — encomendas do utilizador
router.get('/orders', authenticate, async (req, res) => {
  try {
    const orders = await prisma.order.findMany({
      where: { buyerId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        artwork: { select: { id: true, title: true, images: { where: { isPrimary: true }, take: 1 } } },
        artist: { select: { artistName: true, username: true } }
      }
    })
    res.json(orders)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// GET /api/payments/sales — vendas do artista
router.get('/sales', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const orders = await prisma.order.findMany({
      where: { artistId: artist.id },
      orderBy: { createdAt: 'desc' },
      include: {
        artwork: { select: { id: true, title: true, images: { where: { isPrimary: true }, take: 1 } } },
        buyer: { select: { name: true, email: true } }
      }
    })
    res.json(orders)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

module.exports = router
