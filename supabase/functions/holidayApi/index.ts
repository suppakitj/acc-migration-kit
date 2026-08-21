import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  const base44 = createClientFromRequest(req);

  // Verify API Key from header or query param
  const url = new URL(req.url);
  const apiKey = req.headers.get('x-api-key') || url.searchParams.get('api_key');
  const validKey = Deno.env.get('HOLIDAY_API_KEY');

  if (!apiKey || apiKey !== validKey) {
    return Response.json({ error: 'Unauthorized — invalid or missing API key' }, { status: 401 });
  }

  // Parse optional filters from query params
  const year = url.searchParams.get('year');
  const status = url.searchParams.get('status');
  const type = url.searchParams.get('type');

  // Fetch holidays using service role (no user auth needed)
  const filter = {};
  if (year) filter.year = Number(year);
  if (status) filter.status = status;
  if (type) filter.type = type;

  const holidays = await base44.asServiceRole.entities.HolidayMaster.filter(filter, 'date', 1000);

  // Return clean response
  const data = holidays.map(h => ({
    id: h.id,
    name_th: h.name_th,
    name_en: h.name_en || '',
    date: h.date,
    year: h.year,
    type: h.type,
    status: h.status,
    notes: h.notes || '',
  }));

  return Response.json({
    success: true,
    count: data.length,
    data,
  }, {
    headers: { 'Access-Control-Allow-Origin': '*' },
  });
});