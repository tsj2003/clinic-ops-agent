export default function ConfidenceMeter({ value, trendText = '', trend = 'neutral' }) {
  const clamped = Math.max(0, Math.min(100, value));
  const isDrop = trend === 'down';
  const isRecovery = trend === 'up';

  return (
    <div
      className={`glass-panel rounded-2xl p-4 transition-all duration-500 ${
        isDrop
          ? 'border-red-500/60 shadow-[0_0_30px_rgba(239,68,68,0.25)]'
          : isRecovery
            ? 'border-emerald-500/60 shadow-[0_0_30px_rgba(16,185,129,0.25)]'
            : 'border-slate-700'
      }`}
    >
      <div className="mb-2 flex items-center justify-between">
        <p className="text-sm font-medium text-slate-200">Confidence Meter</p>
        <p className="text-sm font-semibold text-cyan-300">{clamped}%</p>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-800">
        <div
          className={`h-full rounded-full transition-all ${
            isDrop
              ? 'bg-gradient-to-r from-red-500 to-amber-500 duration-300'
              : isRecovery
                ? 'bg-gradient-to-r from-emerald-400 to-cyan-400 duration-700'
                : 'bg-gradient-to-r from-cyan-400 to-emerald-400 duration-500'
          }`}
          style={{ width: `${clamped}%` }}
        />
      </div>
      <p className={`mt-3 text-xs ${isDrop ? 'text-red-300' : isRecovery ? 'text-emerald-300' : 'text-slate-400'}`}>
        {trendText || 'Waiting for confidence signal...'}
      </p>
    </div>
  );
}
