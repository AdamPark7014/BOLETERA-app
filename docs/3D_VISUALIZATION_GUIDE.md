# 3D VENUE VISUALIZATION WITH THREE.JS

> **Interactive 3D Seat Maps & Occupancy Heatmaps**
>
> Implementación de visualización 3D para BOLETERA

---

## 📐 THREE.JS SETUP

### **Installation**

```bash
cd apps/web
pnpm add three @types/three drei
```

### **Component Structure**

```typescript
// apps/web/components/Venue3D.tsx

'use client';

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { useGet3DVisualization, useGetOccupancyHeatmap } from '@/packages/ui/hooks';

interface Venue3DProps {
  layoutId: string;
  eventId: string;
  basePrice: number;
  onSeatSelect: (seatId: string) => void;
}

export default function Venue3D({ layoutId, eventId, basePrice, onSeatSelect }: Venue3DProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<THREE.Scene | null>(null);
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const rendererRef = useRef<THREE.WebGLRenderer | null>(null);
  const seatsRef = useRef<Map<string, THREE.Mesh>>(new Map());

  const { data: viz3d } = useGet3DVisualization(layoutId, eventId);
  const { data: heatmap } = useGetOccupancyHeatmap(layoutId, eventId);

  useEffect(() => {
    if (!containerRef.current || !viz3d?.data) return;

    // Initialize Three.js Scene
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f5f9);
    sceneRef.current = scene;

    // Camera Setup
    const camera = new THREE.PerspectiveCamera(
      75,
      containerRef.current.clientWidth / containerRef.current.clientHeight,
      0.1,
      1000
    );
    camera.position.set(0, 15, 25);
    camera.lookAt(0, 0, 0);
    cameraRef.current = camera;

    // Renderer Setup
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(containerRef.current.clientWidth, containerRef.current.clientHeight);
    renderer.shadowMap.enabled = true;
    containerRef.current.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    // Lighting
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(10, 20, 10);
    directionalLight.castShadow = true;
    scene.add(directionalLight);

    // Stage/Field Geometry (Elliptical)
    const stageGeometry = new THREE.EllipseGeometry(25, 40, 32);
    const stageMaterial = new THREE.MeshPhongMaterial({ color: 0xff6b35, shininess: 100 });
    const stage = new THREE.Mesh(stageGeometry, stageMaterial);
    stage.position.y = 0.1;
    scene.add(stage);

    // Create Seats from API Data
    createSeats(scene, viz3d.data, heatmap?.data);

    // Mouse Controls
    setupMouseControls(camera, renderer, scene);

    // Animation Loop
    const animate = () => {
      requestAnimationFrame(animate);
      renderer.render(scene, camera);
    };
    animate();

    // Handle Window Resize
    const handleResize = () => {
      if (!containerRef.current) return;
      const width = containerRef.current.clientWidth;
      const height = containerRef.current.clientHeight;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    };
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      containerRef.current?.removeChild(renderer.domElement);
    };
  }, [viz3d, heatmap]);

  const createSeats = (
    scene: THREE.Scene,
    vizData: any,
    heatmapData?: any
  ) => {
    const sections = vizData.sections || [];

    sections.forEach((section: any) => {
      section.seats?.forEach((seat: any) => {
        // Seat Geometry (Small cube)
        const seatGeometry = new THREE.BoxGeometry(0.4, 0.3, 0.4);

        // Determine Color Based on Status
        let color = 0x10b981; // Available - Green
        if (seat.status === 'sold') color = 0xa1a1a1; // Sold - Gray
        if (seat.status === 'held') color = 0xfbbf24; // Held - Yellow
        if (seat.status === 'premium') color = 0x3b82f6; // Premium - Blue

        // Dynamically adjust for occupancy heatmap
        if (heatmapData?.sections) {
          const heatSection = heatmapData.sections.find((s: any) => s.id === section.id);
          if (heatSection && heatSection.occupancyPercentage > 80) {
            // Hot zone - red tint
            color = 0xef4444;
          }
        }

        const seatMaterial = new THREE.MeshPhongMaterial({
          color,
          shininess: 30,
          emissive: color,
          emissiveIntensity: 0.3,
        });

        const seatMesh = new THREE.Mesh(seatGeometry, seatMaterial);
        seatMesh.position.set(seat.x, seat.y, seat.z);
        seatMesh.castShadow = true;
        seatMesh.receiveShadow = true;

        // Add metadata
        (seatMesh as any).seatId = seat.id;
        (seatMesh as any).seatData = seat;

        // Click Interaction
        seatMesh.addEventListener('click', () => {
          if (seat.status === 'available') {
            onSeatSelect(seat.id);
            // Highlight selected seat
            seatMaterial.color.setHex(0x2563eb);
            seatMaterial.emissiveIntensity = 0.6;
          }
        });

        seatsRef.current?.set(seat.id, seatMesh);
        scene.add(seatMesh);
      });
    });
  };

  const setupMouseControls = (
    camera: THREE.PerspectiveCamera,
    renderer: THREE.WebGLRenderer,
    scene: THREE.Scene
  ) => {
    const raycaster = new THREE.Raycaster();
    const mouse = new THREE.Vector2();

    // Rotation on mouse drag
    let isDragging = false;
    let previousMousePosition = { x: 0, y: 0 };

    renderer.domElement.addEventListener('mousedown', (e) => {
      isDragging = true;
      previousMousePosition = { x: e.clientX, y: e.clientY };
    });

    renderer.domElement.addEventListener('mousemove', (e) => {
      if (isDragging) {
        const deltaX = e.clientX - previousMousePosition.x;
        const deltaY = e.clientY - previousMousePosition.y;

        camera.position.applyAxisAngle(new THREE.Vector3(0, 1, 0), deltaX * 0.01);
        camera.position.applyAxisAngle(
          new THREE.Vector3(1, 0, 0),
          deltaY * 0.01
        );
        camera.lookAt(scene.position);
      }

      // Hover detection
      mouse.x = (e.clientX / renderer.domElement.clientWidth) * 2 - 1;
      mouse.y = -(e.clientY / renderer.domElement.clientHeight) * 2 + 1;

      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects(scene.children);

      if (intersects.length > 0) {
        const hovered = intersects[0].object as any;
        if (hovered.seatData) {
          // Show tooltip
          console.log(`Hovering: ${hovered.seatData.row}${hovered.seatData.number} - $${hovered.seatData.price}`);
        }
      }
    });

    renderer.domElement.addEventListener('mouseup', () => {
      isDragging = false;
    });

    // Scroll to zoom
    renderer.domElement.addEventListener('wheel', (e) => {
      e.preventDefault();
      camera.position.z += e.deltaY * 0.05;
    });
  };

  return (
    <div className="w-full h-full">
      <div ref={containerRef} style={{ width: '100%', height: '600px' }} />
      <div className="mt-4 bg-slate-50 p-4 rounded-lg">
        <p className="text-sm text-slate-700">
          💡 <strong>Controls:</strong> Drag to rotate • Scroll to zoom • Click seats to select
        </p>
      </div>
    </div>
  );
}
```

