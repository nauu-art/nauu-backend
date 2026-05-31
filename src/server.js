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
const postRoutes = require('./routes/post.routes')
const approvalRoutes = require('./routes/approval.routes')
const artistCollectionRoutes = require('./routes/collection_artist.routes');

const app = express();
const PORT = process.env.PORT || 3001;

// Trust proxy (necessário para rate limiting atrás do Nginx)
app.set('trust proxy', 1);

// Segurança
app.use(helmet());
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
}));

// Rate limiting geral
app.use(rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 500,
  message: { error: 'Demasiados pedidos. Tenta mais tarde.' },
  skip: (req) => req.ip === '127.0.0.1' || req.ip === '::1',
}));

// Rate limiting estrito para autenticação
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { error: 'Demasiadas tentativas. Tenta em 15 minutos.' },
});

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

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
app.use('/api/posts', postRoutes)
app.use('/api/approval', approvalRoutes)
app.use('/api/artist-collections', artistCollectionRoutes);

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
