import { timingSafeEqual } from "node:crypto";
import { LibraryError } from "./errors.js";

/**
 * Who can see a library. `paid` is stored now so a payment check can be
 * plugged in later. This build does not talk to Stripe.
 */
export type AccessLevel = "free" | "paid";

export interface AccessSubject {
  access: AccessLevel;
}

/** What the server knows about the caller. There is no user account yet. */
export interface AccessContext {
  /** Value of `X-Admin-Token` or `Authorization: Bearer`, when the client sent one. */
  adminToken: string | null;
}

export interface AccessResult {
  allowed: boolean;
  status: number;
  message: string;
}

/**
 * Gate for uploads and for paid libraries.
 * Replace `allowPaid` with a Stripe (or other) check without rewriting routes.
 */
export interface AccessPolicy {
  canUpload(ctx: AccessContext): AccessResult;
  canWrite(ctx: AccessContext): AccessResult;
  canRead(subject: AccessSubject, ctx: AccessContext): AccessResult;
}

export interface AccessPolicyOptions {
  /**
   * When set, upload, edit, and delete require this exact token.
   * When unset, those actions are open. That is the "no login" default.
   */
  adminToken?: string | null;
  /**
   * Return true when this caller may read a paid library.
   * The default denies paid libraries. An admin token is always allowed.
   */
  allowPaid?: (subject: AccessSubject, ctx: AccessContext) => boolean;
}

export function createAccessPolicy(options: AccessPolicyOptions = {}): AccessPolicy {
  const expected = options.adminToken?.trim() || null;
  const allowPaid = options.allowPaid ?? (() => false);

  function isAdmin(ctx: AccessContext): boolean {
    return tokenMatches(ctx.adminToken, expected);
  }

  function requireWriter(ctx: AccessContext): AccessResult {
    if (!expected) return allow();
    if (isAdmin(ctx)) return allow();
    return deny(401, "This action requires an admin token.");
  }

  return {
    canUpload: requireWriter,
    canWrite: requireWriter,
    canRead(subject, ctx) {
      if (subject.access !== "paid") return allow();
      if (isAdmin(ctx) || allowPaid(subject, ctx)) return allow();
      return deny(
        402,
        "This library is marked paid. A payment check is not configured yet.",
      );
    },
  };
}

export function allow(): AccessResult {
  return { allowed: true, status: 200, message: "" };
}

export function deny(status: number, message: string): AccessResult {
  return { allowed: false, status, message };
}

export function assertAllowed(result: AccessResult): void {
  if (!result.allowed) throw new LibraryError(result.message, result.status);
}

function tokenMatches(provided: string | null, expected: string | null): boolean {
  if (!expected || !provided) return false;
  const actual = Buffer.from(provided);
  const wanted = Buffer.from(expected);
  if (actual.length !== wanted.length) return false;
  return timingSafeEqual(actual, wanted);
}
