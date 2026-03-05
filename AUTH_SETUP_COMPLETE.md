# NextAuth.js Authentication Setup - Bjerke Travskole

## ✅ Setup Complete

All authentication files have been created successfully for the Bjerke Travskole project.

## Files Created

### 1. **lib/auth.ts**
Helper functions for authentication:
- `hashPassword()` - Hash passwords using bcrypt (12 salt rounds)
- `verifyPassword()` - Verify plain text password against hash
- `getServerSession()` - Wrapper for NextAuth's getServerSession

### 2. **app/api/auth/[...nextauth]/route.ts**
NextAuth configuration:
- Credentials provider (email + password authentication)
- Prisma adapter for database integration
- JWT session strategy (30 day expiry)
- Role-based access control (parent, admin)
- Custom callbacks for JWT and session data
- Norwegian error messages

### 3. **app/api/auth/register/route.ts**
Registration API endpoint:
- Creates User + Parent records in database transaction
- Validates required fields
- Checks for existing users
- Hashes passwords before storage
- Returns appropriate error messages in Norwegian

### 4. **app/auth/login/page.tsx**
Login page (Norwegian UI):
- Email + password form
- React Hook Form + Zod validation
- Error handling with Norwegian messages
- Redirects to /dashboard after successful login
- Link to registration page
- Styled with design guide colors (#003B7A blue)

### 5. **app/auth/register/page.tsx**
Registration page (Norwegian UI):
- Parent registration form (name, email, phone, password, address)
- Password confirmation validation
- React Hook Form + Zod validation
- Creates User + Parent in database
- Styled with design guide colors
- Link to login page

### 6. **middleware.ts**
Route protection:
- Protects `/dashboard` and `/admin` routes
- Admin routes require `admin` role
- Redirects unauthenticated users to `/auth/login`
- Redirects non-admin users trying to access `/admin` to `/dashboard`
- Allows public routes (/, /auth/*, /api/auth/*)

### 7. **types/next-auth.d.ts**
TypeScript type definitions:
- Extends NextAuth types with custom user properties
- Adds `role` and `id` to User, Session, and JWT types
- Ensures type safety across the application

## Database Schema (Already Exists)

The Prisma schema in `prisma/schema.prisma` includes:

- **User** model: email, passwordHash, role (parent/admin)
- **Parent** model: name, phone, address, linked to User
- **Child** model: linked to Parent
- **Course** model: kurs & leirer
- **Registration** model: links Course, Child, and Parent

## Design Implementation

All authentication pages follow the design guide (`docs/travskole-design-guide.md`):
- **Primary color**: #003B7A (deep royal blue)
- **Hover color**: #002855 (darker blue)
- **Clean forms** with proper spacing
- **Professional Norwegian UI**
- **Mobile-friendly** design
- **Accessible** with proper focus states

## Next Steps

To complete the setup:

1. **Install dependencies** (if not already installed):
   ```bash
   npm install next-auth @auth/prisma-adapter bcryptjs
   npm install -D @types/bcryptjs
   ```

2. **Set environment variables** in `.env`:
   ```env
   DATABASE_URL="file:./dev.db"
   NEXTAUTH_SECRET="your-secret-key-here"  # Generate with: openssl rand -base64 32
   NEXTAUTH_URL="http://localhost:3000"     # Production: https://your-domain.com
   ```

3. **Run Prisma migrations**:
   ```bash
   npx prisma generate
   npx prisma migrate dev --name add_auth
   ```

4. **Test the authentication**:
   - Start dev server: `npm run dev`
   - Navigate to: http://localhost:3000/auth/register
   - Create a test account
   - Try logging in at: http://localhost:3000/auth/login
   - Access protected route: http://localhost:3000/dashboard

## Usage Examples

### Protecting a page (Server Component)
```tsx
import { getServerSession } from '@/lib/auth';
import { redirect } from 'next/navigation';

export default async function DashboardPage() {
  const session = await getServerSession();
  
  if (!session) {
    redirect('/auth/login');
  }

  return <div>Welcome {session.user.name}!</div>;
}
```

### Checking user role
```tsx
const session = await getServerSession();

if (session?.user.role === 'admin') {
  // Show admin features
}
```

### Client-side session
```tsx
'use client';
import { useSession } from 'next-auth/react';

export default function ClientComponent() {
  const { data: session, status } = useSession();
  
  if (status === 'loading') return <div>Loading...</div>;
  if (!session) return <div>Not logged in</div>;
  
  return <div>Hello {session.user.email}</div>;
}
```

## Security Features

✅ **Password hashing** with bcrypt (12 rounds)  
✅ **JWT sessions** (secure, stateless)  
✅ **Role-based access control**  
✅ **Route protection** via middleware  
✅ **CSRF protection** (built into NextAuth)  
✅ **Secure password validation** (minimum 6 characters)  
✅ **Email uniqueness** validation  
✅ **Database transactions** for atomic user creation  

## Norwegian UI Text

All user-facing text is in Norwegian:
- "Logg inn" (Login)
- "Opprett konto" (Create account)
- "E-post" (Email)
- "Passord" (Password)
- "Fullt navn" (Full name)
- "Telefon" (Phone)
- Error messages in Norwegian

---

**Created:** 2026-03-05  
**Project:** Bjerke Travskole  
**Authentication:** NextAuth.js with Prisma + bcrypt
