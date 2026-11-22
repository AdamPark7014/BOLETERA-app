'use client';

import type { ReactNode } from 'react';
import styles from './Venue3DMount.module.scss';

/** Contenedor del showcase 3D; el visor real vive en @boletera/venue-3d. */
export function Venue3DMount({ children }: { children?: ReactNode }) {
  return <div className={styles.root}>{children}</div>;
}
