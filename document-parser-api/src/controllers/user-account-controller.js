function createUserAccountController({ admin, db }) {
  const accounts = db.collection('user-accounts');

  async function accountResponse(res, accountDoc) {
    const account = accountDoc.data();
    const workspaceDoc = await db.collection('workspaces').doc(account.workspace_id).get();
    return res.json({
      success: true,
      userAccount: { id: accountDoc.id, ...account },
      workspace: workspaceDoc.exists ? { id: workspaceDoc.id, ...workspaceDoc.data() } : null
    });
  }

  async function createAccount(req, res) {
    const uid = req.user.uid;
    const displayName = String(req.body.displayName || '').trim();
    const workspaceData = {
      workspace_id: uid,
      name: displayName || req.user.email.split('@')[0],
      email: req.user.email,
      active: true,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };
    await db.collection('workspaces').doc(uid).set(workspaceData, { merge: true });

    const accountData = {
      id: uid,
      uid,
      workspace_id: uid,
      email: req.user.email,
      displayName,
      photoURL: req.body.photoURL || '',
      balance: 0,
      updated_at: admin.firestore.FieldValue.serverTimestamp()
    };
    await accounts.doc(uid).set(accountData, { merge: true });
    const accountDoc = await accounts.doc(uid).get();
    res.status(201);
    return accountResponse(res, accountDoc);
  }

  async function getAccount(req, res) {
    const accountDoc = await accounts.doc(req.user.uid).get();
    if (!accountDoc.exists) return res.status(404).json({ error: 'User account not found' });
    return accountResponse(res, accountDoc);
  }

  async function updateAccount(req, res) {
    const updateData = { updated_at: admin.firestore.FieldValue.serverTimestamp() };
    if (req.body.displayName !== undefined) updateData.displayName = req.body.displayName;
    if (req.body.photoURL !== undefined) updateData.photoURL = req.body.photoURL;
    await accounts.doc(req.user.uid).update(updateData);
    return getAccount(req, res);
  }

  async function listWorkspaceAccounts(req, res) {
    const snapshot = await accounts.where('workspace_id', '==', req.user.uid).get();
    return res.json({ success: true, userAccounts: snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) });
  }

  async function deleteAccount(req, res) {
    await accounts.doc(req.user.uid).delete();
    return res.json({ success: true, message: 'User account deleted successfully' });
  }

  return { createAccount, getAccount, updateAccount, listWorkspaceAccounts, deleteAccount };
}

module.exports = { createUserAccountController };