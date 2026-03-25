export default function StatusCard({ label, value, tone = 'neutral' }) {
  const toneClass = {
    neutral: 'border-slate-700 text-slate-200',
    processing: 'border-blue-500/40 text-blue-200',
    warning: 'border-amber-500/40 text-amber-200',
    success: 'border-emerald-500/40 text-emerald-200',
  }[tone];

  return (
    <div className={`rounded-2xl border bg-slate-900/70 p-4 shadow-soft transition-all duration-300 ${toneClass}`}>
      <p className="text-xs uppercase tracking-wide text-slate-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold">{value}</p>
    </div>
  );
}
