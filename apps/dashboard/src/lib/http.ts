/** Shared HTTP basics for the API client and the auth session (kept separate to avoid an import cycle). */

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public field?: string,
    public code?: string,
  ) {
    super(message);
  }
}

/** The browser talks to the API directly (CORS with credentials), including the SSE streams. */
export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8000').replace(/\/$/, '');

export const UNREACHABLE = 'Cannot reach the Kiln API. Is it running on port 8000?';
