/**
 * FRED (Federal Reserve Economic Data) tool server.
 *
 * Fetches economic time-series data from the St. Louis Fed.
 * Requires: FRED_API_KEY in environment.
 */

interface FredSeriesMetadata {
  seriess?: Array<{
    title?: string;
    units?: string;
    frequency?: string;
    notes?: string;
  }>;
}

interface FredObservationsResponse {
  observations?: Array<{
    date?: string;
    value?: string;
  }>;
}

interface FredResult {
  series_id: string;
  title: string;
  units: string;
  frequency: string;
  observations: Array<{ date: string; value: number | null }>;
  source_url: string;
}

export async function fredHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const seriesId = typeof input.series_id === 'string' ? input.series_id.toUpperCase() : '';
  const startDate = typeof input.start_date === 'string' ? input.start_date : '2015-01-01';
  const endDate =
    typeof input.end_date === 'string' ? input.end_date : new Date().toISOString().slice(0, 10);

  if (seriesId.length === 0) {
    return { error: 'series_id is required' };
  }

  const apiKey = process.env.FRED_API_KEY ?? '';
  if (apiKey.length === 0) {
    return { error: 'FRED_API_KEY is not set' };
  }

  // Step 1: Series metadata
  const metaUrl = new URL('https://api.stlouisfed.org/fred/series');
  metaUrl.searchParams.set('series_id', seriesId);
  metaUrl.searchParams.set('api_key', apiKey);
  metaUrl.searchParams.set('file_type', 'json');

  const [metaResponse, obsResponse] = await Promise.all([
    fetch(metaUrl.toString()),
    (async () => {
      const obsUrl = new URL('https://api.stlouisfed.org/fred/series/observations');
      obsUrl.searchParams.set('series_id', seriesId);
      obsUrl.searchParams.set('api_key', apiKey);
      obsUrl.searchParams.set('file_type', 'json');
      obsUrl.searchParams.set('observation_start', startDate);
      obsUrl.searchParams.set('observation_end', endDate);
      return fetch(obsUrl.toString());
    })(),
  ]);

  if (!metaResponse.ok) {
    return { error: `FRED series metadata error: ${String(metaResponse.status)}` };
  }
  if (!obsResponse.ok) {
    return { error: `FRED observations error: ${String(obsResponse.status)}` };
  }

  const metaData = (await metaResponse.json()) as FredSeriesMetadata;
  const obsData = (await obsResponse.json()) as FredObservationsResponse;

  const seriesMeta = metaData.seriess?.[0];
  const title = seriesMeta?.title ?? seriesId;
  const units = seriesMeta?.units ?? '';
  const frequency = seriesMeta?.frequency ?? '';

  const observations = (obsData.observations ?? [])
    .map((o) => ({
      date: o.date ?? '',
      value: o.value === '.' || o.value === undefined ? null : parseFloat(o.value),
    }))
    .filter((o) => o.date.length > 0);

  const result: FredResult = {
    series_id: seriesId,
    title,
    units,
    frequency,
    observations,
    source_url: `https://fred.stlouisfed.org/series/${seriesId}`,
  };

  return result as unknown as Record<string, unknown>;
}
