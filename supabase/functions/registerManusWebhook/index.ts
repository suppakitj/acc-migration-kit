import { createClientFromRequest } from '../_shared/base44-compat.ts';

const MANUS_BASE = 'https://api.manus.ai/v1';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();

  if (!user || (user.role !== 'admin' && user.role !== 'management')) {
    return Response.json({ error: 'Forbidden: Admin access required' }, { status: 403 });
  }

  const { action, webhook_url } = await req.json();

  const configs = await base44.asServiceRole.entities.AppConfig.list();
  const manusApiKey = configs.find(c => c.key === 'manus_api_key')?.value;

  if (!manusApiKey) {
    return Response.json({ error: 'กรุณาตั้งค่า Manus API Key ก่อน' }, { status: 400 });
  }

  const manusHeaders = { 'API_KEY': manusApiKey, 'Content-Type': 'application/json' };

  if (action === 'register') {
    if (!webhook_url) {
      return Response.json({ error: 'webhook_url is required' }, { status: 400 });
    }

    console.log('Registering Manus webhook:', webhook_url);

    const res = await fetch(`${MANUS_BASE}/webhooks`, {
      method: 'POST',
      headers: manusHeaders,
      body: JSON.stringify({ webhook: { url: webhook_url } }),
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Manus webhook registration failed:', errText);
      return Response.json({ error: 'ลงทะเบียน Webhook ล้มเหลว', details: errText }, { status: 500 });
    }

    const data = await res.json();
    console.log('Webhook registered:', data.webhook_id);

    // Save webhook_id to AppConfig
    const existing = configs.find(c => c.key === 'manus_webhook_id');
    if (existing) {
      await base44.asServiceRole.entities.AppConfig.update(existing.id, { value: data.webhook_id });
    } else {
      await base44.asServiceRole.entities.AppConfig.create({
        key: 'manus_webhook_id',
        value: data.webhook_id,
        description: 'Manus Webhook ID ที่ลงทะเบียนไว้',
      });
    }

    return Response.json({ success: true, webhook_id: data.webhook_id });
  }

  if (action === 'delete') {
    const webhookId = configs.find(c => c.key === 'manus_webhook_id')?.value;
    if (!webhookId) {
      return Response.json({ error: 'ไม่พบ Webhook ID' }, { status: 400 });
    }

    console.log('Deleting Manus webhook:', webhookId);
    const res = await fetch(`${MANUS_BASE}/webhooks/${webhookId}`, {
      method: 'DELETE',
      headers: manusHeaders,
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Manus webhook delete failed:', errText);
      return Response.json({ error: 'ลบ Webhook ล้มเหลว', details: errText }, { status: 500 });
    }

    // Clear saved webhook_id
    const existing = configs.find(c => c.key === 'manus_webhook_id');
    if (existing) {
      await base44.asServiceRole.entities.AppConfig.update(existing.id, { value: '' });
    }

    return Response.json({ success: true });
  }

  return Response.json({ error: 'Invalid action. Use "register" or "delete".' }, { status: 400 });
});