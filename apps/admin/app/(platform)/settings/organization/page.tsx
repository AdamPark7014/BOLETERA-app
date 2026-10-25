'use client';

import { Suspense } from 'react';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { OrganizacionBody } from './OrganizacionSection';

export default function OrganizationPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <OrganizacionBody />
      </AdminFrame>
    </Suspense>
  );
}
