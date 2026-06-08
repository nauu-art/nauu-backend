const express = require('express')
const router = express.Router()
const { authenticate, requireArtist } = require('../middleware/auth.middleware')
const { PrismaClient } = require('@prisma/client')
const { notify } = require('../utils/notify')
const { sendOrderConfirmationBuyer, sendOrderNotificationArtist } = require('../utils/email')
const Stripe = require('stripe')
const prisma = new PrismaClient()
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY)

const PLATFORM_FEE = parseFloat(process.env.PLATFORM_COMMISSION_PERCENT || 3) / 100

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
    const { artworkId, shippingAddress, notes, shippingCost: rawShippingCost } = req.body
    if (!artworkId) return res.status(400).json({ error: 'Obra obrigatória' })

    const artwork = await prisma.artwork.findUnique({
      where: { id: artworkId },
      include: { artist: { include: { user: true } }, shipping: true }
    })

    if (!artwork) return res.status(404).json({ error: 'Obra não encontrada' })
    if (artwork.availability !== 'AVAILABLE') return res.status(400).json({ error: 'Obra não disponível' })
    if (artwork.priceOnRequest || !artwork.price) return res.status(400).json({ error: 'Obra sem preço definido' })
    if (!artwork.artist.stripeAccountId || !artwork.artist.stripeOnboarded) return res.status(400).json({ error: 'Artista ainda não configurou pagamentos' })
    if (artwork.artist.userId === req.user.id) return res.status(400).json({ error: 'Não podes comprar a tua própria obra' })

    const artworkPrice = parseFloat(artwork.price)
    const shippingCost = parseFloat(rawShippingCost || 0)
    const totalAmount = artworkPrice + shippingCost
    const rawRate = parseFloat(artwork.commissionPercent || artwork.artist.commissionPercent || PLATFORM_FEE)
    const commissionRate = rawRate > 1 ? rawRate / 100 : rawRate
    const platformFee = Math.round(artworkPrice * commissionRate * 100) / 100
    // Stripe fee (1.5% + €0.25) is charged to the artist so nauu receives clean commission
    const stripeFee = Math.round((totalAmount * 0.015 + 0.25) * 100) / 100
    const totalFee = platformFee + stripeFee
    const artistAmount = Math.round((totalAmount - totalFee) * 100) / 100
    const amountCents = Math.round(totalAmount * 100)
    const feeCents = Math.round(totalFee * 100)

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
        amount: totalAmount,
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
      amount: totalAmount,
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
        // Decrementar stock e marcar disponibilidade
        const artworkData = await prisma.artwork.findUnique({ where: { id: order.artworkId }, select: { stock: true } })
        const newStock = artworkData.stock !== null ? Math.max(0, (artworkData.stock || 1) - 1) : null
        const newAvailability = newStock === 0 ? 'SOLD' : newStock === null ? 'RESERVED' : newStock > 0 ? 'AVAILABLE' : 'SOLD'
        await prisma.artwork.update({ where: { id: order.artworkId }, data: { availability: newAvailability, ...(newStock !== null && { stock: newStock }) } })
        // Notificar artista
        const artwork = await prisma.artwork.findUnique({ where: { id: order.artworkId }, select: { title: true, artist: { select: { userId: true, artistName: true, user: { select: { email: true } } } } } })
        const buyer = await prisma.user.findUnique({ where: { id: order.buyerId }, select: { name: true, email: true } })
        await notify(artwork.artist.userId, 'NEW_ORDER', `${buyer.name} comprou "${artwork.title}"!`, `/dashboard/orders`)
        await notify(order.buyerId, 'ORDER_PAID', `Pagamento confirmado para "${artwork.title}"`, `/account/orders`)

        // Emails
        try {
          const shippingAddress = order.shippingAddress ? JSON.parse(order.shippingAddress) : null
          await sendOrderConfirmationBuyer(buyer.email, {
            buyerName: buyer.name,
            artworkTitle: artwork.title,
            artistName: artwork.artist.artistName,
            price: Number(order.amount).toFixed(2),
            address: shippingAddress,
            orderId: order.id.slice(0, 8).toUpperCase()
          })
          await sendOrderNotificationArtist(artwork.artist.user.email, {
            artistName: artwork.artist.artistName,
            buyerName: buyer.name,
            buyerEmail: buyer.email,
            artworkTitle: artwork.title,
            price: Number(order.amount).toFixed(2),
            address: shippingAddress,
            orderId: order.id.slice(0, 8).toUpperCase()
          })
        } catch (emailErr) { console.error('Erro emails:', emailErr.message) }

        // Mensagem automática entre artista e comprador
        try {
          const { createOrGetConversation } = require('../utils/conversations')
          const conv = await createOrGetConversation(order.buyerId, artwork.artist.userId, order.artworkId)
          const { PrismaClient: PC } = require('@prisma/client')
          const p = new PC()
          // Associar a order à conversa
          await p.conversation.update({
            where: { id: conv.id },
            data: { orders: { connect: { id: order.id } } }
          }).catch(() => {})
          await p.message.create({
            data: {
              conversationId: conv.id,
              senderId: artwork.artist.userId,
              content: `🎉 Pagamento confirmado!\n\nOlá! O pagamento da obra **${artwork.title}** foi confirmado com sucesso.\n\n👉 Ver obra: https://nauu.art/artwork/${order.artworkId}\n\nEntrarei em contacto em breve para combinar a entrega. Se tiveres alguma dúvida, responde a esta mensagem.\n\nObrigado pela compra! 🎨`
            }
          })
        } catch (msgErr) { console.error('Erro mensagem automática:', msgErr.message) }
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
        buyer: { select: { id: true, name: true, email: true } }
      }
    })
    res.json(orders)
  } catch { res.status(500).json({ error: 'Erro' }) }
})

