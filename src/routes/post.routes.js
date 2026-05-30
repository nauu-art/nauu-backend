const express = require('express')
const router = express.Router()
const { getPosts, getMyPosts, createPost, updatePost, deletePost, uploadPostCover } = require('../controllers/post.controller')
const { authenticate, requireArtist } = require('../middleware/auth.middleware')
const { upload } = require('../config/storage')

router.get('/artist/:username', getPosts)
router.get('/my', authenticate, requireArtist, getMyPosts)
router.post('/', authenticate, requireArtist, createPost)
router.put('/:id', authenticate, requireArtist, updatePost)
router.delete('/:id', authenticate, requireArtist, deletePost)
router.post('/:id/cover', authenticate, requireArtist, upload.single('cover'), uploadPostCover)

module.exports = router
