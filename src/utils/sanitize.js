const { escape } = require('html-entities')

/**
 * Sanitize user input to prevent XSS attacks
 * Removes all HTML tags and dangerous content
 */
function sanitizeInput(input) {
  if (!input || typeof input !== 'string') return ''

  // Remove any HTML tags and trim
  return input.replace(/<[^>]*>/g, '').trim()
}

/**
 * Escape HTML special characters for safe storage/display
 */
function escapeHtml(text) {
  if (!text || typeof text !== 'string') return ''

  return escape(text)
}

/**
 * Sanitize an object's string fields
 */
function sanitizeObject(obj, fieldsToSanitize = []) {
  if (!obj || typeof obj !== 'object') return obj

  const sanitized = { ...obj }

  fieldsToSanitize.forEach(field => {
    if (sanitized[field] && typeof sanitized[field] === 'string') {
      sanitized[field] = sanitizeInput(sanitized[field])
    }
  })

  return sanitized
}

module.exports = {
  sanitizeInput,
  escapeHtml,
  sanitizeObject
}
