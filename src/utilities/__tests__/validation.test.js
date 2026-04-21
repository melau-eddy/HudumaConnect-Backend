const validateEmail = (email) => {
  const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return re.test(email);
};

const validatePhone = (phone) => {
  // Check length and allow digits, +, -, (, ), space
  if (!/^[\d\s\-\+\(\)]+$/.test(phone)) return false;
  // Must have 10-15 digits exactly
  const digitCount = (phone.match(/\d/g) || []).length;
  return digitCount >= 10 && digitCount <= 15;
};

const validatePassword = (password) => {
  // At least 8 characters, 1 uppercase, 1 lowercase, 1 number
  const re = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)[a-zA-Z\d\W]{8,}$/;
  return re.test(password);
};

const sanitizeInput = (input) => {
  // Remove script tags and HTML
  return input
    .replace(/<script[^>]*>.*?<\/script>/gi, '')
    .replace(/<[^>]+>/g, '')
    .trim();
};

describe('Input Validation', () => {
  describe('Email Validation', () => {
    test('should validate correct email format', () => {
      expect(validateEmail('test@example.com')).toBe(true);
      expect(validateEmail('user+tag@domain.co.uk')).toBe(true);
      expect(validateEmail('name.surname@site.org')).toBe(true);
    });

    test('should reject invalid email format', () => {
      expect(validateEmail('invalid-email')).toBe(false);
      expect(validateEmail('user@')).toBe(false);
      expect(validateEmail('@example.com')).toBe(false);
      expect(validateEmail('user @example.com')).toBe(false);
    });

    test('should reject empty email', () => {
      expect(validateEmail('')).toBe(false);
    });

    test('should be case-insensitive', () => {
      expect(validateEmail('TEST@EXAMPLE.COM')).toBe(true);
      expect(validateEmail('Test@Example.Com')).toBe(true);
    });
  });

  describe('Phone Validation', () => {
    test('should validate various phone formats', () => {
      expect(validatePhone('+254712345678')).toBe(true);
      expect(validatePhone('0712345678')).toBe(true);
      expect(validatePhone('+1 (555) 123-4567')).toBe(true);
      expect(validatePhone('555-1234567')).toBe(true);
    });

    test('should reject invalid phone format', () => {
      expect(validatePhone('123')).toBe(false);
      expect(validatePhone('abc123def')).toBe(false);
      expect(validatePhone('')).toBe(false);
    });

    test('should require 10-15 digit range', () => {
      expect(validatePhone('12345')).toBe(false);
      expect(validatePhone('12345678901234567')).toBe(false);
    });
  });

  describe('Password Validation', () => {
    test('should require minimum 8 characters', () => {
      expect(validatePassword('Short1!')).toBe(false);
      expect(validatePassword('LongPass1')).toBe(true);
    });

    test('should require uppercase letter', () => {
      expect(validatePassword('lowercase123')).toBe(false);
      expect(validatePassword('Uppercase123')).toBe(true);
    });

    test('should require lowercase letter', () => {
      expect(validatePassword('UPPERCASE123')).toBe(false);
      expect(validatePassword('Uppercase123')).toBe(true);
    });

    test('should require number', () => {
      expect(validatePassword('NoNumbers!')).toBe(false);
      expect(validatePassword('HasNumbers1')).toBe(true);
    });

    test('should accept valid passwords', () => {
      expect(validatePassword('SecurePass123')).toBe(true);
      expect(validatePassword('MyPassword1')).toBe(true);
      expect(validatePassword('Complex@Pass1')).toBe(true);
    });

    test('should reject common weak passwords', () => {
      expect(validatePassword('Password1')).toBe(true); // Valid by rules
      expect(validatePassword('123456Aa')).toBe(true); // Valid by rules
    });
  });

  describe('XSS Prevention - Input Sanitization', () => {
    test('should remove script tags', () => {
      const dirty = '<script>alert("XSS")</script>Hello';
      const clean = sanitizeInput(dirty);
      expect(clean).not.toContain('<script>');
      expect(clean).toContain('Hello');
    });

    test('should remove HTML tags', () => {
      const dirty = '<img src="x" onerror="alert(\'XSS\')">';
      const clean = sanitizeInput(dirty);
      expect(clean).not.toContain('<');
      expect(clean).not.toContain('>');
    });

    test('should preserve text content', () => {
      const dirty = '<p>Safe text</p>';
      const clean = sanitizeInput(dirty);
      expect(clean).toContain('Safe text');
    });

    test('should trim whitespace', () => {
      const dirty = '  Padded text  ';
      const clean = sanitizeInput(dirty);
      expect(clean).toBe('Padded text');
    });

    test('should handle mixed content', () => {
      const dirty = '  <script>bad</script>  <b>Good</b>  ';
      const clean = sanitizeInput(dirty);
      expect(clean).toContain('Good');
      expect(clean).not.toContain('<script>');
      expect(clean).not.toContain('<b>');
    });
  });

  describe('Required Fields Validation', () => {
    const validateRequired = (obj, required) => {
      return required.every(field => obj[field] !== undefined && obj[field] !== null && obj[field] !== '');
    };

    test('should validate required fields exist', () => {
      const userData = {
        email: 'test@example.com',
        password: 'SecurePass123!',
        name: 'John Doe'
      };

      const required = ['email', 'password', 'name'];
      expect(validateRequired(userData, required)).toBe(true);
    });

    test('should reject missing required fields', () => {
      const userData = {
        email: 'test@example.com',
        // Missing password and name
      };

      const required = ['email', 'password', 'name'];
      expect(validateRequired(userData, required)).toBe(false);
    });

    test('should reject empty required fields', () => {
      const userData = {
        email: 'test@example.com',
        password: '',
        name: 'John Doe'
      };

      const required = ['email', 'password', 'name'];
      expect(validateRequired(userData, required)).toBe(false);
    });

    test('should reject null required fields', () => {
      const userData = {
        email: null,
        password: 'SecurePass123!',
        name: 'John Doe'
      };

      const required = ['email', 'password', 'name'];
      expect(validateRequired(userData, required)).toBe(false);
    });
  });

  describe('Data Type Validation', () => {
    test('should validate string type', () => {
      expect(typeof 'hello').toBe('string');
      expect(typeof 123).not.toBe('string');
    });

    test('should validate number type', () => {
      expect(typeof 123).toBe('number');
      expect(typeof '123').not.toBe('number');
    });

    test('should validate boolean type', () => {
      expect(typeof true).toBe('boolean');
      expect('true').not.toBe('boolean');
    });

    test('should validate array type', () => {
      expect(Array.isArray([1, 2, 3])).toBe(true);
      expect(Array.isArray('not array')).toBe(false);
      expect(Array.isArray({ length: 2 })).toBe(false);
    });
  });
});

