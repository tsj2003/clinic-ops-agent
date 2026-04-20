'use client';

import { useEffect, useMemo, useState } from 'react';

function money(value = 0) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) {
    return '$0.00';
  }
  return `$${numeric.toFixed(2)}`;
}

function clean(value, max = 200) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

function formatDate(value = '') {
  const parsed = Date.parse(clean(value, 80));
  if (!Number.isFinite(parsed)) {
    return 'N/A';
  }
  return new Date(parsed).toLocaleString();
}

export default function RevenuePanel() {
  const [snapshot, setSnapshot] = useState(null);
  const [error, setError] = useState('');
  const [activeRefundRunId, setActiveRefundRunId] = useState('');

  const loadRevenue = async () => {
    try {
      setError('');
      const response = await fetch('/api/automation/billing/revenue?limit=80', {
        cache: 'no-store',
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Unable to load revenue snapshot.');
      }
      setSnapshot(payload);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : 'Unable to load revenue snapshot.');
    }
  };

  useEffect(() => {
    void loadRevenue();
    const timer = setInterval(() => {
      void loadRevenue();
    }, 20_000);
    return () => clearInterval(timer);
  }, []);

  const pendingInvoices = useMemo(() => (Array.isArray(snapshot?.pendingInvoices) ? snapshot.pendingInvoices : []), [snapshot]);

  return (
    <div className="glass-panel rounded-2xl p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-xs uppercase tracking-wide text-slate-400">Revenue</p>
          <p className="mt-1 text-sm text-slate-300">Pay-per-Approved-Auth economics with Parasail and Yotta-Labs integrity tracking.</p>
        </div>
        <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-emerald-100">
          Revenue Lock
        </span>
      </div>

      {error ? <p className="mt-3 text-xs text-red-300">{error}</p> : null}

      <div className="mt-4 grid gap-3 md:grid-cols-3">
        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Total Approved Value</p>
          <p className="mt-1 text-xl font-semibold text-white">{money(snapshot?.totalApprovedValueUsd)}</p>
          <p className="mt-1 text-[11px] text-slate-400">Sum of approved procedure value</p>
        </div>

        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">AuthPilot Savings</p>
          <p className="mt-1 text-xl font-semibold text-emerald-200">{money(snapshot?.authpilotSavings?.laborSavingsUsd)}</p>
          <p className="mt-1 text-[11px] text-slate-400">
            {Number(snapshot?.authpilotSavings?.manualMinutesEliminated || 0)} manual minutes eliminated (8-minute metric)
          </p>
        </div>

        <div className="premium-subcard rounded-xl p-3">
          <p className="text-[10px] uppercase tracking-wide text-slate-500">Pending Invoices</p>
          <p className="mt-1 text-xl font-semibold text-cyan-200">{pendingInvoices.length}</p>
          <p className="mt-1 text-[11px] text-slate-400">Real-time Parasail invoice state</p>
        </div>
      </div>

      <div className="mt-4 space-y-2">
        {pendingInvoices.length === 0 ? (
          <div className="premium-subcard rounded-xl p-3 text-xs text-slate-400">No pending invoices currently.</div>
        ) : (
          pendingInvoices.slice(0, 8).map((invoice) => {
            const runId = clean(invoice?.runId, 120);
            const buttonBusy = activeRefundRunId === runId;
            return (
              <div key={clean(invoice?.id || runId, 140)} className="premium-subcard rounded-xl p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-xs font-semibold text-slate-100">{runId || 'run'}</p>
                  <span className="rounded-full border border-slate-700 bg-slate-900 px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                    {clean(invoice?.status || 'pending', 30)}
                  </span>
                </div>
                <p className="mt-1 text-[11px] text-slate-400">
                  CPT {clean(invoice?.procedureCode || 'N/A', 30)} · {clean(invoice?.insuranceType || 'UNKNOWN', 40)} · Charge{' '}
                  {money(invoice?.chargeAmountUsd)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">Created {formatDate(invoice?.createdAt)}</p>
                <button
                  className="premium-button premium-button-soft mt-2 rounded-lg px-2.5 py-1 text-[11px] font-semibold text-amber-100 disabled:opacity-50"
                  disabled={!runId || buttonBusy}
                  onClick={async () => {
                    if (!runId) {
                      return;
                    }
                    setActiveRefundRunId(runId);
                    try {
                      const response = await fetch('/api/automation/billing/refund', {
                        method: 'POST',
                        headers: {
                          'Content-Type': 'application/json',
                        },
                        body: JSON.stringify({
                          runId,
                          payerReferenceId: clean(invoice?.payerReferenceId, 120),
                          reason: 'approval_inaccurate',
                          actor: 'clinician',
                        }),
                      });
                      const payload = await response.json();
                      if (!response.ok) {
                        throw new Error(payload.error || 'Unable to issue refund credit.');
                      }
                      await loadRevenue();
                    } catch (refundError) {
                      setError(refundError instanceof Error ? refundError.message : 'Unable to issue refund credit.');
                    } finally {
                      setActiveRefundRunId('');
                    }
                  }}
                  type="button"
                >
                  {buttonBusy ? 'Issuing credit…' : 'Mark Inaccurate + Auto Credit'}
                </button>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
