import { createClientFromRequest } from '../_shared/base44-compat.ts';

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const { event, data, old_data } = await req.json();

    // Only process if customer has peak_licensing in services
    const services = data?.services || [];
    if (!services.includes('peak_licensing')) {
      // If peak_licensing was removed, skip (don't delete existing licenses)
      return Response.json({ status: 'skipped', reason: 'no peak_licensing service' });
    }

    const customerId = event?.entity_id;
    if (!customerId) {
      return Response.json({ status: 'skipped', reason: 'no entity_id' });
    }

    // Check if PeakLicense already exists for this customer
    const existing = await base44.asServiceRole.entities.PeakLicense.filter(
      { customer_id: customerId }
    );

    if (existing.length > 0) {
      // Already has a license record — update customer_name if changed
      if (data.company_name && existing[0].customer_name !== data.company_name) {
        await base44.asServiceRole.entities.PeakLicense.update(existing[0].id, {
          customer_name: data.company_name,
        });
        return Response.json({ status: 'updated_name', license_id: existing[0].id });
      }
      return Response.json({ status: 'skipped', reason: 'license already exists', license_id: existing[0].id });
    }

    // Create new PeakLicense record from Customer data
    const peakPackage = data.peak_package || 'pro';
    const paymentDate = data.peak_license_start || null;
    const expiryDate = data.peak_license_end || null;

    const licenseData = {
      customer_id: customerId,
      customer_name: data.company_name || '',
      package_type: peakPackage === 'none' ? 'basic' : peakPackage,
      payer_type: 'customer_direct_peak',
      license_status: 'active',
      is_affiliate: false,
      acc_prepaid: false,
      customer_paid_back: false,
      invoice_issued: false,
      invoice_paid: false,
      wht_received: false,
    };

    if (paymentDate) licenseData.payment_date = paymentDate;
    if (expiryDate) licenseData.expiry_date = expiryDate;

    const created = await base44.asServiceRole.entities.PeakLicense.create(licenseData);

    console.log(`Auto-created PeakLicense for customer ${data.company_name} (${customerId})`);
    return Response.json({ status: 'created', license_id: created.id });

  } catch (error) {
    console.error('syncPeakLicense error:', error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }
});