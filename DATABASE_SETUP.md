# Database Setup Summary

## ✅ Prisma Schema Created

Successfully created `prisma/schema.prisma` with the following models:

### 1. **User Model**
- Authentication & role-based access control
- Fields: `id`, `email`, `passwordHash`, `role`, `createdAt`
- Roles: `parent` (default) or `admin`
- One-to-one relation with Parent

### 2. **Parent Model**
- Linked to User via `userId`
- Fields: `id`, `userId`, `name`, `phone`, `address`, `deletedAt`, `createdAt`, `updatedAt`
- Includes GDPR soft delete support (`deletedAt`)
- One-to-many relation with Children
- One-to-many relation with Registrations

### 3. **Child Model**
- Linked to Parent via `parentId`
- Fields: `id`, `parentId`, `name`, `birthdate`, `allergies`, `deletedAt`, `createdAt`, `updatedAt`
- Includes GDPR soft delete support (`deletedAt`)
- One-to-many relation with Registrations

### 4. **Course Model**
- Represents courses and camps (leirer)
- Fields: `id`, `name`, `description`, `type`, `startDate`, `endDate`, `ageMin`, `ageMax`, `price`, `maxParticipants`, `status`, `createdAt`, `updatedAt`
- Type: `'kurs'` or `'leir'`
- Status: `'open'`, `'full'`, or `'closed'`
- One-to-many relation with Registrations

### 5. **Registration Model**
- Links Course, Child, and Parent
- Fields: `id`, `courseId`, `childId`, `parentId`, `consentActivities`, `consentMedia`, `consentRisk`, `status`, `createdAt`, `updatedAt`
- Three consent flags for activities, media, and risk
- Status: `'pending'`, `'confirmed'`, or `'cancelled'`

## 🔧 Setup Steps Completed

1. ✅ Created Prisma schema with SQLite for development
2. ✅ Generated Prisma Client (`npx prisma generate`)
3. ✅ Pushed schema to database (`npx prisma db push`)
4. ✅ Created seed script with sample data
5. ✅ Seeded database with initial data
6. ✅ Tested database connection and queries

## 📊 Sample Data Created

- **Users**: 2
  - `admin@bjerke.no` (admin role)
  - `mor@eksempel.no` (parent role)
- **Parents**: 1
  - Kari Nordmann
- **Children**: 2
  - Emma Nordmann (born 2015-06-15)
  - Ole Nordmann (born 2018-03-22, allergic to pollen)
- **Courses**: 3
  - Begynnerkurs - Våren 2026 (kurs, ages 6-12, 2500 NOK)
  - Sommerleir 2026 - Uke 28 (leir, ages 7-14, 4800 NOK)
  - Videregående - Høsten 2026 (kurs, ages 8-15, 3200 NOK)
- **Registrations**: 1
  - Emma Nordmann registered for Begynnerkurs (confirmed)

## 🚀 Next Steps

### For Development
```bash
# Start development server
npm run dev

# View database in Prisma Studio
npx prisma studio

# Reset database (drop all data)
npx prisma db push --force-reset

# Re-seed after reset
node prisma/seed.js
```

### For Production
1. Update `prisma/schema.prisma`:
   ```prisma
   datasource db {
     provider = "postgresql"  // Change from sqlite
     url      = env("DATABASE_URL")
   }
   ```

2. Set production DATABASE_URL in `.env`:
   ```
   DATABASE_URL="postgresql://user:password@host:5432/database?schema=public"
   ```

3. Run migrations:
   ```bash
   npx prisma migrate dev --name init
   npx prisma generate
   npx prisma db push
   ```

## 🔐 Security Notes

- Passwords are hashed using bcrypt (12 rounds)
- GDPR compliance: soft delete support via `deletedAt` fields
- Cascade deletes configured: deleting a parent also deletes children and registrations
- Role-based access control via User.role field

## 📝 Database File

- **Development**: `prisma/dev.db` (SQLite)
- **Production**: PostgreSQL (to be configured via Supabase or similar)

## 🧪 Testing

Run the test script to verify database connection:
```bash
node test-db.js
```

This will verify:
- User authentication data
- Parent-child relationships
- Course listings
- Registration links and consents
- All database queries are working correctly
