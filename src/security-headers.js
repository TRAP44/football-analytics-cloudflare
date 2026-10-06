export const API_SECURITY_HEADERS = Object.freeze({
  'content-security-policy': "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'cross-origin-opener-policy': 'same-origin',
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-frame-options': 'DENY',
  'x-permitted-cross-domain-policies': 'none',
  'x-content-type-options': 'nosniff',
});

export function apiSecurityHeaders() {
  return { ...API_SECURITY_HEADERS };
}
