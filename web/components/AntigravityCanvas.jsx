'use client';

import { useEffect, useRef } from 'react';

const PARTICLE_COLORS = [
  'rgba(255, 23, 68, 0.9)',
  'rgba(255, 23, 68, 0.6)',
  'rgba(255, 23, 68, 0.35)',
  'rgba(34, 211, 238, 0.55)',
  'rgba(125, 211, 252, 0.45)',
  'rgba(255, 255, 255, 0.6)',
  'rgba(255, 255, 255, 0.3)',
  'rgba(255, 60, 90, 0.5)',
];

function createParticle(w, h) {
  return {
    x: Math.random() * w,
    y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.45,
    vy: -Math.random() * 0.65 - 0.15,
    size: Math.random() * 2.6 + 0.8,
    color: PARTICLE_COLORS[Math.floor(Math.random() * PARTICLE_COLORS.length)],
    opacity: Math.random() * 0.75 + 0.25,
    life: 1,
    decay: Math.random() * 0.0008 + 0.0004,
  };
}

export default function AntigravityCanvas() {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const COUNT = 90;
    let particles = [];
    let raf;

    const resize = () => {
      canvas.width = window.innerWidth;
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    for (let i = 0; i < COUNT; i++) {
      particles.push(createParticle(canvas.width, canvas.height));
    }

    const draw = () => {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= p.decay;

        if (p.y < -10 || p.life <= 0 || p.x < -10 || p.x > canvas.width + 10) {
          particles[i] = createParticle(canvas.width, canvas.height);
          particles[i].y = canvas.height + 10;
          continue;
        }

        ctx.globalAlpha = p.opacity * p.life;
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, 6.283);
        ctx.fill();
      }

      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(draw);
    };

    draw();

    return () => {
      window.removeEventListener('resize', resize);
      cancelAnimationFrame(raf);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        width: '100%',
        height: '100%',
        pointerEvents: 'none',
        zIndex: 0,
      }}
    />
  );
}
