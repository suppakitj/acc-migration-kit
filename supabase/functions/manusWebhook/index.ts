import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  // Manus sends POST with JSON payload
  if (req.method !== 'POST') {
    return Response.json({ ok: true, message: 'Webhook endpoint ready' });
  }

  const base44 = createClientFromRequest(req);
  let body;
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: 'Invalid JSON' }, { status: 400 });
  }

  console.log('Manus webhook received:', body.event_type, body.event_id);

  // Verify webhook secret — FAIL-CLOSED (แก้ R11)
  // ใหม่: บังคับต้องมี secret เสมอ + รับผ่าน header ก่อน (query เป็น fallback)
  const configs = await base44.asServiceRole.entities.AppConfig.list();
  const webhookSecret = configs.find(c => c.key === 'manus_webhook_secret')?.value;

  if (!webhookSecret) {
    console.error('manus_webhook_secret ยังไม่ได้ตั้งค่า — ปฏิเสธ webhook');
    return Response.json({ error: 'Webhook not configured' }, { status: 503 });
  }
  {
    const url = new URL(req.url);
    const provided = req.headers.get('x-webhook-secret') || url.searchParams.get('secret') || '';
    if (provided.length !== webhookSecret.length || provided !== webhookSecret) {
      console.error('Webhook secret mismatch');
      return Response.json({ error: 'Unauthorized' }, { status: 401 });
    }
  }

  // We only care about task_stopped with stop_reason=finish
  if (body.event_type !== 'task_stopped') {
    console.log('Ignoring event type:', body.event_type);
    return Response.json({ ok: true, message: 'Event acknowledged' });
  }

  const taskDetail = body.task_detail;
  if (!taskDetail || !taskDetail.task_id) {
    console.log('No task_detail in payload');
    return Response.json({ ok: true, message: 'No task detail' });
  }

  const taskId = taskDetail.task_id;
  console.log('Task stopped:', taskId, 'reason:', taskDetail.stop_reason);

  // Find OcrJob by manus_task_id
  const jobs = await base44.asServiceRole.entities.OcrJob.filter({ manus_task_id: taskId });
  if (!jobs || jobs.length === 0) {
    console.log('No OcrJob found for task_id:', taskId);
    return Response.json({ ok: true, message: 'No matching job' });
  }

  const job = jobs[0];
  console.log('Found OcrJob:', job.id, job.filename);

  // If task failed or needs input
  if (taskDetail.stop_reason === 'ask') {
    await base44.asServiceRole.entities.OcrJob.update(job.id, {
      status: 'failed',
      error_message: 'Manus ต้องการข้อมูลเพิ่มเติม — กรุณาตรวจสอบที่ Manus',
    });
    return Response.json({ ok: true, message: 'Job marked as needing input' });
  }

  // stop_reason === 'finish' — find Excel attachment
  const attachments = taskDetail.attachments || [];
  let excelAttachment = null;

  for (const att of attachments) {
    if (att.file_name && (att.file_name.endsWith('.xlsx') || att.file_name.endsWith('.xls'))) {
      excelAttachment = att;
      break;
    }
  }

  if (!excelAttachment) {
    console.log('No Excel attachment found in webhook payload');
    await base44.asServiceRole.entities.OcrJob.update(job.id, {
      status: 'failed',
      error_message: 'ไม่พบไฟล์ Excel ในผลลัพธ์จาก Manus',
    });
    return Response.json({ ok: true, message: 'No Excel found' });
  }

  console.log('Excel found:', excelAttachment.file_name, excelAttachment.url);

  // Download Excel
  const excelRes = await fetch(excelAttachment.url);
  if (!excelRes.ok) {
    await base44.asServiceRole.entities.OcrJob.update(job.id, {
      status: 'failed',
      error_message: 'ดาวน์โหลด Excel จาก Manus ล้มเหลว',
    });
    return Response.json({ ok: true, message: 'Excel download failed' });
  }
  const excelBuffer = await excelRes.arrayBuffer();

  // Upload to Google Drive if configured
  const outputFolderId = configs.find(c => c.key === 'gdrive_output_folder_id')?.value;
  let gdriveFileId = null;

  if (outputFolderId) {
    try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');

      const metadata = {
        name: excelAttachment.file_name || `${job.filename.replace('.pdf', '')}_extracted.xlsx`,
        parents: [outputFolderId],
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      };

      const boundary = 'webhook_boundary_' + Date.now();
      const metadataStr = JSON.stringify(metadata);
      const encoder = new TextEncoder();
      const metaPart = encoder.encode(
        `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataStr}\r\n`
      );
      const filePart = encoder.encode(`--${boundary}\r\nContent-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet\r\n\r\n`);
      const endPart = encoder.encode(`\r\n--${boundary}--`);

      const bodyArr = new Uint8Array(metaPart.length + filePart.length + excelBuffer.byteLength + endPart.length);
      bodyArr.set(metaPart, 0);
      bodyArr.set(filePart, metaPart.length);
      bodyArr.set(new Uint8Array(excelBuffer), metaPart.length + filePart.length);
      bodyArr.set(endPart, metaPart.length + filePart.length + excelBuffer.byteLength);

      console.log('Uploading Excel to Google Drive...');
      const driveRes = await fetch(
        'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink',
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${accessToken}`,
            'Content-Type': `multipart/related; boundary=${boundary}`,
          },
          body: bodyArr,
        }
      );

      if (driveRes.ok) {
        const driveData = await driveRes.json();
        gdriveFileId = driveData.id;
        console.log('Uploaded to Google Drive:', gdriveFileId);
      } else {
        const errText = await driveRes.text();
        console.error('Google Drive upload failed:', errText);
      }
    } catch (e) {
      console.error('Google Drive connection error:', e.message);
    }
  }

  // Update OcrJob as completed
  await base44.asServiceRole.entities.OcrJob.update(job.id, {
    status: 'completed',
    output_file_url: excelAttachment.url,
    gdrive_file_id: gdriveFileId || '',
  });

  console.log('OcrJob completed via webhook:', job.id);
  return Response.json({ ok: true, message: 'Job completed', job_id: job.id });
});