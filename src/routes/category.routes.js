// category.routes.js
const express = require('express');
const router = express.Router();
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

router.get('/', async (req, res) => {
  try {
    const categories = await prisma.category.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { artworks: true } } },
    });
    res.json(categories);
  } catch (err) {
    res.status(500).json({ error: 'Erro ao obter categorias' });
  }
});

module.exports = router;