---

## 🎨 OCCUPANCY HEATMAP ALGORITHM

```typescript
// Calculate real-time occupancy heatmaps per section

export function calculateOccupancyHeatmap(
  layoutId: string,
  eventId: string,
  sections: SeatSection[]
) {
  const heatmap = sections.map((section) => {
    const totalSeats = section.seats.length;
    const soldSeats = section.seats.filter(s => s.status === 'sold').length;
    const heldSeats = section.seats.filter(s => s.status === 'held').length;

    const occupancyPercentage = ((soldSeats + heldSeats) / totalSeats) * 100;

    // Determine color zone
    let zone: 'cold' | 'warm' | 'hot' | 'critical';
    if (occupancyPercentage < 30) zone = 'cold';
    else if (occupancyPercentage < 60) zone = 'warm';
    else if (occupancyPercentage < 85) zone = 'hot';
    else zone = 'critical';

    return {
      id: section.id,
      name: section.name,
      occupancyPercentage,
      zone,
      totalSeats,
      availableSeats: totalSeats - soldSeats - heldSeats,
      color: {
        cold: 0x10b981,     // Green
        warm: 0xf59e0b,     // Yellow
        hot: 0xef4444,      // Red
        critical: 0x7c2d12, // Dark Red
      }[zone],
    };
  });

  return heatmap;
}
```

