/**
 * Structural success-claim contract for support and capability turns. A
 * success claim needs a matching receipt; anything else never becomes a
 * success sentence. Reply prose itself always comes from the model.
 */
export type StructuralClaim = {
  readonly operation: string;
  readonly claimsSuccess: boolean;
  readonly receiptPresent: boolean;
};

export function claimAllowsSuccess(claims: readonly StructuralClaim[]): boolean {
  for (const claim of claims) {
    if (claim.claimsSuccess && !claim.receiptPresent) return false;
  }
  return true;
}
