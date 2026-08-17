'use client';

/**
 * Gestión de API — reutiliza el contrato real de partners/API keys.
 * No hay telemetría de gateway aún: el “uso” se deriva de lastUsedAt / rateLimit.
 */
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';
import {
  useApiKeys,
  useCreateApiKey,
  useRevokeApiKey,
  type ApiKey,
} from './partners';

export type { ApiKey };

export type CreateApiKeyInput = {
  name: string;
  scopes?: string[];
  rateLimit?: number;
  expiresInDays?: number;
};

export type CreatedApiKey = {
  id: string;
  secret: string;
  keyPrefix: string;
};

/** Resumen de uso derivado client-side (sin series de gateway). */
export type ApiUsageSummary = {
  organizationId: string;
  activeKeys: number;
  usedIn24h: number;
  usedIn7d: number;
  idleActive: number;
  writeCapable: number;
  avgRateLimit: number;
  rotationDue: number;
  source: 'derived-from-keys';
  note: string;
};

const DAY_MS = 24 * 60 * 60 * 1000;
const ROTATION_WARN_MS = 90 * DAY_MS;

function deriveUsage(keys: readonly ApiKey[], now: number): Omit<ApiUsageSummary, 'organizationId'> {
  const active = keys.filter((key) => key.active);
  let usedIn24h = 0;
  let usedIn7d = 0;
  let idleActive = 0;
  let writeCapable = 0;
  let rotationDue = 0;
  let rateSum = 0;

  for (const key of active) {
    rateSum += key.rateLimit;
    if (key.scopes.some((scope) => scope === '*' || scope.startsWith('write:'))) {
      writeCapable += 1;
    }

    const created = new Date(key.createdAt).getTime();
    if (!Number.isNaN(created) && now - created >= ROTATION_WARN_MS) {
      rotationDue += 1;
    }

    if (!key.lastUsedAt) {
      idleActive += 1;
      continue;
    }
    const last = new Date(key.lastUsedAt).getTime();
    if (Number.isNaN(last)) {
      idleActive += 1;
      continue;
    }
    const age = now - last;
    if (age < DAY_MS) usedIn24h += 1;
    if (age < 7 * DAY_MS) usedIn7d += 1;
    else idleActive += 1;
  }

  return {
    activeKeys: active.length,
    usedIn24h,
    usedIn7d,
    idleActive,
    writeCapable,
    avgRateLimit: active.length > 0 ? Math.round(rateSum / active.length) : 0,
    rotationDue,
    source: 'derived-from-keys',
    note: 'Sin telemetría de gateway: uso estimado a partir de lastUsedAt y antigüedad de la clave.',
  };
}

export function useApiManagementKeys(organizationId: string | null) {
  return useApiKeys(organizationId);
}

export function useCreateManagedApiKey(organizationId: string) {
  return useCreateApiKey(organizationId);
}

export function useRevokeManagedApiKey(organizationId: string) {
  return useRevokeApiKey(organizationId);
}

/**
 * Rotación segura: emite clave nueva con los mismos scopes/límites y revoca la anterior.
 * El secreto nuevo solo viaja en la respuesta de creación (una vez).
 */
export function useRotateManagedApiKey(organizationId: string) {
  const client = useQueryClient();
  const create = useCreateApiKey(organizationId);
  const revoke = useRevokeApiKey(organizationId);

  return useMutation({
    mutationFn: async (key: ApiKey): Promise<CreatedApiKey> => {
      const created = await create.mutateAsync({
        name: key.name,
        scopes: key.scopes,
        rateLimit: key.rateLimit,
      });
      try {
        await revoke.mutateAsync(key.id);
      } catch (error) {
        // La nueva clave ya existe; el operador debe revocar la antigua manualmente.
        throw new Error(
          error instanceof Error
            ? `Clave nueva emitida (${created.keyPrefix}…), pero no se pudo revocar la anterior: ${error.message}`
            : `Clave nueva emitida (${created.keyPrefix}…), pero no se pudo revocar la anterior.`,
        );
      }
      return created;
    },
    onSettled: () => {
      void client.invalidateQueries({
        queryKey: queryKeys.apiManagement.keys(organizationId),
      });
    },
  });
}

/** Uso derivado de las claves cargadas; no llama a un endpoint de usage. */
export function useApiUsageSummary(organizationId: string | null, now = Date.now()) {
  const keysQuery = useApiKeys(organizationId);

  return useQuery({
    queryKey: [
      ...queryKeys.apiManagement.usage(organizationId ?? ''),
      keysQuery.dataUpdatedAt,
      Math.floor(now / 60_000),
    ],
    queryFn: (): ApiUsageSummary => {
      const derived = deriveUsage(keysQuery.data ?? [], now);
      return {
        organizationId: organizationId ?? '',
        ...derived,
      };
    },
    enabled: Boolean(organizationId) && !keysQuery.isPending && !keysQuery.isError,
    staleTime: 30_000,
  });
}

/** Perfiles de cuota sugeridos (plantillas locales; PUT /api-management/quotas aún no existe). */
export type QuotaTemplate = {
  id: string;
  name: string;
  rpm: number;
  burst: number;
  environment: 'sandbox' | 'production';
  description: string;
};

export const QUOTA_TEMPLATES: readonly QuotaTemplate[] = [
  {
    id: 'standard',
    name: 'Cuota estándar',
    rpm: 1_000,
    burst: 1_500,
    environment: 'production',
    description: 'Integradores de lectura con picos moderados.',
  },
  {
    id: 'partner',
    name: 'Cuota partner',
    rpm: 3_000,
    burst: 5_000,
    environment: 'production',
    description: 'Partners con sincronización de inventario y órdenes.',
  },
  {
    id: 'sandbox',
    name: 'Sandbox',
    rpm: 200,
    burst: 400,
    environment: 'sandbox',
    description: 'Pruebas sin datos productivos. Nunca mezclar con llaves live.',
  },
] as const;

export function useQuotaTemplates() {
  return useQuery({
    queryKey: queryKeys.apiManagement.quotas('templates'),
    queryFn: async (): Promise<readonly QuotaTemplate[]> => QUOTA_TEMPLATES,
    staleTime: Infinity,
  });
}

/** Bajo nivel por si se necesita invalidar fuera de los hooks envueltos. */
export function useInvalidateApiKeys(organizationId: string) {
  const client = useQueryClient();
  return () =>
    client.invalidateQueries({
      queryKey: queryKeys.apiManagement.keys(organizationId),
    });
}

export async function createApiKeyDirect(
  organizationId: string,
  body: CreateApiKeyInput,
): Promise<CreatedApiKey> {
  return http<CreatedApiKey>(`/partners/${organizationId}/keys`, {
    method: 'POST',
    body,
  });
}
