const RULE_FIELDS = ['rule_name', 'source_folder_id', 'source_folder_name', 'target_folder_id', 'target_folder_name', 'target_sheet_id', 'target_sheet_name', 'sheet_tab_name', 'parsing_prompt', 'schema_id', 'is_enabled'];
const REQUIRED_RULE_FIELDS = ['rule_name', 'source_folder_id', 'target_folder_id', 'target_sheet_id', 'sheet_tab_name', 'parsing_prompt'];

function serializeValue(value) {
  return value && typeof value.toDate === 'function' ? value.toDate().toISOString() : value;
}

function serializeRule(id, data) {
  return Object.fromEntries(Object.entries({ rule_id: id, ...data }).map(([key, value]) => [key, serializeValue(value)]));
}

function getPayload(body) {
  return RULE_FIELDS.reduce((payload, field) => {
    if (body[field] !== undefined) payload[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
    return payload;
  }, {});
}

function missingFields(rule) {
  return REQUIRED_RULE_FIELDS.filter(field => typeof rule[field] !== 'string' || !rule[field]);
}

function createRuleController({ admin, db }) {
  const rules = req => db.collection('tenants').doc(req.user.uid).collection('rules');

  async function listRules(req, res) {
    const snapshot = await rules(req).orderBy('updated_at', 'desc').get();
    return res.json({ success: true, rules: snapshot.docs.map(doc => serializeRule(doc.id, doc.data())) });
  }

  async function createRule(req, res) {
    const payload = getPayload(req.body);
    const missing = missingFields(payload);
    if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    Object.assign(payload, {
      is_enabled: payload.is_enabled ?? true,
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    });
    const ref = await rules(req).add(payload);
    const created = await ref.get();
    return res.status(201).json({ success: true, rule: serializeRule(ref.id, created.data()) });
  }

  async function updateRule(req, res) {
    const ref = rules(req).doc(req.params.ruleId);
    const current = await ref.get();
    if (!current.exists) return res.status(404).json({ error: 'Rule not found' });
    const payload = getPayload(req.body);
    const missing = missingFields({ ...current.data(), ...payload });
    if (missing.length) return res.status(400).json({ error: `Missing required fields: ${missing.join(', ')}` });
    payload.updated_at = admin.firestore.FieldValue.serverTimestamp();
    await ref.update(payload);
    const updated = await ref.get();
    return res.json({ success: true, rule: serializeRule(ref.id, updated.data()) });
  }

  async function deleteRule(req, res) {
    const ref = rules(req).doc(req.params.ruleId);
    const rule = await ref.get();
    if (!rule.exists) return res.status(404).json({ error: 'Rule not found' });
    await ref.delete();
    return res.json({ success: true, message: 'Rule deleted successfully' });
  }

  return { listRules, createRule, updateRule, deleteRule };
}

module.exports = { createRuleController };