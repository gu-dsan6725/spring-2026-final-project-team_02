/**
 * World Bank Open Data API tool server.
 *
 * Fetches development indicator time-series data by country and year range.
 * No authentication required.
 */

interface WorldBankObservation {
  year: string;
  value: number | null;
}

interface WorldBankEntry {
  date?: string;
  value?: number | null;
  indicator?: { value?: string };
  country?: { value?: string };
}

interface WorldBankResponse {
  indicator: string;
  country: string;
  observations: WorldBankObservation[];
  source_url: string;
}

const WORLD_BANK_FETCH_TIMEOUT_MS = 8_000;

export async function worldbankHandler(
  input: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const indicator = typeof input.indicator === 'string' ? input.indicator : '';
  const country = typeof input.country === 'string' ? input.country : '';
  const dateRange = typeof input.date_range === 'string' ? input.date_range : '2015:2023';

  if (indicator.length === 0 || country.length === 0) {
    return { error: 'indicator and country are required' };
  }

  const url = new URL(
    `https://api.worldbank.org/v2/country/${encodeURIComponent(country)}/indicator/${encodeURIComponent(indicator)}`,
  );
  url.searchParams.set('date', dateRange);
  url.searchParams.set('format', 'json');
  url.searchParams.set('per_page', '50');

  const controller = new AbortController();
  const timer = setTimeout(() => {
    controller.abort();
  }, WORLD_BANK_FETCH_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'policy-memo-agent/0.1.0',
      },
    });
  } catch (error) {
    clearTimeout(timer);

    if (error instanceof Error && error.name === 'AbortError') {
      return {
        error: `World Bank request timed out after ${String(WORLD_BANK_FETCH_TIMEOUT_MS)}ms`,
      };
    }

    return {
      error: error instanceof Error ? `World Bank request failed: ${error.message}` : String(error),
    };
  }
  clearTimeout(timer);

  if (!response.ok) {
    return { error: `World Bank API error: ${String(response.status)}` };
  }

  const json = (await response.json()) as unknown[];

  // World Bank returns [metadata, data_array]
  if (!Array.isArray(json) || json.length < 2) {
    return { error: 'Unexpected World Bank response format' };
  }

  const dataArray = json[1];
  if (!Array.isArray(dataArray)) {
    return { error: 'No data found for this indicator/country combination' };
  }

  const entries = dataArray as WorldBankEntry[];
  const indicatorName = entries[0]?.indicator?.value ?? indicator;
  const countryName = entries[0]?.country?.value ?? country;

  const observations: WorldBankObservation[] = entries
    .filter((e) => e.value !== null && e.value !== undefined)
    .map((e) => ({
      year: e.date ?? '',
      value: e.value ?? null,
    }))
    .sort((a, b) => a.year.localeCompare(b.year));

  const result: WorldBankResponse = {
    indicator: indicatorName,
    country: countryName,
    observations,
    source_url: `https://data.worldbank.org/indicator/${indicator}?locations=${country}`,
  };

  return result as unknown as Record<string, unknown>;
}
