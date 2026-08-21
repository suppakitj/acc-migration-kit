import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    // Get LINE config
    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';
    const accessToken = getVal('line_access_token');
    const channelId = getVal('line_channel_id');
    const channelSecret = getVal('line_channel_secret');

    if (!accessToken) {
      return Response.json({ error: 'No access token configured' }, { status: 400 });
    }

    // Test 1: Verify the bot info
    const botRes = await fetch('https://api.line.me/v2/bot/info', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const botStatus = botRes.status;
    let botInfo = null;
    let botError = null;
    if (botRes.ok) {
      botInfo = await botRes.json();
    } else {
      botError = await botRes.text();
    }

    // Test 2: Get webhook endpoint info
    const webhookRes = await fetch('https://api.line.me/v2/bot/channel/webhook/endpoint', {
      headers: { 'Authorization': `Bearer ${accessToken}` }
    });
    const webhookStatus = webhookRes.status;
    let webhookInfo = null;
    let webhookError = null;
    if (webhookRes.ok) {
      webhookInfo = await webhookRes.json();
    } else {
      webhookError = await webhookRes.text();
    }

    // Count messages in DB
    const messages = await base44.asServiceRole.entities.LineMessage.list('-created_date', 10);

    return Response.json({
      config: {
        channel_id: channelId,
        has_secret: !!channelSecret,
        has_token: !!accessToken,
        token_prefix: accessToken.substring(0, 10) + '...',
      },
      bot: {
        status: botStatus,
        info: botInfo,
        error: botError,
      },
      webhook: {
        status: webhookStatus,
        info: webhookInfo,
        error: webhookError,
      },
      db_messages_count: messages.length,
      latest_messages: messages.slice(0, 3).map(m => ({
        id: m.id,
        from: m.display_name,
        line_user_id: m.line_user_id,
        content: m.content?.substring(0, 50),
        direction: m.direction,
        created: m.created_date,
      })),
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});