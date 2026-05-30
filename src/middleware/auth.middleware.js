const jwt = require('jsonwebtoken');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// Verifica se o utilizador está autenticado
const authenticate = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Token de autenticação em falta' });
    }

    const token = authHeader.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: { id: true, email: true, name: true, accountType: true, isEmailVerified: true },
    });

    if (!user) return res.status(401).json({ error: 'Utilizador não encontrado' });
    if (!user.isEmailVerified) return res.status(403).json({ error: 'Email não verificado' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Token inválido ou expirado' });
  }
};

// Só para autenticação opcional (não falha se não tiver token)
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.split(' ')[1];
      const decoded = jwt.verify(token, process.env.JWT_SECRET);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, email: true, name: true, accountType: true },
      });
      req.user = user || null;
    }
  } catch (_) {
    req.user = null;
  }
  next();
};

// Só para artistas
const requireArtist = (req, res, next) => {
  if (!req.user) return res.status(401).json({ error: 'Não autenticado' });
  if (req.user.accountType !== 'ARTIST') {
    return res.status(403).json({ error: 'Acesso restrito a artistas' });
  }
  next();
};

module.exports = { authenticate, optionalAuth, requireArtist };
