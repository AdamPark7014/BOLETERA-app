/**
 * Lo MÍNIMO que cada job necesita de la base y del reloj.
 *
 * Los jobs no importan `@boletera/database`: importan estas formas. Así un test
 * puede ejercitar el barrido de holds con un doble en memoria, sin Postgres ni
 * cliente de Prisma generado — que es la razón por la que el worker no tenía un
 * solo test. `index.ts` es el único que conoce el `prisma` de verdad, y encaja
 * aquí de forma estructural.
 */

/** Un hold vencido tal y como lo devuelve el `UPDATE ... RETURNING` del barrido. */
export type ExpiredHold = {
  id: string;
  eventId: string;
  seatId: string | null;
  offerId: string | null;
  quantity: number;
};

/** Función de plantilla etiquetada, igual que `$queryRaw` / `$executeRaw`. */
export type TaggedQuery = <T = unknown>(
  strings: TemplateStringsArray,
  ...values: unknown[]
) => Promise<T>;

/** Cliente dentro de una transacción: sólo lo que usa el barrido. */
export type SweepTx = {
  $queryRaw: TaggedQuery;
  $executeRaw: TaggedQuery;
  ticket: {
    updateMany(args: {
      where: { eventId: string; seatId: { in: string[] }; status: string };
      data: { status: string };
    }): Promise<{ count: number }>;
  };
};

/** Cliente de base que necesita el job de holds. */
export type HoldsDb = {
  $transaction<T>(
    fn: (tx: SweepTx) => Promise<T>,
    options?: { timeout?: number; maxWait?: number },
  ): Promise<T>;
};

/** Cliente de base que necesita el job de liquidaciones. */
export type PayoutsDb = {
  promoterPayout: {
    findMany(args: { where: { status: string }; take: number }): Promise<Array<{ id: string }>>;
  };
};

/** Log inyectable: los tests capturan en vez de escribir en la consola. */
export type Logger = {
  info(message: string): void;
  error(message: string): void;
};

export const consoleLogger: Logger = {
  info: (message) => console.log(message),
  error: (message) => console.error(message),
};

/** Un job del worker: nombre para el log y una función sin argumentos. */
export type Job = {
  name: string;
  run: () => Promise<void>;
};
