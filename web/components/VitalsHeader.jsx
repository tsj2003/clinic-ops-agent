'use client';

import { useEffect, useState } from 'react';

function metric(value, suffix = '') {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return `0${suffix}`;
  }
  return `${numeric}${suffix}`;
}

export default function VitalsHeader() {
  const [vitals, setVitals] = useState(null);
  const [error, setError] = useState('');

  const loadVitals = async () => {
    try {
      setError('');
      const response = await fetch('/api/observability/vitals?hours=72&limit=800', {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load vitals.');
      }
      setVitals(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load vitals.');
    }
  };

  useEffect(() => {
    void loadVitals();
    const timer = setInterval(() => {
      void loadVitals();
    }, 20_000);

    return () => clearInterval(timer);
  }, []);

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Vitals</p>
          <p className="mt-1 text-sm text-slate-300">Live ROI impact from agent observability events.</p>
        </div>
        <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-cyan-100">
          {vitals?.source === 'axiom' ? 'Axiom Live' : 'Fallback'}
        </span>
      </div>

      {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Average TAT</p>
          <p className="mt-1 text-xl font-semibold text-white">{metric(vitals?.averageTatHours, 'h')}</p>
          <p className="mt-1 text-[11px] text-slate-400">Target &lt; 26h</p>
        </div>

        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Labor Efficiency</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{metric(vitals?.totalEightMinuteBlocksSaved)}</p>
          <p className="mt-1 text-[11px] text-slate-400">8-minute blocks saved</p>
        </div>

        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Unit Margins</p>
          <p className="mt-1 text-xl font-semibold text-cyan-200">${metric(vitals?.fireworksSavingsUsd)}</p>
          <p className="mt-1 text-[11px] text-slate-400">Fireworks vs GPT-4o savings</p>
        </div>
      </div>
    </div>
  );
}
