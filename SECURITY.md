# 🔒 Security Documentation

## Security Fixes Applied (March 5, 2026)

This document outlines the security measures implemented in the Travskole application.

---

## ✅ Critical Fixes Implemented

### 1. **Authentication on Admin Endpoints** ✅
**Issue:** GET /api/registrations was accessible without authentication  
**Risk:** Anyone could download all registration data (GDPR violation)  
**Fix:**
- Added `getServerSession()` check
- Returns 401 Unauthorized if not authenticated as admin
- File: `app/api/registrations/route.ts`

**Test:**
```bash
# Should return 401
curl http://localhost:3000/api/registrations

# Should return data (with valid admin session)
curl http://localhost:3000/api/registrations -H "Cookie: next-auth.session-token=..."
```

---

### 2. **Rate Limiting** ✅
**Issue:** No protection against brute force or spam  
**Risk:** Attackers could attempt unlimited login tries or flood registrations  
**Fix:**
- Implemented `rate-limiter-flexible`
- Login: 5 attempts per 15 minutes per IP
- Registrations: 10 per hour per IP
- Returns 429 Too Many Requests when exceeded
- Files: `lib/rate-limiter.ts`, `app/api/registrations/route.ts`

**Test:**
```bash
# Try registering 11 times in a row - 11th should fail with 429
for i in {1..11}; do
  curl -X POST http://localhost:3000/api/registrations \
    -H "Content-Type: application/json" \
    -d '{"courseId":"1","parentEmail":"test@test.com",...}'
done
```

---

### 3. **Backend Input Validation** ✅
**Issue:** Only frontend validation - backend could be bypassed  
**Risk:** Malicious data could be inserted directly via API  
**Fix:**
- Re-validated email, phone, names on backend with Zod
- Returns 400 Bad Request for invalid data
- File: `app/api/registrations/route.ts`

**Test:**
```bash
# Should return 400 (invalid email)
curl -X POST http://localhost:3000/api/registrations \
  -H "Content-Type: application/json" \
  -d '{"parentEmail":"not-an-email",...}'
```

---

### 4. **Input Sanitization (XSS Protection)** ✅
**Issue:** User input stored without sanitization  
**Risk:** Stored XSS attacks via names, allergies, etc.  
**Fix:**
- Implemented `isomorphic-dompurify`
- Sanitizes: parentName, childName, childAllergies before DB insert
- React's JSX already escapes output, double protection
- File: `app/api/registrations/route.ts`

**Test:**
```bash
# Try injecting script tag - should be sanitized
curl -X POST http://localhost:3000/api/registrations \
  -H "Content-Type: application/json" \
  -d '{"childName":"<script>alert(1)</script>",...}'

# Check database - should NOT contain <script> tags
```

---

### 5. **Security Headers** ✅
**Issue:** Missing security headers  
**Risk:** Clickjacking, XSS, MIME-sniffing attacks  
**Fix:**
Added to `next.config.ts`:
- **Content-Security-Policy:** Whitelists safe sources (Stripe, Vipps, GTM, GetCookies)
- **X-Frame-Options:** DENY (prevents clickjacking)
- **X-Content-Type-Options:** nosniff (prevents MIME-sniffing)
- **Referrer-Policy:** strict-origin-when-cross-origin
- **Permissions-Policy:** Blocks camera, mic, geolocation

**Test:**
```bash
# Check headers
curl -I http://localhost:3000

# Should see:
# content-security-policy: default-src 'self'; ...
# x-frame-options: DENY
# x-content-type-options: nosniff
```

---

### 6. **HTTPS Enforcing** ✅
**Issue:** No automatic HTTPS redirect  
**Risk:** Man-in-the-middle attacks, credential theft  
**Fix:**
- Added middleware check for production
- Redirects HTTP → HTTPS (301 permanent)
- File: `middleware.ts`

**Test:** (in production)
```bash
# Should redirect to https://
curl -I http://travskole.bjerke.no
```

---

### 7. **NEXTAUTH_SECRET Generation** ✅
**Issue:** Placeholder secret in .env.example  
**Risk:** Weak or default secrets  
**Fix:**
- Generated strong secret: `openssl rand -base64 32`
- Updated `.env.example` with example + instructions
- Added security comment to never commit real secret

