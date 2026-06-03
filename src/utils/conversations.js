const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const createOrGetConversation = async (userId1, userId2, artworkId = null) => {
  const existing = await prisma.conversation.findFirst({
    where: {
      AND: [
        { participants: { some: { userId: userId1 } } },
        { participants: { some: { userId: userId2 } } }
      ]
    }
  })
  if (existing) return existing

  return await prisma.conversation.create({
    data: {
      ...(artworkId && { artworkId }),
      participants: {
        create: [{ userId: userId1 }, { userId: userId2 }]
      }
    }
  })
}

module.exports = { createOrGetConversation }
