const { PrismaClient } = require('@prisma/client')
const { notify, TYPES } = require('../utils/notify');
const { sendContactNotification, sendContactConfirmation } = require('../utils/email');
const prisma = new PrismaClient();

// POST /api/contact/:artistUsername
const sendContact = async (req, res) => {
  try {
    const { artistUsername } = req.params;
    const { name, email, message, artworkId } = req.body;

    if (!name || !email || !message) {
      return res.status(400).json({ error: 'Nome, email e mensagem são obrigatórios' });
    }

    const artist = await prisma.artistProfile.findUnique({
      where: { username: artistUsername },
      include: { user: { select: { name: true } } },
    });
    if (!artist) return res.status(404).json({ error: 'Artista não encontrado' });

    let artwork = null;
    if (artworkId) {
      artwork = await prisma.artwork.findUnique({ where: { id: artworkId }, select: { title: true } });
    }

    await prisma.contactRequest.create({
      data: {
        artistId: artist.id,
        senderUserId: req.user?.id || null,
        artworkId: artworkId || null,
        name, email, message,
      },
    });

    const artistEmail = artist.contactEmail || artist.user?.email;
    if (artistEmail) {
      const artistUser = await prisma.user.findUnique({ where: { id: artist.userId }, select: { notifyOnMessage: true } })
    if (artistUser?.notifyOnMessage !== false) await sendContactNotification(artistEmail, artist.artistName, {
        senderName: name, senderEmail: email, message, artworkTitle: artwork?.title,
      });
    }
    await sendContactConfirmation(email, name, artist.artistName);

    res.json({ message: 'Mensagem enviada com sucesso!' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao enviar mensagem' });
  }
};

// GET /api/contact/sent
const getSentContacts = async (req, res) => {
  try {
    const contacts = await prisma.contactRequest.findMany({
      where: { senderUserId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: { artist: { select: { artistName: true, username: true } }, artwork: { select: { title: true } } },
    });
    res.json(contacts);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter contactos' });
  }
};

// GET /api/contact/received
const getReceivedContacts = async (req, res) => {
  try {
    const artist = await prisma.artistProfile.findUnique({ where: { userId: req.user.id } });
    if (!artist) return res.status(404).json({ error: 'Perfil não encontrado' });

    const { page = 1, limit = 20 } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const [contacts, total] = await Promise.all([
      prisma.contactRequest.findMany({
        where: { artistId: artist.id },
        skip, take: Number(limit),
        orderBy: { createdAt: 'desc' },
        include: { artwork: { select: { title: true } } },
      }),
      prisma.contactRequest.count({ where: { artistId: artist.id } }),
    ]);

    res.json({ data: contacts, pagination: { total, page: Number(page), totalPages: Math.ceil(total / Number(limit)) } });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter contactos' });
  }
};

// --- FAVORITOS ---

// GET /api/favorites
const getFavorites = async (req, res) => {
  try {
    const favorites = await prisma.favorite.findMany({
      where: { userId: req.user.id },
      orderBy: { createdAt: 'desc' },
      include: {
        artwork: {
          include: {
            images: { where: { isPrimary: true }, take: 1 },
            artist: { select: { artistName: true, username: true } },
          },
        },
      },
    });
    res.json(favorites.map(f => f.artwork));
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter favoritos' });
  }
};

// POST /api/favorites/:artworkId
const addFavorite = async (req, res) => {
  try {
    const { artworkId } = req.params;
    const exists = await prisma.artwork.findUnique({ where: { id: artworkId } });
    if (!exists) return res.status(404).json({ error: 'Obra não encontrada' });

    await prisma.favorite.upsert({
      where: { userId_artworkId: { userId: req.user.id, artworkId } },
      create: { userId: req.user.id, artworkId },
      update: {},
    });
    res.json({ message: 'Adicionado aos favoritos' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao adicionar favorito' });
  }
};

// DELETE /api/favorites/:artworkId
const removeFavorite = async (req, res) => {
  try {
    const { artworkId } = req.params;
    await prisma.favorite.deleteMany({ where: { userId: req.user.id, artworkId } });
    res.json({ message: 'Removido dos favoritos' });
  } catch (err) {
    res.status(500).json({ error: 'Erro ao remover favorito' });
  }
};

module.exports = { sendContact, getSentContacts, getReceivedContacts, getFavorites, addFavorite, removeFavorite };
