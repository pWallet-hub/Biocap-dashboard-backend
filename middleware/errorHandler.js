const errorHandler = (err, req, res, next) => {
  if (err.name === 'ValidationError') {
    return res.status(400).json({ error: err.message });
  }

  if (err.code === 11000) {
    const field = Object.keys(err.keyPattern || {})[0] || 'field';
    return res.status(400).json({ error: `A record with this ${field} already exists` });
  }

  if (err.name === 'CastError') {
    return res.status(400).json({ error: 'Invalid identifier in request' });
  }

  if (err.statusCode) {
    return res.status(err.statusCode).json({ error: err.message });
  }

  console.error('[API Error]', err);
  res.status(500).json({ error: err.message || 'Internal server error' });
};

module.exports = errorHandler;
