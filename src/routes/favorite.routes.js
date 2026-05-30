const express = require('express');
const router = express.Router();
const { getFavorites, addFavorite, removeFavorite } = require('../controllers/contact.controller');
const { authenticate } = require('../middleware/auth.middleware');

router.get('/', authenticate, getFavorites);
router.post('/:artworkId', authenticate, addFavorite);
router.delete('/:artworkId', authenticate, removeFavorite);

module.exports = router;
