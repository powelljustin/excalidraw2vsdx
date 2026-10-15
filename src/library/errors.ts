/** Error that the HTTP layer turns into a JSON response. */
export class LibraryError extends Error {
  readonly status: number;

  constructor(message: string, status = 400) {
    super(message);
    this.name = "LibraryError";
    this.status = status;
  }
}
