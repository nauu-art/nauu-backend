const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { PrismaClient } = require('@prisma/client');
const { z } = require('zod');
const {
  sendVerificationEmail,
  sendPasswordResetEmail,
} = require('../utils/email');

const prisma = new PrismaClient();

const registerSchema = z.object({
  name: z.string().min(2, 'Nome demasiado curto'),
  email: z.string().email('Email inválido'),
  password: z.string().min(8, 'Password deve ter pelo menos 8 caracteres'),
  accountType: z.enum(['USER', 'ARTIST']),
  artistName: z.string().optional(),
  username: z.string().min(3).regex(/^[a-z0-9_-]+$/, 'Username inválido (só letras minúsculas, números, _ e -)').optional().or(z.literal('')),
  city: z.string().optional(),
  country: z.string().optional(),
});

// POST /api/auth/register
const register = async (req, res) => {
  try {
    const data = registerSchema.parse(req.body);

    const exists = await prisma.user.findUnique({ where: { email: data.email } });
    if (exists) return res.status(409).json({ error: 'Email já registado' });

    if (data.accountType === 'ARTIST') {
      if (!data.artistName) return res.status(400).json({ error: 'Nome artístico obrigatório para artistas' });
      if (!data.username) return res.status(400).json({ error: 'Username obrigatório para artistas' });

      const usernameTaken = await prisma.artistProfile.findUnique({ where: { username: data.username } });
      if (usernameTaken) return res.status(409).json({ error: 'Username já em uso' });
    }

    const passwordHash = await bcrypt.hash(data.password, 12);
    const emailVerifyToken = crypto.randomBytes(32).toString('hex');

    const user = await prisma.user.create({
      data: {
        email: data.email,
        passwordHash,
        name: data.name,
        accountType: data.accountType,
        emailVerifyToken,
        ...(data.accountType === 'ARTIST' && {
          artistProfile: {
            create: {
              artistName: data.artistName,
              username: data.username,
              city: data.city,
              country: data.country,
              contactEmail: data.email,
            },
          },
        }),
      },
    });

    await sendVerificationEmail(user.email, user.name, emailVerifyToken);

    res.status(201).json({
      message: 'Conta criada! Verifica o teu email para ativar a conta.',
    });
  } catch (err) {
    if (err.name === 'ZodError') return res.status(400).json({ error: err.errors[0].message });
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar conta' });
  }
};

// GET /api/auth/verify-email/:token
const verifyEmail = async (req, res) => {
  try {
    const { token } = req.params;
    const user = await prisma.user.findFirst({ where: { emailVerifyToken: token } });
    if (!user) return res.status(400).json({ error: 'Token inválido ou expirado' });

    await prisma.user.update({
      where: { id: user.id },
      data: { isEmailVerified: true, emailVerifyToken: null },
    });

    res.json({ message: 'Email verificado! Podes fazer login.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao verificar email' });
  }
};

// POST /api/auth/login
const login = async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email e password obrigatórios' });

    const user = await prisma.user.findUnique({
      where: { email },
      include: { artistProfile: { select: { username: true, artistName: true } } },
    });

    if (!user) return res.status(401).json({ error: 'Credenciais inválidas' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas' });

    if (!user.isEmailVerified) {
      return res.status(403).json({ error: 'Verifica o teu email antes de fazer login' });
    }

    const token = jwt.sign(
      { userId: user.id, accountType: user.accountType },
      process.env.JWT_SECRET,
      { expiresIn: process.env.JWT_EXPIRES_IN || '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        accountType: user.accountType,
        avatarUrl: user.avatarUrl,
        onboardingCompleted: user.onboardingCompleted,
        username: user.username,
        artistProfile: user.artistProfile,
      },
    });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao fazer login' });
  }
};

// GET /api/auth/me
const me = async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: {
        id: true, name: true, email: true, accountType: true, avatarUrl: true,
        username: true, bio: true, city: true, country: true,
        onboardingCompleted: true, accountSubtype: true,
        artistProfile: {
          select: { id: true, username: true, artistName: true, coverImageUrl: true, city: true, country: true, status: true, stripeOnboarded: true },
        },
        _count: { select: { userFollowers: true, userFollowing: true } }
      },
    });
    res.json(user);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter dados do utilizador' });
  }
};

// POST /api/auth/forgot-password
const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;
    const user = await prisma.user.findUnique({ where: { email } });

    // Sempre responde com sucesso (segurança — não revelar se email existe)
    if (user) {
      const token = crypto.randomBytes(32).toString('hex');
      const expires = new Date(Date.now() + 60 * 60 * 1000); // 1 hora

      await prisma.user.update({
        where: { id: user.id },
        data: { resetPasswordToken: token, resetTokenExpires: expires },
      });

      await sendPasswordResetEmail(user.email, user.name, token);
    }

    res.json({ message: 'Se o email existir, receberás um link de recuperação.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao processar pedido' });
  }
};

// POST /api/auth/reset-password/:token
const resetPassword = async (req, res) => {
  try {
    const { token } = req.params;
    const { password } = req.body;

    if (!password || password.length < 8) {
      return res.status(400).json({ error: 'Password deve ter pelo menos 8 caracteres' });
    }

    const user = await prisma.user.findFirst({
      where: {
        resetPasswordToken: token,
        resetTokenExpires: { gt: new Date() },
      },
    });

    if (!user) return res.status(400).json({ error: 'Token inválido ou expirado' });

    const passwordHash = await bcrypt.hash(password, 12);

    await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash, resetPasswordToken: null, resetTokenExpires: null },
    });

    res.json({ message: 'Password atualizada! Podes fazer login.' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao redefinir password' });
  }
};

module.exports = { register, verifyEmail, login, me, forgotPassword, resetPassword };