**Test:**
```bash
# Generate new secret for production
openssl rand -base64 32
```

---

### 8. **Security Logging** ✅
**Issue:** No logging of security events  
**Risk:** Can't detect or respond to attacks  
**Fix:**
- Implemented winston logger
- Logs: failed logins, rate limit exceeded, registrations
- Separate files: `security.log`, `error.log`, `combined.log`
- Files: `lib/logger.ts`, `logs/` directory

**Test:**
```bash
# Trigger rate limit, then check logs
tail -f logs/security.log

# Should see:
# {"event":"RATE_LIMIT_EXCEEDED","endpoint":"/api/registrations","ip":"..."}
```

---

## 🟡 Remaining Security TODOs

These are **not critical** for initial launch, but should be implemented soon:

### 1. **GDPR Export/Delete Functions**
- Export user data (JSON/PDF)
- Delete account with cascade
- Priority: Medium
- Timeline: Before public launch

### 2. **Email Verification**
- Magic link or verification code
- Prevents fake email registrations
- Priority: Medium
- Timeline: Within 1 month

### 3. **Admin Audit Log**
- Log all admin actions (confirm/reject registrations)
- Store in database table
- Priority: Low
- Timeline: Within 2 months

### 4. **Two-Factor Authentication (2FA)**
- For admin accounts
- TOTP-based (Google Authenticator)
- Priority: Low
- Timeline: Future enhancement

### 5. **Session Expiry Reduction**
- Current: 30 days
- Recommended: 7 days
- Priority: Low
- Timeline: Optional optimization

---

## 📊 Security Posture

| Category | Before Fixes | After Fixes |
|----------|--------------|-------------|
| Authentication | 🟡 Moderate | 🟢 Good |
| Authorization | 🔴 Critical | 🟢 Good |
| Input Validation | 🟡 Moderate | 🟢 Good |
| Data Protection | 🟠 Moderate | 🟡 Moderate |
| GDPR Compliance | 🟠 Moderate | 🟡 Moderate |
| Infrastructure | 🟡 Moderate | 🟢 Good |

**Overall Status:** ✅ **Ready for Production** (with GDPR features coming soon)

---

## 🛡️ Security Best Practices for Maintainers

### Environment Variables
- ✅ **DO:** Store secrets in `.env` (never commit!)
- ✅ **DO:** Use strong NEXTAUTH_SECRET in production
- ❌ **DON'T:** Hardcode API keys or passwords in code
- ❌ **DON'T:** Share `.env` files via Slack/email

### Database
- ✅ **DO:** Use Prisma ORM (prevents SQL injection)
- ✅ **DO:** Validate all input on backend
- ❌ **DON'T:** Use raw SQL queries with user input
- ❌ **DON'T:** Store plaintext passwords (always use bcrypt)

### API Routes
- ✅ **DO:** Check authentication for protected endpoints
- ✅ **DO:** Validate and sanitize all user input
- ✅ **DO:** Use rate limiting on sensitive endpoints
- ❌ **DON'T:** Trust client-side validation alone

### Dependencies
- ✅ **DO:** Run `npm audit` regularly
- ✅ **DO:** Keep packages updated
- ✅ **DO:** Review security advisories
- ❌ **DON'T:** Ignore `npm audit` warnings

---

## 🚨 Incident Response

If a security issue is discovered:

1. **Assess severity** (Critical/High/Medium/Low)
2. **If critical:** Take affected service offline immediately
3. **Notify:** andreas.hatlem@gmail.com
4. **Fix:** Patch vulnerability ASAP
5. **Test:** Verify fix works
6. **Deploy:** Push to production
7. **Post-mortem:** Document what happened and how to prevent

---

## 📞 Security Contact

For security issues, contact:  
**Andreas Hatlem**  
Email: andreas.hatlem@gmail.com

---

## 🔄 Next Security Audit

Recommended: **3 months after production launch**  
Or immediately after any major feature addition

---

_Last updated: March 5, 2026_  
_Next review: June 2026_
