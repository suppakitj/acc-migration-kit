import { createClientFromRequest } from '../_shared/base44-compat.ts';

/**
 * Retry monthly task generation — runs hourly on the 1st of each month.
 * Checks if tasks were already successfully generated for this month.
 * If not, calls autoGenerateMonthlyTasks with force_retry to bypass
 * the last_auto_generate check (dedup by existingKeys still works).
 */

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);

    // Bangkok timezone
    const now = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Bangkok' }));
    const currentDay = now.getDate();
    const currentMonth = now.getMonth() + 1;
    const currentYear = now.getFullYear();
    const monthKey = `${currentYear}-${String(currentMonth).padStart(2, '0')}`;

    // Only run on the 1st of the month (safety check)
    if (currentDay !== 1) {
      return Response.json({
        skipped: true,
        message: `วันนี้ไม่ใช่วันที่ 1 (วันที่ ${currentDay}) — ข้าม retry`,
      });
    }

    // Check if already generated
    const configs = await base44.asServiceRole.entities.AppConfig.filter({ key: 'last_auto_generate' });
    const lastGenerated = configs.length > 0 ? configs[0].value : '';

    if (lastGenerated === monthKey) {
      console.log(`Month ${monthKey} already generated — no retry needed`);
      return Response.json({
        skipped: true,
        message: `เดือน ${monthKey} สร้างงานสำเร็จแล้ว — ไม่ต้อง retry`,
      });
    }

    // Not generated yet — call autoGenerateMonthlyTasks with force_retry
    console.log(`Month ${monthKey} NOT generated yet (last: ${lastGenerated}) — triggering retry...`);

    const result = await base44.asServiceRole.functions.invoke('autoGenerateMonthlyTasks', {
      force_retry: true,
    });

    console.log(`Retry result:`, JSON.stringify(result));

    return Response.json({
      retried: true,
      month: monthKey,
      result,
    });
  } catch (error) {
    console.error('retryMonthlyTaskGeneration error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});