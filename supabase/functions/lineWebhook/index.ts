import { createClientFromRequest } from '../_shared/base44-compat.ts';
import { createHmac } from 'node:crypto';

// ===================== REQUEST CLASSIFIER =====================
const DEFAULT_REQUEST_KEYWORDS = {
  tax_invoice: [
    'ใบกำกับภาษี','กำกับภาษี','ออกใบกำกับ','เปิดใบกำกับ','ใบกำกับ',
    'ใบกำกับขาย','กำกับขาย','ใบกำกับเต็มรูป','เต็มรูป','ใบกำกับอย่างย่อ','อย่างย่อ','ใบกำกับย่อ',
    'เปิดบิล','ออกบิล','บิลขาย','ออกบิลขาย','ขอบิล',
    'tax invoice','full tax','vat invoice','tax inv',
  ],
  wht_cert: [
    'หัก ณ ที่จ่าย','หักภาษี ณ ที่จ่าย','ใบหัก','หนังสือรับรองหัก','หนังสือรับรองการหักภาษี',
    '50 ทวิ','๕๐ ทวิ','ทวิ',
    'ภ.ง.ด.1','ภ.ง.ด.2','ภ.ง.ด.3','ภ.ง.ด.53','ภ.ง.ด.54',
    'ภงด1','ภงด2','ภงด3','ภงด53','ภงด54',
    'pnd1','pnd2','pnd3','pnd53','pnd54',
    'wht','withholding','withholding tax',
    'ออกหัก','ทำหัก ณ','ขอใบหัก',
  ],
  sso_enroll: [
    'แจ้งเข้าประกันสังคม','เข้าประกันสังคม','ขึ้นประกันสังคม',
    'แจ้งเข้า ปกส','เข้าปกส','แจ้งเข้า สปส','เข้าสปส',
    'ขึ้นทะเบียนผู้ประกันตน','ขึ้นทะเบียน','แจ้งขึ้นทะเบียน','ขึ้นทะเบียนนายจ้าง',
    'สปส.1-03','สปส.1-02','สปส 1-03','สปส 1-02',
    'พนักงานเข้าใหม่','พนักงานใหม่','รับพนักงานใหม่','มีพนักงานเข้า','คนเข้าใหม่','จ้างพนักงานใหม่','เพิ่มพนักงาน',
  ],
  sso_terminate: [
    'แจ้งออกประกันสังคม','ออกประกันสังคม',
    'แจ้งออก ปกส','ออกปกส','แจ้งออก สปส','ออกสปส',
    'แจ้งลาออก','ลาออก','พนักงานลาออก','มีคนลาออก','พนักงานออก','มีพนักงานออก','เลิกจ้าง',
    'สปส.6-09','สปส 6-09','แจ้งสิ้นสุด','สิ้นสุดความเป็นผู้ประกันตน',
  ],
};

const TYPE_META = {
  tax_invoice:   { statutory: false, priority: 'medium' },
  wht_cert:      { statutory: true,  priority: 'high' },
  sso_enroll:    { statutory: true,  priority: 'high' },
  sso_terminate: { statutory: true,  priority: 'high' },
  other:         { statutory: false, priority: 'medium' },
};

const PRIORITY_ORDER = ['sso_terminate','sso_enroll','wht_cert','tax_invoice'];
const NEGATION_CUES = ['ไม่ต้อง','ยังไม่','ไม่เอา','ยกเลิก','งด','ไม่ใช่','เดี๋ยวก่อน'];

function normalizeText(s) {
  return (s || '').toLowerCase().replace(/[\s.\-/]/g, '');
}

async function loadKeywordMap(base44) {
  try {
    const rows = await base44.asServiceRole.entities.RequestKeyword.filter({ active: true });
    if (!rows || rows.length === 0) return DEFAULT_REQUEST_KEYWORDS;
    const map = {};
    for (const r of rows) {
      if (!r.request_type || !r.keyword) continue;
      if (!map[r.request_type]) map[r.request_type] = [];
      map[r.request_type].push(r.keyword);
    }
    return Object.keys(map).length > 0 ? map : DEFAULT_REQUEST_KEYWORDS;
  } catch (e) {
    console.warn('loadKeywordMap failed, using defaults:', e.message);
    return DEFAULT_REQUEST_KEYWORDS;
  }
}

