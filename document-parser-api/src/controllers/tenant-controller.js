function createTenantController({ admin, db }) {
  async function getTenant(req, res) {
    const tenantDoc = await db.collection('tenants').doc(req.user.uid).get();
    if (!tenantDoc.exists) return res.status(404).json({ error: 'Tenant not found' });
    return res.json({ success: true, tenant: { id: tenantDoc.id, ...tenantDoc.data() } });
  }

  async function createTenant(req, res) {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Missing required field: name' });
    const tenantData = {
      tenant_id: req.user.uid,
      name,
      email: req.user.email,
      active: true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('tenants').doc(req.user.uid).set(tenantData, { merge: true });
    return res.status(201).json({ success: true, tenant: { ...tenantData, id: req.user.uid } });
  }

  async function updateTenant(req, res) {
    const updateData = { updated_at: admin.firestore.FieldValue.serverTimestamp() };
    if (req.body.name !== undefined) updateData.name = String(req.body.name).trim();
    if (req.body.active !== undefined) updateData.active = Boolean(req.body.active);
    await db.collection('tenants').doc(req.user.uid).update(updateData);
    return getTenant(req, res);
  }

  async function listTenants(req, res) {
    const tenantDoc = await db.collection('tenants').doc(req.user.uid).get();
    return res.json({ success: true, tenants: tenantDoc.exists ? [{ id: tenantDoc.id, ...tenantDoc.data() }] : [] });
  }

  async function deleteTenant(req, res) {
    await db.collection('tenants').doc(req.user.uid).delete();
    return res.json({ success: true, message: 'Tenant deleted successfully' });
  }

  return { createTenant, getTenant, updateTenant, listTenants, deleteTenant };
}

module.exports = { createTenantController };