import { useRef, useState } from 'react';

const TARGET_FIELDS = [
  'patientId',
  'firstName',
  'lastName',
  'dob',
  'memberId',
  'procedureCode',
  'serviceDate',
  'departmentId',
  'organizationId',
  'diagnosis',
  'chartSummary',
];

export default function BatchUploadDashboard({ batchIntake, operatorId, practiceId, connector = 'athena' }) {
  const fileRef = useRef(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [isDragging, setIsDragging] = useState(false);

  if (!batchIntake?.isOpen) {
    return null;
  }

  const pickFile = (file) => {
    if (!file) {
      return;
    }
    setSelectedFile(file);
  };

  const runPreflight = async () => {
    await batchIntake.preflightUpload({
      file: selectedFile,
      userId: operatorId,
      practiceId,
      connector,
    });
  };

  const commitBatch = async () => {
    await batchIntake.commitBatch({
      userId: operatorId,
      practiceId,
      connector,
    });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="glass-panel w-full max-w-6xl rounded-2xl p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-wide text-slate-400">Batch Intake Dashboard</p>
            <h3 className="mt-1 text-xl font-semibold text-white">Specialty Pilot high-volume referral ingest</h3>
          </div>
          <button
            className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-200"
            onClick={() => {
              batchIntake.close();
            }}
            type="button"
          >
            Close
          </button>
        </div>

        <div className="mt-3 grid gap-3 lg:grid-cols-[1.2fr_1fr]">
          <div>
            <div
              className={`rounded-xl border-2 border-dashed p-4 text-center ${
                isDragging ? 'border-cyan-400 bg-cyan-500/10' : 'border-slate-700 bg-slate-950/50'
              }`}
              onDragOver={(event) => {
                event.preventDefault();
                setIsDragging(true);
              }}
              onDragLeave={(event) => {
                event.preventDefault();
                setIsDragging(false);
              }}
              onDrop={(event) => {
                event.preventDefault();
                setIsDragging(false);
                const [file] = Array.from(event.dataTransfer.files || []);
                pickFile(file);
              }}
            >
              <p className="text-sm text-slate-200">Drop CSV/JSON referral list</p>
              <p className="mt-1 text-xs text-slate-400">Pre-flight validates each row without ingesting.</p>
              <div className="mt-3 flex items-center justify-center gap-2">
                <button
                  className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-200"
                  onClick={() => fileRef.current?.click()}
                  type="button"
                >
                  Choose file
                </button>
                <button
                  className="premium-button premium-button-primary rounded-lg px-3 py-1.5 text-xs font-semibold text-cyan-50 disabled:cursor-not-allowed disabled:opacity-50"
                  disabled={!selectedFile || batchIntake.isPreflighting}
                  onClick={() => {
                    void runPreflight();
                  }}
                  type="button"
                >
                  {batchIntake.isPreflighting ? 'Running pre-flight…' : 'Run pre-flight'}
                </button>
              </div>
              <input
                ref={fileRef}
                accept="application/json,.json,text/csv,.csv"
                className="hidden"
                onChange={(event) => {
                  const [file] = Array.from(event.target.files || []);
                  pickFile(file);
                  event.target.value = '';
                }}
                type="file"
              />
            </div>

            {selectedFile ? (
              <p className="mt-2 text-xs text-cyan-200">
                Selected: {selectedFile.name} ({Math.max(1, Math.round(selectedFile.size / 1024))} KB)
              </p>
            ) : null}

            {batchIntake.error ? (
              <div className="mt-3 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-100">
                {batchIntake.error}
              </div>
            ) : null}

            <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Pre-flight summary</p>
              <div className="mt-2 grid grid-cols-2 gap-2 text-xs text-slate-200 md:grid-cols-3">
                <p>Ready rows: {batchIntake.summary.successCount}</p>
                <p>Error rows: {batchIntake.summary.errorCount}</p>
                <p>Created runs: {batchIntake.summary.createdRuns}</p>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-950/60 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Fuzzy header mapping</p>
            <div className="mt-2 max-h-72 space-y-2 overflow-auto pr-1">
              {TARGET_FIELDS.map((field) => (
                <label key={field} className="flex items-center gap-2 text-xs text-slate-200">
                  <span className="w-32 shrink-0 text-slate-300">{field}</span>
                  <select
                    className="w-full rounded-lg border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-100"
                    value={batchIntake.mapping[field] || ''}
                    onChange={(event) => batchIntake.updateMappingField(field, event.target.value)}
                  >
                    <option value="">-- unmapped --</option>
                    {batchIntake.headers.map((header) => (
                      <option key={`${field}-${header}`} value={header}>
                        {header}
                      </option>
                    ))}
                  </select>
                </label>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <button
            className="premium-button premium-button-success rounded-lg px-3 py-1.5 text-xs font-semibold text-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
            disabled={!batchIntake.canCommit}
            onClick={() => {
              void commitBatch();
            }}
            type="button"
          >
            {batchIntake.isCommitting ? 'Committing…' : 'Commit batch intake'}
          </button>
          <button
            className="premium-button premium-button-soft rounded-lg px-3 py-1.5 text-xs font-semibold text-slate-200"
            onClick={() => batchIntake.reset()}
            type="button"
          >
            Reset
          </button>
          {batchIntake.batchId ? <p className="text-xs text-slate-400">Batch ID: {batchIntake.batchId}</p> : null}
        </div>

        {batchIntake.validationResults?.length ? (
          <div className="mt-3 rounded-xl border border-slate-700 bg-slate-950/60 p-3">
            <p className="text-xs uppercase tracking-wide text-slate-400">Validation results</p>
            <div className="mt-2 max-h-44 overflow-auto text-xs text-slate-200">
              {batchIntake.validationResults.slice(0, 80).map((row) => (
                <div key={`row-${row.rowIndex}`} className="mb-1 rounded border border-slate-800 px-2 py-1">
                  <p>
                    Row {row.rowIndex + 1}: {row.valid ? 'READY' : row.duplicate ? 'DUPLICATE' : 'ERROR'}
                  </p>
                  {!row.valid && row.errors?.length ? <p className="text-amber-200">{row.errors.join(' | ')}</p> : null}
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
