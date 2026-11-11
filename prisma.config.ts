/**
 * Prisma Configuration for Boletera Platform (Prisma 7+)
 *
 * Datasource configuration moved from schema.prisma per Prisma 7 migration guide:
 * @see https://pris.ly/d/config-datasource
 */

import { defineConfig } from '@prisma/internals';

export default defineConfig({
  datasources: {
    db: {
      url: process.env.DATABASE_URL || 'postgresql://postgres:password@localhost:5432/boletera',
    },
  },
});