function classifyRequest(content, keywordMap) {
  const compact = normalizeText(content);
  if (!compact) {
    return { request_type: 'other', is_actionable: false, has_statutory_deadline: false,
             auto_priority: 'low', multi_request: false, needs_review: false };
  }

  const kwMap = (keywordMap && Object.keys(keywordMap).length) ? keywordMap : DEFAULT_REQUEST_KEYWORDS;

  const matched = [];
  for (const [type, kws] of Object.entries(kwMap)) {
    if (kws.some((k) => compact.includes(normalizeText(k)))) matched.push(type);
  }

  let request_type = 'other';
  let multi_request = false;
  if (matched.length > 0) {
    request_type = PRIORITY_ORDER.find((t) => matched.includes(t)) || matched[0];
    multi_request = matched.length > 1;
  }

  const meta = TYPE_META[request_type] || TYPE_META.other;
  const hasNegation = NEGATION_CUES.some((n) => compact.includes(normalizeText(n)));
  const is_actionable = matched.length > 0;

  return {
    request_type,
    is_actionable,
    has_statutory_deadline: is_actionable ? meta.statutory : false,
    auto_priority: is_actionable ? meta.priority : 'low',
    multi_request,
    needs_review: matched.length > 0 && hasNegation,
  };
}
// =================== END REQUEST CLASSIFIER ===================