---

## 🔗 SIGHTLINE CALCULATION

**Sightline Score = Proximity Factor (60%) + Height Factor (40%)**

```typescript
export function calculateSightlineScore(
  seat: Seat,
  stageCenter: Point3D,
  venueCapacity: number
): number {
  // Distance from seat to stage center
  const distanceFromStage = Math.sqrt(
    Math.pow(seat.x - stageCenter.x, 2) +
    Math.pow(seat.z - stageCenter.z, 2)
  );

  // Normalize distance (0-100, where 100 is best)
  const maxDistance = Math.sqrt(venueCapacity) / 2;
  const proximityScore = Math.max(0, 100 - (distanceFromStage / maxDistance) * 100);

  // Height advantage (VIP seats get boost)
  const heightFactor = seat.y > 5 ? 30 : (seat.y / 5) * 30;

  // Combined score
  const sightlineScore = proximityScore * 0.6 + heightFactor * 0.4;

  return Math.round(sightlineScore);
}
```

---

## 💾 3D RENDERING PERFORMANCE TIPS

1. **Level of Detail (LOD)** - Use simpler geometry when zoomed out
2. **Instancing** - Render thousands of seats efficiently
3. **Frustum Culling** - Only render visible seats
4. **Baking** - Pre-compute shadows for static geometry
5. **Offscreen Rendering** - Use texture rendering for mini-map

```typescript
// Example: LOD Implementation
const lodGeometries = {
  high: new THREE.BoxGeometry(0.4, 0.3, 0.4, 8, 6, 8),
  medium: new THREE.BoxGeometry(0.4, 0.3, 0.4, 4, 3, 4),
  low: new THREE.BoxGeometry(0.4, 0.3, 0.4, 1, 1, 1),
};

function updateLOD(camera: THREE.PerspectiveCamera, seats: THREE.Mesh[]) {
  seats.forEach((seat) => {
    const distance = camera.position.distanceTo(seat.position);
    const lod = distance > 50 ? 'low' : distance > 20 ? 'medium' : 'high';
    // Update seat.geometry based on LOD
  });
}
```

---

## 🎯 INTERACTIVE FEATURES

### **Seat Tooltips**
```typescript
// Show sightline score, price, and accessibility on hover
{
  row: 'A',
  number: '42',
  price: '$185.00',
  sightlineScore: 87,
  accessibility: 'Wheelchair accessible',
  soldOut: false
}
```

### **Seat Filtering**
```typescript
// Filter seats by criteria
const filterSeats = (
  seats: Seat[],
  filters: {
    maxPrice?: number;
    minSightline?: number;
    accessibility?: boolean;
    nearStage?: boolean;
  }
) => {
  return seats.filter(
    (s) =>
      (!filters.maxPrice || s.price <= filters.maxPrice) &&
      (!filters.minSightline || s.sightlineScore >= filters.minSightline) &&
      (!filters.accessibility || s.isAccessible) &&
      (!filters.nearStage || s.distanceFromStage < 30)
  );
};
```

---

## 📱 MOBILE OPTIMIZATION

```typescript
// Detect if on mobile and use 2D fallback
const isMobile = /Mobile|Android|iPhone/.test(navigator.userAgent);

if (isMobile) {
  // Use 2D SeatSelection component instead
  return <SeatSelection2D layoutId={layoutId} />;
}

// Use 3D visualization for desktop
return <Venue3D layoutId={layoutId} />;
```

---

## ✅ INTEGRATION CHECKLIST

- [ ] Three.js installed and imported
- [ ] Scene initialized with proper lighting
- [ ] Seats rendered from API data
- [ ] Mouse controls working (rotate, zoom)
- [ ] Click detection for seat selection
- [ ] Occupancy heatmap color coding
- [ ] Sightline scores displayed on hover
- [ ] Mobile detection with 2D fallback
- [ ] Performance optimized (60 FPS)
- [ ] Accessibility features (keyboard nav)

---

**Next: Integrate with SeatSelection component to replace placeholder 3D area.**
