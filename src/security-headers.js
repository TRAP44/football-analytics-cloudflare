export const API_SECURITY_HEADERS = Object.freeze({
  'cross-origin-resource-policy': 'same-origin',
  'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=()',
  'referrer-policy': 'no-referrer',
  'strict-transport-security': 'max-age=31536000',
  'x-permitted-cross-domain-policies': 'none',
  'x-content-type-options': 'nosniff',
});

export function apiSecurityHeaders() {
  return { ...API_SECURITY_HEADERS };
}
