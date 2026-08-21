import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    
    const user = await base44.auth.me();
    if (!user) {
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { line_user_id, message, display_name, chat_type, file_url, file_type, mentions, reply_to_id } = await req.json();

    if (!line_user_id || (!message && !file_url)) {
      return Response.json({ error: 'line_user_id and (message or file_url) are required' }, { status: 400 });
    }

    // Get LINE access token from AppConfig
    const configs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'line_access_token' }, '-created_date', 1);
    const accessToken = configs[0]?.value || '';

    if (!accessToken) {
      return Response.json({ error: 'LINE OA access token not configured.' }, { status: 400 });
    }

    // Build LINE message object
    let lineMessage;
    let savedMessageType = 'text';

    if (file_url) {
      // Determine type from file_type hint or URL extension
      const isImage = file_type === 'image' || /\.(jpg|jpeg|png|gif|webp)(\?|$)/i.test(file_url);

      if (isImage) {
        lineMessage = {
          type: 'image',
          originalContentUrl: file_url,
          previewImageUrl: file_url,
        };
        savedMessageType = 'image';
      } else {
        // For non-image files, send as text with link
        const fileName = message || 'ไฟล์';
        lineMessage = {
          type: 'text',
          text: `📎 ${fileName}\n${file_url}`,
        };
        savedMessageType = 'file';
      }
    } else if (mentions && mentions.length > 0) {
      // Use Text message v2 with mention substitution
      let textV2 = message;
      const substitution = {};

      mentions.forEach((m, idx) => {
        const placeholder = `mention${idx}`;
        textV2 = textV2.replace(`@${m.display_name}`, `{${placeholder}}`);
        if (m.line_user_id === '__ALL__' || m.isAll) {
          // @All — mention ทุกคนในกลุ่ม
          substitution[placeholder] = {
            type: 'mention',
            mentionee: {
              type: 'all',
            },
          };
        } else {
          substitution[placeholder] = {
            type: 'mention',
            mentionee: {
              type: 'user',
              userId: m.line_user_id,
            },
          };
        }
      });

      lineMessage = {
        type: 'textV2',
        text: textV2,
        substitution,
      };
    } else {
      lineMessage = { type: 'text', text: message };
    }

    // Send message via LINE Push API
    const lineRes = await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        to: line_user_id,
        messages: [lineMessage],
      }),
    });

    if (!lineRes.ok) {
      const errBody = await lineRes.text();
      console.error('LINE API error:', lineRes.status, errBody);
      return Response.json({ error: `LINE API error: ${lineRes.status} - ${errBody}` }, { status: 502 });
    }

    // Save outgoing message to LineMessage entity
    await base44.asServiceRole.entities.LineMessage.create({
      line_user_id,
      display_name: display_name || line_user_id,
      content: file_url ? (message || (savedMessageType === 'image' ? '[รูปภาพ]' : '[ไฟล์]')) : message,
      direction: 'outgoing',
      message_type: savedMessageType,
      file_url: file_url || undefined,
      is_read: true,
      replied_by: user.initials || user.nickname || user.full_name || user.email,
      chat_type: chat_type || 'user',
      reply_to_id: reply_to_id || undefined,
    });

    console.log(`Sent ${savedMessageType} to ${line_user_id} (mentions: ${mentions?.length || 0})`);
    return Response.json({ status: 'sent', type: savedMessageType });
  } catch (error) {
    console.error('Send message error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});