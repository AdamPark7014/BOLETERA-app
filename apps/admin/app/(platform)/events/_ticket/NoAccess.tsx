import Link from 'next/link';
import styles from './frame.module.scss';

/** Estado «sin permiso»: explica por qué no se ve y ofrece una salida. */
export function NoAccess() {
  return (
    <span className={styles.noAccess}>
      <span className={styles.quiet}>
        Tu rol no tiene acceso a esta pantalla. Si la necesitas, pídela a quien administra tu
        organización.
      </span>
      <Link href="/dashboard" className={styles.ghostLink}>
        Volver al inicio
      </Link>
    </span>
  );
}
