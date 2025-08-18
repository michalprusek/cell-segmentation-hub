interface RetryOptions {
  retries?: number;
  delay?: number;
  backoff?: number;
}

export async function fetchWithRetry(
  url: string,
  options: RequestInit = {},
  retryOptions: RetryOptions = {}
): Promise<Response> {
  const { retries = 1, delay = 2000, backoff = 1.5 } = retryOptions; // Reduced retries, increased delay

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, options);

      // If response is ok, return it immediately
      if (response.ok) {
        return response;
      }

      // If not ok, create an error with response status/text
      throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      // Don't retry on the last attempt
      if (attempt === retries) {
        break;
      }

      // Wait before retrying with exponential backoff
      const waitTime = delay * Math.pow(backoff, attempt);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  throw lastError ?? new Error('Request failed but no error captured');
}
