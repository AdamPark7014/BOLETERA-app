'use client';

import { Suspense } from 'react';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { MarcaBody } from '../branding/MarcaSection';

export default function ContentPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <MarcaBody />
      </AdminFrame>
    </Suspense>
  );
}
