import { runZeroTouchEmrPolling } from '../lib/automation/emr-polling-service.js';

async function main() {
  const includeAthena = process.env.EMR_POLLING_INCLUDE_ATHENA !== 'false';
  const includeEpic = process.env.EMR_POLLING_INCLUDE_EPIC !== 'false';
  const startDate = process.env.EMR_POLLING_START_DATE || '';
  const endDate = process.env.EMR_POLLING_END_DATE || '';
  const tenantId = process.env.EMR_POLLING_TENANT_ID || '';

  const result = await runZeroTouchEmrPolling({
    tenantId,
    includeAthena,
    includeEpic,
    startDate,
    endDate,
  });

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main().catch((error) => {
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        error: error instanceof Error ? error.message : 'Unknown EMR polling failure.',
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
});
