const errorHandler = (err, req, res, next) => {
  if (err.name === 'MulterError') {
    if (err.code === 'LIMIT_UNEXPECTED_FILE' && err.field === 'images') {
      return res.status(400).json({ error: 'A gallery collection can contain at most 20 images.' });
    }

    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return res.status(400).json({ error: `Unexpected upload field: ${err.field || 'unknown'}.` });
    }

    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({ error: 'An uploaded file exceeds the server upload limit.' });
    }

    return res.status(400).json({ error: err.message || 'Invalid multipart upload.' });
  }

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
