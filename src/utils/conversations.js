const { PrismaClient } = require('@prisma/client')
const prisma = new PrismaClient()

const createOrGetConversation = async (userId1, userId2) => {
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
      participants: {
        create: [{ userId: userId1 }, { userId: userId2 }]
      }
    }
  })
}

module.exports = { createOrGetConversation }
