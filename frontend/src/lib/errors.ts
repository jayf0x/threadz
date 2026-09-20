// Same shape whether the failure came from the backend or the local store, so
// callers can branch on `status` (404 = "not there") without string-matching.
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
