function normalizeTypes(type) {
  return (Array.isArray(type) ? type : [type]).filter(value => value !== 'null');
}

function inferFormat(key, property) {
  if (property.format) return property.format;
  if (key === 'date' || key.endsWith('_date')) return 'date';
  if (key === 'time' || key.endsWith('_time')) return 'time';
  return undefined;
}

function defaultOperators(key, property) {
  const types = normalizeTypes(property.type);
  if (types.includes('number') || types.includes('integer')) {
    return ['equals', 'greater_than', 'less_than', 'between', 'exists'];
  }
  if (inferFormat(key, property) === 'date') {
    return ['equals', 'before', 'after', 'between', 'exists'];
  }
  if (Array.isArray(property.enum)) {
    return ['equals', 'in', 'exists'];
  }
  return ['equals', 'contains', 'starts_with', 'in', 'exists'];
}

function createExtractionSchemeController({ db }) {
  async function listSchemes(req, res) {
    const snapshot = await db.collection('extraction_schemes').where('is_enabled', '==', true).get();
    const schemes = snapshot.docs.map(doc => {
      const data = doc.data() || {};
      return {
        schema_id: doc.id,
        name: data.name || doc.id,
        version: data.version || 1
      };
    }).sort((first, second) => first.name.localeCompare(second.name));

    return res.json({ success: true, schemes });
  }

  async function getScheme(req, res) {
    const schemeDoc = await db.collection('extraction_schemes').doc(req.params.schemaId).get();
    if (!schemeDoc.exists) return res.status(404).json({ error: 'Extraction scheme not found' });

    const data = schemeDoc.data() || {};
    if (data.is_enabled !== true) return res.status(404).json({ error: 'Extraction scheme is disabled' });

    const properties = data.schema?.properties || {};
    const fields = Object.entries(properties)
      .filter(([, property]) => property.rule?.enabled !== false)
      .map(([key, property]) => ({
        key,
        label: property.rule?.label || key.replaceAll('_', ' '),
        types: normalizeTypes(property.type),
        format: inferFormat(key, property),
        operators: property.rule?.operators || defaultOperators(key, property),
        enum: (property.enum || []).filter(value => value !== null)
      }));

    return res.json({
      success: true,
      scheme: {
        schema_id: schemeDoc.id,
        name: data.name,
        version: data.version,
        fields
      }
    });
  }

  return { listSchemes, getScheme };
}

module.exports = { createExtractionSchemeController };
