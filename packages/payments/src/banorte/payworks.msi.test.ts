import assert from 'node:assert/strict';
import { afterEach, describe, it } from 'node:test';

/** Espejo de buildPayworksMsiFields (payworks.ts) para node:test sin resolver imports TS. */
function buildPayworksMsiFields(installments) {
  if (installments == null || installments <= 1) return {};
  const plan = process.env.BANORTE_MSI_FIELD_PLAN ?? 'NUMERO_MENSUALIDADES';
  const promo = process.env.BANORTE_MSI_FIELD_PROMO ?? 'PROMOCION';
  const promoValue = process.env.BANORTE_MSI_PROMO_VALUE ?? 'MSI';
  return { [plan]: String(installments), [promo]: promoValue };
}

describe('buildPayworksMsiFields', () => {
  const prevPlan = process.env.BANORTE_MSI_FIELD_PLAN;
  const prevPromo = process.env.BANORTE_MSI_FIELD_PROMO;
  const prevValue = process.env.BANORTE_MSI_PROMO_VALUE;

  afterEach(() => {
    if (prevPlan === undefined) delete process.env.BANORTE_MSI_FIELD_PLAN;
    else process.env.BANORTE_MSI_FIELD_PLAN = prevPlan;
    if (prevPromo === undefined) delete process.env.BANORTE_MSI_FIELD_PROMO;
    else process.env.BANORTE_MSI_FIELD_PROMO = prevPromo;
    if (prevValue === undefined) delete process.env.BANORTE_MSI_PROMO_VALUE;
    else process.env.BANORTE_MSI_PROMO_VALUE = prevValue;
  });

  it('vacio si es de contado', () => {
    assert.deepEqual(buildPayworksMsiFields(undefined), {});
    assert.deepEqual(buildPayworksMsiFields(1), {});
  });

  it('usa defaults documentados', () => {
    delete process.env.BANORTE_MSI_FIELD_PLAN;
    delete process.env.BANORTE_MSI_FIELD_PROMO;
    delete process.env.BANORTE_MSI_PROMO_VALUE;
    assert.deepEqual(buildPayworksMsiFields(3), {
      NUMERO_MENSUALIDADES: '3',
      PROMOCION: 'MSI',
    });
  });

  it('respeta BANORTE_MSI_FIELD_*', () => {
    process.env.BANORTE_MSI_FIELD_PLAN = 'PLAZO';
    process.env.BANORTE_MSI_FIELD_PROMO = 'TIPO_PROMO';
    process.env.BANORTE_MSI_PROMO_VALUE = '3MSI';
    assert.deepEqual(buildPayworksMsiFields(6), {
      PLAZO: '6',
      TIPO_PROMO: '3MSI',
    });
  });
});
