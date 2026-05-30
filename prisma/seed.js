const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const prisma = new PrismaClient();

const categories = [
  { name: 'Pintura', slug: 'pintura', description: 'Óleo, acrílico, aquarela, guache' },
  { name: 'Fotografia', slug: 'fotografia', description: 'Fotografia artística, retrato, paisagem' },
  { name: 'Escultura', slug: 'escultura', description: 'Pedra, madeira, metal, cerâmica' },
  { name: 'Arte Digital', slug: 'arte-digital', description: 'Ilustração digital, arte generativa' },
  { name: 'Desenho & Ilustração', slug: 'desenho-ilustracao', description: 'Lápis, carvão, caneta' },
  { name: 'Gravura & Impressão', slug: 'gravura-impressao', description: 'Serigrafia, litografia' },
  { name: 'Têxtil & Arte Fibra', slug: 'textil-arte-fibra', description: 'Tecelagem, bordado, macramé' },
  { name: 'Joalharia & Ourivesaria', slug: 'joalharia-ourivesaria', description: 'Peças artesanais em prata e ouro' },
  { name: 'Cerâmica & Olaria', slug: 'ceramica-olaria', description: 'Peças funcionais e decorativas' },
  { name: 'Street Art & Graffiti', slug: 'street-art-graffiti', description: 'Murais, stencil, lettering' },
  { name: 'Performance & Instalação', slug: 'performance-instalacao', description: 'Arte performativa' },
  { name: 'Caligrafia & Lettering', slug: 'caligrafia-lettering', description: 'Lettering artístico e caligrafia' },
  { name: 'Design Gráfico', slug: 'design-grafico', description: 'Posters, editorial, identidade visual' },
  { name: 'Arte Multimédia', slug: 'arte-multimedia', description: 'Vídeo arte, som, interatividade' },
  { name: 'Artesanato', slug: 'artesanato', description: 'Peças artesanais com valor artístico' },
];

async function main() {
  console.log('🌱 A iniciar seed...');

  // Categorias
  for (const cat of categories) {
    await prisma.category.upsert({
      where: { slug: cat.slug },
      update: {},
      create: cat,
    });
  }
  console.log('✅ Categorias criadas');

  // Artista de exemplo
  const passwordHash = await bcrypt.hash('password123', 12);

  const artist = await prisma.user.upsert({
    where: { email: 'sofia@arthub.pt' },
    update: {},
    create: {
      email: 'sofia@arthub.pt',
      passwordHash,
      name: 'Sofia Mendes',
      accountType: 'ARTIST',
      isEmailVerified: true,
      artistProfile: {
        create: {
          artistName: 'Sofia Mendes',
          username: 'sofiam',
          bio: 'Pintora autodidacta baseada em Lisboa. O meu trabalho explora a relação entre geometria, espaço e silêncio.',
          city: 'Lisboa',
          country: 'Portugal',
          contactEmail: 'sofia@arthub.pt',
          isFeatured: true,
        },
      },
    },
    include: { artistProfile: true },
  });

  // Utilizador de exemplo
  await prisma.user.upsert({
    where: { email: 'user@arthub.pt' },
    update: {},
    create: {
      email: 'user@arthub.pt',
      passwordHash,
      name: 'João Comprador',
      accountType: 'USER',
      isEmailVerified: true,
    },
  });

  console.log('✅ Utilizadores de exemplo criados');
  console.log('');
  console.log('📧 Artista:    sofia@arthub.pt  |  password123');
  console.log('📧 Utilizador: user@arthub.pt   |  password123');
  console.log('');
  console.log('🎨 Seed concluído!');
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
