import { useMemo, useState } from 'react';

function clean(value, max = 240) {
  return String(value || '').trim().slice(0, Math.max(1, Number(max) || 1));
}

export default function useBatchIntake({ onCommitted } = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPreflighting, setIsPreflighting] = useState(false);
  const [isCommitting, setIsCommitting] = useState(false);
  const [error, setError] = useState('');
  const [fileName, setFileName] = useState('');
  const [batchId, setBatchId] = useState('');
  const [mapping, setMapping] = useState({});
  const [headers, setHeaders] = useState([]);
  const [sourceRows, setSourceRows] = useState([]);
  const [fuzzyDictionary, setFuzzyDictionary] = useState({});
  const [validationResults, setValidationResults] = useState([]);
  const [summary, setSummary] = useState({ successCount: 0, errorCount: 0, createdRuns: 0 });
  const [commitResult, setCommitResult] = useState(null);

  const canCommit = useMemo(() => summary.successCount > 0 && !isCommitting && !isPreflighting, [summary.successCount, isCommitting, isPreflighting]);

  const open = () => {
    setIsOpen(true);
  };

  const close = () => {
    setIsOpen(false);
  };

  const reset = () => {
    setError('');
    setFileName('');
    setBatchId('');
    setMapping({});
    setHeaders([]);
    setSourceRows([]);
    setFuzzyDictionary({});
    setValidationResults([]);
    setSummary({ successCount: 0, errorCount: 0, createdRuns: 0 });
    setCommitResult(null);
  };

  const updateMappingField = (field, value) => {
    setMapping((prev) => ({
      ...prev,
      [field]: clean(value, 120),
    }));
  };

  const preflightUpload = async ({ file, userId, practiceId, connector }) => {
    if (!file) {
      setError('Select a CSV or JSON file first.');
      return;
    }

    setIsPreflighting(true);
    setError('');
    setCommitResult(null);

    try {
      const formData = new FormData();
      formData.set('file', file);
      formData.set('commit', 'false');
      formData.set('userId', clean(userId || 'staff-operator', 120));
      formData.set('practiceId', clean(practiceId, 120));
      formData.set('connector', clean(connector || 'athena', 30));

      const response = await fetch('/api/intake/batch', {
        method: 'POST',
        body: formData,
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Pre-flight batch intake failed.');
      }

      setFileName(payload.filename || file.name || 'batch-upload');
      setBatchId(payload.batchId || '');
      setMapping(payload.mapping || {});
      setHeaders(Array.isArray(payload.headers) ? payload.headers : []);
      setSourceRows(Array.isArray(payload.sourceRows) ? payload.sourceRows : []);
      setFuzzyDictionary(payload.fuzzyDictionary || {});
      setValidationResults(Array.isArray(payload.validationResults) ? payload.validationResults : []);
      setSummary({
        successCount: Number(payload.successCount) || 0,
        errorCount: Number(payload.errorCount) || 0,
        createdRuns: 0,
      });
    } catch (uploadError) {
      setError(uploadError instanceof Error ? uploadError.message : 'Pre-flight batch intake failed.');
    } finally {
      setIsPreflighting(false);
    }
  };

  const commitBatch = async ({ userId, practiceId, connector }) => {
    if (!sourceRows.length) {
      setError('Run pre-flight before commit.');
      return null;
    }

    setIsCommitting(true);
    setError('');
    try {
      const response = await fetch('/api/intake/batch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          commit: true,
          batchId,
          filename: fileName,
          userId: clean(userId || 'staff-operator', 120),
          practiceId: clean(practiceId, 120),
          connector: clean(connector || 'athena', 30),
          sourceRows,
          mapping,
        }),
      });

      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || 'Batch commit failed.');
      }

      setValidationResults(Array.isArray(payload.validationResults) ? payload.validationResults : validationResults);
      setSummary({
        successCount: Number(payload.successCount) || 0,
        errorCount: Number(payload.errorCount) || 0,
        createdRuns: Array.isArray(payload.createdRuns) ? payload.createdRuns.length : 0,
      });
      setCommitResult(payload);
      if (typeof onCommitted === 'function') {
        await onCommitted(payload);
      }
      return payload;
    } catch (commitError) {
      setError(commitError instanceof Error ? commitError.message : 'Batch commit failed.');
      return null;
    } finally {
      setIsCommitting(false);
    }
  };

  return {
    isOpen,
    isPreflighting,
    isCommitting,
    error,
    fileName,
    batchId,
    mapping,
    headers,
    sourceRows,
    fuzzyDictionary,
    validationResults,
    summary,
    commitResult,
    canCommit,
    open,
    close,
    reset,
    updateMappingField,
    preflightUpload,
    commitBatch,
  };
}
