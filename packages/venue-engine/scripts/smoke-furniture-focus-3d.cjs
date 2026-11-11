const { resolveGeometry, projectTo3D } = require('../dist/index.js');

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

const map = {
  version: 3,
  sections: [
    {
      id: 's1',
      name: 'A',
      slug: 'a',
      color: '#5b9fd4',
      seats: [
        { id: 'a1', label: 'A1', x: 100, y: 120 },
        { id: 'a2', label: 'A2', x: 130, y: 120 },
      ],
    },
  ],
  venue: {
    scale: 40,
    stage: { x: 80, y: 20, width: 120, elevation: 40 },
    furniture: [
      { id: 'led1', type: 'led', x: 80, y: 40, rotation: 15 },
      { id: 'spk1', type: 'speaker', x: 40, y: 60 },
      { id: 'd1', type: 'door', x: 50, y: 50 },
    ],
    focusPoints: [
      { id: 'fp1', label: 'Centro', x: 100, y: 50, z: 60 },
      { id: 'fp2', label: 'Boca', x: 120, y: 30 },
    ],
  },
};

const scene = resolveGeometry(map);
assert(scene.furniture.length === 3, `furniture scene ${scene.furniture.length}`);
assert((scene.map.venue?.focusPoints ?? []).length === 2, 'focus on map');

const p3 = projectTo3D(scene);
assert(p3.furniture.length === 3, `3d furniture ${p3.furniture.length}`);
assert(p3.focusPoints.length === 2, `3d focus ${p3.focusPoints.length}`);

for (const f of p3.furniture) {
  assert(Array.isArray(f.position) && f.position.length === 3, `xyz ${f.id}`);
  assert(
    f.position.every((n) => Number.isFinite(n)),
    `finite ${f.id}`
  );
  assert(typeof f.type === 'string', `type ${f.id}`);
}

const led = p3.furniture.find((f) => f.id === 'led1');
const spk = p3.furniture.find((f) => f.id === 'spk1');
const door = p3.furniture.find((f) => f.id === 'd1');
assert(led && led.position[1] > spk.position[1], 'led higher than speaker');
assert(spk && spk.position[1] > door.position[1], 'speaker higher than door');

for (const fp of p3.focusPoints) {
  assert(Array.isArray(fp.position) && fp.position.length === 3, `focus xyz ${fp.id}`);
  assert(
    fp.position.every((n) => Number.isFinite(n)),
    `focus finite ${fp.id}`
  );
}

const fpAuthored = p3.focusPoints.find((f) => f.id === 'fp1');
const fpDefault = p3.focusPoints.find((f) => f.id === 'fp2');
assert(fpAuthored && fpDefault, 'both focus');
assert(fpAuthored.position[1] !== fpDefault.position[1], 'authored z differs from default');

const empty = projectTo3D(resolveGeometry({ version: 3, sections: [] }));
assert(empty.furniture.length === 0 && empty.focusPoints.length === 0, 'empty arrays');

console.log('FURNITURE_FOCUS_3D_SMOKE_OK', {
  furniture: p3.furniture.map((f) => ({ id: f.id, type: f.type, y: +f.position[1].toFixed(3) })),
  focus: p3.focusPoints.map((f) => ({ id: f.id, label: f.label, y: +f.position[1].toFixed(3) })),
});
