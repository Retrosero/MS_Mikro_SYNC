export function clearAdminSession() {
  localStorage.removeItem('adminToken');
  window.dispatchEvent(new Event('admin-session-expired'));
}

export async function authFetch(input: RequestInfo | URL, init: RequestInit = {}) {
  const token = localStorage.getItem('adminToken');
  const headers = new Headers(init.headers);

  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(input, {
    ...init,
    headers
  });

  if (response.status === 401) {
    clearAdminSession();
  }

  return response;
}