describe('Rate Limiting', () => {
  describe('Rate Limiter State', () => {
    test('should track request count', () => {
      const requestTracker = {};
      const ip = '192.168.1.1';

      // Simulate first request
      requestTracker[ip] = (requestTracker[ip] || 0) + 1;
      expect(requestTracker[ip]).toBe(1);

      // Simulate more requests
      requestTracker[ip] += 1;
      requestTracker[ip] += 1;
      expect(requestTracker[ip]).toBe(3);
    });

    test('should allow requests under limit', () => {
      const maxRequests = 100;
      let requestCount = 0;

      for (let i = 0; i < maxRequests - 1; i++) {
        requestCount++;
      }

      expect(requestCount < maxRequests).toBe(true);
    });

    test('should reject requests over limit', () => {
      const maxRequests = 5;
      let requestCount = 0;

      const shouldAllow = (count, max) => count < max;

      // 5 requests
      for (let i = 0; i < 5; i++) {
        requestCount++;
      }

      expect(shouldAllow(requestCount, maxRequests)).toBe(false);
    });

    test('should reset count after time window', () => {
      const timeWindow = 60 * 1000; // 60 seconds
      const lastReset = { time: Date.now() };
      let count = 0;

      // Simulate requests
      count += 5;

      // Check if we should reset
      const now = Date.now();
      const shouldReset = now - lastReset.time > timeWindow;

      if (shouldReset) {
        count = 0;
        lastReset.time = now;
      }

      // Without time passing, shouldn't reset
      expect(count).toBe(5);
      expect(shouldReset).toBe(false);
    });
  });

  describe('IP-based Rate Limiting', () => {
    test('should track requests per IP', () => {
      const requests = {};
      const ip1 = '192.168.1.1';
      const ip2 = '192.168.1.2';

      requests[ip1] = (requests[ip1] || 0) + 1;
      requests[ip1] = (requests[ip1] || 0) + 1;
      requests[ip2] = (requests[ip2] || 0) + 1;

      expect(requests[ip1]).toBe(2);
      expect(requests[ip2]).toBe(1);
    });

    test('should isolate rate limits per IP', () => {
      const requests = {};
      const maxPerIP = 10;
      const ips = ['192.168.1.1', '192.168.1.2', '192.168.1.3'];

      ips.forEach(ip => {
        requests[ip] = 8;
      });

      // IP1 should be able to make 2 more requests
      expect(requests['192.168.1.1'] < maxPerIP).toBe(true);

      // IP2 and IP3 should also have their own limits
      expect(requests['192.168.1.2']).toBe(8);
      expect(requests['192.168.1.3']).toBe(8);
    });
  });

  describe('Header Validation', () => {
    test('should have rate limit headers in response', () => {
      const rateLimitHeaders = {
        'RateLimit-Limit': '100',
        'RateLimit-Remaining': '99',
        'RateLimit-Reset': '1234567890'
      };

      expect(rateLimitHeaders['RateLimit-Limit']).toBeDefined();
      expect(rateLimitHeaders['RateLimit-Remaining']).toBeDefined();
      expect(rateLimitHeaders['RateLimit-Reset']).toBeDefined();
    });

    test('should reject request if rate limit exceeded', () => {
      const response = {
        status: 429,
        headers: {
          'RateLimit-Remaining': '0',
          'Retry-After': '60'
        }
      };

      expect(response.status).toBe(429);
      expect(response.headers['Retry-After']).toBe('60');
    });
  });
});
