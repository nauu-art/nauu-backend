const express = require('express')
const router = express.Router()
const { followArtist, unfollowArtist, getFollowing, getFeed, isFollowing } = require('../controllers/follow.controller')
const { authenticate } = require('../middleware/auth.middleware')

router.get('/feed', authenticate, getFeed)
router.get('/following', authenticate, getFollowing)
router.get('/check/:artistId', authenticate, isFollowing)
router.post('/:artistId', authenticate, followArtist)
router.delete('/:artistId', authenticate, unfollowArtist)

module.exports = router
