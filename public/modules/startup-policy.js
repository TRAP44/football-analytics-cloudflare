export function startupSurfacePlan(surface = 'public', { admin = false } = {}) {
  const isAdminSurface = surface === 'admin';

  if (isAdminSurface) {
    return Object.freeze({
      surface: 'admin',
      publicInitial: Object.freeze([]),
      publicIdle: Object.freeze([]),
      adminInitial: admin ? Object.freeze(['provider']) : Object.freeze([]),
      adminIdle: admin ? Object.freeze(['advanced_admin']) : Object.freeze([]),
    });
  }

  return Object.freeze({
    surface: 'public',
    publicInitial: Object.freeze(['favorites', 'matches']),
    publicIdle: Object.freeze(['history']),
    adminInitial: Object.freeze([]),
    adminIdle: Object.freeze([]),
  });
}

export function shouldPrepareAdminSurface(surface = 'public') {
  return surface === 'admin';
}

export function shouldPreparePublicSurface(surface = 'public') {
  return surface !== 'admin';
}
