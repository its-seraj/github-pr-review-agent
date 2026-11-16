# PR Review: fix: handle invalid URI component in decodeURIComponent
[its-seraj/runtime-error-service#7](https://github.com/its-seraj/runtime-error-service/pull/7) · by its-seraj

## 📁 Modified Files

- `routes/errors.js`

---

## 🌟 What's Great

- **Only URIError is caught** (`routes/errors.js`): The catch block checks `err instanceof URIError` and rethrows anything else, so unrelated failures still reach the error middleware.

---

## 🐞 Possible Bugs & Security Issues

### 1. Endpoint now always returns 400 and no longer raises URIError (MEDIUM)

**Location:** Lines 281-290

```javascript
let decoded;
try {
  decoded = decodeURIComponent('%');
} catch (err) {
  if (err instanceof URIError) {
    return res.status(400).json({ error: 'Invalid URI component' });
  }
  throw err;
}
```

**Issues:**

- The input is the hard-coded `'%'`, so every request lands in the catch block and returns the same 400. `res.json({ decoded })` can never run.
- This service exists to trigger errors on purpose. The ERROR_CATALOG entry (lines 76-82) says this endpoint demonstrates URIError, and it now never reaches the error pipeline.
- Other demo endpoints changed the same way (for example `/type-error` and `/syntax-error-runtime`) also no longer trigger their errors, so check whether these Jira tickets came from expected demo errors.

**Recommendation:**

```javascript
// Intentional URIError demo: let it reach the error middleware.
// If a safe mode is wanted, gate it behind a query param.
if (req.query.safe === 'true') {
  try {
    return res.json({ decoded: decodeURIComponent(req.query.value ?? '%') });
  } catch (err) {
    if (err instanceof URIError) return res.status(400).json({ error: 'Invalid URI component' });
    throw err;
  }
}
const decoded = decodeURIComponent('%');
res.json({ decoded });
```

---

## 🧪 Missing Tests

- `routes/errors.js`: GET /api/errors/uri-error: check the status code and body it returns, and that it matches what the catalog says the endpoint does (the repo has no tests yet).
