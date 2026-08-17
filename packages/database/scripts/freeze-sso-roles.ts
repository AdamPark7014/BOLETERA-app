/**
 * freeze-sso-roles.ts — Migración de datos para F2-02.
 *
 * CONTEXTO
 * Hasta ahora, entrar por SSO (Google/Microsoft) creaba al usuario como
 * PROMOTER y promovía a PROMOTER a cualquier CUSTOMER existente. Es decir: el
 * rol privilegiado de una parte del personal actual no tiene detrás ninguna
 * decisión explícita, sólo el bug. A partir del despliegue, la única vía de
 * elevación es una `OrgInvitation` viva.
 *
 * QUÉ HACE
 * Recorre los usuarios con rol distinto de CUSTOMER y `provider <> 'email'`
 * (es decir, los que llegaron por SSO) y les fabrica una `OrgInvitation` YA
 * ACEPTADA en su organización actual. Así el rol que hoy ostentan queda
 * respaldado por un registro explícito y auditable, y una limpieza posterior
 * del tipo "revoca todo privilegio sin invitación" no expulsa a los promotores
 * legítimos.
 *
 * NO cambia el rol de nadie: sólo deja el rastro documental. El código nuevo
 * tampoco degrada a los usuarios existentes, así que este script es una red de
 * seguridad, no un requisito para que sigan entrando.
 *
 * SEGURIDAD DE EJECUCIÓN
 * - Modo `--dry-run` POR DEFECTO: sin `--apply` no escribe nada.
 * - Idempotente: si ya existe invitación para (organizationId, email) no la
 *   duplica; si existe pero pendiente, la marca como aceptada.
 *
 * USO
 *   pnpm --filter @boletera/database exec tsx scripts/freeze-sso-roles.ts
 *   pnpm --filter @boletera/database exec tsx scripts/freeze-sso-roles.ts --apply
 */

import { PrismaClient, UserRole } from '@prisma/client';

const prisma = new PrismaClient();

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const VERBOSE = args.includes('--verbose');

type Outcome = 'CREATED' | 'MARKED_ACCEPTED' | 'ALREADY_FROZEN' | 'ORPHAN_NO_ORG';

interface Row {
  outcome: Outcome;
  email: string;
  role: UserRole;
  provider: string | null;
  organizationId: string | null;
}

async function main() {
  console.log(
    `\n[freeze-sso-roles] modo: ${APPLY ? 'APPLY (escribe en la base)' : 'DRY-RUN (no escribe nada)'}\n`,
  );

  const users = await prisma.user.findMany({
    where: {
      role: { not: UserRole.CUSTOMER },
      // `provider` nulo también cuenta como "no email": son cuentas cuyo origen
      // no podemos atribuir a un alta con contraseña, así que las congelamos.
      NOT: { provider: 'email' },
    },
    select: {
      id: true,
      email: true,
      role: true,
      provider: true,
      organizationId: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  console.log(`Usuarios con rol privilegiado llegados por SSO: ${users.length}`);

  const rows: Row[] = [];
  const now = new Date();

  for (const user of users) {
    const email = user.email.toLowerCase();

    if (!user.organizationId) {
      // OrgInvitation.organizationId es obligatorio: sin organización no hay
      // invitación que fabricar. Son cuentas privilegiadas huérfanas — el bug
      // les dio rol pero nunca tenant — y requieren decisión humana.
      rows.push({
        outcome: 'ORPHAN_NO_ORG',
        email,
        role: user.role,
        provider: user.provider,
        organizationId: null,
      });
      continue;
    }

    const existing = await prisma.orgInvitation.findUnique({
      where: { organizationId_email: { organizationId: user.organizationId, email } },
    });

    if (existing?.acceptedAt) {
      rows.push({
        outcome: 'ALREADY_FROZEN',
        email,
        role: user.role,
        provider: user.provider,
        organizationId: user.organizationId,
      });
      continue;
    }

    if (existing) {
      // Había invitación pendiente y el usuario ya ostenta el rol: la cerramos.
      if (APPLY) {
        await prisma.orgInvitation.update({
          where: { id: existing.id },
          data: { acceptedAt: now, acceptedByUserId: user.id, role: user.role },
        });
      }
      rows.push({
        outcome: 'MARKED_ACCEPTED',
        email,
        role: user.role,
        provider: user.provider,
        organizationId: user.organizationId,
      });
      continue;
    }

    if (APPLY) {
      await prisma.orgInvitation.create({
        data: {
          organizationId: user.organizationId,
          email,
          role: user.role,
          // Nace aceptada y con caducidad en el pasado inmediato: nunca podrá
          // confundirse con una invitación viva (acceptedAt = null y
          // expiresAt > now) y reutilizarse para elevar a nadie más.
          expiresAt: now,
          acceptedAt: now,
          acceptedByUserId: user.id,
        },
      });
    }
    rows.push({
      outcome: 'CREATED',
      email,
      role: user.role,
      provider: user.provider,
      organizationId: user.organizationId,
    });
  }

  const tally = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
    return acc;
  }, {});

  console.log('\n--- Resumen ---');
  console.log(`  CREATED          ${tally.CREATED ?? 0}  invitación aceptada creada`);
  console.log(`  MARKED_ACCEPTED  ${tally.MARKED_ACCEPTED ?? 0}  invitación pendiente cerrada`);
  console.log(`  ALREADY_FROZEN   ${tally.ALREADY_FROZEN ?? 0}  ya tenía respaldo (idempotencia)`);
  console.log(`  ORPHAN_NO_ORG    ${tally.ORPHAN_NO_ORG ?? 0}  ¡REVISIÓN MANUAL!`);

  const orphans = rows.filter((row) => row.outcome === 'ORPHAN_NO_ORG');
  if (orphans.length) {
    console.log(
      '\nCuentas con rol privilegiado y SIN organización (el SSO les dio rol pero',
    );
    console.log('nunca tenant). Asígnales organización o degrádalas a CUSTOMER:');
    for (const orphan of orphans) {
      console.log(`  - ${orphan.email}  role=${orphan.role}  provider=${orphan.provider ?? 'null'}`);
    }
  }

  if (VERBOSE) {
    console.log('\n--- Detalle ---');
    for (const row of rows) {
      console.log(
        `  [${row.outcome}] ${row.email} role=${row.role} org=${row.organizationId ?? '-'} provider=${row.provider ?? 'null'}`,
      );
    }
  }

  if (!APPLY) {
    console.log('\nDRY-RUN: no se escribió nada. Repite con --apply para persistir.\n');
  } else {
    console.log('\nHecho.\n');
  }
}

main()
  .catch((error) => {
    console.error('[freeze-sso-roles] falló:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
