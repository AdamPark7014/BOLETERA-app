'use client';

import { Suspense } from 'react';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { MarcaBody } from './MarcaSection';

export default function BrandingPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <MarcaBody />
      </AdminFrame>
    </Suspense>
  );
}
