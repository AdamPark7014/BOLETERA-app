'use client';

import { useEffect } from 'react';

/**
 * Registra el service worker que da el modo sin conexión de taquilla.
 *
 * EN DESARROLLO NO SE REGISTRA, y además se desregistra el que hubiera.
 *
 * El service worker sirve los chunks de Next con estrategia «caché primero»
 * porque en producción llevan huella en el nombre y son inmutables. En
 * desarrollo Turbopack REUTILIZA esos nombres entre reconstrucciones, así que
 * esa misma estrategia sirve código viejo indefinidamente: cambiar una variable
 * de entorno, reiniciar el servidor y borrar `.next` no surtía ningún efecto
 * visible, porque la respuesta ni siquiera llegaba a salir del navegador.
 *
 * Cuesta horas de diagnóstico, así que en dev se limpia sin contemplaciones.
 */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    if (process.env.NODE_ENV !== 'production') {
      void navigator.serviceWorker.getRegistrations().then((registrations) => {
        for (const registration of registrations) void registration.unregister();
      });
      // Las cachés sobreviven al desregistro: hay que vaciarlas aparte.
      if (typeof caches !== 'undefined') {
        void caches.keys().then((keys) => {
          for (const key of keys) {
            if (key.startsWith('boletera-taquilla')) void caches.delete(key);
          }
        });
      }
      return;
    }

    void navigator.serviceWorker.register('/sw.js').catch(() => {});
  }, []);

  return null;
}
