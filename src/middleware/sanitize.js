const { sanitizeInput } = require('../utils/sanitize')

/**
 * Middleware to sanitize all string inputs in request body
 * Prevents XSS attacks by removing HTML from user input
 */
function sanitizeRequestBody(req, res, next) {
  if (!req.body || typeof req.body !== 'object') {
    return next()
  }

  const fieldsToSanitize = [
    'comment', 'description', 'text', 'title', 'name',
    'message', 'content', 'reason', 'notes', 'feedback'
  ]

  const sanitizeValue = (value) => {
    if (typeof value === 'string') {
      return sanitizeInput(value)
    }
    if (Array.isArray(value)) {
      return value.map(v => sanitizeValue(v))
    }
    if (typeof value === 'object' && value !== null) {
      return sanitizeObject(value)
    }
    return value
  }

  const sanitizeObject = (obj) => {
    const sanitized = {}
    for (const [key, value] of Object.entries(obj)) {
      if (fieldsToSanitize.includes(key) || key.toLowerCase().includes('text')) {
        sanitized[key] = sanitizeValue(value)
      } else {
        sanitized[key] = value
      }
    }
    return sanitized
  }

  req.body = sanitizeObject(req.body)
  next()
}

module.exports = sanitizeRequestBody
