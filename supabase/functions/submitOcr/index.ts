import { createClientFromRequest } from '../_shared/base44-compat.ts';

const MANUS_BASE = 'https://api.manus.ai/v1';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me();
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

  const { ocr_job_id } = await req.json();
  if (!ocr_job_id) return Response.json({ error: 'ocr_job_id is required' }, { status: 400 });

  // Get OCR job record
  const job = await base44.entities.OcrJob.get(ocr_job_id);
  if (!job || !job.file_url) {
    return Response.json({ error: 'Job not found or no file_url' }, { status: 400 });
  }

  // Get Manus API Key from AppConfig
  const configs = await base44.asServiceRole.entities.AppConfig.list();
  const manusApiKey = configs.find(c => c.key === 'manus_api_key')?.value;
  if (!manusApiKey) {
    await base44.entities.OcrJob.update(ocr_job_id, { status: 'failed', error_message: 'Manus API Key not configured' });
    return Response.json({ error: 'Manus API Key not configured' }, { status: 400 });
  }

  const manusHeaders = { 'API_KEY': manusApiKey, 'Content-Type': 'application/json' };

  // Step 1: Create file record on Manus
  console.log('Creating file record on Manus for:', job.filename);
  const fileRes = await fetch(`${MANUS_BASE}/files`, {
    method: 'POST',
    headers: manusHeaders,
    body: JSON.stringify({ filename: job.filename }),
  });

  if (!fileRes.ok) {
    const errText = await fileRes.text();
    await base44.entities.OcrJob.update(ocr_job_id, { status: 'failed', error_message: `Manus file create failed: ${errText}` });
    return Response.json({ error: 'Manus file create failed', details: errText }, { status: 500 });
  }

  const fileData = await fileRes.json();
  console.log('Manus file created:', fileData.id);

  // Step 2: Download file from our storage
  console.log('Downloading file from:', job.file_url);
  const fileDownloadRes = await fetch(job.file_url);
  if (!fileDownloadRes.ok) {
    await base44.entities.OcrJob.update(ocr_job_id, { status: 'failed', error_message: 'Failed to download file' });
    return Response.json({ error: 'Failed to download file' }, { status: 500 });
  }
  const fileBuffer = await fileDownloadRes.arrayBuffer();

  // Detect content type from filename
  const fileName = job.filename.toLowerCase();
  let contentType = 'application/octet-stream';
  if (fileName.endsWith('.pdf')) contentType = 'application/pdf';
  else if (fileName.endsWith('.png')) contentType = 'image/png';
  else if (fileName.endsWith('.jpg') || fileName.endsWith('.jpeg')) contentType = 'image/jpeg';
  else if (fileName.endsWith('.tiff')) contentType = 'image/tiff';
  else if (fileName.endsWith('.bmp')) contentType = 'image/bmp';
  else if (fileName.endsWith('.gif')) contentType = 'image/gif';
  else if (fileName.endsWith('.webp')) contentType = 'image/webp';

  // Step 3: Upload file to Manus presigned URL
  console.log('Uploading file to Manus S3...');
  const uploadRes = await fetch(fileData.upload_url, {
    method: 'PUT',
    body: fileBuffer,
    headers: { 'Content-Type': contentType },
  });

  if (!uploadRes.ok) {
    const errText = await uploadRes.text();
    await base44.entities.OcrJob.update(ocr_job_id, { status: 'failed', error_message: `Manus upload failed: ${errText}` });
    return Response.json({ error: 'Manus upload failed' }, { status: 500 });
  }
  console.log('File uploaded to Manus successfully');

  // Step 4: Build prompt based on output_format and custom_prompt
  const outputFormat = job.output_format || 'excel';
  const customPrompt = job.custom_prompt || '';
  const baseName = job.filename.replace(/\.[^.]+$/, '');

  let prompt;
  if (customPrompt) {
    // User provided custom instructions
    const formatInstruction = outputFormat === 'word'
      ? `Please output the result as a Word (.docx) file named "${baseName}_output.docx".`
      : `Please output the result as an Excel (.xlsx) file named "${baseName}_output.xlsx".`;
    prompt = `${customPrompt}

${formatInstruction}

Important instructions:
- Keep the original Thai text as-is
- Be thorough and extract all relevant data from the document
- If the document contains tables, preserve the structure`;
  } else {
    // Default: auto-detect and extract data
    if (outputFormat === 'word') {
      prompt = `You are a professional document OCR specialist.
Please analyze the attached document and convert its content into a well-formatted Word (.docx) file.

Important instructions:
- Extract ALL text, tables, and data from the document
- Preserve the original structure and formatting as much as possible
- Keep the original Thai text as-is
- If there are tables, recreate them in Word format
- Name the file: "${baseName}_extracted.docx"

Please output the result as a Word (.docx) file.`;
    } else {
      prompt = `You are a professional document data extraction expert.
Please analyze the attached document and extract ALL data into an Excel (.xlsx) file.

Important instructions:
- Extract EVERY piece of data, do not skip any rows
- Keep the original Thai text as-is
- If the document contains tables, preserve the column structure
- Format numbers with 2 decimal places where applicable
- If a field is empty, leave it blank
- Name the file: "${baseName}_extracted.xlsx"

Please output the result as an Excel (.xlsx) file.`;
    }
  }

  console.log('Creating Manus OCR task...');
  const taskRes = await fetch(`${MANUS_BASE}/tasks`, {
    method: 'POST',
    headers: manusHeaders,
    body: JSON.stringify({
      prompt,
      agentProfile: 'manus-1.6',
      attachments: [{ type: 'file_id', file_id: fileData.id }],
    }),
  });

  if (!taskRes.ok) {
    const errText = await taskRes.text();
    await base44.entities.OcrJob.update(ocr_job_id, { status: 'failed', error_message: `Manus task create failed: ${errText}` });
    return Response.json({ error: 'Manus task create failed', details: errText }, { status: 500 });
  }

  const taskData = await taskRes.json();
  console.log('Manus task created:', taskData.task_id);

  // Update job with task info
  await base44.entities.OcrJob.update(ocr_job_id, {
    status: 'processing',
    manus_task_id: taskData.task_id,
    manus_task_url: taskData.task_url || '',
  });

  return Response.json({
    success: true,
    task_id: taskData.task_id,
    task_url: taskData.task_url,
  });
});