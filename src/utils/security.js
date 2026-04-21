/**
 * Escapes special regex characters in a string
 * Prevents NoSQL injection through regex patterns
 */
function escapeRegex(str) {
  if (!str) return '';
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Creates a safe regex pattern for MongoDB queries
 * @param {string} search - User input to search for
 * @param {string} options - Regex options (default: 'i' for case-insensitive)
 */
function makeSafeRegex(search, options = 'i') {
  if (!search || typeof search !== 'string') return null;

  const escaped = escapeRegex(search.trim());
  if (escaped.length === 0) return null;

  try {
    return new RegExp(escaped, options);
  } catch (error) {
    return null;
  }
}

module.exports = {
  escapeRegex,
  makeSafeRegex
}
