const DEFAULT_TRADING_DAYS_PER_YEAR = 250;
const HIGH_COMMIT_PRESSURE_PER_YEAR = 25000;

function finiteNonNegative(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

function rounded(value) {
  return Math.round(value * 100) / 100;
}

export function summarizeJsonGrowth(rows, {tradingDaysPerYear = DEFAULT_TRADING_DAYS_PER_YEAR} = {}) {
  const days = Array.isArray(rows) ? rows.map(row => ({
    tradingDay: String(row?.trading_day || ""),
    rowCount: finiteNonNegative(row?.row_count),
    jsonBytes: finiteNonNegative(row?.json_bytes)
  })).filter(day => /^\d{8}$/.test(day.tradingDay) && day.rowCount != null && day.jsonBytes != null) : [];

  if (!days.length) return {
    status: "INSUFFICIENT_DATA", sampleTradingDays: 0, averageRowsPerTradingDay: null,
    averageJsonBytesPerTradingDay: null, maximumJsonBytesPerTradingDay: null,
    projectedAnnualJsonBytes: null, projectionTradingDays: tradingDaysPerYear
  };

  const averageRows = days.reduce((sum, day) => sum + day.rowCount, 0) / days.length;
  const averageBytes = days.reduce((sum, day) => sum + day.jsonBytes, 0) / days.length;
  return {
    status: days.length >= 3 ? "MEASURED_SAMPLE" : "LIMITED_SAMPLE",
    sampleTradingDays: days.length,
    averageRowsPerTradingDay: rounded(averageRows),
    averageJsonBytesPerTradingDay: rounded(averageBytes),
    maximumJsonBytesPerTradingDay: Math.max(...days.map(day => day.jsonBytes)),
    projectedAnnualJsonBytes: Math.round(averageBytes * tradingDaysPerYear),
    projectionTradingDays: tradingDaysPerYear
  };
}

export function snapshotCommitPressure({commitsPerTradingDay, tradingDaysPerYear = DEFAULT_TRADING_DAYS_PER_YEAR}) {
  const daily = finiteNonNegative(commitsPerTradingDay);
  const annualDays = finiteNonNegative(tradingDaysPerYear);
  if (daily == null || annualDays == null || annualDays === 0) return {
    status: "INSUFFICIENT_DATA", commitsPerTradingDay: null, projectedAnnualCommits: null
  };
  const annual = Math.round(daily * annualDays);
  return {status: annual >= HIGH_COMMIT_PRESSURE_PER_YEAR ? "HIGH_HISTORY_PRESSURE" : "MONITOR",
    commitsPerTradingDay: daily, projectedAnnualCommits: annual};
}

export function retentionGate({measuredDatabaseBytes, databaseLimitBytes, projectedDailyBytes,
  minimumHotTradingDays = 60}) {
  const measured = finiteNonNegative(measuredDatabaseBytes);
  const limit = finiteNonNegative(databaseLimitBytes);
  const daily = finiteNonNegative(projectedDailyBytes);
  const minimumDays = finiteNonNegative(minimumHotTradingDays);
  if (measured == null || limit == null || !limit || daily == null || minimumDays == null) return {
    status: "INSUFFICIENT_MEASUREMENT", utilizationRatio: null, estimatedDaysRemaining: null,
    automatedDeletionAllowed: false
  };
  const utilization = measured / limit;
  const remaining = Math.max(0, limit - measured);
  const daysRemaining = daily > 0 ? Math.floor(remaining / daily) : null;
  let status = "MONITOR";
  if (utilization >= 0.85 || (daysRemaining != null && daysRemaining < minimumDays)) status = "ARCHIVE_PLAN_REQUIRED";
  else if (utilization >= 0.7 || (daysRemaining != null && daysRemaining < minimumDays * 2)) status = "ARCHIVE_PLAN_WARNING";
  return {status, utilizationRatio: rounded(utilization), estimatedDaysRemaining: daysRemaining,
    automatedDeletionAllowed: false};
}
