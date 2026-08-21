function createWorkspaceController({ admin, db, processorUrl, processorApiKey }) {
  function getWorkspaceRef(req) {
    return db.collection('workspaces').doc(req.params.workspaceId);
  }

  async function getWorkspace(req, res) {
    const workspaceRef = getWorkspaceRef(req);
    const workspaceDoc = await workspaceRef.get();
    if (!workspaceDoc.exists) return res.status(404).json({ error: 'Workspace not found' });
    return res.json({ success: true, workspace: { id: workspaceDoc.id, ...workspaceDoc.data() } });
  }

  async function createWorkspace(req, res) {
    const name = String(req.body.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Missing required field: name' });
    const workspaceRef = db.collection('workspaces').doc();
    const workspaceData = {
      workspace_id: workspaceRef.id,
      owner_id: req.user.uid,
      name,
      email: req.user.email,
      active: true,
      execution_mode: 'source_by_rule',
      created_at: admin.firestore.FieldValue.serverTimestamp(),
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };
    await workspaceRef.set(workspaceData);
    return res.status(201).json({ success: true, workspace: { ...workspaceData, id: workspaceRef.id } });
  }

  async function updateWorkspace(req, res) {
    const updateData = { updated_at: admin.firestore.FieldValue.serverTimestamp() };
    if (req.body.name !== undefined) updateData.name = String(req.body.name).trim();
    if (req.body.active !== undefined) updateData.active = Boolean(req.body.active);
    if (req.body.routing !== undefined) updateData.routing = req.body.routing;
    if (req.body.execution_mode !== undefined) {
      if (!['single_source', 'source_by_rule'].includes(req.body.execution_mode)) {
        return res.status(400).json({ error: 'Invalid execution_mode' });
      }
      updateData.execution_mode = req.body.execution_mode;
    }
    await getWorkspaceRef(req).update(updateData);
    return getWorkspace(req, res);
  }

  async function listWorkspaces(req, res) {
    const [ownedSnapshot, legacyWorkspace] = await Promise.all([
      db.collection('workspaces').where('owner_id', '==', req.user.uid).get(),
      db.collection('workspaces').doc(req.user.uid).get()
    ]);
    const workspaces = ownedSnapshot.docs.map(workspaceDoc => ({ id: workspaceDoc.id, ...workspaceDoc.data() }));
    if (legacyWorkspace.exists && !workspaces.some(workspace => workspace.id === legacyWorkspace.id)) {
      workspaces.unshift({ id: legacyWorkspace.id, ...legacyWorkspace.data() });
    }
    return res.json({ success: true, workspaces });
  }

  async function deleteWorkspace(req, res) {
    await getWorkspaceRef(req).delete();
    return res.json({ success: true, message: 'Workspace deleted successfully' });
  }

  async function processInboxUpload(req, res) {
    const fileId = typeof req.body.file_id === 'string' ? req.body.file_id.trim() : '';
    if (!fileId) return res.status(400).json({ error: 'file_id is required' });
    if (!processorUrl || !processorApiKey) {
      console.error('Processor integration is not configured');
      return res.status(503).json({ error: 'File processing is temporarily unavailable' });
    }

    let response;
    try {
      response = await fetch(`${processorUrl}/api/process-inbox-upload`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Orchestrator-API-Key': processorApiKey
        },
        body: JSON.stringify({ workspace_id: req.params.workspaceId, file_id: fileId }),
        signal: AbortSignal.timeout(120000)
      });
    } catch (error) {
      console.error('Processor inbox upload request failed:', error.message);
      return res.status(502).json({ error: 'Unable to reach the document processor' });
    }
    if (!response.ok) {
      console.error('Processor inbox upload request failed with status:', response.status);
      return res.status(502).json({ error: 'Unable to process the uploaded file' });
    }
    return res.json(await response.json());
  }

  return { createWorkspace, getWorkspace, updateWorkspace, listWorkspaces, deleteWorkspace, processInboxUpload };
}

module.exports = { createWorkspaceController };