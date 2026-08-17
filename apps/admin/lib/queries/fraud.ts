'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { http } from '../http';
import { queryKeys } from '../query-keys';

export type FraudFlag = {
  id: string;
  type: string;
  severity: string;
  score: number;
  reason: string;
  status: string;
};

export function useFraudFlags(limit = 50) {
  return useQuery({
    queryKey: queryKeys.fraud.flags(limit),
    queryFn: async ({ signal }) => {
      const result = await http<{ data: FraudFlag[] } | FraudFlag[]>(
        `/fraud/flags?limit=${limit}`,
        { signal },
      );
      return Array.isArray(result) ? result : result.data;
    },
  });
}

export function useResolveFraudFlag(limit = 50) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ flagId, resolution }: { flagId: string; resolution: string }) =>
      http(`/fraud/flags/${flagId}/resolve`, {
        method: 'POST',
        body: { resolution },
      }),
    onMutate: async ({ flagId }) => {
      const key = queryKeys.fraud.flags(limit);
      await client.cancelQueries({ queryKey: key });
      const previous = client.getQueryData<FraudFlag[]>(key);
      client.setQueryData<FraudFlag[]>(key, (flags) =>
        flags?.map((flag) =>
          flag.id === flagId ? { ...flag, status: 'RESOLVED' } : flag,
        ),
      );
      return { previous };
    },
    onError: (_error, _input, context) =>
      client.setQueryData(queryKeys.fraud.flags(limit), context?.previous),
    onSettled: () =>
      client.invalidateQueries({ queryKey: queryKeys.fraud.flags(limit) }),
  });
}
