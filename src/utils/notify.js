const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const TYPES = {
  NEW_FOLLOWER: 'NEW_FOLLOWER',
  NEW_FAVORITE: 'NEW_FAVORITE',
  NEW_CONTACT: 'NEW_CONTACT',
  NEW_ARTWORK: 'NEW_ARTWORK',
  NEW_POST: 'NEW_POST',
  COLLECTION_ADDED: 'COLLECTION_ADDED',
  PROFILE_APPROVED: 'PROFILE_APPROVED',
  PROFILE_CHANGES: 'PROFILE_CHANGES',
  PROFILE_REJECTED: 'PROFILE_REJECTED',
  NEW_MESSAGE: 'NEW_MESSAGE',
  SHIPPING: 'SHIPPING',
}

async function notify(userId, type, message, link) {
  try {
    await prisma.notification.create({
      data: { userId, type, message, link }
    })
  } catch (err) {
    console.error('Notify error:', err)
  }
}

module.exports = { notify, TYPES }
