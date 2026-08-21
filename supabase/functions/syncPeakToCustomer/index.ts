import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data } = await req.json();

    if (!data?.customer_id) {
      return Response.json({ status: 'skipped', reason: 'no customer_id' });
    }

    // Only sync active/renewed licenses
    const activeStatuses = ['active', 'renewed', 'expiring_soon'];
    if (!activeStatuses.includes(data.license_status)) {
      return Response.json({ status: 'skipped', reason: 'license not active' });
    }

    const updateData = {};

    if (data.payment_date) {
      updateData.peak_license_start = data.payment_date.split('T')[0].split(' ')[0];
    }
    if (data.expiry_date) {
      updateData.peak_license_end = data.expiry_date.split('T')[0].split(' ')[0];
    }
    if (data.package_type) {
      updateData.peak_package = data.package_type;
    }

    if (Object.keys(updateData).length === 0) {
      return Response.json({ status: 'skipped', reason: 'nothing to update' });
    }

    await base44.asServiceRole.entities.Customer.update(data.customer_id, updateData);

    console.log(`Synced PeakLicense → Customer ${data.customer_name}: ${JSON.stringify(updateData)}`);
    return Response.json({ status: 'updated', customer_id: data.customer_id, fields: updateData });

  } catch (error) {
    console.error('syncPeakToCustomer error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});