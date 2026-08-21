import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');

    // Test the token by getting user info
    const res = await fetch('https://www.googleapis.com/drive/v3/about?fields=user', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      return Response.json({ connected: false, error: 'Token invalid' });
    }

    const data = await res.json();
    return Response.json({
      connected: true,
      email: data.user?.emailAddress,
      displayName: data.user?.displayName,
    });
  } catch (error) {
    return Response.json({ connected: false, error: error.message });
  }
});