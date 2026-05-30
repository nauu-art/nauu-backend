const express = require('express')
const router = express.Router()
const { getCollections, createCollection, addToCollection, removeFromCollection, deleteCollection } = require('../controllers/collection.controller')
const { authenticate } = require('../middleware/auth.middleware')

router.get('/', authenticate, getCollections)
router.post('/', authenticate, createCollection)
router.post('/:id/items', authenticate, addToCollection)
router.delete('/:id/items/:artworkId', authenticate, removeFromCollection)
router.delete('/:id', authenticate, deleteCollection)

module.exports = router
