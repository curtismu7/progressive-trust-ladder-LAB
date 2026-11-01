// Plain-language labels. Server text is shown as text (React escapes it); these maps only translate known reason codes.
export const RUNG_NAMES = ['Public', 'Signed in', 'Step-up satisfied', 'CIBA approved'];

export const RUNG_NEEDS = [
  'Browsing only. No sign-in.',
  'A sign-in proof, fresh for one hour.',
  'A fresh step-up check (5 minutes). Payments up to 600.',
  'A phone approval, single use, 2 minutes. Payments up to 1000.',
];

// What the page says once when the phone's answer arrives (the requester sees it on its next poll).
export const OUTCOME_TEXT = {
  approved: 'The phone approved. Rung 3 (CIBA approved): send the payment now.',
  denied: 'The phone denied the request. The payment stays refused.',
  approval_expired: 'The approval window ended before the payment was sent.',
};

export const REASON_TEXT = {
  rung_required: 'Not enough trust for this payment yet',
  approval_pending: 'Waiting for the phone to answer',
  approval_not_needed: 'This amount does not need a phone approval',
  denied: 'The phone denied the request',
  approval_expired: 'The approval window has ended',
  approval_mismatch: 'The approval is for a different amount',
  approval_unavailable: 'The approval is no longer available',
  over_hard_limit: 'Above the 1000 hard limit',
  invalid_amount: 'Enter a whole amount from 1 to 1000',
  wrong_rung: 'That step is not available at this rung',
  replay: 'That proof was already used',
  acr_too_low: 'The proof is not strong enough',
  acr_unknown: 'The proof type is not recognised',
  bad_auth_time: 'The proof time is not valid',
  auth_too_old: 'The sign-in is too old; sign in again',
  step_up_not_satisfied: 'Step-up is still needed',
  subject_mismatch: 'The proof is for a different customer',
  no_proof: 'No proof was given',
  reason_required: 'A reason is required to step down',
  not_a_fall: 'A step down must go to a lower rung',
  unknown_request: 'That approval request is not known',
};

export const reasonText = (code) => REASON_TEXT[code] ?? `Refused (${code})`;
