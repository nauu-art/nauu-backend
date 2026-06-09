require('dotenv').config();
const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth.routes');
const artistRoutes = require('./routes/artist.routes');
const artworkRoutes = require('./routes/artwork.routes');
const categoryRoutes = require('./routes/category.routes');
const favoriteRoutes = require('./routes/favorite.routes');
const contactRoutes = require('./routes/contact.routes')
const adminRoutes = require('./routes/admin.routes');
const collectionRoutes = require('./routes/collection.routes');
const followRoutes = require('./routes/follow.routes');
const approvalRoutes = require('./routes/approval.routes')
const artistCollectionRoutes = require('./routes/collection_artist.routes')
const notificationRoutes = require('./routes/notification.routes')
const messagesRoutes = require('./routes/messages.routes')
const paymentRoutes = require('./routes/payment.routes')
const postsGenericRoutes = require('./routes/posts_generic.routes')
const postsRoutes = require('./routes/posts.routes')
const interactionsRoutes = require('./routes/interactions.routes')
const profileRoutes = require('./routes/profile.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy (necessário para rate limiting atrás do Nginx)
app.set('trust proxy', 1);

// Segurança
app.use(helmet({
  contentSecurityPolicy: false, // Next.js gere isto
  crossOriginEmbedderPolicy: false,
}));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin')
  next()
})
app.use(cors({
  origin: [process.env.FRONTEND_URL, 'https://staging.nauu.art'].filter(Boolean),
  credentials: true,
}));

// Rate limiting geral
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Demasiados pedidos. Tenta mais tarde.' },
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1',
}));

// Rate limiting para endpoints de email (anti-spam)
const emailLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hora
  max: 5,
  message: { error: 'Demasiados pedidos. Tenta mais tarde.' },
})

// Rate limiting estrito só para login/register
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { error: 'Demasiadas tentativas. Tenta em 15 minutos.' },
  skip: (req) => {
    // Não limitar /me, /logout, /refresh — só login e register
    const freeRoutes = ['/me', '/logout', '/refresh', '/change-password', '/profile']
    return freeRoutes.some(r => req.path.startsWith(r))
  }
});

// Raw body para webhook Stripe — tem de ser antes do express.json
app.use('/api/payments/webhook', express.raw({ type: 'application/json' }))
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Email-specific rate limiting (antes das rotas)
app.use('/api/auth/donation', emailLimiter);
app.use('/api/auth/newsletter', emailLimiter);
app.use('/api/contact/feedback', emailLimiter);

// Rotas
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/artists', artistRoutes);
app.use('/api/artworks', artworkRoutes);
app.use('/api/categories', categoryRoutes);
app.use('/api/favorites', favoriteRoutes);
app.use('/api/contact', contactRoutes)
app.use('/api/admin', adminRoutes);
app.use('/api/collections', collectionRoutes);
app.use('/api/follow', followRoutes);
app.use('/api/approval', approvalRoutes)
app.use('/api/artist-collections', artistCollectionRoutes)
app.use('/api/notifications', notificationRoutes)
app.use('/api/messages', messagesRoutes)
app.use('/api/payments', paymentRoutes)
app.use('/api/posts-generic', postsGenericRoutes)
app.use('/api/posts', postsRoutes)
app.use('/api/interactions', interactionsRoutes)
app.use('/api/profile', profileRoutes);
const curatedRoutes = require('./routes/curated.routes')
app.use('/api/curated', curatedRoutes)
const analyticsRoutes = require('./routes/analytics.routes')
const arRoutes = require('./routes/ar.routes')
app.use('/api/ar', arRoutes)
app.use('/api/analytics', analyticsRoutes)

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: 'Rota não encontrada' });
});

// Error handler global
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(err.status || 500).json({
    error: err.message || 'Erro interno do servidor',
  });
});

app.listen(PORT, () => {
  console.log(`🎨 ArtHub API a correr em http://localhost:${PORT}`);
});

module.exports = app;
