'use client';

import { createContext, useContext, type ReactNode } from 'react';

export type TenantBrand = {
  name: string;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  secondaryColor?: string | null;
};

const DEFAULT_BRAND: TenantBrand = { name: 'BOLETERA' };

const TenantBrandContext = createContext<TenantBrand>(DEFAULT_BRAND);

export function TenantBrandProvider({
  value,
  children,
}: {
  value: TenantBrand;
  children: ReactNode;
}) {
  return (
    <TenantBrandContext.Provider value={value}>{children}</TenantBrandContext.Provider>
  );
}

export function useTenantBrand(): TenantBrand {
  return useContext(TenantBrandContext);
}
