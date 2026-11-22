import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  bestSeatIdByView,
  computeViewQuality,
  labelInSpanish,
  seatCameraPose,
  viewScoreToLabel,
} from './view-quality.ts';

describe('view-quality', () => {
  describe('viewScoreToLabel', () => {
    it('umbrales 80 / 60 / 40', () => {
      assert.equal(viewScoreToLabel(80), 'excelente');
      assert.equal(viewScoreToLabel(79), 'buena');
      assert.equal(viewScoreToLabel(60), 'buena');
      assert.equal(viewScoreToLabel(59), 'lateral');
      assert.equal(viewScoreToLabel(40), 'lateral');
      assert.equal(viewScoreToLabel(39), 'lejana');
      assert.equal(viewScoreToLabel(0), 'lejana');
      assert.equal(viewScoreToLabel(100), 'excelente');
    });

    it('recorta fuera de 0–100', () => {
      assert.equal(viewScoreToLabel(-5), 'lejana');
      assert.equal(viewScoreToLabel(140), 'excelente');
    });
  });

  describe('labelInSpanish', () => {
    it('todas empiezan con Vista', () => {
      for (const label of ['excelente', 'buena', 'lateral', 'lejana'] as const) {
        assert.ok(labelInSpanish(label).startsWith('Vista '));
      }
    });
  });

  describe('computeViewQuality', () => {
    it('butaca de frente al escenario puntúa alto', () => {
      const q = computeViewQuality({
        seat: { x: 0, y: 100, rotationDeg: 0 },
        stage: { x: 0, y: 0 },
        maxDistance: 200,
      });
      assert.ok(q.score >= 60);
      assert.notEqual(q.label, 'lejana');
    });

    it('más lejos puntúa menos', () => {
      const near = computeViewQuality({
        seat: { x: 0, y: 40, rotationDeg: 0 },
        stage: { x: 0, y: 0 },
        maxDistance: 200,
      });
      const far = computeViewQuality({
        seat: { x: 0, y: 180, rotationDeg: 0 },
        stage: { x: 0, y: 0 },
        maxDistance: 200,
      });
      assert.ok(near.score > far.score);
    });

    it('blocked deja 0 y lejana', () => {
      const q = computeViewQuality({
        seat: { x: 0, y: 50, rotationDeg: 0 },
        stage: { x: 0, y: 0 },
        blocked: true,
      });
      assert.equal(q.score, 0);
      assert.equal(q.label, 'lejana');
    });

    it('occluded baja el puntaje', () => {
      const base = {
        seat: { x: 30, y: 80, rotationDeg: 0 },
        stage: { x: 0, y: 0 },
        maxDistance: 200,
      };
      const clear = computeViewQuality(base);
      const occluded = computeViewQuality({ ...base, occluded: true });
      assert.ok(clear.score > occluded.score);
    });

    it('restrictedView baja el puntaje', () => {
      const base = {
        seat: { x: 30, y: 80, rotationDeg: 0 },
        stage: { x: 0, y: 0 },
        maxDistance: 200,
      };
      const clear = computeViewQuality(base);
      const restricted = computeViewQuality({ ...base, restrictedView: true });
      assert.ok(clear.score > restricted.score);
    });
  });

  describe('seatCameraPose', () => {
    it('ojo a py+1.2, mira al escenario, fov 55', () => {
      const pose = seatCameraPose({ px: 2, py: 1, pz: 4 }, { x: 0, y: 0.8, z: -6 });
      assert.equal(pose.position.x, 2);
      assert.equal(pose.position.y, 2.2);
      assert.equal(pose.position.z, 4);
      assert.deepEqual(pose.lookAt, { x: 0, y: 0.8, z: -6 });
      assert.equal(pose.fov, 55);
    });

    it('respeta eyeHeight y fov', () => {
      const pose = seatCameraPose(
        { px: 0, py: 1, pz: 0 },
        { x: 0, y: 1, z: -2 },
        { eyeHeight: 1.6, fov: 60 }
      );
      assert.equal(pose.position.y, 2.6);
      assert.equal(pose.fov, 60);
    });
  });

  describe('bestSeatIdByView', () => {
    it('vacío → null', () => {
      assert.equal(bestSeatIdByView([]), null);
    });

    it('elige el mayor puntaje', () => {
      assert.equal(
        bestSeatIdByView([
          { seatId: 'a', score: 50 },
          { seatId: 'b', score: 90 },
          { seatId: 'c', score: 70 },
        ]),
        'b'
      );
    });

    it('empate → seatId menor por localeCompare', () => {
      assert.equal(
        bestSeatIdByView([
          { seatId: 'zeta', score: 80 },
          { seatId: 'alfa', score: 80 },
        ]),
        'alfa'
      );
    });
  });
});
