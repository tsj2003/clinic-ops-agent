export default function ExecutionPanel({ logs, isRunning }) {
  return (
    <div className="flex h-full flex-col rounded-2xl border border-slate-700 bg-slate-900/75 p-4 shadow-soft">
      <h3 className="mb-3 text-lg font-semibold text-slate-100">Execution Layer</h3>
      <div className="scrollbar-thin log-mono flex-1 space-y-2 overflow-y-auto rounded-xl bg-slate-950/80 p-3 text-sm">
        {logs.length === 0 ? (
          <p className="text-slate-500">⚙️ Execution layer initialized. Awaiting first interaction...</p>
        ) : (
          logs.map((log) => (
            <div
              key={log.id}
              className={`animate-fadeIn rounded-lg border px-3 py-2 ${
                log.level === 'error'
                  ? 'border-red-500/40 bg-red-500/10 text-red-200 shadow-[0_0_20px_rgba(239,68,68,0.15)]'
                  : log.level === 'retry'
                    ? 'border-amber-500/40 bg-amber-500/10 text-amber-100 shadow-[0_0_20px_rgba(245,158,11,0.12)]'
                    : log.level === 'success'
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-100 shadow-[0_0_20px_rgba(16,185,129,0.12)]'
                      : 'border-slate-700 bg-slate-900 text-slate-200'
              }`}
            >
              <span className="mr-2 text-slate-400">[{log.time}]</span>
              {log.text}
            </div>
          ))
        )}
        {isRunning && <span className="inline-block h-4 w-2 animate-pulse rounded-sm bg-cyan-400/80" />}
      </div>
    </div>
  );
}
