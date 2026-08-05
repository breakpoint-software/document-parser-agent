function createDriveController() {
  async function shareFile(req, res) {
    const { fileId, fileName, role } = req.body;
    if (!fileId || !fileName) {
      return res.status(400).json({ error: 'Missing required fields: fileId, fileName' });
    }

    return res.json({
      success: true,
      message: 'File sharing request accepted',
      file: { fileId, fileName, role }
    });
  }

  return { shareFile };
}

module.exports = { createDriveController };