Deno.serve(async (req) => {
  if (req.method === 'GET') {
    return Response.json({ status: 'ok' }, { status: 200 });
  }

  try {
    const body = await req.text();

    if (!body || body.trim() === '') {
      return Response.json({ status: 'ok' }, { status: 200 });
    }

    let payload;
    try {
      payload = JSON.parse(body);
    } catch {
      return Response.json({ status: 'ok' }, { status: 200 });
    }

    if (!payload.events || payload.events.length === 0) {
      return Response.json({ status: 'ok' }, { status: 200 });
    }

    const base44 = createClientFromRequest(req);

    const configs = await base44.asServiceRole.entities.AppConfig.filter({});
    const getVal = (key) => configs.find(c => c.key === key)?.value || '';
    const channelSecret = getVal('line_channel_secret');
    const accessToken = getVal('line_access_token');

    if (!channelSecret || !accessToken) {
      return Response.json({ error: 'LINE OA not configured' }, { status: 400 });
    }

    // Verify LINE signature — FAIL-CLOSED (แก้ R11)
    // เดิม: ถ้าไม่มี signature จะข้ามการตรวจ → คนนอกยิง event ปลอมได้
    // ใหม่: ไม่มี/ผิด signature = 403 (channelSecret ถูกเช็คว่ามีแล้วด้านบน)
    const signature = req.headers.get('x-line-signature');
    if (!signature) {
      console.error('Missing x-line-signature');
      return Response.json({ error: 'Missing signature' }, { status: 403 });
    }
    {
      const hmac = createHmac('SHA256', channelSecret);
      hmac.update(body);
      const expectedSig = hmac.digest('base64');
      if (signature !== expectedSig) {
        console.error('Invalid LINE signature');
        return Response.json({ error: 'Invalid signature' }, { status: 403 });
      }
    }

    const keywordMap = await loadKeywordMap(base44);
    const events = payload.events || [];

    for (const event of events) {
     try {
      // Auto-capture Group ID in AppConfig
      if (event.source?.type === 'group' && event.source?.groupId) {
        const existingGroupConfig = configs.find(c => c.key === 'line_group_id');
        const currentGroupId = existingGroupConfig?.value || '';
        if (currentGroupId !== event.source.groupId) {
          if (existingGroupConfig) {
            await base44.asServiceRole.entities.AppConfig.update(existingGroupConfig.id, { value: event.source.groupId });
          } else {
            await base44.asServiceRole.entities.AppConfig.create({ key: 'line_group_id', value: event.source.groupId, description: 'LINE Group ID (auto-captured)' });
          }
          console.log(`Auto-captured LINE Group ID: ${event.source.groupId}`);
        }
      }

      if (event.type === 'message') {
        const sourceType = event.source?.type; // 'user', 'group', 'room'
        const userId = event.source?.userId;
        const groupId = event.source?.groupId;
        const roomId = event.source?.roomId;
        const msg = event.message;
        const messageType = msg?.type || 'text';

        // Determine chat key: group/room ID for group chats, userId for 1-on-1
        const isGroup = sourceType === 'group' || sourceType === 'room';
        const chatKey = isGroup ? (groupId || roomId) : userId;
        const chatType = isGroup ? 'group' : 'user';

        // Fetch sender profile (the person who sent the message)
        let senderName = userId || 'Unknown';
        let senderImage = '';
        if (userId) {
          try {
            let profileUrl;
            if (sourceType === 'group' && groupId) {
              profileUrl = `https://api.line.me/v2/bot/group/${groupId}/member/${userId}`;
            } else if (sourceType === 'room' && roomId) {
              profileUrl = `https://api.line.me/v2/bot/room/${roomId}/member/${userId}`;
            } else {
              profileUrl = `https://api.line.me/v2/bot/profile/${userId}`;
            }
            const profileRes = await fetch(profileUrl, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (profileRes.ok) {
              const profile = await profileRes.json();
              senderName = profile.displayName || userId;
              senderImage = profile.pictureUrl || '';
            }
          } catch (e) {
            console.warn('Failed to fetch LINE profile:', e.message);
          }
        }

        // Fetch group/room name for display_name
        let chatDisplayName = senderName;
        let chatImage = senderImage;
        if (isGroup) {
          try {
            const groupUrl = sourceType === 'group'
              ? `https://api.line.me/v2/bot/group/${groupId}/summary`
              : `https://api.line.me/v2/bot/room/${roomId}/member/${userId}`;
            const groupRes = await fetch(groupUrl, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (groupRes.ok) {
              const groupData = await groupRes.json();
              chatDisplayName = groupData.groupName || `กลุ่ม ${(groupId || roomId).substring(0, 8)}`;
              chatImage = groupData.pictureUrl || '';
            }
          } catch (e) {
            chatDisplayName = `กลุ่ม ${(groupId || roomId).substring(0, 8)}`;
            console.warn('Failed to fetch group summary:', e.message);
          }
        }

        // Process message content
        let content = '';
        let fileUrl = '';

        if (messageType === 'text') {
          content = msg.text || '';
        } else if (messageType === 'sticker') {
          const stickerId = msg.stickerId;
          content = '[Sticker]';
          if (stickerId) {
            fileUrl = `https://stickershop.line-scdn.net/stickershop/v1/sticker/${stickerId}/iPhone/sticker.png`;
          }
        } else if (messageType === 'image' || messageType === 'video' || messageType === 'audio' || messageType === 'file') {
          content = messageType === 'image' ? '[รูปภาพ]'
            : messageType === 'video' ? '[วิดีโอ]'
            : messageType === 'audio' ? '[เสียง]'
            : `[ไฟล์: ${msg.fileName || 'file'}]`;

          try {
            const contentRes = await fetch(`https://api-data.line.me/v2/bot/message/${msg.id}/content`, {
              headers: { 'Authorization': `Bearer ${accessToken}` }
            });
            if (contentRes.ok) {
              const contentType = contentRes.headers.get('content-type') || 'application/octet-stream';
              const blob = await contentRes.blob();
              let ext = 'bin';
              if (messageType === 'image') ext = 'jpg';
              else if (messageType === 'video') ext = 'mp4';
              else if (messageType === 'audio') ext = 'm4a';
              else if (msg.fileName) ext = msg.fileName.split('.').pop() || 'bin';

              const fileName = `line_${messageType}_${msg.id}.${ext}`;
              const file = new File([blob], fileName, { type: contentType });
              const uploadResult = await base44.asServiceRole.integrations.Core.UploadFile({ file });
              fileUrl = uploadResult.file_url || '';
              console.log(`Uploaded LINE ${messageType} → ${fileUrl}`);
            }
          } catch (e) {
            console.warn(`Failed to process LINE ${messageType}:`, e.message);
          }
        } else {
          content = `[${messageType}]`;
        }

        const mappedType = (messageType === 'audio' || messageType === 'video') ? 'file'
          : (messageType === 'sticker') ? 'sticker'
          : (messageType === 'image') ? 'image'
          : (messageType === 'file') ? 'file'
          : 'text';

        // Only files (image/file with file_url) need Drive saving — mark others as already "saved"
        const needsDriveSave = fileUrl && (mappedType === 'image' || mappedType === 'file');

        const createdMsg = await base44.asServiceRole.entities.LineMessage.create({
          line_user_id: chatKey,
          display_name: chatDisplayName,
          profile_image: chatImage,
          sender_name: isGroup ? senderName : undefined,
          message_type: mappedType,
          content: content,
          direction: 'incoming',
          file_url: fileUrl || undefined,
          is_read: false,
          chat_type: chatType,
          drive_saved: !needsDriveSave,
        });

        console.log(`Saved incoming ${messageType} from ${senderName} in ${chatType} (${chatKey}): ${content}`);

        // Classify request and tag LineMessage (keyword-based, fast)
        if (mappedType === 'text' && content && createdMsg?.id) {
          try {
            const cls = classifyRequest(content, keywordMap);
            await base44.asServiceRole.entities.LineMessage.update(createdMsg.id, {
              request_type: cls.request_type,
              is_actionable: cls.is_actionable,
              has_statutory_deadline: cls.has_statutory_deadline,
              auto_priority: cls.auto_priority,
              multi_request: cls.multi_request,
              needs_review: cls.needs_review,
              triage_status: 'new',
            });
          } catch (e) {
            console.warn('classifyRequest failed (non-blocking):', e.message);
          }
        }

        // Detect LINE requests (tax invoice, withholding cert, SSO) for text messages
        if (messageType === 'text' && content && chatType) {
          (async () => {
            try {
              // Resolve customer from LineGroup mapping
              let custId = '';
              let custName = '';
              if (isGroup && chatKey) {
                const groups = await base44.asServiceRole.entities.LineGroup.filter({ group_id: chatKey }, '-created_date', 1);
                if (groups.length > 0) {
                  custId = groups[0].customer_id || '';
                  custName = groups[0].customer_name || '';
                }
              }
              await base44.asServiceRole.functions.invoke('detectLineRequest', {
                message: content,
                message_id: createdMsg?.id || '',
                line_user_id: chatKey,
                chat_type: chatType,
                sender_name: senderName,
                customer_id: custId,
                customer_name: custName,
              });
            } catch (e) {
              console.warn('detectLineRequest failed (non-blocking):', e.message);
            }
          })();
        }

        // Track group member for mention support
        if (isGroup && userId && groupId && senderName !== userId) {
          try {
            const existing = await base44.asServiceRole.entities.LineGroupMember.filter(
              { group_id: groupId, line_user_id: userId }, '-created_date', 1
            );
            if (existing.length > 0) {
              // Update display_name if changed
              if (existing[0].display_name !== senderName || existing[0].picture_url !== senderImage) {
                await base44.asServiceRole.entities.LineGroupMember.update(existing[0].id, {
                  display_name: senderName,
                  picture_url: senderImage || '',
                });
              }
            } else {
              await base44.asServiceRole.entities.LineGroupMember.create({
                group_id: groupId,
                line_user_id: userId,
                display_name: senderName,
                picture_url: senderImage || '',
              });
              console.log(`Tracked group member: ${senderName} (${userId}) in ${groupId}`);
            }
          } catch (e) {
            console.warn('Failed to track group member:', e.message);
          }
        }

        // Update display_name and profile_image on older messages (batch — max 5 at a time)
        // Run in background — do NOT await to avoid blocking subsequent events
        if (chatDisplayName || chatImage) {
          (async () => {
            try {
              const oldMsgs = await base44.asServiceRole.entities.LineMessage.filter(
                { line_user_id: chatKey },
                '-created_date',
                15
              );
              const toUpdate = oldMsgs.filter(old =>
                old.display_name !== chatDisplayName || old.profile_image !== chatImage
              ).slice(0, 5);
              for (const old of toUpdate) {
                try {
                  await base44.asServiceRole.entities.LineMessage.update(old.id, {
                    display_name: chatDisplayName,
                    profile_image: chatImage,
                  });
                } catch {}
              }
            } catch (e) {
              console.warn('Failed to update old messages display info:', e.message);
            }
          })();
        }

        // Auto-save files to Google Drive (images and documents only, skip video/audio)
        if (fileUrl && (messageType === 'image' || messageType === 'file')) {
          try {
            let ext = 'bin';
            if (messageType === 'image') ext = 'jpg';
            else if (messageType === 'video') ext = 'mp4';
            else if (messageType === 'audio') ext = 'm4a';
            else if (msg.fileName) ext = msg.fileName.split('.').pop() || 'bin';

            const driveFileName = msg.fileName || `line_${messageType}_${msg.id}.${ext}`;
            const driveContentType = messageType === 'image' ? 'image/jpeg'
              : messageType === 'video' ? 'video/mp4'
              : messageType === 'audio' ? 'audio/m4a'
              : 'application/octet-stream';

            const driveRes = await base44.asServiceRole.functions.invoke('saveLineFileToDrive', {
              file_url: fileUrl,
              file_name: driveFileName,
              content_type: driveContentType,
              chat_display_name: chatDisplayName,
              message_type: messageType,
              sender_name: senderName || chatDisplayName,
            });
            const driveData = driveRes?.data || driveRes;
            console.log(`Auto-saved to Google Drive: ${driveData?.folder_path || 'done'}`);
            // Mark as saved to Drive
            if (createdMsg?.id && (driveData?.success || driveData?.drive_file_id)) {
              await base44.asServiceRole.entities.LineMessage.update(createdMsg.id, { drive_saved: true, gdrive_file_id: driveData.drive_file_id || '' });
            }
          } catch (driveErr) {
            console.warn('Auto-save to Drive failed (non-blocking):', driveErr.message);
            // drive_saved stays false — retryDriveSave will pick it up later
          }
        }
      }
     } catch (eventErr) {
       console.error(`Error processing event (${event.type}):`, eventErr.message);
       // Continue processing remaining events
     }
    }

    return Response.json({ status: 'ok' });
  } catch (error) {
    console.error('LINE webhook error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});