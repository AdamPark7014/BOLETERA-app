const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: 'postgresql://postgres:postgres@localhost:5432/boletera?schema=public&sslmode=disable',
    },
  },
});

(async () => {
  try {
    console.log('Testing connection...');
    await prisma.$connect();
    console.log('✓ Connection successful!');
    const result = await prisma.$queryRaw`SELECT version();`;
    console.log('Database version:', result[0].version);
  } catch (error) {
    console.error('✗ Connection failed:', error.message);
    console.error('Error code:', error.code);
  } finally {
    await prisma.$disconnect();
  }
})();