module.exports = router

// PUT /api/payments/shipping/:artworkId — definir portes de envio
router.put('/shipping/:artworkId', authenticate, requireArtist, async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const artwork = await prisma.artwork.findUnique({ where: { id: req.params.artworkId } })
    if (!artwork || artwork.artistId !== artist.id) return res.status(403).json({ error: 'Sem permissão' })

    const { freeShipping, portugal, europe, world } = req.body

    const shipping = await prisma.artworkShipping.upsert({
      where: { artworkId: req.params.artworkId },
      create: { artworkId: req.params.artworkId, freeShipping: !!freeShipping, portugal: portugal || null, europe: europe || null, world: world || null },
      update: { freeShipping: !!freeShipping, portugal: portugal || null, europe: europe || null, world: world || null, updatedAt: new Date() }
    })

    res.json(shipping)
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})

// GET /api/payments/shipping/:artworkId — obter portes
router.get('/shipping/:artworkId', async (req, res) => {
  try {
    const shipping = await prisma.artworkShipping.findUnique({ where: { artworkId: req.params.artworkId } })
    res.json(shipping || { freeShipping: false, portugal: null, europe: null, world: null })
  } catch { res.status(500).json({ error: 'Erro' }) }
})

// PUT /api/payments/orders/:id/status — artista actualiza estado da encomenda
router.put('/orders/:id/status', authenticate, requireArtist, async (req, res) => {
  try {
    const { fulfillmentStatus, trackingNumber, trackingUrl } = req.body
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } })
    const order = await prisma.order.findFirst({
      where: { id: req.params.id, artistId: artist.id },
      include: {
        buyer: { select: { id: true, name: true, email: true } },
        artwork: { select: { title: true } }
      }
    })
    if (!order) return res.status(404).json({ error: 'Encomenda não encontrada' })

    const data = { fulfillmentStatus, updatedAt: new Date() }
    if (trackingNumber) data.trackingNumber = trackingNumber
    if (trackingUrl) data.trackingUrl = trackingUrl
    if (fulfillmentStatus === 'SHIPPED') data.shippedAt = new Date()
    if (fulfillmentStatus === 'DELIVERED') data.deliveredAt = new Date()

    await prisma.order.update({ where: { id: order.id }, data })

    // Notificações automáticas ao comprador
    const messages = {
      PROCESSING: `A tua encomenda "${order.artwork.title}" está a ser preparada para envio.`,
      SHIPPED: `A tua encomenda "${order.artwork.title}" foi enviada!${trackingNumber ? ` Nº tracking: ${trackingNumber}` : ''}`,
      DELIVERED: `A tua encomenda "${order.artwork.title}" foi marcada como entregue. Confirmas a receção?`,
      CANCELLED: `A encomenda "${order.artwork.title}" foi cancelada.`
    }
    if (messages[fulfillmentStatus]) {
      await notify(order.buyer.id, 'ORDER_UPDATE', messages[fulfillmentStatus], `/account/orders`)
      // Mensagem na conversa se existir
      if (order.conversationId) {
        await prisma.message.create({
          data: {
            conversationId: order.conversationId,
            senderId: req.user.id,
            content: `📦 ${messages[fulfillmentStatus]}`
          }
        })
      }
    }

    res.json({ ok: true })
  } catch (err) { console.error(err); res.status(500).json({ error: 'Erro' }) }
})
